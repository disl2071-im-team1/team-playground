# Clean Path · London

A privacy-first navigation prototype that helps people choose routes by air quality, not just by time. Built for the DISL2701 Intelligent Machines module as an evolution of a privacy-preserving hardware vision into an intelligent, data-driven system.

**Live demo:** `https://your-project.vercel.app` (replace once deployed)

---

## What it does

Three connected screens demonstrate the concept:

1. **Map** — A heatmap of central London's air quality with two routes from Waterloo to Old Street: the fastest (via Bishopsgate) and the cleanest (via The Cut). Scrub the time slider to see how exposure shifts hour by hour.
2. **Network** — The mesh architecture. Sensors across the city communicate peer-to-peer; there is no central server collecting user data. A threat model panel surfaces what happens under three different adversary scenarios.
3. **Profile** — Sam Reyes' personal exposure dashboard: today's ring, hourly bars, weekly trend, and gentle framing that resists turning health awareness into health anxiety.

## Stack

Plain HTML, CSS, and vanilla JavaScript. No build step, no framework, no external runtime dependencies. The entire prototype is three files plus this README.

```
clean-path/
├── index.html      Entry point with all three screens
├── styles.css      Design tokens and styling
├── app.js          Tab switching, slider, info modals
├── vercel.json     Static site config
└── README.md       This file
```

## Run locally

No build, no install. Open `index.html` in a browser, or serve it on a local port:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

Then visit `http://localhost:8000`.

## Deploy to Vercel

### Option A — via the Vercel dashboard (easiest)

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub.
3. Click **Add New Project**, select the repo.
4. Vercel auto-detects it as a static site. Leave all defaults.
5. Click **Deploy**. You'll get a URL like `clean-path-london.vercel.app` in about 30 seconds.

Every subsequent `git push` to `main` auto-deploys.

### Option B — via the Vercel CLI

```bash
npm i -g vercel
vercel
# follow the prompts, accept defaults
```

## Codespaces workflow

If you're editing in GitHub Codespaces:

1. Open the repo in Codespaces (green **Code** button on the repo page).
2. Edit any of the three files.
3. To preview, run `python3 -m http.server 8000` in the terminal — Codespaces will offer to forward the port.
4. Commit and push when ready; Vercel redeploys on push.

## Design notes

A few choices worth flagging:

- **Profile, not dashboard.** The third screen is framed as a personal profile rather than a metrics dashboard. The framing matters: a profile is something you own and edit; a dashboard is something the system maintains about you.
- **Streets named everywhere.** Bishopsgate, The Cut, Holborn Viaduct, Southwark Street, Theobalds Road — the prototype grounds the abstract "exposure score" in real London geography so the trade-offs feel concrete.
- **Gentle note on the profile.** The greenest design failure for a pollution-tracking app is health anxiety. The note at the bottom of the profile screen is a design statement, not decoration.
- **The crossed-out central server.** In the Network screen, the explicit absence of a server is the load-bearing detail. It's saying *this is where Google would be, and it's not here.*

## Privacy stance

Sensors read the environment, not people. Routing is computed on-device. There is no user account, no synced movement history, no advertising ID. The "Anonymous ID" chip on Sam's profile rotates daily on-device and is never transmitted.

The prototype is mock data — production would draw from London Air (King's College ground stations) and a hypothetical mesh of low-cost sensors. CAMS satellite-modelled data at ~10 km resolution is too coarse for street-level routing.

## License

For academic use under the DISL2701 module. Adapt freely for the assignment.
