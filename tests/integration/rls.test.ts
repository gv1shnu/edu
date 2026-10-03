import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { v7 } from "uuid";
import { createTestDatabase } from "./db";

// Defence in depth: even if application code forgot a can() check, the runtime database role
// only returns rows the current user may see in the RLS-protected tables.
let owner: Pool;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("../../packages/db/src/index");

const ids = {
  course: v7(),
  track: v7(),
  batchA: v7(),
  batchB: v7(),
  instructor: v7(),
  alice: v7(), // student, batch A
  bob: v7(), // student, batch B
  outsider: v7(), // not enrolled
  admin: v7(),
  live: v7(),
  poll: v7(),
};

beforeAll(async () => {
  database = await createTestDatabase("edu_rls");
  owner = database.pool;
  db = await import("../../packages/db/src/index");
  const q = (sql: string, args: unknown[]) => owner.query(sql, args);
  for (const [id, name, admin] of [
    [ids.instructor, "Instructor", false],
    [ids.alice, "Alice", false],
    [ids.bob, "Bob", false],
    [ids.outsider, "Outsider", false],
    [ids.admin, "Admin", true],
  ] as const)
    await q(
      "INSERT INTO users(id,name,email,email_verified,is_admin) VALUES($1,$2,$3,true,$4)",
      [id, name, `${id}@example.com`, admin],
    );
  await q(
    "INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,$2,'T','#111111','x','')",
    [ids.track, "t-" + ids.track],
  );
  await q(
    "INSERT INTO courses(id,track_id,slug,title,subtitle,description_md,owner_id,visibility) VALUES($1,$2,$3,'C','','',$4,'published')",
    [ids.course, ids.track, "c-" + ids.course, ids.instructor],
  );
  for (const s of [ids.batchA, ids.batchB])
    await q("INSERT INTO sections(id,course_id,name) VALUES($1,$2,'B')", [
      s,
      ids.course,
    ]);
  for (const [user, role, section] of [
    [ids.instructor, "instructor", null],
    [ids.alice, "student", ids.batchA],
    [ids.bob, "student", ids.batchB],
  ])
    await q(
      "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,$4,$5)",
      [v7(), ids.course, user, role, section],
    );
  await q(
    "INSERT INTO live_sessions(id,course_id,section_id,title,started_by,join_code,started_at) VALUES($1,$2,$3,'Live',$4,'RLS001',now())",
    [ids.live, ids.course, ids.batchA, ids.instructor],
  );
  await q(
    "INSERT INTO polls(id,session_id,prompt,type,options,anonymous,results_visibility,status) VALUES($1,$2,'P','yes_no','[]',false,'live','open')",
    [ids.poll, ids.live],
  );
  for (const student of [ids.alice, ids.bob])
    await q(
      "INSERT INTO poll_responses(id,poll_id,user_id,response,answered_at) VALUES($1,$2,$3,'\"yes\"',now())",
      [v7(), ids.poll, student],
    );
  await q(
    "INSERT INTO chat_messages(id,session_id,user_id,body,kind) VALUES($1,$2,$3,'hello','message')",
    [v7(), ids.live, ids.alice],
  );
});

afterAll(async () => {
  await db?.pool.end();
  await database?.drop();
});

const owners = (table: string) =>
  db.query<{ user_id: string }>(`SELECT user_id FROM ${table}`);
const as = (user: string | null, table: string) =>
  db.withUser(user, async () =>
    (await owners(table)).map((r) => r.user_id).sort(),
  );
const tables = ["poll_responses", "chat_messages"];

describe("row-level security under the runtime role", () => {
  it("connects as a role that is neither superuser nor BYPASSRLS", async () => {
    const [role] = await db.query(
      "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    expect(role).toEqual({
      name: "edu_app",
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it.each(tables)(
    "%s: no user context sees nothing (fails closed)",
    async (table) => {
      expect(await db.query(`SELECT 1 FROM ${table}`)).toHaveLength(0);
    },
  );

  it("poll_responses: a student sees exactly their own rows", async () => {
    expect(await as(ids.bob, "poll_responses")).toEqual([ids.bob]);
    expect(await as(ids.alice, "poll_responses")).toEqual([ids.alice]);
    expect(await as(ids.outsider, "poll_responses")).toEqual([]);
  });

  it("the instructor and admin see every poll response", async () => {
    const both = [ids.alice, ids.bob].sort();
    expect(await as(ids.instructor, "poll_responses")).toEqual(both);
    expect(await as(ids.admin, "poll_responses")).toEqual(both);
  });

  it("chat is readable by members of the session's batch only", async () => {
    expect(await as(ids.alice, "chat_messages")).toEqual([ids.alice]);
    expect(await as(ids.bob, "chat_messages")).toEqual([]);
    expect(await as(ids.outsider, "chat_messages")).toEqual([]);
  });

  it("a student cannot write rows as someone else", async () => {
    await expect(
      db.withUser(ids.bob, () =>
        db.query(
          "INSERT INTO chat_messages(id,session_id,user_id,body,kind) VALUES($1,$2,$3,'forged','message')",
          [v7(), ids.live, ids.alice],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await db.withUser(ids.bob, () =>
      db.query(
        "UPDATE poll_responses SET response='\"no\"' WHERE user_id=$1 RETURNING id",
        [ids.alice],
      ),
    );
    expect(updated).toHaveLength(0);
  });

  it("system context (worker jobs) sees every row", async () => {
    for (const table of tables)
      expect((await db.asSystem(() => owners(table))).length).toBeGreaterThan(
        0,
      );
  });

  it("never leaks one user's identity to the next borrower of a pooled connection", async () => {
    await db.withUser(ids.alice, () => db.query("SELECT 1"));
    // Same pool, no context: must behave as anonymous, not as Alice.
    expect(
      await db.query("SELECT current_setting('app.user_id',true) AS u"),
    ).toEqual([{ u: "" }]);
    expect(await db.query("SELECT 1 FROM poll_responses")).toHaveLength(0);
  });
});
