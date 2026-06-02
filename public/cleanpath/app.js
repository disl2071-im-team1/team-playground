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
    }
  };

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

  let leafletMap, stationsLayer, camsLayer, integrationLayer;

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

    // Routes
    Object.entries(ROUTES).forEach(([key, r]) => {
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
        <strong style="margin-top:6px">Routes</strong>
        <div><span class="line" style="background:#E24B4A"></span>Fastest</div>
        <div><span class="line" style="background:#0F6E56"></span>Cleanest</div>
      `;
      return div;
    };
    legend.addTo(leafletMap);
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

  // Rendered as a discrete nearest-station (Voronoi-style) area overlay: each
  // grid cell takes the value of its single nearest station, colored on that
  // ONE source's own unit scale. Sources are never combined into one scale
  // (WAQI is an AQI index; SMHI and luftdaten are µg/m³). Cells far from any
  // station are left blank, so the overlay stays honest about sparse coverage.

  const SOURCE_LABELS = { smhi: 'SMHI', waqi: 'WAQI', luftdaten: 'luftdaten' };
  const SOURCE_COLORS = { smhi: '#534AB7', waqi: '#E07B00', luftdaten: '#0F6E56' };
  const METRIC_PREFERENCE = ['pm25', 'pm10', 'no2', 'o3', 'co'];

  // Color bands per (metric, unit). Each band: [upperBound, color, label].
  const SCALES = {
    aqi:        [[3, '#1D9E75', 'Low (1-3)'], [6, '#EF9F27', 'Moderate (4-6)'], [9, '#E24B4A', 'High (7-9)'], [Infinity, '#7F1D1D', 'Very high (10)']],
    pm25_ug:    [[5, '#1D9E75', '0-5'], [15, '#A7C957', '5-15'], [25, '#EF9F27', '15-25'], [50, '#E24B4A', '25-50'], [Infinity, '#7F1D1D', '50+']],
    pm10_ug:    [[20, '#1D9E75', '0-20'], [40, '#A7C957', '20-40'], [50, '#EF9F27', '40-50'], [100, '#E24B4A', '50-100'], [Infinity, '#7F1D1D', '100+']],
    no2_ug:     [[40, '#1D9E75', '0-40'], [90, '#EF9F27', '40-90'], [120, '#E24B4A', '90-120'], [Infinity, '#7F1D1D', '120+']],
    o3_ug:      [[60, '#1D9E75', '0-60'], [120, '#A7C957', '60-120'], [180, '#EF9F27', '120-180'], [Infinity, '#7F1D1D', '180+']],
    generic_ug: [[10, '#1D9E75', '0-10'], [25, '#A7C957', '10-25'], [50, '#EF9F27', '25-50'], [100, '#E24B4A', '50-100'], [Infinity, '#7F1D1D', '100+']]
  };

  function scaleFor(metric, unit) {
    if (unit === 'aqi') return SCALES.aqi;
    if (metric === 'pm25') return SCALES.pm25_ug;
    if (metric === 'pm10') return SCALES.pm10_ug;
    if (metric === 'no2') return SCALES.no2_ug;
    if (metric === 'o3') return SCALES.o3_ug;
    return SCALES.generic_ug;
  }

  function bandColor(scale, value) {
    for (const [hi, color] of scale) if (value <= hi) return color;
    return scale[scale.length - 1][1];
  }

  let integrationData = null;
  let overlaySource = 'smhi';
  let overlayLegendCtrl = null;
  let sourceSelectCtrl = null;

  // Points for one source, using its first available preferred metric.
  function pointsFor(source) {
    const sts = (integrationData.stations || []).filter(s => s.source === source && s.pollutants.length);
    const available = new Set();
    sts.forEach(s => s.pollutants.forEach(p => available.add(p.metric)));
    let metric = METRIC_PREFERENCE.find(m => available.has(m));
    if (!metric && sts.length) metric = sts[0].pollutants[0].metric;
    const points = [];
    if (metric) {
      sts.forEach(s => {
        const p = s.pollutants.find(x => x.metric === metric);
        if (p) points.push({ lat: s.lat, lon: s.lon, value: p.value, unit: p.unit, station: s.station });
      });
    }
    return { metric, points };
  }

  function renderOverlay() {
    if (!integrationLayer || !integrationData) return;
    integrationLayer.clearLayers();
    const { metric, points } = pointsFor(overlaySource);
    if (!metric || !points.length) { updateOverlayLegend(overlaySource, null, null); return; }

    const unit = points[0].unit;
    const scale = scaleFor(metric, unit);

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    points.forEach(p => {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    });
    minLat -= 0.02; maxLat += 0.02; minLon -= 0.035; maxLon += 0.035;

    const N = 26;
    const dLat = (maxLat - minLat) / N, dLon = (maxLon - minLon) / N;
    const MAX_DEG = 0.018; // ~2 km: blank beyond this so we don't imply coverage

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const cLat = minLat + (i + 0.5) * dLat, cLon = minLon + (j + 0.5) * dLon;
        let best = null, bestD = Infinity;
        for (const p of points) {
          const dx = p.lat - cLat, dy = (p.lon - cLon) * Math.cos(cLat * Math.PI / 180);
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = p; }
        }
        if (!best || Math.sqrt(bestD) > MAX_DEG) continue;
        const rect = L.rectangle(
          [[minLat + i * dLat, minLon + j * dLon], [minLat + (i + 1) * dLat, minLon + (j + 1) * dLon]],
          { color: '#2C2C2A', weight: 0.5, opacity: 0.4, fillColor: bandColor(scale, best.value), fillOpacity: 0.5 }
        );
        rect.bindTooltip(
          `${escapeHtml(SOURCE_LABELS[overlaySource] || overlaySource)} · ${escapeHtml(metric.toUpperCase())} ${best.value} ${escapeHtml(unit)}` +
          `<br><span style="opacity:.7">nearest: ${escapeHtml(best.station)}</span>`,
          { sticky: true }
        );
        rect.addTo(integrationLayer);
      }
    }
    updateOverlayLegend(overlaySource, metric, unit);
  }

  function updateOverlayLegend(source, metric, unit) {
    const el = document.getElementById('overlay-legend');
    if (!el) return;
    if (!metric) {
      el.innerHTML = `<strong>Integration layer</strong><div>no ${escapeHtml(SOURCE_LABELS[source] || source)} data</div>`;
      return;
    }
    const swatches = scaleFor(metric, unit)
      .map(([, color, label]) => `<div><span class="swatch" style="background:${color}"></span>${escapeHtml(label)}</div>`)
      .join('');
    el.innerHTML =
      `<strong>${escapeHtml(SOURCE_LABELS[source] || source)} · ${escapeHtml(metric.toUpperCase())} (${escapeHtml(unit)})</strong>` +
      swatches +
      `<div class="legend-note">Nearest-station cells. One source at a time — units are not comparable across sources.</div>`;
  }

  function highlightActive(container) {
    container.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.source === overlaySource);
      b.style.borderLeft = '4px solid ' + (SOURCE_COLORS[b.dataset.source] || '#999');
    });
  }

  function buildOverlayControls() {
    overlayLegendCtrl = L.control({ position: 'bottomleft' });
    overlayLegendCtrl.onAdd = function () {
      const d = L.DomUtil.create('div', 'map-legend overlay-legend');
      d.id = 'overlay-legend';
      return d;
    };
    overlayLegendCtrl.addTo(leafletMap);

    sourceSelectCtrl = L.control({ position: 'topright' });
    sourceSelectCtrl.onAdd = function () {
      const d = L.DomUtil.create('div', 'map-legend overlay-select');
      const sources = Object.keys(integrationData.bySource || {});
      d.innerHTML = '<strong>Overlay source</strong>' +
        sources.map(s => `<button type="button" class="src-btn" data-source="${s}">${escapeHtml(SOURCE_LABELS[s] || s)}</button>`).join('');
      L.DomEvent.disableClickPropagation(d);
      d.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => { overlaySource = b.dataset.source; highlightActive(d); renderOverlay(); });
      });
      setTimeout(() => highlightActive(d), 0);
      return d;
    };
    sourceSelectCtrl.addTo(leafletMap);
  }

  async function loadIntegrationLayer() {
    setStatus('integration', 'pending', 'loading…');
    try {
      const res = await fetch('/api/stockholm-air', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.reason || 'unavailable');

      integrationData = data;
      const sources = Object.keys(data.bySource || {});
      if (!sources.includes(overlaySource)) overlaySource = sources.includes('smhi') ? 'smhi' : sources[0];
      if (!sourceSelectCtrl) buildOverlayControls();
      renderOverlay();

      const summary = Object.entries(data.bySource || {}).map(([k, v]) => `${v} ${k}`).join(' · ');
      setStatus('integration', 'ok', `area overlay · ${summary}`);
    } catch (err) {
      setStatus('integration', 'offline', 'unavailable (' + err.message + ')');
    }
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
    'threat-corp': {
      eyebrow: 'Threat model',
      title: 'What if a data broker acquires Clean Path?',
      body: `<p>There's no commute database to sell. The architecture means we never had one in the first place, your routes, preferences, and history live on your phone, encrypted at rest, and never sync up.</p>
             <p>What an acquirer would inherit: anonymous environmental readings from the public sensor mesh, which are already open data. Not a per-user product.</p>`
    },
    'threat-state': {
      eyebrow: 'Threat model',
      title: 'What if a government subpoenas user data?',
      body: `<p>We can't hand over what we never had. There are no user accounts, no central server logging trips, no IP addresses tied to identities.</p>
             <p>This is structurally different from Google Maps or Citymapper, where your full movement history is on file and could be subpoenaed.</p>`
    },
    'threat-mesh': {
      eyebrow: 'Threat model',
      title: 'What if a sensor lies?',
      body: `<p>A compromised or faulty sensor can broadcast false readings, but mesh consensus protects the map. Each node's readings are cross-referenced against its neighbours, and outliers more than 2σ from local consensus are flagged and excluded.</p>`
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

  /* --------------------------------------------------------
   * Boot
   * ------------------------------------------------------ */

  function boot() {
    initMap();
    loadStations();
    loadIntegrationLayer();
    loadCams();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
