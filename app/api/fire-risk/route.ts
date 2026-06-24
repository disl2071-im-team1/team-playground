import { NextResponse } from "next/server";

export const revalidate = 1800; // 30 min

const SOURCE = "SMHI fwif1g v1 FWI (modelled, for MSB)";
const MISSING = 9999; // SMHI missing-value sentinel
const NODATA = -1; // FWI not computed (sea / outside the land+lake mask)
const PEAK_WINDOW_H = 30; // representative value = near-term afternoon peak

// Zone centroids — mirror of FIRE_ZONES box centroids in public/cleanpath/app.js.
// Kept self-contained so this route is independent of the heat/rain routes.
const ZONES = [
  { id: "nw", name: "NW zone — Järvafältet", lat: 59.36, lon: 18.02 },
  { id: "ne", name: "NE zone — Norra Djurgården", lat: 59.36, lon: 18.12 },
  { id: "sw", name: "SW zone — Älvsjöskogen", lat: 59.29, lon: 18.02 },
  { id: "se", name: "SE zone — Nackareservatet", lat: 59.29, lon: 18.12 },
];

// SMHI fwif1g publishes its own 1–6 fire-risk class (fwiindex). Map it to the
// app's four bands (this matches fireBand() in the client). This is SMHI's own
// classification, not a re-derivation of EFFIS thresholds on the raw FWI.
function bandFromIndex(idx: number): string {
  if (idx >= 5) return "Extreme";
  if (idx >= 4) return "High";
  if (idx >= 3) return "Moderate";
  return "Low";
}

// Severity (0–3) for colouring the REAL driver values — interpretation of the
// real number, not fabricated data. Conventional fire-weather breakpoints.
const sevWind = (ws: number) => (ws >= 13 ? 3 : ws >= 8 ? 2 : ws >= 4 ? 1 : 0);
const sevFfmc = (v: number) => (v >= 90 ? 3 : v >= 86 ? 2 : v >= 80 ? 1 : 0);
const sevDc = (v: number) => (v >= 500 ? 3 : v >= 350 ? 2 : v >= 200 ? 1 : 0);
const sevIsi = (v: number) => (v >= 10 ? 3 : v >= 6 ? 2 : v >= 3 ? 1 : 0);

function clean(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v !== MISSING && v !== NODATA
    ? v
    : null;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

type SmhiStep = { validTime: string; parameters?: { name: string; values: number[] }[] };
type SmhiPoint = { approvedTime?: string; timeSeries?: SmhiStep[] };

function pval(step: SmhiStep | undefined, name: string): number | undefined {
  const p = step?.parameters?.find((x) => x.name === name);
  return p && Array.isArray(p.values) ? p.values[0] : undefined;
}

async function fetchZone(z: (typeof ZONES)[number]) {
  // Daily fwif1g is multipoint-only (whole-grid, ~30 MB); the hourly product
  // offers a lightweight point geotype, so we fetch the 4 centroids hourly and
  // take the near-term afternoon peak as the representative value. (The endpoint
  // mandates gzip; the runtime fetch negotiates it automatically.)
  const url = `https://opendata-download-metfcst.smhi.se/api/category/fwif1g/version/1/hourly/geotype/point/lon/${z.lon}/lat/${z.lat}/data.json`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`SMHI ${res.status} for ${z.name}`);
  const json = (await res.json()) as SmhiPoint;
  const ts = Array.isArray(json.timeSeries) ? json.timeSeries : [];
  if (ts.length === 0) throw new Error(`empty FWI for ${z.name}`);
  return { approvedTime: json.approvedTime ?? null, ts };
}

export async function GET() {
  try {
    const results = await Promise.all(ZONES.map(fetchZone));
    const approvedTime = results.find((r) => r.approvedTime)?.approvedTime ?? null;

    // One representative validTime for the whole map: the hour where the
    // area-mean FWI peaks within the next ~30h (the four points share the same
    // hourly grid, so a single step index aligns them).
    const ref = results[0].ts;
    const now = Date.now();
    let peakIdx = 0;
    let peakAgg = -Infinity;
    let validTime = ref[0]?.validTime ?? null;
    ref.forEach((step, i) => {
      const t = Date.parse(step.validTime);
      if (t < now - 2 * 3600e3 || t > now + PEAK_WINDOW_H * 3600e3) return;
      const vals = results
        .map((r) => clean(pval(r.ts[i], "fwi")))
        .filter((v): v is number => v != null);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : -1;
      if (mean > peakAgg) {
        peakAgg = mean;
        peakIdx = i;
        validTime = step.validTime;
      }
    });

    const zones = ZONES.map((z, zi) => {
      const step = results[zi].ts[peakIdx];
      const fwiindex = clean(pval(step, "fwiindex"));
      const fwi = clean(pval(step, "fwi"));
      const ws = clean(pval(step, "ws"));
      const ffmc = clean(pval(step, "ffmc"));
      const dc = clean(pval(step, "dc"));
      const isi = clean(pval(step, "isi"));

      // Only surface a driver from a real value; drop the rest (no synthetics).
      const drivers: { key: string; label: string; value: string; severity: number }[] = [];
      if (ws != null) drivers.push({ key: "wind", label: "Wind speed", value: `${round1(ws)} m/s`, severity: sevWind(ws) });
      if (ffmc != null) drivers.push({ key: "ffmc", label: "Fine fuel moisture (FFMC)", value: `${round1(ffmc)}`, severity: sevFfmc(ffmc) });
      if (dc != null) drivers.push({ key: "dc", label: "Drought code (DC)", value: `${round1(dc)}`, severity: sevDc(dc) });
      if (isi != null) drivers.push({ key: "isi", label: "Initial spread (ISI)", value: `${round1(isi)}`, severity: sevIsi(isi) });

      return {
        id: z.id,
        name: z.name,
        fwiindex,
        fwi: fwi != null ? round1(fwi) : null,
        band: fwiindex != null ? bandFromIndex(fwiindex) : null,
        drivers,
      };
    });

    return NextResponse.json(
      { ok: true, approvedTime, validTime, source: SOURCE, zones },
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
