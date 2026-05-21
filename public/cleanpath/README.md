# Clean Path · London

A privacy-first navigation prototype that helps people choose routes by air quality, not just by time. Two data sources, both real:

- **London Air (King's College / Imperial College ERG)** for ground-station PM2.5 readings, refreshed hourly. No API key.
- **Copernicus Atmosphere Monitoring Service (CAMS) Europe air quality forecast** for the regional context layer, fetched via the ADS API. Requires a free personal access token.

## What's on the map

- A real Leaflet map of central London (CARTO Positron tiles).
- Two cycling routes from Waterloo to Old Street, drawn as polylines. The fastest hugs Bishopsgate; the cleanest takes The Cut and Southwark Street.
- London Air monitoring sites as colored dots, with PM2.5 index 1–10 driving the color (green to dark red). Click any dot to see the site name and current band.
- A faint CAMS PM2.5 heatmap underneath, when the ADS API key is configured. Resolution is 0.1° (≈10 km), so this is regional context rather than street-level. Hovering between routes won't show a meaningful gradient at street scale.
- Route exposure scores in the right panel are sampled from the nearest London Air station to each waypoint, then averaged.

## Files

```
public/cleanpath/
├── index.html      Three screens (map, network, profile)
├── styles.css      Design tokens
├── app.js          Leaflet setup, fetch logic, slider, modals
└── README.md       This file

app/api/
├── london-air/route.ts   Proxies and reshapes London Air JSON
└── cams-pm25/route.ts    Calls the ADS API, parses NetCDF, returns a grid
```

## Local dev

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000/cleanpath/index.html`.

## Enable the Copernicus CAMS layer

The London Air layer works without any setup. To switch on the CAMS regional heatmap:

1. Register at [ads.atmosphere.copernicus.eu](https://ads.atmosphere.copernicus.eu/) (free, ~5 minutes).
2. Open your profile page, copy your **Personal Access Token**.
3. Accept the Terms of Use for the dataset `cams-europe-air-quality-forecasts` (one-time click).
4. Add the token as an env var:
   - Locally: `echo "CDSAPI_KEY=your-token-here" >> .env.local`
   - On Vercel: project → Settings → Environment Variables → add `CDSAPI_KEY`. Redeploy.

The status row under the map shows the current state: pending, ok with a forecast lead time, or offline with a reason.

## Notes on the data

- CAMS Europe is a modeled forecast on a ~10 km grid. It captures the haze plume drifting in from the continent and the broad inner-vs-outer-London gradient. It will *not* distinguish Bishopsgate from The Cut, because both fall inside the same grid cell. That's why we layer London Air on top: ground stations give the street-level texture.
- The London Air index is a 1–10 category (DEFRA Daily Air Quality Index), not µg/m³. The color scale and route scores both use this index directly.
- ADS submissions are async: the API route submits a job, polls, and downloads. Cold requests can take 30–60 seconds. Cached responses are nearly instant. The `s-maxage` header on the route caches successful responses at the CDN for 30 minutes.

## Privacy stance

Sensors read the environment, not people. Routing is computed on-device in the production vision; this prototype only renders read-only public data. There is no user account, no synced movement history, no advertising ID.

## License

For academic use under the DISL2701 module. Adapt freely.
