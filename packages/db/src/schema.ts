import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { v7 } from "uuid";
const base = () => ({
  id: uuid("id").primaryKey().$defaultFn(v7),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const users = pgTable(
  "users",
  {
    ...base(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    phone: text("phone"),
    isAdmin: boolean("is_admin").notNull().default(false),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (_t) => [],
);
export const sessions = pgTable(
  "sessions",
  {
    ...base(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);
export const accounts = pgTable(
  "accounts",
  {
    ...base(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);
export const verifications = pgTable(
  "verifications",
  {
    ...base(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (_t) => [],
);
export const staffInvites = pgTable(
  "staff_invites",
  {
    ...base(),
    courseAssignments: jsonb("course_assignments")
      .$type<{ courseId: string; sectionId: string | null }[]>()
      .notNull()
      .default([]),
    email: text("email").notNull().unique(),
    role: text("role").notNull(),
    invitedBy: uuid("invited_by")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("staff_invites_invited_by_idx").on(t.invitedBy)],
);
export const tracks = pgTable(
  "tracks",
  {
    ...base(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    accentColor: text("accent_color").notNull(),
    icon: text("icon").notNull(),
    description: text("description").notNull(),
  },
  (_t) => [],
);
export const courses = pgTable(
  "courses",
  {
    ...base(),
    trackId: uuid("track_id")
      .references((): AnyPgColumn => tracks.id)
      .notNull(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull(),
    descriptionMd: text("description_md").notNull(),
    coverR2Key: text("cover_r2_key"),
    visibility: text("visibility").notNull().default("draft"),
    ownerId: uuid("owner_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    stampEmail: boolean("stamp_email").notNull().default(false),
  },
  (t) => [
    index("courses_track_id_idx").on(t.trackId),
    index("courses_owner_id_idx").on(t.ownerId),
  ],
);
export const sections = pgTable(
  "sections",
  {
    ...base(),
    courseId: uuid("course_id")
      .references((): AnyPgColumn => courses.id)
      .notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    color: text("color").notNull().default("#4f46e5"),
    emoji: text("emoji").notNull().default("\u26a1"),
  },
  (t) => [index("sections_course_id_idx").on(t.courseId)],
);
export const courseMembers = pgTable(
  "course_members",
  {
    ...base(),
    courseId: uuid("course_id")
      .references((): AnyPgColumn => courses.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    role: text("role").notNull().default("student"),
    sectionId: uuid("section_id").references((): AnyPgColumn => sections.id),
    muted: boolean("muted").notNull().default(false),
    accessUntil: timestamp("access_until", { withTimezone: true }),
  },
  (t) => [
    index("course_members_course_id_idx").on(t.courseId),
    index("course_members_user_id_idx").on(t.userId),
    index("course_members_section_id_idx").on(t.sectionId),
    uniqueIndex("course_members_unique").on(t.courseId, t.userId),
  ],
);
export const modules = pgTable(
  "modules",
  {
    ...base(),
    courseId: uuid("course_id")
      .references((): AnyPgColumn => courses.id)
      .notNull(),
    sectionId: uuid("section_id").references((): AnyPgColumn => sections.id),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    releaseAt: timestamp("release_at", { withTimezone: true }),
  },
  (t) => [
    index("modules_course_id_idx").on(t.courseId),
    index("modules_section_id_idx").on(t.sectionId),
  ],
);
export const lessons = pgTable(
  "lessons",
  {
    ...base(),
    moduleId: uuid("module_id")
      .references((): AnyPgColumn => modules.id)
      .notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("html"),
    bodyHtml: text("body_html").notNull(),
    position: integer("position").notNull().default(0),
    published: boolean("published").notNull().default(false),
    isFreePreview: boolean("is_free_preview").notNull().default(false),
  },
  (t) => [index("lessons_module_id_idx").on(t.moduleId)],
);
export const attachments = pgTable(
  "attachments",
  {
    ...base(),
    lessonId: uuid("lesson_id")
      .references((): AnyPgColumn => lessons.id)
      .notNull(),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (t) => [index("attachments_lesson_id_idx").on(t.lessonId)],
);
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    ...base(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    lessonId: uuid("lesson_id")
      .references((): AnyPgColumn => lessons.id)
      .notNull(),
    status: text("status").notNull().default("not_started"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("lesson_progress_user_id_idx").on(t.userId),
    index("lesson_progress_lesson_id_idx").on(t.lessonId),
    uniqueIndex("lesson_progress_unique").on(t.userId, t.lessonId),
  ],
);
export const offerings = pgTable(
  "offerings",
  {
    ...base(),
    courseId: uuid("course_id")
      .references((): AnyPgColumn => courses.id)
      .notNull(),
    sectionId: uuid("section_id").references((): AnyPgColumn => sections.id),
    title: text("title").notNull(),
    priceInr: integer("price_inr").notNull(),
    billing: text("billing").notNull().default("one_time"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("offerings_course_id_idx").on(t.courseId),
    index("offerings_section_id_idx").on(t.sectionId),
  ],
);
export const orders = pgTable(
  "orders",
  {
    ...base(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    offeringId: uuid("offering_id")
      .references((): AnyPgColumn => offerings.id)
      .notNull(),
    amountPaise: integer("amount_paise").notNull(),
    couponCode: text("coupon_code"),
    razorpayOrderId: text("razorpay_order_id").unique(),
    razorpayPaymentId: text("razorpay_payment_id").unique(),
    status: text("status").notNull().default("created"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    receiptNumber: text("receipt_number"),
    failureReason: text("failure_reason"),
  },
  (t) => [
    index("orders_user_id_idx").on(t.userId),
    index("orders_offering_id_idx").on(t.offeringId),
  ],
);
export const coupons = pgTable(
  "coupons",
  {
    ...base(),
    code: text("code").notNull().unique(),
    percentOff: integer("percent_off").notNull(),
    maxUses: integer("max_uses").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
  },
  (_t) => [],
);
export const liveSessions = pgTable(
  "live_sessions",
  {
    ...base(),
    courseId: uuid("course_id")
      .references((): AnyPgColumn => courses.id)
      .notNull(),
    sectionId: uuid("section_id").references((): AnyPgColumn => sections.id),
    title: text("title").notNull(),
    startedBy: uuid("started_by")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    joinCode: text("join_code").notNull(),
    chatState: text("chat_state").notNull().default("open"),
    slowModeS: integer("slow_mode_s").notNull().default(30),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    durationMin: integer("duration_min").notNull().default(60),
    calendarEventId: text("calendar_event_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    allowOtherBatches: boolean("allow_other_batches").notNull().default(false),
    confusionThreshold: integer("confusion_threshold").notNull().default(25),
  },
  (t) => [
    index("live_sessions_course_id_idx").on(t.courseId),
    index("live_sessions_section_id_idx").on(t.sectionId),
    index("live_sessions_started_by_idx").on(t.startedBy),
  ],
);
export const sessionParticipants = pgTable(
  "session_participants",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    muted: boolean("muted").notNull().default(false),
    skipToday: boolean("skip_today").notNull().default(false),
    attendanceComplete: boolean("attendance_complete").notNull().default(false),
  },
  (t) => [
    index("session_participants_session_id_idx").on(t.sessionId),
    index("session_participants_user_id_idx").on(t.userId),
    uniqueIndex("session_participants_unique").on(t.sessionId, t.userId),
  ],
);
export const polls = pgTable(
  "polls",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    prompt: text("prompt").notNull(),
    type: text("type").notNull(),
    options: jsonb("options").$type<any>().default({}).notNull(),
    correct: jsonb("correct").$type<any>().default({}).notNull(),
    anonymous: boolean("anonymous").notNull().default(false),
    resultsVisibility: text("results_visibility").notNull().default("hidden"),
    timerS: integer("timer_s"),
    status: text("status").notNull().default("draft"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    revealed: boolean("revealed").notNull().default(false),
  },
  (t) => [index("polls_session_id_idx").on(t.sessionId)],
);
export const pollResponses = pgTable(
  "poll_responses",
  {
    ...base(),
    pollId: uuid("poll_id")
      .references((): AnyPgColumn => polls.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    response: jsonb("response").$type<any>().default({}).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("poll_responses_poll_id_idx").on(t.pollId),
    index("poll_responses_user_id_idx").on(t.userId),
    uniqueIndex("poll_responses_unique").on(t.pollId, t.userId),
  ],
);
export const chatMessages = pgTable(
  "chat_messages",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull().default("message"),
    pinned: boolean("pinned").notNull().default(false),
    answered: boolean("answered").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references((): AnyPgColumn => users.id),
  },
  (t) => [
    index("chat_messages_session_id_idx").on(t.sessionId),
    index("chat_messages_user_id_idx").on(t.userId),
    index("chat_messages_deleted_by_idx").on(t.deletedBy),
  ],
);
export const classNotes = pgTable(
  "class_notes",
  {
    ...base(),
    courseId: uuid("course_id")
      .references((): AnyPgColumn => courses.id)
      .notNull(),
    sectionId: uuid("section_id").references((): AnyPgColumn => sections.id),
    liveSessionId: uuid("live_session_id").references(
      (): AnyPgColumn => liveSessions.id,
    ),
    title: text("title").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: text("status").notNull().default("draft"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lessonId: uuid("lesson_id").references((): AnyPgColumn => lessons.id),
    createdBy: uuid("created_by")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    zipR2Key: text("zip_r2_key"),
  },
  (t) => [
    index("class_notes_course_id_idx").on(t.courseId),
    index("class_notes_section_id_idx").on(t.sectionId),
    index("class_notes_live_session_id_idx").on(t.liveSessionId),
    index("class_notes_lesson_id_idx").on(t.lessonId),
    index("class_notes_created_by_idx").on(t.createdBy),
  ],
);
export const classNoteFiles = pgTable(
  "class_note_files",
  {
    ...base(),
    noteId: uuid("note_id")
      .references((): AnyPgColumn => classNotes.id)
      .notNull(),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("class_note_files_note_id_idx").on(t.noteId)],
);
export const classNoteReads = pgTable(
  "class_note_reads",
  {
    ...base(),
    noteId: uuid("note_id")
      .references((): AnyPgColumn => classNotes.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    firstOpenedAt: timestamp("first_opened_at", {
      withTimezone: true,
    }).notNull(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }).notNull(),
    downloaded: boolean("downloaded").notNull().default(false),
  },
  (t) => [
    index("class_note_reads_note_id_idx").on(t.noteId),
    index("class_note_reads_user_id_idx").on(t.userId),
    uniqueIndex("class_note_reads_unique").on(t.noteId, t.userId),
  ],
);
export const confusionSignals = pgTable(
  "confusion_signals",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => [
    index("confusion_signals_session_id_idx").on(t.sessionId),
    index("confusion_signals_user_id_idx").on(t.userId),
  ],
);
export const paceVotes = pgTable(
  "pace_votes",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    vote: text("vote").notNull(),
  },
  (t) => [
    index("pace_votes_session_id_idx").on(t.sessionId),
    index("pace_votes_user_id_idx").on(t.userId),
    uniqueIndex("pace_votes_unique").on(t.sessionId, t.userId),
  ],
);
export const engagementSnapshots = pgTable(
  "engagement_snapshots",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    lost: integer("lost").notNull(),
    participants: integer("participants").notNull(),
    pace: jsonb("pace").$type<any>().default({}).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("engagement_snapshots_session_id_idx").on(t.sessionId)],
);
export const coldCalls = pgTable(
  "cold_calls",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    pickedUserId: uuid("picked_user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    pickedBy: uuid("picked_by")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    outcome: text("outcome"),
  },
  (t) => [
    index("cold_calls_session_id_idx").on(t.sessionId),
    index("cold_calls_picked_user_id_idx").on(t.pickedUserId),
    index("cold_calls_picked_by_idx").on(t.pickedBy),
  ],
);
export const exitTickets = pgTable(
  "exit_tickets",
  {
    ...base(),
    sessionId: uuid("session_id")
      .references((): AnyPgColumn => liveSessions.id)
      .notNull(),
    prompt: text("prompt").notNull(),
    type: text("type").notNull(),
    options: jsonb("options").$type<any>().default({}).notNull(),
    required: boolean("required").notNull().default(false),
  },
  (t) => [index("exit_tickets_session_id_idx").on(t.sessionId)],
);
export const exitTicketResponses = pgTable(
  "exit_ticket_responses",
  {
    ...base(),
    ticketId: uuid("ticket_id")
      .references((): AnyPgColumn => exitTickets.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    response: jsonb("response").$type<any>().default({}).notNull(),
    confusedAbout: text("confused_about").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("exit_ticket_responses_ticket_id_idx").on(t.ticketId),
    index("exit_ticket_responses_user_id_idx").on(t.userId),
    uniqueIndex("exit_ticket_responses_unique").on(t.ticketId, t.userId),
  ],
);
export const leagues = pgTable(
  "leagues",
  {
    ...base(),
    name: text("name").notNull(),
    seasonStart: timestamp("season_start", { withTimezone: true }).notNull(),
    seasonEnd: timestamp("season_end", { withTimezone: true }).notNull(),
    scoringRules: jsonb("scoring_rules").$type<any>().default({}).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (_t) => [],
);
export const leagueEntries = pgTable(
  "league_entries",
  {
    ...base(),
    leagueId: uuid("league_id")
      .references((): AnyPgColumn => leagues.id)
      .notNull(),
    sectionId: uuid("section_id")
      .references((): AnyPgColumn => sections.id)
      .notNull(),
  },
  (t) => [
    index("league_entries_league_id_idx").on(t.leagueId),
    index("league_entries_section_id_idx").on(t.sectionId),
    uniqueIndex("league_entries_unique").on(t.leagueId, t.sectionId),
  ],
);
export const leaguePoints = pgTable(
  "league_points",
  {
    ...base(),
    leagueId: uuid("league_id")
      .references((): AnyPgColumn => leagues.id)
      .notNull(),
    sectionId: uuid("section_id")
      .references((): AnyPgColumn => sections.id)
      .notNull(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    points: numeric("points", { precision: 16, scale: 4 }).notNull(),
    reason: text("reason").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("league_points_league_id_idx").on(t.leagueId),
    index("league_points_section_id_idx").on(t.sectionId),
    index("league_points_user_id_idx").on(t.userId),
    uniqueIndex("league_points_unique").on(
      t.leagueId,
      t.userId,
      t.source,
      t.sourceId,
    ),
  ],
);
export const leagueArchives = pgTable(
  "league_archives",
  {
    ...base(),
    leagueId: uuid("league_id")
      .references((): AnyPgColumn => leagues.id)
      .notNull(),
    week: text("week").notNull(),
    standings: jsonb("standings").$type<any>().default({}).notNull(),
  },
  (t) => [
    index("league_archives_league_id_idx").on(t.leagueId),
    uniqueIndex("league_archives_unique").on(t.leagueId, t.week),
  ],
);
export const profiles = pgTable(
  "profiles",
  {
    ...base(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    handle: text("handle").notNull().unique(),
    displayName: text("display_name").notNull(),
    headline: text("headline").notNull(),
    bioMd: text("bio_md").notNull(),
    location: text("location").notNull(),
    links: jsonb("links").$type<any>().default({}).notNull(),
    visibility: text("visibility").notNull().default("students_only"),
    theme: jsonb("theme").$type<any>().default({}).notNull(),
    layout: jsonb("layout").$type<any>().default({}).notNull(),
    bannerR2Key: text("banner_r2_key"),
    avatarFrame: text("avatar_frame"),
    pinnedItems: jsonb("pinned_items").$type<any>().default({}).notNull(),
    currentlyLearning: text("currently_learning").array().default([]).notNull(),
    handleChangedAt: timestamp("handle_changed_at", { withTimezone: true }),
  },
  (t) => [
    index("profiles_user_id_idx").on(t.userId),
    uniqueIndex("profiles_unique").on(t.userId),
  ],
);
export const events = pgTable(
  "events",
  {
    ...base(),
    userId: uuid("user_id").references((): AnyPgColumn => users.id),
    courseId: uuid("course_id").references((): AnyPgColumn => courses.id),
    type: text("type").notNull(),
    entityId: uuid("entity_id"),
    meta: jsonb("meta").$type<any>().default({}).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("events_user_id_idx").on(t.userId),
    index("events_course_id_idx").on(t.courseId),
  ],
);
export const auditLog = pgTable(
  "audit_log",
  {
    ...base(),
    actorId: uuid("actor_id").references((): AnyPgColumn => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    diff: jsonb("diff").$type<any>().default({}).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [index("audit_log_actor_id_idx").on(t.actorId)],
);
export const notifications = pgTable(
  "notifications",
  {
    ...base(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notifications_user_id_idx").on(t.userId)],
);
export const siteSettings = pgTable(
  "site_settings",
  {
    ...base(),
    key: text("key").notNull().unique(),
    value: jsonb("value").$type<any>().default({}).notNull(),
  },
  (_t) => [],
);
export const webhookEvents = pgTable(
  "webhook_events",
  {
    ...base(),
    providerEventId: text("provider_event_id").notNull().unique(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<any>().default({}).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (_t) => [],
);
export const uploads = pgTable(
  "uploads",
  {
    ...base(),
    userId: uuid("user_id")
      .references((): AnyPgColumn => users.id)
      .notNull(),
    courseId: uuid("course_id").references((): AnyPgColumn => courses.id),
    r2Key: text("r2_key").notNull().unique(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    verified: boolean("verified").notNull().default(false),
  },
  (t) => [
    index("uploads_user_id_idx").on(t.userId),
    index("uploads_course_id_idx").on(t.courseId),
  ],
);
export const outbox = pgTable(
  "outbox",
  {
    ...base(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<any>().default({}).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (_t) => [],
);
