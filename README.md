# projects

A live gallery of every public repository on [github.com/gv1shnu](https://github.com/gv1shnu), hosted on GitHub Pages.

## How it stays current

- **Snapshot:** `.github/workflows/deploy.yml` runs on every push, every 6 hours and on demand. It calls `scripts/build-data.mjs` to write `data/repos.json`, then deploys the site.
- **Releases:** the snapshot also stores each repo's latest release, so repos that ship downloads instead of a live URL get a release link.
- **Live refresh:** in the browser, `assets/app.js` shows the snapshot straight away, then fetches the GitHub API and merges in anything newer. If the API's rate limit is hit, the snapshot stays on screen.

## Curation

Edit `config.json`:

| Key | Purpose |
|---|---|
| `hidden` | Repo names to leave out of the gallery |
| `pinned` | Repo names shown first, in this order |
| `title`, `tagline` | Header text |
| `home` | Where the "back" link points (the personal site) |

## Look and feel

The cyberpunk night-city background in `assets/city.js` scrolls the three parallax layers from [Warped City](https://opengameart.org/content/warped-city) by Luis Zuno (@ansimuz), which is CC0 (see `assets/warped-city/LICENSE.txt`), and adds flying cars and rain. The canvas renders at the art's native resolution and is upscaled with pixelated edges. It pauses when the tab is hidden and shows a single still frame when the visitor has reduced motion turned on.

## Local preview

```bash
node scripts/build-data.mjs && python3 -m http.server 8765
```

## One-time setup

Settings → Pages → Source: **GitHub Actions**.
