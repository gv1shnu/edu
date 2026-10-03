import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    "SELECT 1 FROM site_settings WHERE key='worker_health' AND (value#>>'{}')::timestamptz>now()-interval '90 seconds'",
  );
  process.exitCode = result.rowCount ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
