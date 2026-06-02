"""Offline test for the read path (api.serve.get_readings).

Builds a small store with crafted readings across two stations, metrics,
and timestamps, then exercises the metric / station / since / limit filters
and newest-first ordering. No network, no token.

Run:
    python3 -m unittest discover -s tests
    pytest tests/
"""

import os
import sys
import tempfile
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from core.store import Store  # noqa: E402
from core.schema import make_reading  # noqa: E402
from api.serve import get_readings  # noqa: E402

SVEA = "Stockholm Sveavägen 59 Gata, Sweden"
HORN = "Stockholm Hornsgatan, Sweden"


def reading(metric, value, station, ts, unit="aqi"):
    return make_reading(
        source="waqi", metric=metric, value=value, unit=unit,
        station=station, lat=59.33, lon=18.06, timestamp=ts, raw={"v": value},
    )


class GetReadingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "readings.jsonl"))
        # Two hours, two stations, a few metrics.
        self.store.append([
            reading("pm25", 10, SVEA, "2026-06-02T06:00:00+00:00"),  # old
            reading("no2", 5, SVEA, "2026-06-02T06:00:00+00:00"),    # old
            reading("pm25", 12, SVEA, "2026-06-02T07:00:00+00:00"),  # new
            reading("pm25", 20, HORN, "2026-06-02T07:00:00+00:00"),  # new
            reading("temperature", 18, SVEA, "2026-06-02T07:00:00+00:00", unit="°C"),
        ])

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_filter_returns_all_newest_first(self):
        rows = get_readings(store=self.store)
        self.assertEqual(len(rows), 5)
        # First three are the 07:00 readings, last two are 06:00.
        self.assertTrue(all(r["timestamp"] == "2026-06-02T07:00:00+00:00" for r in rows[:3]))
        self.assertTrue(all(r["timestamp"] == "2026-06-02T06:00:00+00:00" for r in rows[3:]))

    def test_filter_by_metric(self):
        rows = get_readings(metric="pm25", store=self.store)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r["metric"] == "pm25" for r in rows))

    def test_filter_by_station_substring_case_insensitive(self):
        rows = get_readings(station="hornsgatan", store=self.store)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["station"], HORN)
        self.assertEqual(rows[0]["value"], 20)

    def test_filter_by_since(self):
        rows = get_readings(since="2026-06-02T07:00:00+00:00", store=self.store)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r["timestamp"] >= "2026-06-02T07:00:00+00:00" for r in rows))

    def test_limit_applies_after_newest_first_sort(self):
        rows = get_readings(limit=2, store=self.store)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["timestamp"] == "2026-06-02T07:00:00+00:00" for r in rows))

    def test_combined_metric_and_station(self):
        rows = get_readings(metric="pm25", station="sveavägen", store=self.store)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["metric"] == "pm25" and r["station"] == SVEA for r in rows))
        # newest first
        self.assertEqual(rows[0]["timestamp"], "2026-06-02T07:00:00+00:00")
        self.assertEqual(rows[0]["value"], 12)

    def test_empty_store_returns_empty(self):
        empty = Store(os.path.join(self.tmp.name, "none.jsonl"))
        self.assertEqual(get_readings(store=empty), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
