import { currentUser, auth } from "@/server/auth";
import { query, transaction, withUser, asSystem, eraseAccount } from "@edu/db";
import { z } from "zod";
import { v7 } from "uuid";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import {
  HttpError,
  permit,
  origin,
  log,
  audit,
  outbox,
  csv,
} from "@/server/core";
import {
  catalog,
  course,
  lesson,
  completeLesson,
  saveCourse,
  saveLesson,
  saveNote,
  readNote,
  dashboard,
  searchNotes,
} from "@/server/content";
import { checkout, verify } from "@/server/payments";
import { signUpload, finishUpload, download, signGet } from "@/server/storage";
import {
  getProfile,
  saveProfile,
  defaultProfile,
  inviteStaff,
} from "@/server/profiles";
import {
  teachData,
  saveModule,
  startLive,
  analytics,
  report,
  league,
} from "@/server/manage";
export const dynamic = "force-dynamic";
async function handle(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
  u: Awaited<ReturnType<typeof currentUser>>,
) {
  try {
    origin(req);
    const path = (await params).path;
    const [area, id, action] = path;
    const url = new URL(req.url);
    const requireUser = () => {
      if (!u) throw new HttpError(401, "Please sign in");
      return u;
    };
    let result: any;
    if (req.method === "GET") {
      if (area === "me") {
        result = u;
      } else if (area === "catalog") result = await catalog();
      else if (area === "courses") result = await course(id, u);
      else if (area === "lessons") result = await lesson(id, u);
      else if (area === "dashboard") result = await dashboard(requireUser());
      else if (area === "notes")
        result = id
          ? await readNote(id, requireUser())
          : await searchNotes(requireUser(), url.searchParams.get("q") || "");
      else if (area === "profiles") result = await getProfile(id, u);
      else if (area === "profile") {
        const user = requireUser();
        await permit(user, "profile:edit", { userId: user.id });
        const [p] = await query("SELECT * FROM profiles WHERE user_id=$1", [
          user.id,
        ]);
        result = p ?? { ...defaultProfile, display_name: user.name };
      } else if (area === "teach") result = await teachData(requireUser(), id);
      else if (area === "tracks") {
        await permit(null, "public:read");
        result = await query("SELECT * FROM tracks");
      } else if (area === "analytics")
        result = await analytics(requireUser(), id);
      else if (area === "reports") result = await report(requireUser(), id);
      else if (area === "leagues") {
        if (id) result = await league(u, id);
        else {
          await permit(null, "public:read");
          result = await query("SELECT * FROM leagues WHERE active");
        }
      } else if (area === "files") {
        if (id === "export") {
          const user = requireUser();
          await permit(user, "account:manage", { userId: user.id });
          const key = url.searchParams.get("key") || "";
          if (!key.startsWith(`exports/${user.id}/`) || key.includes(".."))
            throw new HttpError(403, "Forbidden");
          return Response.redirect(await signGet(key));
        }
        result = await download(
          u,
          id,
          url.searchParams.get("intent") !== "view",
        );
      } else if (area === "admin") {
        const user = requireUser();
        await permit(user, "site:manage");
        if (id === "staff")
          result = {
            invites: await query(
              "SELECT * FROM staff_invites ORDER BY created_at DESC",
            ),
            courses: await query("SELECT id,title FROM courses"),
            sections: await query("SELECT id,name,course_id FROM sections"),
          };
        else if (id === "settings") {
          // Terms and privacy are always listed, even before they're first written.
          const saved = await query(
            "SELECT key,value FROM site_settings WHERE key IN ('terms','privacy')",
          );
          result = ["terms", "privacy"].map((key) => ({
            key,
            value: saved.find((s) => s.key === key)?.value ?? "",
          }));
        } else
          result = {
            orders: await query(
              "SELECT o.*,u.name,f.title FROM orders o JOIN users u ON u.id=o.user_id JOIN offerings f ON f.id=o.offering_id ORDER BY o.created_at DESC",
            ),
            revenue: await query(
              "SELECT to_char(paid_at,'YYYY-MM') AS month,sum(amount_paise)::int amount FROM orders WHERE status='paid' GROUP BY 1 ORDER BY 1",
            ),
            offerings: await query(
              "SELECT o.*,c.title course_title,s.name batch_name,(SELECT count(*) FROM course_members m WHERE m.section_id=o.section_id AND m.role='student')::int filled FROM offerings o JOIN courses c ON c.id=o.course_id LEFT JOIN sections s ON s.id=o.section_id ORDER BY c.title,o.created_at",
            ),
            courses: await query("SELECT id,title FROM courses ORDER BY title"),
            sections: await query(
              "SELECT s.*,c.title course_title,(SELECT count(*) FROM course_members m WHERE m.section_id=s.id AND m.role='student')::int enrolled FROM sections s JOIN courses c ON c.id=s.course_id ORDER BY c.title,s.starts_at NULLS LAST",
            ),
            students: await query(
              "SELECT count(DISTINCT user_id)::int count FROM course_members WHERE role='student'",
            ),
            coupons: await query("SELECT * FROM coupons"),
            tracks: await query(
              "SELECT t.*,(SELECT count(*) FROM courses c WHERE c.track_id=t.id)::int courses FROM tracks t ORDER BY t.name",
            ),
          };
      } else if (area === "live" && id === "token") {
        const user = requireUser();
        await permit(user, "account:manage", { userId: user.id });
        const session = await auth.api.getSession({ headers: await headers() });
        const raw = Buffer.from(
          JSON.stringify({
            userId: user.id,
            sessionId: session!.session.id,
            exp: Date.now() + 5 * 60000,
          }),
        ).toString("base64url");
        result = {
          token:
            raw +
            "." +
            createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
              .update(raw)
              .digest("hex"),
        };
      } else if (area === "join") {
        const user = requireUser();
        const [s] = await query(
          "SELECT * FROM live_sessions WHERE join_code=$1 AND ended_at IS NULL",
          [String(url.searchParams.get("code")).toUpperCase()],
        );
        if (!s) throw new HttpError(404, "No active class with that code");
        await permit(user, "live:join", {
          courseId: s.course_id,
          sectionId: s.allow_other_batches ? null : s.section_id,
        });
        result = { id: s.id };
      } else throw new HttpError(404, "Not found");
      if (url.searchParams.get("format") === "csv") {
        const rows = Array.isArray(result)
          ? result
          : result.attendance || result.orders || [];
        return new Response(csv(rows), {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="export.csv"',
          },
        });
      }
    } else if (req.method === "POST") {
      const user = requireUser();
      if (Number(req.headers.get("content-length") || 0) > 600000)
        throw new HttpError(413, "Request too large");
      const p = await req.json();
      if (area === "courses") result = await saveCourse(p, user, id);
      else if (area === "lessons")
        result =
          action === "complete"
            ? await completeLesson(id, user)
            : await saveLesson(p, user, id);
      else if (area === "modules") result = await saveModule(user, p);
      else if (area === "notes") {
        if (action === "zip") {
          const n = await readNote(id, user);
          if (n.zip_r2_key) result = { url: await signGet(n.zip_r2_key) };
          else {
            await transaction((tx) => outbox(tx, "notes:zip", { noteId: id }));
            result = { queued: true };
          }
        } else result = await saveNote(p, user, id);
      } else if (area === "profile") result = await saveProfile(user, p);
      else if (area === "checkout")
        result = await checkout(
          user,
          z.string().uuid().parse(p.offeringId),
          p.coupon,
        );
      else if (area === "payments" && id === "verify")
        result = await verify(user, p);
      else if (area === "uploads")
        result =
          id === "complete"
            ? await finishUpload(user, p)
            : await signUpload(user, p);
      else if (area === "live") result = await startLive(user, p);
      else if (area === "notifications") {
        await permit(user, "account:manage", { userId: user.id });
        await query(
          "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id=$2",
          [user.id, id],
        );
      } else if (area === "reorder") {
        await permit(user, "course:edit", { courseId: p.courseId });
        const ids = z.array(z.string().uuid()).max(500).parse(p.ids);
        await transaction(async (tx) => {
          for (const [i, lid] of ids.entries())
            await tx.query(
              "UPDATE lessons SET position=$2 WHERE id=$1 AND module_id IN (SELECT id FROM modules WHERE course_id=$3)",
              [lid, i, p.courseId],
            );
          await audit(tx, user, "lessons.reorder", "courses", p.courseId, {
            ids,
          });
        });
      } else if (area === "account") {
        await permit(user, "account:manage", { userId: user.id });
        if (id === "export")
          await transaction((tx) =>
            outbox(tx, "account:export", { userId: user.id }),
          );
        else if (id === "delete") {
          if (p.confirm !== "DELETE")
            throw new HttpError(400, "Type DELETE to confirm");
          // Trusted erasure after the permission check above: runs as system so RLS doesn't
          // hide rows the person owns in other batches' tables.
          await asSystem(() =>
            transaction(async (tx) => {
              const { files } = await eraseAccount(tx, user.id);
              if (files.length)
                await outbox(tx, "files:delete", { keys: files });
              await tx.query(
                "INSERT INTO audit_log(id,actor_id,action,entity,entity_id,diff,at) VALUES($1,$2,'account.delete','users',$2,'{}',now())",
                [v7(), user.id],
              );
            }),
          );
        } else
          await query(
            "UPDATE users SET email_enabled=$2,timezone=$3 WHERE id=$1",
            [
              user.id,
              z.boolean().parse(p.emailEnabled),
              z
                .string()
                .refine((s) => {
                  try {
                    new Intl.DateTimeFormat("en", { timeZone: s });
                    return true;
                  } catch {
                    return false;
                  }
                })
                .parse(p.timezone),
            ],
          );
      } else if (area === "admin") {
        await permit(user, "site:manage");
        if (id === "staff") {
          if (action === "revoke") {
            await transaction(async (tx) => {
              const invite = (
                await tx.query(
                  "UPDATE staff_invites SET revoked_at=now() WHERE id=$1 RETURNING email",
                  [p.id],
                )
              ).rows[0];
              if (invite) {
                await tx.query(
                  "DELETE FROM course_members WHERE user_id IN (SELECT id FROM users WHERE lower(email)=lower($1)) AND role='instructor'",
                  [invite.email],
                );
                await audit(
                  tx,
                  user,
                  "staff.revoke",
                  "staff_invites",
                  p.id,
                  {},
                );
              }
            });
          } else result = await inviteStaff(user, p);
        } else if (id === "settings") {
          const key = z.enum(["terms", "privacy"]).parse(p.key);
          const value = z.string().max(100000).parse(p.value);
          await transaction(async (tx) => {
            const settingId = v7();
            await tx.query(
              "INSERT INTO site_settings(id,key,value) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=$3,updated_at=now()",
              [settingId, key, JSON.stringify(value)],
            );
            await audit(tx, user, "settings.save", "site_settings", settingId, {
              key,
            });
          });
        } else if (id === "track") {
          // Course subjects (the catalog filter and course accent colour).
          const v = z
            .object({
              id: z.string().uuid().optional(),
              name: z.string().trim().min(2).max(60),
              accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              icon: z.string().trim().min(1).max(40).default("book-open"),
              description: z.string().trim().max(300).default(""),
            })
            .parse(p);
          const slug = v.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          if (!slug)
            throw new HttpError(400, "Use letters or numbers in the name");
          result = await transaction(async (tx) => {
            const tid = v.id || v7();
            await tx.query(
              `INSERT INTO tracks(id,slug,name,accent_color,icon,description) VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT(id) DO UPDATE SET slug=$2,name=$3,accent_color=$4,icon=$5,description=$6,updated_at=now()`,
              [tid, slug, v.name, v.accentColor, v.icon, v.description],
            );
            await audit(
              tx,
              user,
              v.id ? "track.update" : "track.create",
              "tracks",
              tid,
              v,
            );
            return { id: tid };
          });
        } else if (id === "coupon") {
          const v = z
            .object({
              code: z.string().regex(/^[A-Z0-9_-]{3,30}$/),
              percent: z.number().int().min(1).max(100),
              maxUses: z.number().int().positive(),
            })
            .parse(p);
          await transaction(async (tx) => {
            const couponId = v7();
            await tx.query(
              "INSERT INTO coupons(id,code,percent_off,max_uses) VALUES($1,$2,$3,$4)",
              [couponId, v.code, v.percent, v.maxUses],
            );
            await audit(tx, user, "coupon.create", "coupons", couponId, v);
          });
        } else if (id === "section") {
          const v = z
            .object({
              id: z.string().uuid().optional(),
              courseId: z.string().uuid(),
              name: z.string().trim().min(1).max(120),
              startsAt: z.string().datetime().nullable().optional(),
              endsAt: z.string().datetime().nullable().optional(),
              color: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .default("#4f46e5"),
              emoji: z.string().trim().min(1).max(8).default("⚡"),
            })
            .refine(
              (s) => !s.startsAt || !s.endsAt || s.startsAt < s.endsAt,
              "The batch must end after it starts",
            )
            .parse(p);
          result = await transaction(async (tx) => {
            const sid = v.id || v7();
            const saved = (
              await tx.query(
                `INSERT INTO sections(id,course_id,name,starts_at,ends_at,color,emoji) VALUES($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT(id) DO UPDATE SET name=$3,starts_at=$4,ends_at=$5,color=$6,emoji=$7,updated_at=now()
                 WHERE sections.course_id=$2 RETURNING id`,
                [
                  sid,
                  v.courseId,
                  v.name,
                  v.startsAt || null,
                  v.endsAt || null,
                  v.color,
                  v.emoji,
                ],
              )
            ).rows[0];
            if (!saved)
              throw new HttpError(400, "That batch belongs to another course");
            await audit(
              tx,
              user,
              v.id ? "section.update" : "section.create",
              "sections",
              sid,
              v,
            );
            return { id: sid };
          });
        } else if (id === "offering") {
          const v = z
            .object({
              id: z.string().uuid().optional(),
              courseId: z.string().uuid(),
              sectionId: z.string().uuid().nullable().optional(),
              title: z.string().trim().min(1).max(160),
              priceRupees: z.number().min(0).max(1000000),
              billing: z.enum(["one_time", "monthly"]),
              startsAt: z.string().datetime().nullable().optional(),
              active: z.boolean().default(true),
            })
            .parse(p);
          const paise = Math.round(v.priceRupees * 100);
          result = await transaction(async (tx) => {
            if (v.sectionId) {
              const owner = (
                await tx.query(
                  "SELECT 1 FROM sections WHERE id=$1 AND course_id=$2",
                  [v.sectionId, v.courseId],
                )
              ).rows[0];
              if (!owner)
                throw new HttpError(400, "Choose a batch from the same course");
            }
            const oid = v.id || v7();
            const saved = (
              await tx.query(
                `INSERT INTO offerings(id,course_id,section_id,title,price_inr,billing,starts_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT(id) DO UPDATE SET section_id=$3,title=$4,price_inr=$5,billing=$6,starts_at=$7,active=$8,updated_at=now()
                 WHERE offerings.course_id=$2 RETURNING id`,
                [
                  oid,
                  v.courseId,
                  v.sectionId || null,
                  v.title,
                  paise,
                  v.billing,
                  v.startsAt || null,
                  v.active,
                ],
              )
            ).rows[0];
            if (!saved)
              throw new HttpError(
                400,
                "That offering belongs to another course",
              );
            await audit(
              tx,
              user,
              v.id ? "offering.update" : "offering.create",
              "offerings",
              oid,
              { ...v, pricePaise: paise },
            );
            return { id: oid };
          });
        } else throw new HttpError(404, "Not found");
      } else if (area === "leagues") {
        await permit(user, "league:manage", { courseId: p.courseId });
        const v = z
          .object({
            name: z.string().min(1),
            start: z.string().datetime(),
            end: z.string().datetime(),
            sections: z.array(z.string().uuid()).min(1),
            scoring_rules: z
              .record(
                z.object({
                  points: z.number().nonnegative(),
                  cap: z.number().nonnegative(),
                }),
              )
              .default({}),
          })
          .parse(p);
        const lid = v7();
        await transaction(async (tx) => {
          await tx.query(
            "INSERT INTO leagues(id,name,season_start,season_end,scoring_rules) VALUES($1,$2,$3,$4,$5)",
            [lid, v.name, v.start, v.end, JSON.stringify(v.scoring_rules)],
          );
          for (const sid of v.sections) {
            const [s] = await query(
              "SELECT course_id FROM sections WHERE id=$1",
              [sid],
            );
            await permit(user, "league:manage", { courseId: s?.course_id });
            await tx.query(
              "INSERT INTO league_entries(id,league_id,section_id) VALUES($1,$2,$3)",
              [v7(), lid, sid],
            );
          }
          await audit(tx, user, "league.create", "leagues", lid, v);
        });
        result = { id: lid };
      } else throw new HttpError(404, "Not found");
    } else throw new HttpError(405, "Method not allowed");
    return Response.json(result ?? { ok: true });
  } catch (error: any) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : error.code === "23505"
            ? 409
            : 500;
    if (status === 500)
      log.error({ err: error, requestId: v7() }, "Request failed");
    return Response.json(
      {
        error:
          status === 500
            ? "Something went wrong. Please try again."
            : error instanceof z.ZodError
              ? error.issues.map((i) => i.message).join("; ")
              : error.code === "23505"
                ? "This value is already in use"
                : error.message,
      },
      { status },
    );
  }
}
// Every database call in the request runs as the signed-in user, so RLS applies.
async function withRequestUser(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const u = await currentUser();
  return withUser(u?.id, () => handle(req, ctx, u));
}
export const GET = withRequestUser;
export const POST = withRequestUser;
