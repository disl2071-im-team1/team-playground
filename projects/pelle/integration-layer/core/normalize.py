"""Normalizers: map a source's parsed output onto the common schema.

Each source gets one normalize_<source>() function. The source-specific
knowledge (which raw code is which metric, and what unit it carries) lives
here; the schema itself stays source-agnostic.
"""

from datetime import datetime, timezone
from typing import List

from core.schema import (
    Reading,
    make_reading,
    CATEGORY_POLLUTANT,
    CATEGORY_WEATHER,
    PROVENANCE_MODELLED,
)

# WAQI iaqi codes -> (canonical metric name, unit).
#
# Important: WAQI's iaqi values are AQI *sub-indices*, not physical
# concentrations, so pollutant readings carry unit "aqi" rather than µg/m³.
# Weather fields, however, are reported in real units.
WAQI_METRIC_MAP = {
    # pollutants (value is an AQI sub-index)
    "pm25": ("pm25", "aqi"),
    "pm10": ("pm10", "aqi"),
    "no2": ("no2", "aqi"),
    "o3": ("o3", "aqi"),
    "so2": ("so2", "aqi"),
    "co": ("co", "aqi"),
    # weather (real units)
    "h": ("humidity", "%"),
    "p": ("pressure", "hPa"),
    "t": ("temperature", "°C"),
    "w": ("wind", "m/s"),
}


def normalize_waqi(parsed_readings: List[dict]) -> List[Reading]:
    """Map parsed WAQI station readings (from sources.waqi.parse_station)
    onto the common schema.

    Unknown iaqi codes are kept (category falls back to "other") so we never
    silently drop data; their unit is left empty until we learn what it is.
    """
    readings: List[Reading] = []
    for r in parsed_readings:
        code = r.get("metric")
        metric, unit = WAQI_METRIC_MAP.get(code, (code, ""))
        readings.append(
            make_reading(
                source="waqi",
                metric=metric,
                value=r.get("value"),
                unit=unit,
                station=r.get("station"),
                lat=r.get("lat"),
                lon=r.get("lon"),
                timestamp=r.get("timestamp"),
                raw=r,  # the parsed source record, kept untouched for tracing
            )
        )
    return readings


# SMHI phenomenon labels -> canonical metric names.
SMHI_PHENOMENON_MAP = {
    "PM10": "pm10",
    "PM2.5": "pm25",
    "NO2": "no2",
    "O3": "o3",
    "CO": "co",
    "SO2": "so2",
    "NOX as NO2": "nox",  # not in the canonical pollutant set -> category "other"
}


def _uom_to_unit(uom):
    """Normalize SMHI's unit string to the contract's unit (m3 -> m³)."""
    return (uom or "").replace("m3", "m³")


def _epoch_ms_to_iso(ms):
    """Epoch milliseconds (UTC) -> ISO-8601 UTC string."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def normalize_smhi(parsed_readings: List[dict]) -> List[Reading]:
    """Map parsed SMHI readings (from sources.smhi.parse_active) onto the schema.

    Unlike WAQI, SMHI reports true concentrations, so units are real (µg/m³,
    mg/m³ for CO). Instrument values are kept verbatim, including negatives.
    Unknown phenomena keep a lowercased label and fall to category "other".
    """
    readings: List[Reading] = []
    for r in parsed_readings:
        phenomenon = r.get("phenomenon")
        metric = SMHI_PHENOMENON_MAP.get(phenomenon, (phenomenon or "").lower())
        readings.append(
            make_reading(
                source="smhi",
                metric=metric,
                value=r.get("value"),
                unit=_uom_to_unit(r.get("uom")),
                station=r.get("station"),
                lat=r.get("lat"),
                lon=r.get("lon"),
                timestamp=_epoch_ms_to_iso(r["timestamp_ms"]),
                raw=r,  # source record kept untouched (negatives included)
            )
        )
    return readings


# luftdaten/Sensor.Community value_type -> (canonical metric, unit).
# P1=PM10, P2=PM2.5 (concentrations in µg/m³); pressure is reported in Pa.
LUFTDATEN_METRIC_MAP = {
    "P1": ("pm10", "µg/m³"),
    "P2": ("pm25", "µg/m³"),
    "temperature": ("temperature", "°C"),
    "humidity": ("humidity", "%"),
    "pressure": ("pressure", "Pa"),
    "pressure_at_sealevel": ("pressure_at_sealevel", "Pa"),
}


def normalize_luftdaten(parsed_readings: List[dict]) -> List[Reading]:
    """Map parsed luftdaten readings (from sources.luftdaten.parse_outdoor)
    onto the common schema.

    Concentrations are µg/m³ (like SMHI, unlike WAQI's AQI). Station is the
    sensor id, e.g. "luftdaten-43915", since these have no human-readable name.
    Naive timestamps are UTC; we hand them to make_reading as ISO (date and
    time joined by 'T') and to_utc_iso stamps them +00:00.
    """
    readings: List[Reading] = []
    for r in parsed_readings:
        vt = r.get("value_type")
        metric, unit = LUFTDATEN_METRIC_MAP.get(vt, ((vt or "").lower(), ""))
        ts = r.get("timestamp")
        iso = ts.replace(" ", "T") if ts else ts
        readings.append(
            make_reading(
                source="luftdaten",
                metric=metric,
                value=r.get("value"),
                unit=unit,
                station=f"luftdaten-{r.get('sensor_id')}",
                lat=r.get("lat"),
                lon=r.get("lon"),
                timestamp=iso,
                raw=r,  # keeps value_raw string + record_id for traceability
            )
        )
    return readings


# CAMS species (ADS variable / NetCDF short names) -> canonical metric.
CAMS_SPECIES_MAP = {
    "pm2p5": "pm25",
    "pm2.5": "pm25",
    "particulate_matter_2.5um": "pm25",
    "pm10": "pm10",
    "particulate_matter_10um": "pm10",
    "no2": "no2",
    "nitrogen_dioxide": "no2",
    "o3": "o3",
    "ozone": "o3",
}


def normalize_cams(parsed_points: List[dict]) -> List[Reading]:
    """Map parsed CAMS grid points (from sources.cams.parse_grid) onto the schema.

    CAMS is a MODELLED forecast on a coarse grid, not a point measurement, so:
      - provenance is "modelled"
      - station is None (a grid cell is not a station; we do not fake a name)
      - lat/lon are the grid-cell centre; resolution and cell bounds stay in raw
      - timestamp is the forecast VALID time; raw keeps base_time + leadtime_hour
    Values are concentrations in µg/m³ (converted from CAMS kg/m³ upstream).
    """
    readings: List[Reading] = []
    for p in parsed_points:
        species = p.get("species")
        metric = CAMS_SPECIES_MAP.get(species, (species or "").lower())
        readings.append(
            make_reading(
                source="cams",
                metric=metric,
                value=p.get("value"),
                unit="µg/m³",
                station=None,
                lat=p.get("lat"),
                lon=p.get("lon"),
                timestamp=p.get("valid_time"),
                provenance=PROVENANCE_MODELLED,
                raw=p,
            )
        )
    return readings


def split_by_category(readings: List[Reading]):
    """Convenience: separate pollutant vs weather (and other) readings."""
    pollutants = [x for x in readings if x.category == CATEGORY_POLLUTANT]
    weather = [x for x in readings if x.category == CATEGORY_WEATHER]
    other = [x for x in readings if x.category not in (CATEGORY_POLLUTANT, CATEGORY_WEATHER)]
    return pollutants, weather, other
