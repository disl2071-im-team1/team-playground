"""Offline test for normalize_waqi.

Feeds the captured WAQI fixture through parse_station -> normalize_waqi and
asserts the result matches the common schema, that pollutant vs weather
readings are separable, units are correct, and the timestamp is in UTC.

Run:
    python3 -m unittest discover -s tests
    pytest tests/
"""

import json
import os
import sys
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sources.waqi import parse_station  # noqa: E402
from core.normalize import normalize_waqi, split_by_category  # noqa: E402
from core.schema import Reading, CATEGORY_POLLUTANT, CATEGORY_WEATHER  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "waqi_station.json")

CONTRACT_FIELDS = {
    "source", "metric", "value", "unit",
    "station", "lat", "lon", "timestamp", "category", "provenance", "raw",
}


def load_readings():
    with open(FIXTURE, encoding="utf-8") as f:
        payload = json.load(f)
    parsed = parse_station(payload["data"])
    return normalize_waqi(parsed)


class NormalizeWaqiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.readings = load_readings()
        cls.by_metric = {r.metric: r for r in cls.readings}

    def test_all_are_readings_with_contract_fields(self):
        for r in self.readings:
            self.assertIsInstance(r, Reading)
            self.assertEqual(set(r.to_dict().keys()), CONTRACT_FIELDS)

    def test_source_is_waqi(self):
        for r in self.readings:
            self.assertEqual(r.source, "waqi")

    def test_pollutants_use_aqi_unit_and_category(self):
        for m in ("pm25", "pm10", "no2", "o3", "so2", "co"):
            r = self.by_metric[m]
            self.assertEqual(r.unit, "aqi", f"{m} unit")
            self.assertEqual(r.category, CATEGORY_POLLUTANT, f"{m} category")
        self.assertEqual(self.by_metric["pm25"].value, 132)
        self.assertEqual(self.by_metric["no2"].value, 9.2)

    def test_weather_kept_and_tagged_with_real_units(self):
        # WAQI codes h/p/t/w -> readable metrics, tagged weather, not dropped.
        expected = {
            "humidity": ("%", 43),
            "pressure": ("hPa", 1003),
            "temperature": ("°C", 33.5),
            "wind": ("m/s", 1.5),
        }
        for metric, (unit, value) in expected.items():
            r = self.by_metric[metric]
            self.assertEqual(r.unit, unit, f"{metric} unit")
            self.assertEqual(r.value, value, f"{metric} value")
            self.assertEqual(r.category, CATEGORY_WEATHER, f"{metric} category")

    def test_pollutant_and_weather_are_separable(self):
        pollutants, weather, other = split_by_category(self.readings)
        self.assertEqual(len(pollutants), 6)
        self.assertEqual(len(weather), 4)
        self.assertEqual(len(other), 0)

    def test_timestamp_converted_to_utc(self):
        # Fixture is +08:00 (Shanghai). Contract requires UTC.
        self.assertEqual(
            self.by_metric["pm25"].timestamp, "2026-06-02T07:00:00+00:00"
        )

    def test_raw_payload_preserved(self):
        raw = self.by_metric["pm25"].raw
        self.assertEqual(raw["metric"], "pm25")
        self.assertEqual(raw["value"], 132)


if __name__ == "__main__":
    unittest.main(verbosity=2)
