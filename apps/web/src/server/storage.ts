import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { query, transaction } from "@edu/db";
import { type Actor } from "@edu/shared";
import { v7 } from "uuid";
import { z } from "zod";
import { HttpError, permit, audit } from "./core";
import sharp from "sharp";
const client = () =>
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
const types: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    "pptx",
  ],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "text/plain": ["sql", "py", "txt", "md"],
  "text/csv": ["csv"],
  "application/json": ["ipynb"],
};
export async function signUpload(user: Actor, input: unknown) {
  const p = z
    .object({
      filename: z.string().min(1).max(200),
      mime: z.string(),
      size: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024),
      courseId: z.string().uuid().optional(),
      purpose: z.enum(["attachment", "avatar", "banner"]),
    })
    .parse(input);
  await permit(user, "account:manage", { userId: user.id });
  if (!types[p.mime]?.includes(p.filename.split(".").at(-1)!.toLowerCase()))
    throw new HttpError(400, "File type is not allowed");
  if (
    ["avatar", "banner"].includes(p.purpose) &&
    (!p.mime.startsWith("image/") || p.size > 2 * 1024 * 1024)
  )
    throw new HttpError(400, "Use an image under 2 MB");
  if (p.purpose === "attachment")
    await permit(user, "course:edit", { courseId: p.courseId });
  const key = `uploads/${user.id}/${v7()}/${p.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const id = v7();
  await query(
    "INSERT INTO uploads(id,user_id,course_id,r2_key,filename,mime,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, user.id, p.courseId || null, key, p.filename, p.mime, p.size],
  );
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: p.mime,
      ContentLength: p.size,
    }),
    { expiresIn: 300 },
  );
  return { id, key, url };
}
export async function finishUpload(user: Actor, input: unknown) {
  const p = z
    .object({
      id: z.string().uuid(),
      noteId: z.string().uuid().optional(),
      lessonId: z.string().uuid().optional(),
      profile: z.enum(["avatar", "banner"]).optional(),
    })
    .parse(input);
  await permit(user, "account:manage", { userId: user.id });
  const [u] = await query("SELECT * FROM uploads WHERE id=$1 AND user_id=$2", [
    p.id,
    user.id,
  ]);
  if (!u) throw new HttpError(404, "Upload not found");
  const head = await client().send(
    new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: u.r2_key }),
  );
  if (head.ContentLength !== u.size_bytes || head.ContentType !== u.mime)
    throw new HttpError(400, "Uploaded file does not match");
  if (u.mime.startsWith("image/")) {
    const file = await client().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: u.r2_key }),
    );
    const encoded = await sharp(
      Buffer.from(await file.Body!.transformToByteArray()),
      { limitInputPixels: 20e6 },
    )
      .rotate()
      .resize({
        width: p.profile === "avatar" ? 512 : 1920,
        withoutEnlargement: true,
      })
      .webp()
      .toBuffer();
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: u.r2_key,
        Body: encoded,
        ContentType: "image/webp",
      }),
    );
    u.mime = "image/webp";
    u.size_bytes = encoded.length;
  }
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE uploads SET verified=true,mime=$2,size_bytes=$3 WHERE id=$1",
      [u.id, u.mime, u.size_bytes],
    );
    if (p.noteId || p.lessonId) {
      const [resource] = await query(
        p.noteId
          ? "SELECT course_id FROM class_notes WHERE id=$1"
          : "SELECT m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=$1",
        [p.noteId || p.lessonId],
      );
      await permit(user, "course:edit", { courseId: resource?.course_id });
      if (resource.course_id !== u.course_id)
        throw new HttpError(400, "Course mismatch");
      const table = p.noteId ? "class_note_files" : "attachments";
      const fk = p.noteId ? "note_id" : "lesson_id";
      await tx.query(
        `INSERT INTO ${table}(id,${fk},r2_key,filename,mime,size_bytes) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          v7(),
          p.noteId || p.lessonId,
          u.r2_key,
          u.filename,
          u.mime,
          u.size_bytes,
        ],
      );
      await audit(tx, user, "file.attach", table, u.id, {
        filename: u.filename,
      });
    }
    if (p.profile === "banner")
      await tx.query("UPDATE profiles SET banner_r2_key=$2 WHERE user_id=$1", [
        user.id,
        u.r2_key,
      ]);
  });
  return { key: u.r2_key };
}
// markDownload=false for in-page previews, so "downloaded" analytics stay meaningful.
export async function download(
  user: Actor | null,
  id: string,
  markDownload = true,
) {
  let [f] = await query(
    "SELECT a.*,m.course_id,m.section_id,l.published,l.is_free_preview,m.release_at FROM attachments a JOIN lessons l ON l.id=a.lesson_id JOIN modules m ON m.id=l.module_id WHERE a.id=$1",
    [id],
  );
  let note = false;
  if (!f) {
    [f] = await query(
      "SELECT f.*,n.course_id,n.section_id,n.status='published' published,n.id note_id FROM class_note_files f JOIN class_notes n ON n.id=f.note_id WHERE f.id=$1",
      [id],
    );
    note = true;
  }
  if (!f) throw new HttpError(404, "File not found");
  await permit(user, "content:read", {
    courseId: f.course_id,
    sectionId: f.section_id,
    published: f.published,
    freePreview: f.is_free_preview,
    releaseAt: f.release_at,
  });
  if (note && user && markDownload)
    await query(
      "UPDATE class_note_reads SET downloaded=true,last_opened_at=now() WHERE note_id=$1 AND user_id=$2",
      [f.note_id, user.id],
    );
  return {
    url: await getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: f.r2_key,
        ResponseContentDisposition: `attachment; filename="${f.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      }),
      { expiresIn: 900 },
    ),
    mime: f.mime,
  };
}
export async function signGet(key: string) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
    { expiresIn: 900 },
  );
}
