import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { v7 } from "uuid";
import { loginAs } from "./auth";

const pool = new Pool({
  // Owner connection: fixtures and assertions bypass the app's RLS context.
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
test.afterAll(() => pool.end());

/** A small, valid PDF with the given number of pages (byte offsets computed for the xref). */
function pdf(pages: number) {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(
    " ",
  );
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 24 Tf 72 700 Td (Page ${i + 1} of the SQL recap) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
// 1×1 PNGs in two colours.
const png = (hex: string) =>
  Buffer.from(
    {
      red: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      blue: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==",
    }[hex]!,
    "base64",
  );

test("class notes reader: contents, PDF viewer, image lightbox, downloads and email stamp", async ({
  browser,
}) => {
  const [{ course_id, section_id, stamp_email }] = (
    await pool.query(
      "SELECT c.id course_id,c.stamp_email,s.id section_id FROM courses c JOIN sections s ON s.course_id=c.id WHERE c.slug='sql-from-zero-to-interview' AND s.name='Weekend SQL · October'",
    )
  ).rows;
  const note = v7();
  const tag = `reader-${Date.now()}`;
  await pool.query(
    `INSERT INTO class_notes(id,course_id,section_id,title,body_html,status,published_at,created_by,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,'published',now()-interval '2 hours',(SELECT id FROM users WHERE email='instructor@example.com'),now()-interval '2 hours',now())`,
    [
      note,
      course_id,
      section_id,
      `Window functions recap ${tag}`,
      "<h2>Ranking rows</h2><p>Use <code>rank()</code>.</p><h3>Ties</h3><p>Dense ranks skip nothing.</p><h2>Running totals</h2><pre><code>SELECT sum(x) OVER (ORDER BY d) FROM t;</code></pre>",
    ],
  );
  const files = [
    ["slides.pdf", "application/pdf", pdf(2)],
    ["whiteboard-1.png", "image/png", png("red")],
    ["whiteboard-2.png", "image/png", png("blue")],
    ["queries.sql", "application/sql", Buffer.from("SELECT 1;")],
  ] as const;
  for (const [i, [name, mime, body]] of files.entries())
    await pool.query(
      "INSERT INTO class_note_files(id,note_id,r2_key,filename,mime,size_bytes,position) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [v7(), note, `notes/${tag}/${name}`, name, mime, body.length, i],
    );
  await pool.query("UPDATE courses SET stamp_email=true WHERE id=$1", [
    course_id,
  ]);

  const context = await browser.newContext();
  // Stand-in for object storage: serve the pre-signed URLs the app hands out.
  await context.route("http://localhost:9000/**", (route) => {
    const file = files.find(([name]) =>
      route.request().url().includes(`/${tag}/${name}`),
    );
    return file
      ? route.fulfill({
          status: 200,
          contentType: file[1],
          body: file[2],
          headers: { "access-control-allow-origin": "*" },
        })
      : route.fulfill({ status: 404 });
  });
  const violations: string[] = [];
  try {
    await loginAs(context, "student1@example.com");
    const page = await context.newPage();
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/.test(m.text()))
        violations.push(m.text());
    });
    await page.goto(`/notes/${note}`);

    // Table of contents from the headings, linking to anchors.
    const toc = page.getByRole("navigation", { name: "On this page" });
    await expect(toc.getByRole("link")).toHaveText([
      "Ranking rows",
      "Ties",
      "Running totals",
    ]);
    await toc.getByRole("link", { name: "Running totals" }).click();
    await expect(page).toHaveURL(/#h-running-totals$/);
    await expect(page.locator("#h-running-totals")).toBeInViewport();

    // Edited after publishing → "Updated" badge.
    await expect(page.getByText(/^Updated /)).toBeVisible();

    // In-browser PDF viewer with paging.
    const viewer = page.getByRole("region", { name: "slides.pdf" });
    await expect(viewer.getByText("Page 1 of 2")).toBeVisible({
      timeout: 20000,
    });
    await expect(viewer.locator("canvas")).toBeVisible();
    await viewer.getByRole("button", { name: "Next page" }).click();
    await expect(viewer.getByText("Page 2 of 2")).toBeVisible();

    // Image lightbox with next/previous.
    await page
      .getByRole("button", { name: "Open image whiteboard-1.png" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("whiteboard-1.png (1 of 2)");
    await dialog.getByRole("button", { name: /Next/ }).click();
    await expect(dialog).toContainText("whiteboard-2.png (2 of 2)");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Non-previewable files download; previews don't count as downloads.
    await expect(
      page.getByRole("button", { name: "Download queries.sql" }),
    ).toBeVisible();
    const [read] = (
      await pool.query(
        "SELECT downloaded FROM class_note_reads r JOIN users u ON u.id=r.user_id WHERE r.note_id=$1 AND u.email='student1@example.com'",
        [note],
      )
    ).rows;
    expect(read.downloaded).toBe(false);

    // Optional email stamp in the footer.
    await expect(
      page.getByText("Shared with student1@example.com"),
    ).toBeVisible();
    expect(violations).toEqual([]);
  } finally {
    await context.close();
    await pool.query("UPDATE courses SET stamp_email=$2 WHERE id=$1", [
      course_id,
      stamp_email,
    ]);
    await pool.query("DELETE FROM class_note_reads WHERE note_id=$1", [note]);
    await pool.query("DELETE FROM class_note_files WHERE note_id=$1", [note]);
    await pool.query("DELETE FROM class_notes WHERE id=$1", [note]);
  }
});
