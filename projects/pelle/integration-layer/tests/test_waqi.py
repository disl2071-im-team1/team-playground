"""Offline test for the WAQI source parser.

Runs without a token or network: it feeds a captured live response
(tests/fixtures/waqi_station.json) through parse_station and asserts the
output shape. Captured from api.waqi.info/feed/here/ (demo token -> Shanghai
sample station).

Run:
    python3 -m unittest discover -s tests        # stdlib, no deps
    pytest tests/                                 # also works under pytest
"""

import json
import os
import sys
import unittest

# Make the project root importable so `sources` resolves regardless of cwd.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sources.waqi import parse_station  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "waqi_station.json")


def load_fixture():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


class ParseStationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        payload = load_fixture()
        cls.data = payload["data"]
        cls.readings = parse_station(cls.data)
        cls.by_metric = {r["metric"]: r for r in cls.readings}

    def test_one_reading_per_iaqi_entry(self):
        # The parser should emit exactly one reading per iaqi code present.
        self.assertEqual(len(self.readings), len(self.data["iaqi"]))

    def test_each_reading_has_expected_keys(self):
        expected = {
            "metric", "value", "station", "uid",
            "lat", "lon", "timestamp", "dominant",
        }
        for r in self.readings:
            self.assertEqual(set(r.keys()), expected)

    def test_pollutant_values_passed_through(self):
        # Real values from the captured Shanghai sample.
        self.assertEqual(self.by_metric["pm25"]["value"], 132)
        self.assertEqual(self.by_metric["pm10"]["value"], 54)
        self.assertEqual(self.by_metric["no2"]["value"], 9.2)
        self.assertEqual(self.by_metric["o3"]["value"], 127.1)

    def test_station_metadata(self):
        r = self.by_metric["pm25"]
        self.assertEqual(r["station"], "Shanghai (上海)")
        self.assertEqual(r["uid"], 1437)
        self.assertEqual(r["lat"], 31.2047372)
        self.assertEqual(r["lon"], 121.4489017)
        self.assertEqual(r["dominant"], "pm25")

    def test_timestamp_is_iso_with_timezone(self):
        ts = self.by_metric["pm25"]["timestamp"]
        self.assertEqual(ts, "2026-06-02T15:00:00+08:00")

    def test_values_are_numeric(self):
        for r in self.readings:
            self.assertIsInstance(r["value"], (int, float))


if __name__ == "__main__":
    unittest.main(verbosity=2)
