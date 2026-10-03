"use client";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Send,
  Pause,
  Play,
  HelpCircle,
  Users,
  Pin,
  Trash2,
  Check,
  Hand,
  Maximize2,
} from "lucide-react";
import { api, perform, Loading } from "./data";
import { Button, Badge, Dialog, Progress } from "./ui";
import { PageHeading } from "./learning";
import { toast } from "sonner";
import QRCode from "qrcode";
export function Live({
  id,
  presenter = false,
  user,
}: {
  id: string;
  presenter?: boolean;
  user: any;
}) {
  const [state, setState] = useState<any>(null),
    [connected, setConnected] = useState(false),
    [message, setMessage] = useState(""),
    [question, setQuestion] = useState(false),
    [pollDialog, setPollDialog] = useState(false),
    [prompt, setPrompt] = useState(""),
    [options, setOptions] = useState("A\nB\nC\nD"),
    [type, setType] = useState("single"),
    [results, setResults] = useState<any>(null),
    [picked, setPicked] = useState<any>(null),
    [spinning, setSpinning] = useState(false),
    [picking, setPicking] = useState(false),
    [ticket, setTicket] = useState<any>(null),
    [answer, setAnswer] = useState<any>(""),
    [confused, setConfused] = useState(""),
    [error, setError] = useState(""),
    [qr, setQr] = useState(""),
    [exitPrompt, setExitPrompt] = useState("What clicked today?"),
    [exitDialog, setExitDialog] = useState(false);
  const socket = useRef<Socket | null>(null),
    feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let ping: ReturnType<typeof setInterval>;
    let spinTimer: ReturnType<typeof setTimeout>;
    let disposed = false;
    api("live/token")
      .then(({ token }) => {
        if (disposed) return;
        const s = io(
          process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001",
          { auth: { token }, withCredentials: true },
        );
        socket.current = s;
        s.on("connect", () => {
          setConnected(true);
          s.emit("session:join", { sessionId: id });
        });
        s.on("disconnect", () => setConnected(false));
        s.on("connect_error", (e) => setError(e.message));
        s.on("session:state", (data) => {
          setState(data);
          setResults(data.results || null);
          if (data.session.ended_at && data.learner)
            setTicket(data.tickets.find((t: any) => !t.answered) || null);
        });
        s.on("poll:results", setResults);
        s.on("engagement:counts", (engagement) =>
          setState((old: any) => (old ? { ...old, engagement } : old)),
        );
        s.on("presence:count", (engagement) =>
          setState((old: any) => (old ? { ...old, engagement } : old)),
        );
        s.on("coldcall:picked", (p) => {
          clearTimeout(spinTimer);
          setPicked(p);
          const reveal = () => {
            setSpinning(false);
            if (p.userId === user.id) toast.info("You’re up! Take your time.");
          };
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
            reveal();
          else {
            setSpinning(true);
            spinTimer = setTimeout(reveal, 1600);
          }
        });
        s.on("error", (e) =>
          toast.error(e.code.replaceAll("_", " ").toLowerCase()),
        );
        ping = setInterval(
          () => s.emit("presence:ping", { sessionId: id }),
          20000,
        );
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
      clearInterval(ping);
      clearTimeout(spinTimer);
      socket.current?.disconnect();
    };
  }, [id, user.id]);
  useEffect(() => {
    feed.current?.scrollTo({
      top: feed.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state?.messages?.length]);
  useEffect(() => {
    if (state?.session?.join_code)
      QRCode.toDataURL(
        `${location.origin}/join?code=${state.session.join_code}`,
      ).then(setQr);
  }, [state?.session?.join_code]);
  function send(event: string, p: any = {}) {
    return new Promise<any>((resolve, reject) => {
      if (!socket.current?.connected) {
        reject(new Error("Reconnect before sending"));
        return;
      }
      socket.current
        .timeout(8000)
        .emit(event, { sessionId: id, ...p }, (err: any, r: any) => {
          if (err || !r?.ok) {
            reject(new Error(r?.code || "Could not send. Please retry."));
            return;
          }
          resolve(r);
        });
    });
  }
  if (!state) return <Loading error={error} />;
  const staff = state.staff,
    learner = state.learner,
    s = state.session,
    poll = state.poll,
    eng = state.engagement;
  const paused = !staff && (s.chat_state === "paused" || state.muted);
  const meter = eng.participants
    ? Math.round((eng.lost / eng.participants) * 100)
    : 0;
  return (
    <>
      <PageHeading
        eyebrow={presenter ? "PRESENTER VIEW" : "YOUR LIVE CLASSROOM"}
        title={s.title}
        subtitle="Live practice. No recordings."
      >
        <div className="row">
          <span
            className={connected ? "connected-label" : "disconnected-label"}
          >
            {connected ? "Connected" : "Reconnecting…"}
          </span>
        </div>
      </PageHeading>
      <div
        className="row spread"
        style={{ marginBottom: 25, flexWrap: "wrap" }}
      >
        <div className="row">
          <Badge tone={s.ended_at ? "gray" : "green"}>
            {s.ended_at ? "Class ended" : "LIVE CLASS"}
          </Badge>
          <span className="small muted">
            <Users size={15} style={{ display: "inline" }} /> {eng.participants}{" "}
            here
          </span>
        </div>
        <div className="row">
          <span className="small muted">JOIN CODE</span>
          <strong className="live-code">{s.join_code}</strong>
          {staff && !presenter && (
            <Link
              href={`/live/${id}/present`}
              className="icon-button"
              aria-label="Presenter view"
            >
              <Maximize2 size={18} />
            </Link>
          )}
        </div>
      </div>
      {presenter && qr && (
        <div className="panel row spread" style={{ marginBottom: 24 }}>
          <div>
            <h2>Join the class</h2>
            <p>Scan to join the classroom. Code: {s.join_code}</p>
          </div>
          <img src={qr} alt="QR code to join class" width={150} height={150} />
        </div>
      )}
      <div className="live-layout">
        <div className="stack">
          <div className="panel">
            <div className="row spread">
              <h2 style={{ fontSize: 20 }}>Create poll</h2>
              {staff && (
                <Button onClick={() => setPollDialog(true)}>+ New poll</Button>
              )}
            </div>
            {poll ? (
              <>
                <Badge tone={poll.status === "open" ? "green" : "gray"}>
                  {poll.status === "open" ? "Poll open" : "Poll closed"}
                </Badge>
                <h3 style={{ margin: "20px 0" }}>{poll.prompt}</h3>
                {learner &&
                  (poll.type === "short_text" ? (
                    <div className="row">
                      <input
                        aria-label="Poll answer"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                      />
                      <Button
                        disabled={poll.status !== "open"}
                        onClick={() =>
                          perform(
                            () =>
                              send("poll:respond", {
                                pollId: poll.id,
                                response: answer,
                              }),
                            "Answer saved",
                          )
                        }
                      >
                        Send
                      </Button>
                    </div>
                  ) : (
                    (poll.type === "rating"
                      ? [1, 2, 3, 4, 5]
                      : poll.options
                    ).map((o: any) => (
                      <button
                        key={o}
                        disabled={poll.status !== "open"}
                        className={`poll-option ${JSON.stringify(state.myResponse) === JSON.stringify(o) ? "selected" : ""}`}
                        onClick={() =>
                          perform(
                            () =>
                              send("poll:respond", {
                                pollId: poll.id,
                                response:
                                  poll.type === "multi"
                                    ? Array.isArray(state.myResponse) &&
                                      state.myResponse.includes(o)
                                      ? state.myResponse.filter(
                                          (v: any) => v !== o,
                                        )
                                      : [
                                          ...(Array.isArray(state.myResponse)
                                            ? state.myResponse
                                            : []),
                                          o,
                                        ]
                                    : o,
                              }),
                            "Answer saved",
                          )
                        }
                      >
                        {o}
                        {state.myResponse === o && (
                          <Check size={17} style={{ float: "right" }} />
                        )}
                      </button>
                    ))
                  ))}
                {results?.pollId === poll.id && (
                  <div style={{ marginTop: 20 }}>
                    {Object.entries(results.counts).map(([label, count]) => (
                      <div key={label} style={{ marginTop: 12 }}>
                        <div className="row spread small">
                          <span>{label}</span>
                          <span>{String(count)}</span>
                        </div>
                        <Progress
                          value={
                            (Number(count) / Math.max(1, results.total)) * 100
                          }
                        />
                      </div>
                    ))}
                    <p className="small" style={{ marginTop: 12 }}>
                      {results.total} responses
                    </p>
                  </div>
                )}
                {poll.revealed && (
                  <div className="info-callout" style={{ marginTop: 15 }}>
                    Answer: {JSON.stringify(poll.correct)}
                  </div>
                )}
                {staff && (
                  <div className="row" style={{ marginTop: 20 }}>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        perform(
                          () =>
                            send(
                              poll.status === "open"
                                ? "poll:close"
                                : "poll:open",
                              { pollId: poll.id },
                            ),
                          "Poll updated",
                        )
                      }
                    >
                      {poll.status === "open" ? "Close poll" : "Relaunch"}
                    </Button>
                    {poll.status === "closed" && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          perform(
                            () => send("poll:reveal", { pollId: poll.id }),
                            "Answer revealed",
                          )
                        }
                      >
                        Reveal answer
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "45px 15px", textAlign: "center" }}>
                <HelpCircle
                  size={35}
                  style={{ margin: "0 auto 15px", color: "var(--primary)" }}
                />
                <h3>Current question</h3>
                <p className="small" style={{ marginTop: 10 }}>
                  Your tutor’s next poll will appear here.
                </p>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="row spread">
              <h3>How’s the pace?</h3>
              {learner && (
                <span className="small muted">Your latest vote counts</span>
              )}
            </div>
            {learner && (
              <div className="pace-control" style={{ marginTop: 15 }}>
                {[
                  ["too_slow", "🐢 Too slow"],
                  ["just_right", "👍 Just right"],
                  ["too_fast", "🚀 Too fast"],
                ].map(([vote, label]) => (
                  <button
                    className={state.myPace === vote ? "selected" : ""}
                    key={vote}
                    onClick={() =>
                      perform(() => send("pace:vote", { vote }), "")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {staff && (
              <p className="small" style={{ marginTop: 14 }}>
                Too slow: {eng.pace.too_slow || 0} · Just right:{" "}
                {eng.pace.just_right || 0} · Too fast: {eng.pace.too_fast || 0}
              </p>
            )}
            {learner && (
              <Button
                aria-pressed={!!state.lost}
                className="full"
                style={{ marginTop: 15 }}
                variant={state.lost ? "primary" : "secondary"}
                onClick={() =>
                  perform(
                    () => send("confusion:toggle", { active: !state.lost }),
                    state.lost
                      ? "Thanks for letting us know"
                      : "Your tutor sees an anonymous count",
                  )
                }
              >
                <Hand size={17} />
                {state.lost
                  ? "Still a little lost · tap when ready"
                  : "I’m lost · a little help?"}
              </Button>
            )}
          </div>
          {staff && (
            <>
              <div className="engagement-grid">
                <div
                  className={`panel ${meter >= s.confusion_threshold ? "alert-meter" : ""}`}
                >
                  <h3>Questions from students</h3>
                  <div className="engagement-count">
                    {eng.lost}{" "}
                    <span className="small muted">
                      of {eng.participants} lost · {meter}%
                    </span>
                  </div>
                  <Progress value={meter} />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      perform(() => send("confusion:clear"), "Signals cleared")
                    }
                  >
                    Clear signals
                  </Button>
                </div>
                <div className="panel">
                  <h3>Choose a student</h3>
                  <div
                    className="coldcall-picker"
                    aria-busy={spinning || picking}
                  >
                    <div
                      className={`coldcall-wheel ${spinning ? "spinning" : ""}`}
                      aria-hidden="true"
                    >
                      <span>?</span>
                    </div>
                    <p role="status">
                      {spinning || picking
                        ? "Picking…"
                        : picked?.name || "Who’s up next?"}
                    </p>
                  </div>
                  <Button
                    disabled={spinning || picking || !!s.ended_at}
                    onClick={() => {
                      setPicking(true);
                      perform(
                        () => send("coldcall:pick", { practice: false }),
                        "",
                      ).finally(() => setPicking(false));
                    }}
                  >
                    Pick someone
                  </Button>
                  {picked?.id && !spinning && !picking && (
                    <div
                      className="row"
                      style={{ marginTop: 15, flexWrap: "wrap" }}
                    >
                      {["answered", "passed", "absent"].map((outcome) => (
                        <Button
                          key={outcome}
                          variant="ghost"
                          onClick={() =>
                            perform(
                              () =>
                                send("coldcall:outcome", {
                                  id: picked.id,
                                  outcome,
                                }),
                              "Outcome saved",
                            )
                          }
                        >
                          {outcome}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="row">
                <Button variant="secondary" onClick={() => setExitDialog(true)}>
                  Add exit ticket
                </Button>
                <Button
                  variant="danger"
                  disabled={!!s.ended_at}
                  onClick={() =>
                    perform(() => send("session:end"), "Class ended")
                  }
                >
                  End class
                </Button>
                {s.ended_at && (
                  <Link href={`/teach/live/${id}/report`} className="text-link">
                    Session report ↗
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
        <div className="panel">
          <div className="row spread">
            <h2 style={{ fontSize: 20 }}>The conversation</h2>
            {staff && (
              <Button
                variant="secondary"
                onClick={() =>
                  perform(
                    () =>
                      send("chat:setState", {
                        state: s.chat_state === "paused" ? "open" : "paused",
                      }),
                    "Chat updated",
                  )
                }
              >
                {s.chat_state === "paused" ? (
                  <Play size={14} />
                ) : (
                  <Pause size={14} />
                )}{" "}
                {s.chat_state === "paused" ? "Resume" : "Pause"}
              </Button>
            )}
          </div>
          {staff && (
            <select
              aria-label="Chat mode"
              style={{ marginTop: 12 }}
              value={s.chat_state}
              onChange={(e) =>
                perform(
                  () => send("chat:setState", { state: e.target.value }),
                  "Chat mode updated",
                )
              }
            >
              <option value="open">Open chat</option>
              <option value="paused">Paused</option>
              <option value="slow">Slow mode</option>
              <option value="questions_only">Questions only</option>
            </select>
          )}
          {state.messages
            .filter((m: any) => m.pinned && !m.deleted_at)
            .map((m: any) => (
              <div
                className="info-callout"
                style={{ marginTop: 15 }}
                key={m.id}
              >
                <Pin size={14} style={{ display: "inline" }} /> {m.body}
              </div>
            ))}
          <div className="chat-feed" ref={feed}>
            {state.messages.map((m: any) => (
              <div key={m.id} className="chat-message">
                <span className="avatar">{m.name?.slice(0, 1)}</span>
                <div style={{ flex: 1 }}>
                  <strong>{m.name}</strong>
                  <small>
                    {new Date(m.created_at).toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                  <p>{m.body}</p>
                  {m.kind === "question" && (
                    <Badge tone="amber">
                      {m.answered ? "Answered" : "Question"}
                    </Badge>
                  )}
                  {staff && !m.deleted_at && (
                    <div className="row">
                      <button
                        className="icon-button"
                        aria-label="Pin message"
                        onClick={() =>
                          perform(
                            () =>
                              send("chat:pin", {
                                messageId: m.id,
                                pinned: !m.pinned,
                              }),
                            "",
                          )
                        }
                      >
                        <Pin size={12} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Remove message"
                        onClick={() =>
                          perform(
                            () => send("chat:delete", { messageId: m.id }),
                            "",
                          )
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                      {m.kind === "question" && (
                        <button
                          className="icon-button"
                          aria-label="Mark answered"
                          onClick={() =>
                            perform(
                              () => send("chat:answer", { messageId: m.id }),
                              "",
                            )
                          }
                        >
                          <Check size={12} />
                        </button>
                      )}
                      <button
                        className="small"
                        style={{
                          background: "transparent",
                          color: "var(--muted)",
                        }}
                        onClick={() =>
                          perform(
                            () =>
                              send("chat:mute", {
                                userId: m.user_id,
                                muted: true,
                              }),
                            "Student muted",
                          )
                        }
                      >
                        Mute
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await perform(
                  () =>
                    send("chat:send", {
                      body: message,
                      kind: question ? "question" : "message",
                    }),
                  "",
                )
              )
                setMessage("");
            }}
          >
            <input
              aria-label="Chat message"
              maxLength={1000}
              disabled={paused || !connected || !!s.ended_at}
              placeholder={
                paused
                  ? "Chat paused by instructor"
                  : "Ask, share, think out loud…"
              }
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button
              aria-label="Send message"
              disabled={paused || !connected || !message.trim() || !!s.ended_at}
            >
              <Send size={17} />
            </Button>
          </form>
          <label className="small muted" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={question}
              onChange={(e) => setQuestion(e.target.checked)}
            />
            This is a question
          </label>
        </div>
      </div>
      <Dialog
        open={pollDialog}
        onOpenChange={setPollDialog}
        title="Create poll"
      >
        <div className="form-group">
          <label>Question</label>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should we check?"
          />
        </div>
        <div className="form-group">
          <label>Answer type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (e.target.value === "yes_no") setOptions("Yes\nNo");
            }}
          >
            {["single", "multi", "yes_no", "rating", "short_text"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Options · one per line</label>
          <textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        </div>
        <Button
          onClick={() =>
            perform(async () => {
              const p = await send("poll:create", {
                prompt,
                type,
                options: options.split("\n").filter(Boolean),
                anonymous: false,
                resultsVisibility: "live",
              });
              await send("poll:open", { pollId: p.id });
              setPollDialog(false);
            }, "Poll is live")
          }
        >
          Launch poll
        </Button>
      </Dialog>
      <Dialog
        open={exitDialog}
        onOpenChange={setExitDialog}
        title="Create exit ticket"
      >
        <label>Exit ticket question</label>
        <input
          value={exitPrompt}
          onChange={(e) => setExitPrompt(e.target.value)}
        />
        <Button
          style={{ marginTop: 20 }}
          onClick={() =>
            perform(async () => {
              await send("exit:create", {
                prompt: exitPrompt,
                type: "short_text",
                options: [],
                required: true,
              });
              setExitDialog(false);
            }, "Exit ticket added")
          }
        >
          Require this exit ticket
        </Button>
      </Dialog>
      <Dialog
        open={!!ticket}
        onOpenChange={(open) => {
          if (!open && !ticket?.required) setTicket(null);
        }}
        title="Exit ticket"
      >
        {ticket && (
          <>
            <h3>{ticket.prompt}</h3>
            {ticket.type === "short_text" ? (
              <textarea
                aria-label="Exit ticket answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                style={{ marginTop: 15 }}
              />
            ) : (
              <select
                value={answer}
                onChange={(e) =>
                  setAnswer(
                    ticket.type === "confidence_1_5"
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              >
                <option value="">Choose…</option>
                {(ticket.type === "confidence_1_5"
                  ? [1, 2, 3, 4, 5]
                  : ticket.options
                ).map((v: any) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            )}
            <label style={{ marginTop: 15 }}>
              What confused you today? (optional)
            </label>
            <textarea
              value={confused}
              onChange={(e) => setConfused(e.target.value)}
            />
            <Button
              style={{ marginTop: 15 }}
              onClick={() =>
                perform(async () => {
                  await send("exit:respond", {
                    ticketId: ticket.id,
                    response: answer,
                    confusedAbout: confused,
                  });
                }, "Thanks for sharing. See you next class!")
              }
            >
              Share & finish
            </Button>
          </>
        )}
      </Dialog>
    </>
  );
}
