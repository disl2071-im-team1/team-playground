import { NextResponse } from "next/server";

export const revalidate = 10800; // 3h — pollen forecasts refresh at most daily

const SOURCE =
  "Naturhistoriska riksmuseet / Palynologiska laboratoriet — Pollenrapporten Open Pollen API (PLUPP v1)";
const API = "https://api.pollenrapporten.se/v1";

// Central Stockholm — the nearest forecast region to this point is resolved
// from the API's region list (not hardcoded).
const STHLM = { lat: 59.33, lon: 18.06 };

// Swedish pollen name → English label + emoji. Icons reuse the original
// POLLEN_DEMO choices; unmapped types fall back to the Swedish name + a leaf.
const NAME_MAP: Record<string, { en: string; icon: string }> = {
  Gräs: { en: "Grass", icon: "🌾" },
  Gråbo: { en: "Mugwort", icon: "🌿" },
  Nässla: { en: "Nettle", icon: "🍃" },
  Björk: { en: "Birch", icon: "🌳" },
  Hassel: { en: "Hazel", icon: "🌰" },
  Al: { en: "Alder", icon: "🌱" },
  "Sälg och viden": { en: "Willow", icon: "🌿" },
  Alm: { en: "Elm", icon: "🌳" },
  Bok: { en: "Beech", icon: "🌳" },
  Ek: { en: "Oak", icon: "🌳" },
  Tall: { en: "Pine", icon: "🌲" },
  Malörtsambrosia: { en: "Ragweed", icon: "🌿" },
};

type Region = { id: string; name: string; longitude: number; latitude: number };
type PollenType = { id: string; name: string };
type PollenLevel = { pollenId: string; level: number; time: string };
type Forecast = { id: string; regionId: string; startDate: string; endDate: string; levelSeries?: PollenLevel[] };
type Paginated<T> = { items: T[] };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 10800 },
  });
  if (!res.ok) throw new Error(`pollen API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function GET() {
  try {
    // 1. Resolve the region nearest central Stockholm from the API's list.
    const regions = (await getJson<Paginated<Region>>("/regions?limit=200")).items.filter(
      (r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)),
    );
    if (!regions.length) throw new Error("no regions returned");
    const region = regions.reduce(
      (best, r) => {
        const d = (Number(r.latitude) - STHLM.lat) ** 2 + (Number(r.longitude) - STHLM.lon) ** 2;
        return d < best.d ? { r, d } : best;
      },
      { r: regions[0], d: Infinity },
    ).r;

    // 2. Current forecast for that region + the pollen-type id→name map.
    const [forecasts, types] = await Promise.all([
      getJson<Paginated<Forecast>>(`/forecasts?region_id=${region.id}&current=true&limit=1`),
      getJson<Paginated<PollenType>>("/pollen-types?limit=200"),
    ]);
    const forecast = forecasts.items[0];
    if (!forecast || !Array.isArray(forecast.levelSeries) || !forecast.levelSeries.length) {
      throw new Error("no current forecast");
    }
    const nameById = new Map(types.items.map((t) => [t.id, t.name]));

    // 3. Per pollen type, take the level for the forecast's current day.
    const day = forecast.startDate; // e.g. "2026-06-24"
    const series = new Map<string, PollenLevel[]>();
    for (const pl of forecast.levelSeries) {
      if (typeof pl.level !== "number" || !pl.pollenId) continue;
      const arr = series.get(pl.pollenId) ?? [];
      arr.push(pl);
      series.set(pl.pollenId, arr);
    }

    const out = [...series.entries()].map(([pid, arr]) => {
      arr.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      const todays = arr.find((p) => String(p.time).startsWith(day)) ?? arr[0];
      const sv = nameById.get(pid) ?? "Okänd";
      const m = NAME_MAP[sv] ?? { en: sv, icon: "🌿" };
      return { name: m.en, sv, level: todays.level, icon: m.icon };
    });
    out.sort((a, b) => b.level - a.level); // highest pollen first

    return NextResponse.json(
      { ok: true, source: SOURCE, region: region.name, updated: day, scaleMax: 7, types: out },
      { headers: { "Cache-Control": "s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
