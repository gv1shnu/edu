import { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/**
 * Creates an isolated, fully migrated database. The returned `pool` connects as the owner
 * (for fixtures and assertions); DATABASE_URL is pointed at the restricted `edu_app` role, so
 * app modules imported afterwards run under row-level security exactly as in production.
 * Uses a PostgreSQL 16 Testcontainer when USE_TESTCONTAINERS=1 (CI), otherwise a throwaway
 * database on the server in MIGRATION_DATABASE_URL (or DATABASE_URL). Call before importing app modules.
 */
export async function createTestDatabase(
  prefix: string,
  migrateWithCli = false,
) {
  let container: StartedPostgreSqlContainer | undefined;
  let admin: Pool | undefined;
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  if (process.env.USE_TESTCONTAINERS === "1") {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    process.env.DATABASE_URL = container.getConnectionUri();
  } else {
    const ownerUrl =
      process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
    if (!ownerUrl)
      throw new Error(
        "Configure MIGRATION_DATABASE_URL or USE_TESTCONTAINERS=1",
      );
    admin = new Pool({ connectionString: ownerUrl });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(ownerUrl);
    url.pathname = "/" + name;
    process.env.DATABASE_URL = url.toString();
  }
  const ownerDatabaseUrl = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: ownerDatabaseUrl });
  if (!migrateWithCli)
    for (const file of (await readdir("packages/db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(
        await readFile("packages/db/migrations/" + file, "utf8"),
      );
  // rls.sql alters the cluster-wide edu_app role; parallel test files would race on it.
  // Advisory locks are per database, so take it on the shared admin database.
  const lock = await admin?.connect();
  // App code connects as the restricted runtime role (no superuser, no BYPASSRLS).
  const runtime = new URL(ownerDatabaseUrl);
  runtime.username = "edu_app";
  try {
    await lock?.query("SELECT pg_advisory_lock(7310001)");
    if (migrateWithCli)
      await promisify(execFile)("pnpm", ["db:migrate"], {
        env: {
          ...process.env,
          DATABASE_URL: ownerDatabaseUrl,
          MIGRATION_DATABASE_URL: ownerDatabaseUrl,
        },
      });
    await pool.query(await readFile("packages/db/rls.sql", "utf8"));
    await pool.query(await readFile("packages/db/views.sql", "utf8"));
    if (container) {
      runtime.password = "edu_app_test";
      await pool.query("ALTER ROLE edu_app LOGIN PASSWORD 'edu_app_test'");
    } else {
      runtime.password = "";
      await pool.query("ALTER ROLE edu_app LOGIN");
    }
  } finally {
    await lock?.query("SELECT pg_advisory_unlock(7310001)");
    lock?.release();
  }
  process.env.MIGRATION_DATABASE_URL = ownerDatabaseUrl;
  process.env.DATABASE_URL = runtime.toString();
  return {
    pool,
    ownerDatabaseUrl,
    async drop() {
      await pool.end();
      if (admin) {
        await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
        await admin.end();
      }
      await container?.stop();
    },
  };
}
