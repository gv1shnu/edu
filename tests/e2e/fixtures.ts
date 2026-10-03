import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import { v7 } from "uuid";
import { assertTestAuth } from "../../packages/shared/src/index";

/**
 * Browser-test fixtures: the few people, one course and two batches the specs talk about.
 * Runs once before the suite (Playwright globalSetup), only in test mode, and is idempotent.
 * The app itself ships no sample data; point the test run at a throwaway database.
 */
export const COURSE_SLUG = "sql-from-zero-to-interview";
export const WEEKEND = "Weekend SQL · October";
export const WEEKDAY = "Weekday SQL · October";

const people = [
  ["instructor@example.com", "Vishnu", "instructor", null],
  ["student1@example.com", "Aarav Shah", "student", WEEKEND],
  ["student2@example.com", "Diya Reddy", "student", WEEKEND],
  ["student3@example.com", "Arjun Rao", "student", WEEKEND],
  ["student8@example.com", "Meera Iyer", "student", WEEKDAY],
] as const;

async function id(tx: PoolClient, sql: string, args: unknown[]) {
  return (await tx.query(sql, args)).rows[0]?.id as string | undefined;
}

export default async function globalSetup() {
  if (!assertTestAuth(process.env))
    throw new Error(
      "Browser-test fixtures need NODE_ENV=test and E2E_AUTH_BYPASS=1",
    );
  const pool = new Pool({
    connectionString:
      process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(7310002)");
    const users: Record<string, string> = {};
    for (const [email, name] of people)
      users[email] =
        (await id(tx, "SELECT id FROM users WHERE email=$1", [email])) ??
        (await id(
          tx,
          "INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,true) RETURNING id",
          [v7(), name, email],
        ))!;
    const instructor = users["instructor@example.com"];

    const track =
      (await id(tx, "SELECT id FROM tracks WHERE slug='data'", [])) ??
      (await id(
        tx,
        "INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,'data','Data & SQL','#2563eb','database','Querying and analysing data') RETURNING id",
        [v7()],
      ))!;
    let course = await id(tx, "SELECT id FROM courses WHERE slug=$1", [
      COURSE_SLUG,
    ]);
    if (!course) {
      course = v7();
      await tx.query(
        "INSERT INTO courses(id,track_id,slug,title,subtitle,description_md,owner_id,visibility) VALUES($1,$2,$3,'SQL from Zero to Interview','Write confident SQL for analytics interviews.','Live classes, notes and practice in a small batch.',$4,'published')",
        [course, track, COURSE_SLUG, instructor],
      );
      const module = v7();
      await tx.query(
        "INSERT INTO modules(id,course_id,title,position) VALUES($1,$2,'The foundations',0)",
        [module, course],
      );
      for (const [i, title, preview] of [
        [0, "Why SQL still matters", true],
        [1, "SELECT, WHERE and ORDER BY", false],
        [2, "Joins without fear", false],
      ] as const)
        await tx.query(
          "INSERT INTO lessons(id,module_id,title,type,body_html,position,published,is_free_preview) VALUES($1,$2,$3,'html',$4,$5,true,$6)",
          [
            v7(),
            module,
            title,
            `<h2>${title}</h2><p>Lesson text.</p>`,
            i,
            preview,
          ],
        );
    }
    const sections: Record<string, string> = {};
    for (const name of [WEEKEND, WEEKDAY])
      sections[name] =
        (await id(
          tx,
          "SELECT id FROM sections WHERE course_id=$1 AND name=$2",
          [course, name],
        )) ??
        (await id(
          tx,
          "INSERT INTO sections(id,course_id,name,starts_at) VALUES($1,$2,$3,now()-interval '14 days') RETURNING id",
          [v7(), course, name],
        ))!;
    for (const [email, , role, batch] of people)
      await tx.query(
        "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(course_id,user_id) DO NOTHING",
        [v7(), course, users[email], role, batch ? sections[batch] : null],
      );
    for (const [email, handle, name] of [
      ["student2@example.com", "diya", "Diya Reddy"],
      ["student3@example.com", "arjun", "Arjun Rao"],
    ])
      await tx.query(
        `INSERT INTO profiles(id,user_id,handle,display_name,headline,bio_md,location,visibility,theme,layout,links,pinned_items)
         VALUES($1,$2,$3,$4,'Learning SQL','Analyst in training.','Hyderabad','students_only',$5,$6,'[]','[]') ON CONFLICT(user_id) DO NOTHING`,
        [
          v7(),
          users[email],
          handle,
          name,
          JSON.stringify({
            name: "Mono",
            accent: "#4f46e5",
            background: "solid",
            font: "sans",
            radius: 12,
            card: "outlined",
          }),
          JSON.stringify({
            columns: 2,
            sections: [
              "about",
              "courses",
              "learning",
              "league",
              "activity",
              "links",
            ],
          }),
        ],
      );
    if (
      !(await id(
        tx,
        "SELECT id FROM offerings WHERE course_id=$1 AND title='Full course'",
        [course],
      ))
    )
      await tx.query(
        "INSERT INTO offerings(id,course_id,title,price_inr,billing,active) VALUES($1,$2,'Full course',299900,'one_time',true)",
        [v7(), course],
      );
    if (
      !(await id(
        tx,
        "SELECT id FROM class_notes WHERE course_id=$1 AND title='Week 1 notes'",
        [course],
      ))
    )
      await tx.query(
        "INSERT INTO class_notes(id,course_id,section_id,title,body_html,status,published_at,created_by) VALUES($1,$2,$3,'Week 1 notes','<h2>Filtering</h2><p>WHERE keeps matching rows.</p>','published',now()-interval '7 days',$4)",
        [v7(), course, sections[WEEKEND], instructor],
      );
    if (
      !(await id(
        tx,
        "SELECT id FROM live_sessions WHERE course_id=$1 AND join_code='E2EOLD'",
        [course],
      ))
    ) {
      const session = v7();
      await tx.query(
        "INSERT INTO live_sessions(id,course_id,section_id,title,started_by,join_code,started_at,ended_at) VALUES($1,$2,$3,'Week 1 live class',$4,'E2EOLD',now()-interval '7 days',now()-interval '7 days'+interval '1 hour')",
        [session, course, sections[WEEKEND], instructor],
      );
      await tx.query(
        "INSERT INTO session_participants(id,session_id,user_id,joined_at,last_seen_at,attendance_complete) VALUES($1,$2,$3,now()-interval '7 days',now()-interval '7 days'+interval '55 minutes',true)",
        [v7(), session, users["student1@example.com"]],
      );
    }
    await tx.query("COMMIT");
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
    await pool.end();
  }
}
