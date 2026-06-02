"""luftdaten.se / Sensor.Community source fetcher.

Citizen/community air-quality sensors. The legacy api.luftdaten.info endpoint
redirects to data.sensor.community. We use the area filter to get recent
measurements (last ~5 min) around a point.

API: https://data.sensor.community/airrohr/v1/filter/area=<lat>,<lon>,<km>
  Returns a JSON array of measurement records. Each record has:
    sensordatavalues: [{value_type, value(string)}, ...]  P1=PM10, P2=PM2.5,
                      plus temperature/humidity/pressure on some sensors
    sensor:   {id, sensor_type, pin}
    location: {latitude, longitude, indoor(0/1), ...}
    timestamp: naive "YYYY-MM-DD HH:MM:SS" -- this is UTC

These are hobbyist sensors: noisier and less reliable than SMHI or WAQI. We
filter to OUTDOOR sensors only (indoor == 0); indoor readings are not outdoor
air quality at all. We keep all records, including the duplicate-per-sensor
entries the API returns -- the append-only store tolerates that and consumers
can collapse at read time.

This is the SOURCE layer: it returns plain dicts and does not touch the common
schema (see core/normalize.normalize_luftdaten).
"""

import json
import sys
import urllib.request

API_BASE = "https://data.sensor.community/airrohr/v1/filter"

# Central Stockholm, 8 km radius.
DEFAULT_AREA = (59.33, 18.06, 8)


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_area(lat, lon, km):
    """Fetch recent measurements within km of (lat, lon)."""
    url = f"{API_BASE}/area={lat},{lon},{km}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_outdoor(records):
    """Flatten outdoor records into per-value reading dicts.

    Keeps every value of every OUTDOOR record (indoor == 0), including
    duplicate-per-sensor entries. Source-shaped output (not the schema):
        sensor_id, value_type, value (float), value_raw (str),
        lat, lon, timestamp, record_id, sensor_type
    """
    readings = []
    for rec in records:
        loc = rec.get("location") or {}
        if loc.get("indoor") != 0:
            continue  # outdoor only

        sensor = rec.get("sensor") or {}
        sensor_id = sensor.get("id")
        lat = _to_float(loc.get("latitude"))
        lon = _to_float(loc.get("longitude"))
        timestamp = rec.get("timestamp")
        sensor_type = (sensor.get("sensor_type") or {}).get("name")

        for sv in rec.get("sensordatavalues") or []:
            value = _to_float(sv.get("value"))
            if value is None:
                continue
            readings.append(
                {
                    "sensor_id": sensor_id,
                    "value_type": sv.get("value_type"),
                    "value": value,
                    "value_raw": sv.get("value"),
                    "lat": lat,
                    "lon": lon,
                    "timestamp": timestamp,
                    "record_id": rec.get("id"),
                    "sensor_type": sensor_type,
                }
            )
    return readings


def main():
    lat, lon, km = DEFAULT_AREA
    if len(sys.argv) == 4:
        lat, lon, km = sys.argv[1], sys.argv[2], sys.argv[3]
    records = fetch_area(lat, lon, km)
    readings = parse_outdoor(records)
    print(f"# area={lat},{lon},{km}: {len(records)} records -> {len(readings)} outdoor value(s)")
    print(json.dumps(readings, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
