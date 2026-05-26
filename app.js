(function () {
  "use strict";

  const DATA_URL = "data/app-data.json";
  const COLORS = {
    room: "#1c8c8a",
    low: "#2f7d57",
    mid: "#3367a8",
    high: "#c46a2a",
    luxury: "#7a4e9e",
    unknown: "#76716a",
    metro: "#d22f27",
    landmark: "#f1c84b"
  };
  const LABELS = {
    room: "Very low / room",
    low: "Low",
    mid: "Mid",
    high: "High",
    luxury: "Luxury",
    unknown: "Unknown",
    metro: "Metro",
    landmark: "Japantown"
  };

  const state = { data: null, listings: [] };
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    renderLegend();
    bindControls();
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load ${DATA_URL}: ${response.status}`);
      const data = await response.json();
      validateData(data);
      state.data = data;
      state.listings = data.listings;
      renderStaticContent(data);
      renderListings();
      initMap(data);
    } catch (error) {
      showMapError();
      $("hero-summary").textContent = "Report data could not be loaded. Static map assets and PDF links remain available.";
      $("result-count").textContent = "Data unavailable";
      $("empty-state").hidden = false;
      $("empty-state").textContent = error.message || "Unable to load listing data.";
      console.error(error);
    }
  }

  function validateData(data) {
    if (!data || !Array.isArray(data.listings)) throw new Error("Invalid app-data.json: missing listings array.");
    const required = ["id", "name", "address", "rent", "lat", "lon", "marker_class"];
    data.listings.forEach((item, index) => {
      required.forEach((key) => {
        if (item[key] === undefined || item[key] === null || item[key] === "") {
          throw new Error(`Invalid listing at index ${index}: missing ${key}.`);
        }
      });
      if (!Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lon))) {
        throw new Error(`Invalid listing ${item.id}: coordinates must be numeric.`);
      }
    });
  }

  function renderStaticContent(data) {
    const generated = formatDate(data.generated);
    $("hero-summary").textContent = `Generated ${generated}. ${data.area.summary.join(" ")}`;
    $("pdf-link").href = data.assets.pdf;
    $("overview-map-img").src = data.assets.overviewMap;
    $("detail-map-img").src = data.assets.detailMap;
    $("stats-grid").innerHTML = `
      <div><dt>Total mapped</dt><dd>${escapeHtml(data.stats.total_mapped)}</dd></div>
      <div><dt>Core 90025</dt><dd>${escapeHtml(data.stats.core_count)}</dd></div>
      <div><dt>Adjacent</dt><dd>${escapeHtml(data.stats.adjacent_count)}</dd></div>
      <div><dt>Typical whole-unit</dt><dd>$4.1k-$5.5k</dd></div>
    `;
    $("review-cards").innerHTML = (data.reviews || []).map(renderReviewCard).join("");
    $("area-grid").innerHTML = [
      ["Summary", data.area.summary],
      ["Transit", data.area.transit],
      ["Amenities", data.area.amenities],
      ["Cautions", data.area.cautions]
    ].map(renderInfoCard).join("");
  }

  function bindControls() {
    ["search", "section-filter", "tier-filter", "sort", "hide-room"].forEach((id) => {
      $(id).addEventListener("input", renderListings);
      $(id).addEventListener("change", renderListings);
    });
  }

  function renderListings() {
    if (!state.data) return;
    const query = $("search").value.trim().toLowerCase();
    const section = $("section-filter").value;
    const tier = $("tier-filter").value;
    const sort = $("sort").value;
    const hideRoom = $("hide-room").checked;

    let listings = state.listings.filter((item) => {
      const text = [item.id, item.name, item.address, item.rent, item.beds_baths, item.source_notes].join(" ").toLowerCase();
      return (!query || text.includes(query)) &&
        (section === "all" || item.section === section) &&
        (tier === "all" || normalizedClass(item) === tier) &&
        (!hideRoom || !item.co_living_or_room);
    });

    listings = listings.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "id") return idSort(a.id, b.id);
      return priceSort(a, b);
    });

    $("result-count").textContent = `${listings.length} of ${state.listings.length} listings`;
    $("empty-state").hidden = listings.length !== 0;
    $("listing-cards").innerHTML = listings.map(renderListingCard).join("");
  }

  function initMap(data) {
    if (!window.L) {
      showMapError();
      return;
    }
    try {
      const map = L.map("map", { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      const bounds = [];
      data.listings.forEach((item) => {
        const marker = L.marker([item.lat, item.lon], { icon: makeIcon(item.id, normalizedClass(item)) })
          .bindPopup(renderPopup(item))
          .addTo(map);
        bounds.push(marker.getLatLng());
      });

      if (data.stats.metro) {
        const metro = data.stats.metro;
        L.marker([metro.lat, metro.lon], { icon: makeIcon("M", "metro") })
          .bindPopup(`<div class="popup"><h3>${escapeHtml(metro.name)}</h3><p>${escapeHtml(metro.address || "")}</p></div>`)
          .addTo(map);
        bounds.push([metro.lat, metro.lon]);
      }
      if (data.stats.corridor) {
        const corridor = data.stats.corridor;
        L.marker([corridor.lat, corridor.lon], { icon: makeIcon("J", "landmark") })
          .bindPopup(`<div class="popup"><h3>${escapeHtml(corridor.name)}</h3></div>`)
          .addTo(map);
        bounds.push([corridor.lat, corridor.lon]);
      }
      map.fitBounds(bounds, { padding: [24, 24] });
    } catch (error) {
      showMapError();
      console.error(error);
    }
  }

  function makeIcon(label, markerClass) {
    const safeClass = markerClass === "landmark" ? " landmark" : "";
    return L.divIcon({
      className: "",
      html: `<div class="custom-marker${safeClass}" style="background:${COLORS[markerClass] || COLORS.unknown}"><span>${escapeHtml(label)}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -28]
    });
  }

  function renderLegend() {
    $("legend").innerHTML = ["room", "low", "mid", "high", "luxury", "unknown", "metro", "landmark"].map((key) => (
      `<span class="legend-item"><span class="swatch" style="background:${COLORS[key]}"></span>${LABELS[key]}</span>`
    )).join("");
  }

  function renderListingCard(item) {
    const markerClass = normalizedClass(item);
    const links = (item.links || []).map((url, index) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">Source ${index + 1}</a>`).join("");
    return `
      <article class="card listing-card">
        <div class="card-top">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="meta">${escapeHtml(item.address_raw || item.address)}</div>
          </div>
          <span class="pin" style="background:${COLORS[markerClass] || COLORS.unknown}">${escapeHtml(item.id)}</span>
        </div>
        <div class="price">${escapeHtml(item.rent)}</div>
        <div class="meta">${escapeHtml(item.beds_baths || "Beds/baths not specified")}</div>
        <p>${escapeHtml(item.source_notes || "No source notes provided.")}</p>
        <div class="badges">
          <span class="badge">${escapeHtml(item.section || "unknown")}</span>
          <span class="badge">${escapeHtml(LABELS[markerClass] || markerClass)}</span>
          ${item.co_living_or_room ? '<span class="badge">Co-living / per-room risk</span>' : ""}
        </div>
        <div class="links">${links || "<span class=\"meta\">No source link listed</span>"}</div>
      </article>
    `;
  }

  function renderPopup(item) {
    const links = (item.links || []).map((url, index) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">Source ${index + 1}</a>`).join(" ");
    return `
      <div class="popup">
        <h3>${escapeHtml(item.id)}. ${escapeHtml(item.name)}</h3>
        <p><strong>Address:</strong> ${escapeHtml(item.address_raw || item.address)}</p>
        <p><strong>Rent:</strong> ${escapeHtml(item.rent)}</p>
        <p><strong>Beds:</strong> ${escapeHtml(item.beds_baths || "Not specified")}</p>
        <p><strong>Notes:</strong> ${escapeHtml(item.source_notes || "No source notes provided.")}</p>
        <p>${links}</p>
      </div>
    `;
  }

  function renderReviewCard(review) {
    return `
      <article class="card review-card">
        <h3>${escapeHtml(review.title)}</h3>
        <p class="price">${escapeHtml(review.rating)}</p>
        <p>${escapeHtml(review.summary)}</p>
        <div class="links"><a href="${escapeAttr(review.url)}" target="_blank" rel="noopener">Open review source</a></div>
      </article>
    `;
  }

  function renderInfoCard([title, items]) {
    return `
      <article class="info-card">
        <h3>${escapeHtml(title)}</h3>
        <ul>${(items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    `;
  }

  function normalizedClass(item) {
    return item.marker_class || "unknown";
  }

  function priceSort(a, b) {
    const ap = Number.isFinite(a.min_price) ? a.min_price : Number.POSITIVE_INFINITY;
    const bp = Number.isFinite(b.min_price) ? b.min_price : Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return idSort(a.id, b.id);
  }

  function idSort(a, b) {
    const an = parseInt(String(a).replace(/\D/g, ""), 10);
    const bn = parseInt(String(b).replace(/\D/g, ""), 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a).localeCompare(String(b));
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function showMapError() {
    $("map-error").hidden = false;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
