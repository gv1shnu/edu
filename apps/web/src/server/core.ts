import { can, type Action, type Actor, type Resource } from "@edu/shared";
import { transaction, query } from "@edu/db";
import { v7 } from "uuid";
import Redis from "ioredis";
import pino from "pino";
import type { PoolClient } from "pg";
export const log = pino({
  redact: ["req.headers.cookie", "password", "token", "secret"],
});
let redisClient: Redis | undefined;
export const redis = () =>
  (redisClient ??= new Redis(
    process.env.REDIS_URL || "redis://localhost:6379",
    { maxRetriesPerRequest: 2 },
  ));
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function permit(
  user: Actor | null,
  action: Action,
  resource: Resource = {},
) {
  if (!(await can(user, action, resource)))
    throw new HttpError(
      user ? 403 : 401,
      "You do not have access to this resource",
    );
}
export async function rate(key: string, max: number, seconds: number) {
  const count = (await redis().eval(
    "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",
    1,
    key,
    seconds,
  )) as number;
  if (count > max) throw new HttpError(429, "Please wait before trying again");
}
export function origin(req: Request) {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.get("origin") !==
      (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  )
    throw new HttpError(403, "Invalid request origin");
}
export async function audit(
  tx: PoolClient,
  user: Actor,
  action: string,
  entity: string,
  id: string,
  diff: unknown,
) {
  await tx.query(
    "INSERT INTO audit_log(id,actor_id,action,entity,entity_id,diff,at) VALUES($1,$2,$3,$4,$5,$6,now())",
    [v7(), user.id, action, entity, id, JSON.stringify(diff)],
  );
}
export async function outbox(tx: PoolClient, kind: string, payload: unknown) {
  await tx.query("INSERT INTO outbox(id,kind,payload) VALUES($1,$2,$3)", [
    v7(),
    kind,
    JSON.stringify(payload),
  ]);
}
export async function event(
  tx: PoolClient,
  userId: string,
  courseId: string,
  type: string,
  entityId: string,
  meta: unknown = {},
) {
  await tx.query(
    "INSERT INTO events(id,user_id,course_id,type,entity_id,meta,at) VALUES($1,$2,$3,$4,$5,$6,now())",
    [v7(), userId, courseId, type, entityId, JSON.stringify(meta)],
  );
  await outbox(tx, "league:award", { userId, courseId, type, entityId, meta });
}
export async function notify(
  tx: PoolClient,
  userId: string,
  kind: string,
  title: string,
  body: string,
  link: string,
) {
  await tx.query(
    "INSERT INTO notifications(id,user_id,kind,title,body,link) VALUES($1,$2,$3,$4,$5,$6)",
    [v7(), userId, kind, title, body, link],
  );
  await outbox(tx, "email", { userId, title, body, link, kind });
}
export async function courseResource(courseId: string, userId?: string) {
  const [m] = userId
    ? await query(
        "SELECT section_id FROM course_members WHERE course_id=$1 AND user_id=$2 AND (role<>'student' OR access_until IS NULL OR access_until>now())",
        [courseId, userId],
      )
    : [];
  return { courseId, userId, sectionId: m?.section_id };
}
export async function protectedTx<T>(
  user: Actor,
  fn: (tx: PoolClient) => Promise<T>,
) {
  return transaction(async (tx) => {
    await tx.query("SET LOCAL ROLE edu_rls");
    return fn(tx);
  }, user.id);
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (x: unknown) =>
    '"' +
    String(x ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return [
    keys,
    ...rows.map((r) =>
      keys.map((k) => (typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])),
    ),
  ]
    .map((r) => r.map(esc).join(","))
    .join("\r\n");
}
