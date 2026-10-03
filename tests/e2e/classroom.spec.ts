import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { loginAs } from "./auth";
const pool = new Pool({
  // Owner connection: assertions read RLS-protected tables without a user context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());
test("minimal homepage fits and Contact links to the personal website", async ({
  page,
  context,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ["/"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Vishnu Gandarapu",
      );
      expect(
        await page.evaluate(() => ({
          width: document.documentElement.scrollWidth <= innerWidth,
          height: document.documentElement.scrollHeight <= innerHeight,
        })),
      ).toEqual({ width: true, height: true });
      await expect(page.locator("body")).not.toContainText(
        /Zero rows of boredom|PICK YOUR PATH|Ask me|CURIOSITY|CAPTURE THE FLAG|hidden bugs/,
      );
    }
  }
  const oldContact = await page.request.get("/contact", { maxRedirects: 0 });
  expect(oldContact.status()).toBe(307);
  expect(oldContact.headers().location).toBe("https://vishnugandarapu.in");
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Contact", exact: true }),
  ).toHaveAttribute("href", "https://vishnugandarapu.in");
  await expect(page).toHaveTitle("Edu - Vishnu Gandarapu");
  const brands = page.getByRole("link", {
    name: "Vishnu / Learn",
    exact: true,
  });
  await expect(brands).toHaveCount(2);
  for (const brand of await brands.all()) {
    await expect(brand).toHaveAttribute("href", "/");
    await expect(brand).toHaveText("v.");
  }
  await expect(page.locator(".home")).not.toContainText(/₹|Free|FROM/);
  await page.getByRole("link", { name: "View courses", exact: true }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses");
  await loginAs(context, "instructor@example.com");
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true }).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("student sees dashboard, reads lesson, and cannot open admin", async ({
  page,
  context,
}) => {
  await loginAs(context, "student1@example.com");
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Vishnu / Learn", exact: true }),
  ).toHaveText("v.");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Aarav");
  await expect(
    page.getByText("SQL from Zero to Interview").first(),
  ).toBeVisible();
  const lesson = (
    await pool.query(
      "SELECT l.id FROM lessons l JOIN modules m ON m.id=l.module_id JOIN courses c ON c.id=m.course_id WHERE c.slug='sql-from-zero-to-interview' AND l.published ORDER BY m.position,l.position LIMIT 1",
    )
  ).rows[0];
  await page.goto(`/learn/sql-from-zero-to-interview/${lesson.id}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const mark = page.getByRole("button", { name: "Mark complete" });
  if (await mark.isVisible()) await mark.click();
  await expect(
    page.getByRole("button", { name: "Lesson complete" }),
  ).toBeDisabled();
  expect((await context.request.get("/api/admin")).status()).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/tutor\/login/);
});
test("notes are visible only to their enrolled batch", async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await loginAs(a, "student1@example.com");
  await loginAs(b, "student8@example.com");
  const note = (
    await pool.query(
      "SELECT id FROM class_notes WHERE status='published' ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  expect((await a.request.get(`/api/notes/${note.id}`)).status()).toBe(200);
  expect((await b.request.get(`/api/notes/${note.id}`)).status()).toBe(403);
  await a.close();
  await b.close();
});
test("profile customization persists and respects privacy", async ({
  page,
  context,
}) => {
  await loginAs(context, "student2@example.com");
  await page.goto("/settings/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Style", exact: true }).click();
  await page.getByRole("button", { name: "Blueprint", exact: true }).click();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Your profile is updated")).toBeVisible();
  const response = await context.request.get("/api/profile");
  expect((await response.json()).theme.name).toBe("Blueprint");
  await page.goto("/u/diya");
  await expect(
    page.getByRole("heading", { name: "Diya Reddy", exact: true }),
  ).toBeVisible();
});
test("instructor opens builder and report; admin opens revenue", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await loginAs(context, "instructor@example.com");
  const page = await context.newPage();
  await page.goto("/teach");
  await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
  await page
    .getByRole("link")
    .filter({ hasText: "SQL from Zero to Interview" })
    .click();
  await expect(
    page.getByRole("link", { name: "Preview as student" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The foundations", exact: true }),
  ).toBeVisible();
  const session = (
    await pool.query(
      "SELECT id FROM live_sessions WHERE ended_at IS NOT NULL LIMIT 1",
    )
  ).rows[0];
  await page.goto(`/teach/live/${session.id}/report`);
  await expect(
    page.getByRole("heading", { name: "Attendance", exact: true }),
  ).toBeVisible();
  await context.close();
  const admin = await browser.newContext();
  await loginAs(admin, "admin-e2e@example.com", true);
  const ap = await admin.newPage();
  await ap.goto("/admin");
  await expect(
    ap.getByRole("heading", { name: "Administration", exact: true }),
  ).toBeVisible();
  await expect(
    ap.getByRole("heading", { name: "Revenue by month" }),
  ).toBeVisible();
  await admin.close();
});

test("admin creates a batch and a priced offering shown on the course page", async ({
  browser,
}) => {
  const stamp = Date.now();
  const batch = `E2E batch ${stamp}`;
  const offering = `E2E offering ${stamp}`;
  const admin = await browser.newContext();
  await loginAs(admin, "admin-e2e@example.com", true);
  const page = await admin.newPage();
  try {
    await page.goto("/admin");
    await page.getByRole("button", { name: "+ Batch", exact: true }).click();
    const batchDialog = page.getByRole("dialog");
    await batchDialog
      .getByLabel("Course", { exact: true })
      .selectOption({ label: "SQL from Zero to Interview" });
    await batchDialog
      .getByLabel("Batch name, e.g. Weekend SQL — Oct")
      .fill(batch);
    await expect(batchDialog.getByLabel("Capacity")).toHaveCount(0);
    await batchDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(batchDialog).not.toBeVisible();
    await expect(page.getByRole("cell", { name: `⚡ ${batch}` })).toBeVisible();

    await page.getByRole("button", { name: "+ Offering", exact: true }).click();
    const offerDialog = page.getByRole("dialog");
    await offerDialog
      .getByLabel("Course", { exact: true })
      .selectOption({ label: "SQL from Zero to Interview" });
    await offerDialog
      .getByLabel("Batch (optional; enrols into this batch)")
      .selectOption({ label: `SQL from Zero to Interview · ${batch}` });
    await offerDialog.getByLabel("Title shown to students").fill(offering);
    await offerDialog
      .getByLabel("Price in ₹ (0 = free, enrols directly)")
      .fill("1499");
    await expect(
      offerDialog.getByLabel("Seats (blank = unlimited)"),
    ).toHaveCount(0);
    await offerDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(offerDialog).not.toBeVisible();
    await expect(page.getByRole("cell", { name: offering })).toBeVisible();

    const saved = (
      await pool.query(
        "SELECT o.price_inr FROM offerings o JOIN sections s ON s.id=o.section_id WHERE o.title=$1",
        [offering],
      )
    ).rows[0];
    expect(saved).toEqual({ price_inr: 149900 });
    const audits = (
      await pool.query(
        "SELECT count(*)::int n FROM audit_log WHERE action IN ('section.create','offering.create') AND at > now() - interval '5 minutes'",
      )
    ).rows[0];
    expect(audits.n).toBeGreaterThanOrEqual(2);

    await page.goto("/courses/sql-from-zero-to-interview");
    await expect(page.getByText(offering)).toBeVisible();
    await expect(page.getByText("₹1,499").first()).toBeVisible();
  } finally {
    await pool.query("DELETE FROM offerings WHERE title=$1", [offering]);
    await pool.query("DELETE FROM sections WHERE name=$1", [batch]);
    await admin.close();
  }
});
