"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Plus,
  ArrowUpRight,
  BookOpen,
  NotebookPen,
  Radio,
  BarChart3,
  Pencil,
  Users,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { money, dateTime } from "@edu/shared";
import { api, useData, Loading, perform, DataTable } from "./data";
import { PageHeading } from "./learning";
import { Button, Badge, Dialog, Empty } from "./ui";
import { MarkdownView } from "./markdown";
import { FileUpload } from "./file-upload";
import { authClient } from "./shell";

type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "checkbox"
    | "select"
    | "datetime-local"
    | "json"
    | "html";
  options?: { value: string; label: string }[];
  required?: boolean;
};
type Editor = {
  title: string;
  endpoint: string;
  values: Record<string, any>;
  fields: Field[];
  transform?: (v: any) => any;
};
export function RecordEditor({
  editor,
  onClose,
  onSave,
}: {
  editor: Editor;
  onClose: () => void;
  onSave: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { isSubmitting },
  } = useForm({
    defaultValues: editor.values,
    resolver: zodResolver(z.record(z.any())),
  });
  const values = watch();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={editor.title}
    >
      <form
        onSubmit={handleSubmit(async (v) => {
          const payload = { ...v };
          for (const f of editor.fields) {
            if (f.type === "number")
              payload[f.key] =
                payload[f.key] === "" ? null : Number(payload[f.key]);
            if (f.type === "datetime-local")
              payload[f.key] = payload[f.key]
                ? new Date(payload[f.key]).toISOString()
                : null;
            if (f.type === "json" && typeof payload[f.key] === "string") {
              try {
                payload[f.key] = JSON.parse(payload[f.key]);
              } catch {
                throw new Error("Invalid structured data");
              }
            }
          }
          if (
            await perform(() =>
              api(
                editor.endpoint,
                editor.transform ? editor.transform(payload) : payload,
              ),
            )
          ) {
            onSave();
            onClose();
          }
        })}
      >
        {editor.fields.map((f) => (
          <div className="form-group" key={f.key}>
            {f.type === "checkbox" ? (
              <label>
                <input type="checkbox" {...register(f.key)} />
                {f.label}
              </label>
            ) : (
              <>
                <label htmlFor={"edit-" + f.key}>{f.label}</label>
                {f.type === "html" && (
                  <input
                    type="file"
                    accept=".html,.htm,text/html"
                    aria-label={`Load ${f.label} from an HTML file`}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        setValue(f.key, await file.text(), {
                          shouldDirty: true,
                        });
                    }}
                  />
                )}
                {f.type === "textarea" ||
                f.type === "json" ||
                f.type === "html" ? (
                  <textarea
                    id={"edit-" + f.key}
                    {...register(f.key)}
                    required={f.required}
                  />
                ) : f.type === "select" ? (
                  <select
                    id={"edit-" + f.key}
                    {...register(f.key)}
                    required={f.required}
                  >
                    <option value="">Choose…</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={"edit-" + f.key}
                    type={f.type || "text"}
                    {...register(f.key)}
                    required={f.required}
                  />
                )}
              </>
            )}
            {f.key === "description_md" && values[f.key] && (
              <details>
                <summary className="small" style={{ marginTop: 10 }}>
                  Preview formatting
                </summary>
                <MarkdownView content={values[f.key]} />
              </details>
            )}
          </div>
        ))}
        <Button disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Dialog>
  );
}
const text = (key: string, label: string, required = true): Field => ({
  key,
  label,
  required,
});
const select = (
  key: string,
  label: string,
  items: any[],
  value = "id",
  name = "title",
): Field => ({
  key,
  label,
  type: "select",
  options: items.map((v) => ({ value: String(v[value]), label: v[name] })),
});
const choice = (key: string, label: string, values: string[]): Field =>
  select(
    key,
    label,
    values.map((v) => ({ id: v, title: v.replaceAll("_", " ") })),
  );
