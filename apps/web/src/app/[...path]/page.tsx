import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Lock } from "lucide-react";
import { currentUser } from "@/server/auth";
import { catalog, course, lesson } from "@/server/content";
import { query } from "@edu/db";
import { can } from "@edu/shared";
import {
  Catalog,
  Checkout,
  Dashboard,
  LessonPlayer,
  Login,
  Notes,
  PageHeading,
} from "@/components/learning";
import { MarkdownView } from "@/components/markdown";
import { HtmlView } from "@/components/html-view";
import { Badge } from "@/components/ui";
import { Workspace } from "@/components/workspace";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  if (path[0] === "courses" && path[1]) {
    const [c] = await query(
      "SELECT title,subtitle FROM courses WHERE slug=$1 AND visibility='published'",
      [path[1]],
    );
    if (c)
      return {
        title: c.title,
        description: c.subtitle,
        openGraph: { title: c.title, description: c.subtitle },
      };
  }
  return {
    title: path[0].replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { path } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  const [area, id, sub] = path;
  const publicPage = [
    "courses",
    "login",
    "tutor",
    "terms",
    "privacy",
    "contact",
    "u",
    "leagues",
    "preview",
  ].includes(area);
  if (!publicPage && !user)
    redirect(
      (["teach", "admin"].includes(area) ? "/tutor/login" : "/login") +
        "?next=" +
        encodeURIComponent("/" + path.join("/")),
    );
  if (area === "admin" && !user?.isAdmin)
    redirect("/tutor/login?error=not-tutor");
  if (
    area === "teach" &&
    user &&
    !user.isAdmin &&
    !user.memberships.some((m) => m.role !== "student")
  ) {
    const invited = await query(
      "SELECT id FROM staff_invites WHERE email=$1 AND revoked_at IS NULL",
      [user.email],
    );
    if (!invited.length) redirect("/tutor/login?error=not-tutor");
  }
  if (area === "login" || (area === "tutor" && id === "login")) {
    if (user && (area === "login" || user.isAdmin)) {
      if (user.isAdmin) redirect("/admin");
      if (user.memberships.some((m) => m.role !== "student"))
        redirect("/teach");
      if (area === "login") redirect("/dashboard");
    }
    return (
      <Login
        tutor={area === "tutor"}
        user={user}
        next={sp.next}
        error={sp.error}
      />
    );
  }
  if (area === "courses" && !id) return <Catalog courses={await catalog()} />;
  if (area === "courses" && id) {
    let c: any;
    try {
      c = await course(id, user);
    } catch {
      notFound();
    }
    return (
      <>
        <section className="course-detail-hero">
          <Badge>{c.track_name}</Badge>
          <h1>{c.title}</h1>
          <p>{c.subtitle}</p>
        </section>
        <div className="course-detail-body">
          <div>
            <MarkdownView content={c.description_md} />
            <div className="syllabus">
              <h2>Course content</h2>
              {c.modules.map((m: any) => (
                <details key={m.id} open>
                  <summary>
                    {m.title}
                    <span className="small muted">
                      {m.lessons.length} lessons
                    </span>
                  </summary>
                  {m.lessons.map((l: any) => (
                    <Link
                      className="lesson-row"
                      href={
                        l.is_free_preview
                          ? `/preview/${l.id}`
                          : user
                            ? `/learn/${id}/${l.id}`
                            : "/login?next=" +
                              encodeURIComponent(`/learn/${id}/${l.id}`)
                      }
                      key={l.id}
                    >
                      {l.is_free_preview ? (
                        <BookOpen size={16} />
                      ) : (
                        <Lock size={15} />
                      )}
                      <span>{l.title}</span>
                      {l.is_free_preview && (
                        <Badge tone="green">Free preview</Badge>
                      )}
                    </Link>
                  ))}
                </details>
              ))}
            </div>
          </div>
          <aside>
            {c.offerings.map((o: any) => (
              <Checkout key={o.id} offering={o} user={user} />
            ))}
          </aside>
        </div>
        <script
          type="application/ld+json"
          nonce={(await headers()).get("x-nonce") ?? undefined}
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Course",
              name: c.title,
              description: c.subtitle,
              provider: { "@type": "Person", name: "Vishnu Gandarapu" },
              url: `${process.env.NEXT_PUBLIC_APP_URL}/courses/${c.slug}`,
            }).replace(/</g, "\\u003c"),
          }}
        />
      </>
    );
  }
  if (area === "dashboard" && !id) {
    if (user?.isAdmin) redirect("/admin");
    if (user?.memberships.some((m) => m.role !== "student")) redirect("/teach");
    return <Dashboard user={user} />;
  }
  if (area === "learn" || area === "preview") {
    const lessonId = area === "preview" ? id : sub;
    let l: any;
    try {
      l = await lesson(lessonId, user);
    } catch (e: any) {
      return (
        <div className="page-container">
          <PageHeading
            title="This lesson is waiting for you"
            subtitle={
              e.status === 403
                ? "Enroll in the course or wait for your module to open."
                : "Sign in to continue learning."
            }
          />
          <Link href="/courses" className="button">
            Browse courses
          </Link>
        </div>
      );
    }
    if (area === "preview")
      return (
        <article className="legal-page">
          <Badge tone="green">Free lesson preview</Badge>
          <HtmlView html={l.body_html} />
          <Link className="button" href={`/courses/${l.slug}`}>
            Explore the full course ↗
          </Link>
        </article>
      );
    const m = await query(
      "SELECT * FROM modules WHERE course_id=$1 ORDER BY position",
      [l.course_id],
    );
    const allowed = [];
    for (const mod of m)
      if (
        await can(user, "content:read", {
          courseId: l.course_id,
          sectionId: mod.section_id,
          published: true,
          releaseAt: mod.release_at,
        })
      )
        allowed.push({
          ...mod,
          lessons: await query(
            "SELECT id,title FROM lessons WHERE module_id=$1 AND published ORDER BY position",
            [mod.id],
          ),
        });
    const done = await query(
      "SELECT lesson_id FROM lesson_progress WHERE user_id=$1 AND status='completed'",
      [user!.id],
    );
    return (
      <LessonPlayer
        data={l}
        outline={allowed}
        done={done.map((d) => d.lesson_id)}
      />
    );
  }
  if (["terms", "privacy"].includes(area)) {
    const [setting] = await query(
      "SELECT value FROM site_settings WHERE key=$1",
      [area.replaceAll("-", "_")],
    );
    return (
      <article className="legal-page">
        <MarkdownView
          content={setting?.value || "This page is being prepared."}
        />
      </article>
    );
  }
  if (area === "contact") redirect("https://vishnugandarapu.in");
  if (area === "notes") return <Notes id={id} />;
  const workspaceAreas = [
    "u",
    "settings",
    "live",
    "join",
    "leagues",
    "admin",
    "dashboard",
    "teach",
  ];
  const courseTabs = ["content", "notes", "live", "analytics"];
  if (
    !workspaceAreas.includes(area) ||
    (area === "teach" &&
      id === "courses" &&
      path[3] &&
      !courseTabs.includes(path[3]))
  )
    notFound();
  return <Workspace path={path} user={user} />;
}
