import { query, transaction } from "@edu/db";
import { type Actor, can, profileSchema } from "@edu/shared";
import { v7 } from "uuid";
import { permit, HttpError, audit } from "./core";
export const defaultProfile = {
  handle: "",
  display_name: "",
  headline: "",
  bio_md: "",
  location: "",
  links: [],
  visibility: "students_only",
  theme: {
    name: "Mono",
    accent: "#4f46e5",
    background: "solid",
    font: "sans",
    radius: 12,
    card: "outlined",
  },
  layout: {
    columns: 2,
    sections: ["about", "courses", "learning", "league", "activity", "links"],
  },
  pinned_items: [],
  currently_learning: [],
};
export async function getProfile(handle: string, user: Actor | null) {
  const [p] = await query(
    "SELECT p.*,u.image FROM profiles p JOIN users u ON u.id=p.user_id WHERE handle=$1 AND u.deleted_at IS NULL",
    [handle],
  );
  if (
    !p ||
    !(await can(user, "profile:read", {
      visibility: p.visibility,
      userId: p.user_id,
    }))
  )
    throw new HttpError(404, "Profile not found");
  const courses = await query(
    "SELECT c.title,t.name track_name,t.accent_color,p.completion FROM course_members m JOIN courses c ON c.id=m.course_id JOIN tracks t ON t.id=c.track_id LEFT JOIN v_course_progress p ON p.user_id=m.user_id AND p.course_id=c.id WHERE m.user_id=$1",
    [p.user_id],
  );
  const activity = await query(
    "SELECT at::date AS day,count(*) AS count FROM events WHERE user_id=$1 AND at>now()-interval '90 days' GROUP BY at::date",
    [p.user_id],
  );
  return { ...p, courses, activity };
}
export async function saveProfile(user: Actor, input: unknown) {
  await permit(user, "profile:edit", { userId: user.id });
  const p = profileSchema.parse(input);
  return transaction(async (tx) => {
    const old = (
      await tx.query("SELECT * FROM profiles WHERE user_id=$1 FOR UPDATE", [
        user.id,
      ])
    ).rows[0];
    if (
      old &&
      old.handle !== p.handle &&
      old.handle_changed_at &&
      Date.now() - old.handle_changed_at.getTime() < 30 * 864e5
    )
      throw new HttpError(400, "You can change your handle once every 30 days");
    for (const pin of p.pinned_items)
      if (
        !(
          await tx.query(
            "SELECT course_id FROM v_course_progress WHERE course_id=$1 AND user_id=$2 AND completion=100",
            [pin.id, user.id],
          )
        ).rowCount
      )
        throw new HttpError(400, "Only completed courses can be pinned");
    await tx.query(
      `INSERT INTO profiles(id,user_id,handle,display_name,headline,bio_md,location,links,visibility,theme,layout,pinned_items,currently_learning,handle_changed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) ON CONFLICT(user_id) DO UPDATE SET handle=$3,display_name=$4,headline=$5,bio_md=$6,location=$7,links=$8,visibility=$9,theme=$10,layout=$11,pinned_items=$12,currently_learning=$13,handle_changed_at=CASE WHEN profiles.handle<>$3 THEN now() ELSE profiles.handle_changed_at END,updated_at=now()`,
      [
        v7(),
        user.id,
        p.handle,
        p.display_name,
        p.headline,
        p.bio_md,
        p.location,
        JSON.stringify(p.links),
        p.visibility,
        JSON.stringify(p.theme),
        JSON.stringify(p.layout),
        JSON.stringify(p.pinned_items),
        p.currently_learning,
      ],
    );
    return { handle: p.handle };
  });
}
export async function inviteStaff(user: Actor, input: any) {
  await permit(user, "staff:manage");
  const email = String(input.email || "").toLowerCase();
  if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email))
    throw new HttpError(400, "Enter a Gmail address");
  const role = "instructor";
  if (
    input.courseId &&
    !(await can(user, "course:edit", { courseId: input.courseId }))
  )
    throw new HttpError(403, "Forbidden");
  if (
    !input.courseId ||
    !(await query("SELECT id FROM courses WHERE id=$1", [input.courseId]))
      .length
  )
    throw new HttpError(400, "Choose an existing course");
  await transaction(async (tx) => {
    const id = v7();
    await tx.query(
      "INSERT INTO staff_invites(id,email,role,invited_by,course_assignments) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO UPDATE SET role=$3,revoked_at=NULL,accepted_at=NULL,course_assignments=$5,updated_at=now()",
      [
        id,
        email,
        role,
        user.id,
        JSON.stringify([{ courseId: input.courseId, sectionId: null }]),
      ],
    );
    const target = (
      await tx.query("SELECT id FROM users WHERE lower(email)=$1", [email])
    ).rows[0];
    if (target && input.courseId)
      await tx.query(
        "INSERT INTO course_members(id,course_id,user_id,role,section_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(course_id,user_id) DO UPDATE SET role=$4,section_id=$5",
        [v7(), input.courseId, target.id, role, null],
      );
    await tx.query(
      "INSERT INTO outbox(id,kind,payload) VALUES($1,'email',$2)",
      [
        v7(),
        JSON.stringify({
          to: email,
          title: "You are invited to teach",
          body: "Vishnu has invited you to join the tutoring team. Sign in with this Google account to accept.",
          link: "/tutor/login",
        }),
      ],
    );
    await audit(tx, user, "staff.invite", "staff_invites", id, {
      email,
      role,
    });
  });
}
