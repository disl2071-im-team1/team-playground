import { NextResponse } from "next/server";

export const revalidate = 2700; // 45 min — HaV sampling changes at most daily

const SOURCE = "HaV Badplatser och badvatten API v2.3 (municipal sampling)";
const BASE =
  "https://gw.havochvatten.se/external-public/bathing-waters/v2/bathing-waters";

// 8 real, verified Stockholm bathing sites (HaV badplats IDs). Only the IDs are
// hardcoded; name, coordinates and all status come from the live API.
const SITE_IDS = [
  "SE0110180000001864", // Brunnsvikens Strandbad
  "SE0110180000001845", // Smedsuddsbadet V
  "SE0110180000001832", // Långholmens strandbad
  "SE0110180000007141", // Tanto, strand 1
  "SE0110180000001867", // Flatenbadet, allmänna
  "SE0110180000004457", // Fredhällsbadet, Mälaren
  "SE0110180000004555", // Kristinebergsbadet
  "SE0110180000004020", // Johannelundsbadet (Minneberg), Mälaren
];

const ADVICE_WHOLE_SEASON = 99; // "Avrådan hel badsäsong" → a season-long closure

type Advice = { typeId?: number; typeIdText?: string; description?: string; startsAt?: string };
type Result = {
  takenAt?: string;
  sampleAssessIdText?: string;
  algalIdText?: string;
  escherichiaColiCount?: number;
  escherichiaColiPrefix?: string;
  intestinalEnterococciCount?: number;
  intestinalEnterococciPrefix?: string;
  waterTemp?: string;
};
type Detail = {
  adviceAgainstBathing?: Advice[];
  bathingWater?: {
    name?: string;
    samplingPointPosition?: { latitude?: string; longitude?: string };
  };
  profile?: {
    bloomRisk?: { algae?: boolean; cyano?: boolean };
    lastFourClassifications?: { qualityClassIdText?: string; year?: number }[];
  };
  results?: Result[];
};

// Map the real HaV signals onto the app's status enum. A whole-season advisory
// is a closure; any other ongoing advice against bathing is an advisory; a
// bloom risk with no advice is a watch; otherwise none.
function mapStatus(advice: Advice[], bloomRisk: { algae?: boolean; cyano?: boolean }): string {
  if (advice.some((a) => a.typeId === ADVICE_WHOLE_SEASON)) return "closed";
  if (advice.length > 0) return "advisory";
  if (bloomRisk.algae || bloomRisk.cyano) return "watch";
  return "none";
}

function num(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchSite(id: string) {
  const res = await fetch(`${BASE}/${id}`, {
    headers: { Accept: "application/json", "User-Agent": "CleanPath/1.0 (municipal monitor)" },
    next: { revalidate: 2700 },
  });
  if (!res.ok) throw new Error(`HaV ${res.status} for ${id}`);
  const d = (await res.json()) as Detail;
  const bw = d.bathingWater || {};
  const pos = bw.samplingPointPosition || {};
  const advice = Array.isArray(d.adviceAgainstBathing) ? d.adviceAgainstBathing : [];
  const bloomRisk = d.profile?.bloomRisk || {};
  const status = mapStatus(advice, bloomRisk);

  // Latest sample (results sorted newest-first).
  const results = (Array.isArray(d.results) ? d.results : [])
    .slice()
    .sort((a, b) => String(b.takenAt || "").localeCompare(String(a.takenAt || "")));
  const last = results[0] || {};
  const lastSampled = last.takenAt || null;
  const ageDays = lastSampled
    ? Math.floor((Date.now() - Date.parse(lastSampled)) / 86400000)
    : null;

  const classification =
    d.profile?.lastFourClassifications?.[0]?.qualityClassIdText || null;
  const bloom = !!(bloomRisk.algae || bloomRisk.cyano) || advice.some((a) => a.typeId === 2);
  const advisory = advice.length
    ? advice.map((a) => a.typeIdText).filter(Boolean).join(" · ")
    : null;

  const lat = pos.latitude != null ? parseFloat(pos.latitude) : null;
  const lon = pos.longitude != null ? parseFloat(pos.longitude) : null;

  return {
    id,
    name: bw.name || id,
    lat,
    lon,
    status,
    bloom,
    advisory,
    classification,
    lastSampled,
    ageDays,
    // Real observed sample values (HaV), for the detail modal — never synthetic.
    observed: {
      assessment: last.sampleAssessIdText || null,
      algae: last.algalIdText || null,
      eColi: num(last.escherichiaColiCount),
      eColiPrefix: last.escherichiaColiPrefix || "",
      enterococci: num(last.intestinalEnterococciCount),
      enterococciPrefix: last.intestinalEnterococciPrefix || "",
      waterTemp: last.waterTemp != null ? parseFloat(last.waterTemp) : null,
    },
  };
}

export async function GET() {
  try {
    const sites = await Promise.all(SITE_IDS.map(fetchSite));
    return NextResponse.json(
      { ok: true, source: SOURCE, retrieved: new Date().toISOString(), sites },
      { headers: { "Cache-Control": "s-maxage=2700, stale-while-revalidate=5400" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
