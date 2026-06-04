(function () {
  'use strict';

  /* --------------------------------------------------------
   * Tabs + modal + slider scaffolding (carried over)
   * ------------------------------------------------------ */

  const tabs = document.querySelectorAll('.tab');
  const screens = document.querySelectorAll('.screen');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(x => {
        x.classList.remove('active');
        x.setAttribute('aria-selected', 'false');
      });
      screens.forEach(s => s.classList.remove('active'));
      t.classList.add('active');
      t.setAttribute('aria-selected', 'true');
      document.getElementById('screen-' + t.dataset.screen).classList.add('active');
      if (t.dataset.screen === 'map' && window._leafletMap) {
        setTimeout(() => window._leafletMap.invalidateSize(), 50);
      }
      if (t.dataset.screen === 'calm' && calmRouteMap) {
        setTimeout(() => calmRouteMap.invalidateSize(), 50);
      }
    });
  });

  const slider = document.getElementById('time-slider');
  const sliderTime = document.getElementById('slider-time');
  const timeLabel = document.getElementById('time-label');
  const periodLabel = document.getElementById('period-label');
  const advice = document.getElementById('advice');
  const rfScore = document.querySelector('.rf-score');
  const rcScore = document.querySelector('.rc-score');
  const rfBar = document.querySelector('.rf-bar');
  const rcBar = document.querySelector('.rc-bar');

  function bucket(h) {
    if (h < 6) return 'Night';
    if (h < 10) return 'Rush hour';
    if (h < 14) return 'Midday';
    if (h < 17) return 'Afternoon';
    if (h < 20) return 'Evening rush';
    return 'Late';
  }

  /* --------------------------------------------------------
   * Leaflet map: base layer, routes, terminals
   * ------------------------------------------------------ */

  const ROUTES = {
    fast: {
      name: 'Fastest via Centralbron',
      color: '#E24B4A',
      coords: [
        [59.3306, 18.0586], // Centralstation
        [59.3258, 18.0635], // Tegelbacken
        [59.3210, 18.0680], // Centralbron
        [59.3197, 18.0712], // Slussen
        [59.3137, 18.0745], // Götgatan
        [59.3076, 18.0786]  // Skanstull
      ]
    },
    clean: {
      name: 'Cleanest via Söder Mälarstrand',
      color: '#0F6E56',
      coords: [
        [59.3306, 18.0586], // Centralstation
        [59.3272, 18.0558], // Klara sjö
        [59.3233, 18.0530], // Riddarholmen
        [59.3185, 18.0560], // Söder Mälarstrand
        [59.3120, 18.0660], // Zinkensdamm
        [59.3076, 18.0786]  // Skanstull
      ]
    },
    quiet: {
      name: 'Quietest via Långholmen',
      color: '#1B6FDB',
      avgDb: 54,
      coords: [
        [59.3306, 18.0586], // Centralstation
        [59.3283, 18.0528], // Klara sjö west
        [59.3238, 18.0478], // Rådhuset
        [59.3185, 18.0498], // Långholmen (park)
        [59.3145, 18.0570], // Liljeholmen east
        [59.3100, 18.0690], // Hornstull
        [59.3076, 18.0786]  // Skanstull
      ]
    }
  };

  // dB averages for noise reduction % calculation
  const ROUTE_DB = { fast: 76, clean: 65, quiet: 54 };

  function calcNoiseReduction() {
    const ref = (ROUTE_DB.fast + ROUTE_DB.clean) / 2;
    return Math.round(((ref - ROUTE_DB.quiet) / ref) * 100);
  }

  function indexToColor(idx) {
    if (idx == null) return '#9CA3AF';
    if (idx <= 3) return '#1D9E75';
    if (idx <= 6) return '#EF9F27';
    if (idx <= 9) return '#E24B4A';
    return '#7F1D1D';
  }

  function indexBand(idx) {
    if (idx == null) return 'No data';
    if (idx <= 3) return 'Low';
    if (idx <= 6) return 'Moderate';
    if (idx <= 9) return 'High';
    return 'Very high';
  }

  let leafletMap, stationsLayer, camsLayer, integrationLayer, greenAreasLayer;

  function initMap() {
    if (typeof L === 'undefined') {
      // Leaflet not loaded yet, retry shortly
      setTimeout(initMap, 50);
      return;
    }

    leafletMap = L.map('leaflet-map', {
      zoomControl: true,
      attributionControl: true
    }).setView([59.3210, 18.0660], 13);

    window._leafletMap = leafletMap;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(leafletMap);

    // Green areas pane sits below the default overlayPane (z 400) so parks
    // never obscure routes or station markers.
    leafletMap.createPane('greenAreas');
    leafletMap.getPane('greenAreas').style.zIndex = '350';
    greenAreasLayer = L.layerGroup().addTo(leafletMap);

    // Routes: glow halo drawn first so it sits behind the main line
    Object.entries(ROUTES).forEach(([, r]) => {
      L.polyline(r.coords, {
        color: r.color,
        weight: 22,
        opacity: 0.08,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(leafletMap);
    });

    // Routes: main line
    Object.entries(ROUTES).forEach(([, r]) => {
      L.polyline(r.coords, {
        color: r.color,
        weight: 5,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).bindTooltip(r.name, { sticky: true }).addTo(leafletMap);
    });

    // Terminals
    const startEnd = [
      { latlng: ROUTES.fast.coords[0], label: 'Centralstation', kind: 'start' },
      { latlng: ROUTES.fast.coords[ROUTES.fast.coords.length - 1], label: 'Skanstull', kind: 'end' }
    ];
    startEnd.forEach(p => {
      L.circleMarker(p.latlng, {
        radius: 7,
        fillColor: p.kind === 'start' ? '#FFFFFF' : '#2C2C2A',
        color: '#2C2C2A',
        weight: 2,
        fillOpacity: 1
      }).bindTooltip(p.label, { permanent: true, direction: 'top', offset: [0, -8], className: 'route-end-label' }).addTo(leafletMap);
    });

    // Layer groups
    stationsLayer = L.layerGroup().addTo(leafletMap);
    camsLayer = L.layerGroup().addTo(leafletMap);
    integrationLayer = L.layerGroup().addTo(leafletMap);

    // Legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <strong>PM2.5 (WAQI)</strong>
        <div><span class="swatch" style="background:#1D9E75"></span>Low (index 1-3)</div>
        <div><span class="swatch" style="background:#EF9F27"></span>Moderate (4-6)</div>
        <div><span class="swatch" style="background:#E24B4A"></span>High (7-9)</div>
        <div><span class="swatch" style="background:#7F1D1D"></span>Very high (10)</div>
        <strong style="margin-top:6px">Integration layer (source)</strong>
        <div><span class="swatch" style="background:#fff;border:3px solid #534AB7"></span>SMHI (official µg/m³)</div>
        <div><span class="swatch" style="background:#fff;border:3px solid #E07B00"></span>WAQI (AQI index)</div>
        <div><span class="swatch" style="background:#fff;border:3px solid #0F6E56"></span>luftdaten (community)</div>
        <strong style="margin-top:6px">Green spaces</strong>
        <div><span class="swatch" style="background:#bbf7d0;border:1px solid #4ade80"></span>Parks &amp; gardens</div>
        <strong style="margin-top:6px">Routes</strong>
        <div><span class="line" style="background:#E24B4A"></span>Fastest</div>
        <div><span class="line" style="background:#0F6E56"></span>Cleanest</div>
        <div><span class="line" style="background:#1B6FDB"></span>Quietest</div>
      `;
      return div;
    };
    legend.addTo(leafletMap);

    // Layer toggle control
    const overlayCtrl = L.control({ position: 'topleft' });
    overlayCtrl.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend overlay-select');
      div.innerHTML = `
        <strong>Layers</strong>
        <button class="src-btn active" data-layer="cams">
          <span class="src-dot" style="background:rgba(226,75,74,0.65)"></span>CAMS forecast
        </button>
        <button class="src-btn active" data-layer="integration">
          <span class="src-dot" style="background:#534AB7"></span>Integration layer
        </button>
        <button class="src-btn active" data-layer="stations">
          <span class="src-dot" style="background:#1D9E75"></span>WAQI stations
        </button>
      `;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    overlayCtrl.addTo(leafletMap);

    const layerByKey = { stations: stationsLayer, integration: integrationLayer, cams: camsLayer };
    overlayCtrl.getContainer().querySelectorAll('.src-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lyr = layerByKey[btn.dataset.layer];
        if (!lyr) return;
        const isOn = leafletMap.hasLayer(lyr);
        btn.classList.toggle('active', !isOn);
        if (isOn) lyr.remove(); else lyr.addTo(leafletMap);
      });
    });
  }

  /* --------------------------------------------------------
   * Live data: WAQI ground stations
   * ------------------------------------------------------ */

  function setStatus(which, state, detail) {
    const item = document.getElementById('status-' + which);
    if (!item) return;
    const dot = item.querySelector('.status-dot');
    dot.classList.remove('pending', 'ok', 'offline');
    dot.classList.add(state);
    const det = document.getElementById('status-' + which + '-detail');
    if (det) det.textContent = detail;
  }

  async function loadStations() {
    setStatus('stations', 'pending', 'loading…');
    try {
      const res = await fetch('/api/air-quality', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) {
        if (data.configured === false) throw new Error('API token not configured');
        throw new Error(data.reason || 'unknown error');
      }

      stationsLayer.clearLayers();
      let withPm25 = 0;
      data.stations.forEach(s => {
        const idx = s.pm25 != null ? s.pm25.index : null;
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 6,
          fillColor: indexToColor(idx),
          color: '#FFFFFF',
          weight: 1.5,
          fillOpacity: 0.95
        });
        const valueHtml = idx != null
          ? `<div class="station-value" style="color:${indexToColor(idx)}">PM2.5 index ${idx} · ${indexBand(idx)}</div>`
          : `<div class="station-value" style="color:#9CA3AF">No PM2.5 reading</div>`;
        marker.bindPopup(`
          <div class="station-popup">
            <strong>${escapeHtml(s.name)}</strong>
            <div class="station-meta">${escapeHtml(s.code)} · ${escapeHtml(s.siteType || '')}</div>
            ${valueHtml}
          </div>
        `);
        marker.addTo(stationsLayer);
        if (idx != null) withPm25 += 1;
      });

      setStatus('stations', 'ok', `${data.stations.length} sites · ${withPm25} reporting PM2.5`);
      updateRouteScores(data);
      return data;
    } catch (err) {
      setStatus('stations', 'offline', 'unavailable (' + err.message + ')');
      return null;
    }
  }

  /* --------------------------------------------------------
   * Integration layer: unified multi-source store (data branch)
   * ------------------------------------------------------ */

  const SOURCE_COLORS = {
    smhi: '#534AB7',
    waqi: '#E07B00',
    luftdaten: '#0F6E56'
  };

  // Holds the single /api/stockholm-air response so the map overlay and the
  // Network section's "data reality" cards share one fetch (no duplicate calls).
  let integrationData = null;

  async function loadIntegrationLayer() {
    setStatus('integration', 'pending', 'loading…');
    try {
      const res = await fetch('/api/stockholm-air', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.reason || 'unavailable');
      integrationData = data;

      integrationLayer.clearLayers();
      data.stations.forEach(s => {
        const color = SOURCE_COLORS[s.source] || '#5F5E5A';

        // Area influence zone: soft coloured circle showing the station's reach
        L.circle([s.lat, s.lon], {
          radius: 450,
          fillColor: color,
          color: color,
          weight: 0,
          fillOpacity: 0.1,
          interactive: false
        }).addTo(integrationLayer);

        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 7,
          fillColor: '#FFFFFF',
          color: color,
          weight: 3,
          fillOpacity: 0.9
        });
        const rows = s.pollutants.map(p =>
          `<div class="station-value" style="color:${color}">${escapeHtml(p.metric.toUpperCase())} ${p.value} ${escapeHtml(p.unit)}</div>`
        ).join('');
        const when = (s.pollutants[0] || {}).timestamp || '';
        marker.bindPopup(`
          <div class="station-popup">
            <strong>${escapeHtml(s.station)}</strong>
            <div class="station-meta">source: ${escapeHtml(s.source)} · ${escapeHtml(when)}</div>
            ${rows}
          </div>
        `);
        marker.addTo(integrationLayer);
      });

      const summary = Object.entries(data.bySource || {})
        .map(([k, v]) => `${v} ${k}`).join(' · ');
      setStatus('integration', 'ok', `${data.stations.length} stations · ${summary}`);
      renderDataReality();
    } catch (err) {
      setStatus('integration', 'offline', 'unavailable (' + err.message + ')');
      renderDataReality();
    }
  }

  /* --------------------------------------------------------
   * Network section: "the same air, measured three ways"
   * Features PM10 from all three sources, with real values and real units,
   * to show they disagree. Reuses integrationData (no extra fetch). Numbers
   * are pulled live from the store; nothing here is hardcoded.
   * ------------------------------------------------------ */

  const DR_METRIC = 'pm10';
  const DR_REF = [59.334, 18.063]; // central Stockholm: compare the same area
  const DR_ORDER = ['smhi', 'waqi', 'luftdaten'];
  const DR_LABEL = { smhi: 'SMHI', waqi: 'WAQI', luftdaten: 'luftdaten' };
  const DR_KIND = {
    smhi: 'National environmental agency',
    waqi: 'Commercial aggregator',
    luftdaten: 'Citizen sensor network'
  };

  function unitLabel(u) {
    return u === 'aqi' ? 'AQI index' : u;
  }

  // Nearest station of one source to the reference point that has DR_METRIC.
  function drNearest(source) {
    if (!integrationData || !integrationData.stations) return null;
    let best = null, bestD = Infinity;
    integrationData.stations.forEach(s => {
      if (s.source !== source) return;
      const p = (s.pollutants || []).find(x => x.metric === DR_METRIC);
      if (!p) return;
      const dx = s.lat - DR_REF[0], dy = (s.lon - DR_REF[1]) * Math.cos(DR_REF[0] * Math.PI / 180);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { value: p.value, unit: p.unit, station: s.station, timestamp: p.timestamp }; }
    });
    return best;
  }

  function renderDataReality() {
    const host = document.getElementById('data-reality-cards');
    const notesHost = document.getElementById('data-reality-notes');
    if (!host) return;
    if (!integrationData || !integrationData.stations) {
      host.innerHTML = '<div class="dr-empty">Live data unavailable right now.</div>';
      if (notesHost) notesHost.innerHTML = '';
      return;
    }
    const readings = {};
    DR_ORDER.forEach(src => { readings[src] = drNearest(src); });

    host.innerHTML = DR_ORDER.map(src => {
      const c = SOURCE_COLORS[src] || '#5F5E5A';
      const r = readings[src];
      const value = r ? r.value : '—';
      const unit = r ? unitLabel(r.unit) : 'no PM10 reading';
      const meta = r
        ? `${escapeHtml(r.station)} · ${escapeHtml(r.timestamp)}`
        : 'no current PM10 reading';
      return `
        <div class="dr-card" style="border-top:3px solid ${c}">
          <div class="dr-source" style="color:${c}">${DR_LABEL[src]}</div>
          <div class="dr-kind">${DR_KIND[src]}</div>
          <div class="dr-value" style="color:${c}">${value} <span class="dr-unit">${escapeHtml(unit)}</span></div>
          <div class="dr-meta">${meta}</div>
        </div>`;
    }).join('');

    if (notesHost) notesHost.innerHTML = drNotes(readings);
  }

  // Honest caveats, derived from the actual readings (not hardcoded).
  function drNotes(readings) {
    const notes = [];
    const times = DR_ORDER.map(s => readings[s] && readings[s].timestamp).filter(Boolean);
    if (new Set(times).size > 1) {
      notes.push('These readings are from slightly different times (each card shows its own timestamp) — snapshots of the same air, not the same instant.');
    }
    const ld = readings.luftdaten;
    if (ld && typeof ld.value === 'number' && ld.value < 1) {
      notes.push(`luftdaten’s ${ld.value} µg/m³ reading is implausibly low for a city street, most likely noise from a low-cost citizen sensor — itself a reminder that the source and instrument quality matter.`);
    }
    return notes.map(n => `<div class="dr-note">${escapeHtml(n)}</div>`).join('');
  }

  /* --------------------------------------------------------
   * Copernicus CAMS heatmap (server-proxied)
   * ------------------------------------------------------ */

  let camsHeat = null;
  let camsResponse = null;
  let camsAvailable = false;

  async function loadCams(hour) {
    setStatus('cams', 'pending', 'fetching forecast…');
    try {
      const url = '/api/cams-pm25' + (hour != null ? `?hour=${hour}` : '');
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) {
        camsAvailable = false;
        if (data.configured === false) {
          setStatus('cams', 'offline', 'API key not configured');
        } else {
          setStatus('cams', 'offline', data.reason || 'unavailable');
        }
        return null;
      }
      camsAvailable = true;
      camsResponse = data;
      renderCamsHeat(data);
      const updated = data.updated ? new Date(data.updated) : null;
      const ts = updated ? `${updated.toUTCString().slice(17, 22)} UTC` : '';
      setStatus('cams', 'ok', `forecast +${data.forecastHour}h${ts ? ' · base ' + ts : ''}`);
      return data;
    } catch (err) {
      setStatus('cams', 'offline', 'error (' + err.message + ')');
      return null;
    }
  }

  function renderCamsHeat(data) {
    if (!camsLayer || !data || !data.grid) return;
    camsLayer.clearLayers();
    if (typeof L.heatLayer !== 'function') {
      // Fallback: draw colored squares if heat plugin missing
      data.grid.forEach(([lat, lon, v]) => {
        L.rectangle(
          [[lat - 0.05, lon - 0.05], [lat + 0.05, lon + 0.05]],
          { color: pm25ToColor(v), weight: 0, fillOpacity: 0.25 }
        ).addTo(camsLayer);
      });
      return;
    }
    // Normalise intensity for leaflet.heat (0..1)
    const max = Math.max(15, ...data.grid.map(p => p[2]));
    const heatData = data.grid.map(([lat, lon, v]) => [lat, lon, Math.min(1, v / max)]);
    camsHeat = L.heatLayer(heatData, {
      radius: 28,
      blur: 24,
      minOpacity: 0.25,
      max: 1.0,
      gradient: {
        0.0: 'rgba(151, 196, 89, 0)',
        0.2: 'rgba(151, 196, 89, 0.7)',
        0.4: 'rgba(250, 199, 117, 0.75)',
        0.6: 'rgba(239, 159, 39, 0.8)',
        0.8: 'rgba(226, 75, 74, 0.85)',
        1.0: 'rgba(127, 29, 29, 0.9)'
      }
    });
    camsHeat.addTo(camsLayer);
  }

  function pm25ToColor(v) {
    if (v < 10) return '#97C459';
    if (v < 20) return '#FAC775';
    if (v < 35) return '#EF9F27';
    if (v < 55) return '#E24B4A';
    return '#7F1D1D';
  }

  /* --------------------------------------------------------
   * Route exposure scores (sampled from WAQI stations)
   * ------------------------------------------------------ */

  function nearestStationIndex(lat, lon, stations) {
    let best = null, bestDist = Infinity;
    for (const s of stations) {
      if (s.pm25 == null || s.pm25.index == null) continue;
      const dx = (s.lat - lat), dy = (s.lon - lon);
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best ? best.pm25.index : null;
  }

  function routeExposureScore(route, stations) {
    let sum = 0, n = 0;
    for (const [lat, lon] of route.coords) {
      const idx = nearestStationIndex(lat, lon, stations);
      if (idx != null) { sum += idx; n += 1; }
    }
    if (n === 0) return null;
    const avg = sum / n;
    // Map 1..10 index to 0..100 exposure score
    return Math.round((avg / 10) * 100);
  }

  function updateRouteScores(airData) {
    if (!airData || !airData.stations) return;
    const fast = routeExposureScore(ROUTES.fast, airData.stations);
    const clean = routeExposureScore(ROUTES.clean, airData.stations);
    if (fast != null && rfScore && rfBar) {
      rfScore.textContent = fast;
      rfBar.style.width = fast + '%';
    }
    if (clean != null && rcScore && rcBar) {
      rcScore.textContent = clean;
      rcBar.style.width = clean + '%';
    }
    if (fast != null && clean != null && advice) {
      const diff = fast - clean;
      if (diff >= 15) {
        advice.textContent = `Right now the cleanest route is about ${diff} points lower than the fastest. The detour is worth the trade.`;
      } else if (diff >= 5) {
        advice.textContent = `Modest gap today (${diff} points). The cleaner route still helps, but the air is reasonably similar on both.`;
      } else {
        advice.textContent = `The stations say the two routes are close today. Take whichever fits your schedule.`;
      }
    }
  }

  /* --------------------------------------------------------
   * Slider: forecast hour for CAMS
   * ------------------------------------------------------ */

  function updateSlider() {
    const h = parseInt(slider.value, 10);
    const hh = String(h).padStart(2, '0') + ':00';
    sliderTime.textContent = hh;
    if (timeLabel) timeLabel.textContent = hh;
    if (periodLabel) periodLabel.textContent = bucket(h);
  }

  let camsDebounce;
  if (slider) {
    slider.addEventListener('input', () => {
      updateSlider();
      if (!camsAvailable) return;
      clearTimeout(camsDebounce);
      camsDebounce = setTimeout(() => {
        const h = parseInt(slider.value, 10);
        const now = new Date().getUTCHours();
        const lead = ((h - now) + 24) % 24;
        loadCams(lead);
      }, 350);
    });
    updateSlider();
  }

  /* --------------------------------------------------------
   * Modal logic (carried over)
   * ------------------------------------------------------ */

  const modal = document.getElementById('modal');
  const modalEyebrow = document.getElementById('modal-eyebrow');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  const info = {
    fast: {
      eyebrow: 'Route detail',
      title: 'Fastest route via Centralbron',
      body: `<p>This route cuts across Centralbron and down Götgatan to save a few minutes. Both are heavy traffic corridors, so PM2.5 and NO₂ peak here during commuting hours.</p>
             <p>The score in the panel is computed live from the nearest WAQI ground stations to each waypoint on this route. It moves with the actual air, not a mockup.</p>`
    },
    clean: {
      eyebrow: 'Route detail',
      title: 'Cleanest route via Söder Mälarstrand',
      body: `<p>This route hugs the water past Riddarholmen and Söder Mälarstrand, away from the main traffic arteries, then climbs to Skanstull through quieter Södermalm streets.</p>
             <p>The score is sampled from the same network of WAQI sites as the fastest route, so the comparison is apples-to-apples.</p>`
    },
    quiet: {
      eyebrow: 'Route detail',
      title: 'Quietest route via Långholmen',
      body: `<p>This route goes west from Centralstation, through Rådhuset, across to Långholmen — a park island with almost no motor traffic — then east through Hornstull to Skanstull. Average noise along this path is around 54 dB, well below the 80 dB alert threshold.</p>
             <p>Ten extra minutes compared to the fastest, but the only option that avoids both Centralbron and Götgatan entirely. Noise data is modelled from Bullerkartan 2022 (Stockholm Stad open data), covering road, rail, and air traffic sources equally.</p>`
    },
    'arch-sources': {
      eyebrow: 'Data reality',
      title: 'Three sources, three answers',
      body: `<p>The same air is measured by an official agency (SMHI), a commercial aggregator (WAQI), and a citizen sensor network (luftdaten). They report different values, sometimes in different units, an AQI index is not µg/m³.</p>
             <p>This prototype shows all three side by side rather than picking one and calling it the truth.</p>`
    },
    'arch-outliers': {
      eyebrow: 'Data reality',
      title: 'Outliers are kept, not hidden',
      body: `<p>There is no mesh and no automatic consensus filtering. When a low-cost citizen sensor reports an implausible value (like a 0.1 µg/m³ PM10 reading on a city street), the integration layer keeps it and flags it with a note, rather than silently rejecting it.</p>
             <p>Nothing is dropped on the way into the store, so you can always see what each source actually said.</p>`
    },
    'arch-prototype': {
      eyebrow: 'Data reality',
      title: 'A prototype, not a product',
      body: `<p>There are no user accounts, no phone app, and no on-device routing. The integration layer polls public APIs once an hour, normalises the readings to one schema, and appends them to a shared store that this page reads.</p>
             <p>Because it polls hourly, readings can be an hour or more old, and real-time data from the sources is preliminary.</p>`
    },
    'profile-edit': {
      eyebrow: 'Profile',
      title: 'What Sam can edit, and what we don’t ask',
      body: `<p><strong>Editable:</strong> neighbourhood, travel modes, sensitivity preferences, notification settings, accessibility needs.</p>
             <p><strong>Never asked:</strong> legal name, email, phone, date of birth, employer, health record number.</p>`
    },
    trend: {
      eyebrow: 'Weekly trend',
      title: 'What’s driving the high days',
      body: `<p>Weekday peaks line up with the Centralbron commute. Weekends drop along the Söder Mälarstrand waterfront, which sits in a cleaner pocket.</p>
             <p>The route, more than the effort, is what moves the number.</p>`
    },
    context: {
      eyebrow: 'Context',
      title: 'What does this exposure score mean?',
      body: `<p>The score is normalised against WHO PM2.5 guidelines (5 µg/m³ annual mean, 15 µg/m³ 24-hour mean). A score of 38 means today's exposure is roughly 38% of the daily threshold.</p>
             <p>Anything below 50 on a typical workday is good for inner Stockholm. Above 70 starts to add up over weeks for sensitive groups.</p>`
    },
    improve: {
      eyebrow: 'Practical',
      title: 'Realistic ways to lower this',
      body: `<p><strong>Easy wins:</strong> Leave 20 minutes earlier or later to miss the 08:00 peak. Take Söder Mälarstrand instead of Centralbron when you can.</p>
             <p><strong>Harder, but real:</strong> Switch one cycle commute per week to a tunnelbana journey on days when surface PM2.5 is highest.</p>`
    },
    share: {
      eyebrow: 'Sharing',
      title: 'Share with GP · export, don’t sync',
      body: `<p>Clean Path generates a signed PDF on your phone, a 30-day summary with daily exposure scores, weekly averages, and notable events. You hand it to your GP yourself.</p>`
    }
  };

  function openModal(key) {
    const item = info[key];
    if (!item) return;
    modalEyebrow.textContent = item.eyebrow;
    modalTitle.textContent = item.title;
    modalBody.innerHTML = item.body;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-info]').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.info));
  });

  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }


  // === Pablo Santos — Forecast Tab ===

  const POLLUTANTS = ['PM2.5', 'PM10', 'NO₂'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function aqiColor(v) {
    if (v <= 33) return '#1D9E75';
    if (v <= 66) return '#EF9F27';
    return '#E24B4A';
  }

  // Deterministic seeded RNG (xmur3 + mulberry32)
  function seededRand(seed) {
    let h = seed ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 0xffffffff;
  }

  // Generate 7-day forecast seeded on date so values are stable per day
  function generateForecast() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dow = d.getDay(); // 0=Sun
      const seed = (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate());
      const r = seededRand(seed);
      // Weekend bias: lower AQI
      const base = (dow === 0 || dow === 6) ? 22 : 45;
      const variance = Math.round(r * 30 - 10);
      const aqi = Math.min(95, Math.max(10, base + variance));
      // Dominant pollutant cycles by day
      const pollutant = POLLUTANTS[seed % POLLUTANTS.length];
      // 24-hour profile: peaks at rush hours (08, 17-18)
      const hourly = Array.from({ length: 24 }, (_, h) => {
        const hr = seededRand(seed + h + 1);
        let hourBase = aqi * 0.7;
        if (h >= 7 && h <= 9) hourBase = aqi * 1.2;
        else if (h >= 16 && h <= 19) hourBase = aqi * 1.1;
        else if (h < 5 || h > 22) hourBase = aqi * 0.4;
        return Math.min(100, Math.max(5, Math.round(hourBase + hr * 15 - 7)));
      });
      days.push({ date: d, dow, aqi, pollutant, hourly });
    }
    return days;
  }

  let forecastData = [];
  let selectedForecastDay = 0;

  function renderForecastWeek(days) {
    const grid = document.getElementById('forecast-week-grid');
    if (!grid) return;
    const todayLabel = new Date();
    grid.innerHTML = days.map((d, i) => {
      const isToday = i === 0;
      const label = isToday ? 'Today' : DAY_NAMES[d.dow];
      const pct = (d.aqi / 100) * 100;
      return `
        <div class="forecast-day-col${i === selectedForecastDay ? ' selected' : ''}" data-day="${i}" role="button" tabindex="0" aria-label="${label} AQI ${d.aqi}">
          <div class="forecast-day-label${isToday ? ' today' : ''}">${label}</div>
          <div class="forecast-bar-wrap">
            <div class="forecast-bar" style="height:${Math.max(6, pct * 0.8)}%;background:${aqiColor(d.aqi)}"></div>
          </div>
          <div class="forecast-day-value" style="color:${aqiColor(d.aqi)}">${d.aqi}</div>
          <div class="forecast-day-pollutant">${d.pollutant}</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.forecast-day-col').forEach(el => {
      el.addEventListener('click', () => {
        selectedForecastDay = parseInt(el.dataset.day, 10);
        renderForecastWeek(forecastData);
        renderForecastDetail(forecastData[selectedForecastDay]);
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') el.click();
      });
    });
  }

  function renderForecastDetail(day) {
    const title = document.getElementById('forecast-detail-title');
    const bars = document.getElementById('forecast-hourly-bars');
    if (!title || !bars || !day) return;
    const isToday = selectedForecastDay === 0;
    const label = isToday ? 'Today' : DAY_NAMES[day.dow] + ' ' + day.date.toLocaleDateString('en-SE', { day: 'numeric', month: 'short' });
    title.textContent = label + ' · hour by hour';
    const max = Math.max(...day.hourly);
    bars.innerHTML = day.hourly.map((v, h) =>
      `<div class="forecast-hbar" style="height:${Math.max(3, (v / max) * 100)}%;background:${aqiColor(v)}" title="${String(h).padStart(2,'0')}:00 · AQI ${v}"></div>`
    ).join('');
  }

  function renderForecastSummary(days) {
    const body = document.getElementById('forecast-summary-body');
    if (!body || !days.length) return;
    const best = days.slice(0, 7).reduce((a, b) => a.aqi < b.aqi ? a : b);
    const worst = days.slice(0, 7).reduce((a, b) => a.aqi > b.aqi ? a : b);
    const tomorrow = days[1];
    // Best travel window: find lowest 2-hour block in today's hourly
    const today = days[0];
    let bestHour = 0, bestSum = Infinity;
    for (let h = 0; h < 22; h++) {
      const s = today.hourly[h] + today.hourly[h + 1];
      if (s < bestSum) { bestSum = s; bestHour = h; }
    }
    const bestHourStr = `${String(bestHour).padStart(2,'0')}:00–${String(bestHour + 2).padStart(2,'0')}:00`;
    const worstHours = today.hourly[8] > today.hourly[17] ? '07:00–09:00' : '16:00–19:00';
    const tomorrowRoute = tomorrow && tomorrow.aqi < 45 ? 'Either route is fine' : 'Take the Söder Mälarstrand route';
    body.innerHTML = `
      <div class="forecast-summary-row">
        <span class="forecast-summary-tag">Best window</span>
        <span class="forecast-summary-text">Today's cleanest air is around <strong>${bestHourStr}</strong>. Good time for a run or a low-exposure commute.</span>
      </div>
      <div class="forecast-summary-row">
        <span class="forecast-summary-tag">Avoid</span>
        <span class="forecast-summary-text">Peak exposure today is <strong>${worstHours}</strong> — rush hour traffic pushes AQI⁺ up to ~${Math.round(today.aqi * 1.2)}.</span>
      </div>
      <div class="forecast-summary-row">
        <span class="forecast-summary-tag">Tomorrow</span>
        <span class="forecast-summary-text"><strong>${tomorrowRoute}</strong>. Forecast AQI⁺ is ${tomorrow ? tomorrow.aqi : '—'}.</span>
      </div>
      <div class="forecast-summary-row">
        <span class="forecast-summary-tag">Best day</span>
        <span class="forecast-summary-text"><strong>${DAY_NAMES[best.dow]}</strong> looks cleanest this week (AQI⁺ ${best.aqi}). Consider scheduling outdoor activity then.</span>
      </div>`;
  }

  function loadForecast() {
    forecastData = generateForecast();
    const dot = document.getElementById('forecast-status-dot');
    const label = document.getElementById('forecast-source-label');
    const updated = document.getElementById('forecast-updated');
    const now = new Date();
    if (dot) { dot.classList.remove('pending'); dot.style.background = 'var(--green)'; }
    if (label) label.textContent = 'Simulated · updated hourly';
    if (updated) updated.textContent = 'Based on ' + now.toLocaleTimeString('en-SE', { hour: '2-digit', minute: '2-digit' });
    renderForecastWeek(forecastData);
    renderForecastDetail(forecastData[0]);
    renderForecastSummary(forecastData);
  }

  // === end Forecast Tab ===

  /* --------------------------------------------------------
   * Calm Route: profile preferences (Profile tab sub-card)
   *
   * Stored locally in localStorage. The integration layer never sees these.
   * Asthma and pollen boosts stack into the effective air weight at compute
   * time so the slider stays the source of truth.
   * ------------------------------------------------------ */

  const PREF_DEFAULTS = {
    cp_w_air: 70,
    cp_w_noise: 50,
    cp_w_crowd: 30,
    cp_asthma: false,
    cp_pollen: false
  };

  function loadPref(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return PREF_DEFAULTS[key];
      if (key === 'cp_asthma' || key === 'cp_pollen') return raw === 'true';
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : PREF_DEFAULTS[key];
    } catch (e) {
      return PREF_DEFAULTS[key];
    }
  }

  function savePref(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) { /* storage disabled — fine */ }
  }

  function getEffectiveWeights() {
    const air = loadPref('cp_w_air');
    const noise = loadPref('cp_w_noise');
    const crowd = loadPref('cp_w_crowd');
    const asthma = loadPref('cp_asthma');
    const pollen = loadPref('cp_pollen');
    const airBoost = (asthma ? 30 : 0) + (pollen ? 20 : 0);
    const airEff = Math.min(100, air + airBoost);
    return { air: airEff, noise, crowd, airBase: air, airBoost };
  }

  function initPrefControls() {
    const map = [
      ['pref-air', 'pref-air-val', 'cp_w_air'],
      ['pref-noise', 'pref-noise-val', 'cp_w_noise'],
      ['pref-crowd', 'pref-crowd-val', 'cp_w_crowd']
    ];
    map.forEach(([sliderId, labelId, key]) => {
      const slider = document.getElementById(sliderId);
      const label = document.getElementById(labelId);
      if (!slider || !label) return;
      const current = loadPref(key);
      slider.value = String(current);
      label.textContent = String(current);
      slider.addEventListener('input', () => {
        label.textContent = slider.value;
        savePref(key, slider.value);
      });
    });

    const togglePairs = [['pref-asthma', 'cp_asthma'], ['pref-pollen', 'cp_pollen']];
    togglePairs.forEach(([id, key]) => {
      const cb = document.getElementById(id);
      if (!cb) return;
      cb.checked = loadPref(key);
      cb.addEventListener('change', () => savePref(key, cb.checked));
    });
  }

  /* --------------------------------------------------------
   * Calm Route: season banner
   *
   * Spring leans on real PM10 readings (road dust). Winter shows usable
   * daylight from a local sunrise/sunset calc. Summer and autumn fall back
   * to simulated for the layers we don't yet have sensors for.
   * ------------------------------------------------------ */

  const STOCKHOLM_LAT = 59.33;
  const STOCKHOLM_LON = 18.07;

  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60 * 1000;
    return Math.floor(diff / 86400000);
  }

  // NOAA solar position approximation. Returns sunrise and sunset as minutes
  // past local midnight, or null if the sun never rises or never sets that day.
  function sunTimes(date, lat, lon) {
    const N = dayOfYear(date);
    const gamma = (2 * Math.PI / 365) * (N - 1);
    const eqtime = 229.18 * (
      0.000075
      + 0.001868 * Math.cos(gamma)
      - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma)
      - 0.040849 * Math.sin(2 * gamma)
    );
    const decl =
      0.006918
      - 0.399912 * Math.cos(gamma)
      + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma)
      + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma)
      + 0.00148 * Math.sin(3 * gamma);
    const zenith = 90.833 * Math.PI / 180;
    const latRad = lat * Math.PI / 180;
    const cosHa = (Math.cos(zenith) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
    if (cosHa > 1 || cosHa < -1) return null;
    const ha = Math.acos(cosHa) * 180 / Math.PI;
    const sunriseUtcMin = 720 - 4 * (lon + ha) - eqtime;
    const sunsetUtcMin = 720 - 4 * (lon - ha) - eqtime;
    const tzOffsetMin = -date.getTimezoneOffset();
    return {
      sunrise: sunriseUtcMin + tzOffsetMin,
      sunset: sunsetUtcMin + tzOffsetMin
    };
  }

  function formatHoursMinutes(totalMinutes) {
    const m = Math.max(0, Math.round(totalMinutes));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h + ' h ' + mm + ' min';
  }

  function renderSeasonBanner() {
    const text = document.getElementById('season-text');
    const badge = document.getElementById('season-badge');
    if (!text || !badge) return;

    const now = new Date();
    const month = now.getMonth();

    let label, badgeText, badgeClass;

    if (month >= 2 && month <= 4) {
      label = 'Road dust season · PM10 from live sensors is leading indicator.';
      badgeText = 'LIVE';
      badgeClass = 'season-badge-live';
    } else if (month >= 5 && month <= 7) {
      label = 'Heat & UV · noise and crowd layers are simulated.';
      badgeText = 'SIMULATED';
      badgeClass = 'season-badge-sim';
    } else if (month >= 8 && month <= 10) {
      label = 'Rain & wind · noise and crowd layers are simulated.';
      badgeText = 'SIMULATED';
      badgeClass = 'season-badge-sim';
    } else {
      const sun = sunTimes(now, STOCKHOLM_LAT, STOCKHOLM_LON);
      const minutesNow = now.getHours() * 60 + now.getMinutes();
      let remaining;
      if (!sun) {
        remaining = 0;
      } else if (minutesNow >= sun.sunset) {
        remaining = 0;
      } else if (minutesNow < sun.sunrise) {
        remaining = sun.sunset - sun.sunrise;
      } else {
        remaining = sun.sunset - minutesNow;
      }
      label = 'Short days · Usable daylight: ' + formatHoursMinutes(remaining) + ' remaining.';
      badgeText = 'COMPUTED';
      badgeClass = 'season-badge-computed';
    }

    badge.textContent = badgeText;
    badge.className = 'season-badge ' + badgeClass;
    text.textContent = label;
  }

  /* --------------------------------------------------------
   * Calm Route: sectors
   *
   * Each district has a centroid. We assign every station within ~2.5 km of
   * that centroid to the sector and average their PM2.5 (preferred) or PM10.
   * ------------------------------------------------------ */

  const SECTORS = [
    { id: 'sodermalm',   name: 'Södermalm',   lat: 59.316, lon: 18.072 },
    { id: 'ostermalm',   name: 'Östermalm',   lat: 59.340, lon: 18.085 },
    { id: 'kungsholmen', name: 'Kungsholmen', lat: 59.330, lon: 18.030 },
    { id: 'vasastan',    name: 'Vasastan',    lat: 59.346, lon: 18.055 },
    { id: 'norrmalm',    name: 'Norrmalm',    lat: 59.335, lon: 18.065 },
    { id: 'gamla_stan',  name: 'Gamla Stan',  lat: 59.323, lon: 18.071 },
    { id: 'djurgarden',  name: 'Djurgården',  lat: 59.334, lon: 18.110 }
  ];

  const SECTOR_RADIUS_DEG = 0.025; // ~2.5 km

  function distanceDeg(lat1, lon1, lat2, lon2) {
    const dx = lat1 - lat2;
    const dy = (lon1 - lon2) * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pmValueFromStation(s) {
    if (!s || !Array.isArray(s.pollutants)) return null;
    const pm25 = s.pollutants.find(p => p.metric === 'pm2.5' || p.metric === 'pm25');
    if (pm25 && typeof pm25.value === 'number') return { value: pm25.value, metric: 'PM2.5' };
    const pm10 = s.pollutants.find(p => p.metric === 'pm10');
    if (pm10 && typeof pm10.value === 'number') return { value: pm10.value, metric: 'PM10' };
    return null;
  }

  function aggregateSectors() {
    const out = SECTORS.map(sec => ({ id: sec.id, name: sec.name, lat: sec.lat, lon: sec.lon, value: null, metric: null, count: 0 }));
    if (!integrationData || !Array.isArray(integrationData.stations)) return out;

    integrationData.stations.forEach(st => {
      if (typeof st.lat !== 'number' || typeof st.lon !== 'number') return;
      const pm = pmValueFromStation(st);
      if (!pm) return;
      let bestIdx = -1, bestD = Infinity;
      out.forEach((sec, i) => {
        const d = distanceDeg(sec.lat, sec.lon, st.lat, st.lon);
        if (d < bestD) { bestD = d; bestIdx = i; }
      });
      if (bestIdx === -1 || bestD > SECTOR_RADIUS_DEG) return;
      const sec = out[bestIdx];
      const prevSum = (sec.value || 0) * sec.count;
      sec.count += 1;
      sec.value = (prevSum + pm.value) / sec.count;
      sec.metric = pm.metric;
    });

    out.forEach(sec => {
      if (sec.count === 0) {
        sec.value = null;
      } else {
        sec.value = Math.round(sec.value * 10) / 10;
      }
    });
    return out;
  }

  function sectorAirClass(value) {
    if (value == null) return 'sector-none';
    if (value <= 15) return 'sector-good';
    if (value <= 35) return 'sector-mod';
    return 'sector-poor';
  }

  /* --------------------------------------------------------
   * Calm Route: destination picker, animation, result
   * ------------------------------------------------------ */

  let selectedSectorId = null;
  let selectedOriginId = 'norrmalm';
  let calmRouteMap = null;

  function renderOriginPicker() {
    const host = document.getElementById('origin-picker');
    if (!host) return;
    host.innerHTML = SECTORS.map(s => (
      `<button class="sector-pill${s.id === selectedOriginId ? ' active' : ''}" data-sector="${s.id}" role="option" aria-selected="${s.id === selectedOriginId ? 'true' : 'false'}">${escapeHtml(s.name)}</button>`
    )).join('');
    host.querySelectorAll('.sector-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedOriginId = btn.dataset.sector;
        host.querySelectorAll('.sector-pill').forEach(b => {
          const on = b.dataset.sector === selectedOriginId;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      });
    });
  }

  function initCalmFilters() {
    const pairs = [
      ['calm-pref-air', 'calm-pref-air-val', 'pref-air', 'pref-air-val', 'cp_w_air'],
      ['calm-pref-noise', 'calm-pref-noise-val', 'pref-noise', 'pref-noise-val', 'cp_w_noise'],
      ['calm-pref-crowd', 'calm-pref-crowd-val', 'pref-crowd', 'pref-crowd-val', 'cp_w_crowd']
    ];
    pairs.forEach(([cId, cLblId, pId, pLblId, key]) => {
      const cSlider = document.getElementById(cId);
      const cLabel = document.getElementById(cLblId);
      if (!cSlider || !cLabel) return;
      const current = loadPref(key);
      cSlider.value = String(current);
      cLabel.textContent = String(current);
      cSlider.addEventListener('input', () => {
        cLabel.textContent = cSlider.value;
        savePref(key, cSlider.value);
        const pSlider = document.getElementById(pId);
        const pLabel = document.getElementById(pLblId);
        if (pSlider) pSlider.value = cSlider.value;
        if (pLabel) pLabel.textContent = cSlider.value;
      });
    });
  }

  function renderCalmRouteMap(originId, destId) {
    if (typeof L === 'undefined') return;
    const origin = SECTORS.find(s => s.id === originId);
    const dest = SECTORS.find(s => s.id === destId);
    if (!origin || !dest) return;

    if (!calmRouteMap) {
      calmRouteMap = L.map('calm-route-map', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
      });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 15 }).addTo(calmRouteMap);
    }

    calmRouteMap.eachLayer(layer => {
      if (!(layer instanceof L.TileLayer)) calmRouteMap.removeLayer(layer);
    });

    const midLat = (origin.lat + dest.lat) / 2;
    const midLon = (origin.lon + dest.lon) / 2;
    const dx = dest.lat - origin.lat;
    const dy = dest.lon - origin.lon;

    const fastCoords = [
      [origin.lat, origin.lon],
      [midLat + dy * 0.15, midLon + dx * 0.15],
      [dest.lat, dest.lon]
    ];
    const calmCoords = [
      [origin.lat, origin.lon],
      [midLat - dy * 0.2, midLon - dx * 0.1],
      [midLat - dy * 0.05, midLon + dx * 0.05],
      [dest.lat, dest.lon]
    ];

    L.polyline(fastCoords, { color: '#E24B4A', weight: 4, opacity: 0.75, dashArray: '7 5' })
      .bindTooltip('Fastest', { sticky: true }).addTo(calmRouteMap);
    L.polyline(calmCoords, { color: '#0F6E56', weight: 4, opacity: 0.9 })
      .bindTooltip('Calm route', { sticky: true }).addTo(calmRouteMap);

    L.circleMarker([origin.lat, origin.lon], { radius: 7, fillColor: '#FFFFFF', color: '#2C2C2A', weight: 2, fillOpacity: 1 })
      .bindTooltip(origin.name, { permanent: true, direction: 'top', offset: [0, -8], className: 'route-end-label' })
      .addTo(calmRouteMap);
    L.circleMarker([dest.lat, dest.lon], { radius: 7, fillColor: '#2C2C2A', color: '#2C2C2A', weight: 2, fillOpacity: 1 })
      .bindTooltip(dest.name, { permanent: true, direction: 'top', offset: [0, -8], className: 'route-end-label' })
      .addTo(calmRouteMap);

    const bounds = L.latLngBounds([[origin.lat, origin.lon], [dest.lat, dest.lon]]);
    calmRouteMap.fitBounds(bounds, { padding: [40, 40] });
    setTimeout(() => calmRouteMap.invalidateSize(), 60);
  }

  function renderSectorPicker() {
    const host = document.getElementById('sector-picker');
    if (!host) return;
    host.innerHTML = SECTORS.map(s => (
      `<button class="sector-pill" data-sector="${s.id}" role="option" aria-selected="false">${escapeHtml(s.name)}</button>`
    )).join('');
    host.querySelectorAll('.sector-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedSectorId = btn.dataset.sector;
        host.querySelectorAll('.sector-pill').forEach(b => {
          const on = b.dataset.sector === selectedSectorId;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const go = document.getElementById('calm-go-btn');
        const hint = document.getElementById('calm-hint');
        if (go) go.disabled = false;
        if (hint) hint.textContent = 'Ready to compute on this device.';
      });
    });
  }

  function setNarration(text) {
    const el = document.getElementById('anim-narration');
    if (el) el.textContent = text;
  }

  function renderSectorGridInitial() {
    const grid = document.getElementById('sector-grid');
    if (!grid) return;
    grid.innerHTML = SECTORS.map(s => (
      `<div class="sector-square sector-loading" data-sector="${s.id}">
        <div class="sector-square-name">${escapeHtml(s.name)}</div>
        <div class="sector-square-value">…</div>
      </div>`
    )).join('');
  }

  function fillSectorSquare(sector) {
    const grid = document.getElementById('sector-grid');
    if (!grid) return;
    const cell = grid.querySelector(`[data-sector="${sector.id}"]`);
    if (!cell) return;
    cell.classList.remove('sector-loading');
    cell.classList.add(sectorAirClass(sector.value));
    const v = cell.querySelector('.sector-square-value');
    if (v) {
      if (sector.value == null) {
        v.textContent = 'no data';
      } else {
        v.innerHTML = `<strong>${sector.value}</strong> <span class="sector-square-unit">${sector.metric || 'PM2.5'} µg/m³</span>`;
      }
    }
  }

  function runCalmAnimation(sectors, onDone) {
    const animBox = document.getElementById('calm-animation');
    const results = document.getElementById('calm-results');
    if (animBox) animBox.hidden = false;
    if (results) results.hidden = true;
    renderSectorGridInitial();
    setNarration('Requesting air data for 7 sectors…');

    sectors.forEach((sec, i) => {
      setTimeout(() => fillSectorSquare(sec), 150 + i * 200);
    });
    setTimeout(() => setNarration('Computing your route on this device…'), 150 + sectors.length * 200);
    setTimeout(() => setNarration('Sector IDs sent · no identity · no origin · no destination.'),
      450 + sectors.length * 200);
    setTimeout(() => {
      if (typeof onDone === 'function') onDone();
    }, 700 + sectors.length * 200);
  }

  function computeCalmRoute(sectors) {
    const weights = getEffectiveWeights();
    const known = sectors.filter(s => s.value != null);
    let avg = 0;
    if (known.length > 0) {
      const sum = known.reduce((a, s) => a + s.value, 0);
      avg = sum / known.length;
    }
    // Map 0 µg/m³ → 0, 75 µg/m³ → 100 (clamp at 100).
    const airScore = Math.max(0, Math.min(100, (avg / 75) * 100));
    const noiseScore = 50;
    const crowdScore = 50;
    const wSum = weights.air + weights.noise + weights.crowd;
    const score = wSum > 0
      ? Math.round((weights.air * airScore + weights.noise * noiseScore + weights.crowd * crowdScore) / wSum)
      : Math.round(airScore);
    const extraMin = 4 + Math.round(score / 20);
    return { score, airScore: Math.round(airScore), noiseScore, crowdScore, weights, extraMin, sectorsWithData: known.length };
  }

  function renderCalmResult(result) {
    const results = document.getElementById('calm-results');
    if (!results) return;
    results.hidden = false;

    const numEl = document.getElementById('calm-score');
    const barEl = document.getElementById('calm-bar');
    const etaEl = document.getElementById('calm-eta');
    const breakEl = document.getElementById('calm-break');

    if (numEl) numEl.textContent = result.score;
    if (barEl) barEl.style.width = result.score + '%';
    if (etaEl) etaEl.textContent = '+' + result.extraMin + ' min vs fastest';

    if (breakEl) {
      const boosts = [];
      if (result.weights.airBoost > 0) {
        boosts.push(`<span class="break-pill break-boost">+${result.weights.airBoost} air (conditions)</span>`);
      }
      breakEl.innerHTML = `
        <span class="break-pill">Air <em>real</em> · ${result.airScore}</span>
        <span class="break-pill">Noise <em>sim</em> · ${result.noiseScore}</span>
        <span class="break-pill">Crowd <em>sim</em> · ${result.crowdScore}</span>
        <span class="break-pill">+${result.extraMin} min vs fastest</span>
        ${boosts.join('')}
      `;
    }
  }

  function initCalmRoute() {
    renderSeasonBanner();
    renderOriginPicker();
    renderSectorPicker();
    initCalmFilters();

    const goBtn = document.getElementById('calm-go-btn');
    if (goBtn) {
      goBtn.addEventListener('click', () => {
        if (!selectedSectorId) return;
        const sectors = aggregateSectors();
        runCalmAnimation(sectors, () => {
          const result = computeCalmRoute(sectors);
          renderCalmResult(result);
          renderCalmRouteMap(selectedOriginId, selectedSectorId);
          const receipt = document.getElementById('receipt-requests');
          if (receipt) receipt.textContent = String(sectors.length);
        });
      });
    }
  }

  /* --------------------------------------------------------
   * Green areas: parks and gardens from OpenStreetMap via Overpass
   * ------------------------------------------------------ */

  async function loadGreenAreas() {
    if (!greenAreasLayer) return;
    const bbox = '59.29,18.03,59.36,18.12';
    const q = `[out:json][timeout:25];`
      + `(way["leisure"="park"](${bbox});`
      + `way["leisure"="garden"](${bbox});`
      + `way["landuse"="recreation_ground"](${bbox});`
      + `way["leisure"="nature_reserve"](${bbox});`
      + `);out geom;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q)
      });
      if (!res.ok) return;
      const data = await res.json();
      data.elements.forEach(el => {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) return;
        const coords = el.geometry.map(p => [p.lat, p.lon]);
        const name = (el.tags && el.tags.name) ? escapeHtml(el.tags.name) : 'Park';
        L.polygon(coords, {
          pane: 'greenAreas',
          color: '#4ade80',
          weight: 1,
          opacity: 0.6,
          fillColor: '#bbf7d0',
          fillOpacity: 0.35
        }).bindTooltip(name, { sticky: true }).addTo(greenAreasLayer);
      });
    } catch (_) {
      // Green areas are decorative; fail silently if Overpass is unavailable.
    }
  }

  /* --------------------------------------------------------
   * Boot
   * ------------------------------------------------------ */

  /* --------------------------------------------------------
   * Quiet Route — 80 dB alert overlay
   * ------------------------------------------------------ */

  function initQuietRoute() {
    const pct = calcNoiseReduction();
    const badge = document.getElementById('quiet-reduction-badge');
    const adviceQuiet = document.getElementById('quiet-advice');
    if (badge) badge.textContent = pct + '% quieter';
    if (adviceQuiet) {
      adviceQuiet.textContent = `The quietest route reduces your decibel exposure by ${pct}% compared to the other routes. It avoids Centralbron and Götgatan entirely.`;
    }

    const overlay = document.getElementById('alert-overlay');
    const demoBtn = document.getElementById('demo-alert-btn');
    const dismissBtn = document.getElementById('alert-dismiss');

    if (!overlay) return;

    function openAlert() {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    }

    function closeAlert(reroute) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      if (reroute) {
        const card = document.getElementById('route-quiet');
        document.querySelectorAll('.route-card').forEach(c => c.classList.remove('route-clean'));
        if (card) card.classList.add('route-clean');
      }
    }

    if (demoBtn) demoBtn.addEventListener('click', openAlert);
    if (dismissBtn) dismissBtn.addEventListener('click', () => closeAlert(false));

    document.querySelectorAll('.reroute-option').forEach(opt => {
      opt.addEventListener('click', () => closeAlert(true));
    });
  }

  function boot() {
    initMap();
    loadGreenAreas();
    loadStations();
    loadIntegrationLayer();
    loadCams();
    loadForecast();
    initPrefControls();
    initCalmRoute();
    initQuietRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
