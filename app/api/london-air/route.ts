import { NextResponse } from "next/server";

export const revalidate = 600; // 10 min

type Species = {
  "@SpeciesCode": string;
  "@AirQualityIndex"?: string;
  "@AirQualityBand"?: string;
};

type Site = {
  "@SiteCode": string;
  "@SiteName": string;
  "@SiteType"?: string;
  "@Latitude"?: string;
  "@Longitude"?: string;
  "@BulletinDate"?: string;
  Species?: Species | Species[];
};

type LocalAuthority = {
  "@LocalAuthorityName"?: string;
  Site?: Site | Site[];
};

const SOURCE =
  "https://api.erg.ic.ac.uk/AirQuality/Hourly/MonitoringIndex/GroupName=London/Json";

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseNum(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  try {
    const res = await fetch(SOURCE, {
      headers: { Accept: "application/json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as {
      HourlyAirQualityIndex?: { LocalAuthority?: LocalAuthority | LocalAuthority[] };
    };

    const stations: Array<{
      code: string;
      name: string;
      siteType: string | null;
      lat: number;
      lon: number;
      bulletin: string | null;
      pm25: { index: number; band: string } | null;
    }> = [];

    let latest: string | null = null;

    for (const la of asArray(json.HourlyAirQualityIndex?.LocalAuthority)) {
      for (const site of asArray(la.Site)) {
        const lat = parseNum(site["@Latitude"]);
        const lon = parseNum(site["@Longitude"]);
        if (lat == null || lon == null || lat === 0 || lon === 0) continue;

        let pm25: { index: number; band: string } | null = null;
        for (const sp of asArray(site.Species)) {
          if (sp["@SpeciesCode"] !== "PM25") continue;
          const idx = parseNum(sp["@AirQualityIndex"]);
          if (idx != null && idx > 0) {
            pm25 = { index: idx, band: sp["@AirQualityBand"] || "" };
          }
        }

        const bulletin = site["@BulletinDate"] || null;
        if (bulletin && (!latest || bulletin > latest)) latest = bulletin;

        stations.push({
          code: site["@SiteCode"],
          name: site["@SiteName"],
          siteType: site["@SiteType"] || null,
          lat,
          lon,
          bulletin,
          pm25,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      source: "London Air Quality Network (Imperial College London)",
      updated: latest,
      stations,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
