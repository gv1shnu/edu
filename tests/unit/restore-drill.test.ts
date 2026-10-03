import { describe, it, expect } from "vitest";
import { postgresEnv } from "../../apps/worker/src/postgres-env";
import { newestBackup } from "../../apps/worker/src/restore-drill";

describe("backup selection", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it("chooses the newest nonempty dump across listing pages", () => {
    expect(
      newestBackup(
        [
          {
            Key: "backups/older.dump",
            LastModified: new Date(now - 3600000),
            Size: 100,
          },
          {
            Key: "backups/newer.dump",
            LastModified: new Date(now - 1000),
            Size: 100,
          },
          {
            Key: "backups/not-a-dump.txt",
            LastModified: new Date(now),
            Size: 100,
          },
        ],
        now,
      ),
    ).toBe("backups/newer.dump");
  });
  it.each([
    [],
    [{ Key: "old.dump", LastModified: new Date(now - 37 * 3600000), Size: 1 }],
    [{ Key: "empty.dump", LastModified: new Date(now), Size: 0 }],
    [{ Key: "future.dump", LastModified: new Date(now + 1), Size: 1 }],
  ])("rejects missing, stale, empty or future backups", (...objects) => {
    expect(() => newestBackup(objects as any, now)).toThrow(
      "Restore drill failed",
    );
  });
});

it("passes decoded connection fields to libpq without putting the URI in PGDATABASE", () => {
  expect(
    postgresEnv(
      "postgresql://test:hello%40world@127.0.0.1:55432/demo?sslmode=require",
    ),
  ).toMatchObject({
    PGUSER: "test",
    PGPASSWORD: "hello@world",
    PGHOST: "127.0.0.1",
    PGPORT: "55432",
    PGDATABASE: "demo",
    PGSSLMODE: "require",
  });
});
