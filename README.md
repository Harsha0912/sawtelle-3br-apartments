# Sawtelle 3BR Apartment Report

Static GitHub Pages app for the mapped Sawtelle / West Los Angeles 3-bedroom apartment report generated on 2026-05-25. The main page now also includes a mapped indoor-basketball shortlist from the 255 Arizona Ave office, with each court's office distance and nearest Metro E Line distance. The top-picks page includes a UCLA basketball + Sawtelle food route lens for each ranked apartment.

## Files

- `index.html` - main interactive map/listing app shell.
- `top-picks.html` - ranked recommendations page for the $4,000-$6,500 target budget.
- `styles.css` - responsive styling for the map, listing filters, and ranked page.
- `leaflet-fallback.css` - local critical Leaflet layout CSS so panes, tiles, markers, controls, and popups still render correctly if the CDN stylesheet fails.
- `app.js` - client-side JSON loading, map rendering, listing cards, basketball court cards, bed/bath filters, price filters, and source links.
- `top-picks.js` - client-side renderer for the ranked top-picks page, availability table, and UCLA/Sawtelle route-fit cards.
- `data/app-data.json` - source of truth for listings, stats, reviews, area notes, basketball court/Metro/office distances, and asset paths.
- `data/top-picks.json` - ranked shortlist, review summaries, UCLA/Sawtelle/office route context, evidence snippets, source links, and tour checklist.
- `data/ranking-source-snippets.json` - raw text-rendered scrape evidence archive used to build the top-picks summaries.
- `assets/` - mapped PDF and static fallback map images.
- `.nojekyll` - keeps GitHub Pages from running Jekyll processing.

## Local Use

Because the app fetches `data/app-data.json`, run it from any static file server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

No build step and no npm dependencies are required. Leaflet JavaScript and OpenStreetMap tiles load from CDN at runtime; critical Leaflet CSS is also committed locally as `leaflet-fallback.css`, so the interactive map layout survives a failed CDN stylesheet. The static map images remain visible if the interactive map cannot load.

Optional static verification:

```sh
node --check app.js
node --check scripts/verify-static.js
node scripts/verify-static.js
```

## GitHub Pages

The app uses only relative paths, so it works from a repository subpath such as:

```text
https://<user>.github.io/sawtelle-3br-apartments/
```
