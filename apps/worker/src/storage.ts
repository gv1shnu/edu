import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { query, transaction, collectAccountData } from "@edu/db";
import { spawn } from "node:child_process";
import { v7 } from "uuid";
import archiver from "archiver";
import { postgresEnv } from "./postgres-env";
const s3 = () =>
  new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    // Checksums only when the API requires them: otherwise presigned PUTs carry the checksum of an
    // empty body and R2 rejects the upload (Cloudflare recommends this for AWS SDK v3.729+).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
export async function backup() {
  if (!process.env.BACKUP_R2_BUCKET)
    throw new Error("Backup bucket is not configured");
  const child = spawn("pg_dump", ["--format=custom"], {
    env: postgresEnv(
      process.env.BACKUP_DATABASE_URL ||
        process.env.MIGRATION_DATABASE_URL ||
        process.env.DATABASE_URL!,
    ),
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 300000,
    killSignal: "SIGKILL",
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (d) => chunks.push(d));
  const exit = await new Promise<number | null>((resolve, reject) => {
    child.once("error", () => reject(new Error("pg_dump failed")));
    child.once("close", resolve);
  });
  if (exit !== 0) throw new Error("pg_dump failed");
  const Bucket = process.env.BACKUP_R2_BUCKET;
  await s3().send(
    new PutObjectCommand({
      Bucket,
      Key: `backups/${new Date().toISOString()}.dump`,
      Body: Buffer.concat(chunks),
    }),
  );
  const objects = await s3().send(
    new ListObjectsV2Command({ Bucket, Prefix: "backups/" }),
  );
  const expired = objects.Contents?.filter(
    (o) => o.LastModified && Date.now() - o.LastModified.getTime() > 30 * 864e5,
  ).map((o) => ({ Key: o.Key }));
  if (expired?.length)
    await s3().send(
      new DeleteObjectsCommand({ Bucket, Delete: { Objects: expired } }),
    );
}
export async function zipNotes(p: any) {
  const files = await query(
    "SELECT * FROM class_note_files WHERE note_id=$1 ORDER BY position",
    [p.noteId],
  );
  const zip = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.on("data", (d) => chunks.push(d));
    zip.on("error", reject);
    zip.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const f of files) {
    const response = await s3().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: f.r2_key }),
    );
    zip.append(Buffer.from(await response.Body!.transformToByteArray()), {
      name: f.filename.replace(/[^a-zA-Z0-9._-]/g, "_"),
    });
  }
  await zip.finalize();
  const data = await done;
  const key = `notes/${p.noteId}/${v7()}.zip`;
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: data,
      ContentType: "application/zip",
    }),
  );
  await query("UPDATE class_notes SET zip_r2_key=$2 WHERE id=$1", [
    p.noteId,
    key,
  ]);
}
export async function exportAccount(p: any) {
  const data = await transaction((tx) => collectAccountData(tx, p.userId));
  const key = `exports/${p.userId}/${v7()}.json`;
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
    }),
  );
  await query(
    "INSERT INTO notifications(id,user_id,kind,title,body,link) VALUES($1,$2,'export','Your data export is ready','Download your personal data from account settings.',$3)",
    [v7(), p.userId, `/api/files/export?key=${encodeURIComponent(key)}`],
  );
}

// After account deletion: remove the person's files from object storage.
export async function deleteFiles(p: { keys: string[] }) {
  if (!p.keys?.length) return;
  for (let i = 0; i < p.keys.length; i += 1000)
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET,
        Delete: { Objects: p.keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
}
