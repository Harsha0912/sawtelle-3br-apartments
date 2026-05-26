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
      /href="top-picks\.html"/,
      /id="basketball-courts"/,
      /id="basketball-map"/
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
      /Open primary source/,
      /initBasketballMap/,
      /renderCourtCard/,
      /basketball-map-error/
    ]
  },
  {
    file: "top-picks.html",
    tests: [
      /data\/top-picks\.json/,
      /top-picks\.js/,
      /id="ranked-list"/,
      /href="index\.html#map-section"/,
      /id="availability-filter"/,
      /data\/availability-checks\.json/
    ]
  },
  {
    file: "top-picks.js",
    tests: [
      /TOP_PICKS_URL/,
      /renderTopPicks/,
      /rank-card/,
      /primary-source/,
      /tourChecklist/,
      /AVAILABILITY_URL/,
      /renderAvailabilityReport/,
      /availability-card/
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
    file: "data/availability-checks.json",
    tests: [
      /"listings"\s*:/,
      /"available_now"\s*:/,
      /"moveInTodayCaveat"\s*:/
    ]
  },
  {
    file: "styles.css",
    tests: [
      /\.rank-card/,
      /\.ranking-hero/,
      /\.primary-source/,
      /\.availability-card/,
      /\.court-card/,
      /#basketball-map/
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
const appData = JSON.parse(fs.readFileSync("data/app-data.json", "utf8"));
if (!appData.basketball || !Array.isArray(appData.basketball.courts) || appData.basketball.courts.length < 6) {
  throw new Error("data/app-data.json failed verification: expected basketball court shortlist.");
}
if (!appData.basketball.courts.some((court) => court.nearest_metro_id && court.office_distance_mi && court.metro_distance_mi)) {
  throw new Error("data/app-data.json failed verification: expected basketball court office and Metro distances.");
}
const availabilityChecks = JSON.parse(fs.readFileSync("data/availability-checks.json", "utf8"));
if (!Array.isArray(availabilityChecks.listings) || availabilityChecks.listings.length < 40) {
  throw new Error("data/availability-checks.json failed verification: expected strict-budget listing rows.");
}
if (!availabilityChecks.listings.some((item) => item.availabilityStatus === "available_now")) {
  throw new Error("data/availability-checks.json failed verification: expected at least one available_now row.");
}
const topPicks = JSON.parse(fs.readFileSync("data/top-picks.json", "utf8"));
if (!Array.isArray(topPicks.rankings) || topPicks.rankings.length === 0) {
  throw new Error("data/top-picks.json failed verification: rankings must be a non-empty array.");
}
if (!topPicks.rankings.some((item) => item.primaryUrl && Array.isArray(item.links) && item.links.length)) {
  throw new Error("data/top-picks.json failed verification: expected at least one ranked item with primaryUrl and links.");
}
console.log("Static app verification passed.");
