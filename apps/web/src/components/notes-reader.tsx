"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ImageIcon,
} from "lucide-react";
import { dateTime, htmlOutline } from "@edu/shared";
import { api, perform } from "./data";
import { HtmlView } from "./html-view";
import { Badge, Button, Dialog } from "./ui";

// pdf.js is large and browser-only, so it loads on demand.
const PdfViewer = dynamic(
  () => import("./pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => <p className="small muted">Loading PDF viewer…</p>,
  },
);

type NoteFile = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
};
const isPdf = (f: NoteFile) => f.mime === "application/pdf";
const isImage = (f: NoteFile) => f.mime.startsWith("image/");
const size = (n: number) =>
  n > 1e6
    ? `${(n / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1e3))} KB`;

/** Short-lived (≤15 min) pre-signed URLs, fetched when the reader opens. */
function useSignedUrls(files: NoteFile[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    Promise.all(
      files.map(
        async (f) =>
          [
            f.id,
            (await api(`files/${f.id}?intent=view`)).url as string,
          ] as const,
      ),
    )
      .then((pairs) => live && setUrls(Object.fromEntries(pairs)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [files]);
  return urls;
}

export function NoteReader({ note }: { note: any }) {
  const outline = useMemo(
    () => htmlOutline(note.body_html || ""),
    [note.body_html],
  );
  const files: NoteFile[] = note.files || [];
  const previewable = useMemo(
    () => files.filter((f) => isPdf(f) || isImage(f)),
    [files],
  );
  const urls = useSignedUrls(previewable);
  const images = files.filter(isImage);
  const [lightbox, setLightbox] = useState<number | null>(null);

  return (
    <div className="note-layout">
      {outline.length > 1 && (
        <nav className="note-toc panel" aria-label="On this page">
          <p className="small muted">On this page</p>
          <ol>
            {outline.map((h) => (
              <li key={h.id} className={h.level === 3 ? "toc-sub" : undefined}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <article className="panel lesson-content">
        <div className="row" style={{ gap: 8 }}>
          <Badge tone="gray">{dateTime(note.published_at)}</Badge>
          {note.edited && (
            <Badge tone="amber">Updated {dateTime(note.updated_at)}</Badge>
          )}
        </div>
        <HtmlView html={note.body_html} />

        {files.filter(isPdf).map((f) => (
          <section key={f.id} className="note-pdf" aria-label={f.filename}>
            <div className="row spread">
              <h3 className="row" style={{ gap: 8 }}>
                <FileText size={18} /> {f.filename}
              </h3>
              <DownloadButton file={f} />
            </div>
            {urls[f.id] ? (
              <PdfViewer url={urls[f.id]} title={f.filename} />
            ) : null}
          </section>
        ))}

        {images.length > 0 && (
          <div className="note-gallery">
            {images.map((f, i) =>
              urls[f.id] ? (
                <button
                  key={f.id}
                  className="note-thumb"
                  onClick={() => setLightbox(i)}
                  aria-label={`Open image ${f.filename}`}
                >
                  {/* Plain img: short-lived pre-signed R2 URL, not optimisable by next/image */}
                  <img src={urls[f.id]} alt={f.filename} loading="lazy" />
                </button>
              ) : (
                <span key={f.id} className="note-thumb placeholder">
                  <ImageIcon size={20} />
                </span>
              ),
            )}
          </div>
        )}

        {files.filter((f) => !isPdf(f) && !isImage(f)).length > 0 && (
          <div className="stack" style={{ marginTop: 20 }}>
            {files
              .filter((f) => !isPdf(f) && !isImage(f))
              .map((f) => (
                <DownloadButton key={f.id} file={f} wide />
              ))}
          </div>
        )}

        <Button
          style={{ marginTop: 20 }}
          onClick={() =>
            perform(
              () => api(`lessons/${note.lesson_id}/complete`, {}),
              "Notes marked as read",
            )
          }
        >
          Mark as read
        </Button>
        {note.stamp && (
          <footer className="note-stamp small muted">
            Shared with {note.stamp} for this class only. Please don’t
            redistribute.
          </footer>
        )}
      </article>

      {lightbox !== null && images[lightbox] && (
        <Dialog
          open
          onOpenChange={(open) => !open && setLightbox(null)}
          title={`${images[lightbox].filename} (${lightbox + 1} of ${images.length})`}
        >
          <div
            className="lightbox"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight")
                setLightbox((lightbox + 1) % images.length);
              if (e.key === "ArrowLeft")
                setLightbox((lightbox - 1 + images.length) % images.length);
            }}
          >
            {/* Plain img: short-lived pre-signed R2 URL, not optimisable by next/image */}
            <img
              src={urls[images[lightbox].id]}
              alt={images[lightbox].filename}
            />
            {images.length > 1 && (
              <div className="row spread">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setLightbox((lightbox - 1 + images.length) % images.length)
                  }
                >
                  <ChevronLeft size={16} /> Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setLightbox((lightbox + 1) % images.length)}
                >
                  Next <ChevronRight size={16} />
                </Button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function DownloadButton({
  file,
  wide = false,
}: {
  file: NoteFile;
  wide?: boolean;
}) {
  return (
    <button
      className={wide ? "attachment" : "icon-button"}
      aria-label={`Download ${file.filename}`}
      onClick={() =>
        perform(async () => {
          const r = await api(`files/${file.id}`);
          window.open(r.url, "_blank", "noopener,noreferrer");
        }, "")
      }
    >
      {wide && (
        <span className="row">
          <FileText size={18} />
          {file.filename}{" "}
          <span className="small muted">· {size(file.size_bytes)}</span>
        </span>
      )}
      <Download size={17} />
    </button>
  );
}
