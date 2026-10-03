import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { createTestDatabase } from "./db";
import { v7 } from "uuid";
import { createHmac } from "node:crypto";
let main: Pool,
  db: typeof import("../../packages/db/src/index"),
  payments: typeof import("../../apps/web/src/server/payments"),
  live: typeof import("../../apps/realtime/src/service");
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const owner = v7(),
  student = v7(),
  other = v7(),
  course = v7(),
  track = v7(),
  section = v7(),
  session = v7();
beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
  database = await createTestDatabase("edu_it");
  main = database.pool;
  db = await import("../../packages/db/src/index");
  payments = await import("../../apps/web/src/server/payments");
  live = await import("../../apps/realtime/src/service");
  for (const [id, name] of [
    [owner, "Tutor"],
    [student, "Student"],
    [other, "Other"],
  ])
    await main.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,true)",
      [id, name, id + "@example.com"],
    );
  await main.query(
    "INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,$2,'Test','#111111','database','Test')",
    [track, track],
  );
  await main.query(
    "INSERT INTO courses(id,track_id,slug,title,subtitle,description_md,owner_id,visibility) VALUES($1,$2,$4,'Test','Test','Test',$3,'published')",
    [course, track, owner, course],
  );
  await main.query(
    "INSERT INTO sections(id,course_id,name) VALUES($1,$2,'Test batch')",
    [section, course],
  );
  for (const [id, role] of [
    [owner, "instructor"],
    [student, "student"],
    [other, "student"],
  ])
    await main.query(
      "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,$4,$5)",
      [v7(), course, id, role, section],
    );
  await main.query(
    "INSERT INTO live_sessions(id,course_id,section_id,title,started_by,join_code,started_at) VALUES($1,$2,$3,'Test live',$4,'TST001',now())",
    [session, course, section, owner],
  );
});
afterAll(async () => {
  await live?.closeRealtimeRedis();
  await db?.pool.end();
  await database?.drop();
});
describe("database-backed services", () => {
  it("paused chat rejects student and accepts instructor", async () => {
    const s = await live.actor(student),
      t = await live.actor(owner);
    await live.dispatch(t, "chat:setState", {
      sessionId: session,
      state: "paused",
    });
    await expect(
      live.dispatch(s, "chat:send", {
        sessionId: session,
        body: "Can I post?",
        kind: "message",
      }),
    ).rejects.toThrow("CHAT_PAUSED");
    await expect(
      live.dispatch(t, "chat:send", {
        sessionId: session,
        body: "Instructor announcement",
        kind: "message",
      }),
    ).resolves.toHaveProperty("id");
  });
  it("poll response changes upsert a single row", async () => {
    const t = await live.actor(owner),
      s = await live.actor(student);
    const poll = await live.dispatch(t, "poll:create", {
      sessionId: session,
      prompt: "Pick one",
      type: "single",
      options: ["A", "B"],
      anonymous: false,
      resultsVisibility: "live",
    });
    await live.dispatch(t, "poll:open", {
      sessionId: session,
      pollId: poll.id,
    });
    await live.dispatch(s, "poll:respond", {
      sessionId: session,
      pollId: poll.id,
      response: "A",
    });
    await live.dispatch(s, "poll:respond", {
      sessionId: session,
      pollId: poll.id,
      response: "B",
    });
    const result = await main.query(
      "SELECT * FROM poll_responses WHERE poll_id=$1",
      [poll.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].response).toBe("B");
  });
  it("confusion aggregates never include identities and pace votes upsert", async () => {
    const s = await live.actor(student);
    await live.dispatch(s, "session:join", { sessionId: session });
    await live.dispatch(s, "confusion:toggle", {
      sessionId: session,
      active: true,
    });
    const counts = await live.aggregate(session);
    expect(counts.lost).toBe(1);
    expect(JSON.stringify(counts)).not.toContain(student);
    await live.dispatch(s, "pace:vote", {
      sessionId: session,
      vote: "too_fast",
    });
    await live.dispatch(s, "pace:vote", {
      sessionId: session,
      vote: "just_right",
    });
    expect(
      (
        await main.query(
          "SELECT * FROM pace_votes WHERE session_id=$1 AND user_id=$2",
          [session, student],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("staff never become learners, including legacy attendance and signals", async () => {
    const t = await live.actor(owner),
      s = await live.actor(student);
    await live.dispatch(t, "session:join", { sessionId: session });
    await live.dispatch(t, "presence:ping", { sessionId: session });
    expect(
      (
        await main.query(
          "SELECT * FROM session_participants WHERE session_id=$1 AND user_id=$2",
          [session, owner],
        )
      ).rows,
    ).toHaveLength(0);
    await live.dispatch(s, "session:join", { sessionId: session });
    for (const [event, payload] of [
      ["pace:vote", { vote: "too_fast" }],
      ["confusion:toggle", { active: true }],
    ] as const)
      await expect(
        live.dispatch(t, event, { sessionId: session, ...payload }),
      ).rejects.toThrow("FORBIDDEN");
    await main.query(
      "INSERT INTO session_participants(id,session_id,user_id,joined_at,last_seen_at,attendance_complete) VALUES($1,$2,$3,now(),now(),true)",
      [v7(), session, owner],
    );
    await main.query(
      "INSERT INTO confusion_signals(id,session_id,user_id,at) VALUES($1,$2,$3,now())",
      [v7(), session, owner],
    );
    await main.query(
      "INSERT INTO pace_votes(id,session_id,user_id,vote) VALUES($1,$2,$3,'too_fast')",
      [v7(), session, owner],
    );
    expect(await live.aggregate(session)).toMatchObject({
      participants: 1,
      lost: 1,
      pace: { just_right: 1 },
    });
    expect((await live.aggregate(session)).pace.too_fast).toBeUndefined();
    const manage = await import("../../apps/web/src/server/manage");
    const report = await db.withUser(owner, () => manage.report(t, session));
    expect(report.attendance.map((r) => r.name)).toEqual(["Student"]);
    const analytics = await db.withUser(owner, () =>
      manage.analytics(t, course),
    );
    expect(analytics.progress.length).toBeGreaterThan(0);
    for (const row of analytics.progress)
      expect(typeof row.completion).toBe("number");
  });
  it("ten concurrent payment webhooks all enrol (no seat limits) and replay is idempotent", async () => {
    const sid = v7(),
      offering = v7();
    await main.query(
      "INSERT INTO sections(id,course_id,name) VALUES($1,$2,'Race batch')",
      [sid, course],
    );
    await main.query(
      "INSERT INTO offerings(id,course_id,section_id,title,price_inr) VALUES($1,$2,$3,'Race offering',100)",
      [offering, course, sid],
    );
    const bodies = [];
    for (let i = 0; i < 10; i++) {
      const uid = v7(),
        oid = v7();
      await main.query("INSERT INTO users(id,name,email) VALUES($1,$2,$3)", [
        uid,
        "Race " + i,
        uid + "@example.com",
      ]);
      await main.query(
        "INSERT INTO orders(id,user_id,offering_id,amount_paise,razorpay_order_id) VALUES($1,$2,$3,100,$4)",
        [oid, uid, offering, "order_" + oid],
      );
      bodies.push(
        JSON.stringify({
          event: "payment.captured",
          payload: {
            payment: {
              entity: {
                id: "pay_" + oid,
                order_id: "order_" + oid,
                amount: 100,
                currency: "INR",
              },
            },
          },
        }),
      );
    }
    const send = (body: string, i: number) =>
      payments.processWebhook(
        body,
        createHmac("sha256", "test-webhook-secret").update(body).digest("hex"),
        "race-" + i,
      );
    await Promise.all(bodies.map(send));
    await Promise.all(bodies.map(send));
    expect(
      Number(
        (
          await main.query(
            "SELECT count(*) n FROM course_members WHERE section_id=$1",
            [sid],
          )
        ).rows[0].n,
      ),
    ).toBe(10);
    expect(
      Number(
        (
          await main.query(
            "SELECT count(*) n FROM orders WHERE offering_id=$1 AND status='paid'",
            [offering],
          )
        ).rows[0].n,
      ),
    ).toBe(10);
    expect(
      Number(
        (await main.query("SELECT count(*) n FROM webhook_events")).rows[0].n,
      ),
    ).toBe(10);
  });

  it("monthly offerings expire, drop access, and renewals extend from the current expiry", async () => {
    const offering = v7(),
      uid = v7();
    await main.query(
      "INSERT INTO offerings(id,course_id,title,price_inr,billing) VALUES($1,$2,'Monthly access',99900,'monthly')",
      [offering, course],
    );
    await main.query("INSERT INTO users(id,name,email) VALUES($1,$2,$3)", [
      uid,
      "Monthly learner",
      uid + "@example.com",
    ]);
    const pay = async () => {
      const oid = v7();
      await main.query(
        "INSERT INTO orders(id,user_id,offering_id,amount_paise,razorpay_order_id) VALUES($1,$2,$3,99900,$4)",
        [oid, uid, offering, "order_" + oid],
      );
      const body = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_" + oid,
              order_id: "order_" + oid,
              amount: 99900,
              currency: "INR",
            },
          },
        },
      });
      await payments.processWebhook(
        body,
        createHmac("sha256", "test-webhook-secret").update(body).digest("hex"),
        "monthly-" + oid,
      );
    };
    const until = async () =>
      new Date(
        (
          await main.query(
            "SELECT access_until FROM course_members WHERE user_id=$1 AND course_id=$2",
            [uid, course],
          )
        ).rows[0].access_until,
      ).getTime();
    const auth = await import("../../apps/web/src/server/auth");
    await pay();
    const first = await until();
    expect(first - Date.now()).toBeGreaterThan(27 * 864e5);
    expect(
      (await auth.actorById(uid))!.memberships.map((m) => m.courseId),
    ).toContain(course);
    await pay();
    expect((await until()) - first).toBeGreaterThan(27 * 864e5);
    await main.query(
      "UPDATE course_members SET access_until=now()-interval '1 day' WHERE user_id=$1",
      [uid],
    );
    expect(
      (await auth.actorById(uid))!.memberships.map((m) => m.courseId),
    ).not.toContain(course);
    expect(
      (await live.actor(uid)).memberships.map((m) => m.courseId),
    ).not.toContain(course);
    await pay();
    expect(await until()).toBeGreaterThan(Date.now() + 27 * 864e5);
    expect(
      (await auth.actorById(uid))!.memberships.map((m) => m.courseId),
    ).toContain(course);
  });
  it("scheduling a class puts it on the tutor's Google Calendar with the batch invited", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://edu.example.com";
    const manage = await import("../../apps/web/src/server/manage");
    const jobs = await import("../../apps/worker/src/jobs");
    await main.query(
      "INSERT INTO accounts(id,account_id,provider_id,user_id,refresh_token,scope) VALUES($1,'g-owner','google',$2,'refresh-1','openid,email,profile,https://www.googleapis.com/auth/calendar.events')",
      [v7(), owner],
    );
    const t = await live.actor(owner);
    const startsAt = new Date(Date.now() + 864e5);
    const { id } = await db.withUser(owner, () =>
      manage.startLive(t, {
        courseId: course,
        sectionId: section,
        title: "Window functions",
        scheduledAt: startsAt.toISOString(),
        durationMin: 90,
      }),
    );
    const [queued] = (
      await main.query("SELECT payload FROM outbox WHERE kind='calendar:event'")
    ).rows;
    expect(queued.payload).toEqual({ sessionId: id });

    const calls: { url: string; body: any }[] = [];
    const fetch = vi.fn(async (url: string, init: any) => {
      calls.push({
        url,
        body: url.includes("oauth2")
          ? String(init.body)
          : JSON.parse(init.body),
      });
      return Response.json(
        url.includes("oauth2") ? { access_token: "access-1" } : { id: "evt-1" },
      );
    });
    vi.stubGlobal("fetch", fetch);
    try {
      await db.asSystem(() => jobs.calendarEvent({ sessionId: id }));
      // A retry after success does nothing.
      await db.asSystem(() => jobs.calendarEvent({ sessionId: id }));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toContain("refresh_token=refresh-1");
    const event = calls[1].body;
    expect(calls[1].url).toContain("calendars/primary/events?sendUpdates=all");
    expect(event.attendees.map((a: any) => a.email).sort()).toEqual(
      [student + "@example.com", other + "@example.com"].sort(),
    );
    expect(
      new Date(event.end.dateTime).getTime() -
        new Date(event.start.dateTime).getTime(),
    ).toBe(90 * 60000);
    expect(event.description).toContain(`https://edu.example.com/live/${id}`);
    expect(event).not.toHaveProperty("conferenceData");
    expect(
      (
        await main.query(
          "SELECT calendar_event_id FROM live_sessions WHERE id=$1",
          [id],
        )
      ).rows[0].calendar_event_id,
    ).toBe("evt-1");
  });
  it("stores lesson and notes HTML only after sanitising it", async () => {
    const content = await import("../../apps/web/src/server/content");
    const t = await live.actor(owner);
    const { id } = await db.withUser(owner, () =>
      content.saveNote(
        {
          course_id: course,
          section_id: section,
          title: "Joins",
          body_html:
            '<h2>Inner join</h2><p onclick="steal()">Rows that match.</p><script>alert(1)</script><iframe src="https://www.youtube.com/embed/x"></iframe>',
          status: "draft",
        },
        t,
      ),
    );
    const [note] = (
      await main.query("SELECT body_html FROM class_notes WHERE id=$1", [id])
    ).rows;
    expect(note.body_html).toBe(
      '<h2 id="h-inner-join">Inner join</h2><p>Rows that match.</p>',
    );
  });
});
