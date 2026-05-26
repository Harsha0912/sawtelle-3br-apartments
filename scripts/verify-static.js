const fs = require("fs");

const checks = [
  {
    file: "index.html",
    tests: [
      /href="leaflet-fallback\.css"/,
      /https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/
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
console.log("Static map verification passed.");
