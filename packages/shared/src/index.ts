import { z } from "zod";
export * from "./live-events";
export type Role = "instructor" | "student";
export type Actor = {
  id: string;
  isAdmin: boolean;
  memberships: { courseId: string; role: Role; sectionId: string | null }[];
};
export type Resource = {
  courseId?: string;
  sectionId?: string | null;
  userId?: string;
  published?: boolean;
  freePreview?: boolean;
  releaseAt?: Date | null;
  visibility?: string;
};
export type Action =
  | "public:read"
  | "site:manage"
  | "staff:manage"
  | "commerce:manage"
  | "course:create"
  | "course:edit"
  | "content:read"
  | "live:join"
  | "live:manage"
  | "live:respond"
  | "analytics:read"
  | "profile:read"
  | "profile:edit"
  | "account:manage"
  | "league:manage";
export async function can(
  user: Actor | null,
  action: Action,
  r: Resource = {},
): Promise<boolean> {
  if (action === "public:read") return r.published !== false;
  if (action === "profile:read")
    return (
      r.visibility === "public" ||
      (!!user && (r.userId === user.id || r.visibility === "students_only"))
    );
  if (!user)
    return (
      action === "content:read" &&
      r.published === true &&
      r.freePreview === true &&
      (!r.releaseAt || r.releaseAt <= new Date())
    );
  if (["profile:edit", "account:manage"].includes(action))
    return r.userId === user.id;
  if (user.isAdmin) return true;
  if (["site:manage", "staff:manage", "commerce:manage"].includes(action))
    return false;
  if (action === "course:create")
    return user.memberships.some((m) => m.role === "instructor");
  const m = user.memberships.find((m) => m.courseId === r.courseId);
  if (!m) return false;
  const staff = m.role === "instructor";
  const batch = !r.sectionId || staff || m.sectionId === r.sectionId;
  if (["course:edit", "live:manage", "league:manage"].includes(action))
    return staff;
  if (action === "analytics:read")
    return batch && (staff || r.userId === user.id);
  if (action === "content:read")
    return (
      batch &&
      (staff ||
        (r.published === true && (!r.releaseAt || r.releaseAt <= new Date())))
    );
  if (["live:join", "live:respond"].includes(action)) return batch;
  return false;
}
export const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
export const dateTime = (value: string | Date, timezone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
export function couponAmount(amount: number, percent: number) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    percent < 0 ||
    percent > 100
  )
    throw new Error("Invalid price");
  return Math.round((amount * (100 - percent)) / 100);
}
export function atRisk(
  s: {
    attendance: number | null;
    lastActivity: Date | null;
  },
  now = new Date(),
) {
  return [
    s.attendance !== null && s.attendance < 60 ? "Attendance below 60%" : null,
    !s.lastActivity || now.getTime() - s.lastActivity.getTime() > 7 * 864e5
      ? "No activity in seven days"
      : null,
  ].filter(Boolean);
}
export function assertTestAuth(env: Record<string, string | undefined>) {
  if (env.E2E_AUTH_BYPASS === "1" && env.NODE_ENV === "production")
    throw new Error("Test authentication cannot run in production");
  return env.NODE_ENV === "test" && env.E2E_AUTH_BYPASS === "1";
}
export function googleIdentity(
  email: string,
  verified: boolean,
  admins: string,
  invite?: Role,
) {
  if (!verified) throw new Error("A verified Google email is required");
  return {
    isAdmin: admins
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .includes(email.toLowerCase()),
    staffRole: invite ?? null,
  };
}
export const courseSchema = z
  .object({
    title: z.string().min(3).max(180),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    track_id: z.string().uuid(),
    subtitle: z.string().max(240),
    description_md: z.string().max(100000),
    visibility: z.enum(["draft", "published", "archived"]),
    // Show the reader's email in the class-notes footer (discourages redistribution).
    stamp_email: z.boolean().optional(),
  })
  .strict();
export const lessonSchema = z
  .object({
    module_id: z.string().uuid(),
    title: z.string().min(1).max(180),
    type: z.enum(["html", "file"]),
    // Sanitised on the server before it is stored (see apps/web/src/server/html.ts).
    body_html: z.string().max(500000),
    position: z.number().int().min(0),
    published: z.boolean(),
    is_free_preview: z.boolean(),
  })
  .strict();
export const noteSchema = z
  .object({
    course_id: z.string().uuid(),
    section_id: z.string().uuid().nullable(),
    live_session_id: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(180),
    body_html: z.string().max(500000),
    status: z.enum(["draft", "scheduled", "published"]),
    publish_at: z.string().datetime().nullable().optional(),
    // When editing published notes: send "Notes updated" to the batch again.
    renotify: z.boolean().optional(),
  })
  .strict();
