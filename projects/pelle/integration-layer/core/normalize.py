"""Normalizers: map a source's parsed output onto the common schema.

Each source gets one normalize_<source>() function. The source-specific
knowledge (which raw code is which metric, and what unit it carries) lives
here; the schema itself stays source-agnostic.
"""

from typing import List

from core.schema import (
    Reading,
    make_reading,
    CATEGORY_POLLUTANT,
    CATEGORY_WEATHER,
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


def split_by_category(readings: List[Reading]):
    """Convenience: separate pollutant vs weather (and other) readings."""
    pollutants = [x for x in readings if x.category == CATEGORY_POLLUTANT]
    weather = [x for x in readings if x.category == CATEGORY_WEATHER]
    other = [x for x in readings if x.category not in (CATEGORY_POLLUTANT, CATEGORY_WEATHER)]
    return pollutants, weather, other
