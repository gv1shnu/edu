import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { v7 } from "uuid";
import { createTestDatabase } from "./db";

// Business rules exercised through the real services against a real database and Redis.
let main: Pool;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let dbModule: typeof import("../../packages/db/src/index");
let profiles: typeof import("../../apps/web/src/server/profiles");
let manage: typeof import("../../apps/web/src/server/manage");
let payments: typeof import("../../apps/web/src/server/payments");
let core: typeof import("../../apps/web/src/server/core");
let jobs: typeof import("../../apps/worker/src/jobs");
let live: typeof import("../../apps/realtime/src/service");

const course = v7(),
  track = v7(),
  batchA = v7(),
  batchB = v7(),
  instructor = v7();

async function user(
  name: string,
  sectionId: string | null = batchA,
  role = "student",
) {
  const id = v7();
  await main.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,true)",
    [id, name, `${id}@example.com`],
  );
  if (sectionId)
    await main.query(
      "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,$4,$5)",
      [v7(), course, id, role, sectionId],
    );
  return id;
}
const actor = (id: string) => live.actor(id);

beforeAll(async () => {
  database = await createTestDatabase("edu_rules");
  main = database.pool;
  process.env.PAYMENTS_STUB = "1";
  dbModule = await import("../../packages/db/src/index");
  profiles = await import("../../apps/web/src/server/profiles");
  manage = await import("../../apps/web/src/server/manage");
  payments = await import("../../apps/web/src/server/payments");
  core = await import("../../apps/web/src/server/core");
  jobs = await import("../../apps/worker/src/jobs");
  live = await import("../../apps/realtime/src/service");

  await main.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Tutor','tutor-rules@example.com',true)",
    [instructor],
  );
  await main.query(
    "INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,$2,'Cybersecurity','#16a34a','shield','')",
    [track, "sec-" + track],
  );
  await main.query(
    "INSERT INTO courses(id,track_id,slug,title,subtitle,description_md,owner_id,visibility) VALUES($1,$2,$3,'Rules','','',$4,'published')",
    [course, track, "rules-" + course, instructor],
  );
  for (const [id, name] of [
    [batchA, "Small batch"],
    [batchB, "Big batch"],
  ])
    await main.query(
      "INSERT INTO sections(id,course_id,name) VALUES($1,$2,$3)",
      [id, course, name],
    );
  await main.query(
    "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,'instructor',NULL)",
    [v7(), course, instructor],
  );
});

afterAll(async () => {
  await live?.closeRealtimeRedis();
  core?.redis().disconnect();
  await dbModule?.pool.end();
  await database?.drop();
});

describe("profile privacy", () => {
  async function profile(visibility: string) {
    const id = await user(`Profile ${visibility}`);
    const handle = `${visibility.replace("_", "")}${Date.now() % 100000}`;
    await main.query(
      "INSERT INTO profiles(id,user_id,handle,display_name,headline,bio_md,location,visibility) VALUES($1,$2,$3,$4,'','','',$5)",
      [v7(), id, handle, `Profile ${visibility}`, visibility],
    );
    return { id, handle };
  }
  it("returns 404 for private profiles to everyone but the owner (admins included)", async () => {
    const p = await profile("private");
    const admin = { id: v7(), isAdmin: true, memberships: [] };
    for (const viewer of [null, await actor(await user("Classmate")), admin])
      await expect(profiles.getProfile(p.handle, viewer)).rejects.toMatchObject(
        { status: 404 },
      );
    await expect(
      profiles.getProfile(p.handle, await actor(p.id)),
    ).resolves.toMatchObject({ handle: p.handle });
  });
  it("shows students-only profiles to signed-in users and public ones to anyone", async () => {
    const s = await profile("students_only");
    await expect(profiles.getProfile(s.handle, null)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      profiles.getProfile(s.handle, await actor(await user("Peer"))),
    ).resolves.toBeTruthy();
    const p = await profile("public");
    await expect(profiles.getProfile(p.handle, null)).resolves.toMatchObject({
      handle: p.handle,
    });
  });
});

