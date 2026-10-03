import { query } from "@edu/db";
import { actorById } from "./auth";

/**
 * Where a user goes after Google returns. On the tutor entry point, anyone who
 * is not an admin, an accepted staff invitee or course staff is signed out.
 */
export async function postSignIn(
  userId: string,
  opts: { tutor: boolean; next?: string | null },
): Promise<{ signOut: boolean; location: string }> {
  const u = await actorById(userId);
  if (!u) return { signOut: false, location: "/login" };
  const [email] = await query<{ email: string }>(
    "SELECT email FROM users WHERE id=$1",
    [userId],
  );
  const [staff] = await query(
    "SELECT id FROM staff_invites WHERE lower(email)=lower($1) AND accepted_at IS NOT NULL AND revoked_at IS NULL",
    [email.email],
  );
  const isStaff = !!staff || u.memberships.some((m) => m.role !== "student");
  if (opts.tutor && !u.isAdmin && !isStaff)
    return { signOut: true, location: "/tutor/login?error=not-tutor" };
  const next = opts.next;
  const safe =
    !!next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\");
  return {
    signOut: false,
    location: safe
      ? next!
      : u.isAdmin
        ? "/admin"
        : isStaff
          ? "/teach"
          : "/dashboard",
  };
}
