# Stockholm air-quality integration layer

Collects Stockholm air-quality data from three sources (**WAQI**, **SMHI**, and
**luftdaten/Sensor.Community**), normalizes every reading into one common schema,
and stores it append-only over time. An hourly job polls all three sources; a
small read API serves the stored readings. Pure Python, standard library only
(Python 3.9+), no dependencies.

---

## Reading the data

The read path is `api/serve.py`. It serves whatever is in the local store file
(`data/readings.jsonl`). To serve the accumulated history, run it from a checkout
of the `data` branch (see [Where the data lives](#where-the-data-lives)); to
serve a local poll's output, run it after a poll.

### Run the server

```bash
cd projects/pelle/integration-layer
python3 api/serve.py        # serves on http://127.0.0.1:8000/readings
```

### Endpoint

`GET /readings` — returns stored readings, **newest first**. Query params (all
optional, combined with AND):

| Param | Meaning |
|-------|---------|
| `metric` | Exact match on the canonical metric name (e.g. `pm25`, `pm10`, `no2`). |
| `station` | Case-insensitive **substring** of the station field. Note WAQI/SMHI stations are human names containing "Stockholm"; luftdaten stations are `luftdaten-<sensorid>`. |
| `since` | ISO-8601 timestamp; keep readings at or after this instant. |
| `limit` | Cap the number returned (applied after the newest-first sort). |

### Example

```bash
curl 'http://127.0.0.1:8000/readings?metric=pm25&station=stockholm&limit=1'
```

Response shape — `{ "count": N, "readings": [ <reading>, ... ] }`:

```json
{
  "count": 1,
  "readings": [
    {
      "source": "waqi",
      "metric": "pm25",
      "value": 3,
      "unit": "aqi",
      "station": "Stockholm Sveavägen 59 Gata, Sweden",
      "lat": 59.3408,
      "lon": 18.0583,
      "timestamp": "2026-06-02T07:00:00+00:00",
      "category": "pollutant",
      "raw": { "metric": "pm25", "value": 3, "station": "Stockholm Sveavägen 59 Gata, Sweden", "uid": 10011, "dominant": "pm25" }
    }
  ]
}
```

`raw` is the untouched source-specific payload for that reading; its inner shape
differs per source.

### From Python instead of HTTP

`get_readings()` is the same query as a function (no server needed):

```python
from api.serve import get_readings
rows = get_readings(metric="pm10", station="stockholm", since="2026-06-02T00:00:00+00:00", limit=50)
```

---

## The reading schema

Every reading from every source is normalized to these fields (defined in
`core/schema.py`):

| Field | Meaning |
|-------|---------|
| `source` | Which fetcher produced it: `waqi`, `smhi`, or `luftdaten`. |
| `metric` | Canonical metric name, e.g. `pm25`, `pm10`, `no2`, `o3`, `co`, `temperature`. |
| `value` | The numeric reading. Kept verbatim from the instrument, including negatives. |
| `unit` | Unit of `value`. See the warning below — this is critical. |
| `station` | Station name/id. |
| `lat`, `lon` | Coordinates (may be null). |
| `timestamp` | Observation time, UTC ISO-8601 (e.g. `2026-06-02T07:00:00+00:00`). |
| `category` | `pollutant`, `weather`, or `other`. Lets you filter non-pollutant readings out. |
| `raw` | The untouched source payload for this reading. |

### ⚠️ Values are NOT comparable across sources without checking `unit`

The same `metric` can carry different units depending on the `source`:

- **WAQI** pollutant values are **AQI sub-indices** (`unit: "aqi"`), not
  concentrations.
- **SMHI** and **luftdaten** are **real concentrations**: `unit: "µg/m³"`
  (and **`mg/m³` for CO**).

A `pm25` value of `3` from WAQI (`aqi`) and `3.3` from SMHI (`µg/m³`) are
different quantities. Always read `unit` before comparing or aggregating, and do
not mix sources without converting. The `category` field also lets you drop
weather readings (WAQI carries `%`, `hPa`, `°C`, `m/s`; luftdaten carries `°C`,
`%`, `Pa`).

---

## Where the data lives

- **Append-only JSONL store.** One JSON object per line. The store
  (`core/store.py`) only ever appends — there is no update or delete; history is
  the point. Default file: `data/readings.jsonl` (gitignored locally).
- **Hourly poll → `data` branch.** `.github/workflows/poll-stockholm-air.yml`
  runs `jobs/poll.py` hourly. Because Actions runners are ephemeral, each run
  seeds the prior record from a dedicated **`data` branch**, appends, and commits
  the updated `data/readings.jsonl` back to `data` only. **`main` is never
  written to by the job** — it stays clean and PR-governed.
- **To read accumulated history**, check out the `data` branch and look at
  `data/readings.jsonl` (or run `api/serve.py` from that checkout).
- The hourly schedule only fires once the workflow is on `main` (GitHub runs
  scheduled workflows from the default branch). The WAQI token is a repo Actions
  secret (`WAQI_TOKEN`), never committed.

### Running the poll yourself

```bash
cd projects/pelle/integration-layer
python3 jobs/poll.py        # fetches all sources, appends to data/readings.jsonl
```

WAQI needs a token: set `WAQI_TOKEN` in the environment or in a project-root
`.env.local` file (gitignored). SMHI and luftdaten need no token. Sources are
isolated: if one fails, the others still run and still persist.

### Tests

```bash
cd projects/pelle/integration-layer
python3 -m unittest discover -s tests
```

All tests run offline against captured fixtures (no token, no network).

---

## Adding a new source

Follow the pattern the three existing sources use. Take any of
`sources/waqi.py`, `sources/smhi.py`, `sources/luftdaten.py` as a template.

1. **Source fetcher** — `sources/<name>.py`. A function that fetches from the
   external API and a parse function that returns plain source-shaped dicts. The
   source layer knows the API's quirks and does **not** touch the schema.

2. **Normalizer** — add `normalize_<name>()` to `core/normalize.py`. Map each
   source field to a canonical `metric` and a correct `unit`, then build readings
   with `core.schema.make_reading(...)`, which centralizes UTC timestamp
   conversion and category derivation. Define a metric/unit map (see
   `WAQI_METRIC_MAP`, `SMHI_PHENOMENON_MAP`, `LUFTDATEN_METRIC_MAP`). Keep
   instrument values verbatim and pass the source record as `raw`. Unknown
   metrics fall through to a lowercased label with `category="other"` rather than
   being dropped.

3. **Offline test** — capture one real response into `tests/fixtures/` and add
   `tests/test_<name>.py` that feeds the fixture through parse → normalize and
   asserts the contract fields, units, timestamps, and any source-specific
   filtering. No network or token in the test.

4. **Wire into the poll** — in `jobs/poll.py`, add a `poll_<name>()` that chains
   fetch → parse → normalize, and add `("<name>", poll_<name>)` to
   `default_sources()`. Failure isolation and the hourly workflow then cover it
   automatically (the workflow calls `poll.py` with no arguments).

The schema is the contract between sources and consumers — see
[`CLAUDE.md`](./CLAUDE.md) for the design rules (especially "The common schema is
the contract").
