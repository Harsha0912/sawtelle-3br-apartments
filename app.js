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
    landmark: "#f1c84b",
    office: "#111827",
    court_public: "#d97706",
    court_member: "#8b5cf6",
    court_college: "#0f766e",
    court_verify: "#64748b"
  };
  const LABELS = {
    room: "Very low / room",
    low: "Low",
    mid: "Mid",
    high: "High",
    luxury: "Luxury",
    unknown: "Unknown",
    metro: "Metro",
    landmark: "Japantown",
    office: "Office",
    court_public: "Public court",
    court_member: "Member gym",
    court_college: "College court",
    court_verify: "Verify indoor"
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
      initBasketballMap(data.basketball);
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

    if (data.basketball && Array.isArray(data.basketball.courts)) {
      data.basketball.courts.forEach((court, index) => {
        ["id", "name", "address", "lat", "lon", "nearest_metro_id", "office_distance_mi", "metro_distance_mi"].forEach((key) => {
          if (court[key] === undefined || court[key] === null || court[key] === "") {
            throw new Error(`Invalid basketball court at index ${index}: missing ${key}.`);
          }
        });
        if (!Number.isFinite(Number(court.lat)) || !Number.isFinite(Number(court.lon))) {
          throw new Error(`Invalid basketball court ${court.id}: coordinates must be numeric.`);
        }
      });
    }
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
    renderBasketballSection(data.basketball);
  }

  function bindControls() {
    ["search", "section-filter", "tier-filter", "bath-filter", "min-price", "max-price", "sort", "hide-room"].forEach((id) => {
      $(id).addEventListener("input", renderListings);
      $(id).addEventListener("change", renderListings);
    });
  }

  function renderListings() {
    if (!state.data) return;
    const query = $("search").value.trim().toLowerCase();
    const section = $("section-filter").value;
    const tier = $("tier-filter").value;
    const bath = $("bath-filter").value;
    const minPrice = parsePriceInput($("min-price").value);
    const maxPrice = parsePriceInput($("max-price").value);
    const sort = $("sort").value;
    const hideRoom = $("hide-room").checked;
    const hasPriceFilter = minPrice !== null || maxPrice !== null;

    let listings = state.listings.filter((item) => {
      const text = [item.id, item.name, item.address, item.rent, item.beds_baths, item.source_notes].join(" ").toLowerCase();
      const itemBath = parseBedsBaths(item.beds_baths);
      const price = Number(item.min_price);
      const hasKnownPrice = Number.isFinite(price);
      return (!query || text.includes(query)) &&
        (section === "all" || item.section === section) &&
        (tier === "all" || normalizedClass(item) === tier) &&
        (bath === "all" || itemBath === bath) &&
        (!hasPriceFilter || (hasKnownPrice &&
          (minPrice === null || price >= minPrice) &&
          (maxPrice === null || price <= maxPrice))) &&
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
    const links = renderSourceLinks(item.links);
    const primaryUrl = firstUrl(item.links);
    const title = primaryUrl
      ? `<a href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">${escapeHtml(item.name)}</a>`
      : escapeHtml(item.name);
    const primary = primaryUrl
      ? `<a class="primary-source" href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">Open primary source</a>`
      : "";
    return `
      <article class="card listing-card">
        <div class="card-top">
          <div>
            <h3>${title}</h3>
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
        <div class="links">${primary}${links || "<span class=\"meta\">No source link listed</span>"}</div>
      </article>
    `;
  }

  function renderPopup(item) {
    const primaryUrl = firstUrl(item.links);
    const title = primaryUrl
      ? `<a href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">${escapeHtml(item.id)}. ${escapeHtml(item.name)}</a>`
      : `${escapeHtml(item.id)}. ${escapeHtml(item.name)}`;
    const primary = primaryUrl
      ? `<a class="primary-source" href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">Open primary source</a>`
      : "";
    const links = renderSourceLinks(item.links);
    return `
      <div class="popup">
        <h3>${title}</h3>
        <p><strong>Address:</strong> ${escapeHtml(item.address_raw || item.address)}</p>
        <p><strong>Rent:</strong> ${escapeHtml(item.rent)}</p>
        <p><strong>Beds:</strong> ${escapeHtml(item.beds_baths || "Not specified")}</p>
        <p><strong>Notes:</strong> ${escapeHtml(item.source_notes || "No source notes provided.")}</p>
        <div class="links">${primary}${links}</div>
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

  function renderBasketballSection(basketball) {
    if (!basketball || !Array.isArray(basketball.courts) || !$("basketball-cards")) return;
    const courts = basketball.courts;
    const publicPick = courts.find((court) => court.id === "B1") || courts.find((court) => court.marker_class === "court_public") || courts[0];
    const closest = courts.reduce((best, court) => Number(court.office_distance_mi) < Number(best.office_distance_mi) ? court : best, courts[0]);
    const collegeCount = courts.filter((court) => court.college).length;

    $("basketball-summary").textContent = `${basketball.summary} Distances updated ${formatDate(basketball.generated)}.`;
    $("basketball-stats").innerHTML = [
      ["Closest option", `${closest.name} (${formatMiles(closest.office_distance_mi)} from office)`],
      ["Best public drop-in", `${publicPick.name} (${formatMiles(publicPick.office_distance_mi)} from office)`],
      ["College leads", `${collegeCount} option${collegeCount === 1 ? "" : "s"}`],
      ["Office", basketball.office.address]
    ].map(renderCourtStat).join("");
    $("basketball-methodology").innerHTML = (basketball.methodology || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    $("basketball-distance-note").textContent = basketball.distance_notes?.sourceDistanceMethod || "Distances are route estimates; verify live routing before traveling.";
    $("basketball-cards").innerHTML = courts.map(renderCourtCard).join("");
    renderBasketballLegend(basketball.legend || []);
  }

  function renderCourtStat([label, value]) {
    return `
      <div class="court-stat">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `;
  }

  function renderCourtCard(court) {
    const markerClass = normalizedClass(court);
    const sourceLinks = renderNamedLinks(court.links || [], "Source");
    return `
      <article class="card court-card">
        <div class="card-top">
          <div>
            <h3><a href="${escapeAttr(court.maps_url)}" target="_blank" rel="noopener">${escapeHtml(court.name)}</a></h3>
            <div class="meta">${escapeHtml(court.address)}</div>
          </div>
          <span class="pin" style="background:${COLORS[markerClass] || COLORS.unknown}">${escapeHtml(court.id)}</span>
        </div>
        <p class="price">${escapeHtml(court.rank_note || court.category || "Basketball option")}</p>
        <div class="court-distances">
          <div><strong>${formatMiles(court.office_distance_mi)}</strong><span>to 255 Arizona Ave</span></div>
          <div><strong>${formatMiles(court.metro_distance_mi)}</strong><span>to ${escapeHtml(court.nearest_metro_name)}</span></div>
          <div><strong>${escapeHtml(court.metro_walk_minutes)} min</strong><span>estimated Metro walk</span></div>
        </div>
        <p>${escapeHtml(court.source_notes || "Verify schedule and access before going.")}</p>
        <div class="badges">
          <span class="badge">${escapeHtml(court.category || LABELS[markerClass] || markerClass)}</span>
          <span class="badge">${escapeHtml(court.indoor_status || "Indoor status: verify")}</span>
          ${court.college ? '<span class="badge">College court</span>' : ""}
        </div>
        <p class="meta"><strong>Access:</strong> ${escapeHtml(court.access || "Verify access before going.")}</p>
        <div class="links">
          <a class="primary-source" href="${escapeAttr(court.office_directions_url)}" target="_blank" rel="noopener">Directions from office</a>
          <a href="${escapeAttr(court.metro_directions_url)}" target="_blank" rel="noopener">Walk to Metro</a>
          ${sourceLinks}
        </div>
      </article>
    `;
  }

  function renderBasketballLegend(legend) {
    const target = $("basketball-legend");
    if (!target) return;
    target.innerHTML = legend.map((item) => (
      `<span class="legend-item"><span class="swatch" style="background:${COLORS[item.class] || COLORS.unknown}"></span>${escapeHtml(item.label)}</span>`
    )).join("");
  }

  function initBasketballMap(basketball) {
    if (!$("basketball-map")) return;
    if (!basketball || !Array.isArray(basketball.courts) || !window.L) {
      showMapError("basketball-map-error");
      return;
    }
    try {
      const map = L.map("basketball-map", { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      const bounds = [];
      const stationById = Object.fromEntries((basketball.metro_stations || []).map((station) => [station.id, station]));
      const usedStations = new Set(basketball.courts.map((court) => court.nearest_metro_id));
      const office = basketball.office;

      if (office) {
        const officeMarker = L.marker([office.lat, office.lon], { icon: makeIcon("O", "office") })
          .bindPopup(`<div class="popup"><h3>${escapeHtml(office.name)}</h3><p>${escapeHtml(office.address)}</p></div>`)
          .addTo(map);
        bounds.push(officeMarker.getLatLng());
      }

      (basketball.metro_stations || []).filter((station) => usedStations.has(station.id)).forEach((station) => {
        const marker = L.marker([station.lat, station.lon], { icon: makeIcon("M", "metro") })
          .bindPopup(`<div class="popup"><h3>${escapeHtml(station.name)}</h3><p>${escapeHtml(station.address || "Metro E Line station")}</p></div>`)
          .addTo(map);
        bounds.push(marker.getLatLng());
      });

      basketball.courts.forEach((court) => {
        const station = stationById[court.nearest_metro_id];
        const marker = L.marker([court.lat, court.lon], { icon: makeIcon(court.id, normalizedClass(court)) })
          .bindPopup(renderCourtPopup(court))
          .addTo(map);
        bounds.push(marker.getLatLng());

        if (office) {
          L.polyline([[court.lat, court.lon], [office.lat, office.lon]], {
            color: "#111827",
            weight: 1.5,
            opacity: 0.45,
            dashArray: "6 8",
            interactive: false
          }).addTo(map);
        }
        if (station) {
          L.polyline([[court.lat, court.lon], [station.lat, station.lon]], {
            color: "#2563eb",
            weight: 1.5,
            opacity: 0.55,
            dashArray: "3 7",
            interactive: false
          }).addTo(map);
        }
      });

      if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
    } catch (error) {
      showMapError("basketball-map-error");
      console.error(error);
    }
  }

  function renderCourtPopup(court) {
    const sourceLinks = renderNamedLinks(court.links || [], "Source");
    return `
      <div class="popup">
        <h3>${escapeHtml(court.id)}. ${escapeHtml(court.name)}</h3>
        <p><strong>Address:</strong> ${escapeHtml(court.address)}</p>
        <p><strong>Office:</strong> ${formatMiles(court.office_distance_mi)} driving-route miles from 255 Arizona Ave.</p>
        <p><strong>Metro:</strong> ${formatMiles(court.metro_distance_mi)} to ${escapeHtml(court.nearest_metro_name)}.</p>
        <p><strong>Access:</strong> ${escapeHtml(court.access || "Verify before going.")}</p>
        <div class="links"><a class="primary-source" href="${escapeAttr(court.office_directions_url)}" target="_blank" rel="noopener">Office directions</a>${sourceLinks}</div>
      </div>
    `;
  }

  function normalizedClass(item) {
    return item.marker_class || "unknown";
  }

  function parseBedsBaths(value) {
    const text = String(value || "").toLowerCase();
    const allowedBaths = new Set([1, 2, 2.5, 3, 3.5, 4]);
    const pairs = [];
    const pairedPattern = /(\d+(?:\.\d+)?)\s*(?:bed|br|bd|bedroom)s?\s*(?:\/|,|and|with|-)\s*(\d+(?:\.\d+)?)\s*(?:bath|ba|bth|bathroom)s?/g;
    let match;

    while ((match = pairedPattern.exec(text)) !== null) {
      pairs.push({ beds: Number(match[1]), baths: Number(match[2]) });
    }

    if (!pairs.length) {
      const bedMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bed|br|bd|bedroom)s?/);
      const bathMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bath|ba|bth|bathroom)s?/);
      if (bedMatch && bathMatch) pairs.push({ beds: Number(bedMatch[1]), baths: Number(bathMatch[1]) });
    }

    const validPairs = pairs.filter((pair) => pair.beds === 3 && allowedBaths.has(pair.baths));
    const distinctBaths = [...new Set(validPairs.map((pair) => pair.baths))];
    if (distinctBaths.length !== 1) return "unknown";
    return `3-${formatBathValue(distinctBaths[0])}`;
  }

  function formatBathValue(value) {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  function parsePriceInput(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }

  function firstUrl(links) {
    return Array.isArray(links) && links.length ? links[0] : "";
  }

  function renderSourceLinks(links) {
    return (links || []).map((url, index) => (
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">Source ${index + 1}</a>`
    )).join("");
  }

  function renderNamedLinks(links, label) {
    return (links || []).map((url, index) => (
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(label)} ${index + 1}</a>`
    )).join("");
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

  function formatMiles(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-- mi";
    return `${number.toFixed(number < 10 ? 2 : 1)} mi`;
  }

  function showMapError(id = "map-error") {
    const element = $(id);
    if (element) element.hidden = false;
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
