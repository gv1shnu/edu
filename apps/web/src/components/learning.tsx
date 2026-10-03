"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ArrowUpRight,
  Check,
  CalendarDays,
  NotebookPen,
  Search,
  FileText,
  Download,
  ChevronRight,
} from "lucide-react";
import { money, dateTime, razorpayCheckoutConfig } from "@edu/shared";
import { api, useData, Loading, perform } from "./data";
import { Button, Badge, Empty } from "./ui";
import { CourseCard } from "./course-card";
import { NoteReader } from "./notes-reader";
import { HtmlView } from "./html-view";
import { authClient } from "./shell";
import { toast } from "sonner";
export function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function Login({
  tutor = false,
  next,
  error,
  user,
}: {
  tutor?: boolean;
  next?: string;
  error?: string;
  user: any;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <span className="brand-mark">v.</span>
      <h1>{tutor ? "Instructor sign in" : "Sign in"}</h1>
      {error && (
        <div
          className="error-callout"
          role="alert"
          style={{ marginBottom: 20 }}
        >
          {error === "not-tutor" ? (
            <>
              This account isn’t a tutor account.{" "}
              <Link href="/login">Students sign in here.</Link>
            </>
          ) : error === "unable_to_get_user_info" ? (
            "Please use a Google account with a verified email address."
          ) : (
            "Google sign-in didn’t finish. Please try again."
          )}
        </div>
      )}
      <Button
        className="full"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const callback =
            "/auth/complete?" +
            new URLSearchParams({
              ...(tutor ? { tutor: "1" } : {}),
              ...(next ? { next } : {}),
            });
          const result = await authClient.signIn.social({
            provider: "google",
            callbackURL: callback,
          });
          if (result.error) {
            toast.error(result.error.message || "Sign-in could not start");
            setBusy(false);
          }
        }}
      >
        <span className="google-icon">G</span>
        {busy
          ? "Connecting…"
          : tutor
            ? "Tutor sign in"
            : "Continue with Google"}
      </Button>
      <p className="login-fine">
        {tutor
          ? "Only the owner and invited tutors can access this space."
          : "New here? Signing in creates your student account."}
      </p>
      <p className="login-fine">
        By continuing, you agree to the <Link href="/terms">Terms</Link> and{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
      {user && (
        <Link className="text-link" href="/dashboard">
          Back to your classroom
        </Link>
      )}
    </div>
  );
}
export function Catalog({ courses }: { courses: any[] }) {
  const [track, setTrack] = useState("All courses"),
    [search, setSearch] = useState("");
  const filtered = courses.filter(
    (c) =>
      (track === "All courses" || c.track_name === track) &&
      (c.title + " " + c.subtitle).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page-container">
      <div className="catalog-heading">
        <h1>Courses</h1>
        <p>Course details, schedules and fees.</p>
      </div>
      <div className="filters">
        {[
          "All courses",
          ...new Set(courses.map((c) => c.track_name).filter(Boolean)),
        ].map((t) => (
          <button
            className={`filter ${track === t ? "active" : ""}`}
            key={t}
            onClick={() => setTrack(t)}
          >
            {t}
          </button>
        ))}
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search courses"
            placeholder="Find a course…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="course-grid">
        {filtered.map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
      {!filtered.length && (
        <Empty
          title="No courses found"
          body="Try another track or check back for new courses."
        />
      )}
    </div>
  );
}
export function Checkout({ offering, user }: { offering: any; user: any }) {
  const [coupon, setCoupon] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const router = useRouter();
  async function enroll() {
    if (!user) {
      router.push("/login?next=" + encodeURIComponent(location.pathname));
      return;
    }
    setBusy(true);
    try {
      const order = await api("checkout", { offeringId: offering.id, coupon });
      if (order.free) {
        toast.success("You’re enrolled");
        router.push("/dashboard");
        router.refresh();
        return;
      }
      await new Promise<void>((resolve, reject) => {
        if ((window as any).Razorpay) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Could not open payment checkout"));
        document.body.append(script);
      });
      const modal = new (window as any).Razorpay({
        key: order.key,
        amount: order.amount,
        currency: "INR",
        order_id: order.razorpayOrderId,
        name: "Vishnu / Learn",
        description: offering.title,
        config: razorpayCheckoutConfig,
        prefill: { name: user.name, email: user.email },
        handler: async (result: any) => {
          await perform(async () => {
            await api("payments/verify", result);
            setPending(true);
          }, "Payment verified. Waiting for confirmation.");
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      modal.open();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="offering">
      <Badge>
        {offering.billing === "monthly" ? "MONTHLY BATCH" : "FULL COURSE"}
      </Badge>
      <h3 style={{ marginTop: 15 }}>{offering.title}</h3>
      <div className="price">
        {money(offering.price_inr)}
        {offering.billing === "monthly" && (
          <span className="small muted"> / month</span>
        )}
      </div>
      <p>
        {offering.starts_at
          ? dateTime(offering.starts_at)
          : "Start learning today"}
      </p>
      <div className="form-group">
        <label htmlFor={"coupon-" + offering.id}>Have a coupon?</label>
        <input
          id={"coupon-" + offering.id}
          placeholder="Enter code"
          value={coupon}
          onChange={(e) => setCoupon(e.target.value.toUpperCase())}
        />
      </div>
      <Button className="full" disabled={busy} onClick={enroll}>
        {busy
          ? "Opening checkout…"
          : offering.price_inr > 0
            ? "Pay with UPI & enroll"
            : "Enroll for free"}
        <ArrowUpRight size={17} />
      </Button>
      {pending && (
        <div className="info-callout" style={{ marginTop: 15 }}>
          Your payment is being confirmed. Access appears on your dashboard once
          the payment provider confirms it.{" "}
          <Link href="/dashboard">Open dashboard</Link>
        </div>
      )}
      <p className="small" style={{ marginTop: 15, marginBottom: 0 }}>
        Pay instantly with UPI (GPay, PhonePe, Paytm, BHIM). Cards and
        netbanking also work. Secured by Razorpay.
      </p>
      {offering.billing === "monthly" && (
        <small className="muted">
          Monthly access is renewed manually; no automatic debits.
        </small>
      )}
    </div>
  );
}
export function Dashboard({ user }: { user: any }) {
  const { data, error } = useData("dashboard");
  if (!data) return <Loading error={error} />;
  const completed =
    data.courses.reduce((n: number, c: any) => n + Number(c.completion), 0) /
    Math.max(1, data.courses.length);
  return (
    <>
      <PageHeading title={`Hello, ${user.name.split(" ")[0]}`}>
        <div className="date-chip">
          <CalendarDays size={15} />
          {new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(
            new Date(),
          )}
        </div>
      </PageHeading>
      <div className="student-dashboard">
        <div>
          <div className="stats-grid">
            {[
              {
                icon: BookOpen,
                value: data.courses.length,
                label: "Courses enrolled",
              },
              {
                icon: Check,
                value: Math.round(completed) + "%",
                label: "Average progress",
              },
              {
                icon: CalendarDays,
                value: data.live.length,
                label: "Upcoming classes",
              },
            ].map(({ icon: Icon, value, label }) => (
              <div className="stat-card" key={label}>
                <div className="stat-top">
                  <span className="stat-icon">
                    <Icon size={18} />
                  </span>
                  <strong>{value}</strong>
                </div>
                <p>{label}</p>
              </div>
            ))}
          </div>
          {data.live.map((s: any) => (
            <div
              className="info-callout row spread"
              key={s.id}
              style={{ marginBottom: 20 }}
            >
              <div>
                <strong>{s.title}</strong>
                <p className="small">
                  {s.scheduled_at
                    ? dateTime(s.scheduled_at)
                    : "Your class is live"}
                </p>
              </div>
              <Link className="button" href={`/live/${s.id}`}>
                Join now
              </Link>
            </div>
          ))}
          <div className="dashboard-section-title">
            <h2>Your courses</h2>
            <Link href="/courses">
              Browse courses <span>↗</span>
            </Link>
          </div>
          {data.courses.length ? (
            <div className="course-grid">
              {data.courses.map((c: any) => (
                <CourseCard key={c.id} course={c} enrolled />
              ))}
            </div>
          ) : (
            <Empty title="No courses yet" body="Browse courses to enroll.">
              <Link href="/courses" className="button">
                Browse courses
              </Link>
            </Empty>
          )}
          <div className="dashboard-section-title">
            <h2>Updates</h2>
            <Link href="/notes">All class notes ↗</Link>
          </div>
          <div className="panel">
            {data.notifications.length ? (
              data.notifications.slice(0, 4).map((n: any) => (
                <Link
                  className="notes-row"
                  href={n.link}
                  key={n.id}
                  onClick={() => api(`notifications/${n.id}`, {})}
                >
                  <span className="notes-icon">
                    <NotebookPen size={18} />
                  </span>
                  <div>
                    <h3>{n.title}</h3>
                    <p>{n.body}</p>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              ))
            ) : (
              <p>
                No updates yet. Your tutor’s notes and feedback will appear
                here.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
export function LessonPlayer({
  data,
  outline,
  done,
}: {
  data: any;
  outline: any[];
  done: string[];
}) {
  const [complete, setComplete] = useState(done.includes(data.id));
  const flat = outline.flatMap((m) => m.lessons);
  const index = flat.findIndex((l) => l.id === data.id);
  return (
    <>
      <PageHeading title={data.title} />
      <div className="lesson-layout">
        <aside className="lesson-outline">
          <Link href={`/courses/${data.slug}`} className="text-link">
            Course overview ↗
          </Link>
          {outline.map((m) => (
            <div key={m.id}>
              <h3>{m.title}</h3>
              {m.lessons.map((l: any) => (
                <Link
                  key={l.id}
                  className={l.id === data.id ? "active" : ""}
                  href={`/learn/${data.slug}/${l.id}`}
                >
                  {done.includes(l.id) ? (
                    <Check size={14} />
                  ) : (
                    <BookOpen size={14} />
                  )}
                  <span>{l.title}</span>
                </Link>
              ))}
            </div>
          ))}
        </aside>
        <article className="panel lesson-content">
          <HtmlView html={data.body_html} />
          {data.attachments?.map((f: any) => (
            <Attachment key={f.id} file={f} />
          ))}
          <div className="lesson-actions">
            {index > 0 ? (
              <Link
                className="button secondary"
                href={`/learn/${data.slug}/${flat[index - 1].id}`}
              >
                Previous lesson
              </Link>
            ) : (
              <span />
            )}
            <Button
              onClick={async () => {
                setComplete(true);
                if (
                  !(await perform(
                    () => api(`lessons/${data.id}/complete`, {}),
                    "Progress saved",
                  ))
                )
                  setComplete(false);
              }}
              disabled={complete}
            >
              <Check size={16} />
              {complete ? "Lesson complete" : "Mark complete"}
            </Button>
            {index < flat.length - 1 && (
              <Link
                className="button secondary"
                href={`/learn/${data.slug}/${flat[index + 1].id}`}
              >
                Next lesson →
              </Link>
            )}
          </div>
        </article>
      </div>
    </>
  );
}
export function Attachment({ file }: { file: any }) {
  return (
    <button
      className="attachment"
      onClick={() =>
        perform(async () => {
          const r = await api(`files/${file.id}`);
          window.open(r.url, "_blank", "noopener,noreferrer");
        }, "")
      }
    >
      <span className="row">
        <FileText size={18} />
        {file.filename}
      </span>
      <Download size={17} />
    </button>
  );
}
export function Notes({ id }: { id?: string }) {
  const [search, setSearch] = useState("");
  const { data, error } = useData(
    id ? `notes/${id}` : `notes?q=${encodeURIComponent(search)}`,
  );
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeading title={id ? data.title : "Class notes"}>
        {id && (
          <Button
            variant="secondary"
            onClick={() =>
              perform(async () => {
                const result = await api(`notes/${id}/zip`, {});
                if (result.url) window.open(result.url, "_blank", "noopener");
                else
                  toast.info(
                    "Your download is being prepared. Try again in a moment.",
                  );
              }, "")
            }
          >
            Download all <Download size={16} />
          </Button>
        )}
      </PageHeading>
      {id ? (
        <NoteReader note={data} />
      ) : (
        <>
          <div
            className="search-field"
            style={{ maxWidth: 400, marginBottom: 25 }}
          >
            <Search size={17} />
            <input
              autoFocus
              aria-label="Search notes"
              placeholder="Search notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {data.length ? (
            <div className="panel">
              {data.map((n: any) => (
                <Link href={`/notes/${n.id}`} className="notes-row" key={n.id}>
                  <div className="notes-icon">
                    <NotebookPen size={22} />
                  </div>
                  <div>
                    <h3>{n.title}</h3>
                    <p>
                      {n.course_title} · {dateTime(n.published_at)}
                    </p>
                  </div>
                  <ArrowUpRight size={18} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No notes yet"
              body="Published notes for your batch appear after class."
            />
          )}
        </>
      )}
    </>
  );
}
