# Värmevakt · municipal heat planning

A heatwave preparedness prototype for a municipal officer, not a consumer. The framing is that a meteorological station (Nimbus Väder) built it and offers it to municipalities. Built against [REQUIREMENTS.md](./REQUIREMENTS.md).

## Who it serves

A preparedness coordinator working across social services and elderly care. When SMHI issues a värmebölja warning, they have to decide **when** to activate the heat plan and **which** areas and groups to reach first. Värmevakt puts forecast heat next to where vulnerable people are, so relief lands before the peak.

## What's on screen

- **Trigger banner** — detects the SMHI värmebölja condition (max temp ≥ 25°C for 3+ consecutive days), names the onset, the peak, and an "act by" day.
- **Map** — Stockholm districts coloured by forecast temperature (sunset scale), with care homes and preschools overlaid.
- **Timeline** — the 7-day outlook as day chips. Slide to the peak; today, peak, and act-by are tagged.
- **Priority areas** — districts ranked by forecast heat weighted against vulnerable facilities (elderly care counts double). Click one to fly the map to it.
- **Layers + confidence** — temperature is marked *measured*; the algae and wildfire layers are marked *modelled* and stay off until built. The contrast is deliberate.

## How it maps to the requirements

R1 measured heat layer · R2 facility overlay · R3 värmebölja threshold + persistence · R4 lead time to peak · R5 prioritisation · R6 confidence labels · R7 officer framing.

## Stack and data

Plain HTML, CSS, and JS with Leaflet (CARTO Positron tiles). No build step, no framework, no keys. The forecast is **demo data shaped like SMHI output**; production would read measured SMHI station data. Kept vanilla on purpose: it is a small, self-contained prototype.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/varmevakt/index.html`.

## Style

80's synthwave / Memphis: cream background, deep purple-navy ink, hard offset shadows, a sunset heat palette (cyan through yellow, orange, magenta). Playful but legible, because the decision behind it is not.
