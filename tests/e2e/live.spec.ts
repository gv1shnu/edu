import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { loginAs } from "./auth";
const pool = new Pool({
  // Owner connection: assertions read RLS-protected tables without a user context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());
test("live poll, chat pause, anonymous confusion and required exit ticket", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const tutor = await browser.newContext();
  const students = await Promise.all(
    [1, 2, 3].map(async (i) => {
      const c = await browser.newContext();
      await loginAs(c, `student${i}@example.com`);
      return c;
    }),
  );
  await loginAs(tutor, "instructor@example.com");
  const course = (
    await pool.query(
      "SELECT c.id,s.id section_id FROM courses c JOIN sections s ON s.course_id=c.id JOIN course_members m ON m.section_id=s.id JOIN users u ON u.id=m.user_id WHERE u.email='student1@example.com' AND c.slug='sql-from-zero-to-interview'",
    )
  ).rows[0];
  const response = await tutor.request.post("/api/live", {
    data: {
      courseId: course.id,
      sectionId: course.section_id,
      title: `Live acceptance ${Date.now()}`,
    },
    headers: { origin: "http://localhost:3000" },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  const tp = await tutor.newPage();
  const sp = await Promise.all(students.map((c) => c.newPage()));
  try {
    await tp.goto(`/live/${id}/present`);
    await Promise.all(sp.map((p) => p.goto(`/live/${id}`)));
    await expect(
      tp.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    for (const p of sp)
      await expect(
        p.getByRole("textbox", { name: "Chat message" }),
      ).toBeEnabled();
    await expect(
      tp.getByRole("button", {
        name: /I’m lost|Still a little lost|Too slow|Just right|Too fast/,
      }),
    ).toHaveCount(0);
    await expect(tp.locator(".engagement-count")).toContainText("of 3 lost");
    await tp.getByRole("button", { name: "Pick someone", exact: true }).click();
    await expect(tp.locator(".coldcall-wheel")).toHaveClass(/spinning/);
    await expect(tp.locator(".coldcall-wheel")).toHaveCSS(
      "animation-name",
      "coldcall-spin",
    );
    await expect(tp.locator(".coldcall-picker")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(tp.locator('.coldcall-picker [role="status"]')).toHaveText(
      /Aarav|Diya|Arjun/,
    );
    await tp.emulateMedia({ reducedMotion: "reduce" });
    await tp.getByRole("button", { name: "Pick someone", exact: true }).click();
    await expect(tp.locator(".coldcall-picker")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(tp.locator(".coldcall-wheel")).toHaveCSS(
      "animation-name",
      "none",
    );
    await tp.getByRole("button", { name: "+ New poll", exact: true }).click();
    await tp
      .getByPlaceholder("What should we check?")
      .fill("Which join keeps every left row?");
    await tp.getByRole("button", { name: "Launch poll", exact: true }).click();
    for (const p of sp.slice(0, 2)) {
      await expect(
        p.getByText("Which join keeps every left row?"),
      ).toBeVisible();
      await p.getByRole("button", { name: "A", exact: true }).click();
    }
    await expect(tp.getByText("2 responses", { exact: true })).toBeVisible();
    await tp.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      sp[0].getByRole("textbox", { name: "Chat message" }),
    ).toBeDisabled();
    await tp.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      sp[0].getByRole("textbox", { name: "Chat message" }),
    ).toBeEnabled();
    await sp[0]
      .getByRole("textbox", { name: "Chat message" })
      .fill("Now the join makes sense");
    await sp[0]
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      tp.getByText("Now the join makes sense", { exact: true }),
    ).toBeVisible();
    for (const p of sp) {
      const lost = p.getByRole("button", {
        name: "I’m lost · a little help?",
        exact: true,
      });
      await expect(lost).toHaveAttribute("aria-pressed", "false");
      await lost.click();
      await expect(
        p.getByRole("button", { name: /Still a little lost/ }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await expect(tp.locator(".engagement-count")).toContainText("3");
    await tp
      .getByRole("button", { name: "Add exit ticket", exact: true })
      .click();
    await tp
      .getByRole("button", { name: "Require this exit ticket", exact: true })
      .click();
    await tp.getByRole("button", { name: "End class", exact: true }).click();
    await expect(sp[0].getByRole("dialog")).toBeVisible();
    const before = (
      await pool.query(
        "SELECT attendance_complete FROM session_participants p JOIN users u ON u.id=p.user_id WHERE session_id=$1 AND u.email='student1@example.com'",
        [id],
      )
    ).rows[0];
    expect(before.attendance_complete).toBe(false);
    await sp[0]
      .getByRole("textbox", { name: "Exit ticket answer" })
      .fill("LEFT JOIN keeps every row from the left table.");
    await sp[0]
      .getByRole("button", { name: "Share & finish", exact: true })
      .click();
    await expect(sp[0].getByRole("dialog")).not.toBeVisible();
    await sp[0].reload();
    await expect(
      sp[0].getByRole("textbox", { name: "Chat message" }),
    ).toBeVisible();
    await expect(sp[0].getByRole("dialog")).not.toBeVisible();
    const after = (
      await pool.query(
        "SELECT attendance_complete FROM session_participants p JOIN users u ON u.id=p.user_id WHERE session_id=$1 AND u.email='student1@example.com'",
        [id],
      )
    ).rows[0];
    expect(after.attendance_complete).toBe(true);
    const report = await (await tutor.request.get(`/api/reports/${id}`)).json();
    expect(report.attendance).toHaveLength(3);
    expect(report.attendance.map((r: any) => r.name)).not.toContain(
      "Demo Instructor",
    );
    await tp.goto(`/teach/live/${id}/report`);
    const attendance = tp.locator(".panel").filter({
      has: tp.getByRole("heading", { name: "Attendance", exact: true }),
    });
    await expect(
      attendance.getByRole("cell", { name: "Complete", exact: true }),
    ).toHaveCount(1);
    await expect(
      attendance.getByRole("cell", { name: "Incomplete", exact: true }),
    ).toHaveCount(2);
    const minuteCells = await attendance
      .locator("tbody tr td:nth-child(2)")
      .allTextContents();
    expect(minuteCells).toHaveLength(3);
    for (const value of minuteCells) expect(value).toMatch(/^\d+\.\d$/);
  } finally {
    await pool.query(
      "UPDATE live_sessions SET ended_at=coalesce(ended_at,now()) WHERE id=$1",
      [id],
    );
    await Promise.all([tutor, ...students].map((c) => c.close()));
  }
});
