import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { loginAs } from "./auth";

const pool = new Pool({
  // Owner connection: assertions read RLS-protected tables without a user context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());

test("instructor publishes class notes; the batch is notified, another batch gets 403", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const title = `Window functions recap ${Date.now()}`;
  const [course] = (
    await pool.query(
      "SELECT c.id,s.id section_id,s.name section_name FROM courses c JOIN sections s ON s.course_id=c.id WHERE c.slug='sql-from-zero-to-interview' AND s.name='Weekend SQL · October'",
    )
  ).rows;
  const tutor = await browser.newContext();
  const inBatch = await browser.newContext();
  const otherBatch = await browser.newContext();
  let noteId: string | undefined;
  try {
    await loginAs(tutor, "instructor@example.com");
    const student = await loginAs(inBatch, "student1@example.com");
    await loginAs(otherBatch, "student8@example.com");

    const tp = await tutor.newPage();
    await tp.goto(`/teach/courses/${course.id}/notes`);
    await tp.getByRole("button", { name: "+ Class notes" }).click();
    const dialog = tp.getByRole("dialog");
    await dialog.getByLabel("Note title").fill(title);
    await dialog
      .getByLabel("Batch")
      .selectOption({ label: course.section_name });
    await dialog
      .getByLabel("Notes · HTML", { exact: true })
      .fill(
        "<h2>Ranking rows</h2><pre><code>SELECT name, rank() OVER (ORDER BY salary DESC) FROM employees;</code></pre><script>alert(1)</script>",
      );
    await dialog.getByLabel("Publish options").selectOption("published");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible();

    // Publishing runs in the worker (creates the lesson, sends notifications).
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT id,status FROM class_notes WHERE title=$1",
              [title],
            )
          ).rows[0]?.status,
        { timeout: 30000 },
      )
      .toBe("published");
    noteId = (
      await pool.query("SELECT id FROM class_notes WHERE title=$1", [title])
    ).rows[0].id;

    // Enrolled batch: listed, readable, and notified.
    const sp = await inBatch.newPage();
    await sp.goto("/notes");
    await sp.getByRole("link", { name: new RegExp(title) }).click();
    await expect(
      sp.getByRole("heading", { name: "Ranking rows" }),
    ).toBeVisible();
    await expect(sp.getByText("rank() OVER")).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='notes' AND link=$2",
              [student.id, `/notes/${noteId}`],
            )
          ).rows[0].n,
        { timeout: 30000 },
      )
      .toBe(1);
    await sp.goto("/dashboard");
    await expect(sp.getByText(title).first()).toBeVisible();

    // Other batch of the same course: not listed and forbidden.
    expect(
      (await otherBatch.request.get(`/api/notes/${noteId}`)).status(),
    ).toBe(403);
    const op = await otherBatch.newPage();
    await op.goto("/notes");
    await expect(
      op.getByRole("heading", { name: "Class notes" }),
    ).toBeVisible();
    await expect(op.getByText(title)).toHaveCount(0);
  } finally {
    await Promise.all([tutor, inBatch, otherBatch].map((c) => c.close()));
    if (noteId) {
      const [n] = (
        await pool.query("SELECT lesson_id FROM class_notes WHERE id=$1", [
          noteId,
        ])
      ).rows;
      await pool.query("DELETE FROM notifications WHERE link=$1", [
        `/notes/${noteId}`,
      ]);
      await pool.query("DELETE FROM class_note_reads WHERE note_id=$1", [
        noteId,
      ]);
      await pool.query("DELETE FROM class_notes WHERE id=$1", [noteId]);
      if (n?.lesson_id) {
        await pool.query("DELETE FROM lesson_progress WHERE lesson_id=$1", [
          n.lesson_id,
        ]);
        await pool.query("DELETE FROM lessons WHERE id=$1", [n.lesson_id]);
      }
    }
  }
});
