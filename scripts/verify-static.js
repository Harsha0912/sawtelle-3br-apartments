const fs = require("fs");

const checks = [
  {
    file: "index.html",
    tests: [
      /href="leaflet-fallback\.css"/,
      /https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/,
      /id="bath-filter"/,
      /id="min-price"/,
      /id="max-price"/,
      /href="top-picks\.html"/
    ]
  },
  {
    file: "app.js",
    tests: [
      /parseBedsBaths/,
      /parsePriceInput/,
      /min-price/,
      /max-price/,
      /primary-source/,
      /Open primary source/
    ]
  },
  {
    file: "top-picks.html",
    tests: [
      /data\/top-picks\.json/,
      /top-picks\.js/,
      /id="ranked-list"/,
      /href="index\.html#map-section"/
    ]
  },
  {
    file: "top-picks.js",
    tests: [
      /TOP_PICKS_URL/,
      /renderTopPicks/,
      /rank-card/,
      /primary-source/,
      /tourChecklist/
    ]
  },
  {
    file: "data/top-picks.json",
    tests: [
      /"rankings"\s*:/,
      /"tourChecklist"\s*:/,
      /"reviewSources"\s*:/
    ]
  },
  {
    file: "styles.css",
    tests: [
      /\.rank-card/,
      /\.ranking-hero/,
      /\.primary-source/
    ]
  },
  {
    file: "leaflet-fallback.css",
    tests: [
      /\.leaflet-container\s*\{[^}]*overflow:\s*hidden/s,
      /\.leaflet-pane,[^{]*\.leaflet-tile,[^{]*\.leaflet-marker-icon/s,
      /position:\s*absolute/,
      /\.leaflet-popup\s*\{[^}]*position:\s*absolute/s
    ]
  },
  {
    file: "data/app-data.json",
    tests: [/"listings"\s*:/]
  }
];

for (const check of checks) {
  const text = fs.readFileSync(check.file, "utf8");
  check.tests.forEach((test) => {
    if (!test.test(text)) {
      throw new Error(`${check.file} failed verification: ${test}`);
    }
  });
}

JSON.parse(fs.readFileSync("data/app-data.json", "utf8"));
const topPicks = JSON.parse(fs.readFileSync("data/top-picks.json", "utf8"));
if (!Array.isArray(topPicks.rankings) || topPicks.rankings.length === 0) {
  throw new Error("data/top-picks.json failed verification: rankings must be a non-empty array.");
}
if (!topPicks.rankings.some((item) => item.primaryUrl && Array.isArray(item.links) && item.links.length)) {
  throw new Error("data/top-picks.json failed verification: expected at least one ranked item with primaryUrl and links.");
}
console.log("Static app verification passed.");