describe("batch-vs-batch league", () => {
  it("caps points per source per day, ignores replays, and ranks per capita", async () => {
    const league = v7();
    await main.query(
      "INSERT INTO leagues(id,name,season_start,season_end,active) VALUES($1,'October League',now()-interval '7 days',now()+interval '7 days',true)",
      [league],
    );
    // Fresh batches, so members added by other tests don't change the per-capita maths.
    const small = v7(),
      big = v7();
    for (const [id, name] of [
      [small, "Small batch"],
      [big, "Big batch"],
    ])
      await main.query(
        "INSERT INTO sections(id,course_id,name) VALUES($1,$2,$3)",
        [id, course, name],
      );
    for (const s of [small, big])
      await main.query(
        "INSERT INTO league_entries(id,league_id,section_id) VALUES($1,$2,$3)",
        [v7(), league, s],
      );
    // Batch A: 1 student; Batch B: 4 students.
    const solo = await user("Solo", small);
    const crowd = await Promise.all(
      [1, 2, 3, 4].map((i) => user(`Crowd ${i}`, big)),
    );
    const award = (userId: string, type: string, entityId: string, meta = {}) =>
      jobs.awardLeague({ userId, courseId: course, type, entityId, meta });

    // Daily cap: attendance is 5 points, capped at 15 per day.
    for (let i = 0; i < 4; i++) await award(crowd[0], "attendance", v7());
    // Replaying the same event never double-counts.
    const replay = v7();
    await award(crowd[1], "attendance", replay);
    await award(crowd[1], "attendance", replay);
    const points = async (id: string, source: string) =>
      Number(
        (
          await main.query(
            "SELECT coalesce(sum(points),0) n FROM league_points WHERE user_id=$1 AND source=$2",
            [id, source],
          )
        ).rows[0].n,
      );
    expect(await points(crowd[0], "attendance")).toBe(15);
    expect(await points(crowd[1], "attendance")).toBe(5);

    // Exit tickets are 3 points, capped at 9 per day; polls are 1 point each.
    for (let i = 0; i < 4; i++) await award(crowd[2], "exit_ticket", v7());
    await award(crowd[3], "poll_answered", v7());
    await award(crowd[3], "poll_answered", v7());
    expect(await points(crowd[2], "exit_ticket")).toBe(9);
    expect(await points(crowd[3], "poll")).toBe(2);

    // Removed activities (quizzes, challenges, assignments) earn nothing.
    await award(solo, "quiz_submitted", v7(), { score: 1 });
    await award(solo, "challenge", v7());
    await award(solo, "assignment_submitted", v7(), { onTime: true });
    await award(solo, "attendance", v7());
    await award(solo, "attendance", v7());
    await award(solo, "exit_ticket", v7());

    // Totals: small = 13 (1 member → 13/capita), big = 15+5+9+2 = 31 (4 members → 7.75/capita).
    const standings = await manage.league(null, league);
    expect(
      standings.teams.map((t: any) => [t.name, Number(t.points), t.perCapita]),
    ).toEqual([
      ["Small batch", 13, 13],
      ["Big batch", 31, 7.75],
    ]);
  });
});

