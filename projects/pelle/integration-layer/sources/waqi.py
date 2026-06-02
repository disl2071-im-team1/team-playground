"""WAQI / AQICN source fetcher.

Fetches a single Stockholm station from the WAQI live API and parses the
response into a flat list of per-metric readings.

This is the SOURCE layer only: it knows the quirks of the WAQI API and returns
plain Python dicts. It deliberately does NOT touch the common schema or storage
yet (that mapping belongs in core/normalize.py + core/store.py later).

Token: set WAQI_TOKEN in the environment. Get a free one at
https://aqicn.org/data-platform/token/

Run:
    WAQI_TOKEN=xxxx python3 sources/waqi.py            # default station: stockholm
    WAQI_TOKEN=xxxx python3 sources/waqi.py sodermalm  # by keyword
"""

import json
import os
import sys
import urllib.request
import urllib.parse

API_BASE = "https://api.waqi.info"

# WAQI returns AQI sub-indices keyed by short codes. Map the ones we care about
# to readable metric names. Unknown codes are passed through as-is.
METRIC_NAMES = {
    "pm25": "pm25",
    "pm10": "pm10",
    "no2": "no2",
    "o3": "o3",
    "so2": "so2",
    "co": "co",
}


def fetch_station(keyword="stockholm", token=None):
    """Fetch one station's raw WAQI payload by city/keyword.

    Returns the inner `data` object from the WAQI feed response.
    Raises RuntimeError on missing token or an API-level error.
    """
    token = token or os.environ.get("WAQI_TOKEN")
    if not token:
        raise RuntimeError(
            "WAQI_TOKEN not set. Get a free token at "
            "https://aqicn.org/data-platform/token/ and export it."
        )

    url = f"{API_BASE}/feed/{urllib.parse.quote(keyword)}/?token={urllib.parse.quote(token)}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if payload.get("status") != "ok":
        raise RuntimeError(f"WAQI error: {payload.get('data')!r}")
    return payload["data"]


def parse_station(data):
    """Turn one WAQI station payload into a flat list of per-metric readings.

    Each reading is an intermediate dict (NOT the common schema):
        metric, value, station, uid, lat, lon, timestamp, dominant
    The raw per-metric value is the WAQI AQI sub-index (iaqi[code].v).
    """
    city = data.get("city", {}) or {}
    geo = city.get("geo") or [None, None]
    lat, lon = (geo + [None, None])[:2]
    timestamp = (data.get("time", {}) or {}).get("iso")
    station = city.get("name")
    uid = data.get("idx")
    dominant = data.get("dominentpol")  # WAQI's spelling

    readings = []
    iaqi = data.get("iaqi", {}) or {}
    for code, obj in iaqi.items():
        value = obj.get("v") if isinstance(obj, dict) else None
        if value is None:
            continue
        readings.append(
            {
                "metric": METRIC_NAMES.get(code, code),
                "value": value,
                "station": station,
                "uid": uid,
                "lat": lat,
                "lon": lon,
                "timestamp": timestamp,
                "dominant": dominant,
            }
        )
    return readings


def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else "stockholm"
    data = fetch_station(keyword)
    readings = parse_station(data)
    print(f"# station: {data.get('city', {}).get('name')} (uid {data.get('idx')})")
    print(f"# observed: {(data.get('time', {}) or {}).get('iso')}")
    print(f"# {len(readings)} metric reading(s)\n")
    print(json.dumps(readings, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
