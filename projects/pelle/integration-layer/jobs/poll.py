"""Poll job: fetch every source -> normalize -> append to the store.

One pass of the pipeline across all configured sources (WAQI + SMHI). Each
source is isolated: if one fails, the others still run and their readings are
still stored. A scheduler (GitHub Actions cron) calls this on an interval.

Run by hand:
    python3 jobs/poll.py

Token: reads WAQI_TOKEN from the environment, falling back to a .env.local file
in the project root (SMHI needs no token).
"""

import os
import sys
from collections import Counter

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sources.waqi import fetch_station, parse_station  # noqa: E402
from sources.smhi import discover_timeseries, parse_active  # noqa: E402
from core.normalize import normalize_waqi, normalize_smhi  # noqa: E402
from core.store import Store, DEFAULT_PATH  # noqa: E402


def load_env_local():
    """Load KEY=VALUE lines from project-root .env.local into os.environ.

    Only fills values that aren't already set, so a real environment variable
    always wins. Silently does nothing if the file is absent.
    """
    path = os.path.join(PROJECT_ROOT, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def poll_waqi():
    """Fetch + normalize the WAQI Stockholm station."""
    return normalize_waqi(parse_station(fetch_station("stockholm")))


def poll_smhi():
    """Discover + normalize active SMHI Stockholm timeseries."""
    return normalize_smhi(parse_active(discover_timeseries("Stockholm")))


def default_sources():
    """The (name, fetch-fn) pairs polled on each run."""
    return [
        ("waqi", poll_waqi),
        ("smhi", poll_smhi),
    ]


def run(store=None, sources=None):
    """Poll each source independently and append its readings to the store.

    Failures are isolated per source: an exception in one is caught and
    recorded, the others still run and still persist. Returns a results dict
    keyed by source name: {"ok": bool, "count": int} or {"ok": False, "error": str}.
    """
    store = store or Store(DEFAULT_PATH)
    sources = sources or default_sources()
    results = {}
    for name, fetch in sources:
        try:
            readings = fetch()
            written = store.append(readings)
            results[name] = {"ok": True, "count": written}
        except Exception as e:  # isolate: one source's failure must not stop others
            results[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return results


def main():
    load_env_local()
    store = Store(DEFAULT_PATH)
    before = store.count()
    results = run(store=store)
    after = store.count()

    print(f"store: {store.path}")
    for name, r in results.items():
        if r["ok"]:
            print(f"  [ok]   {name}: appended {r['count']} reading(s)")
        else:
            print(f"  [FAIL] {name}: {r['error']}")
    print(f"store total: {before} -> {after}")

    by_source = Counter(row.get("source") for row in store.read_all())
    print("readings in store by source:")
    for src, n in sorted(by_source.items()):
        print(f"  {src}: {n}")

    # Non-zero exit only if every source failed (so the cron still commits
    # whatever did land when at least one source succeeded).
    if results and all(not r["ok"] for r in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
