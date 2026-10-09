// Renders the snapshot from data/repos.json immediately, then refreshes from the live GitHub API.
const LANG_COLORS = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", "C#": "#178600",
  HTML: "#e34c26", CSS: "#563d7c", Java: "#b07219", Go: "#00ADD8", Rust: "#dea584",
  C: "#555555", "C++": "#f34b7d", Shell: "#89e051", PLpgSQL: "#336790", Ruby: "#701516",
  Kotlin: "#A97BFF", Swift: "#F05138", Dart: "#00B4AB", PHP: "#4F5D95", Jupyter: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B", Vue: "#41b883", Svelte: "#ff3e00", Lua: "#000080",
};

const $ = (id) => document.getElementById(id);
const state = { config: null, repos: [], newNames: new Set(), source: "", updatedAt: null };

const fromApi = (r, user) => ({
  name: r.name,
  description: r.description,
  url: r.html_url,
  homepage: r.homepage || (r.has_pages ? `https://${user}.github.io/${r.name}/` : null),
  language: r.language,
  topics: r.topics ?? [],
  stars: r.stargazers_count,
  forks: r.forks_count,
  fork: r.fork,
  archived: r.archived,
  createdAt: r.created_at,
  pushedAt: r.pushed_at,
});

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function loadSnapshot() {
  try {
    const data = await getJson("data/repos.json");
    state.repos = data.repos;
    state.updatedAt = new Date(data.generatedAt);
    state.source = "snapshot";
    render();
  } catch {
    // No snapshot (e.g. local dev without the build step) — live fetch will fill in.
  }
}