export const profileThemes = [
  "Terminal",
  "Neon",
  "Paper",
  "Pastel",
  "Blueprint",
  "Retro",
  "Mono",
  "Sunset",
  "Matrix",
  "Chalkboard",
  "Space",
  "Forest",
] as const;
export const themeSchema = z
  .object({
    name: z.enum(profileThemes),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.enum(["solid", "gradient", "pattern"]),
    font: z.enum([
      "sans",
      "serif",
      "mono",
      "rounded",
      "editorial",
      "technical",
    ]),
    radius: z.number().min(0).max(32),
    card: z.enum(["flat", "glass", "outlined", "brutalist"]),
  })
  .strict();
export const layoutSchema = z
  .object({
    columns: z.union([z.literal(1), z.literal(2)]),
    sections: z
      .array(
        z.enum([
          "about",
          "courses",
          "league",
          "activity",
          "links",
          "pinned",
          "learning",
        ]),
      )
      .max(8)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export function contrastText(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const n = parseInt(v, 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return (l + 0.05) / 0.05 >= 4.5 ? "#000000" : "#ffffff";
}
export const profileSchema = z
  .object({
    handle: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9_-]+$/)
      .refine(
        (v) => !/(fuck|shit|admin|support)/i.test(v),
        "Choose another handle",
      ),
    display_name: z.string().min(1).max(80),
    headline: z.string().max(160),
    bio_md: z.string().max(5000),
    location: z.string().max(80),
    links: z
      .array(
        z
          .object({
            label: z.string().max(40),
            url: z
              .string()
              .url()
              .refine((v) => v.startsWith("https://")),
          })
          .strict(),
      )
      .max(8),
    visibility: z.enum(["public", "students_only", "private"]),
    theme: themeSchema,
    layout: layoutSchema,
    currently_learning: z.array(z.string().max(30)).max(10),
    pinned_items: z
      .array(
        z
          .object({
            type: z.enum(["course"]),
            id: z.string().uuid(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export function pickStudent(
  students: { id: string; picks: number; connected: boolean; skip: boolean }[],
  random = Math.random,
) {
  const eligible = students.filter((s) => s.connected && !s.skip);
  const sum = eligible.reduce((n, s) => n + 1 / (1 + s.picks), 0);
  let n = random() * sum;
  return (
    eligible.find((s) => (n -= 1 / (1 + s.picks)) < 0)?.id ??
    eligible.at(-1)?.id ??
    null
  );
}
export const isConfused = (at: Date, cleared: Date | null, now = new Date()) =>
  !cleared && now.getTime() - at.getTime() < 180000;
export const completeAttendance = (required: boolean, submitted: boolean) =>
  !required || submitted;
export function leagueRank(
  rows: { id: string; points: number; members: number }[],
) {
  return rows
    .map((r) => ({ ...r, perCapita: r.points / Math.max(1, r.members) }))
    .sort((a, b) => b.perCapita - a.perCapita);
}
export function cappedPoints(earned: number, requested: number, cap: number) {
  return Math.max(0, Math.min(requested, cap - earned));
}
export function confusionSummary(texts: string[]) {
  const groups = new Map<string, number>();
  for (const text of texts) {
    for (const word of new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])) {
      if (
        ![
          "this",
          "that",
          "with",
          "about",
          "understand",
          "confused",
          "what",
          "have",
          "were",
          "from",
        ].includes(word)
      )
        groups.set(word, (groups.get(word) ?? 0) + 1);
    }
  }
  return [...groups]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([topic, count]) => ({ topic, count }));
}

/**
 * Razorpay Checkout display config: UPI is the primary method, shown first as its own block
 * (app intent on phones, QR code on desktop). Cards and netbanking remain available below.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/configure-payment-methods/
 */
export const razorpayCheckoutConfig = {
  display: {
    blocks: {
      upi: {
        name: "Pay with UPI (GPay, PhonePe, Paytm, BHIM)",
        instruments: [{ method: "upi" }],
      },
    },
    sequence: ["block.upi"],
    preferences: { show_default_blocks: true },
  },
} as const;

// Stable heading ids so a table of contents can link to sections of HTML notes.
export const slugify = (text: string) =>
  "h-" +
  text
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};
/** h2/h3 headings of sanitised HTML (which carries the ids; see cleanHtml). */
export function htmlOutline(html: string) {
  return [
    ...html.matchAll(/<(h[23])[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g),
  ].map(([, tag, id, inner]) => ({
    level: tag === "h2" ? 2 : 3,
    id,
    text: inner
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z0-9#]+;/g, (e) => entities[e] ?? " ")
      .trim(),
  }));
}
