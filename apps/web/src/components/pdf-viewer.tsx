"use client";
import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui";

// Bundled worker served from our own origin (CSP worker-src 'self').
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfViewer({ url, title }: { url: string; title: string }) {
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <p className="small muted">
        This PDF couldn’t be shown here. Use the download button instead.
      </p>
    );
  return (
    <div
      className="pdf-viewer"
      ref={(el) => {
        if (el && el.clientWidth !== width) setWidth(el.clientWidth);
      }}
    >
      <Document
        file={url}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        onLoadError={() => setFailed(true)}
        loading={<p className="small muted">Loading {title}…</p>}
      >
        <Page pageNumber={page} width={width || undefined} />
      </Document>
      {pages > 0 && (
        <div className="row spread pdf-controls">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </Button>
          <span className="small" aria-live="polite">
            Page {page} of {pages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