async function loadLive() {
  const { user } = state.config;
  try {
    const repos = [];
    for (let page = 1; ; page++) {
      const batch = await getJson(`https://api.github.com/users/${user}/repos?per_page=100&type=owner&sort=pushed&page=${page}`);
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    // Releases only come from the snapshot (one API call per repo is too costly for visitors).
    const known = new Map(state.repos.map((r) => [r.name, r]));
    const live = repos.map((r) => ({ ...fromApi(r, user), release: known.get(r.name)?.release ?? null }));
    if (known.size) state.newNames = new Set(live.filter((r) => !known.has(r.name)).map((r) => r.name));
    state.repos = live;
    state.updatedAt = new Date();
    state.source = "live";
  } catch (err) {
    console.warn("Live refresh failed, showing snapshot:", err);
    if (!state.repos.length) state.source = "error";
  }
  render();
}

function visibleRepos() {
  const { hidden = [], pinned = [] } = state.config;
  const q = $("q").value.trim().toLowerCase();
  const lang = $("lang").value;
  const topic = $("topic").value;
  const sort = $("sort").value;
  const showForks = $("showForks").checked;
  const showArchived = $("showArchived").checked;

  const sorters = {
    pushed: (a, b) => b.pushedAt.localeCompare(a.pushedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    stars: (a, b) => b.stars - a.stars || b.pushedAt.localeCompare(a.pushedAt),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const pinRank = (r) => (pinned.includes(r.name) ? pinned.indexOf(r.name) : Infinity);

  return state.repos
    .filter((r) => !hidden.includes(r.name))
    .filter((r) => showForks || !r.fork)
    .filter((r) => showArchived || !r.archived)
    .filter((r) => !lang || r.language === lang)
    .filter((r) => !topic || r.topics.includes(topic))
    .filter((r) => !q || [r.name, r.description ?? "", ...r.topics].join(" ").toLowerCase().includes(q))
    .sort((a, b) => pinRank(a) - pinRank(b) || sorters[sort](a, b));
}

function fillSelect(select, values) {
  const current = select.value;
  const first = select.options[0];
  select.replaceChildren(first, ...values.map((v) => new Option(v, v)));
  select.value = values.includes(current) ? current : "";
}

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function card(r) {
  const pinned = state.config.pinned?.includes(r.name);
  const head = el("div", { className: "card-head" },
    el("h2", {}, el("a", { href: r.url, textContent: r.name })),
    pinned && el("span", { className: "badge pin", textContent: "Pinned" }),
    r.fork && el("span", { className: "badge", textContent: "Fork" }),
    r.archived && el("span", { className: "badge", textContent: "Archived" }),
    state.newNames.has(r.name) && el("span", { className: "badge new", textContent: "New" }),
  );
  const desc = el("p", {
    className: r.description ? "desc" : "desc empty",
    textContent: r.description || "No description",
  });
  const topics = r.topics.length > 0 && el("ul", { className: "topics" },
    ...r.topics.slice(0, 6).map((t) => el("li", {}, el("button", {
      type: "button", textContent: t, title: `Filter by ${t}`,
      onclick: () => { $("topic").value = t; render(); },
    }))),
  );
  const lang = r.language && el("span", {},
    el("span", { className: "lang-dot", style: `background:${LANG_COLORS[r.language] ?? "var(--muted)"}` }),
    r.language,
  );
  const meta = el("div", { className: "meta" },
    lang,
    r.stars > 0 && el("span", { title: "Stars", textContent: `★ ${r.stars}` }),
    r.forks > 0 && el("span", { title: "Forks", textContent: `⑂ ${r.forks}` }),
    el("span", { title: new Date(r.pushedAt).toLocaleString(), textContent: `upd ${relativeTime(r.pushedAt)}` }),
  );
  const links = el("div", { className: "links" },
    r.homepage && el("a", { className: "live", href: r.homepage, textContent: "Live ↗" }),
    r.release && el("a", { className: "release", href: r.release.url, title: r.release.name || r.release.tag },
      "Release\u00a0", el("span", { className: "tag", textContent: r.release.tag }), "\u00a0↓",
    ),
    el("a", { href: r.url, textContent: "Code" }),
  );
  return el("li", { className: state.newNames.has(r.name) ? "card new" : "card" }, head, desc, topics, meta, links);
}

function renderStats() {
  const own = state.repos.filter((r) => !state.config.hidden?.includes(r.name) && !r.fork);
  const stats = [
    ["Repositories", own.length],
    ["Stars", own.reduce((n, r) => n + r.stars, 0)],
    ["Languages", new Set(own.map((r) => r.language).filter(Boolean)).size],
    ["Live demos", own.filter((r) => r.homepage).length],
    ["Releases", own.filter((r) => r.release).length],
  ];
  $("stats").replaceChildren(...stats.filter(([, v]) => v > 0).map(([k, v]) => el("div", {}, el("dt", { textContent: k }), el("dd", { textContent: v }))));
}

function render() {
  const all = state.repos.filter((r) => !state.config.hidden?.includes(r.name));
  fillSelect($("lang"), [...new Set(all.map((r) => r.language).filter(Boolean))].sort());
  fillSelect($("topic"), [...new Set(all.flatMap((r) => r.topics))].sort());

  const repos = visibleRepos();
  $("grid").replaceChildren(...repos.map(card));
  renderStats();

  $("status").textContent =
    state.source === "error" ? "Couldn't reach GitHub right now. Please try again in a minute." :
    !state.repos.length ? "Jacking in…" :
    `Showing ${repos.length} of ${all.length} repositories`;
  if (state.updatedAt) {
    $("freshness").textContent = `${state.source === "live" ? "Live from GitHub" : "Snapshot"} · updated ${state.updatedAt.toLocaleString()}`;
  }
}

async function init() {
  state.config = await getJson("config.json");
  const { user, title, tagline } = state.config;
  if (title) Object.assign($("title"), { textContent: title }).dataset.text = title;
  if (tagline) $("tagline").textContent = tagline;
  $("profile").href = `https://github.com/${user}`;
  if (state.config.home) for (const a of document.querySelectorAll("#home, footer a[href='https://vishnugandarapu.in']")) a.href = state.config.home;
  const tick = () => ($("clock").textContent = new Date().toLocaleTimeString([], { hour12: false }));
  tick();
  setInterval(tick, 1000);
  $("controls").addEventListener("input", render);

  await loadSnapshot();
  await loadLive();
}

init();
