import "dotenv/config";
import PgBoss from "pg-boss";
import pino from "pino";
import { query, transaction, asSystem } from "@edu/db";
import {
  email,
  notifyCourse,
  publishNotes,
  awardLeague,
  sessionReport,
  weekly,
  dueReminders,
  calendarEvent,
} from "./jobs";
import { backup, zipNotes, exportAccount, deleteFiles } from "./storage";
import { restoreDrill } from "./restore-drill";
const log = pino();
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL!,
  migrate: false,
});
boss.on("error", (e) => log.error(e));
await boss.start();
const handlers: Record<string, (p: any, key: string) => Promise<unknown>> = {
  email: email,
  "notify:course": notifyCourse,
  "notes:publish": publishNotes,
  "league:award": awardLeague,
  "session:report": sessionReport,
  "league:weekly": weekly,
  reminders: dueReminders,
  backup: backup,
  "backup:restore-drill": restoreDrill,
  "notes:zip": zipNotes,
  "account:export": exportAccount,
  "files:delete": deleteFiles,
  "calendar:event": calendarEvent,
};
for (const [name, handler] of Object.entries(handlers)) {
  await boss.createQueue(name, {
    name,
    retryLimit: 8,
    retryDelay: 30,
    retryBackoff: true,
  });
  await boss.work(name, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      // Jobs are trusted server work: RLS lets them see every row (see packages/db).
      await asSystem(() => handler(job.data, job.id));
    }
  });
}
await boss.schedule("league:weekly", "5 0 * * 1", {}, { tz: "Asia/Kolkata" });
await boss.schedule("reminders", "0 * * * *");
await boss.schedule("backup", "0 2 * * *", {}, { tz: "Asia/Kolkata" });
await boss.schedule(
  "backup:restore-drill",
  "0 3 * * 0",
  {},
  { tz: "Asia/Kolkata" },
);
async function deliver() {
  await transaction(async (tx) => {
    const rows = (
      await tx.query(
        "SELECT * FROM outbox WHERE processed_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50",
      )
    ).rows;
    for (const row of rows) {
      await boss.send(row.kind, row.payload, {
        singletonKey: row.id,
        startAfter: row.payload.startAfter || undefined,
        retryLimit: 8,
      });
      await tx.query(
        "UPDATE outbox SET processed_at=now(),attempts=attempts+1 WHERE id=$1",
        [row.id],
      );
    }
  });
}
setInterval(() => asSystem(deliver).catch((e) => log.error(e)), 1000);
setInterval(
  () =>
    query(
      "INSERT INTO site_settings(id,key,value) VALUES('00000000-0000-7000-8000-000000000001','worker_health',to_jsonb(now())) ON CONFLICT(key) DO UPDATE SET value=to_jsonb(now())",
    ).catch((e) => log.error(e)),
  15000,
);
log.info("Worker ready");
