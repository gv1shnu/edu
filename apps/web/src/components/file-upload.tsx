"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { api, perform } from "./data";
export function FileUpload({
  courseId,
  noteId,
  lessonId,
  onDone,
  purpose = "attachment",
}: {
  courseId?: string;
  noteId?: string;
  lessonId?: string;
  onDone?: (key: string) => void;
  purpose?: "attachment" | "avatar" | "banner";
}) {
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      await perform(async () => {
        const ext = file.name.split(".").at(-1);
        const mime =
          file.type ||
          (
            {
              sql: "text/plain",
              py: "text/plain",
              ipynb: "application/json",
              csv: "text/csv",
            } as Record<string, string>
          )[ext!] ||
          "text/plain";
        const signed = await api("uploads", {
          filename: file.name,
          mime,
          size: file.size,
          courseId,
          purpose,
        });
        const response = await fetch(signed.url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: file,
        });
        if (!response.ok) throw new Error("File upload failed");
        const result = await api("uploads/complete", {
          id: signed.id,
          noteId,
          lessonId,
          ...(["avatar", "banner"].includes(purpose)
            ? { profile: purpose }
            : {}),
        });
        onDone?.(result.key);
      }, `${file.name} uploaded`);
    }
    setBusy(false);
  }
  return (
    <div
      className="file-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files);
      }}
    >
      <Upload size={21} style={{ margin: "0 auto 8px" }} />
      <p>
        {busy ? "Uploading…" : "Drop files here or choose from your device"}
      </p>
      <input
        type="file"
        aria-label="Upload attachment"
        multiple
        disabled={busy}
        onChange={(e) => upload(e.target.files)}
      />
      <small className="muted">
        PDF, slides, images, SQL, Python, notebook or CSV · Up to 50 MB
      </small>
    </div>
  );
}
