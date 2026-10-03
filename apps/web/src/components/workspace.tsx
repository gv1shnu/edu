"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trophy, ArrowUpRight, Download, Check, Radio } from "lucide-react";
import { api, useData, Loading, perform } from "./data";
import { PageHeading } from "./learning";
import { Profile, ProfileEditor } from "./profiles";
import { Live } from "./live";
import { Teach, Analytics, SessionReport, Admin } from "./management";
import { Button, Empty, Dialog } from "./ui";
function League({ id }: { id?: string }) {
  const { data, error } = useData("leagues" + (id ? "/" + id : ""));
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeading title={id ? data.name : "Learning league"} />
      {id ? (
        <>
          <div className="league-podium">
            {data.teams.map((t: any, i: number) => (
              <article
                className={`team-card ${i === 0 ? "winner" : ""}`}
                key={t.id}
              >
                <div className="row spread">
                  <span className="team-rank">#{i + 1} THIS WEEK</span>
                  {i === 0 && <Trophy size={25} style={{ color: "#ab852c" }} />}
                </div>
                <span className="team-emoji">{t.emoji}</span>
                <h2>{t.name}</h2>
                <div className="team-score">{t.perCapita.toFixed(1)}</div>
                <p>
                  points per learner · {Number(t.points).toFixed(0)} team points
                </p>
                <p>
                  {t.members} learners · {Number(t.season_points).toFixed(0)}{" "}
                  season points
                </p>
              </article>
            ))}
          </div>
          <div className="panel">
            <h2>Recent points</h2>
            {data.feed.map((p: any, i: number) => (
              <div key={i} className="notes-row">
                <span className="notes-icon">+{Number(p.points)}</span>
                <div>
                  <h3>
                    {p.name} · {p.batch_name}
                  </h3>
                  <p>{p.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : data.length ? (
        <div className="course-grid">
          {data.map((l: any) => (
            <Link className="panel" href={`/leagues/${l.id}`} key={l.id}>
              <Trophy size={28} />
              <h3 style={{ margin: "20px 0" }}>{l.name}</h3>
              <span className="text-link">
                See the standings <ArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="No active leagues"
          body="Your tutor will announce the next learning league here."
        />
      )}
    </>
  );
}
function Join() {
  const [code, setCode] = useState(
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("code") || ""
        : "",
    ),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="login-wrap">
      <Radio
        size={36}
        style={{ margin: "0 auto 22px", color: "var(--primary)" }}
      />
      <h1>Join a class</h1>
      <p>Enter the six-character code your tutor shared.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await perform(async () => {
            const r = await api("join?code=" + encodeURIComponent(code));
            router.push("/live/" + r.id);
          }, "");
          setBusy(false);
        }}
      >
        <input
          aria-label="Class join code"
          maxLength={6}
          minLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{
            fontSize: 26,
            letterSpacing: 8,
            textAlign: "center",
            marginBottom: 20,
          }}
        />
        <Button disabled={busy} className="full">
          Join the classroom
        </Button>
      </form>
    </div>
  );
}
function Account() {
  const [emailEnabled, setEmailEnabled] = useState(true),
    [timezone, setTimezone] = useState("Asia/Kolkata"),
    [remove, setRemove] = useState(false),
    [confirm, setConfirm] = useState("");
  return (
    <>
      <PageHeading
        title="Settings"
        subtitle="Set your preferences and manage your personal data."
      />
      <div className="panel">
        <h2>Notifications & timezone</h2>
        <label>
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
          />
          Send me learning updates by email
        </label>
        <div className="form-group" style={{ marginTop: 22 }}>
          <label>Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {[
              "Asia/Kolkata",
              "Asia/Dubai",
              "Asia/Singapore",
              "Europe/London",
              "America/New_York",
              "America/Los_Angeles",
              "UTC",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <Button
          onClick={() =>
            perform(
              () => api("account/preferences", { emailEnabled, timezone }),
              "Preferences saved",
            )
          }
        >
          <Check size={16} />
          Save preferences
        </Button>
      </div>
      <div className="panel">
        <h2>Your personal data</h2>
        <p style={{ marginBottom: 20 }}>
          Request a copy of your learning data. A private download link will
          appear in your notifications when it is ready.
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            perform(
              () => api("account/export", {}),
              "Your data export is queued",
            )
          }
        >
          <Download size={16} />
          Download my data
        </Button>
      </div>
      <div className="panel">
        <h2>Delete account</h2>
        <p style={{ marginBottom: 20 }}>
          Your sign-in and course access will end. Financial records are
          retained where required.
        </p>
        <Button variant="danger" onClick={() => setRemove(true)}>
          Delete my account
        </Button>
      </div>
      <Dialog
        open={remove}
        onOpenChange={setRemove}
        title="Delete your account?"
      >
        <p style={{ marginBottom: 20 }}>
          This removes your access and anonymizes your account. Type DELETE to
          confirm.
        </p>
        <input
          aria-label="Confirm account deletion"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button
          variant="danger"
          disabled={confirm !== "DELETE"}
          style={{ marginTop: 20 }}
          onClick={() =>
            perform(async () => {
              await api("account/delete", { confirm });
              window.location.href = "/";
            }, "Account deleted")
          }
        >
          Permanently delete my account
        </Button>
      </Dialog>
    </>
  );
}
export function Workspace({ path, user }: { path: string[]; user: any }) {
  const [area, id, sub, fourth] = path;
  if (area === "u") return <Profile handle={id} />;
  if (area === "settings")
    return id === "profile" ? (
      <>
        <div className="tabs">
          <Link className="active" href="/settings/profile">
            Profile
          </Link>
          <Link href="/settings/account">Account</Link>
        </div>
        <ProfileEditor />
      </>
    ) : (
      <Account />
    );
  if (area === "live")
    return <Live id={id} presenter={sub === "present"} user={user} />;
  if (area === "join") return <Join />;
  if (area === "leagues")
    return (
      <div className={!user ? "page-container" : undefined}>
        <League id={id} />
      </div>
    );
  if (area === "admin") return <Admin section={id} />;
  if (area === "dashboard" && id === "progress")
    return (
      <>
        <PageHeading title="Progress" />
        <Analytics id={sub} />
      </>
    );
  if (area === "teach") {
    if (id === "live" && fourth === "report") return <SessionReport id={sub} />;
    return (
      <Teach
        courseId={id === "courses" ? sub : undefined}
        section={fourth || "content"}
      />
    );
  }
  return (
    <Empty
      title="This page doesn’t exist"
      body="Let’s get you back to your classroom."
    >
      <Link href={user ? "/dashboard" : "/courses"} className="button">
        Back to learning
      </Link>
    </Empty>
  );
}