function SortableLesson({
  lesson,
  onEdit,
}: {
  lesson: any;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: lesson.id });
  return (
    <div
      className="sortable-item"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${lesson.title}`}
      >
        <GripVertical size={17} />
      </button>
      <span>{lesson.title}</span>
      <Badge tone={lesson.published ? "green" : "gray"}>
        {lesson.published ? "Published" : "Draft"}
      </Badge>
      <button onClick={onEdit} aria-label={`Edit ${lesson.title}`}>
        <Pencil size={16} />
      </button>
    </div>
  );
}
export function Teach({
  courseId,
  section = "content",
}: {
  courseId?: string;
  section?: string;
}) {
  const { data, error, reload } = useData(
    courseId ? "teach/" + courseId : "teach",
  );
  const tracks = useData("tracks");
  const [editor, setEditor] = useState<Editor | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  if (!data) return <Loading error={error} />;
  function courseEditor(c?: any) {
    setEditor({
      title: c ? "Course settings" : "Create a course",
      endpoint: c ? "courses/" + c.id : "courses",
      values: {
        title: c?.title || "",
        slug: c?.slug || "",
        track_id: c?.track_id || "",
        subtitle: c?.subtitle || "",
        description_md: c?.description_md || "",
        visibility: c?.visibility || "draft",
        stamp_email: c?.stamp_email || false,
      },
      fields: [
        text("title", "Course title"),
        text("slug", "URL name (lowercase-with-hyphens)"),
        select(
          "track_id",
          "Subject (add subjects under Admin)",
          tracks.data || [],
          "id",
          "name",
        ),
        text("subtitle", "One-line introduction"),
        {
          key: "description_md",
          label: "Course description",
          type: "textarea",
        },
        choice("visibility", "Visibility", ["draft", "published", "archived"]),
        {
          key: "stamp_email",
          label: "Show each reader’s email in the class-notes footer",
          type: "checkbox",
        },
      ],
    });
  }
  function lessonEditor(l?: any) {
    const defaults = {
      module_id: l?.module_id || data.modules[0]?.id || "",
      title: l?.title || "",
      type: l?.type || "html",
      body_html: l?.body_html || "",
      position: l?.position || 0,
      published: l?.published || false,
      is_free_preview: l?.is_free_preview || false,
    };
    setEditor({
      title: l ? "Edit lesson" : "New lesson",
      endpoint: "lessons" + (l ? "/" + l.id : ""),
      values: defaults,
      fields: [
        select("module_id", "Module", data.modules),
        text("title", "Lesson title"),
        choice("type", "Lesson format", ["html", "file"]),
        {
          key: "body_html",
          label: "Lesson content · HTML",
          type: "html",
        },
        { key: "position", label: "Position", type: "number" },
        { key: "published", label: "Publish lesson", type: "checkbox" },
        {
          key: "is_free_preview",
          label: "Allow a free public preview",
          type: "checkbox",
        },
      ],
    });
  }
  function noteEditor(n?: any) {
    setEditor({
      title: n ? "Edit class notes" : "Create class notes",
      endpoint: "notes" + (n ? "/" + n.id : ""),
      values: {
        course_id: courseId,
        section_id: n?.section_id || "",
        live_session_id: n?.live_session_id || null,
        title: n?.title || "",
        body_html: n?.body_html || "",
        status: n?.status || "draft",
        ...(n?.status === "published" ? { renotify: false } : {}),
        publish_at: n?.publish_at
          ? new Date(n.publish_at).toISOString().slice(0, 16)
          : "",
      },
      fields: [
        text("title", "Note title"),
        select("section_id", "Batch", data.sections, "id", "name"),
        {
          key: "body_html",
          label: "Notes · HTML",
          type: "html",
        },
        ...(n?.status === "published"
          ? [
              choice("status", "Publish options", ["published"]),
              {
                key: "renotify",
                label: "Tell the batch these notes were updated",
                type: "checkbox",
              } as Field,
            ]
          : [
              choice("status", "Publish options", [
                "draft",
                "published",
                "scheduled",
              ]),
              {
                key: "publish_at",
                label: "Schedule date and time",
                type: "datetime-local",
              } as Field,
            ]),
      ],
      transform: (v) => ({
        ...v,
        section_id: v.section_id || null,
        ...(n?.status === "published"
          ? { publish_at: null }
          : { renotify: undefined }),
      }),
    });
  }
  return (
    <>
      <PageHeading
        title={courseId ? data.course?.title || "Course builder" : "Courses"}
        subtitle={courseId ? "Manage lessons, notes and classes." : undefined}
      >
        {!courseId ? (
          <Button onClick={() => courseEditor()}>
            <Plus size={17} />
            Create course
          </Button>
        ) : (
          <div className="row">
            <Button
              variant="secondary"
              onClick={() => courseEditor(data.course)}
            >
              <Pencil size={16} />
              Course settings
            </Button>
            <Link
              className="button secondary"
              href={`/courses/${data.course?.slug}`}
            >
              Preview as student <ArrowUpRight size={17} />
            </Link>
          </div>
        )}
      </PageHeading>
      {!courseId ? (
        <div className="course-grid">
          {data.courses.map((c: any) => (
            <Link href={`/teach/courses/${c.id}`} className="panel" key={c.id}>
              <Badge>{c.track_name}</Badge>
              <h3 style={{ margin: "18px 0" }}>{c.title}</h3>
              <div className="row spread">
                <span className="small muted">{c.visibility}</span>
                <ArrowUpRight size={22} />
              </div>
            </Link>
          ))}
          {!data.courses.length && (
            <Empty
              title="No courses yet"
              body="Create a course, or ask the owner to assign your teaching access."
            />
          )}
        </div>
      ) : (
        <>
          <div className="tabs">
            {[
              ["content", "Lessons", BookOpen],
              ["notes", "Class notes", NotebookPen],
              ["live", "Live classes", Radio],
              ["analytics", "Analytics", BarChart3],
            ].map(([key, label, Icon]: any) => (
              <Link
                key={key}
                className={section === key ? "active" : ""}
                href={`/teach/courses/${courseId}/${key}`}
              >
                <Icon size={15} style={{ display: "inline", marginRight: 6 }} />
                {label}
              </Link>
            ))}
          </div>
          {section === "content" ? (
            <>
              <div className="row" style={{ marginBottom: 24 }}>
                <Button
                  onClick={() =>
                    setEditor({
                      title: "New module",
                      endpoint: "modules",
                      values: {
                        courseId,
                        title: "",
                        position: data.modules.length,
                        releaseAt: "",
                      },
                      fields: [
                        text("title", "Module title"),
                        { key: "position", label: "Position", type: "number" },
                        {
                          key: "releaseAt",
                          label: "Unlock date (optional)",
                          type: "datetime-local",
                        },
                      ],
                    })
                  }
                >
                  + Module
                </Button>
                <Button
                  variant="secondary"
                  disabled={!data.modules.length}
                  onClick={() => lessonEditor()}
                >
                  + Lesson
                </Button>
              </div>
              {data.modules.map((m: any) => (
                <section className="panel" key={m.id}>
                  <h2>{m.title}</h2>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={({ active, over }) => {
                      if (over && active.id !== over.id) {
                        const ids = data.lessons
                          .filter((l: any) => l.module_id === m.id)
                          .map((l: any) => l.id);
                        void perform(async () => {
                          await api("reorder", {
                            courseId,
                            ids: arrayMove(
                              ids,
                              ids.indexOf(active.id),
                              ids.indexOf(over.id),
                            ),
                          });
                          await reload();
                        }, "Lesson order saved");
                      }
                    }}
                  >
                    <SortableContext
                      items={data.lessons
                        .filter((l: any) => l.module_id === m.id)
                        .map((l: any) => l.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {data.lessons
                        .filter((l: any) => l.module_id === m.id)
                        .map((l: any) => (
                          <SortableLesson
                            key={l.id}
                            lesson={l}
                            onEdit={() => lessonEditor(l)}
                          />
                        ))}
                    </SortableContext>
                  </DndContext>
                </section>
              ))}
            </>
          ) : section === "notes" ? (
            <>
              <Button onClick={() => noteEditor()} style={{ marginBottom: 24 }}>
                + Class notes
              </Button>
              {data.notes.map((n: any) => (
                <section className="panel" key={n.id}>
                  <div className="row spread">
                    <div>
                      <Badge tone={n.status === "published" ? "green" : "gray"}>
                        {n.status}
                      </Badge>
                      <h3 style={{ marginTop: 12 }}>{n.title}</h3>
                    </div>
                    <Button variant="secondary" onClick={() => noteEditor(n)}>
                      Edit notes
                    </Button>
                  </div>
                  <FileUpload
                    courseId={courseId}
                    noteId={n.id}
                    onDone={() => reload()}
                  />
                  {n.status === "published" && (
                    <Link href={`/notes/${n.id}`} className="text-link">
                      Open published note ↗
                    </Link>
                  )}
                </section>
              ))}
            </>
          ) : section === "live" ? (
            <>
              <Button
                style={{ marginBottom: 24 }}
                onClick={() =>
                  setEditor({
                    title: "Start a live class",
                    endpoint: "live",
                    values: {
                      courseId,
                      sectionId: data.sections[0]?.id || "",
                      title: "",
                      scheduledAt: "",
                      durationMin: 60,
                    },
                    fields: [
                      text("title", "Class title"),
                      select("sectionId", "Batch", data.sections, "id", "name"),
                      {
                        key: "scheduledAt",
                        label: "Scheduled start (optional)",
                        type: "datetime-local",
                      },
                      {
                        key: "durationMin",
                        label: "Length (minutes)",
                        type: "number",
                      },
                    ],
                    transform: (v) => ({
                      ...v,
                      sectionId: v.sectionId || null,
                    }),
                  })
                }
              >
                + Start or schedule class
              </Button>
              <CalendarConnect connected={data.calendarConnected} />
              {data.live.map((s: any) => (
                <div className="panel row spread" key={s.id}>
                  <div>
                    <Badge tone={s.ended_at ? "gray" : "green"}>
                      {s.ended_at ? "Ended" : "Live"}
                    </Badge>
                    <h3 style={{ margin: "10px 0" }}>{s.title}</h3>
                    <p className="small">{dateTime(s.started_at)}</p>
                  </div>
                  <Link
                    className="button secondary"
                    href={
                      s.ended_at
                        ? `/teach/live/${s.id}/report`
                        : `/live/${s.id}`
                    }
                  >
                    {s.ended_at ? "Session report" : "Open classroom"} ↗
                  </Link>
                </div>
              ))}
            </>
          ) : (
            <Analytics id={courseId} />
          )}
        </>
      )}
      {editor && (
        <RecordEditor
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={() => reload()}
        />
      )}
    </>
  );
}
/** Scheduled classes go on the tutor's Google Calendar once it is connected. */
function CalendarConnect({ connected }: { connected: boolean }) {
  if (connected)
    return (
      <p className="small muted" style={{ marginBottom: 24 }}>
        Google Calendar is connected. Scheduled classes are added to your
        calendar and the batch is invited.
      </p>
    );
  return (
    <div className="panel row spread">
      <p className="small">
        Connect Google Calendar to add scheduled classes to your calendar and
        invite the batch automatically.
      </p>
      <Button
        variant="secondary"
        onClick={() =>
          perform(
            () =>
              authClient.linkSocial({
                provider: "google",
                scopes: ["https://www.googleapis.com/auth/calendar.events"],
                callbackURL: window.location.pathname,
              }),
            "",
          )
        }
      >
        Connect Google Calendar
      </Button>
    </div>
  );
}
export function Analytics({ id }: { id: string }) {
  const { data, error } = useData("analytics/" + id);
  if (!data) return <Loading error={error} />;
  const average = (rows: any[], key: string) =>
    rows.length
      ? Math.round(
          rows.reduce((s, r) => s + Number(r[key] || 0), 0) / rows.length,
        )
      : 0;
  return (
    <>
      <div className="stats-grid">
        {[
          ["Learners", data.progress.length],
          ["Average completion", average(data.progress, "completion") + "%"],
          ["Attendance", average(data.attendance, "attendance") + "%"],
          ["Needs a check-in", data.atRisk.length],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <strong>{value}</strong>
            <p>{label}</p>
          </div>
        ))}
      </div>
      <div className="panel">
        <h2>Learning progress</h2>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.progress}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="completion" fill="#7561ce" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="panel">
        <h2>Learners who may need support</h2>
        {data.atRisk.length ? (
          data.atRisk.map((s: any) => (
            <div key={s.user_id} className="notes-row">
              <Users size={19} />
              <div>
                <h3>{s.name}</h3>
                <p>{s.reasons.join(" · ")}</p>
              </div>
            </div>
          ))
        ) : (
          <p>No learners match the current at-risk rules.</p>
        )}
      </div>
    </>
  );
}
export function SessionReport({ id }: { id: string }) {
  const { data, error } = useData("reports/" + id);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeading
        title={data.session.title}
        subtitle="Attendance and class feedback."
      >
        <Link
          className="button"
          href={`/teach/courses/${data.session.course_id}/notes`}
        >
          Add class notes
        </Link>
      </PageHeading>
      <div className="panel">
        <h2>Attendance</h2>
        <DataTable
          rows={data.attendance.map((r: any) => ({
            ...r,
            minutes: Number(r.minutes).toFixed(1),
            attendance_complete: r.attendance_complete
              ? "Complete"
              : "Incomplete",
          }))}
          columns={[
            { key: "name", label: "Learner" },
            { key: "minutes", label: "Minutes" },
            { key: "attendance_complete", label: "Completed attendance" },
          ]}
        />
      </div>
      <div className="panel">
        <h2>Confusion summary</h2>
        {data.confusion.map((c: any) => (
          <Badge key={c.topic}>
            {c.topic} · {c.count}
          </Badge>
        ))}
        {!data.confusion.length && <p>No confusion topics were submitted.</p>}
      </div>
      <div className="panel">
        <h2>Poll answers</h2>
        <DataTable
          rows={data.answers}
          columns={[
            { key: "prompt", label: "Poll" },
            { key: "name", label: "Learner" },
            { key: "response", label: "Answer" },
          ]}
        />
      </div>
      <div className="panel">
        <h2>Exit tickets</h2>
        <DataTable
          rows={data.tickets}
          columns={[
            { key: "name", label: "Learner" },
            { key: "prompt", label: "Question" },
            { key: "response", label: "Response" },
            { key: "confused_about", label: "Confusion" },
          ]}
        />
      </div>
      <div className="panel">
        <h2>Class conversation</h2>
        <DataTable
          rows={data.chat}
          columns={[
            { key: "name", label: "Learner" },
            { key: "body", label: "Message" },
            { key: "kind", label: "Type" },
          ]}
        />
      </div>
    </>
  );
}
const localInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function trackEditor(t?: any): Editor {
  return {
    title: t ? "Edit subject" : "Add a subject",
    endpoint: "admin/track",
    values: {
      name: t?.name || "",
      accentColor: t?.accent_color || "#4f46e5",
      icon: t?.icon || "book-open",
      description: t?.description || "",
    },
    fields: [
      text("name", "Subject name, e.g. Data & SQL"),
      text("accentColor", "Accent colour (#RRGGBB)"),
      text("icon", "Icon name", false),
      { key: "description", label: "Short description", type: "textarea" },
    ],
    transform: (v) => ({ ...v, id: t?.id }),
  };
}
function batchEditor(data: any, b?: any): Editor {
  return {
    title: b ? "Edit batch" : "Create a batch",
    endpoint: "admin/section",
    values: {
      courseId: b?.course_id || "",
      name: b?.name || "",
      startsAt: localInput(b?.starts_at),
      endsAt: localInput(b?.ends_at),
      color: b?.color || "#4f46e5",
      emoji: b?.emoji || "⚡",
    },
    fields: [
      select("courseId", "Course", data.courses),
      text("name", "Batch name, e.g. Weekend SQL — Oct"),
      { key: "startsAt", label: "Starts", type: "datetime-local" },
      { key: "endsAt", label: "Ends", type: "datetime-local" },
      text("color", "League colour (#RRGGBB)"),
      text("emoji", "League emoji"),
    ],
    transform: (v) => ({ ...v, id: b?.id }),
  };
}
function offeringEditor(data: any, o?: any): Editor {
  return {
    title: o ? "Edit offering" : "Create an offering",
    endpoint: "admin/offering",
    values: {
      courseId: o?.course_id || "",
      sectionId: o?.section_id || "",
      title: o?.title || "",
      priceRupees: o ? o.price_inr / 100 : 2999,
      billing: o?.billing || "one_time",
      startsAt: localInput(o?.starts_at),
      active: o ? o.active : true,
    },
    fields: [
      select("courseId", "Course", data.courses),
      {
        ...select(
          "sectionId",
          "Batch (optional; enrols into this batch)",
          data.sections.map((s: any) => ({
            id: s.id,
            title: `${s.course_title} · ${s.name}`,
          })),
        ),
        required: false,
      },
      text("title", "Title shown to students"),
      {
        key: "priceRupees",
        label: "Price in ₹ (0 = free, enrols directly)",
        type: "number",
        required: true,
      },
      choice("billing", "Billing", ["one_time", "monthly"]),
      { key: "startsAt", label: "Starts", type: "datetime-local" },
      {
        key: "active",
        label: "Active (visible on the course page)",
        type: "checkbox",
      },
    ],
    transform: (v) => ({ ...v, id: o?.id, sectionId: v.sectionId || null }),
  };
}
export function Admin({ section }: { section?: string }) {
  const { data, error, reload } = useData(
    "admin" + (section ? "/" + section : ""),
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeading
        title={
          section === "staff"
            ? "Teaching crew"
            : section === "settings"
              ? "Site settings"
              : "Administration"
        }
      />
      <div className="tabs">
        <Link className={!section ? "active" : ""} href="/admin">
          Overview
        </Link>
        <Link
          className={section === "staff" ? "active" : ""}
          href="/admin/staff"
        >
          Staff
        </Link>
        <Link
          className={section === "settings" ? "active" : ""}
          href="/admin/settings"
        >
          Site settings
        </Link>
      </div>
      {section === "staff" ? (
        <>
          <Button
            style={{ marginBottom: 20 }}
            onClick={() =>
              setEditor({
                title: "Invite a tutor",
                endpoint: "admin/staff",
                values: { email: "", courseId: "" },
                fields: [
                  text("email", "Gmail address"),
                  select("courseId", "Course", data.courses),
                ],
                transform: (v) => ({
                  ...v,
                  courseId: v.courseId || undefined,
                }),
              })
            }
          >
            Invite staff
          </Button>
          <DataTable
            rows={data.invites}
            columns={[
              { key: "email", label: "Email" },
              { key: "role", label: "Role" },
              { key: "accepted_at", label: "Accepted" },
              { key: "revoked_at", label: "Revoked" },
            ]}
            render={(s) => (
              <Button
                variant="ghost"
                disabled={!!s.revoked_at}
                onClick={() =>
                  perform(async () => {
                    await api("admin/staff/revoke", { id: s.id });
                    await reload();
                  }, "Staff access revoked")
                }
              >
                Revoke
              </Button>
            )}
          />
        </>
      ) : section === "settings" ? (
        <div className="stack">
          {data.map((s: any) => (
            <div className="panel row spread" key={s.id}>
              <div>
                <h3>{s.key === "terms" ? "Terms" : "Privacy"}</h3>
                <p className="small">
                  {s.value ? s.value.slice(0, 110) : "Not written yet"}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  setEditor({
                    title: "Edit " + (s.key === "terms" ? "terms" : "privacy"),
                    endpoint: "admin/settings",
                    values: { key: s.key, value: s.value },
                    fields: [
                      {
                        key: "value",
                        label: "Content · Markdown",
                        type: "textarea",
                      },
                    ],
                  })
                }
              >
                Edit
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="stats-grid">
            {[
              [
                "Total revenue",
                money(
                  data.revenue.reduce((s: number, r: any) => s + r.amount, 0),
                ),
              ],
              ["Active students", data.students[0]?.count || 0],
              ["Orders", data.orders.length],
              ["Offerings", data.offerings.length],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <strong>{value}</strong>
                <p>{label}</p>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>Revenue by month</h2>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.revenue.map((r: any) => ({
                    ...r,
                    inr: r.amount / 100,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="inr"
                    stroke="#7561ce"
                    strokeWidth={3}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="panel">
            <h2>Orders</h2>
            <DataTable
              rows={data.orders.map((o: any) => ({
                ...o,
                amount: money(o.amount_paise),
              }))}
              columns={[
                { key: "name", label: "Learner" },
                { key: "title", label: "Offering" },
                { key: "amount", label: "Amount" },
                { key: "status", label: "Status" },
                { key: "receipt_number", label: "Receipt" },
              ]}
            />
          </div>
          <div className="panel">
            <div className="row spread" style={{ marginBottom: 20 }}>
              <h2>Subjects</h2>
              <Button onClick={() => setEditor(trackEditor())}>
                + Subject
              </Button>
            </div>
            <DataTable
              rows={data.tracks}
              columns={[
                { key: "name", label: "Subject" },
                { key: "accent_color", label: "Colour" },
                { key: "courses", label: "Courses" },
              ]}
              render={(t) => (
                <Button
                  variant="ghost"
                  onClick={() => setEditor(trackEditor(t))}
                >
                  Edit
                </Button>
              )}
            />
          </div>
          <div className="panel">
            <div className="row spread" style={{ marginBottom: 20 }}>
              <h2>Batches</h2>
              <Button onClick={() => setEditor(batchEditor(data))}>
                + Batch
              </Button>
            </div>
            <DataTable
              rows={data.sections.map((b: any) => ({
                ...b,
                label: `${b.emoji} ${b.name}`,
                starts: b.starts_at ? dateTime(b.starts_at) : "—",
                fill: b.enrolled,
              }))}
              columns={[
                { key: "label", label: "Batch" },
                { key: "course_title", label: "Course" },
                { key: "starts", label: "Starts" },
                { key: "fill", label: "Enrolled" },
              ]}
              render={(b) => (
                <Button
                  variant="ghost"
                  onClick={() => setEditor(batchEditor(data, b))}
                >
                  Edit
                </Button>
              )}
            />
          </div>
          <div className="panel">
            <div className="row spread" style={{ marginBottom: 20 }}>
              <h2>Offerings &amp; prices</h2>
              <Button onClick={() => setEditor(offeringEditor(data))}>
                + Offering
              </Button>
            </div>
            <DataTable
              rows={data.offerings.map((o: any) => ({
                ...o,
                price: money(o.price_inr),
                batch_name: o.batch_name ?? "Any batch",
                billed: o.billing === "monthly" ? "Monthly" : "One time",
                status: o.active ? "Active" : "Hidden",
              }))}
              columns={[
                { key: "title", label: "Offering" },
                { key: "course_title", label: "Course" },
                { key: "batch_name", label: "Batch" },
                { key: "price", label: "Price" },
                { key: "billed", label: "Billing" },
                { key: "status", label: "Status" },
              ]}
              render={(o) => (
                <Button
                  variant="ghost"
                  onClick={() => setEditor(offeringEditor(data, o))}
                >
                  Edit
                </Button>
              )}
            />
          </div>
          <div className="panel">
            <div className="row spread" style={{ marginBottom: 20 }}>
              <h2>Coupons</h2>
              <Button
                onClick={() =>
                  setEditor({
                    title: "Create a coupon",
                    endpoint: "admin/coupon",
                    values: { code: "", percent: 10, maxUses: 25 },
                    fields: [
                      text("code", "Coupon code"),
                      { key: "percent", label: "Discount %", type: "number" },
                      { key: "maxUses", label: "Maximum uses", type: "number" },
                    ],
                  })
                }
              >
                + Coupon
              </Button>
            </div>
            <DataTable
              rows={data.coupons}
              columns={[
                { key: "code", label: "Code" },
                { key: "percent_off", label: "Discount %" },
                { key: "used_count", label: "Used" },
                { key: "max_uses", label: "Limit" },
              ]}
            />
          </div>
        </>
      )}
      {editor && (
        <RecordEditor
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={() => reload()}
        />
      )}
    </>
  );
}
