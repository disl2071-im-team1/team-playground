"""Offline test for the append-only JSONL store.

Appends real readings (normalized from the WAQI fixture) to a temp file,
reads them back, and verifies round-trip fidelity and the append-only
guarantee (a second append adds to history, never overwrites it).

Run:
    python3 -m unittest discover -s tests
    pytest tests/
"""

import json
import os
import sys
import tempfile
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sources.waqi import parse_station  # noqa: E402
from core.normalize import normalize_waqi  # noqa: E402
from core.store import Store  # noqa: E402
from core.schema import Reading, make_reading  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "waqi_station.json")


def fixture_readings():
    with open(FIXTURE, encoding="utf-8") as f:
        payload = json.load(f)
    return normalize_waqi(parse_station(payload["data"]))


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "nested", "readings.jsonl")
        self.store = Store(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_empty_when_missing(self):
        self.assertEqual(self.store.read_all(), [])
        self.assertEqual(self.store.count(), 0)

    def test_append_creates_parent_dirs(self):
        self.store.append(fixture_readings())
        self.assertTrue(os.path.exists(self.path))

    def test_roundtrip_preserves_contract(self):
        readings = fixture_readings()
        written = self.store.append(readings)
        self.assertEqual(written, len(readings))

        back = self.store.read_all()
        self.assertEqual(len(back), len(readings))
        # Every stored row matches the reading's dict form exactly, in order.
        for original, stored in zip(readings, back):
            self.assertEqual(stored, original.to_dict())

    def test_read_readings_reconstructs_objects(self):
        readings = fixture_readings()
        self.store.append(readings)
        rebuilt = self.store.read_readings()
        self.assertTrue(all(isinstance(r, Reading) for r in rebuilt))
        self.assertEqual(
            [r.to_dict() for r in rebuilt],
            [r.to_dict() for r in readings],
        )

    def test_append_is_additive_not_overwriting(self):
        batch1 = fixture_readings()
        batch2 = [
            make_reading(
                source="waqi", metric="pm25", value=7, unit="aqi",
                station="Test", lat=59.33, lon=18.07,
                timestamp="2026-06-02T08:00:00+00:00", raw={"v": 7},
            )
        ]
        self.store.append(batch1)
        self.store.append(batch2)
        # History grows; nothing from batch1 is lost or rewritten.
        self.assertEqual(self.store.count(), len(batch1) + len(batch2))
        back = self.store.read_all()
        self.assertEqual(back[: len(batch1)], [r.to_dict() for r in batch1])
        self.assertEqual(back[-1], batch2[0].to_dict())

    def test_append_empty_is_noop(self):
        self.assertEqual(self.store.append([]), 0)
        self.assertEqual(self.store.count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
