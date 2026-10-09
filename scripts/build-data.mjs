// Fetches public repos for the configured user and writes a snapshot the site loads first.
// Usage: GITHUB_TOKEN=... node scripts/build-data.mjs [outDir]   (outDir defaults to ".")
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = process.argv[2] ?? ".";
const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${config.user}-projects-gallery`,
  ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
};

async function fetchAllRepos(user) {
  const repos = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/users/${user}/repos?per_page=100&type=owner&sort=pushed&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) return repos;
  }
}

const pick = (r) => ({
  name: r.name,
  description: r.description,
  url: r.html_url,
  homepage: r.homepage || (r.has_pages ? `https://${config.user}.github.io/${r.name}/` : null),
  language: r.language,
  topics: r.topics ?? [],
  stars: r.stargazers_count,
  forks: r.forks_count,
  fork: r.fork,
  archived: r.archived,
  createdAt: r.created_at,
  pushedAt: r.pushed_at,
});

// Latest published release (drafts and prereleases are excluded by this endpoint); null when none.
async function fetchLatestRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${config.user}/${repo}/releases/latest`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo} releases`);
  const r = await res.json();
  return { tag: r.tag_name, name: r.name, url: r.html_url, publishedAt: r.published_at, assets: r.assets.length };
}

const repos = (await fetchAllRepos(config.user)).filter((r) => !r.private).map(pick);
for (let i = 0; i < repos.length; i += 10) {
  const chunk = repos.slice(i, i + 10);
  const releases = await Promise.all(chunk.map((r) => fetchLatestRelease(r.name)));
  chunk.forEach((r, j) => (r.release = releases[j]));
}
const data = { user: config.user, generatedAt: new Date().toISOString(), repos };

await mkdir(join(outDir, "data"), { recursive: true });
await writeFile(join(outDir, "data", "repos.json"), JSON.stringify(data, null, 2));
console.log(`Wrote ${repos.length} repos to ${join(outDir, "data", "repos.json")}`);
