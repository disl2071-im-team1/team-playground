import { NextResponse } from "next/server";

export const revalidate = 1800; // 30 min

const SOURCE = "SMHI metfcst snow1g v1 (forecast)";
const MISSING = 9999; // SMHI missing-value sentinel
const MAX_HOURS = 24; // first day of hourly steps — covers the slider range

// District centroids — mirror of RAIN_DISTRICTS in public/cleanpath/app.js.
// Kept self-contained here so this route is independent of the heat route.
const DISTRICTS = [
  { id: "norrmalm", name: "Norrmalm", lat: 59.335, lon: 18.063 },
  { id: "sodermalm", name: "Södermalm", lat: 59.316, lon: 18.072 },
  { id: "ostermalm", name: "Östermalm", lat: 59.34, lon: 18.085 },
  { id: "kungsholmen", name: "Kungsholmen", lat: 59.33, lon: 18.03 },
  { id: "vasastan", name: "Vasastan", lat: 59.346, lon: 18.055 },
  { id: "gamla_stan", name: "Gamla Stan", lat: 59.323, lon: 18.071 },
  { id: "djurgarden", name: "Djurgården", lat: 59.334, lon: 18.11 },
  { id: "hammarby", name: "Hammarby", lat: 59.302, lon: 18.089 },
  { id: "bromma", name: "Bromma", lat: 59.338, lon: 17.945 },
];

type SmhiStep = { time: string; data?: Record<string, number> };
type SmhiPointForecast = { referenceTime?: string; timeSeries?: SmhiStep[] };

type RainHour = {
  validTime: string;
  leadHour: number;
  mmMean: number;
  mmMin: number | null;
  mmMax: number | null;
  type: number | null;
  band: string;
};

// Intensity bands by mean amount (mm/h). SMHI gives an amount, not a
// probability — so the bands are intensity, never likelihood.
function rainBand(mm: number): string {
  if (mm < 0.1) return "None";
  if (mm < 2.5) return "Light";
  if (mm < 7.6) return "Moderate";
  return "Heavy";
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

  const hours: RainHour[] = [];
  series.slice(0, MAX_HOURS).forEach((step, i) => {
    // precipitation_amount_* is an accumulation over the interval ending at the
    // step's time; the interval widens later in the forecast, so each value is
    // treated as that step's intensity and validTime is kept for alignment.
    const mean = clean(step.data?.precipitation_amount_mean);
    if (mean === null) return; // sentinel/missing
    hours.push({
      validTime: step.time,
      leadHour: i, // indexed from the first forecast step → aligns to the slider
      mmMean: round1(mean),
      mmMin: clean(step.data?.precipitation_amount_min) === null ? null : round1(step.data!.precipitation_amount_min),
      mmMax: clean(step.data?.precipitation_amount_max) === null ? null : round1(step.data!.precipitation_amount_max),
      type: clean(step.data?.predominant_precipitation_type_at_surface),
      band: rainBand(mean),
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
