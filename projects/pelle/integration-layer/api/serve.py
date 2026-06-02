"""Read path: serve stored readings to the team agent.

`get_readings()` is the queryable core (filter by metric / station / since,
newest first, optional limit). A thin stdlib HTTP wrapper exposes it at
`GET /readings` so the agent can fetch JSON without importing the package.

Read-only: this layer never writes. Storage stays append-only (core/store.py).

Run the HTTP server:
    python3 api/serve.py                 # 127.0.0.1:8000
    curl 'http://127.0.0.1:8000/readings?metric=pm25&station=stockholm&limit=10'
"""

import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import List, Optional
from urllib.parse import urlparse, parse_qs

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from core.store import Store, DEFAULT_PATH  # noqa: E402


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def get_readings(
    metric: Optional[str] = None,
    station: Optional[str] = None,
    since: Optional[str] = None,
    limit: Optional[int] = None,
    store: Optional[Store] = None,
) -> List[dict]:
    """Return stored readings, newest first.

    Filters (all optional, combined with AND):
      metric   exact match on the canonical metric name (e.g. "pm25")
      station  case-insensitive substring of the station name
      since    ISO-8601 timestamp; keep readings at or after this instant
      limit    cap the number returned (after sorting newest-first)

    Timestamps are uniform UTC ISO in the store, so a string sort is
    chronological; we still parse `since` for a correct instant comparison.
    """
    store = store or Store(DEFAULT_PATH)
    rows = store.read_all()

    if metric is not None:
        rows = [r for r in rows if r.get("metric") == metric]
    if station is not None:
        needle = station.lower()
        rows = [r for r in rows if needle in (r.get("station") or "").lower()]
    if since is not None:
        since_dt = _parse_ts(since)
        rows = [
            r for r in rows
            if r.get("timestamp") and _parse_ts(r["timestamp"]) >= since_dt
        ]

    rows.sort(key=lambda r: r.get("timestamp") or "", reverse=True)

    if limit is not None:
        rows = rows[:limit]
    return rows


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/readings":
            self.send_error(404, "use /readings")
            return
        q = parse_qs(parsed.query)
        metric = q.get("metric", [None])[0]
        station = q.get("station", [None])[0]
        since = q.get("since", [None])[0]
        limit_raw = q.get("limit", [None])[0]
        try:
            limit = int(limit_raw) if limit_raw is not None else None
            rows = get_readings(metric=metric, station=station, since=since, limit=limit)
        except ValueError as e:
            self.send_error(400, f"bad request: {e}")
            return
        body = json.dumps(
            {"count": len(rows), "readings": rows}, ensure_ascii=False
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # quiet by default


def serve(host: str = "127.0.0.1", port: int = 8000):
    server = HTTPServer((host, port), _Handler)
    print(f"serving readings on http://{host}:{port}/readings")
    server.serve_forever()


if __name__ == "__main__":
    serve()
