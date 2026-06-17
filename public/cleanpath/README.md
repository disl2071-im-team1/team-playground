# Clean Path · Stockholm

A privacy-first navigation prototype that helps people choose routes by air quality, not just by time. Two data sources, both real:

> **Heat tab.** Clean Path also carries a **Heat** tab, which embeds [Värmevakt](../varmevakt/README.md), a municipal heat-planning module for city officers. Where Clean Path serves a resident, Värmevakt serves a preparedness coordinator: forecast heat against vulnerable facilities, timed before the peak. It runs as its own app under `public/varmevakt/` and is shown here in an iframe so the two design systems stay separate.


- **World Air Quality Index (WAQI / aqicn.org)** for ground-station readings across the Stockholm area, refreshed hourly. Requires a free API token.
- **Copernicus Atmosphere Monitoring Service (CAMS) Europe air quality forecast** for the regional context layer, fetched via the ADS API. Requires a free personal access token.

## What's on the map

- A real Leaflet map of central Stockholm (CARTO Positron tiles).
- Two cycling routes from Centralstation to Skanstull, drawn as polylines. The fastest cuts across Centralbron and down Götgatan; the cleanest follows the water past Riddarholmen and Söder Mälarstrand.
- WAQI monitoring sites as colored dots, with an air-quality index 1–10 driving the color (green to dark red). Click any dot to see the station name and current band.
- A faint CAMS PM2.5 heatmap underneath, when the ADS API key is configured. Resolution is 0.1° (≈10 km), so this is regional context rather than street-level.
- Route exposure scores in the right panel are sampled from the nearest WAQI station to each waypoint, then averaged.

## Files

```
public/cleanpath/
├── index.html      Three screens (map, network, profile)
├── styles.css      Design tokens
├── app.js          Leaflet setup, fetch logic, slider, modals
└── README.md       This file

app/api/
├── air-quality/route.ts   Calls WAQI bounds API, reshapes to a station list
└── cams-pm25/route.ts     Calls the ADS API, parses NetCDF, returns a grid
```

## Local dev

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000/cleanpath/index.html`.

## Enable the WAQI station layer

The colored station dots and the route exposure scores both come from WAQI, so this layer needs a token to work:

1. Request a free token at [aqicn.org/data-platform/token](https://aqicn.org/data-platform/token/) (instant, by email).
2. Add the token as an env var:
   - Locally: `echo "WAQI_TOKEN=your-token-here" >> .env.local`
   - On Vercel: project → Settings → Environment Variables → add `WAQI_TOKEN`. Redeploy.

Without it, the status row under the map shows "API token not configured" and the dots and scores stay empty.

## Enable the Copernicus CAMS layer

To switch on the CAMS regional heatmap:

1. Register at [ads.atmosphere.copernicus.eu](https://ads.atmosphere.copernicus.eu/) (free, ~5 minutes).
2. Open your profile page, copy your **Personal Access Token**.
3. Accept the Terms of Use for the dataset `cams-europe-air-quality-forecasts` (one-time click).
4. Add the token as an env var:
   - Locally: `echo "CDSAPI_KEY=your-token-here" >> .env.local`
   - On Vercel: project → Settings → Environment Variables → add `CDSAPI_KEY`. Redeploy.

The status row under the map shows the current state: pending, ok with a forecast lead time, or offline with a reason.

## Notes on the data

- WAQI reports a US-EPA style AQI per station. The API route maps that onto a 1–10 index so the existing color scale and route scoring keep working. It's a reasonable approximation for a prototype, not an official DEFRA/Naturvårdsverket index.
- CAMS Europe is a modeled forecast on a ~10 km grid. It captures the broad regional gradient over Stockholm but will not distinguish one street from the next, because neighbouring routes fall inside the same grid cell. That's why we layer WAQI ground stations on top for street-level texture.
- ADS submissions are async: the API route submits a job, polls, and downloads. Cold requests can take 30–60 seconds. Cached responses are nearly instant. The `s-maxage` header on the route caches successful responses at the CDN for 30 minutes.

## Privacy stance

Sensors read the environment, not people. Routing is computed on-device in the production vision; this prototype only renders read-only public data. There is no user account, no synced movement history, no advertising ID.

## License

For academic use under the DISL2701 module. Adapt freely.
