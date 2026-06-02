"""Append-only storage for normalized readings.

Backend: JSONL (one JSON object per line). Chosen over SQLite for now because
the contract is append-only time-series and the read path is a separate layer:

- append == a single file append; no schema, no migrations, no driver
- diffable and inspectable (fits the team's PR-review workflow)
- dependency-free (the project is stdlib-only so far)

SQLite would win once we need indexed queries, dedup on re-poll, or concurrent
writers. None of those exist yet, and the flat schema + `raw` blob make a later
JSONL -> SQLite replay straightforward. `Store` is the seam that keeps that swap
away from callers.

By design there is NO update or delete. History is the product.
"""

import json
import os
from typing import Iterable, List

from core.schema import Reading

# Default location; callers (and tests) can override with any path.
DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "readings.jsonl",
)


def _as_dict(reading) -> dict:
    """Accept either a Reading or an already-plain dict."""
    if isinstance(reading, Reading):
        return reading.to_dict()
    if isinstance(reading, dict):
        return reading
    raise TypeError(f"expected Reading or dict, got {type(reading).__name__}")


class Store:
    """Append-only JSONL store of readings."""

    def __init__(self, path: str = DEFAULT_PATH):
        self.path = path

    def append(self, readings: Iterable) -> int:
        """Append readings to the file. Returns the number written.

        Opens in 'a' mode only: existing lines are never rewritten.
        """
        readings = list(readings)
        if not readings:
            return 0
        parent = os.path.dirname(self.path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            for r in readings:
                f.write(json.dumps(_as_dict(r), ensure_ascii=False) + "\n")
        return len(readings)

    def read_all(self) -> List[dict]:
        """Read every stored reading back as a list of dicts, in order."""
        if not os.path.exists(self.path):
            return []
        rows: List[dict] = []
        with open(self.path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        return rows

    def read_readings(self) -> List[Reading]:
        """Read back as reconstructed Reading objects."""
        return [Reading(**row) for row in self.read_all()]

    def count(self) -> int:
        return len(self.read_all())
