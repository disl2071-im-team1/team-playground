import { NextResponse } from "next/server";

export const revalidate = 600; // 10 min

// Stockholm bounding box: south,west .. north,east
const BOUNDS = { south: 59.2, west: 17.8, north: 59.5, east: 18.3 };

const SOURCE = "World Air Quality Index (WAQI / aqicn.org)";

type WaqiStation = {
  lat: number;
  lon: number;
  uid: number;
  aqi: string; // numeric string, or "-" when no current reading
  station?: { name?: string; time?: string };
};

type WaqiBoundsResponse = {
  status: string;
  data?: WaqiStation[];
};

// Map a US-EPA AQI value onto the 1-10 index the frontend expects
// (mirrors the DEFRA-style banding the original London Air layer used).
function aqiToIndex(aqi: number): number {
  if (aqi <= 20) return 1;
  if (aqi <= 40) return 2;
  if (aqi <= 50) return 3;
  if (aqi <= 75) return 4;
  if (aqi <= 100) return 5;
  if (aqi <= 125) return 6;
  if (aqi <= 150) return 7;
  if (aqi <= 175) return 8;
  if (aqi <= 200) return 9;
  return 10;
}

function indexBand(idx: number): string {
  if (idx <= 3) return "Low";
  if (idx <= 6) return "Moderate";
  if (idx <= 9) return "High";
  return "Very high";
}

export async function GET() {
  const token = process.env.WAQI_TOKEN;
  if (!token) {
    return NextResponse.json({
      ok: false,
      configured: false,
      reason:
        "WAQI_TOKEN env var not set. Get a free token at aqicn.org/data-platform/token and add it to .env.local (locally) or the Vercel project settings.",
    });
  }

  const latlng = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
  const url = `https://api.waqi.info/map/bounds/?latlng=${latlng}&token=${token}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, configured: true, reason: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as WaqiBoundsResponse;
    if (json.status !== "ok" || !Array.isArray(json.data)) {
      return NextResponse.json(
        { ok: false, configured: true, reason: "unexpected WAQI response" },
        { status: 502 },
      );
    }

    let latest: string | null = null;
    const stations = json.data
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => {
        const aqiNum = parseFloat(s.aqi);
        const hasReading = Number.isFinite(aqiNum) && aqiNum >= 0;
        let pm25: { index: number; band: string } | null = null;
        if (hasReading) {
          const index = aqiToIndex(aqiNum);
          pm25 = { index, band: indexBand(index) };
        }
        const time = s.station?.time || null;
        if (time && (!latest || time > latest)) latest = time;
        return {
          code: `uid-${s.uid}`,
          name: s.station?.name || `Station ${s.uid}`,
          siteType: null as string | null,
          lat: s.lat,
          lon: s.lon,
          bulletin: time,
          pm25,
        };
      });

    return NextResponse.json({
      ok: true,
      configured: true,
      source: SOURCE,
      updated: latest,
      stations,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        reason: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
