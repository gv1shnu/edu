"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button, Empty } from "./ui";
export async function api(path: string, data?: unknown) {
  const res = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}
export function useData(path: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await api(path));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  return { data, error, reload, setData };
}
export function Loading({ error }: { error?: string }) {
  return error ? (
    <Empty title="We couldn’t open this page" body={error} />
  ) : (
    <div className="stack" aria-label="Loading">
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export async function perform(fn: () => Promise<unknown>, message = "Saved") {
  try {
    await fn();
    if (message) toast.success(message);
    return true;
  } catch (e: any) {
    toast.error(e.message);
    return false;
  }
}
export function DataTable({
  rows,
  columns,
  exportName = "export",
  render,
}: {
  rows: any[];
  columns: { key: string; label: string }[];
  exportName?: string;
  render?: (row: any) => React.ReactNode;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState(columns[0]?.key),
    [asc, setAsc] = useState(true),
    [page, setPage] = useState(0);
  const filtered = rows
    .filter((r) =>
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), undefined, {
          numeric: true,
        }) * (asc ? 1 : -1),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  function download() {
    const cell = (v: any) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const text = [
      columns.map((c) => cell(c.label)).join(","),
      ...filtered.map((r) => columns.map((c) => cell(r[c.key])).join(",")),
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = exportName + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <>
      <div className="table-tools">
        <input
          aria-label="Search table"
          placeholder="Search…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <Button variant="secondary" onClick={download}>
          Export CSV
        </Button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>
                  <button
                    style={{ background: "transparent", color: "inherit" }}
                    onClick={() => {
                      setSort(c.key);
                      setAsc(sort === c.key ? !asc : true);
                    }}
                  >
                    {c.label}
                    {sort === c.key ? (asc ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              {render && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * 10, page * 10 + 10).map((r, i) => (
              <tr key={r.id || i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {typeof r[c.key] === "object"
                      ? JSON.stringify(r[c.key])
                      : String(r[c.key] ?? "—")}
                  </td>
                ))}
                {render && <td>{render(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <Empty
            title="Nothing here yet"
            body="New records will appear here."
          />
        )}
      </div>
      <div className="pagination">
        <Button
          variant="ghost"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>
          {Math.min(page + 1, pages)} / {pages}
        </span>
        <Button
          variant="ghost"
          disabled={page >= pages - 1}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
