"""Offline test for the poll orchestration (jobs.poll.run).

Uses injected fake sources (no network) to verify that:
  - readings from all sources land in the same store
  - a failing source is isolated: the others still run and still persist

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
from jobs.poll import run  # noqa: E402


def reading(source, metric, value, unit="aqi"):
    return make_reading(
        source=source, metric=metric, value=value, unit=unit,
        station="Test", lat=59.33, lon=18.07,
        timestamp="2026-06-02T07:00:00+00:00", raw={"v": value},
    )


class PollIsolationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "readings.jsonl"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_both_sources_land_in_same_store(self):
        sources = [
            ("waqi", lambda: [reading("waqi", "pm25", 12)]),
            ("smhi", lambda: [reading("smhi", "pm10", 15.7, unit="µg/m³"),
                              reading("smhi", "no2", 18.0, unit="µg/m³")]),
        ]
        results = run(store=self.store, sources=sources)
        self.assertTrue(results["waqi"]["ok"])
        self.assertTrue(results["smhi"]["ok"])
        self.assertEqual(results["waqi"]["count"], 1)
        self.assertEqual(results["smhi"]["count"], 2)
        self.assertEqual(self.store.count(), 3)
        sources_seen = {r["source"] for r in self.store.read_all()}
        self.assertEqual(sources_seen, {"waqi", "smhi"})

    def test_failing_source_is_isolated(self):
        def boom():
            raise RuntimeError("upstream down")

        sources = [
            ("smhi", boom),
            ("waqi", lambda: [reading("waqi", "pm25", 9)]),
        ]
        results = run(store=self.store, sources=sources)
        # SMHI failed but is recorded, not raised...
        self.assertFalse(results["smhi"]["ok"])
        self.assertIn("upstream down", results["smhi"]["error"])
        # ...and WAQI still succeeded and persisted.
        self.assertTrue(results["waqi"]["ok"])
        self.assertEqual(self.store.count(), 1)
        self.assertEqual(self.store.read_all()[0]["source"], "waqi")

    def test_other_direction_also_isolated(self):
        def boom():
            raise ValueError("token missing")

        sources = [
            ("waqi", boom),
            ("smhi", lambda: [reading("smhi", "o3", 63.2, unit="µg/m³")]),
        ]
        results = run(store=self.store, sources=sources)
        self.assertFalse(results["waqi"]["ok"])
        self.assertTrue(results["smhi"]["ok"])
        self.assertEqual(self.store.count(), 1)
        self.assertEqual(self.store.read_all()[0]["source"], "smhi")


if __name__ == "__main__":
    unittest.main(verbosity=2)
