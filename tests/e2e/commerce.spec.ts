import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { v7 } from "uuid";
import { loginAs } from "./auth";

const pool = new Pool({
  // Owner connection: assertions read RLS-protected tables without a user context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());

// Stand-in for https://checkout.razorpay.com/v1/checkout.js: "paying" immediately calls the
// page's success handler with a payment signed like Razorpay would sign it.
const fakeCheckout = `window.Razorpay=function(options){window.__razorpayOptions=options;this.open=async function(){options.handler(await window.__razorpayPay(options.order_id,options.amount));};};`;

test("visitor enrolls, pays via stubbed Razorpay, webhook grants lesson access", async ({
  browser,
}) => {
  test.skip(
    process.env.PAYMENTS_STUB !== "1",
    "Needs PAYMENTS_STUB=1 and test Razorpay secrets in the web server env",
  );
  const stamp = Date.now();
  const email = `buyer-${stamp}@example.com`;
  const title = `E2E paid access ${stamp}`;
  const [course] = (
    await pool.query(
      "SELECT id FROM courses WHERE slug='sql-from-zero-to-interview'",
    )
  ).rows;
  const offeringId = v7();
  await pool.query(
    "INSERT INTO offerings(id,course_id,title,price_inr,billing,active) VALUES($1,$2,$3,149900,'one_time',true)",
    [offeringId, course.id, title],
  );
  const [lesson] = (
    await pool.query(
      "SELECT l.id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=$1 AND l.published AND NOT l.is_free_preview AND (m.release_at IS NULL OR m.release_at<now()) AND m.section_id IS NULL ORDER BY m.position,l.position LIMIT 1",
      [course.id],
    )
  ).rows;
  const userId = v7();
  await pool.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Priya Buyer',$2,true)",
    [userId, email],
  );
  const context = await browser.newContext();
  let paymentId = "";
  try {
    const page = await context.newPage();
    await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: fakeCheckout }),
    );
    await page.exposeFunction(
      "__razorpayPay",
      (orderId: string, amount: number) => {
        paymentId = `pay_e2e_${stamp}`;
        expect(amount).toBe(149900);
        return {
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: createHmac(
            "sha256",
            process.env.RAZORPAY_KEY_SECRET!,
          )
            .update(`${orderId}|${paymentId}`)
            .digest("hex"),
        };
      },
    );

    // Visitor: enrolling without a session goes to the student login first.
    await page.goto("/courses/sql-from-zero-to-interview");
    const card = page.locator(".offering").filter({ hasText: title });
    await expect(card.getByText("₹1,499")).toBeVisible();
    await card.getByRole("button", { name: /Pay with UPI & enroll/ }).click();
    await expect(page).toHaveURL(/\/login\?next=/);

    // "Signs in with Google" (test session), comes back and pays.
    await loginAs(context, email);
    await page.goto("/courses/sql-from-zero-to-interview");
    await page
      .locator(".offering")
      .filter({ hasText: title })
      .getByRole("button", { name: /Pay with UPI & enroll/ })
      .click();
    await expect(
      page.getByText("Your payment is being confirmed."),
    ).toBeVisible();
    // UPI is the primary method: first block in Razorpay Checkout, others still offered.
    const options = await page.evaluate(() => {
      const o = (window as any).__razorpayOptions;
      return { config: o.config, prefill: o.prefill, currency: o.currency };
    });
    expect(options.currency).toBe("INR");
    expect(options.config.display.sequence[0]).toBe("block.upi");
    expect(options.config.display.blocks.upi.instruments).toEqual([
      { method: "upi" },
    ]);
    expect(options.config.display.preferences.show_default_blocks).toBe(true);
    expect(options.prefill.email).toBe(email);

    // Browser verification alone must not enrol.
    const [order] = (
      await pool.query(
        "SELECT * FROM orders WHERE user_id=$1 AND offering_id=$2",
        [userId, offeringId],
      )
    ).rows;
    expect(order.status).toBe("created");
    expect(order.razorpay_order_id).toMatch(/^order_stub_/);
    expect(
      (await context.request.get(`/api/lessons/${lesson.id}`)).status(),
    ).toBe(403);

    // Razorpay's webhook enrols; a bad signature is rejected, a replay is harmless.
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: order.razorpay_order_id,
            amount: 149900,
            currency: "INR",
          },
        },
      },
    });
    const sign = (secret: string) =>
      createHmac("sha256", secret).update(body).digest("hex");
    const send = (signature: string) =>
      context.request.post("/api/webhooks/razorpay", {
        data: body,
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": `evt_e2e_${stamp}`,
        },
      });
    expect((await send(sign("wrong-secret"))).status()).toBe(400);
    expect((await send(sign(process.env.RAZORPAY_WEBHOOK_SECRET!))).ok()).toBe(
      true,
    );
    expect((await send(sign(process.env.RAZORPAY_WEBHOOK_SECRET!))).ok()).toBe(
      true,
    );

    const [paid] = (
      await pool.query("SELECT * FROM orders WHERE id=$1", [order.id])
    ).rows;
    expect(paid.status).toBe("paid");
    expect(paid.receipt_number).toMatch(/^VG-\d{4}-\d{6}$/);
    const members = await pool.query(
      "SELECT 1 FROM course_members WHERE user_id=$1 AND course_id=$2 AND role='student'",
      [userId, course.id],
    );
    expect(members.rowCount).toBe(1);

    expect((await context.request.get(`/api/lessons/${lesson.id}`)).ok()).toBe(
      true,
    );
    await page.goto(`/learn/sql-from-zero-to-interview/${lesson.id}`);
    await expect(
      page.getByRole("button", { name: /Mark complete|Lesson complete/ }),
    ).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByText(paid.receipt_number).first()).toBeVisible();
  } finally {
    await context.close();
    // Remove everything this run created so the dev database stays tidy.
    for (const sql of [
      "DELETE FROM notifications WHERE user_id=$1",
      "DELETE FROM events WHERE user_id=$1",
      "DELETE FROM lesson_progress WHERE user_id=$1",
      "DELETE FROM course_members WHERE user_id=$1",
      "DELETE FROM orders WHERE user_id=$1",
      "DELETE FROM sessions WHERE user_id=$1",
      "DELETE FROM users WHERE id=$1",
    ])
      await pool.query(sql, [userId]);
    await pool.query("DELETE FROM offerings WHERE id=$1", [offeringId]);
  }
});
