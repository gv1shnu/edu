import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { v7 } from "uuid";
import { createTestDatabase } from "./db";

// DPDP flows: a complete personal-data export, and erasure that keeps only what must be kept.
let owner: Pool;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("../../packages/db/src/index");
const me = v7(),
  other = v7(),
  course = v7(),
  section = v7(),
  live = v7(),
  offering = v7(),
  email = `learner-${me}@example.com`;

beforeAll(async () => {
  database = await createTestDatabase("edu_account");
  owner = database.pool;
  db = await import("../../packages/db/src/index");
  const q = (sql: string, args: unknown[] = []) => owner.query(sql, args);
  await q(
    "INSERT INTO users(id,name,email,email_verified,phone,image) VALUES($1,'Priya Learner',$2,true,'+91 90000 00000','https://lh3.googleusercontent.com/a/p')",
    [me, email],
  );
  await q(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Other','other@example.com',true)",
    [other],
  );
  const track = v7();
  await q(
    "INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,$2,'T','#111111','x','')",
    [track, "t" + track],
  );
  await q(
    "INSERT INTO courses(id,track_id,slug,title,subtitle,description_md,owner_id,visibility) VALUES($1,$2,$3,'SQL','','',$4,'published')",
    [course, track, "c" + course, other],
  );
  await q("INSERT INTO sections(id,course_id,name) VALUES($1,$2,'Weekend')", [
    section,
    course,
  ]);
  await q(
    "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,'student',$4)",
    [v7(), course, me, section],
  );
  await q(
    "INSERT INTO accounts(id,account_id,provider_id,user_id,access_token,refresh_token,id_token) VALUES($1,'g-1','google',$2,'secret-access','secret-refresh','secret-id')",
    [v7(), me],
  );
  await q(
    "INSERT INTO sessions(id,user_id,token,expires_at,ip_address,user_agent) VALUES($1,$2,'secret-session-token',now()+interval '1 day','203.0.113.9','Firefox')",
    [v7(), me],
  );
  await q(
    "INSERT INTO profiles(id,user_id,handle,display_name,headline,bio_md,location,visibility,banner_r2_key) VALUES($1,$2,'priya','Priya L','Data nerd','Hi!','Hyderabad','public','banners/priya.webp')",
    [v7(), me],
  );
  await q(
    "INSERT INTO offerings(id,course_id,title,price_inr) VALUES($1,$2,'Full course',299900)",
    [offering, course],
  );
  await q(
    "INSERT INTO orders(id,user_id,offering_id,amount_paise,status,paid_at,receipt_number) VALUES($1,$2,$3,299900,'paid',now(),'VG-2026-000042')",
    [v7(), me, offering],
  );
  await q(
    "INSERT INTO live_sessions(id,course_id,section_id,title,started_by,join_code,started_at) VALUES($1,$2,$3,'Live','" +
      other +
      "','ACC001',now())",
    [live, course, section],
  );
  await q(
    "INSERT INTO chat_messages(id,session_id,user_id,body,kind) VALUES($1,$2,$3,'My phone is 90000 00000','message')",
    [v7(), live, me],
  );
  await q(
    "INSERT INTO session_participants(id,session_id,user_id,joined_at,last_seen_at,attendance_complete) VALUES($1,$2,$3,now(),now(),true)",
    [v7(), live, me],
  );
  await q(
    "INSERT INTO exit_tickets(id,session_id,prompt,type,options,required) VALUES($1,$2,'How was it?','short_text','[]',true)",
    [v7(), live],
  );
  await q(
    "INSERT INTO exit_ticket_responses(id,ticket_id,user_id,response,confused_about,at) SELECT $1,id,$2,'\"good\"','window functions',now() FROM exit_tickets WHERE session_id=$3",
    [v7(), me, live],
  );
  await q(
    "INSERT INTO notifications(id,user_id,kind,title,body,link) VALUES($1,$2,'notes','Notes are up','x','/x')",
    [v7(), me],
  );
  await q(
    "INSERT INTO events(id,user_id,course_id,type,entity_id,meta,at) VALUES($1,$2,$3,'lesson_viewed',$3,'{}',now())",
    [v7(), me, course],
  );
  await q(
    "INSERT INTO uploads(id,user_id,course_id,r2_key,filename,mime,size_bytes,verified) VALUES($1,$2,$3,'uploads/priya-avatar.webp','me.webp','image/webp',100,true)",
    [v7(), me, course],
  );
  await q(
    "INSERT INTO staff_invites(id,email,role,invited_by) VALUES($1,$2,'instructor',$3)",
    [v7(), email, other],
  );
});

