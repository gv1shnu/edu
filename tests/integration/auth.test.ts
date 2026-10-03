import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { v7 } from "uuid";
import { createTestDatabase } from "./db";

// Drives Better Auth's real Google sign-in endpoints end to end. Only Google's token
// endpoint is stubbed: it returns an id_token carrying whatever claims a case needs.
const BASE = "http://localhost:3000";
const OWNER = "owner-auth@example.com";

let main: Pool;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let auth: typeof import("../../apps/web/src/server/auth");
let signin: typeof import("../../apps/web/src/server/signin");
let dbModule: typeof import("../../packages/db/src/index");
let courseId = "";
let sectionId = "";

const realFetch = globalThis.fetch;
let claims: Record<string, unknown> = {};

function idToken(payload: Record<string, unknown>) {
  const part = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(payload)}.signature`;
}

let ipCounter = 0;
function cookiesFrom(res: Response) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function googleSignIn(
  profile: { email: string; email_verified?: boolean; name?: string },
  callbackURL = "/auth/complete",
) {
  // A distinct client address per simulated sign-in, so Better Auth's per-IP limiter doesn't trip.
  const ip = `203.0.113.${++ipCounter}`;
  claims = {
    iss: "https://accounts.google.com",
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: "google-" + profile.email,
    email: profile.email,
    email_verified: profile.email_verified ?? true,
    name: profile.name ?? "Test Person",
    picture: "https://lh3.googleusercontent.com/a/test",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const start = await auth.auth.handler(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ provider: "google", callbackURL }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = await start.json();
  const google = new URL(url);
  expect(google.origin).toBe("https://accounts.google.com");
  expect(google.searchParams.get("scope")?.split(" ").sort()).toEqual([
    "email",
    "openid",
    "profile",
  ]);
  // Offline access, so a tutor who later connects Google Calendar has a refresh token.
  expect(google.searchParams.get("access_type")).toBe("offline");
  const callback = await auth.auth.handler(
    new Request(
      `${BASE}/api/auth/callback/google?code=test-code&state=${google.searchParams.get("state")}`,
      { headers: { cookie: cookiesFrom(start), "x-forwarded-for": ip } },
    ),
  );
  const [user] = (
    await main.query("SELECT * FROM users WHERE lower(email)=lower($1)", [
      profile.email,
    ])
  ).rows;
  const sessionCookie = callback.headers
    .getSetCookie()
    .some((c) => c.startsWith("better-auth.session_token="));
  return {
    status: callback.status,
    location: callback.headers.get("location") || "",
    user,
    sessionCookie,
  };
}

beforeAll(async () => {
  database = await createTestDatabase("edu_auth");
  main = database.pool;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ||
      "test-secret-0123456789abcdef0123456789",
    ADMIN_EMAILS: ` ${OWNER.toUpperCase()} , someone-else@example.com`,
  });
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("https://oauth2.googleapis.com/token"))
        return Response.json({
          access_token: "test-access-token",
          id_token: idToken(claims),
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email profile",
        });
      if (url.startsWith("https://"))
        throw new Error("Unexpected network call: " + url);
      return realFetch(input, init);
    },
  );

  dbModule = await import("../../packages/db/src/index");
  auth = await import("../../apps/web/src/server/auth");
  signin = await import("../../apps/web/src/server/signin");

  const owner = v7(),
    track = v7();
  courseId = v7();
  sectionId = v7();
  await main.query(
    "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Course owner','course-owner@example.com',true)",
    [owner],
  );
  await main.query(
    "INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,$2,'Databases','#2563eb','database','')",
    [track, "db-" + track],
  );
  await main.query(
    "INSERT INTO courses(id,track_id,slug,title,subtitle,description_md,owner_id,visibility) VALUES($1,$2,$4,'SQL','','',$3,'published')",
    [courseId, track, owner, "sql-" + courseId],
  );
  await main.query(
    "INSERT INTO sections(id,course_id,name) VALUES($1,$2,'Weekend')",
    [sectionId, courseId],
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await dbModule?.pool.end();
  await database?.drop();
});

describe("Google-only authentication", () => {
  it("creates the owner as admin on first tutor sign-in (ADMIN_EMAILS, case/space-insensitive)", async () => {
    const r = await googleSignIn(
      { email: OWNER, name: "Vishnu" },
      "/auth/complete?tutor=1",
    );
    expect(r.status).toBe(302);
    expect(r.location).toBe("/auth/complete?tutor=1");
    expect(r.sessionCookie).toBe(true);
    expect(r.user).toMatchObject({
      name: "Vishnu",
      is_admin: true,
      email_verified: true,
    });
    expect(await signin.postSignIn(r.user.id, { tutor: true })).toEqual({
      signOut: false,
      location: "/admin",
    });
  });

  it("revokes admin on the next sign-in once the email leaves ADMIN_EMAILS", async () => {
    const before = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "someone-else@example.com";
    try {
      const r = await googleSignIn({ email: OWNER }, "/auth/complete?tutor=1");
      expect(r.user.is_admin).toBe(false);
      expect(await signin.postSignIn(r.user.id, { tutor: true })).toEqual({
        signOut: true,
        location: "/tutor/login?error=not-tutor",
      });
    } finally {
      process.env.ADMIN_EMAILS = before;
    }
    const again = await googleSignIn(
      { email: OWNER },
      "/auth/complete?tutor=1",
    );
    expect(again.user.is_admin).toBe(true);
  });

  it("rejects an unknown email on /tutor/login and grants no staff rights", async () => {
    const r = await googleSignIn(
      { email: "random-person@example.com" },
      "/auth/complete?tutor=1",
    );
    expect(r.user.is_admin).toBe(false);
    const members = await main.query(
      "SELECT role FROM course_members WHERE user_id=$1",
      [r.user.id],
    );
    expect(members.rowCount).toBe(0);
    expect(await signin.postSignIn(r.user.id, { tutor: true })).toEqual({
      signOut: true,
      location: "/tutor/login?error=not-tutor",
    });
    const actor = await auth.actorById(r.user.id);
    expect(actor?.isAdmin).toBe(false);
    expect(actor?.memberships).toEqual([]);
  });

  it("turns a pending staff invite into an instructor on the assigned course", async () => {
    const [owner] = (
      await main.query("SELECT id FROM users WHERE email=$1", [OWNER])
    ).rows;
    await main.query(
      "INSERT INTO staff_invites(id,email,role,invited_by,course_assignments) VALUES($1,$2,'instructor',$3,$4)",
      [
        v7(),
        "new-tutor@example.com",
        owner.id,
        JSON.stringify([{ courseId, sectionId: null }]),
      ],
    );
    const r = await googleSignIn(
      { email: "New-Tutor@example.com" },
      "/auth/complete?tutor=1",
    );
    expect(r.user.is_admin).toBe(false);
    const [member] = (
      await main.query(
        "SELECT course_id,role,section_id FROM course_members WHERE user_id=$1",
        [r.user.id],
      )
    ).rows;
    expect(member).toEqual({
      course_id: courseId,
      role: "instructor",
      section_id: null,
    });
    const [invite] = (
      await main.query(
        "SELECT accepted_at FROM staff_invites WHERE email='new-tutor@example.com'",
      )
    ).rows;
    expect(invite.accepted_at).not.toBeNull();
    expect(await signin.postSignIn(r.user.id, { tutor: true })).toEqual({
      signOut: false,
      location: "/teach",
    });
  });

  it("ignores a revoked staff invite", async () => {
    const [owner] = (
      await main.query("SELECT id FROM users WHERE email=$1", [OWNER])
    ).rows;
    await main.query(
      "INSERT INTO staff_invites(id,email,role,invited_by,course_assignments,revoked_at) VALUES($1,'revoked-tutor@example.com','instructor',$2,$3,now())",
      [v7(), owner.id, JSON.stringify([{ courseId, sectionId: null }])],
    );
    const r = await googleSignIn(
      { email: "revoked-tutor@example.com" },
      "/auth/complete?tutor=1",
    );
    const members = await main.query(
      "SELECT 1 FROM course_members WHERE user_id=$1",
      [r.user.id],
    );
    expect(members.rowCount).toBe(0);
    expect((await signin.postSignIn(r.user.id, { tutor: true })).signOut).toBe(
      true,
    );
  });

  it("rejects an unverified Google email without creating a user or session", async () => {
    const r = await googleSignIn({
      email: "unverified@example.com",
      email_verified: false,
    });
    expect(r.user).toBeUndefined();
    expect(r.sessionCookie).toBe(false);
    expect(r.status).toBe(302);
    expect(r.location).toBe("/login?error=unable_to_get_user_info");
  });

  it("makes any other Google account a student and honours only safe return paths", async () => {
    const r = await googleSignIn({ email: "learner@example.com" });
    expect(r.sessionCookie).toBe(true);
    expect(r.user.is_admin).toBe(false);
    const id = r.user.id;
    expect(await signin.postSignIn(id, { tutor: false })).toEqual({
      signOut: false,
      location: "/dashboard",
    });
    expect(
      (
        await signin.postSignIn(id, {
          tutor: false,
          next: "/courses/sql/checkout",
        })
      ).location,
    ).toBe("/courses/sql/checkout");
    for (const evil of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
    ])
      expect(
        (await signin.postSignIn(id, { tutor: false, next: evil })).location,
      ).toBe("/dashboard");
  });

  it("refuses the test auth bypass in production", async () => {
    const { assertTestAuth } = await import("../../packages/shared/src/index");
    expect(() =>
      assertTestAuth({ NODE_ENV: "production", E2E_AUTH_BYPASS: "1" }),
    ).toThrow();
    expect(
      assertTestAuth({ NODE_ENV: "development", E2E_AUTH_BYPASS: "1" }),
    ).toBe(false);
    expect(assertTestAuth({ NODE_ENV: "test", E2E_AUTH_BYPASS: "1" })).toBe(
      true,
    );
  });
});
