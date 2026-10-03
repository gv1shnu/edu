import { query, transaction } from "@edu/db";
import { type Actor, confusionSummary, atRisk } from "@edu/shared";
import { v7 } from "uuid";
import { z } from "zod";
import { permit, HttpError, audit, outbox } from "./core";
export async function teachData(user: Actor, courseId?: string) {
  if (courseId) await permit(user, "analytics:read", { courseId });
  else if (!user.isAdmin && !user.memberships.some((m) => m.role !== "student"))
    throw new HttpError(403, "Tutor access required");
  const courses = await query(
    "SELECT c.*,t.name track_name FROM courses c JOIN tracks t ON t.id=c.track_id WHERE $1 OR EXISTS(SELECT 1 FROM course_members m WHERE m.course_id=c.id AND m.user_id=$2 AND m.role<>'student') ORDER BY c.created_at",
    [user.isAdmin, user.id],
  );
  if (!courseId) return { courses };
  const [course] = courses.filter((c) => c.id === courseId);
  return {
    courses,
    course,
    modules: await query(
      "SELECT * FROM modules WHERE course_id=$1 ORDER BY position",
      [courseId],
    ),
    lessons: await query(
      "SELECT l.* FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=$1 ORDER BY m.position,l.position",
      [courseId],
    ),
    sections: await query("SELECT * FROM sections WHERE course_id=$1", [
      courseId,
    ]),
    notes: await query(
      "SELECT * FROM class_notes WHERE course_id=$1 ORDER BY created_at DESC",
      [courseId],
    ),
    live: await query(
      "SELECT * FROM live_sessions WHERE course_id=$1 ORDER BY started_at DESC",
      [courseId],
    ),
    calendarConnected:
      (
        await query(
          "SELECT 1 FROM accounts WHERE user_id=$1 AND provider_id='google' AND scope LIKE '%calendar.events%' AND refresh_token IS NOT NULL",
          [user.id],
        )
      ).length > 0,
  };
}
export async function saveModule(user: Actor, p: any) {
  const v = z
    .object({
      id: z.string().uuid().optional(),
      courseId: z.string().uuid(),
      title: z.string().min(1),
      position: z.number().int().min(0),
      releaseAt: z.string().datetime().nullable().optional(),
    })
    .parse(p);
  await permit(user, "course:edit", { courseId: v.courseId });
  const id = v.id || v7();
  await transaction(async (tx) => {
    if (v.id) {
      const old = (
        await tx.query("SELECT course_id FROM modules WHERE id=$1", [v.id])
      ).rows[0];
      if (old?.course_id !== v.courseId)
        throw new HttpError(400, "Module mismatch");
    }
    await tx.query(
      "INSERT INTO modules(id,course_id,title,position,release_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET title=$3,position=$4,release_at=$5",
      [id, v.courseId, v.title, v.position, v.releaseAt || null],
    );
    await audit(tx, user, "module.save", "modules", id, v);
  });
  return { id };
}
export async function startLive(user: Actor, p: any) {
  const v = z
    .object({
      courseId: z.string().uuid(),
      sectionId: z.string().uuid().nullable(),
      title: z.string().min(1).max(180),
      scheduledAt: z.string().datetime().nullable().optional(),
      durationMin: z.number().int().min(15).max(480).default(60),
    })
    .parse(p);
  await permit(user, "live:manage", {
    courseId: v.courseId,
    sectionId: v.sectionId,
  });
  if (
    v.sectionId &&
    !(
      await query("SELECT id FROM sections WHERE id=$1 AND course_id=$2", [
        v.sectionId,
        v.courseId,
      ])
    ).length
  )
    throw new HttpError(400, "Invalid batch");
  const id = v7(),
    code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32])
      .join("");
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO live_sessions(id,course_id,section_id,title,started_by,join_code,started_at,scheduled_at,duration_min) VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8)",
      [
        id,
        v.courseId,
        v.sectionId,
        v.title,
        user.id,
        code,
        v.scheduledAt || null,
        v.durationMin,
      ],
    );
    // Scheduled classes go on the tutor's Google Calendar with the batch invited.
    if (v.scheduledAt) await outbox(tx, "calendar:event", { sessionId: id });
    await outbox(tx, "notify:course", {
      courseId: v.courseId,
      sectionId: v.sectionId,
      kind: "live",
      title: v.scheduledAt
        ? "Your next class is scheduled"
        : "Class is live now",
      body: v.title,
      link: `/live/${id}`,
      startAfter: v.scheduledAt || undefined,
    });
    await audit(tx, user, "live.start", "live_sessions", id, v);
  });
  return { id };
}
export async function analytics(user: Actor, courseId: string) {
  await permit(user, "analytics:read", { courseId, userId: user.id });
  const staff =
    user.isAdmin ||
    user.memberships.some(
      (m) => m.courseId === courseId && m.role !== "student",
    );
  const scoped = async (view: string) =>
    query(
      `SELECT v.*,u.name FROM ${view} v JOIN users u ON u.id=v.user_id WHERE v.course_id=$1 AND ($2 OR v.user_id=$3)`,
      [courseId, staff, user.id],
    );
  return {
    progress: (await scoped("v_course_progress")).map((r) => ({
      ...r,
      completion: Number(r.completion),
    })),
    attendance: await scoped("v_attendance"),
    atRisk: staff
      ? (await scoped("v_at_risk"))
          .map((s) => ({
            ...s,
            reasons: atRisk({
              attendance: s.attendance === null ? null : Number(s.attendance),
              lastActivity: s.last_activity,
            }),
          }))
          .filter((s) => s.reasons.length)
      : [],
    activity: await query(
      "SELECT type,count(*) count FROM events WHERE course_id=$1 AND at>now()-interval '7 days' AND ($2 OR user_id=$3) GROUP BY type",
      [courseId, staff, user.id],
    ),
  };
}
export async function report(user: Actor, id: string) {
  const [s] = await query("SELECT * FROM live_sessions WHERE id=$1", [id]);
  await permit(user, "live:manage", {
    courseId: s?.course_id,
    sectionId: s?.section_id,
  });
  const tickets = await query(
    "SELECT t.prompt,r.response,r.confused_about,u.name FROM exit_ticket_responses r JOIN exit_tickets t ON t.id=r.ticket_id JOIN users u ON u.id=r.user_id WHERE t.session_id=$1",
    [id],
  );
  return {
    session: s,
    attendance: await query(
      "SELECT u.name,p.joined_at,p.last_seen_at,p.attendance_complete,extract(epoch FROM(p.last_seen_at-p.joined_at))/60 minutes FROM session_participants p JOIN users u ON u.id=p.user_id JOIN live_sessions s ON s.id=p.session_id JOIN course_members m ON m.course_id=s.course_id AND m.user_id=p.user_id WHERE p.session_id=$1 AND m.role='student' AND NOT u.is_admin",
      [id],
    ),
    polls: await query("SELECT * FROM polls WHERE session_id=$1", [id]),
    answers: await query(
      "SELECT p.prompt,CASE WHEN p.anonymous THEN 'Anonymous' ELSE u.name END name,r.response FROM poll_responses r JOIN polls p ON p.id=r.poll_id JOIN users u ON u.id=r.user_id WHERE p.session_id=$1",
      [id],
    ),
    chat: await query(
      "SELECT u.name,CASE WHEN m.deleted_at IS NULL THEN m.body ELSE 'Message removed' END body,m.kind,m.created_at FROM chat_messages m JOIN users u ON u.id=m.user_id WHERE session_id=$1 ORDER BY m.created_at",
      [id],
    ),
    timeline: await query(
      "SELECT lost,participants,pace,at FROM engagement_snapshots WHERE session_id=$1 ORDER BY at",
      [id],
    ),
    coldCalls: await query(
      "SELECT u.name,c.outcome,c.at FROM cold_calls c JOIN users u ON u.id=c.picked_user_id WHERE c.session_id=$1",
      [id],
    ),
    tickets,
    confusion: confusionSummary(tickets.map((t) => t.confused_about)),
  };
}
export async function league(user: Actor | null, id: string) {
  await permit(user, "public:read", { published: true });
  const [l] = await query("SELECT * FROM leagues WHERE id=$1", [id]);
  if (!l) throw new HttpError(404, "League not found");
  const teams = await query(
    `SELECT s.id,s.name,s.color,s.emoji,coalesce(sum(p.points) FILTER(WHERE p.at>=date_trunc('week',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'),0) points,coalesce(sum(p.points),0) season_points,(SELECT count(*) FROM course_members m WHERE m.section_id=s.id AND m.role='student') members FROM league_entries e JOIN sections s ON s.id=e.section_id LEFT JOIN league_points p ON p.section_id=s.id AND p.league_id=e.league_id WHERE e.league_id=$1 GROUP BY s.id ORDER BY coalesce(sum(p.points),0)/greatest(1,(SELECT count(*) FROM course_members m WHERE m.section_id=s.id AND m.role='student')) DESC`,
    [id],
  );
  const feed = await query(
    `SELECT p.points,p.reason,p.at,s.name batch_name,CASE WHEN pr.visibility='private' OR ($2::uuid IS NULL AND pr.visibility<>'public') THEN 'A learner' ELSE pr.display_name END name FROM league_points p JOIN sections s ON s.id=p.section_id LEFT JOIN profiles pr ON pr.user_id=p.user_id WHERE p.league_id=$1 ORDER BY p.at DESC LIMIT 30`,
    [id, user?.id || null],
  );
  return {
    ...l,
    teams: teams
      .map((t) => ({
        ...t,
        perCapita: Number(t.points) / Math.max(1, Number(t.members)),
      }))
      .sort((a, b) => b.perCapita - a.perCapita),
    feed,
  };
}
