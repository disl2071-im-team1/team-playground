import { NextResponse } from "next/server";

export const revalidate = 600; // 10 min

// The integration layer (projects/pelle/integration-layer) polls WAQI, SMHI and
// luftdaten hourly and publishes an append-only JSONL store to the `data` branch.
// We read that store here so the map can showcase the unified, multi-source data.
const STORE_URL =
  "https://raw.githubusercontent.com/disl2071-im-team1/team-playground/data/projects/pelle/integration-layer/data/readings.jsonl";

type Reading = {
  source: string;
  metric: string;
  value: number;
  unit: string;
  station: string;
  lat: number | null;
  lon: number | null;
  timestamp: string;
  category: string;
};

type Entry = { metric: string; value: number; unit: string; timestamp: string };
type StationOut = {
  source: string;
  station: string;
  lat: number;
  lon: number;
  pollutants: Entry[];
  weather: Entry[];
};

export async function GET() {
  try {
    const res = await fetch(STORE_URL, { next: { revalidate: 600 } });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const text = await res.text();

    const readings: Reading[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        readings.push(JSON.parse(t) as Reading);
      } catch {
        // skip malformed line
      }
    }

    // Keep the latest reading per (source, station, metric); the store is
    // append-only and some sources report duplicates.
    const latest = new Map<string, Reading>();
    for (const r of readings) {
      if (r.lat == null || r.lon == null) continue;
      const key = `${r.source}|${r.station}|${r.metric}`;
      const prev = latest.get(key);
      if (!prev || r.timestamp > prev.timestamp) latest.set(key, r);
    }

    // Group into stations.
    const stations = new Map<string, StationOut>();
    let updated: string | null = null;
    for (const r of latest.values()) {
      if (!updated || r.timestamp > updated) updated = r.timestamp;
      const skey = `${r.source}|${r.station}`;
      let s = stations.get(skey);
      if (!s) {
        s = {
          source: r.source,
          station: r.station,
          lat: r.lat as number,
          lon: r.lon as number,
          pollutants: [],
          weather: [],
        };
        stations.set(skey, s);
      }
      const entry: Entry = {
        metric: r.metric,
        value: r.value,
        unit: r.unit,
        timestamp: r.timestamp,
      };
      if (r.category === "pollutant") s.pollutants.push(entry);
      else if (r.category === "weather") s.weather.push(entry);
    }

    const out = [...stations.values()].filter((s) => s.pollutants.length > 0);
    const bySource: Record<string, number> = {};
    for (const s of out) bySource[s.source] = (bySource[s.source] || 0) + 1;

    return NextResponse.json({
      ok: true,
      source: "Stockholm integration layer (data branch)",
      updated,
      count: out.length,
      bySource,
      stations: out,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
