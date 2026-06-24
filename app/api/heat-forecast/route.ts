import { NextResponse } from "next/server";

export const revalidate = 1800; // 30 min

const SOURCE = "SMHI metfcst snow1g v1 (forecast)";
const MISSING = 9999; // SMHI missing-value sentinel
const MAX_HOURS = 24; // first day of hourly steps — covers the slider range

// District centroids — mirror of HEAT_DISTRICTS in public/cleanpath/app.js.
const DISTRICTS = [
  { id: "norrmalm", name: "Norrmalm", lat: 59.337, lon: 18.058 },
  { id: "sodermalm", name: "Södermalm", lat: 59.314, lon: 18.072 },
  { id: "ostermalm", name: "Östermalm", lat: 59.337, lon: 18.085 },
  { id: "vasastan", name: "Vasastan", lat: 59.346, lon: 18.045 },
  { id: "kungsholmen", name: "Kungsholmen", lat: 59.33, lon: 18.03 },
  { id: "skarholmen", name: "Skärholmen", lat: 59.277, lon: 17.907 },
  { id: "alvsjo", name: "Älvsjö", lat: 59.278, lon: 18.01 },
];

type SmhiStep = { time: string; data?: Record<string, number> };
type SmhiPointForecast = { referenceTime?: string; timeSeries?: SmhiStep[] };

type HeatHour = {
  validTime: string;
  leadHour: number;
  tempC: number;
  apparentC: number;
  band: string;
};

// Australian apparent-temperature ("känns som") formula.
function apparentTemp(ta: number, rh: number, ws: number): number {
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta));
  return ta + 0.33 * e - 0.7 * ws - 4.0;
}

// Bands mirror heatBand() in the client. It is forecast (NWP) data — never
// labelled "measured".
function heatBand(at: number): string {
  if (at >= 33) return "Extreme";
  if (at >= 30) return "Warning";
  if (at >= 27) return "Caution";
  return "Comfortable";
}

// Filter the 9999 sentinel (and any non-finite) everywhere.
function clean(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v !== MISSING ? v : null;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

async function fetchDistrict(d: (typeof DISTRICTS)[number]) {
  const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${d.lon}/lat/${d.lat}/data.json`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`SMHI ${res.status} for ${d.name}`);
  const json = (await res.json()) as SmhiPointForecast;
  const series = Array.isArray(json.timeSeries) ? json.timeSeries : [];
  if (series.length === 0) throw new Error(`empty forecast for ${d.name}`);

  const hours: HeatHour[] = [];
  series.slice(0, MAX_HOURS).forEach((step, i) => {
    const ta = clean(step.data?.air_temperature);
    const rh = clean(step.data?.relative_humidity);
    const ws = clean(step.data?.wind_speed);
    if (ta === null || rh === null || ws === null) return; // sentinel/missing
    const at = apparentTemp(ta, rh, ws);
    hours.push({
      validTime: step.time,
      leadHour: i, // indexed from the first forecast step → aligns to the slider
      tempC: round1(ta),
      apparentC: round1(at),
      band: heatBand(at),
    });
  });
  return { referenceTime: json.referenceTime ?? null, hours };
}

export async function GET() {
  try {
    const results = await Promise.all(DISTRICTS.map(fetchDistrict));
    const approvedTime =
      results.find((r) => r.referenceTime)?.referenceTime ?? null;
    const districts = DISTRICTS.map((d, i) => ({
      id: d.id,
      name: d.name,
      lat: d.lat,
      lon: d.lon,
      hours: results[i].hours,
    }));
    return NextResponse.json(
      { ok: true, approvedTime, source: SOURCE, districts },
      {
        headers: {
          "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
