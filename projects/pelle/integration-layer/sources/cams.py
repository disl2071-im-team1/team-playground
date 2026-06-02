"""CAMS (Copernicus Atmosphere Monitoring Service) source — MODELLED forecast.

Fetches the CAMS European air-quality forecast (gridded, ~0.1° ≈ 10 km) for a
Stockholm bounding box via the ADS / CDS API, and parses the NetCDF grid into
per-cell points. This is MODELLED data, not a station measurement; the normalizer
(core.normalize.normalize_cams) tags it provenance="modelled" and station=None.

Credentials come from env (never hardcoded), like WAQI's token:
  CDSAPI_URL   e.g. https://ads.atmosphere.copernicus.eu/api
  CDSAPI_KEY   your ADS personal access token

Dependencies (the project's first, see requirements.txt): cdsapi (handles the
async submit/poll/download) and netCDF4 (parses the grid). They are imported
LAZILY inside the functions so importing this module — and the test suite — does
not require them. The normalizer and its offline test never touch this module.

NOTE: the fetch + NetCDF parse below mirror the proven app/api/cams-pm25 route,
but have not yet been validated against live CAMS data (pending ADS credentials).
The NetCDF variable names in particular should be confirmed on first real run.
"""

import os
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone

DATASET = "cams-europe-air-quality-forecasts"
# Stockholm bounding box [north, west, south, east].
AREA = [59.5, 17.8, 59.2, 18.3]
RESOLUTION_DEG = 0.1
# ADS request variables.
VARIABLES = [
    "particulate_matter_2.5um",
    "particulate_matter_10um",
    "nitrogen_dioxide",
    "ozone",
]
_COORD_NAMES = {"latitude", "longitude", "time", "level", "lat", "lon"}


def current_base_date():
    """Today's UTC date (yyyy-mm-dd) — the CAMS forecast base date."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _species_for(var_name):
    """Map a NetCDF variable name to a species key the normalizer understands.

    Substring match (mirrors the existing TS route), since CAMS NetCDF short
    names vary (e.g. pm2p5, pm2p5_conc).
    """
    n = var_name.lower()
    if "pm2" in n:
        return "pm2p5"
    if "pm10" in n:
        return "pm10"
    if "no2" in n:
        return "no2"
    if "o3" in n or "ozone" in n:
        return "o3"
    return None


def _client():
    import cdsapi  # lazy
    url = os.environ.get("CDSAPI_URL")
    key = os.environ.get("CDSAPI_KEY")
    if not url or not key:
        raise RuntimeError(
            "CDSAPI_URL / CDSAPI_KEY not set. Add your ADS credentials to the "
            "environment or .env.local (never commit them)."
        )
    return cdsapi.Client(url=url, key=key)


def fetch_grid(leadtime_hour=0, area=None, base_date=None):
    """Submit + poll + download one CAMS forecast slice to a NetCDF zip.

    cdsapi.retrieve blocks until the async job is ready (cold: 30s–minutes).
    Returns (zip_path, base_date).
    """
    area = area or AREA
    base_date = base_date or current_base_date()
    request = {
        "variable": VARIABLES,
        "model": ["ensemble"],
        "level": ["0"],
        "date": [f"{base_date}/{base_date}"],
        "type": ["forecast"],
        "time": ["00:00"],
        "leadtime_hour": [str(leadtime_hour)],
        "data_format": "netcdf_zip",
        "area": area,
    }
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    _client().retrieve(DATASET, request, tmp.name)
    return tmp.name, base_date


def parse_grid(zip_path, base_date, leadtime_hour=0):
    """Parse a CAMS NetCDF zip into per-cell point dicts (one per cell × species).

    Each point: species, value (µg/m³), lat, lon, valid_time (UTC ISO),
    base_time, leadtime_hour, resolution_deg, cell_bbox.
    """
    import netCDF4  # lazy
    import numpy as np  # pulled in by netCDF4

    with zipfile.ZipFile(zip_path) as z:
        nc_name = next(n for n in z.namelist() if n.endswith(".nc"))
        nc_bytes = z.read(nc_name)

    ds = netCDF4.Dataset("inmem.nc", mode="r", memory=nc_bytes)
    try:
        lat_name = "latitude" if "latitude" in ds.variables else "lat"
        lon_name = "longitude" if "longitude" in ds.variables else "lon"
        lats = [float(x) for x in ds.variables[lat_name][:]]
        lons = [
            (float(x) - 360.0 if float(x) > 180 else float(x))
            for x in ds.variables[lon_name][:]
        ]

        base_dt = datetime.strptime(base_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        valid_iso = (base_dt + timedelta(hours=leadtime_hour)).isoformat()
        half = RESOLUTION_DEG / 2.0

        points = []
        for vname in ds.variables:
            if vname.lower() in _COORD_NAMES:
                continue
            species = _species_for(vname)
            if not species:
                continue
            a = np.array(ds.variables[vname][:])
            a = a.reshape(a.shape[-2], a.shape[-1])  # drop leading time/level dims
            for i, la in enumerate(lats):
                for j, lo in enumerate(lons):
                    val = float(a[i, j])
                    if not np.isfinite(val):
                        continue
                    # The CAMS European forecast NetCDF reports concentrations
                    # directly in µg/m³ (the *_conc variables carry units="µg/m3"),
                    # so no unit conversion is applied.
                    points.append(
                        {
                            "species": species,
                            "value": round(val, 3),
                            "lat": round(la, 4),
                            "lon": round(lo, 4),
                            "valid_time": valid_iso,
                            "base_time": base_dt.isoformat(),
                            "leadtime_hour": leadtime_hour,
                            "resolution_deg": RESOLUTION_DEG,
                            "cell_bbox": [
                                round(la - half, 4), round(lo - half, 4),
                                round(la + half, 4), round(lo + half, 4),
                            ],
                        }
                    )
        return points
    finally:
        ds.close()


def fetch_points(leadtime_hour=0):
    """Convenience: fetch + parse -> list of grid-point dicts. Cleans up the temp file."""
    path, base_date = fetch_grid(leadtime_hour=leadtime_hour)
    try:
        return parse_grid(path, base_date, leadtime_hour=leadtime_hour)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def main():
    import json
    pts = fetch_points()
    print(f"# CAMS: {len(pts)} grid points")
    print(json.dumps(pts[:5], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
