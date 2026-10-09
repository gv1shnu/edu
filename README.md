# projects

A live gallery of every public repository on [github.com/gv1shnu](https://github.com/gv1shnu), hosted on GitHub Pages.

## How it stays current

- **Snapshot:** `.github/workflows/deploy.yml` runs on every push, every 6 hours and on demand. It calls `scripts/build-data.mjs` to write `data/repos.json`, then deploys the site.
- **Live refresh:** in the browser, `assets/app.js` shows the snapshot straight away, then fetches the GitHub API and merges in anything newer. If the API's rate limit is hit, the snapshot stays on screen.

## Curation

Edit `config.json`:

| Key | Purpose |
|---|---|
| `hidden` | Repo names to leave out of the gallery |
| `pinned` | Repo names shown first, in this order |
| `title`, `tagline` | Header text |

## Local preview

```bash
node scripts/build-data.mjs && python3 -m http.server 8765
```

## One-time setup

Settings → Pages → Source: **GitHub Actions**.
