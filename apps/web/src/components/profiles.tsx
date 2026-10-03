"use client";
import { useState, useEffect, type CSSProperties } from "react";
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
  Shuffle,
  Undo2,
  Check,
  ExternalLink,
} from "lucide-react";
import { profileThemes, contrastText } from "@edu/shared";
import { useData, Loading, api, perform } from "./data";
import { PageHeading } from "./learning";
import { MarkdownView } from "./markdown";
import { Button, Badge, Progress } from "./ui";
import { FileUpload } from "./file-upload";
const colors = [
  "#207c4c",
  "#7333bb",
  "#75614b",
  "#a54179",
  "#2868ac",
  "#aa4d25",
  "#414452",
  "#be4b37",
  "#28743a",
  "#527354",
  "#5552b7",
  "#27754e",
];
function Sortable({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="sortable-item"
    >
      <button aria-label={`Move ${id}`} {...attributes} {...listeners}>
        <GripVertical size={17} />
      </button>
      {children}
    </div>
  );
}
export function ProfileView({ data: p }: { data: any }) {
  const section = (s: string) => {
    switch (s) {
      case "about":
        return (
          <MarkdownView
            content={p.bio_md || "A new learning story is taking shape."}
          />
        );
      case "courses":
        return (p.courses || []).map((c: any) => (
          <div key={c.title} style={{ marginBottom: 15 }}>
            <p style={{ color: c.accent_color }}>{c.title}</p>
            <Progress value={Number(c.completion || 0)} />
          </div>
        ));
      case "learning":
        return (
          <div className="row" style={{ flexWrap: "wrap" }}>
            {(p.currently_learning || []).map((t: string) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        );
      case "links":
        return (p.links || []).map((l: any) => (
          <a
            className="text-link"
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", marginBottom: 9 }}
          >
            {l.label}
            <ExternalLink size={14} />
          </a>
        ));
      case "activity": {
        const days = new Map(
          (p.activity || []).map((d: any) => [
            new Date(d.day).toISOString().slice(0, 10),
            d.count,
          ]),
        );
        return (
          <div className="heatmap">
            {Array.from({ length: 91 }, (_, i) => {
              const day = new Date(Date.now() - (90 - i) * 864e5)
                .toISOString()
                .slice(0, 10);
              return (
                <span
                  key={day}
                  title={`${day}: ${days.get(day) || 0} activities`}
                  className={days.has(day) ? "active" : ""}
                />
              );
            })}
          </div>
        );
      }
      case "pinned":
        return (
          <p>
            {p.pinned_items?.length
              ? `${p.pinned_items.length} pieces of work shared by this learner.`
              : "Good work worth keeping will appear here."}
          </p>
        );
      case "league":
        return (
          <p>
            Learning is better together. Every practice session contributes to
            the team.
          </p>
        );
      default:
        return null;
    }
  };
  const theme = p.theme || {};
  return (
    <div
      className="profile-preview"
      style={
        {
          "--profile-accent": theme.accent,
          "--profile-text": contrastText(theme.accent || "#4f46e5"),
          "--profile-radius": `${theme.radius}px`,
          "--profile-columns": p.layout?.columns || 2,
          fontFamily: ["mono", "technical"].includes(theme.font)
            ? "monospace"
            : ["serif", "editorial"].includes(theme.font)
              ? "Georgia,serif"
              : undefined,
        } as CSSProperties
      }
    >
      <div
        className="profile-banner"
        style={{
          background:
            theme.background === "solid"
              ? theme.accent
              : theme.background === "pattern"
                ? `repeating-linear-gradient(45deg,${theme.accent},${theme.accent} 14px,#20283b 15px,#20283b 16px)`
                : undefined,
        }}
      />
      <div className="profile-main">
        <span className="avatar profile-avatar">
          {p.display_name?.slice(0, 1) || "V"}
        </span>
        <h1>{p.display_name || "Your name"}</h1>
        <p className="muted">
          {p.headline || "Your next chapter starts here."}
        </p>
        <p className="small muted">
          @{p.handle || "your-handle"}
          {p.location ? " · " + p.location : ""}
        </p>
        <div className="profile-sections">
          {(p.layout?.sections || []).map((s: string) => (
            <section
              className="profile-section"
              key={s}
              style={{
                boxShadow:
                  theme.card === "brutalist"
                    ? `4px 4px 0 ${theme.accent}`
                    : undefined,
                background: theme.card === "glass" ? "#ffffff0c" : undefined,
                border: theme.card === "flat" ? "none" : undefined,
              }}
            >
              <h2>
                {
                  (
                    {
                      about: "A little about me",
                      courses: "My learning path",
                      learning: "Currently learning",
                      links: "Around the web",
                      activity: "Showing up, in my own way",
                      pinned: "Work I’m proud of",
                      league: "Learning together",
                    } as Record<string, string>
                  )[s]
                }
              </h2>
              {section(s)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
export function Profile({ handle }: { handle: string }) {
  const { data, error } = useData("profiles/" + handle);
  if (!data) return <Loading error={error} />;
  return (
    <div className="page-container">
      <ProfileView data={data} />
    </div>
  );
}
export function ProfileEditor() {
  const { data, error } = useData("profile");
  const [p, setP] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [tab, setTab] = useState("About");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    if (data) setP(data);
  }, [data]);
  function update(next: any) {
    setHistory((h) => [...h.slice(-19), p]);
    setP(next);
  }
  if (!p) return <Loading error={error} />;
  function theme(name: string) {
    const i = profileThemes.indexOf(name as any);
    update({
      ...p,
      theme: {
        ...p.theme,
        name,
        accent: colors[i],
        font: ["Terminal", "Matrix", "Retro", "Blueprint"].includes(name)
          ? "mono"
          : "sans",
        background: ["Neon", "Sunset", "Space"].includes(name)
          ? "gradient"
          : ["Blueprint", "Paper"].includes(name)
            ? "pattern"
            : "solid",
        card: name === "Retro" ? "brutalist" : "outlined",
      },
    });
  }
  async function save() {
    const keys = [
      "handle",
      "display_name",
      "headline",
      "bio_md",
      "location",
      "links",
      "visibility",
      "theme",
      "layout",
      "currently_learning",
      "pinned_items",
    ];
    await perform(
      () => api("profile", Object.fromEntries(keys.map((k) => [k, p[k]]))),
      "Your profile is updated",
    );
  }
  return (
    <>
      <PageHeading title="Profile">
        <div className="row">
          <Button
            variant="secondary"
            disabled={!history.length}
            onClick={() => {
              setP(history.at(-1));
              setHistory(history.slice(0, -1));
            }}
          >
            <Undo2 size={16} />
            Undo
          </Button>
          <Button onClick={save}>
            <Check size={16} />
            Save profile
          </Button>
        </div>
      </PageHeading>
      <div className="profile-editor">
        <div className="panel">
          <div className="tabs">
            {["About", "Style", "Layout"].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "About" ? (
            <>
              {[
                ["display_name", "Display name"],
                ["handle", "Handle"],
                ["headline", "Headline"],
                ["location", "Location"],
              ].map(([key, label]) => (
                <div className="form-group" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    value={p[key]}
                    onChange={(e) => update({ ...p, [key]: e.target.value })}
                  />
                </div>
              ))}
              <div className="form-group">
                <label htmlFor="bio">Your story</label>
                <textarea
                  id="bio"
                  value={p.bio_md}
                  onChange={(e) => update({ ...p, bio_md: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Currently learning · comma separated</label>
                <input
                  value={p.currently_learning.join(", ")}
                  onChange={(e) =>
                    update({
                      ...p,
                      currently_learning: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="form-group">
                <label>Who can see your profile?</label>
                <select
                  value={p.visibility}
                  onChange={(e) => update({ ...p, visibility: e.target.value })}
                >
                  <option value="students_only">Other students</option>
                  <option value="public">Everyone</option>
                  <option value="private">Only me</option>
                </select>
              </div>
              <div className="form-group" style={{ marginTop: 20 }}>
                <label>Portfolio link</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={p.links[0]?.url || ""}
                  onChange={(e) =>
                    update({
                      ...p,
                      links: e.target.value
                        ? [{ label: "Portfolio", url: e.target.value }]
                        : [],
                    })
                  }
                />
              </div>
            </>
          ) : tab === "Style" ? (
            <>
              <label>Choose a theme</label>
              <div className="theme-grid">
                {profileThemes.map((name, i) => (
                  <button
                    key={name}
                    className={`theme-swatch ${p.theme.name === name ? "selected" : ""}`}
                    onClick={() => theme(name)}
                  >
                    <span style={{ background: colors[i] }} />
                    {name}
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                className="full"
                style={{ margin: "15px 0 20px" }}
                onClick={() =>
                  theme(
                    profileThemes[
                      Math.floor(Math.random() * profileThemes.length)
                    ],
                  )
                }
              >
                <Shuffle size={15} />
                Surprise me
              </Button>
              <div className="form-group">
                <label>Accent color</label>
                <input
                  type="color"
                  value={p.theme.accent}
                  onChange={(e) =>
                    update({
                      ...p,
                      theme: { ...p.theme, accent: e.target.value },
                    })
                  }
                />
              </div>
              {[
                ["background", ["solid", "gradient", "pattern"]],
                [
                  "font",
                  [
                    "sans",
                    "serif",
                    "mono",
                    "rounded",
                    "editorial",
                    "technical",
                  ],
                ],
                ["card", ["flat", "glass", "outlined", "brutalist"]],
              ].map(([key, options]) => (
                <div className="form-group" key={key as string}>
                  <label>{String(key)}</label>
                  <select
                    value={p.theme[key as string]}
                    onChange={(e) =>
                      update({
                        ...p,
                        theme: { ...p.theme, [key as string]: e.target.value },
                      })
                    }
                  >
                    {(options as string[]).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
              ))}
              <label>Corner radius</label>
              <input
                type="range"
                min="0"
                max="32"
                value={p.theme.radius}
                onChange={(e) =>
                  update({
                    ...p,
                    theme: { ...p.theme, radius: Number(e.target.value) },
                  })
                }
              />
              <Button variant="ghost" onClick={() => theme("Mono")}>
                Reset theme
              </Button>
              <FileUpload purpose="banner" />
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="profile-columns">Columns</label>
                <select
                  id="profile-columns"
                  value={p.layout.columns}
                  onChange={(e) =>
                    update({
                      ...p,
                      layout: { ...p.layout, columns: Number(e.target.value) },
                    })
                  }
                >
                  <option value="1">One column</option>
                  <option value="2">Two columns</option>
                </select>
              </div>
              <p className="small" style={{ marginBottom: 15 }}>
                Drag to reorder. Use Space and arrow keys with the handles.
              </p>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active, over }) => {
                  if (over && active.id !== over.id)
                    update({
                      ...p,
                      layout: {
                        ...p.layout,
                        sections: arrayMove(
                          p.layout.sections,
                          p.layout.sections.indexOf(active.id),
                          p.layout.sections.indexOf(over.id),
                        ),
                      },
                    });
                }}
              >
                <SortableContext
                  items={p.layout.sections}
                  strategy={verticalListSortingStrategy}
                >
                  {p.layout.sections.map((s: string) => (
                    <Sortable key={s} id={s}>
                      <span>{s}</span>
                      <button
                        aria-label={`Hide ${s}`}
                        onClick={() =>
                          update({
                            ...p,
                            layout: {
                              ...p.layout,
                              sections: p.layout.sections.filter(
                                (v: string) => v !== s,
                              ),
                            },
                          })
                        }
                      >
                        ×
                      </button>
                    </Sortable>
                  ))}
                </SortableContext>
              </DndContext>
              {[
                "about",
                "courses",
                "league",
                "activity",
                "links",
                "pinned",
                "learning",
              ]
                .filter((s) => !p.layout.sections.includes(s))
                .map((s) => (
                  <Button
                    key={s}
                    variant="ghost"
                    onClick={() =>
                      update({
                        ...p,
                        layout: {
                          ...p.layout,
                          sections: [...p.layout.sections, s],
                        },
                      })
                    }
                  >
                    + {s}
                  </Button>
                ))}
            </>
          )}
        </div>
        <div>
          <div className="row spread small muted" style={{ marginBottom: 12 }}>
            <span>LIVE PREVIEW</span>
            <span>{p.visibility.replace("_", " ")}</span>
          </div>
          <ProfileView data={p} />
        </div>
      </div>
    </>
  );
}
