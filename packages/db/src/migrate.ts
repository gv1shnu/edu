import "dotenv/config";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, escapeLiteral } from "pg";
import PgBoss from "pg-boss";

// Migrations run as the table owner. The app itself connects as the restricted edu_app role
// (DATABASE_URL); when that's the case, this also enables its login with the URL's password.
const ownerUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: ownerUrl });
try {
  await migrate(drizzle(pool), { migrationsFolder: "packages/db/migrations" });
  // Bootstrap queue tables with owner rights; the runtime role cannot create schemas.
  // Scheduling and supervision stay off so a restore drill cannot run restored jobs.
  const queues = new PgBoss({
    connectionString: ownerUrl!,
    supervise: false,
    schedule: false,
  });
  try {
    await queues.start();
  } finally {
    await queues.stop();
  }
  await pool.query(await readFile("packages/db/rls.sql", "utf8"));
  await pool.query(await readFile("packages/db/views.sql", "utf8"));
  const runtime = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : null;
  if (process.env.MIGRATION_DATABASE_URL && runtime?.username === "edu_app") {
    const password = decodeURIComponent(runtime.password);
    await pool.query(
      `ALTER ROLE edu_app LOGIN ${password ? "PASSWORD " + escapeLiteral(password) : ""}`,
    );
    console.log("Runtime role edu_app can log in.");
  }
  console.log("Migrations, policies and analytics views applied.");
} finally {
  await pool.end();
}
