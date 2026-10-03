import { describe, expect, it } from "vitest";
import {
  atRisk,
  can,
  confusionSummary,
  contrastText,
  couponAmount,
  pickStudent,
  themeSchema,
  type Action,
  type Actor,
  type Resource,
} from "@edu/shared";

// ---------------------------------------------------------------------------
// can(): the full role/permission matrix
// ---------------------------------------------------------------------------
const member = (
  id: string,
  role: "instructor" | "student",
  sectionId = "batch-a",
): Actor => ({
  id,
  isAdmin: false,
  memberships: [{ courseId: "course", role, sectionId }],
});
const people: Record<string, Actor | null> = {
  admin: { id: "admin", isAdmin: true, memberships: [] },
  instructor: member("instructor", "instructor"),
  student: member("student", "student"),
  outsider: {
    id: "outsider",
    isAdmin: false,
    memberships: [
      { courseId: "other-course", role: "student", sectionId: "x" },
    ],
  },
  visitor: null,
};
const batch: Resource = { courseId: "course", sectionId: "batch-a" };
const otherBatch: Resource = { courseId: "course", sectionId: "batch-b" };
const Y = true,
  N = false;

// [action, resource, admin, instructor, student, outsider, visitor]
const matrix: [string, Action, Resource, ...boolean[]][] = [
  ["manage site", "site:manage", {}, Y, N, N, N, N],
  ["manage staff", "staff:manage", {}, Y, N, N, N, N],
  ["manage prices/coupons", "commerce:manage", {}, Y, N, N, N, N],
  ["create a course", "course:create", {}, Y, Y, N, N, N],
  ["edit course content", "course:edit", batch, Y, Y, N, N, N],
  ["run live session", "live:manage", batch, Y, Y, N, N, N],
  ["run another batch's live", "live:manage", otherBatch, Y, Y, N, N, N],
  ["manage leagues", "league:manage", batch, Y, Y, N, N, N],
  ["batch analytics", "analytics:read", batch, Y, Y, N, N, N],
  ["other batch analytics", "analytics:read", otherBatch, Y, Y, N, N, N],
  [
    "own analytics",
    "analytics:read",
    { ...batch, userId: "student" },
    Y,
    Y,
    Y,
    N,
    N,
  ],
  [
    "published lesson",
    "content:read",
    { ...batch, published: true },
    Y,
    Y,
    Y,
    N,
    N,
  ],
  [
    "draft lesson (staff preview)",
    "content:read",
    { ...batch, published: false },
    Y,
    Y,
    N,
    N,
    N,
  ],
  [
    "free preview lesson",
    "content:read",
    { ...batch, published: true, freePreview: true },
    Y,
    Y,
    Y,
    N,
    Y,
  ],
  [
    "other batch's notes",
    "content:read",
    { ...otherBatch, published: true },
    Y,
    Y,
    N,
    N,
    N,
  ],
  ["join own batch live", "live:join", batch, Y, Y, Y, N, N],
  ["join another batch live", "live:join", otherBatch, Y, Y, N, N, N],
  [
    "join live open to all batches",
    "live:join",
    { courseId: "course", sectionId: null },
    Y,
    Y,
    Y,
    N,
    N,
  ],
  ["own account", "account:manage", { userId: "student" }, N, N, Y, N, N],
  [
    "private profile",
    "profile:read",
    { userId: "student", visibility: "private" },
    N,
    N,
    Y,
    N,
    N,
  ],
  [
    "students-only profile",
    "profile:read",
    { userId: "student", visibility: "students_only" },
    Y,
    Y,
    Y,
    Y,
    N,
  ],
  [
    "public profile",
    "profile:read",
    { userId: "student", visibility: "public" },
    Y,
    Y,
    Y,
    Y,
    Y,
  ],
];

