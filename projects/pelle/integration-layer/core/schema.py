"""The common reading model: the contract every source normalizes into.

See CLAUDE.md ("The common schema is the contract"). A Reading carries the
9 contract fields plus `category`, which tags pollutant vs non-pollutant
(weather) readings so consumers can separate them without re-deriving from
metric names.

This module is source-agnostic. Source-specific mapping (which raw code means
"pm25", what unit it carries) lives in core/normalize.py.
"""

from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Any, Optional

# --- Categories -------------------------------------------------------------

CATEGORY_POLLUTANT = "pollutant"
CATEGORY_WEATHER = "weather"
CATEGORY_OTHER = "other"

# Canonical metric names, post-normalization (not source-specific codes).
POLLUTANT_METRICS = {"pm25", "pm10", "no2", "o3", "so2", "co", "pm1", "nh3"}
WEATHER_METRICS = {"humidity", "pressure", "temperature", "wind"}


def classify(metric: str) -> str:
    """Categorize a canonical metric name."""
    if metric in POLLUTANT_METRICS:
        return CATEGORY_POLLUTANT
    if metric in WEATHER_METRICS:
        return CATEGORY_WEATHER
    return CATEGORY_OTHER


def to_utc_iso(timestamp: str) -> str:
    """Normalize an ISO-8601 timestamp (with offset) to UTC ISO-8601.

    The contract requires timestamps in UTC. Sources report local offsets
    (e.g. WAQI returns +08:00 for a Shanghai station), so we convert.
    """
    dt = datetime.fromisoformat(timestamp)
    if dt.tzinfo is None:
        # No offset given: assume the source already meant UTC.
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


@dataclass
class Reading:
    """One normalized measurement. The shape of the contract."""

    source: str          # which fetcher produced it, e.g. "waqi"
    metric: str          # canonical metric name, e.g. "pm25", "temperature"
    value: float         # the numeric reading
    unit: str            # unit of value, e.g. "aqi", "µg/m³", "°C"
    station: str         # station name/id
    lat: Optional[float]
    lon: Optional[float]
    timestamp: str       # observation time, UTC ISO-8601
    category: str        # pollutant | weather | other
    raw: Any = field(default=None)  # untouched source payload for this reading

    def to_dict(self) -> dict:
        return asdict(self)


def make_reading(
    *,
    source: str,
    metric: str,
    value: float,
    unit: str,
    station: str,
    lat: Optional[float],
    lon: Optional[float],
    timestamp: str,
    raw: Any = None,
    category: Optional[str] = None,
) -> Reading:
    """Build a Reading, deriving category from the metric and forcing UTC time.

    Keeping this in one place means every source goes through the same
    classification and timestamp rules.
    """
    return Reading(
        source=source,
        metric=metric,
        value=value,
        unit=unit,
        station=station,
        lat=lat,
        lon=lon,
        timestamp=to_utc_iso(timestamp),
        category=category or classify(metric),
        raw=raw,
    )
