# Sawtelle 3BR Apartment Report

Static GitHub Pages app for the mapped Sawtelle / West Los Angeles 3-bedroom apartment report generated on 2026-05-25.

## Files

- `index.html` - single-page app shell.
- `styles.css` - responsive styling.
- `app.js` - client-side JSON loading, filtering, cards, and Leaflet map rendering.
- `data/app-data.json` - source of truth for listings, stats, reviews, area notes, and asset paths.
- `assets/` - mapped PDF and static fallback map images.
- `.nojekyll` - keeps GitHub Pages from running Jekyll processing.

## Local Use

Because the app fetches `data/app-data.json`, run it from any static file server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

No build step and no npm dependencies are required. Leaflet and OpenStreetMap tiles load from CDN at runtime; the static map images remain visible if the interactive map cannot load.

## GitHub Pages

The app uses only relative paths, so it works from a repository subpath such as:

```text
https://<user>.github.io/sawtelle-3br-apartments/
```
