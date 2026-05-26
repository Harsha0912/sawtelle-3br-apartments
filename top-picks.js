(function () {
  "use strict";

  const TOP_PICKS_URL = "data/top-picks.json";
  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try {
      const response = await fetch(TOP_PICKS_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load ${TOP_PICKS_URL}: ${response.status}`);
      const data = await response.json();
      renderTopPicks(data);
    } catch (error) {
      $("top-picks-summary").textContent = error.message || "Unable to load ranked recommendations.";
      $("ranking-count").textContent = "Data unavailable";
      console.error(error);
    }
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

    const rankings = Array.isArray(data.rankings) ? data.rankings.slice().sort((a, b) => a.rank - b.rank) : [];
    $("ranking-count").textContent = `${rankings.length} ranked picks`;
    $("ranked-list").innerHTML = rankings.map(renderRankCard).join("");
  }

  function renderRankCard(item) {
    const links = renderLinks(item.links);
    const evidence = renderEvidence(item.evidence);
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
      return `<li><a href="${escapeAttr(source.url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></li>`;
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
