"""Offline test for the CAMS normalizer.

Runs against a captured real CAMS forecast grid (tests/fixtures/cams_points.json,
a 3x5 cell box over Stockholm x 4 species = 60 points, produced by
sources.cams.parse_grid). It imports only core.normalize and the fixture, so it
needs neither network, ADS credentials, nor the cdsapi/netCDF4 dependencies.

Asserts the modelled-forecast schema honesty: provenance=modelled, station=None
(not a faked station), µg/m³ units, value pass-through, UTC timestamps, and the
grid metadata kept in raw.
"""

import json
import os
import sys
import unittest
from collections import Counter

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from core.normalize import normalize_cams  # noqa: E402
from core.schema import Reading, CATEGORY_POLLUTANT, PROVENANCE_MODELLED  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "cams_points.json")

CONTRACT_FIELDS = {
    "source", "metric", "value", "unit",
    "station", "lat", "lon", "timestamp", "category", "provenance", "raw",
}


def load_points():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


class NormalizeCamsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.points = load_points()
        cls.readings = normalize_cams(cls.points)

    def test_one_reading_per_point(self):
        self.assertEqual(len(self.readings), len(self.points))
        self.assertGreater(len(self.readings), 0)

    def test_contract_fields_and_source(self):
        for r in self.readings:
            self.assertIsInstance(r, Reading)
            self.assertEqual(set(r.to_dict().keys()), CONTRACT_FIELDS)
            self.assertEqual(r.source, "cams")

    def test_modelled_provenance_and_null_station(self):
        # The whole point: CAMS is modelled, and not a station.
        self.assertTrue(all(r.provenance == PROVENANCE_MODELLED for r in self.readings))
        self.assertTrue(all(r.station is None for r in self.readings))

    def test_concentration_units_ugm3(self):
        self.assertTrue(all(r.unit == "µg/m³" for r in self.readings))

    def test_species_map_to_canonical_metrics(self):
        counts = Counter(r.metric for r in self.readings)
        # Fixture is 4 species x 15 cells.
        self.assertEqual(set(counts), {"pm25", "pm10", "no2", "o3"})
        for m in ("pm25", "pm10", "no2", "o3"):
            self.assertEqual(counts[m], 15, m)
        for r in self.readings:
            self.assertEqual(r.category, CATEGORY_POLLUTANT)

    def test_values_passed_through_verbatim(self):
        for r in self.readings:
            self.assertIsInstance(r.value, float)
            self.assertEqual(r.value, r.raw["value"])  # no mangling

    def test_timestamps_are_utc_iso(self):
        for r in self.readings:
            self.assertTrue(r.timestamp.endswith("+00:00"), r.timestamp)
            self.assertEqual(r.timestamp, r.raw["valid_time"])

    def test_grid_metadata_kept_in_raw(self):
        for r in self.readings:
            self.assertEqual(r.raw["resolution_deg"], 0.1)
            self.assertEqual(len(r.raw["cell_bbox"]), 4)
            self.assertIn("base_time", r.raw)
            self.assertIn("leadtime_hour", r.raw)
        # lat/lon are the grid-cell centre, inside the cell bbox.
        r = self.readings[0]
        s, w, n, e = r.raw["cell_bbox"]
        self.assertTrue(s <= r.lat <= n and w <= r.lon <= e)


if __name__ == "__main__":
    unittest.main(verbosity=2)
