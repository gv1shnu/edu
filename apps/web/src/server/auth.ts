import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  db,
  users,
  sessions,
  accounts,
  verifications,
  query,
  transaction,
} from "@edu/db";
import { v7 } from "uuid";
import { assertTestAuth, googleIdentity, type Actor } from "@edu/shared";
import { headers } from "next/headers";
assertTestAuth(process.env);
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "not-configured",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "not-configured",
      // Offline access gives a refresh token, which the worker needs to put scheduled classes
      // on a tutor's Google Calendar once they connect it (see CalendarConnect).
      accessType: "offline",
      // Better Auth always requests exactly openid, email and profile; adding them again duplicates them.
      // Only verified Google emails may sign in. Returning null makes Better Auth redirect to
      // errorURL with error=unable_to_get_user_info instead of failing with a 500.
      async getUserInfo(token) {
        if (!token.idToken) return null;
        const profile = JSON.parse(
          Buffer.from(
            token.idToken.split(".")[1] ?? "",
            "base64url",
          ).toString(),
        );
        if (profile.email_verified !== true || !profile.email) return null;
        return {
          user: {
            id: profile.sub,
            name: profile.name,
            email: profile.email,
            image: profile.picture,
            emailVerified: true,
          },
          data: profile,
        };
      },
    },
  },
  user: {
    additionalFields: {
      isAdmin: { type: "boolean", defaultValue: false, input: false },
      timezone: { type: "string", defaultValue: "Asia/Kolkata" },
      emailEnabled: { type: "boolean", defaultValue: true },
    },
  },
  advanced: {
    database: { generateId: () => v7() },
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          await transaction(async (tx) => {
            const u = (
              await tx.query("SELECT * FROM users WHERE id=$1", [
                session.userId,
              ])
            ).rows[0];
            const identity = googleIdentity(
              u.email,
              u.email_verified,
              process.env.ADMIN_EMAILS || "",
            );
            await tx.query(
              "UPDATE users SET is_admin=$2,updated_at=now() WHERE id=$1",
              [u.id, identity.isAdmin],
            );
            const invites = (
              await tx.query(
                "UPDATE staff_invites SET accepted_at=coalesce(accepted_at,now()) WHERE lower(email)=lower($1) AND revoked_at IS NULL RETURNING role,course_assignments",
                [u.email],
              )
            ).rows;
            for (const invite of invites)
              for (const assignment of invite.course_assignments) {
                await tx.query(
                  "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(course_id,user_id) DO UPDATE SET role=$4,section_id=$5",
                  [
                    v7(),
                    assignment.courseId,
                    u.id,
                    invite.role,
                    assignment.sectionId,
                  ],
                );
              }
          });
          return { data: session };
        },
      },
    },
  },
  onAPIError: { errorURL: "/login" },
  rateLimit: { enabled: true, window: 60, max: 30 },
});
export async function actorById(id: string): Promise<Actor | null> {
  const [u] = await query(
    "SELECT id,is_admin FROM users WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  if (!u) return null;
  const rows = await query(
    "SELECT course_id,role,section_id FROM course_members WHERE user_id=$1 AND (role<>'student' OR access_until IS NULL OR access_until>now())",
    [id],
  );
  return {
    id: u.id,
    isAdmin: u.is_admin,
    memberships: rows.map((m) => ({
      courseId: m.course_id,
      role: m.role,
      sectionId: m.section_id,
    })),
  };
}
export async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const actor = await actorById(session.user.id);
  return actor
    ? {
        ...actor,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : null;
}