describe("can() permission matrix", () => {
  const names = Object.keys(people);
  it.each(
    matrix.flatMap(([label, action, resource, ...expected]) =>
      names.map(
        (who, i) => [label, who, action, resource, expected[i]] as const,
      ),
    ),
  )("%s · %s", async (_label, who, action, resource, expected) => {
    expect(await can(people[who], action, resource)).toBe(expected);
  });

  it("locks lessons until their module release date, except for staff", async () => {
    const later = {
      ...batch,
      published: true,
      releaseAt: new Date(Date.now() + 864e5),
    };
    expect(await can(people.student, "content:read", later)).toBe(false);
    expect(await can(people.instructor, "content:read", later)).toBe(true);
    const past = { ...later, releaseAt: new Date(Date.now() - 1000) };
    expect(await can(people.student, "content:read", past)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("coupon math", () => {
  it("applies percent off to paise and rounds once", () => {
    expect(couponAmount(299900, 0)).toBe(299900);
    expect(couponAmount(299900, 100)).toBe(0);
    expect(couponAmount(99900, 33)).toBe(66933);
  });
  it("rejects invalid prices and percentages", () => {
    for (const [amount, pct] of [
      [-1, 10],
      [100.5, 10],
      [1000, -5],
      [1000, 101],
    ])
      expect(() => couponAmount(amount, pct)).toThrow();
  });
});

describe("at-risk rules", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const healthy = {
    attendance: 90,
    lastActivity: new Date("2026-09-25T12:00:00Z"),
  };
  it("flags nobody healthy", () => expect(atRisk(healthy, now)).toEqual([]));
  it.each([
    [{ attendance: 59 }, "Attendance below 60%"],
    [
      { lastActivity: new Date("2026-09-18T12:00:00Z") },
      "No activity in seven days",
    ],
    [{ lastActivity: null }, "No activity in seven days"],
  ])("flags %o", (change, reason) =>
    expect(atRisk({ ...healthy, ...change }, now)).toEqual([reason]),
  );
  it("does not flag missing attendance data as failing", () =>
    expect(atRisk({ ...healthy, attendance: null }, now)).toEqual([]));
  it("lists every reason that applies", () =>
    expect(atRisk({ attendance: 20, lastActivity: null }, now)).toHaveLength(
      2,
    ));
});

describe("cold-call fairness", () => {
  function seeded(seed: number) {
    return () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  }
  it("favours students picked least in the last 14 days", () => {
    const random = seeded(42);
    const students = [
      { id: "fresh", picks: 0, connected: true, skip: false },
      { id: "busy", picks: 3, connected: true, skip: false },
    ];
    const counts = { fresh: 0, busy: 0 } as Record<string, number>;
    for (let i = 0; i < 10000; i++) counts[pickStudent(students, random)!]++;
    // Weights 1 and 1/4 → expected share 80% / 20%.
    expect(counts.fresh / 10000).toBeGreaterThan(0.77);
    expect(counts.fresh / 10000).toBeLessThan(0.83);
  });
  it("never picks disconnected or skipped students, and returns null when nobody is eligible", () => {
    const random = seeded(7);
    const students = [
      { id: "away", picks: 0, connected: false, skip: false },
      { id: "skipped", picks: 0, connected: true, skip: true },
      { id: "here", picks: 50, connected: true, skip: false },
    ];
    for (let i = 0; i < 200; i++)
      expect(pickStudent(students, random)).toBe("here");
    expect(pickStudent(students.slice(0, 2), random)).toBeNull();
  });
});

describe("profile safety", () => {
  const valid = {
    name: "Forest",
    accent: "#2f6b3a",
    background: "solid",
    font: "sans",
    radius: 12,
    card: "glass",
  };
  it("accepts a curated theme and rejects unknown keys or unsafe values", () => {
    expect(themeSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, fontUrl: "https://evil.example/font.woff" },
      { ...valid, accent: "red; background:url(x)" },
      { ...valid, name: "Hacker" },
      { ...valid, radius: 999 },
    ])
      expect(themeSchema.safeParse(bad).success).toBe(false);
  });
  it("always picks a text colour with at least WCAG AA contrast", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = hex
        .slice(1)
        .match(/../g)!
        .map((v) => {
          const n = parseInt(v, 16) / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (let i = 0; i < 4096; i++) {
      const bg = "#" + (i * 4099).toString(16).padStart(6, "0").slice(-6);
      const [a, b] = [luminance(bg), luminance(contrastText(bg))].sort(
        (x, y) => y - x,
      );
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("exit-ticket confusion summary", () => {
  it("groups repeated keywords without AI and ignores filler words", () => {
    const summary = confusionSummary([
      "What about window functions?",
      "window frames confused me",
      "The window partition part",
      "joins",
    ]);
    expect(summary[0]).toEqual({ topic: "window", count: 3 });
    expect(summary.map((s) => s.topic)).not.toContain("about");
  });
});
