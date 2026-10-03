import "dotenv/config";
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import pino from "pino";
import { liveEvents, type LiveEvent, can } from "@edu/shared";
import { query, asSystem } from "@edu/db";
import { actor, dispatch, snapshot, aggregate, pollResults } from "./service";
import { v7 } from "uuid";
const log = pino();
const http = createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404);
  res.end(req.url === "/health" ? "ok" : "not found");
});
const io = new Server(http, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    credentials: true,
  },
  maxHttpBufferSize: 50000,
});
const pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
io.adapter(createAdapter(pub, pub.duplicate()));
io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth.token || "");
    const [raw, sig] = token.split(".");
    const expected = createHmac("sha256", process.env.BETTER_AUTH_SECRET || "")
      .update(raw)
      .digest("hex");
    if (
      !sig ||
      sig.length !== 64 ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
    )
      throw new Error("Invalid token");
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (payload.exp < Date.now()) throw new Error("Token expired");
    const [session] = await query(
      "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>now()",
      [payload.sessionId, payload.userId],
    );
    if (!session) throw new Error("Session expired");
    socket.data.userId = payload.userId;
    next();
  } catch {
    next(new Error("UNAUTHENTICATED"));
  }
});
async function broadcast(sessionId: string) {
  const sockets = await io.in(`session:${sessionId}`).fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      try {
        const u = await actor(socket.data.userId);
        const state = await snapshot(u, sessionId);
        socket.emit("session:state", state);
        if (state.session.ended_at)
          socket.emit("session:ended", { tickets: state.tickets });
      } catch {
        socket.leave(`session:${sessionId}`);
        socket.emit("error", { code: "FORBIDDEN" });
      }
    }),
  );
}
const timers = new Map<string, ReturnType<typeof setTimeout>>();
io.on("connection", (socket) => {
  for (const name of Object.keys(liveEvents) as LiveEvent[])
    socket.on(name, async (input, ack) => {
      try {
        const user = await actor(socket.data.userId);
        const payload: any = liveEvents[name].parse(input);
        const result = await dispatch(user, name, payload);
        if (name === "session:join")
          await socket.join(`session:${payload.sessionId}`);
        if (name === "poll:respond") {
          socket.emit("session:state", await snapshot(user, payload.sessionId));
          if (!timers.has(payload.pollId))
            timers.set(
              payload.pollId,
              setTimeout(async () => {
                try {
                  timers.delete(payload.pollId);
                  const results = await pollResults(payload.pollId);
                  for (const peer of await io
                    .in(`session:${payload.sessionId}`)
                    .fetchSockets()) {
                    const u = await actor(peer.data.userId);
                    const [s] = await query(
                      "SELECT * FROM live_sessions WHERE id=$1",
                      [payload.sessionId],
                    );
                    if (
                      results.visibility === "live" ||
                      (results.visibility === "after_close" &&
                        results.status === "closed") ||
                      (await can(u, "live:manage", {
                        courseId: s.course_id,
                        sectionId: s.section_id,
                      }))
                    )
                      peer.emit("poll:results", results);
                  }
                } catch (error) {
                  log.error(error);
                }
              }, 500),
            );
        } else if (name !== "presence:ping") await broadcast(payload.sessionId);
        if (name === "coldcall:pick")
          io.to(`session:${payload.sessionId}`).emit("coldcall:picked", result);
        if (name === "presence:ping")
          io.to(`session:${payload.sessionId}`).emit(
            "presence:count",
            await aggregate(payload.sessionId),
          );
        ack?.({ ok: true, ...result });
      } catch (e: any) {
        const error = { code: e.message || "INVALID_EVENT" };
        ack?.({ ok: false, ...error });
        socket.emit("error", error);
      }
    });
});
setInterval(
  () =>
    asSystem(async () => {
      try {
        const closed = await query(
          "UPDATE polls SET status='closed',closed_at=now() WHERE status='open' AND timer_s IS NOT NULL AND opened_at+timer_s*interval '1 second'<now() RETURNING session_id",
        );
        for (const s of closed) await broadcast(s.session_id);
        const active = await query(
          "SELECT id FROM live_sessions WHERE ended_at IS NULL",
        );
        for (const s of active) {
          const a = await aggregate(s.id);
          await query(
            "INSERT INTO engagement_snapshots(id,session_id,lost,participants,pace,at) VALUES($1,$2,$3,$4,$5,now())",
            [v7(), s.id, a.lost, a.participants, JSON.stringify(a.pace)],
          );
          io.to(`session:${s.id}`).emit("engagement:counts", a);
        }
      } catch (e) {
        log.error(e);
      }
    }),
  30000,
).unref();
http.listen(Number(process.env.REALTIME_PORT || 3001), () =>
  log.info("Realtime ready"),
);
