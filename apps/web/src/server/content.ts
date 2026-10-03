import { query, transaction } from "@edu/db";
import {
  can,
  type Actor,
  courseSchema,
  lessonSchema,
  noteSchema,
} from "@edu/shared";
import { v7 } from "uuid";
import { permit, HttpError, audit, event, outbox, notify } from "./core";
import { cleanHtml } from "./html";
export async function catalog() {
  await permit(null, "public:read", { published: true });
  return query(
    `SELECT c.*,t.name track_name,t.accent_color,t.icon,(SELECT min(price_inr) FROM offerings WHERE course_id=c.id AND active) price,(SELECT count(*) FROM modules m JOIN lessons l ON l.module_id=m.id WHERE m.course_id=c.id AND l.published) lesson_count FROM courses c JOIN tracks t ON t.id=c.track_id WHERE c.visibility='published' ORDER BY c.created_at`,
  );
}
export async function course(slug: string, user: Actor | null) {
  const [c] = await query(
    "SELECT c.*,t.name track_name,t.accent_color,t.icon FROM courses c JOIN tracks t ON t.id=c.track_id WHERE c.slug=$1",
    [slug],
  );
  if (!c) throw new HttpError(404, "Course not found");
  if (c.visibility !== "published")
    await permit(user, "course:edit", { courseId: c.id });
  else await permit(null, "public:read", { published: true });
  const modules = await query(
    "SELECT id,title,position,release_at,section_id FROM modules WHERE course_id=$1 AND section_id IS NULL ORDER BY position",
    [c.id],
  );
  const lessons = await query(
    "SELECT l.id,l.module_id,l.title,l.type,l.is_free_preview,l.position FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=$1 AND m.section_id IS NULL AND l.published ORDER BY l.position",
    [c.id],
  );
  const offerings = await query(
    `SELECT o.*,s.name batch_name FROM offerings o LEFT JOIN sections s ON s.id=o.section_id WHERE o.course_id=$1 AND o.active ORDER BY price_inr DESC`,
    [c.id],
  );
  return {
    ...c,
    modules: modules.map((m) => ({
      ...m,
      lessons: lessons.filter((l) => l.module_id === m.id),
    })),
    offerings,
  };
}
export async function lesson(id: string, user: Actor | null): Promise<any> {
  const [l] = await query(
    "SELECT l.*,m.course_id,m.section_id,m.release_at,c.slug FROM lessons l JOIN modules m ON m.id=l.module_id JOIN courses c ON c.id=m.course_id WHERE l.id=$1",
    [id],
  );
  if (!l) throw new HttpError(404, "Lesson not found");
  await permit(user, "content:read", {
    courseId: l.course_id,
    sectionId: l.section_id,
    published: l.published,
    freePreview: l.is_free_preview,
    releaseAt: l.release_at,
  });
  const attachments = await query(
    "SELECT id,filename,mime,size_bytes FROM attachments WHERE lesson_id=$1",
    [id],
  );
  if (user)
    await transaction((tx) =>
      event(tx, user.id, l.course_id, "lesson_viewed", id),
    );
  return { ...l, body_html: cleanHtml(l.body_html), attachments };
}
export async function completeLesson(id: string, user: Actor) {
  const l = await lesson(id, user);
  await transaction(async (tx) => {
    const changed = await tx.query(
      `INSERT INTO lesson_progress(id,user_id,lesson_id,status,completed_at) VALUES($1,$2,$3,'completed',now()) ON CONFLICT(user_id,lesson_id) DO UPDATE SET status='completed',completed_at=coalesce(lesson_progress.completed_at,now()),updated_at=now() RETURNING id`,
      [v7(), user.id, id],
    );
    if (changed.rowCount)
      await event(tx, user.id, l.course_id, "lesson_completed", id);
  });
}
export async function saveCourse(data: unknown, user: Actor, id?: string) {
  const value = courseSchema.parse(data);
  await permit(user, id ? "course:edit" : "course:create", { courseId: id });
  return transaction(async (tx) => {
    const courseId = id || v7();
    if (id)
      await tx.query(
        "UPDATE courses SET title=$2,slug=$3,track_id=$4,subtitle=$5,description_md=$6,visibility=$7,stamp_email=coalesce($8,stamp_email),updated_at=now() WHERE id=$1",
        [
          id,
          value.title,
          value.slug,
          value.track_id,
          value.subtitle,
          value.description_md,
          value.visibility,
          value.stamp_email ?? null,
        ],
      );
    else {
      await tx.query(
        "INSERT INTO courses(id,owner_id,title,slug,track_id,subtitle,description_md,visibility,stamp_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,false))",
        [
          courseId,
          user.id,
          value.title,
          value.slug,
          value.track_id,
          value.subtitle,
          value.description_md,
          value.visibility,
          value.stamp_email ?? null,
        ],
      );
      await tx.query(
        "INSERT INTO course_members(id,course_id,user_id,role) VALUES($1,$2,$3,'instructor')",
        [v7(), courseId, user.id],
      );
    }
    await audit(tx, user, "course.save", "courses", courseId, value);
    return { id: courseId };
  });
}
export async function saveLesson(data: unknown, user: Actor, id?: string) {
  const v = lessonSchema.parse(data);
  const [m] = await query("SELECT * FROM modules WHERE id=$1", [v.module_id]);
  if (!m) throw new HttpError(404, "Module not found");
  await permit(user, "course:edit", { courseId: m.course_id });
  if (id) {
    const [old] = await query(
      "SELECT m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=$1",
      [id],
    );
    await permit(user, "course:edit", { courseId: old?.course_id });
  }
  return transaction(async (tx) => {
    const lid = id || v7();
    const values = [
      lid,
      v.module_id,
      v.title,
      v.type,
      cleanHtml(v.body_html),
      v.position,
      v.published,
      v.is_free_preview,
    ];
    await tx.query(
      `INSERT INTO lessons(id,module_id,title,type,body_html,position,published,is_free_preview) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET module_id=$2,title=$3,type=$4,body_html=$5,position=$6,published=$7,is_free_preview=$8,updated_at=now()`,
      values,
    );
    await audit(tx, user, "lesson.save", "lessons", lid, v);
    if (v.published)
      await outbox(tx, "notify:course", {
        courseId: m.course_id,
        kind: "lesson",
        title: "A new lesson is ready",
        body: v.title,
        link: `/learn/${m.course_id}/${lid}`,
      });
    return { id: lid };
  });
}
export async function saveNote(data: unknown, user: Actor, id?: string) {
  const v = noteSchema.parse(data);
  await permit(user, "course:edit", { courseId: v.course_id });
  if (
    v.section_id &&
    !(
      await query("SELECT id FROM sections WHERE id=$1 AND course_id=$2", [
        v.section_id,
        v.course_id,
      ])
    ).length
  )
    throw new HttpError(400, "Invalid batch");
  if (id) {
    const [old] = await query("SELECT course_id FROM class_notes WHERE id=$1", [
      id,
    ]);
    await permit(user, "course:edit", { courseId: old?.course_id });
  }
  const nid = id || v7();
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO class_notes(id,course_id,section_id,live_session_id,title,body_html,status,publish_at,created_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8) ON CONFLICT(id) DO UPDATE SET title=$5,body_html=$6,publish_at=$7,updated_at=now()`,
      [
        nid,
        v.course_id,
        v.section_id,
        v.live_session_id || null,
        v.title,
        cleanHtml(v.body_html),
        v.publish_at || null,
        user.id,
      ],
    );
    await audit(tx, user, "note.save", "class_notes", nid, v);
    const [current] = (
      await tx.query("SELECT status FROM class_notes WHERE id=$1", [nid])
    ).rows;
    if (current.status === "published" && v.status === "published") {
      // Editing live notes: they stay visible; the worker refreshes the lesson copy and
      // only re-notifies the batch when asked.
      await outbox(tx, "notes:publish", {
        noteId: nid,
        renotify: !!v.renotify,
      });
    } else if (v.status === "published" || v.status === "scheduled") {
      await tx.query("UPDATE class_notes SET status=$2 WHERE id=$1", [
        nid,
        v.status === "scheduled" ? "scheduled" : "draft",
      ]);
      await outbox(tx, "notes:publish", {
        noteId: nid,
        startAfter: v.status === "scheduled" ? v.publish_at : undefined,
      });
    } else if (current.status === "published")
      throw new HttpError(400, "Published notes can't go back to draft");
  });
  return { id: nid };
}
export async function readNote(id: string, user: Actor): Promise<any> {
  const [n] = await query("SELECT * FROM class_notes WHERE id=$1", [id]);
  if (!n) throw new HttpError(404, "Notes not found");
  await permit(user, "content:read", {
    courseId: n.course_id,
    sectionId: n.section_id,
    published: n.status === "published",
  });
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO class_note_reads(id,note_id,user_id,first_opened_at,last_opened_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(note_id,user_id) DO UPDATE SET last_opened_at=now()`,
      [v7(), id, user.id],
    );
    await event(tx, user.id, n.course_id, "notes_opened", id);
  });
  const [course] = await query("SELECT stamp_email FROM courses WHERE id=$1", [
    n.course_id,
  ]);
  const [viewer] = course?.stamp_email
    ? await query("SELECT email FROM users WHERE id=$1", [user.id])
    : [];
  return {
    ...n,
    body_html: cleanHtml(n.body_html),
    // Edited after publishing (the publish itself touches updated_at, hence the minute).
    edited:
      !!n.published_at &&
      n.updated_at.getTime() - n.published_at.getTime() > 60_000,
    stamp: viewer?.email ?? null,
    files: await query(
      "SELECT id,filename,mime,size_bytes FROM class_note_files WHERE note_id=$1 ORDER BY position",
      [id],
    ),
  };
}
export async function dashboard(user: Actor) {
  await permit(user, "account:manage", { userId: user.id });
  const courses = await query(
    `SELECT c.*,t.name track_name,t.accent_color,coalesce(p.completion,0) completion,s.name batch_name,cm.access_until,(cm.role='student' AND cm.access_until<=now()) IS TRUE access_expired,(SELECT l.id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=c.id AND l.published AND (m.section_id IS NULL OR m.section_id=cm.section_id) ORDER BY m.position,l.position LIMIT 1) first_lesson FROM course_members cm JOIN courses c ON c.id=cm.course_id JOIN tracks t ON t.id=c.track_id LEFT JOIN sections s ON s.id=cm.section_id LEFT JOIN v_course_progress p ON p.course_id=c.id AND p.user_id=cm.user_id WHERE cm.user_id=$1`,
    [user.id],
  );
  const live = await query(
    `SELECT s.*,c.title course_title FROM live_sessions s JOIN courses c ON c.id=s.course_id JOIN course_members m ON m.course_id=s.course_id WHERE m.user_id=$1 AND s.ended_at IS NULL AND (s.allow_other_batches OR s.section_id IS NULL OR s.section_id=m.section_id OR m.role='instructor') ORDER BY s.started_at`,
    [user.id],
  );
  const notifications = await query(
    "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
    [user.id],
  );
  return { courses, live, notifications };
}
export async function searchNotes(user: Actor, q: string) {
  await permit(user, "account:manage", { userId: user.id });
  return query(
    `SELECT n.id,n.title,n.published_at,c.title course_title FROM class_notes n JOIN courses c ON c.id=n.course_id JOIN course_members m ON m.course_id=n.course_id WHERE m.user_id=$1 AND (m.role='instructor' OR n.section_id IS NULL OR n.section_id=m.section_id) AND n.status='published' AND ($2='' OR to_tsvector('english',n.title||' '||regexp_replace(n.body_html,'<[^>]*>',' ','g')) @@ plainto_tsquery('english',$2)) ORDER BY n.published_at DESC`,
    [user.id, q],
  );
}
export async function publishNotice(
  user: Actor,
  courseId: string,
  title: string,
) {
  await permit(user, "course:edit", { courseId });
  await transaction(async (tx) => {
    for (const m of await query(
      "SELECT user_id FROM course_members WHERE course_id=$1 AND role='student'",
      [courseId],
    ))
      await notify(
        tx,
        m.user_id,
        "announcement",
        title,
        "Your tutor shared an update.",
        `/dashboard`,
      );
  });
}
export { can };