afterAll(async () => {
  await db?.pool.end();
  await database?.drop();
});

describe("Download my data", () => {
  it("includes every category of personal data but no secrets", async () => {
    const data: any = await db.asSystem(() =>
      db.transaction((tx) => db.collectAccountData(tx, me)),
    );
    expect(data.user).toMatchObject({
      email,
      name: "Priya Learner",
      phone: "+91 90000 00000",
    });
    expect(data.profile).toMatchObject({ handle: "priya" });
    expect(data.orders[0]).toMatchObject({ receipt_number: "VG-2026-000042" });
    expect(data.chat_messages[0].body).toContain("phone");
    expect(data.exit_ticket_responses[0].confused_about).toBe(
      "window functions",
    );
    expect(data.live_attendance).toHaveLength(1);
    expect(data.sign_in_sessions[0]).toMatchObject({
      ip_address: "203.0.113.9",
    });
    expect(data.google_accounts[0]).toMatchObject({ provider_id: "google" });
    expect(data.enrolments[0]).toMatchObject({
      course: "SQL",
      batch: "Weekend",
    });
    expect(data.activity_events).toHaveLength(1);
    const text = JSON.stringify(data);
    for (const secret of [
      "secret-access",
      "secret-refresh",
      "secret-id",
      "secret-session-token",
    ])
      expect(text).not.toContain(secret);
  });
});

describe("Delete my account", () => {
  it("erases identifying data, keeps financial and anonymised records, and lists files to purge", async () => {
    const { files } = await db.asSystem(() =>
      db.transaction((tx) => db.eraseAccount(tx, me)),
    );
    expect(files.sort()).toEqual([
      "banners/priya.webp",
      "uploads/priya-avatar.webp",
    ]);
    const one = async (sql: string) => (await owner.query(sql, [me])).rows;

    expect(
      (
        await one(
          "SELECT name,email,phone,image,email_verified,deleted_at IS NOT NULL deleted FROM users WHERE id=$1",
        )
      )[0],
    ).toEqual({
      name: "Deleted learner",
      email: `deleted-${me}@invalid.local`,
      phone: null,
      image: null,
      email_verified: false,
      deleted: true,
    });
    for (const table of [
      "profiles",
      "sessions",
      "accounts",
      "notifications",
      "events",
      "uploads",
      "course_members",
    ])
      expect(
        await one(`SELECT 1 FROM ${table} WHERE user_id=$1`),
        table,
      ).toHaveLength(0);
    expect(
      (await one("SELECT body FROM chat_messages WHERE user_id=$1"))[0].body,
    ).toBe("[removed]");
    expect(
      (
        await one(
          "SELECT confused_about FROM exit_ticket_responses WHERE user_id=$1",
        )
      )[0].confused_about,
    ).toBe("");
    // Kept: financial record and anonymised attendance for course statistics.
    expect(
      await one("SELECT receipt_number FROM orders WHERE user_id=$1"),
    ).toEqual([{ receipt_number: "VG-2026-000042" }]);
    expect(
      await one("SELECT 1 FROM session_participants WHERE user_id=$1"),
    ).toHaveLength(1);
    // A pending staff invite for that email can no longer be used.
    expect(
      (
        await owner.query(
          "SELECT revoked_at FROM staff_invites WHERE email=$1",
          [email],
        )
      ).rows[0].revoked_at,
    ).not.toBeNull();
    // Nothing identifying survives anywhere in the export either.
    const after = JSON.stringify(
      await db.asSystem(() =>
        db.transaction((tx) => db.collectAccountData(tx, me)),
      ),
    );
    for (const pii of [
      email,
      "Priya",
      "90000",
      "Hyderabad",
      "window functions",
    ])
      expect(after).not.toContain(pii);
  });
});
