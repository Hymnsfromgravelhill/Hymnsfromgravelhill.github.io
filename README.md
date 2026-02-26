# Hymns from Gravel Hill — Hymn Browser

This repository is a **static website** (no backend) designed for **GitHub Pages** hosting.

## Features
- Switch between hymn books (datasets)
- Search by **number, title, lyrics, author**
- Sort by number or alphabetical
- Favorites (stored locally in your browser)
- Clean list view + hymn detail view
- Copy + Print

## Local testing
This site supports two ways to test locally:

1) **Recommended** (most accurate):
```bash
python -m http.server 8000
```
Open `http://localhost:8000/`

2) **Quick test**: double-click `index.html`
- Hymn book loading still works thanks to an embedded fallback (`hymnals/embedded-hymnals.js`).

## GitHub Pages
Push the repo, then enable GitHub Pages for the repository (Deploy from branch / root).

## Notes
- All UI + assets are local (no external CDN/font dependencies).
- Hymn book TXT files are in `/hymnals`.
- Tune/ABC files extracted from the APK are included in `/Music`.
