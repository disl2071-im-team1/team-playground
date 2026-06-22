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
      updateAirHero();
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

  /* ============================================================
   * Air quality situation hero — clear status for officers
   * ========================================================== */

  const BAND_META = {
    low:    { label: 'Low',       cls: 'aq-level-low',   dot: '#2D8653', verdict: 'Air quality is good across Stockholm. No advisory needed right now.', verdictCls: '' },
    mod:    { label: 'Moderate',  cls: 'aq-level-mod',   dot: '#D4A042', verdict: 'Air quality is elevated in some areas. Monitor closely and consider a precautionary advisory for sensitive groups.', verdictCls: 'verdict-warn' },
    high:   { label: 'High',      cls: 'aq-level-high',  dot: '#C24F4F', verdict: 'Air quality is poor in multiple stations. Consider issuing an advisory, especially near affected districts.', verdictCls: 'verdict-alert' },
    vhigh:  { label: 'Very high', cls: 'aq-level-vhigh', dot: '#8A1515', verdict: 'Air quality is very poor. An advisory should be issued immediately for affected areas.', verdictCls: 'verdict-alert' }
  };

  function pm25ToBand(pm25) {
    if (pm25 == null) return null;
    if (pm25 < 10) return 'low';
    if (pm25 < 25) return 'mod';
    if (pm25 < 50) return 'high';
    return 'vhigh';
  }

  function updateAirHero() {
    const hero = document.getElementById('aq-hero');
    if (!hero) return;

    if (!integrationData || !integrationData.stations || integrationData.stations.length === 0) {
      hero.style.display = 'flex';
      const lvl = document.getElementById('aq-hero-level');
      const hl  = document.getElementById('aq-hero-headline');
      if (lvl) { lvl.textContent = 'Loading'; lvl.className = 'aq-hero-level aq-level-loading'; }
      if (hl)  hl.textContent = 'Waiting for station data…';
      return;
    }

    // Count stations per band using PM2.5 values
    const counts = { low: 0, mod: 0, high: 0, vhigh: 0 };
    let worstBand = 'low';
    const BAND_ORDER = ['low', 'mod', 'high', 'vhigh'];

    integrationData.stations.forEach(s => {
      const pm25entry = s.pollutants.find(p => p.metric === 'pm2.5' || p.metric === 'pm25');
      const band = pm25entry ? pm25ToBand(pm25entry.value) : null;
      if (band) {
        counts[band]++;
        if (BAND_ORDER.indexOf(band) > BAND_ORDER.indexOf(worstBand)) worstBand = band;
      }
    });

    const total = integrationData.stations.length;
    const meta  = BAND_META[worstBand];

    // Headline
    const headlines = {
      low:   `Air quality is good across Stockholm`,
      mod:   `Elevated levels detected in ${counts.mod + counts.high + counts.vhigh} station${counts.mod + counts.high + counts.vhigh !== 1 ? 's' : ''}`,
      high:  `Poor air quality at ${counts.high + counts.vhigh} station${counts.high + counts.vhigh !== 1 ? 's' : ''}`,
      vhigh: `Very poor air quality — immediate attention required`
    };

    const lvl  = document.getElementById('aq-hero-level');
    const hl   = document.getElementById('aq-hero-headline');
    const bkdn = document.getElementById('aq-hero-breakdown');
    const verd = document.getElementById('aq-hero-verdict');

    if (lvl) { lvl.textContent = meta.label; lvl.className = 'aq-hero-level ' + meta.cls; }
    if (hl)  hl.textContent = headlines[worstBand];
    if (bkdn) {
      const items = BAND_ORDER.filter(b => counts[b] > 0).map(b => {
        const m = BAND_META[b];
        return `<span class="aq-breakdown-item">
          <span class="aq-breakdown-dot" style="background:${m.dot}"></span>
          ${counts[b]} ${m.label}
        </span>`;
      });
      bkdn.innerHTML = items.join('') + `<span class="aq-breakdown-item" style="color:var(--text-tertiary)">${total} stations total</span>`;
    }
    if (verd) { verd.textContent = meta.verdict; verd.className = 'aq-hero-verdict ' + meta.verdictCls; }

    hero.style.display = 'flex';
  }

  function showAirHero()  { const h = document.getElementById('aq-hero'); if (h) h.style.display = 'flex'; }
  function hideAirHero()  { const h = document.getElementById('aq-hero'); if (h) h.style.display = 'none'; }

  /* ============================================================
   * Algae hero
   * ========================================================== */

  const ALGAE_SITES = [
    {
      name: 'Brunnsviken', ll: [59.368, 18.012], status: 'none',
      obs: { cyanobacteria: '< 100 cells/mL', chlorophyll: '4 µg/L', visibility: '2.8 m', temp: '18 °C' },
      dataAge: '2h ago', stale: false,
      factors: [
        { icon: '🌡️', text: 'Water temperature within normal range for season' },
        { icon: '💨', text: 'Northerly wind dispersing surface accumulation' },
        { icon: '☀️', text: 'Moderate sunlight — bloom growth unlikely today' },
      ],
      recommendation: 'No action needed. Continue routine weekly sampling. Next scheduled check: Friday.',
      audit: [
        { time: '2 days ago', text: 'Status confirmed Clear after field sample. Officer: A. Lindqvist' },
        { time: '9 days ago', text: 'Routine check — no change' },
      ],
    },
    {
      name: 'Hellasgården', ll: [59.260, 18.171], status: 'watch',
      obs: { cyanobacteria: '2 400 cells/mL', chlorophyll: '18 µg/L', visibility: '1.2 m', temp: '22 °C' },
      dataAge: '5h ago', stale: false,
      factors: [
        { icon: '🦠', text: 'Cyanobacteria count elevated — approaching advisory threshold (10 000 cells/mL)' },
        { icon: '🌡️', text: 'Water temp 22 °C — favourable for bloom growth' },
        { icon: '🌬️', text: 'Low wind speed, calm surface — accumulation risk high' },
        { icon: '📈', text: 'Count up 3× vs last week — upward trend' },
      ],
      recommendation: 'Recommend escalating to Advisory if next sample confirms count > 5 000 cells/mL. Consider posting watch signage at site entry. Re-sample within 48 h.',
      audit: [
        { time: '5h ago',    text: 'Status changed: Clear → Watch. Count 2 400 cells/mL. Officer: M. Eriksson' },
        { time: '8 days ago', text: 'Routine check — Clear confirmed' },
      ],
    },
    {
      name: 'Lilla Värtan', ll: [59.345, 18.110], status: 'advisory',
      obs: { cyanobacteria: '28 000 cells/mL', chlorophyll: '52 µg/L', visibility: '0.4 m', temp: '24 °C' },
      dataAge: '1h ago', stale: false,
      factors: [
        { icon: '⚠️', text: 'Cyanobacteria count well above advisory threshold' },
        { icon: '🌡️', text: 'Highest water temperature in network — bloom conditions peak' },
        { icon: '🌊', text: 'Surface scum visible on SE shore — direct contact risk' },
        { icon: '🔬', text: 'Species identified: Microcystis aeruginosa — toxin-producing strain' },
      ],
      recommendation: 'Maintain Advisory. Issue public notification. Re-sample every 24 h. Escalate to Closed if scum covers > 30% of bathing area or count exceeds 100 000 cells/mL.',
      audit: [
        { time: '1h ago',    text: 'Re-sample confirmed — count remains elevated. Officer: A. Lindqvist' },
        { time: '2 days ago', text: 'Status changed: Watch → Advisory. Count 28 000 cells/mL. Officer: M. Eriksson' },
        { time: '5 days ago', text: 'Status changed: Clear → Watch. Officer: M. Eriksson' },
      ],
    },
    {
      name: 'Smedsuddsbadet', ll: [59.318, 18.020], status: 'none',
      obs: { cyanobacteria: '< 100 cells/mL', chlorophyll: '3 µg/L', visibility: '3.1 m', temp: '17 °C' },
      dataAge: '3 days ago', stale: true,
      factors: [
        { icon: '🕐', text: 'Data is 3 days old — last sample overdue. Confidence: low.' },
        { icon: '🌊', text: 'Sheltered inlet — historically prone to accumulation in calm periods' },
      ],
      recommendation: 'Schedule urgent re-sample. Current Clear status cannot be confirmed — data is stale. Do not issue Clear confirmation until fresh sample received.',
      audit: [
        { time: '3 days ago', text: 'Routine sample — Clear confirmed. Officer: P. Holm' },
        { time: '10 days ago', text: 'Routine sample — Clear confirmed' },
      ],
    },
    {
      name: 'Flatenbadet', ll: [59.258, 18.115], status: 'none',
      obs: { cyanobacteria: '300 cells/mL', chlorophyll: '6 µg/L', visibility: '2.1 m', temp: '20 °C' },
      dataAge: '6h ago', stale: false,
      factors: [
        { icon: '✅', text: 'Count well below watch threshold' },
        { icon: '💨', text: 'Good wind mixing — low accumulation risk' },
      ],
      recommendation: 'No action. Continue routine sampling.',
      audit: [
        { time: '6h ago',    text: 'Routine sample — Clear. Officer: S. Bergström' },
        { time: '8 days ago', text: 'Routine sample — Clear' },
      ],
    },
    {
      name: 'Långsjön', ll: [59.300, 17.940], status: 'none',
      obs: { cyanobacteria: '150 cells/mL', chlorophyll: '5 µg/L', visibility: '2.5 m', temp: '19 °C' },
      dataAge: '1 day ago', stale: false,
      factors: [
        { icon: '✅', text: 'Count within safe range' },
        { icon: '🌿', text: 'Dense reed bed on north shore provides natural filtration' },
      ],
      recommendation: 'No action. Next routine sample due in 6 days.',
      audit: [
        { time: '1 day ago',  text: 'Routine sample — Clear. Officer: A. Lindqvist' },
        { time: '8 days ago', text: 'Routine sample — Clear' },
      ],
    },
    {
      name: 'Råstasjön', ll: [59.369, 17.990], status: 'advisory',
      obs: { cyanobacteria: '15 000 cells/mL', chlorophyll: '38 µg/L', visibility: '0.6 m', temp: '23 °C' },
      dataAge: '4h ago', stale: false,
      factors: [
        { icon: '⚠️', text: 'Count above advisory threshold — active bloom confirmed' },
        { icon: '🏊', text: 'High visitor volume site — public health risk elevated' },
        { icon: '🌡️', text: 'Sustained warm temperatures forecast for next 5 days' },
      ],
      recommendation: 'Maintain Advisory. Signs posted. Re-sample tomorrow. Consider pre-emptive Closed status given forecast heat and high visitor numbers.',
      audit: [
        { time: '4h ago',    text: 'Re-sample confirmed bloom. Count 15 000 cells/mL. Officer: M. Eriksson' },
        { time: '3 days ago', text: 'Status changed: Clear → Advisory. Officer: P. Holm' },
      ],
    },
    {
      name: 'Judarn', ll: [59.345, 17.980], status: 'none',
      obs: { cyanobacteria: '< 100 cells/mL', chlorophyll: '4 µg/L', visibility: '3.0 m', temp: '18 °C' },
      dataAge: '1 day ago', stale: false,
      factors: [
        { icon: '✅', text: 'All indicators within normal range' },
        { icon: '🌲', text: 'Forested catchment — lower nutrient runoff than urban sites' },
      ],
      recommendation: 'No action. Model forecasts low bloom risk for next 7 days.',
      audit: [
        { time: '1 day ago',  text: 'Routine sample — Clear. Officer: S. Bergström' },
        { time: '8 days ago', text: 'Routine sample — Clear' },
      ],
    },
  ];

  function updateAlgaeHero() {
    const hero = document.getElementById('algae-hero');
    if (!hero) return;
    const total = ALGAE_SITES.length;
    const advisories = ALGAE_SITES.filter(s => s.status === 'advisory' || s.status === 'closed').length;
    const watches = ALGAE_SITES.filter(s => s.status === 'watch').length;

    const lvlEl  = document.getElementById('algae-hero-level');
    const hdEl   = document.getElementById('algae-hero-headline');
    const bkEl   = document.getElementById('algae-hero-breakdown');
    const vdEl   = document.getElementById('algae-hero-verdict');

    if (advisories === 0 && watches === 0) {
      if (lvlEl)  { lvlEl.textContent = 'Clear'; lvlEl.className = 'aq-hero-level aq-level-low'; }
      if (hdEl)   hdEl.textContent = 'All bathing sites are clear across Stockholm';
      if (bkEl)   bkEl.innerHTML = `<span class="aq-breakdown-item">${total} sites monitored — no active advisories</span>`;
      if (vdEl)   { vdEl.textContent = 'Safe to swim at all monitored sites.'; vdEl.className = 'aq-hero-verdict'; }
    } else {
      const lvl = advisories > 0 ? 'Advisory' : 'Watch';
      const cls = advisories > 0 ? 'aq-level-high' : 'aq-level-mod';
      if (lvlEl)  { lvlEl.textContent = lvl; lvlEl.className = 'aq-hero-level ' + cls; }
      if (hdEl)   hdEl.textContent = advisories > 0
        ? `${advisories} out of ${total} bathing sites have active advisories`
        : `${watches} out of ${total} bathing sites are on algae watch`;
      const parts = [];
      if (advisories) parts.push(`<span class="aq-breakdown-item" style="color:var(--band-high)">${advisories} advisory</span>`);
      if (watches)    parts.push(`<span class="aq-breakdown-item" style="color:var(--band-mod)">${watches} watch</span>`);
      parts.push(`<span class="aq-breakdown-item" style="color:var(--text-tertiary)">${total - advisories - watches} clear</span>`);
      if (bkEl)   bkEl.innerHTML = parts.join('');
      if (vdEl)   { vdEl.textContent = advisories ? 'Avoid swimming at affected sites.' : 'Exercise caution at watch sites.'; vdEl.className = 'aq-hero-verdict'; }
    }

    hero.style.display = 'flex';
  }

  function showAlgaeHero() { const h = document.getElementById('algae-hero'); if (h) h.style.display = 'flex'; }
  function hideAlgaeHero() { const h = document.getElementById('algae-hero'); if (h) h.style.display = 'none'; }

  function activateAlgae(haz) {
    hidePollen();
    hideAirHero();
    updateAlgaeHero();
    setLayerStatus([{ id: 'algae', label: haz.layers[0].label, state: 'offline', detail: 'placeholder · adapter not yet connected' }]);
    setProvenance(haz.provenance, haz.confidence, true);
    if (haz.draw) haz.draw();
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

  /* ============================================================
   * Pollen — Air tab only
   * ========================================================== */

  const POLLEN_DEMO = [
    { name: 'Grass',   sv: 'Gräs',    count: 92,  icon: '🌾' },
    { name: 'Mugwort', sv: 'Gråbo',   count: 38,  icon: '🌿' },
    { name: 'Nettle',  sv: 'Nässla',  count: 14,  icon: '🍃' },
    { name: 'Birch',   sv: 'Björk',   count: 6,   icon: '🌳' },
    { name: 'Hazel',   sv: 'Hassel',  count: 2,   icon: '🌰' },
    { name: 'Alder',   sv: 'Al',      count: 1,   icon: '🌱' }
  ];

  function pollenBand(count) {
    if (count === 0) return { label: 'None',      cls: 'pollen-badge-none',  color: '#91A896' };
    if (count <= 10) return { label: 'Low',       cls: 'pollen-badge-low',   color: '#2D8653' };
    if (count <= 50) return { label: 'Moderate',  cls: 'pollen-badge-mod',   color: '#D4A042' };
    if (count <= 100) return { label: 'High',     cls: 'pollen-badge-high',  color: '#C24F4F' };
    return               { label: 'Very high',    cls: 'pollen-badge-vhigh', color: '#A03030' };
  }

  function renderPollen(types, updated) {
    const strip = document.getElementById('pollen-strip');
    const grid  = document.getElementById('pollen-grid');
    const sub   = document.getElementById('pollen-updated');
    if (!strip || !grid) return;

    if (updated) sub.textContent = 'Updated ' + updated;

    const max = Math.max(1, ...types.map(t => t.count));
    grid.innerHTML = types.map(t => {
      const band = pollenBand(t.count);
      const pct  = Math.round((t.count / max) * 100);
      const icon = t.icon || '🌿';
      return `<div class="pollen-card">
        <div class="pollen-card-glow" style="background:radial-gradient(circle at 20% 80%, ${band.color}, transparent 70%)"></div>
        <span class="pollen-icon">${icon}</span>
        <div class="pollen-name">${escapeHtml(t.name)}</div>
        <span class="pollen-name-sv">${escapeHtml(t.sv)}</span>
        <span class="pollen-count" style="color:${band.color}">${t.count}</span>
        <span class="pollen-badge ${band.cls}">${band.label}</span>
        <div class="pollen-bar-track">
          <div class="pollen-bar-fill" style="width:${pct}%;background:${band.color}"></div>
        </div>
      </div>`;
    }).join('');

    strip.style.display = 'block';
  }

  async function loadPollen() {
    try {
      const res = await fetch('/api/pollen', { cache: 'no-store' });
      if (!res.ok) throw new Error('no endpoint');
      const data = await res.json();
      if (!data.ok || !data.types) throw new Error('no data');
      renderPollen(data.types, data.updated);
    } catch {
      renderPollen(POLLEN_DEMO, 'demo · pollenrapporten.se not yet connected');
    }
  }

  function hidePollen() {
    const strip = document.getElementById('pollen-strip');
    if (strip) strip.style.display = 'none';
  }

  function activateAir(haz) {
    hideAlgaeHero();
    setLayerStatus([
      { id: 'stations', label: 'WAQI stations' },
      { id: 'integration', label: 'Integration layer' },
      { id: 'cams', label: 'CAMS (modelled)' }
    ]);
    setProvenance('Measured: SMHI · WAQI · luftdaten. Modelled: CAMS grid (station = none).', 'mixed', false);
    showAirHero();
    loadStations();
    loadIntegrationLayer();
    loadCams(currentLeadHour());
    loadPollen();
  }

  /* ============================================================
   * Placeholder hazards — clearly labelled, never real
   * ========================================================== */

  // Each placeholder draws a few sample shapes in the legend colours, all
  // marked "(sample)" in their tooltips, plus the topright PLACEHOLDER banner.
  function activatePlaceholder(haz) {
    hidePollen();
    hideAirHero();
    hideAlgaeHero();
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

  const ALGAE_STATUS_COLOR = { none: '#9CA3AF', watch: '#FAC775', advisory: '#EF9F27', closed: '#E24B4A' };
  const ALGAE_STATUS_LABEL = { none: 'Clear', watch: 'Watch', advisory: 'Advisory', closed: 'Closed' };

  function drawAlgae() {
    ALGAE_SITES.forEach(site => {
      const color = ALGAE_STATUS_COLOR[site.status] || '#9CA3AF';
      const marker = L.circleMarker(site.ll, {
        radius: 9, fillColor: color, color: '#FFFFFF', weight: 2, fillOpacity: 0.95
      });
      marker.bindTooltip(`<strong>${site.name}</strong><br>${ALGAE_STATUS_LABEL[site.status]}`, { sticky: true });
      marker.on('click', () => openAlgaeModal(site));
      marker.addTo(gHazard);
    });
  }

  /* ---- Algae modal ---- */

  let _modalSite = null;
  let _pendingStatus = null;

  function openAlgaeModal(site) {
    _modalSite = site;
    _pendingStatus = site.status;

    document.getElementById('algae-modal-eyebrow').textContent = 'Bathing site · Stockholm';
    document.getElementById('algae-modal-title').textContent = site.name;

    const badge = document.getElementById('algae-modal-badge');
    badge.textContent = ALGAE_STATUS_LABEL[site.status];
    badge.className = 'algae-modal-status-badge badge-' + site.status;

    // Observations
    const obsEl = document.getElementById('algae-modal-obs');
    const obsMap = {
      'Cyanobacteria': site.obs.cyanobacteria,
      'Chlorophyll-a': site.obs.chlorophyll,
      'Visibility':    site.obs.visibility,
      'Water temp':    site.obs.temp,
    };
    const valClass = site.status === 'advisory' || site.status === 'closed' ? 'val-high'
                   : site.status === 'watch' ? 'val-warn' : 'val-ok';
    obsEl.innerHTML = Object.entries(obsMap).map(([k, v]) =>
      `<div class="algae-modal-obs-item">
        <div class="algae-modal-obs-label">${k}</div>
        <div class="algae-modal-obs-value ${k === 'Cyanobacteria' ? valClass : ''}">${v}</div>
      </div>`
    ).join('');

    const ageEl = document.getElementById('algae-modal-age');
    ageEl.textContent = `Last sample: ${site.dataAge}`;
    ageEl.className = 'algae-modal-data-age' + (site.stale ? ' stale' : '');
    if (site.stale) ageEl.textContent += ' · ⚠ Data stale — re-sample urgently';

    // Risk factors
    document.getElementById('algae-modal-factors').innerHTML = site.factors.map(f =>
      `<div class="algae-modal-factor"><span class="algae-modal-factor-icon">${f.icon}</span><span>${f.text}</span></div>`
    ).join('');

    // Recommendation
    document.getElementById('algae-modal-rec').textContent = site.recommendation;

    // Audit
    document.getElementById('algae-modal-audit').innerHTML = site.audit.map(e =>
      `<div class="algae-modal-audit-entry"><span class="algae-modal-audit-time">${e.time}</span><span>${e.text}</span></div>`
    ).join('');

    // Status buttons
    renderStatusButtons(_pendingStatus);

    // Reset message/sent state
    document.getElementById('algae-modal-message').value = '';
    document.getElementById('algae-modal-sent').style.display = 'none';

    document.getElementById('algae-modal').style.display = 'flex';
  }

  function renderStatusButtons(active) {
    const row = document.getElementById('algae-modal-status-row');
    row.innerHTML = ['none', 'watch', 'advisory', 'closed'].map(s =>
      `<button class="algae-modal-status-btn ${active === s ? 'active-' + s : ''}" data-status="${s}">
        ${ALGAE_STATUS_LABEL[s]}
      </button>`
    ).join('');
    row.querySelectorAll('.algae-modal-status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _pendingStatus = btn.dataset.status;
        renderStatusButtons(_pendingStatus);
      });
    });
  }

  function closeAlgaeModal() {
    document.getElementById('algae-modal').style.display = 'none';
    _modalSite = null;
    _pendingStatus = null;
  }

  function algaeGenerateDraft() {
    if (!_modalSite) return;
    const s = _pendingStatus || _modalSite.status;
    const label = ALGAE_STATUS_LABEL[s];
    const templates = {
      none:     `Stockholm stad informerar: Vattenkvaliteten vid ${_modalSite.name} är god. Badvattnet bedöms som säkert för bad.`,
      watch:    `Stockholm stad informerar: Vi bevakar vattenkvaliteten vid ${_modalSite.name} på grund av förhöjda halter av cyanobakterier. Undvik att svälja vatten och skölj av dig efter bad.`,
      advisory: `BADVARNING – ${_modalSite.name}: Förhöjda halter av cyanobakterier har påvisats. Stockholms stad avråder från bad. Håll barn och husdjur borta från vattnet.`,
      closed:   `FÖRBUD MOT BAD – ${_modalSite.name}: Badplatsen är stängd till följd av hälsofarliga halter av cyanobakterier. Bad är förbjudet tills vidare.`,
    };
    document.getElementById('algae-modal-message').value = templates[s] || '';
  }

  function alsgaeSendAdvisory() {
    if (!_modalSite) return;
    const msg = document.getElementById('algae-modal-message').value.trim();
    if (!msg) { document.getElementById('algae-modal-message').focus(); return; }

    // Apply the status change to the data
    if (_pendingStatus && _pendingStatus !== _modalSite.status) {
      const old = _modalSite.status;
      _modalSite.status = _pendingStatus;
      _modalSite.audit.unshift({ time: 'just now', text: `Status changed: ${ALGAE_STATUS_LABEL[old]} → ${ALGAE_STATUS_LABEL[_pendingStatus]}. Message sent. Officer: You` });

      // Update badge
      const badge = document.getElementById('algae-modal-badge');
      badge.textContent = ALGAE_STATUS_LABEL[_pendingStatus];
      badge.className = 'algae-modal-status-badge badge-' + _pendingStatus;

      // Redraw map markers
      gHazard.clearLayers();
      drawAlgae();
      updateAlgaeHero();
    } else {
      _modalSite.audit.unshift({ time: 'just now', text: `Advisory message sent (status unchanged). Officer: You` });
    }

    document.getElementById('algae-modal-audit').innerHTML = _modalSite.audit.map(e =>
      `<div class="algae-modal-audit-entry"><span class="algae-modal-audit-time">${e.time}</span><span>${e.text}</span></div>`
    ).join('');

    document.getElementById('algae-modal-sent').style.display = 'block';
  }

  // Wire modal buttons (once on load)
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('algae-modal-close').addEventListener('click', closeAlgaeModal);
    document.getElementById('algae-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAlgaeModal(); });
    document.getElementById('algae-modal-generate').addEventListener('click', algaeGenerateDraft);
    document.getElementById('algae-modal-send').addEventListener('click', alsgaeSendAdvisory);
  });

  function drawFire() {
    const C = { low: '#1D9E75', moderate: '#FAC775', high: '#EF9F27', extreme: '#E24B4A' };
    const box = (cy, cx, d) => [[cy - d, cx - d], [cy - d, cx + d], [cy + d, cx + d], [cy + d, cx - d]];
    sampleZone(box(59.36, 18.02, 0.03), C.low, 'NW zone — Low');
    sampleZone(box(59.36, 18.12, 0.03), C.moderate, 'NE zone — Moderate');
    sampleZone(box(59.29, 18.02, 0.03), C.high, 'SW zone — High');
    sampleZone(box(59.29, 18.12, 0.03), C.extreme, 'SE zone — Extreme');
  }

  /* ---- Heat: apparent-temperature surface + vulnerable sites ----
   * Demo forecast shaped like SMHI output. Labelled placeholder until the
   * SMHI temperature adapter lands; never dressed up as real measurement.
   * Temperature is the deliberately high-confidence layer (largely measured),
   * a contrast to the modelled algae and fire surfaces. */
  const HEAT_DISTRICTS = [
    { name: 'Norrmalm',    lat: 59.337, lon: 18.058, base: 30.5 },
    { name: 'Södermalm',   lat: 59.314, lon: 18.072, base: 30.0 },
    { name: 'Östermalm',   lat: 59.337, lon: 18.085, base: 29.5 },
    { name: 'Vasastan',    lat: 59.346, lon: 18.045, base: 29.5 },
    { name: 'Kungsholmen', lat: 59.330, lon: 18.030, base: 28.5 },
    { name: 'Skärholmen',  lat: 59.277, lon: 17.907, base: 28.0 },
    { name: 'Älvsjö',      lat: 59.278, lon: 18.010, base: 27.0 }
  ];
  const HEAT_VULNERABLE = [
    { ll: [59.339, 18.061], type: 'care', name: 'Solgården äldreboende' },
    { ll: [59.333, 18.054], type: 'pre',  name: 'Förskolan Myran' },
    { ll: [59.312, 18.078], type: 'care', name: 'Söder äldrecentrum' },
    { ll: [59.318, 18.065], type: 'pre',  name: 'Förskolan Sjöhästen' },
    { ll: [59.340, 18.090], type: 'care', name: 'Östermalms servicehus' },
    { ll: [59.346, 18.045], type: 'pre',  name: 'Förskolan Tuppen' },
    { ll: [59.330, 18.030], type: 'care', name: 'Kungsholmens servicehus' },
    { ll: [59.278, 17.905], type: 'care', name: 'Skärholmens äldreboende' },
    { ll: [59.280, 17.912], type: 'pre',  name: 'Förskolan Galaxen' },
    { ll: [59.279, 18.010], type: 'care', name: 'Älvsjö äldreboende' }
  ];
  // Diurnal apparent-temperature bump by clock hour: peaks mid-afternoon.
  const HEAT_DIURNAL = { 12: 1, 13: 1.5, 14: 2, 15: 2.5, 16: 2.5, 17: 2, 18: 1, 19: 0, 20: -1, 21: -1.5, 22: -2, 23: -2.5, 0: -3, 1: -3, 2: -3.5 };

  function heatColor(t) {
    if (t >= 33) return '#E24B4A'; // Extreme
    if (t >= 30) return '#EF9F27'; // Warning
    if (t >= 27) return '#FAC775'; // Caution
    return '#2C7FB8';              // Comfortable
  }
  function heatBand(t) {
    if (t >= 33) return 'Extreme';
    if (t >= 30) return 'Warning';
    if (t >= 27) return 'Caution';
    return 'Comfortable';
  }
  function heatTempAt(d, lead) {
    const clock = (14 + lead) % 24;
    const bump = HEAT_DIURNAL[clock] != null ? HEAT_DIURNAL[clock] : -2;
    return Math.round((d.base + bump) * 10) / 10;
  }
  function drawHeatZones(lead) {
    HEAT_DISTRICTS.forEach(d => {
      const t = heatTempAt(d, lead);
      const c = heatColor(t);
      L.circle([d.lat, d.lon], { radius: 1000, color: c, weight: 1, opacity: 0.5, fillColor: c, fillOpacity: 0.38 })
        .bindTooltip(`${d.name} — känns som ${t}°C · ${heatBand(t)} (sample)`, { sticky: true })
        .addTo(gHazard);
    });
  }
  function drawHeatVulnerable() {
    HEAT_VULNERABLE.forEach(v => {
      const isCare = v.type === 'care';
      L.marker(v.ll, { icon: L.divIcon({ className: 'vuln-pin' + (isCare ? '' : ' vp-pre'), html: isCare ? '♥' : '◆', iconSize: [18, 18] }) })
        .bindTooltip(`${v.name} — ${isCare ? 'care home' : 'preschool'} (sample vulnerable site)`, { sticky: true })
        .addTo(gVulnerable);
    });
  }
  function drawHeat() {
    drawHeatZones(currentLeadHour());
    drawHeatVulnerable();
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
      draw: drawAlgae, activate: activateAlgae
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
      legend: { title: 'Apparent temp (känns som)', items: [
        { c: '#2C7FB8', t: 'Comfortable <27°' }, { c: '#FAC775', t: 'Caution 27–29°' },
        { c: '#EF9F27', t: 'Warning 30–32°' }, { c: '#E24B4A', t: 'Extreme 33°+' }
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
      draw: drawHeat,
      onLead: (lead) => { gHazard.clearLayers(); drawHeatZones(lead); },
      activate: activatePlaceholder
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
      } else {
        const haz = HAZARDS[currentHazard];
        if (haz && typeof haz.onLead === 'function') haz.onLead(currentLeadHour());
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
