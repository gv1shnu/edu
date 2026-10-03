// Runs on the VPS. Only a fresh pass/fail signal may leave the server.
import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  query_timeout: 10000,
});
let passed = false;
try {
  const result = await pool.query(
    "SELECT 1 FROM site_settings WHERE key='backup_restore_drill' AND value->>'passed'='true' AND (value->>'checkedAt')::timestamptz > now()-interval '7 days'",
  );
  passed = result.rowCount === 1;
} catch {
  passed = false;
} finally {
  await pool.end();
}
console.log(passed ? "PASS" : "FAIL");
process.exitCode = passed ? 0 : 1;
