import { describe, it, expect } from "vitest";
import {
  can,
  couponAmount,
  atRisk,
  googleIdentity,
  assertTestAuth,
  themeSchema,
  contrastText,
  pickStudent,
  isConfused,
  completeAttendance,
  leagueRank,
  cappedPoints,
  htmlOutline,
  lessonSchema,
  type Actor,
} from "@edu/shared";
import { cleanHtml } from "../../apps/web/src/server/html";

const actor = (role: "student" | "instructor", admin = false): Actor => ({
  id: "u",
  isAdmin: admin,
  memberships: [{ courseId: "c", role, sectionId: "b" }],
});

describe("authorization", () => {
  it.each(["student", "instructor"] as const)(
    "keeps %s out of site management",
    async (role) => expect(await can(actor(role), "site:manage")).toBe(false),
  );
  it("allows admin", async () =>
    expect(await can(actor("student", true), "site:manage")).toBe(true));
  it("lets only instructors run classes and edit courses", async () => {
    expect(
      await can(actor("instructor"), "live:manage", {
        courseId: "c",
        sectionId: "other",
      }),
    ).toBe(true);
    expect(await can(actor("student"), "live:manage", { courseId: "c" })).toBe(
      false,
    );
    expect(await can(actor("student"), "course:edit", { courseId: "c" })).toBe(
      false,
    );
  });
  it("locks private profiles even for admins", async () =>
    expect(
      await can(actor("student", true), "profile:read", {
        userId: "other",
        visibility: "private",
      }),
    ).toBe(false));
  it("allows only published free preview to visitors", async () => {
    expect(
      await can(null, "content:read", { published: true, freePreview: true }),
    ).toBe(true);
    expect(
      await can(null, "content:read", { published: false, freePreview: true }),
    ).toBe(false);
  });
});

describe("business rules", () => {
  it("uses paise and rounds once", () =>
    expect(couponAmount(299900, 15)).toBe(254915));
  it("identifies at risk", () =>
    expect(atRisk({ attendance: 50, lastActivity: null })).toHaveLength(2));
  it("auth requires verified email", () =>
    expect(() =>
      googleIdentity("owner@test.com", false, "owner@test.com"),
    ).toThrow());
  it("admin assignment tracks allowlist", () => {
    expect(
      googleIdentity("OWNER@test.com", true, "owner@test.com").isAdmin,
    ).toBe(true);
    expect(googleIdentity("owner@test.com", true, "").isAdmin).toBe(false);
  });
  it("cannot enable test auth in production", () =>
    expect(() =>
      assertTestAuth({ NODE_ENV: "production", E2E_AUTH_BYPASS: "1" }),
    ).toThrow());
});

describe("HTML lessons and notes", () => {
  it("strips scripts, frames, handlers and unsafe links", () => {
    const html = cleanHtml(
      '<p onclick="x()">Hi<script>alert(1)</script></p><iframe src="https://www.youtube.com/embed/x"></iframe><a href="javascript:alert(1)">bad</a><img src="x" onerror="y()">',
    );
    expect(html).not.toMatch(/script|iframe|onclick|onerror|javascript:/);
    expect(html).toContain("<p>Hi</p>");
  });
  it("keeps formatting, tables, code and maths", () => {
    const html = cleanHtml(
      '<table><tr><td colspan="2"><code>SELECT 1</code></td></tr></table><math><mi>x</mi></math><p style="text-align:center;position:fixed">c</p>',
    );
    expect(html).toContain('<td colspan="2"><code>SELECT 1</code></td>');
    expect(html).toContain("<math><mi>x</mi></math>");
    expect(html).toContain('style="text-align:center"');
  });
  it("gives headings ids for the contents list", () => {
    const html = cleanHtml(
      '<h2 id="evil">Joins &amp; keys</h2><h3><em>Left</em> join</h3>',
    );
    expect(htmlOutline(html)).toEqual([
      { level: 2, id: "h-joins-keys", text: "Joins & keys" },
      { level: 3, id: "h-left-join", text: "Left join" },
    ]);
  });
  it("rejects video lessons", () =>
    expect(
      lessonSchema.safeParse({
        module_id: "00000000-0000-7000-8000-000000000001",
        title: "Recording",
        type: "video_embed",
        body_html: "",
        position: 0,
        published: true,
        is_free_preview: false,
      }).success,
    ).toBe(false));
});

describe("engagement and profiles", () => {
  it("expires confusion after 3 minutes", () =>
    expect(isConfused(new Date(Date.now() - 180001), null)).toBe(false));
  it("required exit ticket gates attendance", () =>
    expect(completeAttendance(true, false)).toBe(false));
  it("skips disconnected and skipped students", () =>
    expect(
      pickStudent(
        [
          { id: "a", picks: 0, connected: false, skip: false },
          { id: "b", picks: 0, connected: true, skip: true },
          { id: "c", picks: 3, connected: true, skip: false },
        ],
        () => 0,
      ),
    ).toBe("c"));
  it("ranks per-capita", () =>
    expect(
      leagueRank([
        { id: "small", points: 100, members: 5 },
        { id: "big", points: 300, members: 40 },
      ])[0].id,
    ).toBe("small"));
  it("caps daily points", () => expect(cappedPoints(9, 5, 10)).toBe(1));
  it("rejects custom CSS", () =>
    expect(
      themeSchema.safeParse({
        name: "Mono",
        accent: "#ffffff",
        background: "solid",
        font: "sans",
        radius: 8,
        card: "flat",
        css: "bad",
      }).success,
    ).toBe(false));
  it("chooses readable contrast", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#000000")).toBe("#ffffff");
  });
});
