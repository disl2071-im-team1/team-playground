"""SMHI air-quality source fetcher (Naturvårdsverket data host).

Pulls real measurement concentrations (PM10, PM2.5, NO2, O3, CO, ...) for
Stockholm stations from SMHI's 52North Series REST API. This is the national
air-quality measurement host, NOT SMHI's metobs meteorological API.

API: https://datavardluft.smhi.se/52North/api/
  /stations                  GeoJSON of all stations
  /stations/{id}?expanded=true   station with its timeseries ids
  /timeseries/{id}           object with lastValue {timestamp(ms), value}, uom

Many station entries are historical and stopped reporting years ago (e.g.
Stockholm Folkungagatan ended 2014). We select ACTIVE timeseries by checking
each timeseries' lastValue is recent, rather than trusting the station name --
a dead station's getData window returns an empty array, and its lastValue is
years stale.

Values are real instrument concentrations and are kept verbatim, including
negative noise near zero (real-time data is preliminary, not quality-reviewed).

This is the SOURCE layer: it returns plain dicts and does not touch the common
schema (see core/normalize.normalize_smhi).
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone

API_BASE = "https://datavardluft.smhi.se/52North/api"

# How recent a timeseries' lastValue must be to count as active. Hourly data can
# lag a little when preliminary, so a day's grace keeps live stations while still
# excluding ones dead for months/years.
DEFAULT_MAX_AGE_HOURS = 24


def _get(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_stations():
    """All stations as GeoJSON features."""
    return _get(f"{API_BASE}/stations")


def fetch_timeseries(ts_id):
    """One timeseries object (includes lastValue, uom, station, phenomenon)."""
    return _get(f"{API_BASE}/timeseries/{ts_id}")


def discover_timeseries(name_match="Stockholm"):
    """Return the timeseries objects for stations whose label matches name_match.

    Network-heavy (stations -> expand each -> fetch each timeseries); intended
    for the hourly poll. Activeness is decided later by parse_active().
    """
    stations = fetch_stations()
    matched = [
        s for s in stations
        if name_match.lower() in (s.get("properties", {}).get("label", "")).lower()
    ]
    objects = []
    seen = set()
    for s in matched:
        expanded = _get(f"{API_BASE}/stations/{s['id']}?expanded=true")
        for ts_id in (expanded.get("properties", {}).get("timeseries", {}) or {}):
            if ts_id in seen:
                continue
            seen.add(ts_id)
            objects.append(fetch_timeseries(ts_id))
    return objects


def parse_active(timeseries_objects, now=None, max_age_hours=DEFAULT_MAX_AGE_HOURS):
    """Filter to active timeseries and flatten each into one reading dict.

    Active == lastValue exists and its timestamp is within max_age_hours of now.
    `now` is injectable (aware datetime) so this is deterministic in tests.

    Returned dicts are source-shaped (not the common schema):
        ts_id, phenomenon, value, uom, station, lat, lon, timestamp_ms
    """
    now = now or datetime.now(timezone.utc)
    cutoff_ms = (now.timestamp() - max_age_hours * 3600) * 1000

    readings = []
    for obj in timeseries_objects:
        last = obj.get("lastValue") or {}
        ts_ms = last.get("timestamp")
        if ts_ms is None or ts_ms < cutoff_ms:
            continue  # missing or stale -> dead station, skip

        station = obj.get("station", {}) or {}
        coords = (station.get("geometry", {}) or {}).get("coordinates") or [None, None]
        lon, lat = (list(coords) + [None, None])[:2]
        phenomenon = (
            (obj.get("parameters", {}) or {}).get("phenomenon", {}) or {}
        ).get("label")

        readings.append(
            {
                "ts_id": obj.get("id"),
                "phenomenon": phenomenon,
                "value": last.get("value"),  # kept verbatim, negatives included
                "uom": obj.get("uom"),
                "station": (station.get("properties", {}) or {}).get("label"),
                "lat": lat,
                "lon": lon,
                "timestamp_ms": ts_ms,
            }
        )
    return readings


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "Stockholm"
    objects = discover_timeseries(name)
    active = parse_active(objects)
    print(f"# {name}: {len(objects)} timeseries, {len(active)} active")
    print(json.dumps(active, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
