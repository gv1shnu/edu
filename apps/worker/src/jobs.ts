import { query, transaction } from "@edu/db";
import { cappedPoints, dateTime } from "@edu/shared";
import { v7 } from "uuid";
import { renderNotification } from "@edu/email";
import { Resend } from "resend";
import type { PoolClient } from "pg";
async function enqueue(tx: PoolClient, kind: string, payload: unknown) {
  await tx.query("INSERT INTO outbox(id,kind,payload) VALUES($1,$2,$3)", [
    v7(),
    kind,
    JSON.stringify(payload),
  ]);
}
export async function email(p: any, key: string) {
  const [u] = p.to
    ? [{ email: p.to, email_enabled: true }]
    : await query(
        "SELECT email,email_enabled FROM users WHERE id=$1 AND deleted_at IS NULL",
        [p.userId],
      );
  if (!u?.email_enabled) return;
  if (!process.env.RESEND_API_KEY)
    throw new Error("RESEND_API_KEY is required to deliver email");
  const html = await renderNotification({
    title: p.title,
    body: p.body,
    link: new URL(p.link, process.env.NEXT_PUBLIC_APP_URL).toString(),
  });
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
    { from: process.env.EMAIL_FROM!, to: u.email, subject: p.title, html },
    { idempotencyKey: key },
  );
  if (result.error) throw new Error(result.error.message);
}
export async function notifyCourse(p: any) {
  await transaction(async (tx) => {
    const members = (
      await tx.query(
        "SELECT user_id FROM course_members WHERE course_id=$1 AND role='student' AND ($2::uuid IS NULL OR section_id=$2)",
        [p.courseId, p.sectionId || null],
      )
    ).rows;
    for (const m of members) {
      const exists = (
        await tx.query(
          "SELECT id FROM notifications WHERE user_id=$1 AND kind=$2 AND link=$3",
          [m.user_id, p.kind, p.link],
        )
      ).rowCount;
      if (exists && !p.renotify) continue;
      await tx.query(
        "INSERT INTO notifications(id,user_id,kind,title,body,link) VALUES($1,$2,$3,$4,$5,$6)",
        [v7(), m.user_id, p.kind, p.title, p.body, p.link],
      );
      await enqueue(tx, "email", { ...p, userId: m.user_id });
    }
  });
}
export async function publishNotes(p: any) {
  await transaction(async (tx) => {
    const n = (
      await tx.query("SELECT * FROM class_notes WHERE id=$1 FOR UPDATE", [
        p.noteId,
      ])
    ).rows[0];
    if (!n) return;
    const republish = n.status === "published";
    if (n.status === "scheduled" && n.publish_at > new Date())
      throw new Error("Not due yet");
    let m = (
      await tx.query(
        "SELECT id FROM modules WHERE course_id=$1 AND section_id IS NOT DISTINCT FROM $2 AND title='Class notes'",
        [n.course_id, n.section_id],
      )
    ).rows[0];
    if (!m) {
      m = { id: v7() };
      await tx.query(
        "INSERT INTO modules(id,course_id,section_id,title,position) VALUES($1,$2,$3,'Class notes',1000)",
        [m.id, n.course_id, n.section_id],
      );
    }
    const lid = n.lesson_id || v7();
    await tx.query(
      "INSERT INTO lessons(id,module_id,title,type,body_html,published,position) VALUES($1,$2,$3,'class_notes',$4,true,$5) ON CONFLICT(id) DO UPDATE SET title=$3,body_html=$4,published=true,updated_at=now()",
      [lid, m.id, n.title, n.body_html, -Math.floor(Date.now() / 1000)],
    );
    await tx.query(
      "UPDATE class_notes SET status='published',published_at=coalesce(published_at,now()),lesson_id=$2,updated_at=now() WHERE id=$1",
      [n.id, lid],
    );
    // Edits to live notes refresh the lesson silently unless the tutor asked to re-notify.
    if (republish && !p.renotify) return;
    await enqueue(tx, "notify:course", {
      courseId: n.course_id,
      sectionId: n.section_id,
      kind: "notes",
      title: republish ? "Notes updated" : "Notes are up",
      body: n.title,
      link: `/notes/${n.id}`,
      renotify: p.renotify,
    });
  });
}
const sources: Record<string, [string, number, number]> = {
  attendance: ["attendance", 5, 15],
  poll_answered: ["poll", 1, 10],
  exit_ticket: ["exit_ticket", 3, 9],
};
export async function awardLeague(p: any) {
  const rule = sources[p.type];
  if (!rule) return;
  await transaction(async (tx) => {
    const entries = (
      await tx.query(
        "SELECT le.*,l.scoring_rules FROM course_members m JOIN league_entries le ON le.section_id=m.section_id JOIN leagues l ON l.id=le.league_id WHERE m.user_id=$1 AND m.course_id=$2 AND m.role='student' AND l.active AND now() BETWEEN l.season_start AND l.season_end",
        [p.userId, p.courseId],
      )
    ).rows;
    for (const entry of entries) {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        entry.league_id + p.userId + rule[0],
      ]);
      if (
        (
          await tx.query(
            "SELECT id FROM league_points WHERE league_id=$1 AND user_id=$2 AND source=$3 AND source_id=$4",
            [entry.league_id, p.userId, rule[0], p.entityId],
          )
        ).rowCount
      )
        continue;
      const earned = Number(
        (
          await tx.query(
            "SELECT coalesce(sum(points),0) n FROM league_points WHERE league_id=$1 AND user_id=$2 AND source=$3 AND (at AT TIME ZONE 'Asia/Kolkata')::date=(now() AT TIME ZONE 'Asia/Kolkata')::date",
            [entry.league_id, p.userId, rule[0]],
          )
        ).rows[0].n,
      );
      const points = cappedPoints(
        earned,
        Number(entry.scoring_rules[rule[0]]?.points ?? rule[1]),
        entry.scoring_rules[rule[0]]?.cap ?? rule[2],
      );
      if (points)
        await tx.query(
          "INSERT INTO league_points(id,league_id,section_id,user_id,source,source_id,points,reason,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())",
          [
            v7(),
            entry.league_id,
            entry.section_id,
            p.userId,
            rule[0],
            p.entityId,
            points,
            p.type.replaceAll("_", " "),
          ],
        );
    }
  });
}
export async function sessionReport(p: any) {
  const [s] = await query("SELECT * FROM live_sessions WHERE id=$1", [
    p.sessionId,
  ]);
  for (const student of await query(
    "SELECT p.* FROM session_participants p JOIN live_sessions s ON s.id=p.session_id JOIN course_members m ON m.course_id=s.course_id AND m.user_id=p.user_id JOIN users u ON u.id=p.user_id WHERE p.session_id=$1 AND p.attendance_complete AND m.role='student' AND NOT u.is_admin",
    [p.sessionId],
  ))
    await awardLeague({
      userId: student.user_id,
      courseId: s.course_id,
      type: "attendance",
      entityId: s.id,
    });
}
export async function weekly() {
  await query("SELECT refresh_league_standings()");
  for (const l of await query("SELECT id FROM leagues WHERE active")) {
    const rows = await query(
      "SELECT * FROM league_weekly_standings WHERE league_id=$1 AND week=date_trunc('week',now() AT TIME ZONE 'Asia/Kolkata')-interval '7 days'",
      [l.id],
    );
    if (rows.length)
      await query(
        "INSERT INTO league_archives(id,league_id,week,standings) VALUES($1,$2,$3,$4) ON CONFLICT(league_id,week) DO NOTHING",
        [v7(), l.id, rows[0].week.toISOString(), JSON.stringify(rows)],
      );
  }
}
export async function dueReminders() {
  // Monthly access is renewed manually; remind once per access period, three days ahead.
  const expiring = await query(
    "SELECT m.user_id,m.access_until,c.slug,c.title FROM course_members m JOIN courses c ON c.id=m.course_id WHERE m.role='student' AND m.access_until BETWEEN now() AND now()+interval '3 days'",
  );
  for (const m of expiring)
    await transaction(async (tx) => {
      const link = `/courses/${m.slug}?renew=${new Date(m.access_until).toISOString().slice(0, 10)}`;
      const sent = (
        await tx.query(
          "SELECT 1 FROM notifications WHERE user_id=$1 AND kind='renewal' AND link=$2",
          [m.user_id, link],
        )
      ).rowCount;
      if (sent) return;
      const title = "Your monthly access ends soon";
      const body = `Access to ${m.title} ends ${dateTime(m.access_until)}. Renew from the course page to keep going.`;
      await tx.query(
        "INSERT INTO notifications(id,user_id,kind,title,body,link) VALUES($1,$2,'renewal',$3,$4,$5)",
        [v7(), m.user_id, title, body, link],
      );
      await enqueue(tx, "email", {
        userId: m.user_id,
        kind: "renewal",
        title,
        body,
        link,
      });
    });
}

