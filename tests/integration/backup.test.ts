import "dotenv/config";
import PgBoss from "pg-boss";
import { postgresEnv } from "../../apps/worker/src/postgres-env";
import { beforeAll, afterAll, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./db";
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let restore: typeof import("../../apps/worker/src/restore-drill");
let directory: string;
const exec = promisify(execFile);
beforeAll(async () => {
  database = await createTestDatabase("edu_backup_it", true);
  restore = await import("../../apps/worker/src/restore-drill");
  directory = await mkdtemp(join(tmpdir(), "edu-backup-test-"));
});
afterAll(async () => {
  const db = await import("../../packages/db/src/index");
  await db.pool.end();
  await database?.drop();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("restores a real dump, applies migrations, and removes its temporary database", async () => {
  const dump = join(directory, "backup.dump");
  for (const name of ["Backup one", "Backup two"])
    await database.pool.query(
      "INSERT INTO users(id,name,email) VALUES(gen_random_uuid(),$1,gen_random_uuid()||'@example.com')",
      [name],
    );
  await exec("pg_dump", ["--format=custom", "--file", dump], {
    env: postgresEnv(database.ownerDatabaseUrl),
  });
  const before = (
    await database.pool.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'edu_restore_%' ORDER BY datname",
    )
  ).rows;
  await restore.verifyBackup(database.ownerDatabaseUrl, dump);
  expect(
    (
      await database.pool.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'edu_restore_%' ORDER BY datname",
      )
    ).rows,
  ).toEqual(before);
  expect(
    (await database.pool.query("SELECT count(*) n FROM users")).rows[0].n,
  ).toBe("2");
  await writeFile(dump, "invalid dump");
  await expect(
    restore.verifyBackup(database.ownerDatabaseUrl, dump),
  ).rejects.toThrow("Restore drill failed");
  expect(
    (
      await database.pool.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'edu_restore_%' ORDER BY datname",
      )
    ).rows,
  ).toEqual(before);
});
it("records only a failed signal when storage configuration is missing", async () => {
  const bucket = process.env.BACKUP_R2_BUCKET;
  delete process.env.BACKUP_R2_BUCKET;
  try {
    await expect(restore.restoreDrill()).rejects.toThrow(
      "Restore drill failed",
    );
    const [row] = (
      await database.pool.query(
        "SELECT value FROM site_settings WHERE key='backup_restore_drill'",
      )
    ).rows;
    expect(row.value).toEqual({ passed: false, checkedAt: expect.any(String) });
  } finally {
    if (bucket !== undefined) process.env.BACKUP_R2_BUCKET = bucket;
  }
});

it("fresh migrations let the restricted worker start without schema creation rights", async () => {
  const queues = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    migrate: false,
    supervise: false,
    schedule: false,
  });
  try {
    await queues.start();
    await queues.createQueue("restore-bootstrap-test");
    expect(await queues.send("restore-bootstrap-test", {})).toEqual(
      expect.any(String),
    );
    expect(
      (
        await database.pool.query(
          "SELECT has_database_privilege('edu_app',current_database(),'CREATE') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  } finally {
    await queues.stop();
  }
});
