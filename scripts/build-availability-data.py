#!/usr/bin/env python3
"""Build current availability/check data for Sawtelle 3BR budget listings.

The script fetches accessible listing sources, extracts public availability signals,
and merges them with the existing ranked-review data. It intentionally does not
claim same-day move-in unless a source exposes "Available Now" or a date on/before
today; even then the UI labels it as a public listing signal that requires leasing
office confirmation.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise SystemExit("requests is required") from exc

ROOT = Path(__file__).resolve().parents[1]
APP_DATA = ROOT / "data" / "app-data.json"
TOP_PICKS = ROOT / "data" / "top-picks.json"
OUT = ROOT / "data" / "availability-checks.json"
CACHE_DIR = Path(os.environ.get("SAWTELLE_SCRAPE_CACHE", "/tmp/sawtelle-availability-cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
TODAY = datetime.now().date()
FETCHED_AT = datetime.now().strftime("%Y-%m-%d %H:%M %Z") or datetime.now().strftime("%Y-%m-%d %H:%M")
STRICT_MIN = 4000
STRICT_MAX = 6500

SOURCE_PRIORITY = {
    "hotpads": 1,
    "zumper": 2,
    "rent": 3,
    "apartmenthomeliving": 4,
}

WISSEMAN_REVIEW = (
    "Wiseman-managed listing: management-wide sources are mixed/polarized. "
    "VeryApt showed Wiseman Management with 91 reviews and a 6.8 management rating; "
    "prior scrape also found Birdeye/Wiseman caution themes around responsiveness, packages, and fees."
)

MANUAL_REVIEW = "No reliable building-specific review compilation was confirmed; tour and recent-resident questions matter more."


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def source_kind(url: str) -> str:
    host = re.sub(r"^https?://", "", url).split("/", 1)[0].lower()
    if "hotpads" in host:
        return "hotpads"
    if "zumper" in host:
        return "zumper"
    if "rent.com" in host:
        return "rent"
    if "apartmenthomeliving" in host:
        return "apartmenthomeliving"
    if "veryapt" in host:
        return "veryapt"
    if "birdeye" in host:
        return "birdeye"
    if "apartmentratings" in host:
        return "apartmentratings"
    return "other"


def should_fetch_for_availability(url: str) -> bool:
    return source_kind(url) in {"hotpads", "zumper", "rent", "apartmenthomeliving"}


def jina_url(url: str) -> str:
    # Double Jina pass is more reliable for HotPads/Rent.com dynamic pages.
    return "https://r.jina.ai/http://r.jina.ai/http://" + url


def cache_path(url: str, mode: str) -> Path:
    key = hashlib.sha256((mode + "\0" + url).encode()).hexdigest()[:24]
    return CACHE_DIR / f"{key}.txt"


def fetch(url: str, mode: str = "auto", ttl_seconds: int = 12 * 3600) -> tuple[str, str, int, str]:
    kind = source_kind(url)
    if mode == "auto":
        mode = "direct" if kind == "zumper" else "jina"
    cp = cache_path(url, mode)
    if cp.exists() and time.time() - cp.stat().st_mtime < ttl_seconds:
        return cp.read_text(errors="ignore"), "cache", 200, url
    target = jina_url(url) if mode == "jina" else url
    try:
        response = requests.get(target, headers={"User-Agent": UA}, timeout=35, allow_redirects=True)
        text = response.text or ""
        cp.write_text(text, errors="ignore")
        time.sleep(0.25)
        return text, "network", response.status_code, response.url
    except Exception as exc:
        return f"FETCH_ERROR: {type(exc).__name__}: {exc}", "error", 0, target


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_date(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.lower() in {"now", "available now"}:
        return TODAY.isoformat()
    # Zumper uses YYYY/MM/DD.
    for fmt in ["%Y/%m/%d", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"]:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    # Month day with implicit current year.
    m = re.match(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})$", s, re.I)
    if m:
        mon = m.group(1).lower()[:3]
        if mon == "sep":
            mon = "sep"
        month = list(calendar.month_abbr).index(mon.title())
        day = int(m.group(2))
        year = TODAY.year
        try:
            d = datetime(year, month, day).date()
            if d < TODAY:
                d = datetime(year + 1, month, day).date()
            return d.isoformat()
        except ValueError:
            return None
    return None


def epoch_to_date(value: Any) -> str | None:
    try:
        if value in (None, ""):
            return None
        return datetime.fromtimestamp(int(value), tz=timezone.utc).date().isoformat()
    except Exception:
        return None


@dataclass
class Signal:
    source: str
    url: str
    status: str
    moveInTodaySignal: str
    summary: str
    units: list[dict[str, Any]]
    fetchedStatus: int = 0
    fetchedUrl: str = ""


def classify_units(units: list[dict[str, Any]], default_status: str = "active_no_date") -> tuple[str, str, str]:
    if not units:
        if default_status == "contact":
            return "contact_for_availability", "needs-confirmation", "Contact leasing / availability not exposed"
        if default_status == "unavailable":
            return "unavailable_or_stale", "no", "No active matching 3BR availability found in accessible source"
        return "active_no_date", "needs-confirmation", "Active listing; availability date not exposed"
    nowish = []
    future = []
    unknown = []
    for unit in units:
        raw = str(unit.get("availabilityRaw") or "").strip()
        d = parse_date(raw) or unit.get("availabilityDate")
        if raw.lower() in {"now", "available now"}:
            nowish.append(unit)
        elif d:
            try:
                if datetime.fromisoformat(str(d)).date() <= TODAY:
                    nowish.append(unit)
                else:
                    future.append((d, unit))
            except ValueError:
                unknown.append(unit)
        else:
            unknown.append(unit)
    if nowish:
        return "available_now", "listed-available-now", f"{len(nowish)} matching 3BR unit(s) are publicly listed as Available Now / date on or before today"
    if future:
        future.sort(key=lambda x: x[0])
        return "future_availability", "no", f"Earliest matching 3BR public availability: {future[0][0]}"
    if unknown:
        return "active_no_date", "needs-confirmation", f"{len(unknown)} matching 3BR active unit/floorplan record(s), but no date exposed"
    return default_status, "needs-confirmation", "Availability could not be classified"


def parse_zumper(url: str) -> Signal:
    text, src, code, fetched_url = fetch(url, mode="direct")
    units: list[dict[str, Any]] = []
    summary_bits: list[str] = []
    m = re.search(r"window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*window\.__GIT_SHA__", text, re.S)
    if not m:
        return Signal("Zumper", url, "needs_manual", "needs-confirmation", f"Zumper page loaded status {code}, but preloaded listing data was not found.", [], code, fetched_url)
    try:
        state = json.loads(m.group(1))
    except Exception as exc:
        return Signal("Zumper", url, "needs_manual", "needs-confirmation", f"Could not parse Zumper listing JSON: {exc}", [], code, fetched_url)
    ent = (((state.get("detail") or {}).get("entity") or {}).get("data"))
    if not ent:
        return Signal("Zumper", url, "unavailable_or_stale", "no", "Zumper redirected or did not expose a detail entity; likely stale/off-market or search page.", [], code, fetched_url)
    source_url_path = ent.get("url") or ent.get("pl_url") or ent.get("pa_url") or ""
    # Building pages expose active floorplan_listings; unit pages expose the listing directly.
    floorplans = ent.get("floorplan_listings") or []
    records = floorplans if floorplans else [ent]
    for rec in records:
        beds = rec.get("bedrooms")
        price = rec.get("min_price") or rec.get("price")
        status = rec.get("listing_status")
        if beds != 3:
            continue
        if status not in (None, 1):
            continue
        raw_date = rec.get("date_available") or rec.get("available_on") or rec.get("available_start")
        parsed = parse_date(raw_date)
        units.append({
            "unit": rec.get("unit") or rec.get("address") or rec.get("title") or "3BR floorplan",
            "price": price,
            "beds": beds,
            "baths": rec.get("bathrooms"),
            "sqft": rec.get("square_feet"),
            "availabilityRaw": raw_date or "Active / date not shown",
            "availabilityDate": parsed,
            "listedOn": epoch_to_date(rec.get("listed_on")),
            "modifiedOn": epoch_to_date(rec.get("modified_on")),
        })
    if ent.get("listing_id") and not floorplans:
        summary_bits.append(
            f"Zumper listing entity {ent.get('listing_id')} shows {ent.get('bedrooms')} bed/{ent.get('bathrooms')} bath, "
            f"${ent.get('min_price') or ent.get('price'):,} if price is exposed, status={ent.get('listing_status')}, "
            f"date_available={ent.get('date_available') or 'not shown'}."
            if ent.get('min_price') or ent.get('price') else
            f"Zumper listing entity {ent.get('listing_id')} shows {ent.get('bedrooms')} bed/{ent.get('bathrooms')} bath, status={ent.get('listing_status')}, date_available={ent.get('date_available') or 'not shown'}."
        )
    elif floorplans:
        summary_bits.append(f"Zumper building data exposes {len(units)} active 3BR floorplan/listing record(s).")
    if source_url_path and source_url_path not in url:
        # Helps catch old/stale URLs that redirect to a different listing.
        summary_bits.append(f"Parsed Zumper canonical path: {source_url_path}.")
    if not units:
        return Signal("Zumper", url, "unavailable_or_stale", "no", clean_text(" ".join(summary_bits) or "No active matching 3BR unit/floorplan found in Zumper data."), [], code, fetched_url)
    status, move, headline = classify_units(units)
    return Signal("Zumper", url, status, move, clean_text(" ".join(summary_bits + [headline])), units, code, fetched_url)


def parse_hotpads_rows(text: str) -> list[dict[str, Any]]:
    compact = clean_text(text)
    # Work mostly after units section to avoid search-card duplicates.
    idx = compact.lower().find("units available")
    if idx >= 0:
        compact = compact[idx:]
    units: list[dict[str, Any]] = []

    # HotPads renders each floorplan as e.g.:
    #   2 Beds•2 bath•1,018 sqft | Unit | Rent/mo | Available | ...
    #   | 2-202R | $5,257 | Now | › |
    # Earlier versions of this script checked a loose 800-char context window,
    # which accidentally pulled 2BR rows when a "3 Beds" tab/header was nearby.
    # Instead, identify each floorplan heading first and only parse rows inside
    # headings whose own bed count is 3.
    headings = list(re.finditer(
        r"(?P<beds>\d+)\s+Beds?[•·]\s*(?P<meta>[^|#*]{0,160}?)\s*\|\s*Unit\s*\|\s*Rent/mo\s*\|\s*Available\s*\|",
        compact,
        re.I,
    ))
    for i, heading in enumerate(headings):
        if int(heading.group("beds")) != 3:
            continue
        block_end = headings[i + 1].start() if i + 1 < len(headings) else len(compact)
        block = compact[heading.end():block_end]
        meta = clean_text(heading.group("meta"))
        bath_match = re.search(r"(\d+(?:\.\d+)?)\s*bath", meta, re.I)
        sqft_match = re.search(r"([\d,]+)\s*sqft", meta, re.I)
        for m in re.finditer(r"\|\s*([^|]{1,50}?)\s*\|\s*(\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?)\s*\|\s*(Now|Available Now|\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2})\s*\|", block):
            unit = clean_text(m.group(1))
            if unit.lower() in {"unit", "---"}:
                continue
            raw = clean_text(m.group(3))
            units.append({
                "unit": unit,
                "price": clean_text(m.group(2)),
                "beds": 3,
                "baths": bath_match.group(1) if bath_match else None,
                "sqft": sqft_match.group(1) if sqft_match else None,
                "availabilityRaw": raw,
                "availabilityDate": parse_date(raw),
            })

    # Fallback for unit-level HotPads pages that expose only one card without a
    # floorplan table. Keep this conservative to avoid reintroducing 2BR matches.
    if not units:
        for m in re.finditer(r"(\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?)\s+3\s*[- ]?Beds?.{0,120}?Available\s+(Now|\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2})", compact, re.I):
            raw = "Available " + clean_text(m.group(2))
            units.append({
                "unit": "3BR listing card",
                "price": clean_text(m.group(1)),
                "beds": 3,
                "baths": None,
                "sqft": None,
                "availabilityRaw": raw,
                "availabilityDate": parse_date(raw),
            })

    # De-duplicate repeated HotPads/Jina units.
    seen = set()
    deduped = []
    for unit in units:
        key = (unit.get("unit"), unit.get("price"), unit.get("availabilityRaw"))
        if key not in seen:
            seen.add(key)
            deduped.append(unit)
    return deduped


def parse_hotpads(url: str) -> Signal:
    text, src, code, fetched_url = fetch(url, mode="jina")
    if "Access to this page has been denied" in text and len(text) < 2000:
        return Signal("HotPads", url, "needs_manual", "needs-confirmation", "HotPads denied automated access; manual browser check needed.", [], code, fetched_url)
    units = parse_hotpads_rows(text)
    summary = []
    m = re.search(r"Verified Updated\s+([^·]+)·Listed\s+([^\n$]+)", text)
    if m:
        summary.append(f"HotPads shows verified/updated {clean_text(m.group(1))}, listed {clean_text(m.group(2))}.")
    if units:
        summary.append(f"HotPads exposes {len(units)} matching 3BR unit row(s).")
        status, move, headline = classify_units(units)
        summary.append(headline)
        return Signal("HotPads", url, status, move, clean_text(" ".join(summary)), units, code, fetched_url)
    # Fallback: property card may only expose aggregate range plus available now.
    lower = text.lower()
    if re.search(r"3\s*Beds?.{0,80}Available Now|Available Now.{0,80}3\s*Beds?", text, re.I):
        return Signal("HotPads", url, "available_now", "listed-available-now", clean_text("HotPads text contains a 3BR Available Now signal, but unit table was not parseable."), [], code, fetched_url)
    if "contact" in lower and "tour" in lower and ("available" in lower or "availability" in lower):
        return Signal("HotPads", url, "active_no_date", "needs-confirmation", clean_text("HotPads page loads and has contact/tour flow, but no parseable 3BR availability table."), [], code, fetched_url)
    return Signal("HotPads", url, "needs_manual", "needs-confirmation", "HotPads page loaded, but no parseable 3BR availability signal was found.", [], code, fetched_url)


def parse_rent(url: str) -> Signal:
    text, src, code, fetched_url = fetch(url, mode="jina")
    if "Are You a Robot" in text and len(text) < 12000:
        return Signal("Rent.com", url, "needs_manual", "needs-confirmation", "Rent.com bot challenge/ratelimit; manual check needed.", [], code, fetched_url)
    compact = clean_text(text)
    seg = compact
    start = compact.find("## Floor Plans")
    if start >= 0:
        end = compact.find("## Policies", start)
        if end < 0:
            end = compact.find("## Amenities", start)
        seg = compact[start:end if end > start else min(len(compact), start + 4000)]
    units: list[dict[str, Any]] = []
    for m in re.finditer(r"([\w\- ,]+?)\s+(\$[\d,]+(?:\+)?)\s+3\s+Bd\s+(\d+(?:\.\d+)?)\s+Ba\s+([\d,]+)?\s*Sqft\s+(\d+)?\s*Unit[s]?\s+Available\s+(Now|\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2})", seg, re.I):
        units.append({
            "unit": clean_text(m.group(1))[-80:] or "3BR floorplan",
            "price": clean_text(m.group(2)),
            "beds": 3,
            "baths": m.group(3),
            "sqft": clean_text(m.group(4) or ""),
            "availabilityRaw": "Available " + clean_text(m.group(6)),
            "availabilityDate": parse_date(clean_text(m.group(6))),
            "unitCount": m.group(5),
        })
    # Simpler fallback used by many Rent.com pages.
    if not units:
        for m in re.finditer(r"(\$[\d,]+(?:\+)?)\s+3\s+Beds?\s+[•*]\s+(\d+(?:\.\d+)?)\s+Baths?.{0,80}?Available\s+(Now|\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2})", seg, re.I):
            units.append({
                "unit": "3BR floorplan",
                "price": clean_text(m.group(1)),
                "beds": 3,
                "baths": m.group(2),
                "sqft": None,
                "availabilityRaw": "Available " + clean_text(m.group(3)),
                "availabilityDate": parse_date(clean_text(m.group(3))),
            })
    seen = set()
    deduped = []
    for unit in units:
        key = (unit.get("unit"), unit.get("price"), unit.get("availabilityRaw"))
        if key not in seen:
            seen.add(key)
            deduped.append(unit)
    units = deduped
    if units:
        status, move, headline = classify_units(units)
        return Signal("Rent.com", url, status, move, f"Rent.com floor-plan section exposes {len(units)} matching 3BR row(s). {headline}", units, code, fetched_url)
    if re.search(r"3\s+Bedrooms?.{0,300}Available\s+Now", seg, re.I):
        return Signal("Rent.com", url, "available_now", "listed-available-now", "Rent.com exposes a 3BR Available Now signal, but a unit table was not parseable.", [], code, fetched_url)
    if "contact" in compact.lower() and "availability" in compact.lower():
        return Signal("Rent.com", url, "active_no_date", "needs-confirmation", "Rent.com page loads but no 3BR date/Available Now row was parseable.", [], code, fetched_url)
    return Signal("Rent.com", url, "needs_manual", "needs-confirmation", "Rent.com page loaded, but no current 3BR availability signal was found.", [], code, fetched_url)


def parse_apartmenthomeliving(url: str) -> Signal:
    text, src, code, fetched_url = fetch(url, mode="jina")
    if "Access Denied" in text and len(text) < 3000:
        return Signal("ApartmentHomeLiving", url, "needs_manual", "needs-confirmation", "ApartmentHomeLiving access denied; manual check needed.", [], code, fetched_url)
    compact = clean_text(text)
    units: list[dict[str, Any]] = []

    # ApartmentHomeLiving pages often include the bed-count navigation before the
    # 1BR/2BR floorplans. Parse actual floorplan headings ("### 3 Bed ...") so
    # 1BR rows like Maxwell Unit 205 do not get misclassified as 3BR.
    floorplan_heads = list(re.finditer(
        r"###\s*(?P<beds>\d+)\s+Bed\s+(?P<baths>\d+(?:\.\d+)?)\s+Bath\s*-?\s*(?P<label>[^#]{0,120})",
        compact,
        re.I,
    ))
    for i, head in enumerate(floorplan_heads):
        if int(head.group("beds")) != 3:
            continue
        block_end = floorplan_heads[i + 1].start() if i + 1 < len(floorplan_heads) else len(compact)
        block = compact[head.start():block_end]
        cutoff_candidates = [block.find(marker) for marker in ["## Pet Policy", "## Features", "## Community Features", "## Apartment Reviews", "Time and distance"] if block.find(marker) > 0]
        if cutoff_candidates:
            block = block[:min(cutoff_candidates)]
        bath = head.group("baths")
        label = clean_text(head.group("label"))
        sqft_match = re.search(r"([\d,]+)\s*sq\s*ft", label, re.I) or re.search(r"([\d,]+)\s*sq\s*ft", block, re.I)
        row_found = False
        for m in re.finditer(r"\|\s*(\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?)\s*\|\s*(Available Now|Now|\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2})\s*\|\s*Unit\s*([^|]+?)\s*\|\s*([\d,]+)?\s*\|", block, re.I):
            row_found = True
            raw = clean_text(m.group(2))
            units.append({
                "unit": "Unit " + clean_text(m.group(3)),
                "price": clean_text(m.group(1)),
                "beds": 3,
                "baths": bath,
                "sqft": clean_text(m.group(4) or (sqft_match.group(1) if sqft_match else "")),
                "availabilityRaw": raw,
                "availabilityDate": parse_date(raw),
            })
        if not row_found:
            m = re.search(r"From\s+(\$[\d,]+)[^#]{0,180}?Available\s+(Now|\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2})", block, re.I)
            if m:
                raw = "Available " + clean_text(m.group(2))
                units.append({
                    "unit": "3BR floorplan",
                    "price": clean_text(m.group(1)),
                    "beds": 3,
                    "baths": bath,
                    "sqft": sqft_match.group(1) if sqft_match else None,
                    "availabilityRaw": raw,
                    "availabilityDate": parse_date(raw),
                })
    seen = set()
    deduped = []
    for unit in units:
        key = (unit.get("unit"), unit.get("price"), unit.get("availabilityRaw"))
        if key not in seen:
            seen.add(key)
            deduped.append(unit)
    units = deduped
    if units:
        status, move, headline = classify_units(units)
        return Signal("ApartmentHomeLiving", url, status, move, f"ApartmentHomeLiving pricing/availability section exposes {len(units)} matching 3BR row(s). {headline}", units, code, fetched_url)
    if re.search(r"Contact\s+for\s+Availability|Call\s+for\s+availability|Check\s+Availability", compact, re.I):
        return Signal("ApartmentHomeLiving", url, "contact_for_availability", "needs-confirmation", "ApartmentHomeLiving says to contact/check for availability; no 3BR date exposed.", [], code, fetched_url)
    return Signal("ApartmentHomeLiving", url, "needs_manual", "needs-confirmation", "ApartmentHomeLiving page loaded, but no current 3BR availability signal was found.", [], code, fetched_url)


def parse_source(url: str) -> Signal:
    kind = source_kind(url)
    if kind == "zumper":
        return parse_zumper(url)
    if kind == "hotpads":
        return parse_hotpads(url)
    if kind == "rent":
        return parse_rent(url)
    if kind == "apartmenthomeliving":
        return parse_apartmenthomeliving(url)
    return Signal(kind.title(), url, "needs_manual", "needs-confirmation", "Source is not an availability source.", [])


def overall_from_signals(signals: list[Signal]) -> tuple[str, str, str, list[dict[str, Any]]]:
    if not signals:
        return "needs_manual", "needs-confirmation", "No availability source was accessible for this row.", []
    status_order = {
        "available_now": 0,
        "future_availability": 1,
        "active_no_date": 2,
        "contact_for_availability": 3,
        "needs_manual": 4,
        "unavailable_or_stale": 5,
    }
    ranked = sorted(signals, key=lambda s: status_order.get(s.status, 99))
    best = ranked[0]
    if any(s.status == "available_now" for s in signals):
        best = next(s for s in ranked if s.status == "available_now")
    elif any(s.status == "future_availability" for s in signals):
        # choose earliest date among future units if possible
        futures = [s for s in signals if s.status == "future_availability"]
        def earliest(sig: Signal) -> str:
            dates = [u.get("availabilityDate") for u in sig.units if u.get("availabilityDate")]
            return min(dates) if dates else "9999-12-31"
        best = sorted(futures, key=earliest)[0]
    units = []
    for sig in signals:
        for unit in sig.units:
            u = dict(unit)
            u["source"] = sig.source
            u["url"] = sig.url
            units.append(u)
    return best.status, best.moveInTodaySignal, best.summary, units


def review_lookup(top_data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for item in top_data.get("rankings", []):
        out[str(item.get("listingId"))] = {
            "rank": item.get("rank"),
            "score": item.get("score"),
            "headline": item.get("headline"),
            "summary": item.get("reviewSummary"),
            "tier": review_tier_from_item(item),
        }
    return out


def review_tier_from_item(item: dict[str, Any]) -> str:
    summary = (item.get("reviewSummary") or "").lower()
    if item.get("score", 0) >= 85 and ("veryapt" in summary or "review" in summary):
        return "strong-specific"
    if "mixed" in summary or "management" in summary or "wiseman" in summary:
        return "mixed-or-manager-wide"
    if "no independent" in summary or "not fully accessible" in summary:
        return "thin"
    if "review" in summary:
        return "some-specific"
    return "thin"


def derived_review(listing: dict[str, Any], top_reviews: dict[str, dict[str, Any]]) -> dict[str, Any]:
    lid = str(listing.get("id"))
    if lid in top_reviews:
        return top_reviews[lid]
    name = (listing.get("name") or "").lower()
    notes = (listing.get("source_notes") or "").lower()
    if "wiseman" in name or "wiseman" in notes:
        return {"rank": None, "score": 52, "headline": "Manager-wide review caution", "summary": WISSEMAN_REVIEW, "tier": "mixed-or-manager-wide"}
    if "veryapt" in notes:
        return {"rank": None, "score": 72, "headline": "Some building-specific review evidence", "summary": listing.get("source_notes"), "tier": "some-specific"}
    if "apartmentratings" in notes or "birdeye" in notes:
        return {"rank": None, "score": 62, "headline": "Review lead exists; manual read recommended", "summary": listing.get("source_notes"), "tier": "some-specific"}
    return {"rank": None, "score": 45, "headline": "Review-light", "summary": MANUAL_REVIEW, "tier": "thin"}


def disposition(status: str, move_signal: str, review: dict[str, Any], listing: dict[str, Any]) -> str:
    tier = review.get("tier")
    if status == "available_now" and tier in {"strong-specific", "some-specific"}:
        return "tour-first"
    if status == "available_now" and tier == "mixed-or-manager-wide":
        return "available-but-review-caution"
    if status == "available_now":
        return "available-review-light"
    if status == "future_availability" and tier in {"strong-specific", "some-specific"}:
        return "waitlist-or-future-tour"
    if status in {"active_no_date", "contact_for_availability"} and tier in {"strong-specific", "some-specific"}:
        return "call-to-confirm"
    if status in {"unavailable_or_stale"}:
        return "likely-stale"
    return "backup-or-manual-check"


def main() -> int:
    app = load_json(APP_DATA)
    top = load_json(TOP_PICKS)
    top_reviews = review_lookup(top)
    candidates = [
        l for l in app.get("listings", [])
        if l.get("min_price") is not None
        and STRICT_MIN <= int(l.get("min_price")) <= STRICT_MAX
        and not l.get("co_living_or_room")
    ]

    rows: list[dict[str, Any]] = []
    for idx, listing in enumerate(candidates, 1):
        links = listing.get("links") or []
        avail_links = [u for u in links if should_fetch_for_availability(u)]
        # Prefer direct listing sources, but keep all signals.
        signals: list[Signal] = []
        for url in sorted(avail_links, key=lambda u: SOURCE_PRIORITY.get(source_kind(u), 99)):
            sig = parse_source(url)
            signals.append(sig)
        status, move_signal, summary, units = overall_from_signals(signals)
        review = derived_review(listing, top_reviews)
        row = {
            "id": str(listing.get("id")),
            "name": listing.get("name"),
            "section": listing.get("section"),
            "address": listing.get("address_raw") or listing.get("address"),
            "rent": listing.get("rent"),
            "minPrice": listing.get("min_price"),
            "bedsBaths": listing.get("beds_baths"),
            "sourceNotes": listing.get("source_notes"),
            "links": links,
            "availabilityStatus": status,
            "moveInTodaySignal": move_signal,
            "availabilitySummary": summary,
            "availableUnits": units[:8],
            "allSignals": [asdict(s) for s in signals],
            "reviewTier": review.get("tier"),
            "reviewScore": review.get("score"),
            "reviewRank": review.get("rank"),
            "reviewHeadline": review.get("headline"),
            "reviewSummary": review.get("summary"),
            "disposition": disposition(status, move_signal, review, listing),
        }
        rows.append(row)
        print(f"[{idx:02d}/{len(candidates)}] {row['id']} {row['name']} -> {status} / {move_signal} / {row['disposition']}")

    disp_order = {
        "tour-first": 0,
        "available-but-review-caution": 1,
        "available-review-light": 2,
        "call-to-confirm": 3,
        "waitlist-or-future-tour": 4,
        "backup-or-manual-check": 5,
        "likely-stale": 6,
    }
    status_order = {
        "available_now": 0,
        "future_availability": 1,
        "active_no_date": 2,
        "contact_for_availability": 3,
        "needs_manual": 4,
        "unavailable_or_stale": 5,
    }
    rows.sort(key=lambda r: (
        disp_order.get(r["disposition"], 99),
        status_order.get(r["availabilityStatus"], 99),
        -(r.get("reviewScore") or 0),
        r.get("minPrice") or 999999,
    ))
    for i, row in enumerate(rows, 1):
        row["availabilityRank"] = i

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["availabilityStatus"]] = counts.get(row["availabilityStatus"], 0) + 1
    dispositions: dict[str, int] = {}
    for row in rows:
        dispositions[row["disposition"]] = dispositions.get(row["disposition"], 0) + 1

    out = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M PDT"),
        "checkedDate": TODAY.isoformat(),
        "budgetRange": "$4,000-$6,500",
        "strictBudgetMin": STRICT_MIN,
        "strictBudgetMax": STRICT_MAX,
        "scope": "Whole-unit 3-bedroom Sawtelle/West LA candidates from data/app-data.json whose min parsed rent is within $4,000-$6,500; adjacent 90064 entries are retained but labeled by section.",
        "moveInTodayCaveat": "A public 'Available Now' or date on/before the checked date is treated as a same-day move-in signal, not a guarantee. Leasing offices must confirm application timing, deposit, unit readiness, and keys before assuming move-in today.",
        "counts": counts,
        "dispositions": dispositions,
        "methodology": [
            "Filtered to non-co-living 3BR candidates with min_price between $4,000 and $6,500.",
            "Fetched accessible Zumper, HotPads, Rent.com, and ApartmentHomeLiving listing pages; review-only sources were not used for availability.",
            "Parsed explicit 3BR unit rows and floorplan sections for Available Now or dated availability; active pages with no date are marked call-to-confirm.",
            "Merged availability signals with review tiers from the ranked shortlist and manager/building review notes."
        ],
        "limitations": [
            "Rental pages change quickly; prices and availability can differ from the cached public page by the time you call.",
            "Public 'Available Now' does not guarantee same-day move-in; management must confirm unit readiness and approval timeline.",
            "Some portals block or partially render automated access; those are marked needs_manual/contact rather than asserted unavailable.",
            "Review tiers are an aggregation aid, not a substitute for reading recent reviews and touring."
        ],
        "listings": rows,
    }
    write_json(OUT, out)
    print(f"Wrote {OUT} ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