describe("live classroom engagement", () => {
  async function session() {
    const id = v7();
    await main.query(
      "INSERT INTO live_sessions(id,course_id,section_id,title,started_by,join_code,started_at) VALUES($1,$2,$3,'Live',$4,$5,now())",
      [
        id,
        course,
        batchA,
        instructor,
        Math.random().toString(36).slice(2, 8).toUpperCase(),
      ],
    );
    return id;
  }
  async function present(
    sessionId: string,
    userId: string,
    lastSeen = "now()",
    skip = false,
  ) {
    await main.query(
      `INSERT INTO session_participants(id,session_id,user_id,joined_at,last_seen_at,skip_today) VALUES($1,$2,$3,now(),${lastSeen},$4)`,
      [v7(), sessionId, userId, skip],
    );
  }

  it("cold-call picks only connected, non-skipped students and favours the least picked", async () => {
    const s = await session();
    const fresh = await user("Fresh"),
      busy = await user("Busy"),
      away = await user("Away"),
      skipped = await user("Skipped");
    await present(s, fresh);
    await present(s, busy);
    await present(s, away, "now()-interval '5 minutes'");
    await present(s, skipped, "now()", true);
    // Busy was picked 3 times in this batch within 14 days; an older pick doesn't count.
    const past = await session();
    for (const at of [
      "now()-interval '1 day'",
      "now()-interval '2 days'",
      "now()-interval '3 days'",
      "now()-interval '20 days'",
    ])
      await main.query(
        `INSERT INTO cold_calls(id,session_id,picked_user_id,picked_by,at) VALUES($1,$2,$3,$4,${at})`,
        [v7(), past, busy, instructor],
      );
    const tutor = await actor(instructor);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const r: any = await live.dispatch(tutor, "coldcall:pick", {
        sessionId: s,
        practice: true,
      });
      counts[r.userId] = (counts[r.userId] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual([busy, fresh].sort());
    // Weights 1 vs 1/4 → about 80% fresh.
    expect(counts[fresh] / 300).toBeGreaterThan(0.68);
    // Practice spins save nothing; a real pick is logged.
    expect(
      (await main.query("SELECT 1 FROM cold_calls WHERE session_id=$1", [s]))
        .rowCount,
    ).toBe(0);
    await live.dispatch(tutor, "coldcall:pick", {
      sessionId: s,
      practice: false,
    });
    expect(
      (await main.query("SELECT 1 FROM cold_calls WHERE session_id=$1", [s]))
        .rowCount,
    ).toBe(1);
  });

  it("never exposes who is lost, and signals expire after 3 minutes", async () => {
    const s = await session();
    const lost1 = await user("Lost One"),
      lost2 = await user("Lost Two"),
      calm = await user("Calm");
    for (const u of [lost1, lost2, calm]) await present(s, u);
    for (const u of [lost1, lost2])
      await live.dispatch(await actor(u), "confusion:toggle", {
        sessionId: s,
        active: true,
      });

    const tutorView = await live.snapshot(await actor(instructor), s);
    const peerView = await live.snapshot(await actor(calm), s);
    expect(tutorView.engagement.lost).toBe(2);
    for (const view of [tutorView, peerView]) {
      const text = JSON.stringify(view);
      for (const secret of [lost1, lost2, "Lost One", "Lost Two"])
        expect(text).not.toContain(secret);
    }
    // A student sees only their own state.
    expect((await live.snapshot(await actor(lost1), s)).lost).toBe(true);
    expect(peerView.lost).toBe(false);

    await main.query(
      "UPDATE confusion_signals SET at=now()-interval '4 minutes' WHERE user_id=$1",
      [lost1],
    );
    expect((await live.aggregate(s)).lost).toBe(1);
  });
});

describe("coupons", () => {
  it("never exceeds max_uses under concurrent checkouts", async () => {
    const offering = v7();
    await main.query(
      "INSERT INTO offerings(id,course_id,title,price_inr,billing,active) VALUES($1,$2,'Paid access',299900,'one_time',true)",
      [offering, course],
    );
    await main.query(
      "INSERT INTO coupons(id,code,percent_off,max_uses) VALUES($1,'RACE3',20,3)",
      [v7()],
    );
    const buyers = await Promise.all(
      Array.from({ length: 8 }, (_, i) => user(`Buyer ${i}`, null)),
    );
    const results = await Promise.allSettled(
      buyers.map(async (b) =>
        payments.checkout(await actor(b), offering, "race3"),
      ),
    );
    const ok = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(3);
    for (const r of ok) expect(r.value.amount).toBe(239920);
    const [coupon] = (
      await main.query("SELECT used_count FROM coupons WHERE code='RACE3'")
    ).rows;
    expect(coupon.used_count).toBe(3);
    expect(
      (await main.query("SELECT 1 FROM orders WHERE coupon_code IS NOT NULL"))
        .rowCount,
    ).toBe(3);
  });
});
