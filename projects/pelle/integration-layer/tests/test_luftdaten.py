"""Offline test for the luftdaten source + normalizer.

Runs against a captured area-filter response (Stockholm, mix of outdoor and
indoor sensors) and asserts: indoor sensors are filtered out, all outdoor
values are kept (including duplicate-per-sensor), string values become floats,
P1/P2 map to pm10/pm25 in µg/m³, weather fields are split off by category,
station is the sensor id, and naive timestamps become UTC ISO.

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

from sources.luftdaten import parse_outdoor  # noqa: E402
from core.normalize import normalize_luftdaten, split_by_category  # noqa: E402
from core.schema import Reading, CATEGORY_POLLUTANT, CATEGORY_WEATHER  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "luftdaten_area.json")

# Indoor sensor ids present in the captured fixture; must never appear.
INDOOR_IDS = {43909, 43911, 43913, 43915}

CONTRACT_FIELDS = {
    "source", "metric", "value", "unit",
    "station", "lat", "lon", "timestamp", "category", "provenance", "raw",
}


def load_records():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


class LuftdatenTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = load_records()
        cls.parsed = parse_outdoor(cls.records)
        cls.readings = normalize_luftdaten(cls.parsed)

    def test_indoor_filtered_out(self):
        for st in (f"luftdaten-{i}" for i in INDOOR_IDS):
            self.assertFalse(any(r.station == st for r in self.readings), st)

    def test_keeps_all_outdoor_values_including_duplicates(self):
        # Expected count = every value of every outdoor record (parseable).
        expected = sum(
            1
            for rec in self.records
            if (rec.get("location") or {}).get("indoor") == 0
            for sv in (rec.get("sensordatavalues") or [])
            if sv.get("value") not in (None, "")
        )
        self.assertEqual(len(self.readings), expected)
        self.assertGreater(expected, 0)
        # A duplicated outdoor sensor (17650 appears twice) yields 2 pm10 readings.
        pm10_17650 = [
            r for r in self.readings
            if r.station == "luftdaten-17650" and r.metric == "pm10"
        ]
        self.assertEqual(len(pm10_17650), 2)

    def test_contract_and_source(self):
        for r in self.readings:
            self.assertIsInstance(r, Reading)
            self.assertEqual(set(r.to_dict().keys()), CONTRACT_FIELDS)
            self.assertEqual(r.source, "luftdaten")

    def test_p1_p2_map_to_pm_in_ugm3(self):
        pm = [r for r in self.readings if r.metric in ("pm10", "pm25")]
        self.assertTrue(pm)
        for r in pm:
            self.assertEqual(r.unit, "µg/m³")
            self.assertEqual(r.category, CATEGORY_POLLUTANT)
            self.assertIsInstance(r.value, float)
        # Anchor: sensor 17650 has a P1 (PM10) reading of 2.97.
        vals = {
            r.value for r in self.readings
            if r.station == "luftdaten-17650" and r.metric == "pm10"
        }
        self.assertIn(2.97, vals)

    def test_weather_split_by_category(self):
        pollutants, weather, other = split_by_category(self.readings)
        self.assertTrue(all(r.metric in ("pm10", "pm25") for r in pollutants))
        # temperature/humidity/pressure are weather; pressure_at_sealevel -> other
        self.assertTrue(any(r.metric == "temperature" for r in weather))
        for r in weather:
            self.assertEqual(r.category, CATEGORY_WEATHER)

    def test_value_parsed_to_float_raw_preserved(self):
        sample = next(r for r in self.readings if r.metric == "pm10")
        self.assertIsInstance(sample.value, float)
        self.assertIsInstance(sample.raw["value_raw"], str)  # original string kept

    def test_naive_timestamp_to_utc_iso(self):
        for r in self.readings:
            self.assertTrue(r.timestamp.endswith("+00:00"), r.timestamp)
            self.assertIn("T", r.timestamp)


if __name__ == "__main__":
    unittest.main(verbosity=2)
