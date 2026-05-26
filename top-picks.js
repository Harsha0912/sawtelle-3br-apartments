(function () {
  "use strict";

  const TOP_PICKS_URL = "data/top-picks.json";
  const AVAILABILITY_URL = "data/availability-checks.json";
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try {
      const [topPicks, availability] = await Promise.all([
        loadJson(TOP_PICKS_URL),
        loadJson(AVAILABILITY_URL),
      ]);
      renderTopPicks(topPicks);
      renderAvailabilityReport(availability);
    } catch (error) {
      $("top-picks-summary").textContent = error.message || "Unable to load ranked recommendations.";
      $("ranking-count").textContent = "Data unavailable";
      if ($("availability-summary")) $("availability-summary").textContent = error.message || "Unable to load availability data.";
      console.error(error);
    }
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
    return response.json();
  }

  function renderTopPicks(data) {
    $("top-picks-summary").textContent = data.summary || "Ranked recommendations from the Sawtelle 3BR research file.";
    $("budget-target").textContent = data.budgetTarget || "Verify";
    $("generated-at").textContent = data.generatedAt || "Unknown";
    $("scope").textContent = data.scope || "Sawtelle / West LA 3-bedroom candidates.";
    $("methodology-list").innerHTML = renderList(data.methodology);
    $("limitations-list").innerHTML = renderList(data.sourceLimitations);
    $("review-sources").innerHTML = renderReviewSources(data.reviewSources);
    $("tour-checklist").innerHTML = renderList(data.tourChecklist);
    renderTravelContext(data.travelContext);

    const rankings = Array.isArray(data.rankings) ? data.rankings.slice().sort((a, b) => a.rank - b.rank) : [];
    $("ranking-count").textContent = `${rankings.length} reviewed picks`;
    $("ranked-list").innerHTML = rankings.map(renderRankCard).join("");
  }

  function renderTravelContext(context) {
    if (!$("travel-context-summary")) return;
    const data = context || {};
    $("travel-context-summary").textContent = data.priorityStatement || "Route context unavailable.";
    if ($("travel-updated")) $("travel-updated").textContent = data.updatedAt ? `Updated ${data.updatedAt}` : "Route estimates";
    if ($("route-priority")) $("route-priority").textContent = data.shortlistTitle || "UCLA + Sawtelle";
    if ($("travel-method")) $("travel-method").textContent = data.distanceMethod || "Use live maps before touring.";
    if ($("anchor-list")) $("anchor-list").innerHTML = renderAnchorCards(data.anchors);
    if ($("travel-takeaways")) $("travel-takeaways").innerHTML = renderList(data.keyTakeaways);
    if ($("lifestyle-shortlist-title")) $("lifestyle-shortlist-title").textContent = data.shortlistTitle || "Lifestyle shortlist";
    if ($("lifestyle-shortlist")) $("lifestyle-shortlist").innerHTML = renderLifestyleShortlist(data.shortlist);
  }

  function renderAnchorCards(anchors) {
    const items = anchors && typeof anchors === "object" ? Object.values(anchors) : [];
    if (!items.length) return '<div class="empty-state">No route anchors loaded.</div>';
    return items.map((anchor) => `
      <article class="anchor-card">
        <strong>${escapeHtml(anchor.name || "Destination")}</strong>
        <span>${escapeHtml(anchor.address || "Address to verify")}</span>
      </article>
    `).join("");
  }

  function renderLifestyleShortlist(shortlist) {
    const items = Array.isArray(shortlist) ? shortlist : [];
    if (!items.length) return '<div class="empty-state">No lifestyle shortlist loaded.</div>';
    return `<ol class="lifestyle-shortlist">${items.map((item) => `
      <li>
        <div>
          <strong>#${escapeHtml(item.rank || "?")} ${escapeHtml(item.name || "Unnamed pick")}</strong>
          <p>${escapeHtml(item.reason || "Route fit needs review.")}</p>
        </div>
        <span>${escapeHtml(item.fitScore || "?")}/10 · ${escapeHtml(item.fitType || "fit")}</span>
      </li>
    `).join("")}</ol>`;
  }

  function renderAvailabilityReport(data) {
    if (!$("availability-summary")) return;
    const rows = Array.isArray(data.listings) ? data.listings.slice().sort((a, b) => a.availabilityRank - b.availabilityRank) : [];
    const availableNow = rows.filter((row) => row.availabilityStatus === "available_now");
    const future = rows.filter((row) => row.availabilityStatus === "future_availability");
    const stale = rows.filter((row) => row.availabilityStatus === "unavailable_or_stale");

    $("availability-summary").textContent = rows.length
      ? `${rows.length} strict $4k-$6.5k whole-unit candidates checked on ${data.checkedDate || data.generatedAt}. ${availableNow.length} have a public 3BR Available Now/date-on-or-before-today signal; ${future.length} are future-dated; ${stale.length} look stale or mismatched.`
      : "No strict-budget availability rows loaded.";
    $("availability-generated").textContent = data.generatedAt || "Unknown";
    $("availability-caveat").textContent = data.moveInTodayCaveat || "Public availability is not a leasing-office guarantee.";
    $("availability-stats").innerHTML = renderAvailabilityStats(data.counts || {}, rows.length);
    $("availability-methodology").innerHTML = renderList(data.methodology || []);
    $("availability-limitations").innerHTML = renderList(data.limitations || []);

    $("available-now-count").textContent = `${availableNow.length} public Available Now signals`;
    $("available-now-list").innerHTML = availableNow.length
      ? availableNow.map((row) => renderAvailabilityCard(row, true)).join("")
      : '<div class="empty-state">No public Available Now 3BR rows were parsed. Call leasing offices directly.</div>';

    $("availability-count").textContent = `${rows.length} in-range candidates`;
    $("availability-list").innerHTML = rows.length
      ? rows.map((row) => renderAvailabilityCard(row, false)).join("")
      : '<div class="empty-state">No availability rows loaded.</div>';
  }

  function renderRankCard(item) {
    const links = renderLinks(item.links);
    const evidence = renderEvidence(item.evidence);
    const lifestyle = renderLifestyleFit(item.lifestyleFit);
    const primaryUrl = item.primaryUrl || firstLinkUrl(item.links);
    const primary = primaryUrl
      ? `<a class="primary-source" href="${escapeAttr(primaryUrl)}" target="_blank" rel="noopener">Open primary source</a>`
      : "";
    return `
      <article class="card rank-card">
        <div class="rank-number">${escapeHtml(item.rank || "")}</div>
        <div class="rank-main">
          <div class="rank-title">
            <div>
              <h3>${escapeHtml(item.name || "Unnamed pick")}</h3>
              <div class="meta">${escapeHtml(item.address || "Address to verify")}</div>
            </div>
            <span class="score-pill">Score ${escapeHtml(item.score || "N/A")}</span>
          </div>
          <div class="badges">
            <span class="badge">${escapeHtml(item.priceText || "Price to verify")}</span>
            <span class="badge">${escapeHtml(item.bedsBaths || "Beds/baths to verify")}</span>
            ${item.listingId ? `<span class="badge">Listing ${escapeHtml(item.listingId)}</span>` : ""}
          </div>
          <p><strong>${escapeHtml(item.headline || "Why it ranks")}</strong></p>
          <p>${escapeHtml(item.whyRanked || "")}</p>
          ${lifestyle}
          <div class="detail-grid">
            <section class="detail-block">
              <h4>Pros</h4>
              <ul>${renderList(item.pros)}</ul>
            </section>
            <section class="detail-block">
              <h4>Cautions</h4>
              <ul>${renderList(item.cautions)}</ul>
            </section>
          </div>
          <section class="detail-block">
            <h4>Review compilation</h4>
            <p>${escapeHtml(item.reviewSummary || "No review summary available.")}</p>
          </section>
          <section class="evidence-list" aria-label="Evidence snippets">
            ${evidence}
          </section>
          <div class="links">${primary}${links}</div>
        </div>
      </article>
    `;
  }

  function renderLifestyleFit(fit) {
    if (!fit || !fit.distances) return "";
    const office = fit.distances.office || {};
    const ucla = fit.distances.ucla || {};
    const sawtelle = fit.distances.sawtelleFood || {};
    return `
      <section class="lifestyle-fit" aria-label="UCLA basketball, Sawtelle food, and office route fit">
        <div class="lifestyle-fit-header">
          <div>
            <h4>Your three anchors</h4>
            <p>${escapeHtml(fit.summary || "Route fit needs review.")}</p>
          </div>
          <span class="lifestyle-score">${escapeHtml(fit.fitScore || "?")}/10 · ${escapeHtml(fit.fitType || "fit")}</span>
        </div>
        <div class="route-card-grid">
          ${renderRouteTile("🏀", "UCLA hoops", `${formatMiles(ucla.routeMiles)} · ${formatMinutes(ucla.driveMinutesNoTraffic, "drive, no traffic")} · ${formatMinutes(ucla.bikeMinutesEstimate, "bike est.")}`, ucla.directionsUrl)}
          ${renderRouteTile("🍜", "Sawtelle food", `${formatMiles(sawtelle.routeMiles)} · ${formatMinutes(sawtelle.walkMinutesEstimate, "walk est.")} · ${formatMinutes(sawtelle.bikeMinutesEstimate, "bike est.")}`, sawtelle.directionsUrl)}
          ${renderRouteTile("🏢", "255 Arizona office", `${formatMiles(office.routeMiles)} · ${formatMinutes(office.driveMinutesNoTraffic, "drive, no traffic")}`, office.directionsUrl)}
        </div>
        <ul class="route-notes">${renderList(fit.routeNotes)}</ul>
      </section>
    `;
  }

  function renderRouteTile(icon, label, value, url) {
    const safeValue = value.replace(/undefined[^·]*/g, "").replace(/\s+·\s+$/g, "");
    const title = `<span class="route-icon">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span>`;
    const body = `<strong>${escapeHtml(safeValue || "Route needs review")}</strong>`;
    if (!url) return `<div class="route-tile">${title}${body}</div>`;
    return `<a class="route-tile" href="${escapeAttr(url)}" target="_blank" rel="noopener">${title}${body}</a>`;
  }

  function formatMiles(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} mi` : "miles?";
  }

  function formatMinutes(value, label) {
    return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} min ${label}` : "time?";
  }

  function renderAvailabilityStats(counts, total) {
    const order = [
      ["available_now", "Available now"],
      ["future_availability", "Future-dated"],
      ["active_no_date", "Active/no date"],
      ["contact_for_availability", "Contact"],
      ["needs_manual", "Manual check"],
      ["unavailable_or_stale", "Stale/mismatch"],
    ];
    const cards = order.map(([key, label]) => `
      <div class="availability-stat">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(counts[key] || 0)}</dd>
      </div>
    `).join("");
    return `<dl class="availability-stats-grid"><div class="availability-stat total"><dt>Total checked</dt><dd>${escapeHtml(total || 0)}</dd></div>${cards}</dl>`;
  }

  function renderAvailabilityCard(row, emphasizeUnits) {
    const status = row.availabilityStatus || "needs_manual";
    const units = renderAvailabilityUnits(row.availableUnits, row.availabilitySummary, emphasizeUnits ? 4 : 3);
    const links = renderLinks((row.links || []).map((url) => ({ label: sourceLabel(url), url })));
    const reviewSummary = row.reviewSummary || "No review summary available.";
    return `
      <article class="availability-card status-${escapeAttr(status)}">
        <div class="availability-card-top">
          <div class="availability-rank">${escapeHtml(row.availabilityRank || "")}</div>
          <div class="availability-main">
            <div class="availability-title-row">
              <div>
                <h3>${escapeHtml(row.name || "Unnamed listing")}</h3>
                <div class="meta">${escapeHtml(row.address || "Address to verify")}</div>
              </div>
              <span class="status-pill status-${escapeAttr(status)}">${escapeHtml(formatStatus(status))}</span>
            </div>
            <div class="badges">
              <span class="badge">${escapeHtml(row.rent || "Price to verify")}</span>
              <span class="badge">${escapeHtml(row.bedsBaths || "Beds/baths to verify")}</span>
              <span class="badge">${escapeHtml(row.section || "section?")}</span>
              <span class="badge">${escapeHtml(formatReviewTier(row.reviewTier))}</span>
              <span class="badge">${escapeHtml(formatDisposition(row.disposition))}</span>
            </div>
          </div>
        </div>
        <div class="availability-body">
          <section class="detail-block">
            <h4>Availability / move-in today</h4>
            <p><strong>${escapeHtml(formatMoveSignal(row.moveInTodaySignal))}</strong> — ${escapeHtml(row.availabilitySummary || "Availability needs confirmation.")}</p>
            <ul>${units}</ul>
          </section>
          <section class="detail-block">
            <h4>Review filter</h4>
            <p><strong>${escapeHtml(row.reviewHeadline || formatReviewTier(row.reviewTier))}</strong></p>
            <p>${escapeHtml(shorten(reviewSummary, emphasizeUnits ? 360 : 240))}</p>
          </section>
          <div class="links">${links}</div>
        </div>
      </article>
    `;
  }

  function renderAvailabilityUnits(units, fallback, limit) {
    const items = Array.isArray(units) ? units.slice(0, limit) : [];
    if (!items.length) return `<li>${escapeHtml(fallback || "No unit-level row parsed; call to confirm.")}</li>`;
    return items.map((unit) => {
      const bits = [
        unit.source,
        unit.unit,
        unit.price ? String(unit.price) : "price?",
        unit.availabilityRaw || unit.availabilityDate || "date?",
      ].filter(Boolean);
      const details = [unit.baths ? `${unit.baths} bath` : "", unit.sqft ? `${unit.sqft} sqft` : ""].filter(Boolean).join(" / ");
      return `<li>${escapeHtml(bits.join(" · "))}${details ? ` <span class="meta">${escapeHtml(details)}</span>` : ""}</li>`;
    }).join("");
  }

  function renderEvidence(evidence) {
    const items = Array.isArray(evidence) ? evidence : [];
    if (!items.length) return '<div class="evidence-item"><strong>Evidence</strong><p>No source snippets available.</p></div>';
    return items.map((source) => {
      const snippets = (source.snippets || []).slice(0, 3).map((snippet) => (
        `<p>${escapeHtml(compactSnippet(snippet))}</p>`
      )).join("");
      const title = source.sourceUrl
        ? `<a href="${escapeAttr(source.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(source.sourceTitle || "Evidence source")}</a>`
        : escapeHtml(source.sourceTitle || "Evidence source");
      return `<div class="evidence-item"><strong>${title}</strong>${snippets}</div>`;
    }).join("");
  }

  function renderReviewSources(sources) {
    const items = Array.isArray(sources) ? sources : [];
    return items.map((source) => {
      if (typeof source === "string") return `<li>${escapeHtml(source)}</li>`;
      const label = source.label || source.name || source.title || source.url || "Review source";
      const note = source.notes ? ` — ${escapeHtml(source.notes)}` : "";
      return `<li><a href="${escapeAttr(source.url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>${note}</li>`;
    }).join("");
  }

  function renderLinks(links) {
    const items = Array.isArray(links) ? links : [];
    return items.map((link, index) => {
      const url = typeof link === "string" ? link : link.url;
      const label = typeof link === "string" ? `Source ${index + 1}` : (link.label || `Source ${index + 1}`);
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    }).join("");
  }

  function firstLinkUrl(links) {
    if (!Array.isArray(links) || !links.length) return "";
    return typeof links[0] === "string" ? links[0] : links[0].url;
  }

  function renderList(items) {
    return (items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function sourceLabel(url) {
    const value = String(url || "");
    if (value.includes("hotpads")) return "HotPads";
    if (value.includes("zumper")) return "Zumper";
    if (value.includes("rent.com")) return "Rent.com";
    if (value.includes("apartmenthomeliving")) return "ApartmentHomeLiving";
    if (value.includes("veryapt")) return "VeryApt reviews";
    if (value.includes("birdeye")) return "Birdeye reviews";
    if (value.includes("apartmentratings")) return "ApartmentRatings lead";
    return "Source";
  }

  function formatStatus(status) {
    return ({
      available_now: "Available Now signal",
      future_availability: "Future availability",
      active_no_date: "Active, no date",
      contact_for_availability: "Contact to confirm",
      needs_manual: "Manual check needed",
      unavailable_or_stale: "Stale / mismatch",
    })[status] || "Needs verification";
  }

  function formatMoveSignal(signal) {
    return ({
      "listed-available-now": "Public same-day signal",
      "needs-confirmation": "Call before relying on move-in today",
      no: "Not available today from public data",
    })[signal] || "Needs confirmation";
  }

  function formatReviewTier(tier) {
    return ({
      "strong-specific": "Strong building reviews",
      "some-specific": "Some building reviews",
      "mixed-or-manager-wide": "Mixed/manager-wide reviews",
      thin: "Review-light",
    })[tier] || "Review unknown";
  }

  function formatDisposition(disposition) {
    return ({
      "tour-first": "Tour first",
      "available-but-review-caution": "Available, review caution",
      "available-review-light": "Available, review-light",
      "call-to-confirm": "Call to confirm",
      "waitlist-or-future-tour": "Future/waitlist",
      "backup-or-manual-check": "Backup/manual check",
      "likely-stale": "Likely stale",
    })[disposition] || "Needs triage";
  }

  function shorten(value, max) {
    const text = compactSnippet(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  function compactSnippet(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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
    return escapeHtml(value || "#");
  }
})();
