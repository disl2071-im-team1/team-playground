"""Offline test for the SMHI source + normalizer.

Feeds a captured set of real SMHI timeseries objects (5 active Stockholm
stations + 1 dead one, Folkungagatan, that stopped in 2014) through
parse_active -> normalize_smhi and asserts the active filter, the schema
mapping, real concentration units, epoch-ms -> UTC conversion, and that raw
instrument values (including a negative CO reading) are preserved.

Run:
    python3 -m unittest discover -s tests
    pytest tests/
"""

import json
import os
import sys
import unittest
from datetime import datetime, timezone

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sources.smhi import parse_active  # noqa: E402
from core.normalize import normalize_smhi  # noqa: E402
from core.schema import Reading, CATEGORY_POLLUTANT  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "smhi_timeseries.json")

# The fixture's active readings are stamped 2026-06-02T07:00:00Z; "now" just
# after that keeps them active. The dead Folkungagatan one is from 2014.
NOW = datetime(2026, 6, 2, 8, 0, 0, tzinfo=timezone.utc)

CONTRACT_FIELDS = {
    "source", "metric", "value", "unit",
    "station", "lat", "lon", "timestamp", "category", "provenance", "raw",
}


def load_objects():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


class SmhiSourceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.objects = load_objects()
        cls.active = parse_active(cls.objects, now=NOW, max_age_hours=24)
        cls.readings = normalize_smhi(cls.active)
        cls.by_metric = {r.metric: r for r in cls.readings}

    def test_dead_station_filtered_out(self):
        # 6 timeseries in, the 2014 Folkungagatan one (ts 174) must be dropped.
        self.assertEqual(len(self.objects), 6)
        self.assertEqual(len(self.active), 5)
        self.assertTrue(all("Folkungagatan" not in a["station"] for a in self.active))
        self.assertNotIn("174", [a["ts_id"] for a in self.active])

    def test_all_readings_have_contract_fields(self):
        for r in self.readings:
            self.assertIsInstance(r, Reading)
            self.assertEqual(set(r.to_dict().keys()), CONTRACT_FIELDS)
            self.assertEqual(r.source, "smhi")

    def test_concentration_units_real_not_aqi(self):
        # PM10/PM2.5/NO2/O3 in µg/m³, CO in mg/m³.
        for m in ("pm10", "pm25", "no2", "o3"):
            self.assertEqual(self.by_metric[m].unit, "µg/m³", f"{m} unit")
        self.assertEqual(self.by_metric["co"].unit, "mg/m³")

    def test_metric_mapping_and_category(self):
        self.assertEqual(self.by_metric["pm10"].value, 15.769)
        self.assertEqual(self.by_metric["pm25"].value, 3.342)
        self.assertEqual(self.by_metric["no2"].value, 17.997)
        self.assertEqual(self.by_metric["o3"].value, 63.215)
        for m in ("pm10", "pm25", "no2", "o3", "co"):
            self.assertEqual(self.by_metric[m].category, CATEGORY_POLLUTANT, m)

    def test_negative_value_preserved(self):
        # Real-time CO reading is negative noise; must be kept verbatim.
        co = self.by_metric["co"]
        self.assertEqual(co.value, -0.144)
        self.assertEqual(co.raw["value"], -0.144)

    def test_epoch_ms_converted_to_utc_iso(self):
        # 1780383600000 ms == 2026-06-02T07:00:00Z
        self.assertEqual(
            self.by_metric["pm10"].timestamp, "2026-06-02T07:00:00+00:00"
        )
        # raw keeps the original epoch-ms value.
        self.assertEqual(self.by_metric["pm10"].raw["timestamp_ms"], 1780383600000)

    def test_station_and_coords(self):
        pm10 = self.by_metric["pm10"]
        self.assertEqual(pm10.station, "Stockholm Sveavägen 59 Gata")
        self.assertAlmostEqual(pm10.lat, 59.3408, places=3)
        self.assertAlmostEqual(pm10.lon, 18.0583, places=3)

    def test_freshness_threshold_excludes_all_when_now_is_far_future(self):
        future = datetime(2027, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(parse_active(self.objects, now=future, max_age_hours=24), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
