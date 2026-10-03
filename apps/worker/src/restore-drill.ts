import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { query } from "@edu/db";
import { postgresEnv } from "./postgres-env";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// Child output can contain restored rows or credentials. Never log or return it.
function command(program: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: root,
      env,
      stdio: "ignore",
      timeout: 300000,
      killSignal: "SIGKILL",
    });
    child.once("error", () => reject(new Error("Restore drill failed")));
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Restore drill failed")),
    );
  });
}

export function newestBackup(objects: _Object[], now = Date.now()) {
  const latest = objects
    .filter(
      (o) => o.Key?.endsWith(".dump") && o.LastModified && (o.Size ?? 0) > 0,
    )
    .sort((a, b) => b.LastModified!.getTime() - a.LastModified!.getTime())[0];
  if (
    !latest ||
    now - latest.LastModified!.getTime() > 36 * 3600000 ||
    latest.LastModified!.getTime() > now
  )
    throw new Error("Restore drill failed");
  return latest.Key!;
}

// A random empty database on the same server; never restore over the application DB.
export async function verifyBackup(ownerUrl: string, dump: string) {
  const name = "edu_restore_" + randomUUID().replaceAll("-", "");
  const target = new URL(ownerUrl);
  target.pathname = "/" + name;
  const admin = new Pool({
    connectionString: ownerUrl,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    // Runtime users must not be able to connect to restored personal data.
    await admin.query(`REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC`);
    const env = {
      ...postgresEnv(target.toString()),
      DATABASE_URL: target.toString(),
      MIGRATION_DATABASE_URL: target.toString(),
    };
    await command(
      "pg_restore",
      [
        "--dbname",
        name,
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        resolve(dump),
      ],
      env,
    );
    const restored = new Pool({
      connectionString: target.toString(),
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
    });
    try {
      // Empty orders are valid before the first payment. Verify every core table is readable.
      for (const table of ["users", "courses", "course_members", "orders"])
        await restored.query(`SELECT 1 FROM ${table} LIMIT 1`);
      await command("pnpm", ["db:migrate"], env);
      for (const table of ["users", "courses", "course_members", "orders"])
        await restored.query(`SELECT 1 FROM ${table} LIMIT 1`);
    } finally {
      await restored.end();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

export async function restoreDrill() {
  let directory: string | undefined;
  let passed = false;
  try {
    const Bucket = process.env.BACKUP_R2_BUCKET;
    const owner =
      process.env.BACKUP_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
    if (!Bucket || !owner) throw new Error("Restore drill failed");
    const client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    try {
      const objects: _Object[] = [];
      let ContinuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: "backups/",
            ContinuationToken,
          }),
        );
        objects.push(...(page.Contents || []));
        ContinuationToken = page.IsTruncated
          ? page.NextContinuationToken
          : undefined;
      } while (ContinuationToken);
      const Key = newestBackup(objects);
      directory = await mkdtemp(join(tmpdir(), "edu-restore-"));
      const dump = join(directory, "backup.dump");
      const object = await client.send(new GetObjectCommand({ Bucket, Key }));
      if (!object.Body) throw new Error("Restore drill failed");
      await pipeline(
        object.Body as Readable,
        createWriteStream(dump, { mode: 0o600 }),
      );
      await verifyBackup(owner, dump);
      passed = true;
    } finally {
      client.destroy();
    }
  } catch {
    // Store only the signal, never the backup key, row counts, or exception details.
    passed = false;
  } finally {
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        passed = false;
      }
    }
    await query(
      "INSERT INTO site_settings(id,key,value) VALUES($1,'backup_restore_drill',$2) ON CONFLICT(key) DO UPDATE SET value=$2",
      [
        randomUUID(),
        JSON.stringify({ passed, checkedAt: new Date().toISOString() }),
      ],
    );
  }
  if (!passed) throw new Error("Restore drill failed");
}
