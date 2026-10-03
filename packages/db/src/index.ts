import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
export * from "./schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});
export const db = drizzle(pool, { schema });

/**
 * Row-level security context. The runtime role cannot bypass RLS, so every checkout
 * tells Postgres who is asking: `withUser` for a signed-in person, `asSystem` for trusted
 * server work (worker jobs, aggregate counts). With neither, RLS-protected tables return
 * no rows, so a forgotten context fails closed.
 */
type DbContext = { userId?: string | null; system?: boolean };
const context = new AsyncLocalStorage<DbContext>();
export const withUser = <T>(
  userId: string | null | undefined,
  fn: () => Promise<T>,
) => context.run({ userId: userId ?? null }, fn);
export const asSystem = <T>(fn: () => Promise<T>) =>
  context.run({ system: true }, fn);
export const currentDbContext = () => context.getStore();

const SET =
  "SELECT set_config('app.user_id',$1,false),set_config('app.system',$2,false)";
async function checkout() {
  const client = await pool.connect();
  const ctx = context.getStore();
  try {
    await client.query(SET, [ctx?.userId ?? "", ctx?.system ? "on" : ""]);
  } catch (e) {
    client.release(e as Error);
    throw e;
  }
  return client;
}
async function checkin(client: PoolClient) {
  try {
    // Never hand a connection to the next caller with someone else's identity on it.
    await client.query(SET, ["", ""]);
    client.release();
  } catch (e) {
    client.release(e as Error);
  }
}

export async function transaction<T>(
  fn: (tx: PoolClient) => Promise<T>,
  userId?: string,
): Promise<T> {
  const c = await checkout();
  try {
    await c.query("BEGIN");
    if (userId)
      await c.query("SELECT set_config('app.user_id',$1,true)", [userId]);
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await checkin(c);
  }
}

export async function query<T = Record<string, any>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  const c = await checkout();
  try {
    return (await c.query(sql, args)).rows as T[];
  } finally {
    await checkin(c);
  }
}
export * from "./account";