/**
 * Puts a scheduled live class on the tutor's Google Calendar and invites the batch (Google
 * emails the invitations). Needs the tutor to have connected Google Calendar from the
 * teaching workspace; without that the class still works, it just isn't on a calendar.
 */
export async function calendarEvent(p: any) {
  const [s] = await query(
    "SELECT s.*,c.title course_title FROM live_sessions s JOIN courses c ON c.id=s.course_id WHERE s.id=$1",
    [p.sessionId],
  );
  if (!s?.scheduled_at || s.calendar_event_id || s.ended_at) return;
  const [account] = await query(
    "SELECT refresh_token FROM accounts WHERE user_id=$1 AND provider_id='google' AND scope LIKE '%calendar.events%' AND refresh_token IS NOT NULL",
    [s.started_by],
  );
  if (!account) return;
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!token.ok)
    throw new Error(`Google token refresh failed (${token.status})`);
  const { access_token } = await token.json();
  const students = await query(
    "SELECT u.email FROM course_members m JOIN users u ON u.id=m.user_id WHERE m.course_id=$1 AND m.role='student' AND u.deleted_at IS NULL AND ($2::uuid IS NULL OR m.section_id=$2)",
    [s.course_id, s.section_id],
  );
  const link = new URL(
    `/live/${s.id}`,
    process.env.NEXT_PUBLIC_APP_URL,
  ).toString();
  const start = new Date(s.scheduled_at);
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `${s.title} · ${s.course_title}`,
        description: `Join the class: ${link}\nClass code: ${s.join_code}`,
        start: { dateTime: start.toISOString() },
        end: {
          dateTime: new Date(
            start.getTime() + s.duration_min * 60000,
          ).toISOString(),
        },
        attendees: students.map((u) => ({ email: u.email })),
        guestsCanSeeOtherGuests: false,
        reminders: { useDefault: true },
      }),
    },
  );
  if (!res.ok) throw new Error(`Calendar event failed (${res.status})`);
  const event = await res.json();
  await query("UPDATE live_sessions SET calendar_event_id=$2 WHERE id=$1", [
    s.id,
    event.id,
  ]);
}
