(function () {
  'use strict';

  /* ============================================================
   * Clean Path — municipal multi-hazard monitoring shell.
   *
   * One shared shell (header, tab bar, map, legend, layers panel,
   * source line, decision panel, provenance bar, time slider) driven
   * by a per-hazard CONFIG object. Switching tabs swaps only the data
   * layer, legend, decision verb and provenance mix.
   *
   * Air is the only tab on real data today (SMHI/WAQI/luftdaten + CAMS,
   * via the kept air data stack and integration layer). Algae, Fire and
   * Heat render clearly-labelled PLACEHOLDER layers until their adapters
   * land — never dressed up to read as real measurement.
   * ========================================================== */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---- Seeded RNG (ported from precipitation.html) ---- */
  function seededRand(seed) {
    let h = seed ^ 0xdeadbeef;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 0xffffffff;
  }
  function dSeed(id, offset) {
    const today = new Date();
    const base = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return base + Math.abs(h) % 10000 + (offset || 0);
  }
  function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
  function fmtHour(h) { return String(Math.min(23, h)).padStart(2, '0') + ':00'; }
  function durBarHtml(startH, durH, onClass) {
    const nowH = new Date().getHours();
    return Array.from({ length: 24 }, (_, h) => {
      const cls = ['dur-hr'];
      if (h >= startH && h < startH + durH) cls.push(onClass);
      if (h === nowH) cls.push('dur-now');
      return `<div class="${cls.join(' ')}" title="${fmtHour(h)}"></div>`;
    }).join('');
  }
  function aggDurBar(data, onClass) {
    const counts = Array(24).fill(0);
    data.forEach(d => {
      for (let h = d.startHour; h < Math.min(24, d.startHour + d.durationHours); h++) counts[h]++;
    });
    const maxC = Math.max(1, ...counts);
    const nowH = new Date().getHours();
    const html = Array.from({ length: 24 }, (_, h) => {
      const cls = ['dur-hr'];
      if (counts[h] > 0) cls.push(onClass);
      if (h === nowH) cls.push('dur-now');
      const style = counts[h] > 0 ? ` style="opacity:${(0.3 + (counts[h] / maxC) * 0.7).toFixed(2)}"` : '';
      return `<div class="${cls.join(' ')}"${style} title="${fmtHour(h)} · ${counts[h]} districts"></div>`;
    }).join('');
    const peakHours = counts.reduce((a, c, h) => { if (c === maxC && maxC > 0) a.push(h); return a; }, []);
    const peakLabel = peakHours.length > 0
      ? `<strong>Peak:</strong> ${fmtHour(peakHours[0])} – ${fmtHour(peakHours[peakHours.length - 1] + 1)} · ${maxC} district${maxC !== 1 ? 's' : ''}`
      : 'No precipitation expected';
    return { html, peakLabel };
  }

  /* ---- PM2.5 (air) colour scales, ported from the kept air stack ---- */
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
  function pm25ToColor(v) {
    if (v < 10) return '#97C459';
    if (v < 20) return '#FAC775';
    if (v < 35) return '#EF9F27';
    if (v < 55) return '#E24B4A';
    return '#7F1D1D';
  }
  const SOURCE_COLORS = { smhi: '#534AB7', waqi: '#E07B00', luftdaten: '#0F6E56' };

  /* ============================================================
   * Map shell + shared layer groups + controls
   * ========================================================== */

  let map, gHazard, gIntegration, gVulnerable;
  let legendControl, layersControl, placeholderBanner;
  let camsHeat = null;
  let currentHazard = 'air';

  const STOCKHOLM = [59.3251, 18.0686];

  function initMap() {
    if (typeof L === 'undefined') { setTimeout(initMap, 50); return; }

    map = L.map('leaflet-map', { zoomControl: true, attributionControl: true })
      .setView(STOCKHOLM, 12);
    window._leafletMap = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);

    gHazard = L.layerGroup().addTo(map);
    gIntegration = L.layerGroup().addTo(map);
    gVulnerable = L.layerGroup().addTo(map);

    legendControl = L.control({ position: 'bottomright' });
    legendControl.onAdd = function () {
      const d = L.DomUtil.create('div', 'map-legend');
      d.id = 'hazard-legend';
      return d;
    };
    legendControl.addTo(map);

    layersControl = L.control({ position: 'topleft' });
    layersControl.onAdd = function () {
      const d = L.DomUtil.create('div', 'map-legend overlay-select');
      d.id = 'hazard-layers';
      L.DomEvent.disableClickPropagation(d);
      return d;
    };
    layersControl.addTo(map);

    placeholderBanner = L.control({ position: 'topright' });
    placeholderBanner.onAdd = function () {
      const d = L.DomUtil.create('div', 'placeholder-banner');
      d.id = 'placeholder-banner';
      d.style.display = 'none';
      d.textContent = 'PLACEHOLDER DATA — not a real measurement';
      return d;
    };
    placeholderBanner.addTo(map);
  }

  const LAYER_GROUPS = { hazard: () => gHazard, integration: () => gIntegration, vulnerable: () => gVulnerable };

  function renderLayersPanel(haz) {
    const el = document.getElementById('hazard-layers');
    if (!el) return;
    el.innerHTML = '<strong>Layers</strong>' + haz.layers.map(l =>
      `<button class="src-btn ${l.on ? 'active' : ''}" data-layer="${l.key}">
         <span class="src-dot" style="background:${l.dot || '#5F5E5A'}"></span>${escapeHtml(l.label)}
       </button>`
    ).join('');
    haz.layers.forEach(l => {
      const g = LAYER_GROUPS[l.key] && LAYER_GROUPS[l.key]();
      if (!g) return;
      if (l.on) { if (!map.hasLayer(g)) g.addTo(map); } else { map.removeLayer(g); }
    });
    el.querySelectorAll('.src-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = LAYER_GROUPS[btn.dataset.layer] && LAYER_GROUPS[btn.dataset.layer]();
        if (!g) return;
        const on = btn.classList.toggle('active');
        if (on) g.addTo(map); else map.removeLayer(g);
      });
    });
  }

  function renderLegend(haz) {
    const el = document.getElementById('hazard-legend');
    if (!el) return;
    el.innerHTML = `<strong>${escapeHtml(haz.legend.title)}</strong>` +
      haz.legend.items.map(i =>
        `<div><span class="swatch" style="background:${i.c}"></span>${escapeHtml(i.t)}</div>`
      ).join('');
  }

  /* ============================================================
   * Air hazard — REAL data (kept air stack)
   * ========================================================== */

  function setLayerStatus(items) {
    const host = document.getElementById('layer-status');
    if (!host) return;
    host.innerHTML = items.map(it =>
      `<div class="map-status-item" id="status-${it.id}">
        <span class="status-dot ${it.state || 'pending'}"></span>
        <span class="status-label">${escapeHtml(it.label)}</span>
        <span class="status-detail" id="status-${it.id}-detail">${escapeHtml(it.detail || '')}</span>
      </div>`
    ).join('');
  }
  function setStatus(which, state, detail) {
    const item = document.getElementById('status-' + which);
    if (!item) return;
    const dot = item.querySelector('.status-dot');
    if (dot) { dot.classList.remove('pending', 'ok', 'offline'); dot.classList.add(state); }
    const det = document.getElementById('status-' + which + '-detail');
    if (det) det.textContent = detail;
  }

  let integrationData = null;

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
      let withPm25 = 0;
      data.stations.forEach(s => {
        const idx = s.pm25 != null ? s.pm25.index : null;
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 6, fillColor: indexToColor(idx), color: '#FFFFFF', weight: 1.5, fillOpacity: 0.95
        });
        const valueHtml = idx != null
          ? `<div class="station-value" style="color:${indexToColor(idx)}">PM2.5 index ${idx} · ${indexBand(idx)}</div>`
          : `<div class="station-value" style="color:#9CA3AF">No PM2.5 reading</div>`;
        marker.bindPopup(`<div class="station-popup"><strong>${escapeHtml(s.name)}</strong>
          <div class="station-meta">${escapeHtml(s.code)} · ${escapeHtml(s.siteType || '')}</div>${valueHtml}</div>`);
        marker.addTo(gHazard);
        if (idx != null) withPm25 += 1;
      });
      setStatus('stations', 'ok', `${data.stations.length} sites · ${withPm25} PM2.5`);
    } catch (err) {
      setStatus('stations', 'offline', 'unavailable (' + err.message + ')');
    }
  }

  async function loadIntegrationLayer() {
    setStatus('integration', 'pending', 'loading…');
    try {
      const res = await fetch('/api/stockholm-air', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.reason || 'unavailable');
      integrationData = data;
      data.stations.forEach(s => {
        const color = SOURCE_COLORS[s.source] || '#5F5E5A';
        L.circle([s.lat, s.lon], { radius: 450, fillColor: color, color, weight: 0, fillOpacity: 0.1, interactive: false }).addTo(gIntegration);
        const marker = L.circleMarker([s.lat, s.lon], { radius: 7, fillColor: '#FFFFFF', color, weight: 3, fillOpacity: 0.9 });
        const rows = s.pollutants.map(p => `<div class="station-value" style="color:${color}">${escapeHtml(p.metric.toUpperCase())} ${p.value} ${escapeHtml(p.unit)}</div>`).join('');
        const when = (s.pollutants[0] || {}).timestamp || '';
        marker.bindPopup(`<div class="station-popup"><strong>${escapeHtml(s.station)}</strong>
          <div class="station-meta">source: ${escapeHtml(s.source)} · ${escapeHtml(when)}</div>${rows}</div>`);
        marker.addTo(gIntegration);
      });
      const summary = Object.entries(data.bySource || {}).map(([k, v]) => `${v} ${k}`).join(' · ');
      setStatus('integration', 'ok', `${data.stations.length} stations · ${summary}`);
      updateAirProvenance();
    } catch (err) {
      setStatus('integration', 'offline', 'unavailable (' + err.message + ')');
    }
  }

  async function loadCams(hour) {
    setStatus('cams', 'pending', 'fetching forecast…');
    try {
      const url = '/api/cams-pm25' + (hour != null ? `?hour=${hour}` : '');
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) {
        setStatus('cams', 'offline', data.configured === false ? 'API key not configured' : (data.reason || 'unavailable'));
        return;
      }
      renderCamsHeat(data);
      const updated = data.updated ? new Date(data.updated) : null;
      const ts = updated ? `${updated.toUTCString().slice(17, 22)} UTC` : '';
      setStatus('cams', 'ok', `forecast +${data.forecastHour}h${ts ? ' · base ' + ts : ''}`);
    } catch (err) {
      setStatus('cams', 'offline', 'error (' + err.message + ')');
    }
  }

  function renderCamsHeat(data) {
    if (!gHazard || !data || !data.grid) return;
    if (camsHeat && map.hasLayer(camsHeat)) map.removeLayer(camsHeat);
    if (typeof L.heatLayer !== 'function') {
      data.grid.forEach(([lat, lon, v]) => {
        L.rectangle([[lat - 0.05, lon - 0.05], [lat + 0.05, lon + 0.05]], { color: pm25ToColor(v), weight: 0, fillOpacity: 0.25 }).addTo(gHazard);
      });
      return;
    }
    const max = Math.max(15, ...data.grid.map(p => p[2]));
    const heatData = data.grid.map(([lat, lon, v]) => [lat, lon, Math.min(1, v / max)]);
    camsHeat = L.heatLayer(heatData, {
      radius: 28, blur: 24, minOpacity: 0.25, max: 1.0,
      gradient: { 0.0: 'rgba(151,196,89,0)', 0.2: 'rgba(151,196,89,0.7)', 0.4: 'rgba(250,199,117,0.75)', 0.6: 'rgba(239,159,39,0.8)', 0.8: 'rgba(226,75,74,0.85)', 1.0: 'rgba(127,29,29,0.9)' }
    });
    gHazard.addLayer(camsHeat);
  }

  // Air provenance computed from the real data (honest counts), not hardcoded.
  function updateAirProvenance() {
    const by = (integrationData && integrationData.bySource) || {};
    const measured = ['smhi', 'waqi', 'luftdaten']
      .filter(k => by[k]).map(k => `${by[k]} ${k.toUpperCase()}`).join(' · ');
    const text = (measured ? `Measured: ${measured}. ` : 'Measured: SMHI · WAQI · luftdaten. ') +
      'Modelled: CAMS grid (station = none).';
    setProvenance(text, 'mixed', false);
  }

  function activateAir(haz) {
    setLayerStatus([
      { id: 'stations', label: 'WAQI stations' },
      { id: 'integration', label: 'Integration layer' },
      { id: 'cams', label: 'CAMS (modelled)' }
    ]);
    setProvenance('Measured: SMHI · WAQI · luftdaten. Modelled: CAMS grid (station = none).', 'mixed', false);
    loadStations();
    loadIntegrationLayer();
    loadCams(currentLeadHour());
  }

  /* ============================================================
   * Placeholder hazards — clearly labelled, never real
   * ========================================================== */

  // Each placeholder draws a few sample shapes in the legend colours, all
  // marked "(sample)" in their tooltips, plus the topright PLACEHOLDER banner.
  function activatePlaceholder(haz) {
    setLayerStatus([{ id: 'placeholder', label: haz.layers[0].label, state: 'offline', detail: 'placeholder · adapter not yet connected' }]);
    setProvenance(haz.provenance, haz.confidence, true);
    if (haz.draw) haz.draw();
  }

  function sampleZone(latlngs, color, label) {
    L.polygon(latlngs, { color, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: 0.35 })
      .bindTooltip(`${label} (sample)`, { sticky: true }).addTo(gHazard);
  }
  function sampleMarker(latlng, color, label, ring) {
    L.circleMarker(latlng, { radius: 8, fillColor: color, color: ring || '#FFFFFF', weight: 2, fillOpacity: 0.9 })
      .bindTooltip(`${label} (sample)`, { sticky: true }).addTo(gHazard);
  }

  function drawAlgae() {
    // Sample bathing sites around Stockholm waters (placeholder statuses).
    const C = { none: '#9CA3AF', watch: '#FAC775', advisory: '#EF9F27', closed: '#E24B4A' };
    [
      [[59.310, 18.090], C.none, 'Brunnsviken — None'],
      [[59.300, 18.140], C.watch, 'Hellasgården — Watch'],
      [[59.345, 18.110], C.advisory, 'Lilla Värtan — Advisory'],
      [[59.318, 18.020], C.closed, 'Smedsuddsbadet — Closed']
    ].forEach(([ll, c, l]) => sampleMarker(ll, c, l));
  }

  function drawFire() {
    const C = { low: '#1D9E75', moderate: '#FAC775', high: '#EF9F27', extreme: '#E24B4A' };
    const box = (cy, cx, d) => [[cy - d, cx - d], [cy - d, cx + d], [cy + d, cx + d], [cy + d, cx - d]];
    sampleZone(box(59.36, 18.02, 0.03), C.low, 'NW zone — Low');
    sampleZone(box(59.36, 18.12, 0.03), C.moderate, 'NE zone — Moderate');
    sampleZone(box(59.29, 18.02, 0.03), C.high, 'SW zone — High');
    sampleZone(box(59.29, 18.12, 0.03), C.extreme, 'SE zone — Extreme');
  }

  function drawHeat() {
    const C = { comfortable: '#2C7FB8', caution: '#FAC775', warning: '#EF9F27', extreme: '#E24B4A' };
    const box = (cy, cx, d) => [[cy - d, cx - d], [cy - d, cx + d], [cy + d, cx + d], [cy + d, cx - d]];
    sampleZone(box(59.345, 18.04, 0.035), C.caution, 'Inner west — Caution');
    sampleZone(box(59.315, 18.08, 0.035), C.warning, 'City core — Warning');
    sampleZone(box(59.305, 18.13, 0.030), C.extreme, 'SE built-up — Extreme');
    sampleZone(box(59.355, 18.13, 0.030), C.comfortable, 'Gärdet green — Comfortable');
    // Vulnerable sites layer ON by default for heat (care homes, preschools).
    [
      [[59.336, 18.060], 'Vasastan care home'],
      [[59.312, 18.078], 'Södermalm preschool'],
      [[59.345, 18.105], 'Östermalm care home'],
      [[59.300, 18.110], 'Hammarby preschool']
    ].forEach(([ll, l]) => {
      L.marker(ll, { icon: L.divIcon({ className: 'vuln-pin', html: '♥', iconSize: [18, 18] }) })
        .bindTooltip(`${l} (sample vulnerable site)`, { sticky: true }).addTo(gVulnerable);
    });
  }

  /* ============================================================
   * Rain hazard — simulated precipitation data
   * ========================================================== */

  const RAIN_DISTRICTS = [
    { id: 'norrmalm',    name: 'Norrmalm',    lat: 59.3350, lon: 18.0630 },
    { id: 'sodermalm',   name: 'Södermalm',   lat: 59.3160, lon: 18.0720 },
    { id: 'ostermalm',   name: 'Östermalm',   lat: 59.3400, lon: 18.0850 },
    { id: 'kungsholmen', name: 'Kungsholmen', lat: 59.3300, lon: 18.0300 },
    { id: 'vasastan',    name: 'Vasastan',    lat: 59.3460, lon: 18.0550 },
    { id: 'gamla_stan',  name: 'Gamla Stan',  lat: 59.3230, lon: 18.0710 },
    { id: 'djurgarden',  name: 'Djurgården',  lat: 59.3340, lon: 18.1100 },
    { id: 'hammarby',    name: 'Hammarby',    lat: 59.3020, lon: 18.0890 },
    { id: 'bromma',      name: 'Bromma',      lat: 59.3380, lon: 17.9450 },
  ];

  function rainfallColor(pct) {
    if (pct < 30) return '#bfdbfe';
    if (pct < 50) return '#60a5fa';
    if (pct < 65) return '#2563eb';
    return '#1e3a8a';
  }
  function rainfallLabel(pct) {
    if (pct < 30) return 'Low chance';
    if (pct < 50) return 'Moderate';
    if (pct < 65) return 'Likely';
    return 'Very likely';
  }

  function generateRainData() {
    return RAIN_DISTRICTS.map(d => ({
      ...d,
      rainfall:         Math.round(20  + seededRand(dSeed(d.id, 0)) * 55),
      dewPoint:         Math.round((7  + seededRand(dSeed(d.id, 1)) * 7) * 10) / 10,
      humidity:         Math.round(55  + seededRand(dSeed(d.id, 2)) * 27),
      totalRainfall_mm: Math.round(     seededRand(dSeed(d.id, 3)) * 90),
      startHour:        Math.floor(     seededRand(dSeed(d.id, 4)) * 21),
      durationHours:    Math.round(1  + seededRand(dSeed(d.id, 5)) * 7),
    }));
  }

  function drawRain() {
    const data = generateRainData();
    data.forEach(d => {
      const color = rainfallColor(d.rainfall);
      const endHour = Math.min(23, d.startHour + d.durationHours);
      L.circle([d.lat, d.lon], {
        radius: 1800, color, weight: 0, fillColor: color, fillOpacity: 0.22, interactive: false,
      }).addTo(gHazard);
      L.circleMarker([d.lat, d.lon], {
        radius: 9, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.95,
      }).bindPopup(`
        <div class="precip-popup" style="min-width:210px">
          <strong>${d.name}</strong>
          <div class="metric-row">
            <span class="metric-label">Rainfall probability</span>
            <div><div class="metric-value" style="color:${color}">${d.rainfall}%</div><div class="metric-sub">${rainfallLabel(d.rainfall)}</div></div>
          </div>
          <div class="metric-row"><span class="metric-label">Total expected</span><span class="metric-value">${d.totalRainfall_mm} mm</span></div>
          <div class="metric-row"><span class="metric-label">Dew point</span><span class="metric-value">${d.dewPoint} °C</span></div>
          <div class="metric-row"><span class="metric-label">Humidity</span><span class="metric-value">${d.humidity}%</span></div>
          <div class="popup-dur">
            <div class="popup-dur-label">Duration · ${fmtHour(d.startHour)} – ${fmtHour(endHour)} (${d.durationHours} hr${d.durationHours > 1 ? 's' : ''})</div>
            <div class="dur-bar" style="gap:1px;height:12px">${durBarHtml(d.startHour, d.durationHours, 'on-rain')}</div>
            <div class="dur-ticks" style="font-size:8px"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          </div>
        </div>
      `).addTo(gHazard);
    });
  }

  /* ============================================================
   * Provenance bar
   * ========================================================== */
  function setProvenance(text, confidence, isPlaceholder) {
    const t = document.getElementById('provenance-text');
    const c = document.getElementById('provenance-confidence');
    if (t) t.innerHTML = (isPlaceholder ? '<span class="prov-flag">PLACEHOLDER</span> ' : '') + escapeHtml(text);
    if (c) {
      c.textContent = 'Confidence: ' + confidence;
      c.className = 'prov-confidence conf-' + confidence;
    }
  }

  /* ============================================================
   * Decision panel
   * ========================================================== */
  function renderDecisionPanel(haz) {
    document.getElementById('decision-title').textContent = haz.decisionTitle;
    const host = document.getElementById('decision-fields');
    host.innerHTML = haz.fields.map(f => {
      const id = 'fld-' + f.label.toLowerCase().replace(/[^a-z]+/g, '-');
      let control;
      if (f.kind === 'select') {
        control = `<select id="${id}" class="dp-input">${f.options.map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
      } else if (f.kind === 'textarea') {
        control = `<textarea id="${id}" class="dp-input" rows="2" placeholder="${escapeHtml(f.placeholder || '')}"></textarea>`;
      } else if (f.kind === 'draw') {
        control = `<div class="dp-draw" id="${id}">Draw the area on the map →</div>`;
      } else {
        control = `<input id="${id}" class="dp-input" type="text" placeholder="${escapeHtml(f.placeholder || '')}"/>`;
      }
      return `<label class="dp-field"><span class="dp-field-label">${escapeHtml(f.label)}</span>${control}</label>`;
    }).join('');

    const primary = document.getElementById('action-primary');
    const secondary = document.getElementById('action-secondary');
    primary.textContent = haz.buttons[0];
    secondary.textContent = haz.buttons[1];
    primary.onclick = () => receipt(`${haz.buttons[0]} — recorded (prototype). Decision would carry a source-tagged provenance snapshot.`);
    secondary.onclick = () => receipt(`${haz.buttons[1]} — recorded (prototype).`);
    document.getElementById('decision-receipt').textContent = '';
  }
  function receipt(msg) {
    const el = document.getElementById('decision-receipt');
    if (el) el.textContent = msg;
  }

  /* ============================================================
   * Export source-tagged report
   * ========================================================== */
  function exportReport() {
    const haz = HAZARDS[currentHazard];
    const report = {
      hazard: currentHazard,
      generatedAt: new Date().toISOString(),
      confidence: haz.confidence === undefined ? 'mixed' : (currentHazard === 'air' ? 'mixed' : haz.confidence),
      sources: haz.sources,
      provenance: document.getElementById('provenance-text').textContent,
      real: !!haz.real,
      note: haz.real ? 'Live source-tagged readings.' : 'PLACEHOLDER hazard — sample data, not a real measurement.',
      readings: (currentHazard === 'air' && integrationData) ? integrationData.stations : []
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cleanpath-${currentHazard}-report.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    receipt('Source-tagged report exported.');
  }

  /* ============================================================
   * Per-hazard config — the ONLY things that swap between tabs
   * ========================================================== */
  const HAZARDS = {
    air: {
      eyebrow: 'Air quality', verb: 'Issue or lift an air quality advisory',
      decisionTitle: 'Air quality advisory',
      sources: 'SMHI · WAQI · luftdaten · CAMS (modelled)',
      legend: { title: 'PM2.5', items: [
        { c: '#1D9E75', t: 'Low (1–3)' }, { c: '#EF9F27', t: 'Moderate (4–6)' },
        { c: '#E24B4A', t: 'High (7–9)' }, { c: '#7F1D1D', t: 'Very high (10)' }
      ] },
      layers: [
        { key: 'hazard', label: 'PM2.5 plume (CAMS) + stations', on: true, dot: '#E24B4A' },
        { key: 'integration', label: 'Integration layer', on: true, dot: '#534AB7' },
        { key: 'vulnerable', label: 'Vulnerable sites', on: false, dot: '#A32D2D' }
      ],
      fields: [
        { label: 'Area', kind: 'draw' },
        { label: 'Level', kind: 'select', options: ['Low', 'Moderate', 'High', 'Very high'] },
        { label: 'Affected districts', kind: 'text', placeholder: 'e.g. Södermalm, Kungsholmen' },
        { label: 'Message', kind: 'textarea', placeholder: 'Advisory text…' }
      ],
      buttons: ['Issue', 'Lift'], confidence: 'mixed', real: true,
      activate: activateAir
    },
    algae: {
      eyebrow: 'Bathing water', verb: 'Open or lift a bathing-water advisory, site by site',
      decisionTitle: 'Bathing-water advisory',
      sources: 'In-situ samples · satellite (Copernicus Marine)',
      legend: { title: 'Bloom status', items: [
        { c: '#9CA3AF', t: 'None' }, { c: '#FAC775', t: 'Watch' },
        { c: '#EF9F27', t: 'Advisory' }, { c: '#E24B4A', t: 'Closed' }
      ] },
      layers: [
        { key: 'hazard', label: 'Bloom status (placeholder)', on: true, dot: '#EF9F27' },
        { key: 'integration', label: 'Integration layer', on: false, dot: '#534AB7' },
        { key: 'vulnerable', label: 'Vulnerable sites', on: false, dot: '#A32D2D' }
      ],
      fields: [
        { label: 'Site', kind: 'select', options: ['Brunnsviken', 'Hellasgården', 'Lilla Värtan', 'Smedsuddsbadet'] },
        { label: 'Status', kind: 'select', options: ['None', 'Watch', 'Advisory', 'Closed'] },
        { label: 'Scope', kind: 'text', placeholder: 'this site only' },
        { label: 'Message', kind: 'textarea', placeholder: 'Notice text…' }
      ],
      buttons: ['Post', 'Lift'], confidence: 'thin', real: false,
      provenance: 'Observed: local samples (few). Modelled: Copernicus Marine / SMHI satellite.',
      draw: drawAlgae, activate: activatePlaceholder
    },
    fire: {
      eyebrow: 'Fire risk', verb: 'Declare or lift an open-burning ban',
      decisionTitle: 'Open-burning ban',
      sources: 'SMHI brandrisk · EFFIS',
      legend: { title: 'Fire-risk index', items: [
        { c: '#1D9E75', t: 'Low' }, { c: '#FAC775', t: 'Moderate' },
        { c: '#EF9F27', t: 'High' }, { c: '#E24B4A', t: 'Extreme' }
      ] },
      layers: [
        { key: 'hazard', label: 'Fire-risk index (placeholder)', on: true, dot: '#EF9F27' },
        { key: 'integration', label: 'Integration layer', on: false, dot: '#534AB7' },
        { key: 'vulnerable', label: 'Vulnerable sites', on: false, dot: '#A32D2D' }
      ],
      fields: [
        { label: 'Zone', kind: 'select', options: ['NW', 'NE', 'SW', 'SE'] },
        { label: 'Level', kind: 'select', options: ['Low', 'Moderate', 'High', 'Extreme'] },
        { label: 'Scope', kind: 'text', placeholder: 'by zone' },
        { label: 'Notice', kind: 'textarea', placeholder: 'Ban notice…' }
      ],
      buttons: ['Declare', 'Lift'], confidence: 'modelled', real: false,
      provenance: 'Modelled only — no direct measurement.',
      draw: drawFire, activate: activatePlaceholder
    },
    heat: {
      eyebrow: 'Extreme heat', verb: 'Activate the municipal heat plan',
      decisionTitle: 'Municipal heat plan',
      sources: 'SMHI stations · värmebölja',
      legend: { title: 'Apparent temperature', items: [
        { c: '#2C7FB8', t: 'Comfortable' }, { c: '#FAC775', t: 'Caution' },
        { c: '#EF9F27', t: 'Warning' }, { c: '#E24B4A', t: 'Extreme' }
      ] },
      layers: [
        { key: 'hazard', label: 'Apparent-temp surface (placeholder)', on: true, dot: '#EF9F27' },
        { key: 'vulnerable', label: 'Vulnerable sites', on: true, dot: '#A32D2D' },
        { key: 'integration', label: 'Integration layer', on: false, dot: '#534AB7' }
      ],
      fields: [
        { label: 'Priority', kind: 'select', options: ['Care homes', 'Preschools', 'Both'] },
        { label: 'Window', kind: 'text', placeholder: 'e.g. 12:00–18:00' },
        { label: 'Scope', kind: 'text', placeholder: 'areas + sites' },
        { label: 'Message', kind: 'textarea', placeholder: 'Activation message…' }
      ],
      buttons: ['Activate', 'Stand down'], confidence: 'high', real: false,
      provenance: 'Measured: SMHI temperature stations (dense). Forecast: värmebölja.',
      draw: drawHeat, activate: activatePlaceholder
    },
    rain: {
      eyebrow: 'Precipitation',
      verb: 'Issue or lift a rainfall advisory',
      decisionTitle: 'Rainfall advisory',
      sources: 'SMHI-shaped simulated data',
      legend: {
        title: 'Rain · Probability',
        items: [
          { c: '#bfdbfe', t: 'Low (<30%)' },
          { c: '#60a5fa', t: 'Moderate (30–49%)' },
          { c: '#2563eb', t: 'Likely (50–64%)' },
          { c: '#1e3a8a', t: 'Very likely (65%+)' }
        ]
      },
      layers: [
        { key: 'hazard', label: 'Rainfall probability (simulated)', on: true, dot: '#2563eb' }
      ],
      fields: [
        { label: 'Area', kind: 'draw' },
        { label: 'Level', kind: 'select', options: ['Watch', 'Advisory', 'Warning'] },
        { label: 'Affected districts', kind: 'text', placeholder: 'e.g. Södermalm, Vasastan' },
        { label: 'Message', kind: 'textarea', placeholder: 'Advisory text…' }
      ],
      buttons: ['Issue', 'Lift'],
      confidence: 'thin',
      real: false,
      provenance: 'Simulated · SMHI-shaped district data. No live connection yet.',
      activate: function(haz) {
        setLayerStatus([{ id: 'rain', label: 'Rainfall layer (simulated)', state: 'offline', detail: 'simulated · SMHI adapter not connected' }]);
        setProvenance(haz.provenance, haz.confidence, true);
        drawRain();
      }
    }
  };

  /* ============================================================
   * Tab switching — swaps layer, legend, verb, provenance only
   * ========================================================== */
  function selectHazard(key) {
    const haz = HAZARDS[key];
    if (!haz || !map) return;
    currentHazard = key;

    // Clear all hazard-driven layers; each module repopulates what it needs.
    gHazard.clearLayers(); gIntegration.clearLayers(); gVulnerable.clearLayers();
    if (camsHeat && map.hasLayer(camsHeat)) { map.removeLayer(camsHeat); camsHeat = null; }

    document.getElementById('hazard-eyebrow').textContent = haz.eyebrow;
    document.getElementById('hazard-verb').textContent = haz.verb;
    document.getElementById('source-line').textContent = 'Sources: ' + haz.sources +
      (haz.real ? '' : '  ·  placeholder until adapter lands');

    document.querySelectorAll('#hazard-tabs .tab').forEach(t => {
      const on = t.dataset.hazard === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const banner = document.getElementById('placeholder-banner');
    if (banner) banner.style.display = haz.real ? 'none' : 'block';

    renderLegend(haz);
    renderLayersPanel(haz);
    renderDecisionPanel(haz);
    haz.activate(haz);
    setTimeout(() => map.invalidateSize(), 50);
  }

  /* ============================================================
   * Time slider + clock
   * ========================================================== */
  function currentLeadHour() {
    const s = document.getElementById('time-slider');
    return s ? parseInt(s.value, 10) || 0 : 0;
  }
  function initSlider() {
    const slider = document.getElementById('time-slider');
    const period = document.getElementById('slider-period');
    const clock = document.getElementById('shell-clock');
    if (!slider) return;
    const update = () => {
      const lead = currentLeadHour();
      const t = (14 + lead) % 24;
      const hh = String(t).padStart(2, '0') + ':00';
      if (clock) clock.textContent = hh;
      if (period) period.textContent = lead === 0 ? 'now' : `forecast +${lead}h`;
    };
    let debounce;
    slider.addEventListener('input', () => {
      update();
      if (currentHazard === 'air') {
        clearTimeout(debounce);
        debounce = setTimeout(() => loadCams(currentLeadHour()), 350);
      }
    });
    update();
  }

  /* ============================================================
   * Boot
   * ========================================================== */
  function boot() {
    initMap();
    initSlider();
    document.getElementById('export-report').addEventListener('click', exportReport);
    document.querySelectorAll('#hazard-tabs .tab').forEach(t =>
      t.addEventListener('click', () => selectHazard(t.dataset.hazard)));
    // Wait for the map to be ready, then open the Air tab.
    (function start() {
      if (!map) { setTimeout(start, 50); return; }
      selectHazard('air');
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
