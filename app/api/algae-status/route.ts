import { NextResponse } from "next/server";

export const revalidate = 2700; // 45 min — HaV sampling changes at most daily

const SOURCE = "HaV Badplatser och badvatten API v2.3 (municipal sampling)";
// Confirmed working host (the gw.havochvatten.se gateway is unreachable from
// the deploy environment). This per-site detail endpoint returns Swedish fields.
const BASE = "https://badplatsen.havochvatten.se/badplatsen/api/detail";

const DISSUASION_WHOLE_SEASON = 99; // "Avrådan hel badsäsong" → a season-long closure
const DISSUASION_ALGAE = 2; // "Algblomning"

// 8 real, verified Stockholm bathing sites. The detail payload has NO
// coordinates, so lat/lon are hardcoded from each site's known public location;
// name is taken live (locationName) with this as a fallback.
const SITES = [
  { id: "SE0110180000001864", name: "Brunnsvikens Strandbad", lat: 59.3618, lon: 18.0485 },
  { id: "SE0110180000001845", name: "Smedsuddsbadet V", lat: 59.3251, lon: 18.0209 },
  { id: "SE0110180000001832", name: "Långholmens strandbad", lat: 59.322, lon: 18.0241 },
  { id: "SE0110180000007141", name: "Tanto, strand 1", lat: 59.3119, lon: 18.0383 },
  { id: "SE0110180000001867", name: "Flatenbadet, allmänna", lat: 59.2525, lon: 18.1588 },
  { id: "SE0110180000004457", name: "Fredhällsbadet, Mälaren", lat: 59.3304, lon: 17.9959 },
  { id: "SE0110180000004555", name: "Kristinebergsbadet", lat: 59.3382, lon: 18.0009 },
  { id: "SE0110180000004020", name: "Johannelundsbadet (Minneberg), Mälaren", lat: 59.341071, lon: 17.986475 },
];

type Dissuasion = { type?: number; dissuasionTypeText?: string; description?: string; startdate?: number };
type TestResult = {
  sampleText?: string;
  algalText?: string;
  ecoliValue?: number;
  ecoliPrefix?: string;
  ecoliClassText?: string;
  enteroValue?: number;
  enteroPrefix?: string;
  enteroClassText?: string;
  tempValue?: string;
  weatherText?: string;
  sampleDate?: number;
};
type HavDetail = {
  locationName?: string;
  algalValue?: number;
  algalText?: string;
  dissuasion?: Dissuasion[];
  classificationText?: string;
  classificationYear?: number;
  sampleDate?: number; // epoch ms
  sampleTemperature?: string;
  testResult?: TestResult[];
};

// Map the real HaV signals onto the app's status enum.
function mapStatus(dissuasion: Dissuasion[], algalValue: number | undefined): string {
  if (dissuasion.some((d) => d.type === DISSUASION_WHOLE_SEASON)) return "closed";
  if (dissuasion.length > 0) return "advisory";
  if (algalValue != null && algalValue >= 1 && algalValue <= 3) return "watch";
  return "none";
}

function num(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchSite(site: (typeof SITES)[number]) {
  const res = await fetch(`${BASE}/${site.id}`, {
    headers: { Accept: "application/json", "User-Agent": "CleanPath/1.0 (municipal monitor)" },
    next: { revalidate: 2700 },
  });
  if (!res.ok) throw new Error(`HaV ${res.status} for ${site.id}`);
  const d = (await res.json()) as HavDetail;

  const dissuasion = Array.isArray(d.dissuasion) ? d.dissuasion : [];
  const status = mapStatus(dissuasion, d.algalValue);
  const bloom =
    (d.algalValue != null && d.algalValue >= 1 && d.algalValue <= 3) ||
    dissuasion.some((x) => x.type === DISSUASION_ALGAE);
  const advisory = dissuasion.length
    ? dissuasion.map((x) => x.dissuasionTypeText).filter(Boolean).join(" · ")
    : null;
  const classification = d.classificationText
    ? `${d.classificationText}${d.classificationYear ? " " + d.classificationYear : ""}`
    : null;

  const sampleMs = num(d.sampleDate);
  const lastSampled = sampleMs ? new Date(sampleMs).toISOString() : null;
  const ageDays = sampleMs ? Math.floor((Date.now() - sampleMs) / 86400000) : null;

  const t = (Array.isArray(d.testResult) ? d.testResult : [])[0] || {};
  const observed = {
    assessment: t.sampleText || null,
    algae: t.algalText || d.algalText || null,
    eColi: num(t.ecoliValue),
    eColiPrefix: t.ecoliPrefix || "",
    eColiClass: t.ecoliClassText || null,
    enterococci: num(t.enteroValue),
    enterococciPrefix: t.enteroPrefix || "",
    enteroClass: t.enteroClassText || null,
    waterTemp: t.tempValue != null ? parseFloat(t.tempValue) : d.sampleTemperature != null ? parseFloat(d.sampleTemperature) : null,
    weather: t.weatherText || null,
  };

  return {
    id: site.id,
    name: d.locationName || site.name,
    lat: site.lat,
    lon: site.lon,
    ok: true,
    status,
    bloom,
    advisory,
    classification,
    lastSampled,
    ageDays,
    observed,
  };
}

export async function GET() {
  // allSettled so one failed site does not 502 the whole response.
  const settled = await Promise.allSettled(SITES.map(fetchSite));
  const sites = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { id: SITES[i].id, name: SITES[i].name, lat: SITES[i].lat, lon: SITES[i].lon, ok: false },
  );

  if (!sites.some((s) => s.ok)) {
    const reason = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return NextResponse.json(
      { ok: false, reason: reason ? String(reason.reason?.message || reason.reason) : "all sites failed" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, source: SOURCE, retrieved: new Date().toISOString(), sites },
    { headers: { "Cache-Control": "s-maxage=2700, stale-while-revalidate=5400" } },
  );
}
