# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Stockholm pollution **integration layer**: it pulls air-quality and related
open data from several external Stockholm sources, normalizes every reading into
one common schema, stores it append-only over time, and serves it to the team
agent. It is a standalone Python subproject inside the team-playground monorepo,
so it deliberately deviates from the repo's default Next.js/TypeScript stack
(allowed per the root `CLAUDE.md` for data work).

## The common schema is the contract

This is the single most important thing in the project. Every reading from every
source MUST normalize into exactly these fields:

```
source     which fetcher produced it (e.g. "waqi")
metric     canonical metric name (e.g. "pm25", "temperature")
value      the numeric reading
unit       unit of value (e.g. "aqi", "µg/m³", "°C")
station    station name/id
lat, lon   coordinates
timestamp  observation (or forecast valid) time, UTC ISO-8601 (converted from source offset)
category   pollutant | weather | other (so non-pollutant readings stay separable)
provenance measured (point instrument) | modelled (gridded forecast, e.g. CAMS)
raw        the untouched source payload for this reading
```

`station` is `None` for non-point sources: a modelled gridded source (CAMS) is
not a station, so we leave `station` null rather than inventing one, and keep the
grid cell's resolution and bounds in `raw`. `provenance` is how a consumer tells
a real measurement (SMHI/WAQI/luftdaten) apart from a model forecast (CAMS).

Notes on the two fields that aren't 1:1 with a source:

- **`unit`** is honest about the source. WAQI's `iaqi` values are AQI
  *sub-indices*, not concentrations, so WAQI pollutant readings carry
  `unit="aqi"`, not µg/m³. Weather fields carry real units (%, hPa, °C, m/s).
- **`category`** is derived from the canonical metric name (`core.schema.classify`).
  Weather readings (humidity/pressure/temperature/wind) are kept, not dropped,
  but tagged `weather` so a consumer can filter to pollution only.

A change to this shape ripples through `normalize.py`, `store.py`, `serve.py`,
and every source normalizer. Treat it as a versioned interface, not an
implementation detail.

## Architecture and data flow

```
sources/*  ──fetch──▶  core/normalize.py ──▶  core/store.py (append-only)
                              ▲                        │
                       core/schema.py                  ▼
                    (the schema above)        api/serve.py ──▶ team agent

jobs/poll.py orchestrates: fetch every source ▶ normalize ▶ store, on a schedule.
```

- `sources/` — one fetcher per external source. Each owns the quirks of its API
  and returns raw source data; it does **not** know about storage.
- `core/schema.py` — the common reading model (the contract above).
- `core/normalize.py` — maps each source's raw shape onto the schema. The
  per-source mapping logic lives here (or is called from here).
- `core/store.py` — append-only persistence. Reads are added, never mutated or
  overwritten. History is the point of the system.
- `jobs/poll.py` — the scheduled pipeline: fetch → normalize → store.
- `api/serve.py` — read path only; exposes stored data to the agent.

**Do not restructure these four directories or change their responsibilities
without asking first.** The separation (fetch / normalize / store / serve) is
the architecture, not an accident.

## Source-specific knowledge

Each source has a different access pattern; this is the non-obvious part:

- **WAQI / AQICN** — the primary live feed. REST JSON, requires a token (env
  var, see below). Provides PM2.5/PM10/NO2/O3. Note: the sibling Next.js app
  (`app/api/air-quality/route.ts`) already consumes WAQI with a `WAQI_TOKEN` env
  var and maps AQI onto a 1–10 index. Reuse the same token; keep this layer's
  normalization independent (store real values + unit, not the UI's 1–10 index).
- **dataportal.se** — a *catalog*, not a data endpoint. Two steps: search the
  catalog to find a dataset, then resolve and fetch that dataset's
  *distribution* URL. The fetcher must handle both hops.
- **ArcGIS FeatureServer** — the `query` endpoint returns GeoJSON. Public layers
  need no key. Parse features into readings.

## Hard rules

- **Append-only storage.** Never overwrite or delete past readings.
- **Token stays out of git.** WAQI token via env var only (the repo `.gitignore`
  already ignores `.env*`).
- **Every source normalizer has a test.** When adding or changing a source, add
  a test that feeds a captured raw payload through normalization and asserts the
  output matches the schema. Use small captured fixtures, not live calls, so
  tests are deterministic and offline.
- **Small commits, one concern each** (matches the team git conventions in the
  root `CLAUDE.md`).

## Scheduled collection

`jobs/poll.py` is run hourly by `.github/workflows/poll-stockholm-air.yml`.
The growing append-only record does NOT live on `main`: the workflow commits
each run's updated `data/readings.jsonl` to a dedicated `data` branch, keeping
`main` clean and PR-governed. Each run seeds the prior record from the `data`
branch, appends, and pushes back to `data` only. The WAQI token is a repo
Actions secret (`WAQI_TOKEN`), never committed. The schedule only fires once the
workflow file is on `main` (GitHub runs scheduled workflows from the default
branch).

## Toolchain

Greenfield — not yet bootstrapped. When set up, follow Python conventions:
tests with `pytest` (run all: `pytest`; single test: `pytest path::test_name`),
dependencies pinned in a `requirements.txt` or `pyproject.toml`, secrets loaded
from `.env`. Record the actual chosen commands here once the first source lands.
