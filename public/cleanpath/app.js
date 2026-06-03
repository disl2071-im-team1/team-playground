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
        <strong style="margin-top:6px">Integration layer (source)</strong>
        <div><span class="swatch" style="background:#fff;border:3px solid #534AB7"></span>SMHI (official µg/m³)</div>
        <div><span class="swatch" style="background:#fff;border:3px solid #E07B00"></span>WAQI (AQI index)</div>
        <div><span class="swatch" style="background:#fff;border:3px solid #0F6E56"></span>luftdaten (community)</div>
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
   * Boot
   * ------------------------------------------------------ */

  function boot() {
    initMap();
    loadStations();
    loadIntegrationLayer();
    loadCams();
    loadForecast();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
