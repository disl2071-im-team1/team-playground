import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { NetCDFReader } from "netcdfjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADS_BASE = "https://ads.atmosphere.copernicus.eu/api";
const DATASET = "cams-europe-air-quality-forecasts";

// London bounding box (rounded to CAMS 0.1° grid)
const AREA = { north: 51.7, west: -0.6, south: 51.3, east: 0.3 };

type AdsJob = {
  jobID?: string;
  status?: string;
  asset?: { value?: { href?: string } };
  results?: { asset?: { value?: { href?: string } } };
  message?: string;
};

function todayUTCDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function adsFetch(
  path: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  return fetch(`${ADS_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "PRIVATE-TOKEN": token,
      Accept: "application/json",
    },
    cache: "no-store",
  });
}

async function submitJob(token: string, leadHour: number): Promise<string> {
  const body = {
    inputs: {
      variable: ["particulate_matter_2_5um"],
      model: ["ensemble"],
      level: ["0"],
      date: [`${todayUTCDate()}/${todayUTCDate()}`],
      type: ["forecast"],
      time: ["00:00"],
      leadtime_hour: [String(leadHour)],
      data_format: "netcdf_zip",
      area: [AREA.north, AREA.west, AREA.south, AREA.east],
    },
  };
  const res = await adsFetch(
    `/retrieve/v1/processes/${DATASET}/execution`,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    token,
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`submit failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as AdsJob;
  if (!data.jobID) throw new Error("no jobID in response");
  return data.jobID;
}

async function pollJob(
  token: string,
  jobId: string,
  maxMs: number,
): Promise<string> {
  const start = Date.now();
  let delay = 400;
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 2500);
    const res = await adsFetch(`/retrieve/v1/jobs/${jobId}`, { method: "GET" }, token);
    if (!res.ok) continue;
    const data = (await res.json()) as AdsJob;
    if (data.status === "successful") {
      const res2 = await adsFetch(`/retrieve/v1/jobs/${jobId}/results`, { method: "GET" }, token);
      if (!res2.ok) throw new Error(`results fetch ${res2.status}`);
      const results = (await res2.json()) as AdsJob;
      const href = results.asset?.value?.href || results.results?.asset?.value?.href;
      if (!href) throw new Error("no download href in results");
      return href;
    }
    if (data.status === "failed") {
      throw new Error("ADS job failed: " + (data.message || "no message"));
    }
  }
  throw new Error("timeout polling ADS job");
}

async function parseNetcdfZip(buf: ArrayBuffer): Promise<{
  grid: Array<[number, number, number]>;
}> {
  const zip = await JSZip.loadAsync(buf);
  const ncEntry = Object.values(zip.files).find(f => f.name.endsWith(".nc"));
  if (!ncEntry) throw new Error("no .nc file in archive");
  const ncBytes = await ncEntry.async("uint8array");
  const reader = new NetCDFReader(ncBytes);

  const varNames = reader.variables.map(v => v.name);
  const dataVar =
    varNames.find(n => n.toLowerCase().includes("pm2") || n.toLowerCase().includes("pm25")) ||
    varNames.find(n => !["latitude", "longitude", "time", "level", "lat", "lon"].includes(n.toLowerCase()));
  if (!dataVar) throw new Error("no data variable found");

  const latName = varNames.find(n => n.toLowerCase() === "latitude" || n.toLowerCase() === "lat") || "latitude";
  const lonName = varNames.find(n => n.toLowerCase() === "longitude" || n.toLowerCase() === "lon") || "longitude";

  const lats = reader.getDataVariable(latName) as number[];
  const lonsRaw = reader.getDataVariable(lonName) as number[];
  const values = reader.getDataVariable(dataVar) as number[];

  // CAMS lon often 0..360, normalize to -180..180
  const lons = lonsRaw.map(l => (l > 180 ? l - 360 : l));

  const grid: Array<[number, number, number]> = [];
  // values is typically [time, level, lat, lon] flattened with time=level=1
  const nLat = lats.length;
  const nLon = lons.length;
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const v = values[i * nLon + j];
      if (Number.isFinite(v) && v >= 0) {
        // CAMS PM2.5 is in kg/m^3 in some products, µg/m^3 in others.
        // Heuristic: if extremely small, convert kg/m^3 -> µg/m^3 (×1e9).
        const v2 = v < 1e-3 ? v * 1e9 : v;
        grid.push([lats[i], lons[j], v2]);
      }
    }
  }
  return { grid };
}

export async function GET(req: NextRequest) {
  const token = process.env.CDSAPI_KEY;
  if (!token) {
    return NextResponse.json({
      ok: false,
      configured: false,
      reason: "CDSAPI_KEY env var not set. Add your Copernicus ADS personal token to Vercel project settings to enable the CAMS layer.",
    });
  }

  const hourParam = req.nextUrl.searchParams.get("hour");
  const leadHour = Math.max(0, Math.min(96, parseInt(hourParam || "0", 10) || 0));

  try {
    const jobId = await submitJob(token, leadHour);
    const href = await pollJob(token, jobId, 45_000);

    const dl = await fetch(href, { cache: "no-store" });
    if (!dl.ok) throw new Error(`download ${dl.status}`);
    const buf = await dl.arrayBuffer();
    const { grid } = await parseNetcdfZip(buf);

    return NextResponse.json(
      {
        ok: true,
        configured: true,
        source: "Copernicus Atmosphere Monitoring Service (CAMS Europe air quality forecast)",
        updated: new Date().toISOString(),
        forecastHour: leadHour,
        bounds: AREA,
        grid,
      },
      { headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    return NextResponse.json({
      ok: false,
      configured: true,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}
