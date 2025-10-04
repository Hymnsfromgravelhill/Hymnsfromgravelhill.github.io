# Hymns from Gravel Hill

[![Last Commit](https://img.shields.io/github/last-commit/Hymnsfromgravelhill/Hymnsfromgravelhill.github.io?logo=github)](https://github.com/Hymnsfromgravelhill/Hymnsfromgravelhill.github.io/commits/main)
![Static Site](https://img.shields.io/badge/Site-type%3A%20static-blue)
![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-222)
[![Pages Build](https://github.com/Hymnsfromgravelhill/Hymnsfromgravelhill.github.io/actions/workflows/pages/pages-build-deployment/badge.svg?branch=main)](https://github.com/Hymnsfromgravelhill/Hymnsfromgravelhill.github.io/actions/workflows/pages/pages-build-deployment)
![Code License](https://img.shields.io/badge/Code%20License-MIT-green)
![Content License](https://img.shields.io/badge/Content%20License-CC%20BY--NC--ND%204.0*-blue)

A lightweight static site for hymns. Content is served from `data/` and `assets/` and configured via `config.json`.

## 📁 Structure
- Root: `index.html`, `config.json`, `CNAME`
- Data & assets: `data/`, `assets/`

## 🧪 Run Locally

No build step required. Serve the folder locally with any static server:

```bash
# Option A: Python
python -m http.server 4000

# Option B: Node
npx http-server -p 4000 -c-1
# or
npx serve -l 4000

# Then open http://127.0.0.1:4000
```

## Licensing
- **Code**: MIT — see `LICENSE`.
- **Content**: CC BY-NC-ND 4.0 — see `LICENSE-content`.
  - **Hymn texts/tunes** may be **Public Domain** or © their publishers. Each hymn page should include a per‑item notice.
