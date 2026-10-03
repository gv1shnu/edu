import { query, transaction, withUser, asSystem } from "@edu/db";
import {
  can,
  liveEvents,
  type Actor,
  type LiveEvent,
  pickStudent,
} from "@edu/shared";
import { v7 } from "uuid";
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});
export async function actor(id: string): Promise<Actor> {
  const [u] = await query(
    "SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  if (!u) throw new Error("UNAUTHENTICATED");
  const m = await query(
    "SELECT * FROM course_members WHERE user_id=$1 AND (role<>'student' OR access_until IS NULL OR access_until>now())",
    [id],
  );
  return {
    id,
    isAdmin: u.is_admin,
    memberships: m.map((r) => ({
      courseId: r.course_id,
      sectionId: r.section_id,
      role: r.role,
    })),
  };
}
export async function limit(key: string, max: number, seconds: number) {
  const count = (await redis.eval(
    "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",
    1,
    key,
    seconds,
  )) as number;
  if (count > max) throw new Error("RATE_LIMITED");
}
const staffEvents = new Set([
  "chat:delete",
  "chat:pin",
  "chat:answer",
  "chat:setState",
  "chat:mute",
  "poll:create",
  "poll:open",
  "poll:close",
  "poll:reveal",
  "session:end",
  "confusion:clear",
  "coldcall:pick",
  "coldcall:outcome",
  "coldcall:skip",
  "exit:create",
]);
// Each entry point runs its queries as the acting user so RLS applies (see packages/db).
export function snapshot(user: Actor, sessionId: string) {
  return withUser(user.id, () => buildSnapshot(user, sessionId));
}
async function buildSnapshot(user: Actor, sessionId: string) {
  const [s] = await query("SELECT * FROM live_sessions WHERE id=$1", [
    sessionId,
  ]);
  if (
    !s ||
    !(await can(user, "live:join", {
      courseId: s.course_id,
      sectionId: s.allow_other_batches ? null : s.section_id,
    }))
  )
    throw new Error("FORBIDDEN");
  const staff = await can(user, "live:manage", {
    courseId: s.course_id,
    sectionId: s.section_id,
  });
  const messages = await query(
    `SELECT m.id,m.user_id,u.name,CASE WHEN m.deleted_at IS NULL THEN m.body ELSE 'Message removed' END body,m.kind,m.pinned,m.answered,m.deleted_at,m.created_at FROM chat_messages m JOIN users u ON u.id=m.user_id WHERE m.session_id=$1 ORDER BY m.created_at DESC LIMIT 100`,
    [sessionId],
  );
  const polls = await query(
    "SELECT * FROM polls WHERE session_id=$1 AND status IN ('open','closed') ORDER BY created_at DESC LIMIT 1",
    [sessionId],
  );
  const poll = polls[0];
  if (poll && !staff && !poll.revealed) delete poll.correct;
  const [mine] = poll
    ? await query(
        "SELECT response FROM poll_responses WHERE poll_id=$1 AND user_id=$2",
        [poll.id, user.id],
      )
    : [];
  const [participant] = await query(
    "SELECT muted FROM session_participants WHERE session_id=$1 AND user_id=$2",
    [sessionId, user.id],
  );
  const [pace] = await query(
    "SELECT vote FROM pace_votes WHERE session_id=$1 AND user_id=$2",
    [sessionId, user.id],
  );
  const [lost] = await query(
    "SELECT id FROM confusion_signals WHERE session_id=$1 AND user_id=$2 AND cleared_at IS NULL AND at>now()-interval '3 minutes'",
    [sessionId, user.id],
  );
  const tickets = await query(
    "SELECT t.*, EXISTS(SELECT 1 FROM exit_ticket_responses r WHERE r.ticket_id=t.id AND r.user_id=$2) AS answered FROM exit_tickets t WHERE session_id=$1 ORDER BY created_at",
    [sessionId, user.id],
  );
  return {
    session: s,
    staff,
    learner:
      !user.isAdmin &&
      user.memberships.some(
        (m) => m.courseId === s.course_id && m.role === "student",
      ),
    messages: messages.reverse(),
    poll,
    myResponse: mine?.response,
    results:
      poll &&
      (staff ||
        poll.results_visibility === "live" ||
        (poll.results_visibility === "after_close" && poll.status === "closed"))
        ? await pollResults(poll.id)
        : null,
    muted: participant?.muted || false,
    myPace: pace?.vote,
    lost: !!lost,
    engagement: await aggregate(sessionId),
    tickets,
  };
}
export async function aggregate(sessionId: string): Promise<any> {
  const learners = `SELECT p.user_id FROM session_participants p
    JOIN live_sessions s ON s.id=p.session_id
    JOIN course_members m ON m.course_id=s.course_id AND m.user_id=p.user_id
    JOIN users u ON u.id=p.user_id
    WHERE p.session_id=$1 AND m.role='student' AND NOT u.is_admin
      AND p.last_seen_at>now()-interval '60 seconds'`;
  const [counts] = await query(
    `WITH learners AS (${learners}) SELECT
      (SELECT count(*) FROM learners)::int participants,
      (SELECT count(DISTINCT c.user_id) FROM confusion_signals c JOIN learners l ON l.user_id=c.user_id
       WHERE c.session_id=$1 AND c.cleared_at IS NULL AND c.at>now()-interval '3 minutes')::int lost`,
    [sessionId],
  );
  const votes = await query(
    `WITH learners AS (${learners}) SELECT v.vote,count(*)::int count FROM pace_votes v
     JOIN learners l ON l.user_id=v.user_id WHERE v.session_id=$1 GROUP BY v.vote`,
    [sessionId],
  );
  return {
    ...counts,
    pace: Object.fromEntries(votes.map((v) => [v.vote, v.count])),
  };
}
// Aggregate counts over everyone's responses; who sees them is decided by the caller.
export function pollResults(pollId: string) {
  return asSystem(() => countPoll(pollId));
}
async function countPoll(pollId: string) {
  const [p] = await query("SELECT * FROM polls WHERE id=$1", [pollId]);
  const rows = await query(
    "SELECT response FROM poll_responses WHERE poll_id=$1",
    [pollId],
  );
  const counts: Record<string, number> = {};
  for (const r of rows)
    for (const v of Array.isArray(r.response) ? r.response : [r.response]) {
      const key = String(v).slice(0, 500);
      counts[key] = (counts[key] || 0) + 1;
    }
  return {
    pollId,
    counts,
    total: rows.length,
    correct: p.revealed ? p.correct : undefined,
    visibility: p.results_visibility,
    status: p.status,
  };
}
export function dispatch(user: Actor, name: LiveEvent, input: unknown) {
  return withUser(user.id, () => handleEvent(user, name, input));
}
async function handleEvent(user: Actor, name: LiveEvent, input: unknown) {
  const p: any = liveEvents[name].parse(input);
  const [session] = await query("SELECT * FROM live_sessions WHERE id=$1", [
    p.sessionId,
  ]);
  if (!session) throw new Error("NOT_FOUND");
  const manage = await can(user, "live:manage", {
    courseId: session.course_id,
    sectionId: session.section_id,
  });
  if (
    !(await can(user, staffEvents.has(name) ? "live:manage" : "live:respond", {
      courseId: session.course_id,
      sectionId:
        session.allow_other_batches && !staffEvents.has(name)
          ? null
          : session.section_id,
    }))
  )
    throw new Error("FORBIDDEN");
  const learner =
    !user.isAdmin &&
    user.memberships.some(
      (m) => m.courseId === session.course_id && m.role === "student",
    );
  if (
    !learner &&
    ["poll:respond", "pace:vote", "confusion:toggle", "exit:respond"].includes(
      name,
    )
  )
    throw new Error("FORBIDDEN");
  if (
    session.ended_at &&
    !["exit:respond", "presence:ping", "session:join"].includes(name)
  )
    throw new Error("SESSION_ENDED");
  if (name === "chat:send") await limit(`chat:${user.id}`, 5, 10);
  if (name === "poll:respond") await limit(`poll:${user.id}`, 20, 10);
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM live_sessions WHERE id=$1 FOR UPDATE", [
      p.sessionId,
    ]);
    const s = (
      await tx.query("SELECT * FROM live_sessions WHERE id=$1", [p.sessionId])
    ).rows[0];
    if (
      s.ended_at &&
      !["exit:respond", "presence:ping", "session:join"].includes(name)
    )
      throw new Error("SESSION_ENDED");
    const participant = (
      await tx.query(
        "SELECT * FROM session_participants WHERE session_id=$1 AND user_id=$2",
        [p.sessionId, user.id],
      )
    ).rows[0];
    let result: any = { ok: true };
    switch (name) {
      case "session:join":
      case "presence:ping":
        if (!learner) break;
        await tx.query(
          "INSERT INTO session_participants(id,session_id,user_id,joined_at,last_seen_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(session_id,user_id) DO UPDATE SET last_seen_at=now()",
          [v7(), p.sessionId, user.id],
        );
        break;
      case "chat:send": {
        if (!manage) {
          if (participant?.muted) throw new Error("MUTED");
          if (s.chat_state === "paused") throw new Error("CHAT_PAUSED");
          if (s.chat_state === "questions_only" && p.kind !== "question")
            throw new Error("QUESTIONS_ONLY");
          if (s.chat_state === "slow") {
            const last = (
              await tx.query(
                "SELECT created_at FROM chat_messages WHERE session_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1",
                [p.sessionId, user.id],
              )
            ).rows[0];
            if (
              last &&
              Date.now() - last.created_at.getTime() < s.slow_mode_s * 1000
            )
              throw new Error("SLOW_MODE");
          }
        }
        const id = v7();
        await tx.query(
          "INSERT INTO chat_messages(id,session_id,user_id,body,kind) VALUES($1,$2,$3,$4,$5)",
          [id, p.sessionId, user.id, p.body, p.kind],
        );
        result = { id };
        break;
      }
      case "chat:setState":
        await tx.query(
          "UPDATE live_sessions SET chat_state=$2,slow_mode_s=coalesce($3,slow_mode_s) WHERE id=$1",
          [p.sessionId, p.state, p.slowModeS],
        );
        break;
      case "chat:mute":
        await tx.query(
          "UPDATE session_participants SET muted=$3 WHERE session_id=$1 AND user_id=$2",
          [p.sessionId, p.userId, p.muted],
        );
        break;
      case "chat:delete":
        if (!p.clearAll && !p.messageId) throw new Error("MESSAGE_REQUIRED");
        await tx.query(
          "UPDATE chat_messages SET deleted_at=now(),deleted_by=$3,body='' WHERE session_id=$1 AND ($2::uuid IS NULL OR id=$2)",
          [p.sessionId, p.clearAll ? null : p.messageId, user.id],
        );
        break;
      case "chat:pin":
        await tx.query(
          "UPDATE chat_messages SET pinned=$3 WHERE session_id=$1 AND id=$2",
          [p.sessionId, p.messageId, p.pinned],
        );
        break;
      case "chat:answer":
        await tx.query(
          "UPDATE chat_messages SET answered=true WHERE session_id=$1 AND id=$2",
          [p.sessionId, p.messageId],
        );
        break;
      case "poll:create": {
        const id = v7();
        await tx.query(
          "INSERT INTO polls(id,session_id,prompt,type,options,correct,anonymous,results_visibility,timer_s) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            p.sessionId,
            p.prompt,
            p.type,
            JSON.stringify(p.options),
            JSON.stringify(p.correct ?? null),
            p.anonymous,
            p.resultsVisibility,
            p.timerS || null,
          ],
        );
        result = { id };
        break;
      }
      case "poll:open":
        await tx.query(
          "UPDATE polls SET status='closed',closed_at=now() WHERE session_id=$1 AND status='open'",
          [p.sessionId],
        );
        await tx.query(
          "UPDATE polls SET status='open',opened_at=now(),closed_at=NULL WHERE id=$1 AND session_id=$2",
          [p.pollId, p.sessionId],
        );
        break;
      case "poll:close":
        await tx.query(
          "UPDATE polls SET status='closed',closed_at=now() WHERE id=$1 AND session_id=$2",
          [p.pollId, p.sessionId],
        );
        break;
      case "poll:reveal":
        await tx.query(
          "UPDATE polls SET revealed=true WHERE id=$1 AND session_id=$2 AND status='closed'",
          [p.pollId, p.sessionId],
        );
        break;
      case "poll:respond": {
        const poll = (
          await tx.query(
            "SELECT * FROM polls WHERE id=$1 AND session_id=$2 FOR UPDATE",
            [p.pollId, p.sessionId],
          )
        ).rows[0];
        if (
          !poll ||
          poll.status !== "open" ||
          (poll.timer_s &&
            Date.now() > poll.opened_at.getTime() + poll.timer_s * 1000)
        )
          throw new Error("POLL_CLOSED");
        if (
          (["single", "yes_no"].includes(poll.type) &&
            !poll.options.includes(p.response)) ||
          (poll.type === "multi" &&
            (!Array.isArray(p.response) ||
              p.response.some((v: string) => !poll.options.includes(v)))) ||
          (poll.type === "rating" &&
            (!Number.isInteger(p.response) ||
              p.response < 1 ||
              p.response > 5)) ||
          (poll.type === "short_text" && typeof p.response !== "string")
        )
          throw new Error("INVALID_RESPONSE");
        await tx.query(
          "INSERT INTO poll_responses(id,poll_id,user_id,response,answered_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(poll_id,user_id) DO UPDATE SET response=$4,answered_at=now()",
          [v7(), p.pollId, user.id, JSON.stringify(p.response)],
        );
        await tx.query(
          "INSERT INTO outbox(id,kind,payload) VALUES($1,'league:award',$2)",
          [
            v7(),
            JSON.stringify({
              userId: user.id,
              courseId: s.course_id,
              type: "poll_answered",
              entityId: p.pollId,
            }),
          ],
        );
        break;
      }
      case "confusion:toggle":
        await tx.query(
          "UPDATE confusion_signals SET cleared_at=now() WHERE session_id=$1 AND user_id=$2 AND cleared_at IS NULL",
          [p.sessionId, user.id],
        );
        if (p.active)
          await tx.query(
            "INSERT INTO confusion_signals(id,session_id,user_id,at) VALUES($1,$2,$3,now())",
            [v7(), p.sessionId, user.id],
          );
        break;
      case "confusion:clear":
        await tx.query(
          "UPDATE confusion_signals SET cleared_at=now() WHERE session_id=$1 AND cleared_at IS NULL",
          [p.sessionId],
        );
        break;
      case "pace:vote":
        await tx.query(
          "INSERT INTO pace_votes(id,session_id,user_id,vote) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,user_id) DO UPDATE SET vote=$4,updated_at=now()",
          [v7(), p.sessionId, user.id, p.vote],
        );
        break;
      case "coldcall:skip":
        await tx.query(
          "UPDATE session_participants SET skip_today=$3 WHERE session_id=$1 AND user_id=$2",
          [p.sessionId, p.userId, p.skip],
        );
        break;
      case "coldcall:pick": {
        const people = (
          await tx.query(
            `SELECT u.id,u.name,p.skip_today,p.last_seen_at,(SELECT count(*) FROM cold_calls c JOIN live_sessions ls ON ls.id=c.session_id WHERE c.picked_user_id=u.id AND ls.section_id IS NOT DISTINCT FROM $2 AND c.at>now()-interval '14 days') picks FROM session_participants p JOIN users u ON u.id=p.user_id JOIN course_members m ON m.user_id=u.id AND m.course_id=$3 WHERE p.session_id=$1 AND m.role='student' AND NOT u.is_admin`,
            [p.sessionId, s.section_id, s.course_id],
          )
        ).rows;
        const selected = pickStudent(
          people.map((r) => ({
            id: r.id,
            picks: Number(r.picks),
            skip: r.skip_today,
            connected: Date.now() - r.last_seen_at.getTime() < 60000,
          })),
        );
        if (!selected) throw new Error("NO_STUDENTS_PRESENT");
        const id = v7();
        if (!p.practice)
          await tx.query(
            "INSERT INTO cold_calls(id,session_id,picked_user_id,picked_by,at) VALUES($1,$2,$3,$4,now())",
            [id, p.sessionId, selected, user.id],
          );
        result = {
          id: p.practice ? null : id,
          userId: selected,
          name: people.find((r) => r.id === selected)?.name,
        };
        break;
      }
      case "coldcall:outcome":
        await tx.query(
          "UPDATE cold_calls SET outcome=$3 WHERE id=$1 AND session_id=$2",
          [p.id, p.sessionId, p.outcome],
        );
        break;
      case "exit:create":
        await tx.query(
          "INSERT INTO exit_tickets(id,session_id,prompt,type,options,required) VALUES($1,$2,$3,$4,$5,$6)",
          [
            v7(),
            p.sessionId,
            p.prompt,
            p.type,
            JSON.stringify(p.options),
            p.required,
          ],
        );
        break;
      case "exit:respond": {
        const t = (
          await tx.query(
            "SELECT * FROM exit_tickets WHERE id=$1 AND session_id=$2",
            [p.ticketId, p.sessionId],
          )
        ).rows[0];
        if (!t) throw new Error("TICKET_NOT_FOUND");
        if (
          t.type === "short_text" &&
          (typeof p.response !== "string" || !p.response.trim())
        )
          throw new Error("ANSWER_REQUIRED");
        if (
          (t.type === "mcq" && !t.options.includes(p.response)) ||
          (t.type === "confidence_1_5" &&
            (!Number.isInteger(p.response) || p.response < 1 || p.response > 5))
        )
          throw new Error("INVALID_RESPONSE");
        await tx.query(
          "INSERT INTO exit_ticket_responses(id,ticket_id,user_id,response,confused_about,at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(ticket_id,user_id) DO UPDATE SET response=$4,confused_about=$5,at=now()",
          [
            v7(),
            p.ticketId,
            user.id,
            JSON.stringify(p.response),
            p.confusedAbout,
          ],
        );
        await tx.query(
          "UPDATE session_participants SET attendance_complete=NOT EXISTS(SELECT 1 FROM exit_tickets t WHERE t.session_id=$1 AND t.required AND NOT EXISTS(SELECT 1 FROM exit_ticket_responses r WHERE r.ticket_id=t.id AND r.user_id=$2)) WHERE session_id=$1 AND user_id=$2",
          [p.sessionId, user.id],
        );
        await tx.query(
          "INSERT INTO outbox(id,kind,payload) VALUES($1,'league:award',$2)",
          [
            v7(),
            JSON.stringify({
              userId: user.id,
              courseId: s.course_id,
              type: "exit_ticket",
              entityId: p.ticketId,
            }),
          ],
        );
        if (s.ended_at)
          await tx.query(
            "INSERT INTO outbox(id,kind,payload) VALUES($1,'session:report',$2)",
            [v7(), JSON.stringify({ sessionId: p.sessionId })],
          );
        break;
      }
      case "session:end":
        await tx.query("UPDATE live_sessions SET ended_at=now() WHERE id=$1", [
          p.sessionId,
        ]);
        await tx.query(
          "UPDATE polls SET status='closed',closed_at=now() WHERE session_id=$1 AND status='open'",
          [p.sessionId],
        );
        await tx.query(
          "UPDATE session_participants p SET attendance_complete=NOT EXISTS(SELECT 1 FROM exit_tickets t WHERE t.session_id=$1 AND t.required AND NOT EXISTS(SELECT 1 FROM exit_ticket_responses r WHERE r.ticket_id=t.id AND r.user_id=p.user_id)) WHERE session_id=$1",
          [p.sessionId],
        );
        await tx.query(
          "INSERT INTO outbox(id,kind,payload) VALUES($1,'session:report',$2)",
          [v7(), JSON.stringify({ sessionId: p.sessionId })],
        );
        break;
    }
    if (staffEvents.has(name))
      await tx.query(
        "INSERT INTO audit_log(id,actor_id,action,entity,entity_id,diff,at) VALUES($1,$2,$3,'live_sessions',$4,$5,now())",
        [v7(), user.id, name, p.sessionId, JSON.stringify(p)],
      );
    return result;
  }, user.id);
}
export async function closeRealtimeRedis() {
  await redis.quit();
}
