"""Poll job: fetch WAQI -> normalize -> append to the store.

One pass of the pipeline. A scheduler (e.g. GitHub Actions cron) can call this
on an interval later; for now it's runnable by hand:

    python3 jobs/poll.py                 # default station keyword: stockholm
    python3 jobs/poll.py "stockholm-hornsgatan"

Token: reads WAQI_TOKEN from the environment, falling back to a .env.local file
in the project root (so a manual run needs no extra setup).
"""

import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from sources.waqi import fetch_station, parse_station  # noqa: E402
from core.normalize import normalize_waqi, split_by_category  # noqa: E402
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
            key, value = key.strip(), value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def run(keyword="stockholm", store=None):
    """Fetch one station, normalize, append. Returns the appended Readings."""
    store = store or Store(DEFAULT_PATH)
    data = fetch_station(keyword)
    readings = normalize_waqi(parse_station(data))
    store.append(readings)
    return data, readings


def main():
    load_env_local()
    keyword = sys.argv[1] if len(sys.argv) > 1 else "stockholm"
    store = Store(DEFAULT_PATH)

    before = store.count()
    data, readings = run(keyword, store=store)
    after = store.count()

    station = (data.get("city", {}) or {}).get("name")
    observed = (data.get("time", {}) or {}).get("iso")
    pollutants, weather, other = split_by_category(readings)

    print(f"station : {station} (uid {data.get('idx')})")
    print(f"observed: {observed}")
    print(f"store   : {store.path}")
    print(f"appended: {len(readings)} reading(s)  (store {before} -> {after})")
    print(f"pollutants ({len(pollutants)}):")
    for r in pollutants:
        print(f"  {r.metric:<6} {r.value:>6} {r.unit:<5} @ {r.timestamp}")
    print(f"weather ({len(weather)}):")
    for r in weather:
        print(f"  {r.metric:<12} {r.value:>6} {r.unit}")
    if other:
        print(f"other ({len(other)}): {', '.join(r.metric for r in other)}")


if __name__ == "__main__":
    main()
