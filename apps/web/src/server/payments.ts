import { createHmac, timingSafeEqual } from "node:crypto";
import { query, transaction } from "@edu/db";
import { couponAmount, type Actor } from "@edu/shared";
import { v7 } from "uuid";
import type { PoolClient } from "pg";
import { HttpError, permit, rate, event, notify } from "./core";
export interface PaymentProvider {
  createOrder(id: string, amount: number): Promise<{ id: string }>;
}
export const razorpay: PaymentProvider = {
  async createOrder(id, amount) {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
          ).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount, currency: "INR", receipt: id }),
    });
    if (!res.ok) throw new HttpError(502, "Payment provider unavailable");
    return res.json();
  },
};
// Test-mode stub: never talks to Razorpay. For local/CI e2e only; refuses to load in production.
if (process.env.PAYMENTS_STUB === "1" && process.env.NODE_ENV === "production")
  throw new Error("PAYMENTS_STUB cannot be enabled in production");
const stubProvider: PaymentProvider = {
  async createOrder(id) {
    return { id: `order_stub_${id.replaceAll("-", "")}` };
  },
};
export const provider: PaymentProvider =
  process.env.PAYMENTS_STUB === "1" ? stubProvider : razorpay;
export function signature(body: string, provided: string, secret: string) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  return timingSafeEqual(
    Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "hex"),
    Buffer.from(provided, "hex"),
  );
}
async function enroll(tx: PoolClient, order: any, paymentId: string | null) {
  const offering = (
    await tx.query("SELECT * FROM offerings WHERE id=$1 FOR UPDATE", [
      order.offering_id,
    ])
  ).rows[0];
  const seq = (await tx.query("SELECT nextval('receipt_seq') n")).rows[0].n;
  const receipt = `VG-${new Date().getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
  await tx.query(
    "UPDATE orders SET status='paid',paid_at=now(),receipt_number=$2,razorpay_payment_id=$3 WHERE id=$1",
    [order.id, receipt, paymentId],
  );
  await tx.query(
    // Monthly offerings extend access by one month from the later of now or the current expiry; one-time access never expires.
    `INSERT INTO course_members(id,course_id,user_id,role,section_id,access_until)
     VALUES($1,$2,$3,'student',$4,CASE WHEN $5 THEN now()+interval '1 month' END)
     ON CONFLICT(course_id,user_id) DO UPDATE SET
       access_until=CASE WHEN course_members.role<>'student' THEN course_members.access_until
                         WHEN NOT $5 OR course_members.access_until IS NULL THEN NULL
                         ELSE greatest(course_members.access_until,now())+interval '1 month' END,
       updated_at=now()`,
    [
      v7(),
      offering.course_id,
      order.user_id,
      offering.section_id,
      offering.billing === "monthly",
    ],
  );
  await event(tx, order.user_id, offering.course_id, "order_paid", order.id);
  await notify(
    tx,
    order.user_id,
    "receipt",
    `You're enrolled · ${receipt}`,
    `Payment of ₹${(order.amount_paise / 100).toLocaleString("en-IN")} received for ${offering.title}. Receipt ${receipt}.`,
    "/dashboard",
  );
  return true;
}
export async function checkout(
  user: Actor,
  offeringId: string,
  couponCode?: string,
) {
  await permit(user, "account:manage", { userId: user.id });
  await rate(`checkout:${user.id}`, 5, 60);
  return transaction(async (tx) => {
    const o = (
      await tx.query(
        "SELECT * FROM offerings WHERE id=$1 AND active FOR UPDATE",
        [offeringId],
      )
    ).rows[0];
    if (!o) throw new HttpError(404, "Offering not found");
    const member = (
      await tx.query(
        "SELECT role,access_until FROM course_members WHERE course_id=$1 AND user_id=$2",
        [o.course_id, user.id],
      )
    ).rows[0];
    // Monthly students renew by paying again; everyone else is already in.
    const renewal =
      member?.role === "student" &&
      o.billing === "monthly" &&
      member.access_until !== null;
    if (member && !renewal)
      throw new HttpError(409, "You are already enrolled");
    let amount = o.price_inr;
    if (couponCode) {
      const c = (
        await tx.query(
          "UPDATE coupons SET used_count=used_count+1 WHERE upper(code)=upper($1) AND active AND used_count<max_uses AND (expires_at IS NULL OR expires_at>now()) RETURNING *",
          [couponCode],
        )
      ).rows[0];
      if (!c) throw new HttpError(400, "Coupon is invalid or fully used");
      amount = couponAmount(amount, c.percent_off);
    }
    const id = v7();
    const remote = amount > 0 ? await provider.createOrder(id, amount) : null;
    const order = (
      await tx.query(
        "INSERT INTO orders(id,user_id,offering_id,amount_paise,coupon_code,razorpay_order_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          id,
          user.id,
          offeringId,
          amount,
          couponCode || null,
          remote?.id || null,
        ],
      )
    ).rows[0];
    if (!amount) {
      await enroll(tx, order, null);
    }
    return {
      id,
      amount,
      razorpayOrderId: remote?.id,
      key: process.env.RAZORPAY_KEY_ID,
      free: amount === 0,
    };
  });
}
export async function verify(user: Actor, p: any) {
  await permit(user, "account:manage", { userId: user.id });
  const [order] = await query(
    "SELECT * FROM orders WHERE razorpay_order_id=$1 AND user_id=$2",
    [p.razorpay_order_id, user.id],
  );
  if (
    !order ||
    !signature(
      `${p.razorpay_order_id}|${p.razorpay_payment_id}`,
      p.razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET || "",
    )
  )
    throw new HttpError(400, "Invalid payment signature");
  return { verified: true, status: order.status };
}
export async function processWebhook(
  body: string,
  sig: string,
  eventId: string,
) {
  if (!signature(body, sig, process.env.RAZORPAY_WEBHOOK_SECRET || ""))
    throw new HttpError(400, "Invalid webhook signature");
  const data = JSON.parse(body);
  await transaction(async (tx) => {
    const ins = await tx.query(
      "INSERT INTO webhook_events(id,provider_event_id,type,payload) VALUES($1,$2,$3,$4) ON CONFLICT(provider_event_id) DO NOTHING RETURNING id",
      [v7(), eventId, data.event, data],
    );
    if (!ins.rowCount) return;
    const p = data.payload?.payment?.entity;
    const refund = data.payload?.refund?.entity;
    if (["payment.captured", "order.paid"].includes(data.event)) {
      if (!p?.id || !p.order_id) throw new HttpError(400, "Missing payment");
      const o = (
        await tx.query(
          "SELECT * FROM orders WHERE razorpay_order_id=$1 FOR UPDATE",
          [p.order_id],
        )
      ).rows[0];
      if (!o) throw new HttpError(404, "Order not found");
      if (o.status === "created") {
        if (p.currency !== "INR" || p.amount !== o.amount_paise)
          throw new HttpError(400, "Payment amount mismatch");
        await enroll(tx, o, p.id);
      }
    } else if (data.event === "refund.processed") {
      const o = (
        await tx.query(
          "UPDATE orders SET status='refunded',updated_at=now() WHERE razorpay_payment_id=$1 RETURNING *",
          [refund?.payment_id],
        )
      ).rows[0];
      if (o) {
        const offering = (
          await tx.query("SELECT * FROM offerings WHERE id=$1", [o.offering_id])
        ).rows[0];
        await tx.query(
          "DELETE FROM course_members WHERE user_id=$1 AND course_id=$2 AND role='student' AND NOT EXISTS(SELECT 1 FROM orders x JOIN offerings f ON f.id=x.offering_id WHERE x.user_id=$1 AND f.course_id=$2 AND x.status='paid')",
          [o.user_id, offering.course_id],
        );
        await notify(
          tx,
          o.user_id,
          "refund",
          "Refund processed",
          "Your course payment has been refunded.",
          "/dashboard",
        );
      }
    }
    await tx.query("UPDATE webhook_events SET processed_at=now() WHERE id=$1", [
      ins.rows[0].id,
    ]);
  });
}
