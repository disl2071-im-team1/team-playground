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
      ).join('') +
      (haz.legend.cue ? `<div class="legend-cue">${escapeHtml(haz.legend.cue)}</div>` : '');
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
      if (currentHazard !== 'air') return; // officer switched tabs mid-fetch
      if (!data.ok) {
        if (data.configured === false) throw new Error('API token not configured');
        throw new Error(data.reason || 'unknown error');
      }
      // Measured points: crisp dots that sit on top of the modelled fill.
      // Label the three highest-index stations permanently so the worst
      // measured readings are legible without a click.
      const topThree = new Set(
        [...data.stations]
          .filter(s => s.pm25 != null && s.pm25.index != null)
          .sort((a, b) => b.pm25.index - a.pm25.index)
          .slice(0, 3)
      );
      let withPm25 = 0;
      data.stations.forEach(s => {
        const idx = s.pm25 != null ? s.pm25.index : null;
        const marker = L.circleMarker([s.lat, s.lon], {
          radius: 8, fillColor: indexToColor(idx), color: '#FFFFFF', weight: 2.5, fillOpacity: 0.95,
          className: 'air-station-dot'
        });
        const valueHtml = idx != null
          ? `<div class="station-value" style="color:${indexToColor(idx)}">PM2.5 index ${idx} · ${indexBand(idx)}</div>`
          : `<div class="station-value" style="color:#9CA3AF">No PM2.5 reading</div>`;
        marker.bindPopup(`<div class="station-popup"><strong>${escapeHtml(s.name)}</strong>
          <div class="station-meta">${escapeHtml(s.code)} · ${escapeHtml(s.siteType || '')}</div>${valueHtml}</div>`);
        if (idx != null && topThree.has(s)) {
          marker.bindTooltip(String(idx), { permanent: true, direction: 'top', offset: [0, -6], className: 'air-station-label' });
        }
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
      if (currentHazard !== 'air') return; // don't clobber another tab's provenance/hero
      if (!data.ok) throw new Error(data.reason || 'unavailable');
      integrationData = data;
      data.stations.forEach(s => {
        const color = SOURCE_COLORS[s.source] || '#5F5E5A';
        // Demoted to small hollow ticks (no fill circles) so it no longer
        // competes with the measured stations; off by default in the panel.
        const marker = L.circleMarker([s.lat, s.lon], { radius: 4, fillColor: color, fillOpacity: 0, color, weight: 1.5 });
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
      if (currentHazard !== 'air') return; // don't draw the CAMS plume onto another tab
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
      // Modelled field: wide radius + heavy blur + low minOpacity so clean
      // districts fade fully to transparent and the plume reads as one
      // coherent surface, not separate halos. Stays the modelled CAMS layer.
      radius: 42, blur: 30, minOpacity: 0.15, max: 1.0,
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
        { icon: '🌡️', text: 'Water temperature within normal range for season', tag: null },
        { icon: '💨', text: 'Northerly wind dispersing surface accumulation',   tag: 'wind-dispersal' },
        { icon: '☀️', text: 'Moderate sunlight — bloom growth unlikely today',  tag: null },
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
        { icon: '🦠', text: 'Cyanobacteria count elevated — approaching advisory threshold (10 000 cells/mL)', tag: 'watch-threshold' },
        { icon: '🌡️', text: 'Water temp 22 °C — favourable for bloom growth',                                 tag: 'high-temp' },
        { icon: '🌬️', text: 'Low wind speed, calm surface — accumulation risk high',                          tag: 'calm-surface' },
        { icon: '📈', text: 'Count up 3× vs last week — upward trend',                                        tag: 'upward-trend' },
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
        { icon: '⚠️', text: 'Cyanobacteria count well above advisory threshold',                    tag: 'high-count' },
        { icon: '🌡️', text: 'Highest water temperature in network — bloom conditions peak',         tag: 'high-temp' },
        { icon: '🌊', text: 'Surface scum visible on SE shore — direct contact risk',               tag: 'surface-scum' },
        { icon: '🔬', text: 'Species identified: Microcystis aeruginosa — toxin-producing strain',  tag: 'toxin-species' },
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
        { icon: '🕐', text: 'Data is 3 days old — last sample overdue. Confidence: low.', tag: 'stale-data' },
        { icon: '🌊', text: 'Sheltered inlet — historically prone to accumulation in calm periods', tag: 'calm-surface' },
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
        { icon: '✅', text: 'Count well below watch threshold',          tag: null },
        { icon: '💨', text: 'Good wind mixing — low accumulation risk',  tag: 'wind-dispersal' },
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
        { icon: '✅', text: 'Count within safe range',                                    tag: null },
        { icon: '🌿', text: 'Dense reed bed on north shore provides natural filtration',  tag: null },
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
        { icon: '⚠️', text: 'Count above advisory threshold — active bloom confirmed',   tag: 'high-count' },
        { icon: '🏊', text: 'High visitor volume site — public health risk elevated',    tag: 'high-footfall' },
        { icon: '🌡️', text: 'Sustained warm temperatures forecast for next 5 days',     tag: 'high-temp' },
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
        { icon: '✅', text: 'All indicators within normal range',                          tag: null },
        { icon: '🌲', text: 'Forested catchment — lower nutrient runoff than urban sites', tag: null },
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

  const ALGAE_SIGNAL_META = {
    'high-count':     { icon: '⚠️', shortLabel: 'Above threshold',   label: 'sites above advisory threshold',        severity: 3 },
    'toxin-species':  { icon: '🔬', shortLabel: 'Toxin species',     label: 'sites with toxin-producing species',    severity: 3 },
    'surface-scum':   { icon: '🌊', shortLabel: 'Surface scum',      label: 'sites with visible surface scum',       severity: 3 },
    'high-temp':      { icon: '🌡️', shortLabel: 'High temperature',  label: 'sites with elevated water temperature', severity: 2 },
    'watch-threshold':{ icon: '🦠', shortLabel: 'Watch level',       label: 'sites approaching advisory threshold',  severity: 2 },
    'upward-trend':   { icon: '📈', shortLabel: 'Rising count',      label: 'sites with rising cyanobacteria count', severity: 2 },
    'calm-surface':   { icon: '🌬️', shortLabel: 'Calm surface',      label: 'sites with low wind — accumulation risk', severity: 1 },
    'stale-data':     { icon: '🕐', shortLabel: 'Stale data',        label: 'sites with overdue sampling data',      severity: 1 },
    'high-footfall':  { icon: '🏊', shortLabel: 'High footfall',     label: 'high-footfall sites — elevated risk',   severity: 2 },
    'wind-dispersal': { icon: '💨', shortLabel: 'Wind dispersal',    label: 'sites with wind-assisted dispersal',    severity: 0 },
  };

  function updateAlgaeRiskStrip() {
    const grid = document.getElementById('algae-risk-grid');
    if (!grid) return;

    const total = ALGAE_SITES.length;

    // Count sites per tag
    const counts = {};
    ALGAE_SITES.forEach(site => {
      site.factors.forEach(f => {
        if (f.tag) counts[f.tag] = (counts[f.tag] || 0) + 1;
      });
    });

    // Sort by severity desc, then count desc — take top 6
    const sorted = Object.entries(counts)
      .filter(([tag]) => ALGAE_SIGNAL_META[tag])
      .sort(([a, ca], [b, cb]) => {
        const sd = (ALGAE_SIGNAL_META[b].severity || 0) - (ALGAE_SIGNAL_META[a].severity || 0);
        return sd !== 0 ? sd : cb - ca;
      })
      .slice(0, 6);

    if (sorted.length === 0) {
      grid.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No active risk signals across the network.</div>';
      return;
    }

    grid.innerHTML = sorted.map(([tag, count]) => {
      const meta = ALGAE_SIGNAL_META[tag];
      const pct = Math.round((count / total) * 100);
      const color = pct >= 75 ? 'var(--red)' : pct >= 50 ? 'var(--amber)' : 'var(--green)';
      const glowColor = pct >= 75 ? '#F5CFCF' : pct >= 50 ? '#F5E6C8' : '#C8EBD8';
      const siteLabel = count === 1 ? 'site' : 'sites';

      return `<div class="pollen-card algae-signal-card">
        <div class="pollen-card-glow" style="background:${glowColor}"></div>
        <span class="pollen-icon">${meta.icon}</span>
        <div class="pollen-name">${meta.shortLabel}</div>
        <div class="algae-signal-bottom">
          <span class="pollen-count" style="color:${color}">${count}</span>
          <span class="algae-signal-site-label">${siteLabel}</span>
          <div class="pollen-bar-track">
            <div class="pollen-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function showAlgaeRiskStrip() {
    updateAlgaeRiskStrip();
    const s = document.getElementById('algae-risk-strip');
    if (s) s.style.display = 'block';
  }
  function hideAlgaeRiskStrip() {
    const s = document.getElementById('algae-risk-strip');
    if (s) s.style.display = 'none';
  }

  function activateAlgae(haz) {
    hidePollen();
    hideAirHero();
    hideHeatHero();
    hideHeatStrip();
    hideFireHero();
    hideFireStrip();
    hideRainHero();
    hideRainStrip();
    updateAlgaeHero();
    showAlgaeRiskStrip();
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

    // loadPollen() is async; if the officer switched tabs before it resolved,
    // don't pop the pollen strip back up over another hazard's surface.
    if (currentHazard === 'air') strip.style.display = 'block';
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
    hideAlgaeRiskStrip();
    hideHeatHero();
    hideHeatStrip();
    hideFireHero();
    hideFireStrip();
    hideRainHero();
    hideRainStrip();
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

  const ALGAE_STATUS_COLOR = { none: '#9CA3AF', watch: '#FAC775', advisory: '#EF9F27', closed: '#E24B4A' };
  const ALGAE_STATUS_LABEL = { none: 'Clear', watch: 'Watch', advisory: 'Advisory', closed: 'Closed' };

  // Marker size by severity (closed/advisory larger than watch/none).
  const ALGAE_PIN_SIZE = { none: 14, watch: 16, advisory: 20, closed: 22 };
  // Affected-area radius (metres) for advisory/closed sites only.
  const ALGAE_SPREAD_M = { advisory: 350, closed: 500 };

  // Discrete bathing-site markers. The sites are independent samples on
  // hydrologically separate lakes, so NOTHING is interpolated between them —
  // no bloom surface, no smear. The honest signal here is density, not a field.
  function drawAlgae() {
    ALGAE_SITES.forEach(site => {
      const color = ALGAE_STATUS_COLOR[site.status] || '#9CA3AF';
      const severe = site.status === 'advisory' || site.status === 'closed';

      // Affected-area indicator — a low-opacity, dashed (modelled) circle
      // anchored to THIS site alone. Small enough that it never reaches a
      // neighbouring lake; drawn under the marker so the pin stays on top.
      if (severe) {
        const r = ALGAE_SPREAD_M[site.status];
        L.circle(site.ll, {
          radius: r, color, weight: 1, opacity: 0.5, fillColor: color, fillOpacity: 0.12, dashArray: '4 4'
        })
          .bindTooltip(`${site.name} — modelled local spread · ~${r} m (sample)`, { sticky: true })
          .on('click', () => openAlgaeModal(site))
          .addTo(gHazard);
      }

      // Status-ringed marker: status fill, white ring, sized by severity. Stale
      // sites read low-confidence (dashed ring + faded); fresh sites read solid.
      // Advisory/closed sites carry a pulsing severity halo (CSS).
      const size = ALGAE_PIN_SIZE[site.status] || 14;
      const halo = severe ? `<span class="algae-pin-halo" style="background:${color}"></span>` : '';
      const html = `<span class="algae-pin${site.stale ? ' algae-pin-stale' : ''}" style="width:${size}px;height:${size}px">` +
        `${halo}<span class="algae-pin-dot" style="background:${color}"></span></span>`;
      const marker = L.marker(site.ll, { icon: L.divIcon({ className: 'algae-pin-icon', html, iconSize: [size, size] }) });
      marker.bindTooltip(
        `<strong>${site.name}</strong><br>${ALGAE_STATUS_LABEL[site.status]}` +
        (site.stale ? ` · data ${site.dataAge} (low confidence)` : ''),
        { sticky: true }
      );
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

    document.getElementById('heat-modal-close').addEventListener('click', closeHeatModal);
    document.getElementById('heat-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeHeatModal(); });
    document.getElementById('heat-modal-generate').addEventListener('click', heatGenerateDraft);
    document.getElementById('heat-modal-send').addEventListener('click', heatSendAdvisory);

    document.getElementById('fire-modal-close').addEventListener('click', closeFireModal);
    document.getElementById('fire-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeFireModal(); });
    document.getElementById('fire-modal-generate').addEventListener('click', fireGenerateDraft);
    document.getElementById('fire-modal-send').addEventListener('click', fireSendNotice);

    document.getElementById('rain-modal-close').addEventListener('click', closeRainModal);
    document.getElementById('rain-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRainModal(); });
    document.getElementById('rain-modal-generate').addEventListener('click', rainGenerateDraft);
    document.getElementById('rain-modal-send').addEventListener('click', rainSendAdvisory);
  });

  /* ---- Fire: modelled fire-risk zones + open-burning ban surface ----
   * Fire is the deliberately MODELLED layer — no direct measurement. The data
   * below is a demo forecast shaped like SMHI brandrisk / FWI output and is
   * labelled placeholder / (sample) / modelled throughout. The ban decision
   * acting on an openly-modelled layer is the intended honest contrast; no
   * value here is dressed up as measured. */
  function fireBox(cy, cx, d) {
    return [[cy - d, cx - d], [cy - d, cx + d], [cy + d, cx + d], [cy + d, cx - d]];
  }
  const FIRE_BAND_COLOR = { Low: '#1D9E75', Moderate: '#FAC775', High: '#EF9F27', Extreme: '#E24B4A' };
  const FIRE_BAND_ORDER = ['Low', 'Moderate', 'High', 'Extreme'];
  function fireBand(index) {
    if (index >= 5) return 'Extreme';
    if (index >= 4) return 'High';
    if (index >= 3) return 'Moderate';
    return 'Low';
  }
  function fireColor(index) { return FIRE_BAND_COLOR[fireBand(index)] || FIRE_BAND_COLOR.Low; }

  const FIRE_STATUS_LABEL = { none: 'No ban', ban: 'Ban declared' };
  const FIRE_STATUS_BTN   = { none: 'Lift ban', ban: 'Declare ban' };

  const FIRE_ZONES = [
    {
      id: 'nw', short: 'NW zone', name: 'NW zone — Järvafältet', latlngs: fireBox(59.36, 18.02, 0.03),
      index: 2, status: 'none', trend: 'Stable — light rain forecast midweek',
      drivers: [
        { key: 'dry-days',        icon: '☀️', label: 'Consecutive dry days',      value: '3 days', severity: 1 },
        { key: 'wind',            icon: '💨', label: 'Wind speed',                 value: '5 m/s',  severity: 1 },
        { key: 'fuel-dryness',    icon: '🌿', label: 'Fuel / vegetation dryness',  value: 'Moist',  severity: 0 },
        { key: 'days-since-rain', icon: '🌧️', label: 'Days since measurable rain', value: '2 days', severity: 0 },
      ],
      recommendation: 'No action needed. The grassland here is still moist and winds are light; modelled risk is Low. Continue routine monitoring of the brandrisk forecast.',
      audit: [
        { time: '1 day ago',  text: 'Modelled brandrisk reviewed — Low. No restriction. Officer: A. Lindqvist' },
        { time: '6 days ago', text: 'Routine review — Low' },
      ],
    },
    {
      id: 'ne', short: 'NE zone', name: 'NE zone — Norra Djurgården', latlngs: fireBox(59.36, 18.12, 0.03),
      index: 3, status: 'none', trend: 'Rising — no rain in the 5-day forecast',
      drivers: [
        { key: 'dry-days',        icon: '☀️', label: 'Consecutive dry days',      value: '6 days', severity: 2 },
        { key: 'wind',            icon: '💨', label: 'Wind speed',                 value: '8 m/s',  severity: 1 },
        { key: 'fuel-dryness',    icon: '🌿', label: 'Fuel / vegetation dryness',  value: 'Dry',    severity: 2 },
        { key: 'days-since-rain', icon: '🌧️', label: 'Days since measurable rain', value: '6 days', severity: 2 },
      ],
      recommendation: 'No ban yet, but conditions are drying. Modelled risk is Moderate and trending up with no rain forecast. Prepare a precautionary burning advisory and re-check the brandrisk model daily.',
      audit: [
        { time: '4h ago',     text: 'Modelled brandrisk reviewed — Moderate, rising. Officer: M. Eriksson' },
        { time: '3 days ago', text: 'Routine review — Low → Moderate' },
      ],
    },
    {
      id: 'sw', short: 'SW zone', name: 'SW zone — Älvsjöskogen', latlngs: fireBox(59.29, 18.02, 0.03),
      index: 4, status: 'none', trend: 'Holding — dry, breezy week ahead',
      drivers: [
        { key: 'dry-days',        icon: '☀️', label: 'Consecutive dry days',      value: '9 days',   severity: 3 },
        { key: 'wind',            icon: '💨', label: 'Wind speed',                 value: '12 m/s',   severity: 2 },
        { key: 'fuel-dryness',    icon: '🌿', label: 'Fuel / vegetation dryness',  value: 'Very dry', severity: 3 },
        { key: 'days-since-rain', icon: '🌧️', label: 'Days since measurable rain', value: '9 days',   severity: 2 },
      ],
      recommendation: 'Open-burning ban advised. Modelled risk is High: nine dry days, very dry forest fuel and fresh winds. Declare a ban for this zone and post signage at trailheads. Re-evaluate when measurable rain is forecast.',
      audit: [
        { time: '2h ago',     text: 'Modelled brandrisk reviewed — High. Ban advised. Officer: M. Eriksson' },
        { time: '2 days ago', text: 'Routine review — Moderate → High' },
      ],
    },
    {
      id: 'se', short: 'SE zone', name: 'SE zone — Nackareservatet', latlngs: fireBox(59.29, 18.12, 0.03),
      index: 5, status: 'none', trend: 'Climbing — record dry spell, strong winds',
      drivers: [
        { key: 'dry-days',        icon: '☀️', label: 'Consecutive dry days',      value: '12 days',    severity: 3 },
        { key: 'wind',            icon: '💨', label: 'Wind speed',                 value: '18 m/s',     severity: 3 },
        { key: 'fuel-dryness',    icon: '🌿', label: 'Fuel / vegetation dryness',  value: 'Tinder-dry', severity: 3 },
        { key: 'days-since-rain', icon: '🌧️', label: 'Days since measurable rain', value: '14 days',    severity: 3 },
      ],
      recommendation: 'Declare an open-burning ban immediately. Modelled risk is Extreme: a record dry spell, tinder-dry fuel and strong winds make any ignition dangerous. Declare the ban, notify the public and brief the rescue service.',
      audit: [
        { time: '1h ago',    text: 'Modelled brandrisk reviewed — Extreme. Immediate ban advised. Officer: A. Lindqvist' },
        { time: '1 day ago', text: 'Routine review — High → Extreme' },
      ],
    },
  ];

  // Coarse, feathered fire-risk surface — reads like a modelled index map, not
  // a survey. One feathered blob per zone, in its fire-legend band colour, so
  // zones read cleanly instead of bleeding through a shared rainbow ramp.
  // Per-band single-hue gradient: transparent at the edge → opaque band colour
  // at the hot core.
  const FIRE_ZONE_GRADIENTS = {
    Low:      { 0.0: 'rgba(29,158,117,0)',  0.4: 'rgba(29,158,117,0.45)',  1.0: 'rgba(29,158,117,0.85)' },  // #1D9E75
    Moderate: { 0.0: 'rgba(250,199,117,0)', 0.4: 'rgba(250,199,117,0.50)', 1.0: 'rgba(250,199,117,0.90)' }, // #FAC775
    High:     { 0.0: 'rgba(239,159,39,0)',  0.4: 'rgba(239,159,39,0.55)',  1.0: 'rgba(239,159,39,0.92)' },  // #EF9F27
    Extreme:  { 0.0: 'rgba(226,75,74,0)',   0.4: 'rgba(226,75,74,0.60)',   1.0: 'rgba(226,75,74,0.95)' }    // #E24B4A
  };
  // Centroid-biased cluster (degree offsets + weight): the centre gives the hot
  // core, the ring/corner points feather the edges over the zone extent so the
  // blob never forms a hard rectangle line.
  const FIRE_CLUSTER = [
    [0.000,  0.000, 1.00],
    [0.012,  0.000, 0.55], [-0.012, 0.000, 0.55],
    [0.000,  0.018, 0.55], [0.000, -0.018, 0.55],
    [0.009,  0.013, 0.40], [-0.009, 0.013, 0.40],
    [0.009, -0.013, 0.40], [-0.009, -0.013, 0.40]
  ];
  // Index → intensity across the band range (index 2–5 → ~0.25–1.0); scales how
  // saturated/hot a zone's blob is, so higher risk reads bolder.
  function fireIntensity(index) { return Math.max(0, Math.min(1, (index - 1) / 4)); }
  function fireCentroid(latlngs) {
    let la = 0, lo = 0;
    latlngs.forEach(p => { la += p[0]; lo += p[1]; });
    return [la / latlngs.length, lo / latlngs.length];
  }

  function drawFire() {
    // Feathered modelled risk surface (reuses the heat-layer pattern). Radius
    // and blur are kept coarse on purpose so it reads as a low-resolution
    // model, never per-block precision.
    if (typeof L.heatLayer === 'function') {
      FIRE_ZONES.forEach(z => {
        const grad = FIRE_ZONE_GRADIENTS[fireBand(z.index)] || FIRE_ZONE_GRADIENTS.Low;
        const scale = 0.55 + 0.45 * fireIntensity(z.index); // bolder core for higher index
        const [clat, clon] = fireCentroid(z.latlngs);
        // A future hexbin version could read sub-cell values per zone here; not
        // built now — this PR keeps a single feathered blob per zone.
        const pts = FIRE_CLUSTER.map(([dla, dlo, w]) => [clat + dla, clon + dlo, w * scale]);
        gHazard.addLayer(L.heatLayer(pts, { radius: 58, blur: 30, minOpacity: 0.05, max: 0.85, gradient: grad }));
      });
    } else {
      // Graceful fallback to soft discs where leaflet.heat is unavailable.
      FIRE_ZONES.forEach(z => {
        const [clat, clon] = fireCentroid(z.latlngs);
        const c = fireColor(z.index);
        L.circle([clat, clon], { radius: 2600, color: c, weight: 0, fillColor: c, fillOpacity: 0.3 }).addTo(gHazard);
      });
    }
    // leaflet.heat isn't clickable — keep a transparent hit-area polygon per
    // zone (reusing the zone geometry) on top so clicking still opens the modal.
    FIRE_ZONES.forEach(z => {
      L.polygon(z.latlngs, { stroke: false, fill: true, fillColor: '#000', fillOpacity: 0, interactive: true })
        .bindTooltip(`${z.name} — ${fireBand(z.index)} (sample)`, { sticky: true })
        .on('click', () => openFireModal(z))
        .addTo(gHazard);
    });
  }

  /* ---- Fire situation hero — mirrors the air/algae hero, bespoke to fire ---- */
  const FIRE_LEVEL_CLS = { Extreme: 'aq-level-vhigh', High: 'aq-level-high', Moderate: 'aq-level-mod', Low: 'aq-level-low' };

  function updateFireHero() {
    const hero = document.getElementById('fire-hero');
    if (!hero) return;
    const total = FIRE_ZONES.length;
    const zones = FIRE_ZONES.map(z => ({ short: z.short, band: fireBand(z.index) }));
    const extreme = zones.filter(z => z.band === 'Extreme');
    const high = zones.filter(z => z.band === 'High');
    const moderate = zones.filter(z => z.band === 'Moderate');
    const highPlus = extreme.length + high.length;
    const worst = zones.reduce((a, b) => (FIRE_BAND_ORDER.indexOf(b.band) > FIRE_BAND_ORDER.indexOf(a.band) ? b : a), zones[0]);
    const names = arr => arr.map(z => z.short).join(', ');

    const lvlEl = document.getElementById('fire-hero-level');
    const hdEl  = document.getElementById('fire-hero-headline');
    const bkEl  = document.getElementById('fire-hero-breakdown');
    const vdEl  = document.getElementById('fire-hero-verdict');

    if (lvlEl) { lvlEl.textContent = worst.band; lvlEl.className = 'aq-hero-level ' + (FIRE_LEVEL_CLS[worst.band] || 'aq-level-low'); }

    if (hdEl) {
      if (highPlus > 0)        hdEl.textContent = `${highPlus} of ${total} zones at High risk or above`;
      else if (moderate.length > 0) hdEl.textContent = `${moderate.length} of ${total} zones at Moderate risk`;
      else                     hdEl.textContent = `Fire risk is Low across all ${total} zones`;
    }

    if (bkEl) {
      const bands = [
        { label: 'Extreme',  color: '#E24B4A', n: extreme.length },
        { label: 'High',     color: '#EF9F27', n: high.length },
        { label: 'Moderate', color: '#FAC775', n: moderate.length },
      ];
      const parts = bands.filter(b => b.n > 0).map(b =>
        `<span class="aq-breakdown-item"><span class="aq-breakdown-dot" style="background:${b.color}"></span>${b.n} ${b.label}</span>`);
      parts.push(`<span class="aq-breakdown-item" style="color:var(--text-tertiary)">${total} zones · modelled (no measurement)</span>`);
      bkEl.innerHTML = parts.join('');
    }

    if (vdEl) {
      let verdict;
      if (extreme.length > 0)  verdict = `Declare an open-burning ban now — extreme fire risk in the ${names(extreme)}.`;
      else if (highPlus > 0)   verdict = `Open-burning ban advised, ${names(high)}.`;
      else if (moderate.length > 0) verdict = 'Monitor closely. Prepare a precautionary burning advisory.';
      else                     verdict = 'No fire action needed. Conditions are benign.';
      vdEl.textContent = verdict;
      vdEl.className = 'aq-hero-verdict';
    }

    hero.style.display = 'flex';
  }

  function showFireHero() { const h = document.getElementById('fire-hero'); if (h) h.style.display = 'flex'; }
  function hideFireHero() { const h = document.getElementById('fire-hero'); if (h) h.style.display = 'none'; }

  /* ---- Fire driver strip — mirrors the algae risk strip ----
   * Aggregates the modelled drivers across zones (consecutive dry days, wind,
   * fuel dryness): how many zones carry each driver at an elevated level. */
  const FIRE_DRIVER_META = {
    'dry-days':     { icon: '☀️', label: 'Consecutive dry days' },
    'wind':         { icon: '💨', label: 'High wind' },
    'fuel-dryness': { icon: '🌿', label: 'Fuel dryness' },
  };

  function updateFireStrip() {
    const grid = document.getElementById('fire-strip-grid');
    const sub  = document.getElementById('fire-strip-sub');
    if (!grid) return;
    const total = FIRE_ZONES.length;
    if (sub) sub.textContent = `Modelled brandrisk drivers across ${total} zones · sample (no direct measurement)`;

    grid.innerHTML = Object.keys(FIRE_DRIVER_META).map(key => {
      const meta = FIRE_DRIVER_META[key];
      const count = FIRE_ZONES.filter(z => {
        const d = z.drivers.find(x => x.key === key);
        return d && d.severity >= 2;
      }).length;
      const pct = Math.round((count / total) * 100);
      const color = pct >= 75 ? 'var(--red)' : pct >= 50 ? 'var(--amber)' : 'var(--green)';
      const glowColor = pct >= 75 ? '#F5CFCF' : pct >= 50 ? '#F5E6C8' : '#C8EBD8';
      const zoneLabel = count === 1 ? 'zone' : 'zones';
      return `<div class="pollen-card algae-signal-card">
        <div class="pollen-card-glow" style="background:${glowColor}"></div>
        <span class="pollen-icon">${meta.icon}</span>
        <div class="pollen-name">${meta.label}</div>
        <div class="algae-signal-bottom">
          <span class="pollen-count" style="color:${color}">${count}</span>
          <span class="algae-signal-site-label">of ${total} ${zoneLabel}</span>
          <div class="pollen-bar-track">
            <div class="pollen-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function showFireStrip() {
    updateFireStrip();
    const s = document.getElementById('fire-strip');
    if (s) s.style.display = 'block';
  }
  function hideFireStrip() {
    const s = document.getElementById('fire-strip');
    if (s) s.style.display = 'none';
  }

  /* ---- Fire zone modal — mirrors the algae modal ----
   * Drivers, an officer recommendation, audit trail, a Declare / Lift ban
   * state machine, and a public notice with draft + send logged to the audit. */
  let _fireModalZone = null;
  let _firePendingStatus = null;

  function fireSeverityClass(sev) {
    return sev >= 3 ? 'val-high' : sev >= 2 ? 'val-warn' : 'val-ok';
  }

  function renderFireAudit(z) {
    const el = document.getElementById('fire-modal-audit');
    if (!el) return;
    el.innerHTML = z.audit.map(e =>
      `<div class="algae-modal-audit-entry"><span class="algae-modal-audit-time">${escapeHtml(e.time)}</span><span>${escapeHtml(e.text)}</span></div>`
    ).join('');
  }

  function renderFireStatusButtons(active) {
    const row = document.getElementById('fire-modal-status-row');
    if (!row) return;
    row.innerHTML = ['none', 'ban'].map(s =>
      `<button class="algae-modal-status-btn ${active === s ? 'active-' + s : ''}" data-status="${s}">${FIRE_STATUS_BTN[s]}</button>`
    ).join('');
    row.querySelectorAll('.algae-modal-status-btn').forEach(btn => {
      btn.addEventListener('click', () => { _firePendingStatus = btn.dataset.status; renderFireStatusButtons(_firePendingStatus); });
    });
  }

  function openFireModal(z) {
    if (!z) return;
    _fireModalZone = z;
    _firePendingStatus = z.status;

    document.getElementById('fire-modal-eyebrow').textContent = 'Fire-risk zone · Stockholm';
    document.getElementById('fire-modal-title').textContent = z.name;

    const badge = document.getElementById('fire-modal-badge');
    badge.textContent = FIRE_STATUS_LABEL[z.status];
    badge.className = 'algae-modal-status-badge badge-' + z.status;

    document.getElementById('fire-modal-drivers').innerHTML = z.drivers.map(d =>
      `<div class="algae-modal-obs-item">
        <div class="algae-modal-obs-label">${escapeHtml(d.label)}</div>
        <div class="algae-modal-obs-value ${fireSeverityClass(d.severity)}">${escapeHtml(d.value)}</div>
      </div>`
    ).join('');

    document.getElementById('fire-modal-index').innerHTML =
      `Modelled fire-risk index <strong style="color:${fireColor(z.index)}">${z.index} of 5</strong> · ${fireBand(z.index)} · ${escapeHtml(z.trend)} · modelled — no direct measurement`;

    document.getElementById('fire-modal-rec').textContent = z.recommendation;
    renderFireAudit(z);
    renderFireStatusButtons(_firePendingStatus);

    document.getElementById('fire-modal-message').value = '';
    document.getElementById('fire-modal-sent').style.display = 'none';

    document.getElementById('fire-modal').style.display = 'flex';
  }

  function closeFireModal() {
    document.getElementById('fire-modal').style.display = 'none';
    _fireModalZone = null;
    _firePendingStatus = null;
  }

  function fireGenerateDraft() {
    if (!_fireModalZone) return;
    const z = _fireModalZone;
    const s = _firePendingStatus || z.status;
    const templates = {
      ban:  `Stockholm stad informerar: Eldningsförbud råder i ${z.name} på grund av mycket hög brandrisk. Det är förbjudet att grilla och göra upp eld i naturen tills vidare. Följ utvecklingen på stockholm.se.`,
      none: `Stockholm stad informerar: Förhöjd brandrisk i ${z.name}. Var mycket försiktig med all öppen eld, använd endast iordningställda grillplatser och släck noggrant. Inget eldningsförbud råder för närvarande.`,
    };
    document.getElementById('fire-modal-message').value = templates[s] || templates.none;
  }

  function fireSendNotice() {
    if (!_fireModalZone) return;
    const msg = document.getElementById('fire-modal-message').value.trim();
    if (!msg) { document.getElementById('fire-modal-message').focus(); return; }
    const z = _fireModalZone;

    if (_firePendingStatus && _firePendingStatus !== z.status) {
      const old = z.status;
      z.status = _firePendingStatus;
      z.audit.unshift({ time: 'just now', text: `Open-burning ban ${z.status === 'ban' ? 'declared' : 'lifted'}: ${FIRE_STATUS_LABEL[old]} → ${FIRE_STATUS_LABEL[z.status]}. Notice sent. Officer: You` });
      const badge = document.getElementById('fire-modal-badge');
      badge.textContent = FIRE_STATUS_LABEL[z.status];
      badge.className = 'algae-modal-status-badge badge-' + z.status;
    } else {
      z.audit.unshift({ time: 'just now', text: 'Public notice sent (ban status unchanged). Officer: You' });
    }

    renderFireAudit(z);
    document.getElementById('fire-modal-sent').style.display = 'block';
  }

  function activateFire(haz) {
    hidePollen();
    hideAirHero();
    hideAlgaeHero();
    hideAlgaeRiskStrip();
    hideHeatHero();
    hideHeatStrip();
    hideFireHero();
    hideFireStrip();
    hideRainHero();
    hideRainStrip();
    updateFireHero();
    showFireStrip();
    setLayerStatus([{ id: 'fire', label: haz.layers[0].label, state: 'offline', detail: 'modelled · no direct measurement' }]);
    setProvenance(haz.provenance, haz.confidence, true);
    if (haz.draw) haz.draw();
  }

  /* ---- Heat: apparent-temperature surface + vulnerable sites ----
   * Real SMHI forecast (metfcst snow1g v1), fetched per district on tab
   * activation (see /api/heat-forecast). This is NWP forecast data — high
   * confidence, but never an in-situ measurement, so it is labelled "forecast",
   * not "measured". heatTempAt() reads the fetched känns-som series by leadHour. */
  const HEAT_DISTRICTS = [
    { name: 'Norrmalm',    lat: 59.337, lon: 18.058 },
    { name: 'Södermalm',   lat: 59.314, lon: 18.072 },
    { name: 'Östermalm',   lat: 59.337, lon: 18.085 },
    { name: 'Vasastan',    lat: 59.346, lon: 18.045 },
    { name: 'Kungsholmen', lat: 59.330, lon: 18.030 },
    { name: 'Skärholmen',  lat: 59.277, lon: 17.907 },
    { name: 'Älvsjö',      lat: 59.278, lon: 18.010 }
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
  // Forecast state: { ok, approvedTime, byName: { [name]: { [leadHour]: hour } } }.
  // null while loading; { ok:false } on failure — we never fall back to synthetic.
  let heatForecast = null;
  function heatSeries(name) {
    return (heatForecast && heatForecast.ok && heatForecast.byName[name]) || null;
  }
  // Real forecast valid time (HH:00, viewer-local) for a lead, from the shared
  // timegrid — so the hero/modal show the model's hours, not a synthetic clock.
  function heatValidTime(lead) {
    if (!heatForecast || !heatForecast.ok) return null;
    const first = Object.values(heatForecast.byName)[0];
    const h = first && first[lead];
    if (!h) return null;
    return String(new Date(h.validTime).getHours()).padStart(2, '0') + ':00';
  }

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
  // Apparent temperature (känns som) for a district at a forecast lead hour,
  // read from the fetched SMHI series. null when the forecast is missing for
  // that district/lead (loading or unavailable) — callers must handle null.
  function heatTempAt(d, lead) {
    const s = heatSeries(d.name);
    if (!s) return null;
    const h = s[lead];
    return h ? h.apparentC : null;
  }
  // Central water and large-park centroids (Riddarfjärden, Djurgården, the
  // bigger lakes). Injected as low-intensity points so the thermal surface
  // dips over water and green space and concentrates over built-up districts.
  const WATER_PARK_COOL = [
    [59.322, 18.045], // Riddarfjärden
    [59.327, 18.115], // Djurgården (park island)
    [59.366, 18.045], // Brunnsviken
    [59.358, 18.038], // Hagaparken
    [59.303, 18.082], // Årstaviken / Hammarby sjö
    [59.330, 18.108], // Lilla Värtan (east water)
    [59.330, 17.978], // Mälaren (west)
    [59.265, 18.040]  // Magelungen (south lake)
  ];
  // känns-som gradient: cool blue → caution → warning → extreme. Low end fades
  // to transparent so water and parks read as gaps in the warm field.
  const HEAT_GRADIENT = {
    0.00: 'rgba(44,127,184,0.00)',
    0.18: 'rgba(44,127,184,0.55)',
    0.45: 'rgba(250,199,117,0.75)',
    0.70: 'rgba(239,159,39,0.85)',
    1.00: 'rgba(226,75,74,0.92)'
  };
  // Normalise apparent temperature across the känns-som range (~24–33 °C).
  function heatIntensity(t) { return Math.max(0, Math.min(1, (t - 24) / (33 - 24))); }

  // Point cloud for the surface at a given lead: a core per district, one or
  // two satellites nudged toward the built-up city core (so each district has
  // a shifted hot centre and texture, not a perfect disc), plus the cool
  // water/park anchors.
  function heatPoints(lead) {
    const pts = [];
    HEAT_DISTRICTS.forEach(d => {
      const t = heatTempAt(d, lead);
      if (t == null) return; // no forecast for this district — leave it out
      const inten = heatIntensity(t);
      pts.push([d.lat, d.lon, inten]);
      const dy = STOCKHOLM[0] - d.lat, dx = STOCKHOLM[1] - d.lon;
      const len = Math.hypot(dy, dx) || 1;
      pts.push([d.lat + (dy / len) * 0.006, d.lon + (dx / len) * 0.006, inten * 0.95]);
      pts.push([d.lat - (dx / len) * 0.004, d.lon + (dy / len) * 0.004, inten * 0.82]);
    });
    if (pts.length) WATER_PARK_COOL.forEach(w => pts.push([w[0], w[1], 0.12]));
    return pts;
  }

  function drawHeatZones(lead) {
    // Continuous apparent-temperature surface (reuses the Air CAMS heat
    // pattern). Districts are sparse, so a wide radius + heavy blur keep the
    // field continuous rather than dotty. SMHI forecast (snow1g v1).
    if (typeof L.heatLayer === 'function') {
      gHazard.addLayer(L.heatLayer(heatPoints(lead), {
        radius: 60, blur: 45, minOpacity: 0.20, max: 1.0, gradient: HEAT_GRADIENT
      }));
    } else {
      // Graceful fallback to flat discs where leaflet.heat is unavailable.
      HEAT_DISTRICTS.forEach(d => {
        const t = heatTempAt(d, lead);
        if (t == null) return;
        const c = heatColor(t);
        L.circle([d.lat, d.lon], { radius: 1000, color: c, weight: 1, opacity: 0.5, fillColor: c, fillOpacity: 0.38 }).addTo(gHazard);
      });
    }
    // Invisible hit targets keep the känns-som tooltip and open-modal
    // behaviour now that the visible disc is gone.
    HEAT_DISTRICTS.forEach(d => {
      const t = heatTempAt(d, lead);
      if (t == null) return;
      L.circleMarker([d.lat, d.lon], { radius: 18, stroke: false, fillColor: '#000', fillOpacity: 0 })
        .bindTooltip(`${d.name} — känns som ${t}°C · ${heatBand(t)} (SMHI forecast)`, { sticky: true })
        .on('click', () => openHeatModal(d))
        .addTo(gHazard);
    });
  }
  function drawHeatVulnerable(lead) {
    HEAT_VULNERABLE.forEach(v => {
      const isCare = v.type === 'care';
      const d = heatNearestDistrict(v.ll);
      const t = heatTempAt(d, lead);
      if (t == null) return; // no forecast — don't draw a misleading pin
      const color = heatColor(t);
      const warnPlus = t >= 30; // Warning or Extreme
      const ring = warnPlus ? `<i class="vuln-ring" style="border-color:${color}"></i>` : '';
      const html = `<span class="vuln-glyph" style="color:${color}">${ring}${isCare ? '♥' : '◆'}</span>`;
      L.marker(v.ll, { icon: L.divIcon({ className: 'vuln-pin' + (isCare ? '' : ' vp-pre'), html, iconSize: [18, 18] }) })
        .bindTooltip(`${v.name} — ${isCare ? 'care home' : 'preschool'} · ${heatBand(t)} (SMHI forecast)`, { sticky: true })
        .on('click', () => openHeatModal(d))
        .addTo(gVulnerable);
    });
  }

  // Nearest district to a lat/lon (used to bin vulnerable sites and to open a
  // pin's surrounding district). Plain squared-distance — districts are close.
  function heatNearestDistrict(ll) {
    let best = HEAT_DISTRICTS[0], bd = Infinity;
    HEAT_DISTRICTS.forEach(d => {
      const dist = (d.lat - ll[0]) ** 2 + (d.lon - ll[1]) ** 2;
      if (dist < bd) { bd = dist; best = d; }
    });
    return best;
  }
  function heatVulnerableIn(d) {
    return HEAT_VULNERABLE.filter(v => heatNearestDistrict(v.ll).name === d.name);
  }
  function drawHeat() {
    drawHeatZones(currentLeadHour());
    drawHeatVulnerable(currentLeadHour());
  }

  /* ---- Heat situation hero — mirrors the air/algae hero, bespoke to heat ----
   * Recomputed at the current lead hour (so it tracks the slider): district
   * band counts, the spatial peak känns-som value and the valid time it falls
   * on, and an officer verdict. SMHI forecast (snow1g v1) — real NWP data, but
   * forecast, never a measurement. */
  const HEAT_LEVEL_CLS = { Extreme: 'aq-level-vhigh', Warning: 'aq-level-high', Caution: 'aq-level-mod', Comfortable: 'aq-level-low' };

  function updateHeatHero() {
    const hero = document.getElementById('heat-hero');
    if (!hero) return;
    const lvlEl = document.getElementById('heat-hero-level');
    const hdEl  = document.getElementById('heat-hero-headline');
    const bkEl  = document.getElementById('heat-hero-breakdown');
    const vdEl  = document.getElementById('heat-hero-verdict');

    // No forecast yet (loading) or unavailable — never imply a reading.
    if (!heatForecast || !heatForecast.ok) {
      const failed = heatForecast && heatForecast.ok === false;
      if (lvlEl) { lvlEl.textContent = '—'; lvlEl.className = 'aq-hero-level aq-level-low'; }
      if (hdEl) hdEl.textContent = failed ? 'Forecast unavailable' : 'Loading SMHI forecast…';
      if (bkEl) bkEl.innerHTML = '';
      if (vdEl) { vdEl.textContent = failed ? 'SMHI metfcst snow1g v1 did not respond.' : ''; vdEl.className = 'aq-hero-verdict'; }
      return;
    }

    const lead = currentLeadHour();
    const total = HEAT_DISTRICTS.length;
    const temps = HEAT_DISTRICTS.map(d => ({ name: d.name, t: heatTempAt(d, lead) }));
    const extreme = temps.filter(x => x.t >= 33);
    const warning = temps.filter(x => x.t >= 30 && x.t < 33);
    const caution = temps.filter(x => x.t >= 27 && x.t < 30);
    const warningPlus = extreme.length + warning.length;
    const peak = temps.reduce((a, b) => (b.t > a.t ? b : a), temps[0]);
    const band = heatBand(peak.t);
    const peakTime = heatValidTime(lead) || fmtHour((14 + lead) % 24);

    if (lvlEl) { lvlEl.textContent = band; lvlEl.className = 'aq-hero-level ' + (HEAT_LEVEL_CLS[band] || 'aq-level-low'); }

    if (hdEl) {
      if (warningPlus > 0) {
        hdEl.textContent = `${warningPlus} of ${total} districts at Warning or above`;
      } else if (caution.length > 0) {
        hdEl.textContent = `${caution.length} of ${total} districts in Caution`;
      } else {
        hdEl.textContent = 'Apparent temperature is comfortable across Stockholm';
      }
    }

    if (bkEl) {
      const bands = [
        { label: 'Extreme', color: '#E24B4A', n: extreme.length },
        { label: 'Warning', color: '#EF9F27', n: warning.length },
        { label: 'Caution', color: '#FAC775', n: caution.length },
      ];
      const parts = bands.filter(b => b.n > 0).map(b =>
        `<span class="aq-breakdown-item"><span class="aq-breakdown-dot" style="background:${b.color}"></span>${b.n} ${b.label}</span>`);
      parts.push(`<span class="aq-breakdown-item" style="color:var(--text-tertiary)">Peak känns som ${peak.t}°C at ${peakTime} (${escapeHtml(peak.name)}) · SMHI forecast</span>`);
      bkEl.innerHTML = parts.join('');
    }

    if (vdEl) {
      let verdict;
      if (extreme.length > 0) verdict = 'Activate heat plan now — extreme apparent temperature in affected districts.';
      else if (warningPlus > 0) verdict = 'Activate heat plan for care homes ahead of the peak.';
      else if (caution.length > 0) verdict = 'Monitor closely. Prepare relief for vulnerable sites.';
      else verdict = 'No heat action needed at this hour.';
      vdEl.textContent = verdict;
      vdEl.className = 'aq-hero-verdict';
    }

    hero.style.display = 'flex';
  }

  function showHeatHero() { const h = document.getElementById('heat-hero'); if (h) h.style.display = 'flex'; }
  function hideHeatHero() { const h = document.getElementById('heat-hero'); if (h) h.style.display = 'none'; }

  /* ---- Heat vulnerable-site strip — mirrors the algae risk strip ----
   * Rolls up the vulnerable sites that sit inside Warning+ districts at the
   * current lead hour, split care homes vs preschools, with severity colour. */
  function updateHeatStrip() {
    const grid = document.getElementById('heat-strip-grid');
    const sub  = document.getElementById('heat-strip-sub');
    if (!grid) return;
    const lead = currentLeadHour();

    if (!heatForecast || !heatForecast.ok) {
      if (sub) sub.textContent = heatForecast && heatForecast.ok === false
        ? 'Forecast unavailable · SMHI metfcst snow1g v1'
        : 'Loading SMHI forecast…';
      grid.innerHTML = '';
      return;
    }

    const warnDistricts = HEAT_DISTRICTS.filter(d => heatTempAt(d, lead) >= 30);
    const inWarn = HEAT_VULNERABLE.filter(v => heatTempAt(heatNearestDistrict(v.ll), lead) >= 30);

    if (sub) sub.textContent = `${warnDistricts.length} of ${HEAT_DISTRICTS.length} districts at Warning or above · SMHI forecast ${heatValidTime(lead) || ''}`.trim();

    const cats = [
      { type: 'care', icon: '♥', label: 'Care homes' },
      { type: 'pre',  icon: '◆', label: 'Preschools' },
    ];
    grid.innerHTML = cats.map(cat => {
      const total = HEAT_VULNERABLE.filter(v => v.type === cat.type).length;
      const count = inWarn.filter(v => v.type === cat.type).length;
      const pct = total ? Math.round((count / total) * 100) : 0;
      const color = pct >= 75 ? 'var(--red)' : pct > 0 ? 'var(--amber)' : 'var(--green)';
      const glowColor = pct >= 75 ? '#F5CFCF' : pct > 0 ? '#F5E6C8' : '#C8EBD8';
      const siteLabel = count === 1 ? 'site' : 'sites';
      return `<div class="pollen-card algae-signal-card">
        <div class="pollen-card-glow" style="background:${glowColor}"></div>
        <span class="pollen-icon">${cat.icon}</span>
        <div class="pollen-name">${cat.label} in heat-risk districts</div>
        <div class="algae-signal-bottom">
          <span class="pollen-count" style="color:${color}">${count}</span>
          <span class="algae-signal-site-label">of ${total} ${siteLabel}</span>
          <div class="pollen-bar-track">
            <div class="pollen-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function showHeatStrip() {
    updateHeatStrip();
    const s = document.getElementById('heat-strip');
    if (s) s.style.display = 'block';
  }
  function hideHeatStrip() {
    const s = document.getElementById('heat-strip');
    if (s) s.style.display = 'none';
  }

  /* ---- Heat district modal — mirrors the algae modal ----
   * Apparent-temp curve across the day (diurnal model), the vulnerable sites
   * inside the district, an officer recommendation, audit trail, an Activate /
   * Stand down state machine, and a public message with draft + send logged. */
  const HEAT_STATUS_LABEL = { standby: 'Standby', activated: 'Activated' };
  const _heatState = {};
  let _heatModalDistrict = null;
  let _heatPendingStatus = null;

  function heatStateFor(d) {
    if (!_heatState[d.name]) {
      _heatState[d.name] = {
        status: 'standby',
        audit: [{ time: 'start of shift', text: 'Monitoring forecast apparent temperature. No heat plan active.' }],
      };
    }
    return _heatState[d.name];
  }

  function heatRecommendation(d, lead) {
    const t = heatTempAt(d, lead);
    if (t == null) return `Forecast unavailable for ${d.name} at this hour.`;
    const band = heatBand(t);
    const vuln = heatVulnerableIn(d);
    const care = vuln.filter(v => v.type === 'care').length;
    const pre = vuln.filter(v => v.type === 'pre').length;
    if (band === 'Extreme') return `Apparent temperature reaches känns som ${t}°C — extreme. Activate the heat plan now: prioritise the ${care} care home${care !== 1 ? 's' : ''} here, schedule welfare checks and extra fluids, and move preschool activity indoors through the afternoon peak.`;
    if (band === 'Warning') return `Apparent temperature reaches känns som ${t}°C — warning level. Activate the heat plan for the ${care} care home${care !== 1 ? 's' : ''} in ${d.name} ahead of the peak, and brief the ${pre} preschool${pre !== 1 ? 's' : ''} on shade and hydration.`;
    if (band === 'Caution') return `Apparent temperature is känns som ${t}°C — caution. No activation needed yet; keep the ${vuln.length} vulnerable site${vuln.length !== 1 ? 's' : ''} in ${d.name} on watch and re-check as the forecast firms up.`;
    return `Apparent temperature is känns som ${t}°C — comfortable. No heat action needed for ${d.name} at this hour.`;
  }

  function renderHeatCurve(d, lead) {
    const host = document.getElementById('heat-modal-curve');
    if (!host) return;
    const m = heatSeries(d.name);
    if (!m) { host.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">Forecast unavailable</div>'; return; }
    const entries = Object.values(m).sort((a, b) => a.leadHour - b.leadHour);
    const lo = 10, hi = 35; // apparent-temp scale for bar heights
    host.innerHTML = entries.map(h => {
      const t = h.apparentC;
      const pct = Math.max(6, Math.min(100, Math.round(((t - lo) / (hi - lo)) * 100)));
      const now = h.leadHour === lead ? ' now' : '';
      const hh = String(new Date(h.validTime).getHours()).padStart(2, '0');
      return `<div class="heat-curve-col${now}" title="${hh}:00 · känns som ${t}°C · ${heatBand(t)}">
        <div class="heat-curve-bar" style="height:${pct}%;background:${heatColor(t)}"></div>
        <div class="heat-curve-hr">${hh}</div>
      </div>`;
    }).join('');
  }

  function renderHeatAudit(d) {
    const el = document.getElementById('heat-modal-audit');
    if (!el) return;
    el.innerHTML = heatStateFor(d).audit.map(e =>
      `<div class="algae-modal-audit-entry"><span class="algae-modal-audit-time">${escapeHtml(e.time)}</span><span>${escapeHtml(e.text)}</span></div>`
    ).join('');
  }

  function renderHeatStatusButtons(active) {
    const row = document.getElementById('heat-modal-status-row');
    if (!row) return;
    row.innerHTML = ['standby', 'activated'].map(s =>
      `<button class="algae-modal-status-btn ${active === s ? 'active-' + s : ''}" data-status="${s}">${HEAT_STATUS_LABEL[s]}</button>`
    ).join('');
    row.querySelectorAll('.algae-modal-status-btn').forEach(btn => {
      btn.addEventListener('click', () => { _heatPendingStatus = btn.dataset.status; renderHeatStatusButtons(_heatPendingStatus); });
    });
  }

  function openHeatModal(d) {
    if (!d) return;
    _heatModalDistrict = d;
    const lead = currentLeadHour();
    const st = heatStateFor(d);
    _heatPendingStatus = st.status;

    document.getElementById('heat-modal-eyebrow').textContent = 'District · Stockholm';
    document.getElementById('heat-modal-title').textContent = d.name;

    const badge = document.getElementById('heat-modal-badge');
    badge.textContent = HEAT_STATUS_LABEL[st.status];
    badge.className = 'algae-modal-status-badge badge-' + st.status;

    renderHeatCurve(d, lead);

    const t = heatTempAt(d, lead);
    const validTime = heatValidTime(lead) || fmtHour((14 + lead) % 24);
    document.getElementById('heat-modal-now').innerHTML = t == null
      ? 'Forecast unavailable for this district.'
      : `${validTime}: känns som <strong style="color:${heatColor(t)}">${t}°C</strong> · ${heatBand(t)} · SMHI forecast (snow1g v1)`;

    const vuln = heatVulnerableIn(d);
    document.getElementById('heat-modal-vuln').innerHTML = vuln.length
      ? vuln.map(v => {
          const isCare = v.type === 'care';
          return `<div class="heat-vuln-item">
            <span class="heat-vuln-icon ${isCare ? '' : 'pre'}">${isCare ? '♥' : '◆'}</span>
            <span class="heat-vuln-name">${escapeHtml(v.name)}</span>
            <span class="heat-vuln-type">${isCare ? 'care home' : 'preschool'}</span>
          </div>`;
        }).join('')
      : '<div class="heat-vuln-empty">No registered vulnerable sites in this district.</div>';

    document.getElementById('heat-modal-rec').textContent = heatRecommendation(d, lead);
    renderHeatAudit(d);
    renderHeatStatusButtons(_heatPendingStatus);

    document.getElementById('heat-modal-message').value = '';
    document.getElementById('heat-modal-sent').style.display = 'none';

    document.getElementById('heat-modal').style.display = 'flex';
  }

  function closeHeatModal() {
    document.getElementById('heat-modal').style.display = 'none';
    _heatModalDistrict = null;
    _heatPendingStatus = null;
  }

  function heatGenerateDraft() {
    if (!_heatModalDistrict) return;
    const d = _heatModalDistrict;
    const t = heatTempAt(d, currentLeadHour());
    const s = _heatPendingStatus || heatStateFor(d).status;
    const templates = {
      activated: `Stockholm stad informerar: Värmeplanen är aktiverad för ${d.name}. Temperaturen väntas kännas som ${t}°C. Vi prioriterar äldreboenden och förskolor — drick vatten, sök skugga och se till om grannar och anhöriga.`,
      standby:   `Stockholm stad informerar: Höga temperaturer väntas i ${d.name}, känns som upp till ${t}°C. Drick vatten regelbundet, sök skugga under eftermiddagen och håll koll på sårbara grannar.`,
    };
    document.getElementById('heat-modal-message').value = templates[s] || templates.standby;
  }

  function heatSendAdvisory() {
    if (!_heatModalDistrict) return;
    const msg = document.getElementById('heat-modal-message').value.trim();
    if (!msg) { document.getElementById('heat-modal-message').focus(); return; }
    const d = _heatModalDistrict;
    const st = heatStateFor(d);

    if (_heatPendingStatus && _heatPendingStatus !== st.status) {
      const old = st.status;
      st.status = _heatPendingStatus;
      st.audit.unshift({ time: 'just now', text: `Heat plan ${old === 'standby' ? 'activated' : 'stood down'}: ${HEAT_STATUS_LABEL[old]} → ${HEAT_STATUS_LABEL[st.status]}. Advisory sent. Officer: You` });
      const badge = document.getElementById('heat-modal-badge');
      badge.textContent = HEAT_STATUS_LABEL[st.status];
      badge.className = 'algae-modal-status-badge badge-' + st.status;
    } else {
      st.audit.unshift({ time: 'just now', text: 'Advisory message sent (status unchanged). Officer: You' });
    }

    renderHeatAudit(d);
    document.getElementById('heat-modal-sent').style.display = 'block';
  }

  // Format an ISO model time as "HH:MM UTC YYYY-MM-DD" for status/provenance.
  function heatBaseLabel(iso) {
    if (!iso) return 'unknown';
    return `${iso.slice(11, 16)} UTC ${iso.slice(0, 10)}`;
  }

  async function loadHeatForecast(haz) {
    setStatus('heat', 'pending', 'loading SMHI forecast…');
    try {
      const res = await fetch('/api/heat-forecast', { cache: 'no-store' });
      const data = await res.json();
      if (currentHazard !== 'heat') return; // officer switched tabs mid-flight
      if (!data.ok) throw new Error(data.reason || 'unavailable');

      const byName = {};
      data.districts.forEach(dist => {
        const m = {};
        dist.hours.forEach(h => { m[h.leadHour] = h; });
        byName[dist.name] = m;
      });
      heatForecast = { ok: true, approvedTime: data.approvedTime, byName };

      const horizon = Math.max(0, ...Object.values(byName).flatMap(m => Object.keys(m).map(Number)));
      const base = heatBaseLabel(data.approvedTime);
      setStatus('heat', 'ok', `SMHI forecast +${horizon}h · base ${base}`);
      setProvenance(`Forecast: SMHI metfcst snow1g v1 (NWP, not measured). Model run ${base}.`, 'high', false);

      gHazard.clearLayers();
      gVulnerable.clearLayers();
      updateHeatHero();
      updateHeatStrip();
      if (haz.draw) haz.draw();
    } catch (err) {
      if (currentHazard !== 'heat') return;
      heatForecast = { ok: false };
      gHazard.clearLayers();
      gVulnerable.clearLayers();
      setStatus('heat', 'offline', 'forecast unavailable (' + err.message + ')');
      setProvenance('Forecast unavailable — SMHI metfcst snow1g v1 did not respond.', 'high', false);
      updateHeatHero();
      updateHeatStrip();
    }
  }

  function activateHeat(haz) {
    hidePollen();
    hideAirHero();
    hideAlgaeHero();
    hideAlgaeRiskStrip();
    hideFireHero();
    hideFireStrip();
    hideRainHero();
    hideRainStrip();
    heatForecast = null; // reset to loading state
    showHeatHero();
    showHeatStrip();
    updateHeatHero();  // shows "Loading SMHI forecast…"
    updateHeatStrip();
    setLayerStatus([{ id: 'heat', label: haz.layers[0].label, state: 'pending', detail: 'loading SMHI forecast…' }]);
    setProvenance(haz.provenance, haz.confidence, false);
    loadHeatForecast(haz);
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

  // Forecast is re-seeded by the lead hour so the time slider moves it (offset
  // the seed by lead, the way Heat re-seeds). lead 0 reproduces the base draw.
  function generateRainData(lead) {
    const o = (lead || 0) * 10;
    return RAIN_DISTRICTS.map(d => ({
      ...d,
      rainfall:         Math.round(20  + seededRand(dSeed(d.id, o + 0)) * 55),
      dewPoint:         Math.round((7  + seededRand(dSeed(d.id, o + 1)) * 7) * 10) / 10,
      humidity:         Math.round(55  + seededRand(dSeed(d.id, o + 2)) * 27),
      totalRainfall_mm: Math.round(     seededRand(dSeed(d.id, o + 3)) * 90),
      startHour:        Math.floor(     seededRand(dSeed(d.id, o + 4)) * 21),
      durationHours:    Math.round(1  + seededRand(dSeed(d.id, o + 5)) * 7),
    }));
  }

  // Radar-style precipitation front (light → deep blue). Low end fades to
  // transparent so dry ground reads as a gap, not a faint wash.
  const RAIN_GRADIENT = {
    0.00: 'rgba(191,219,254,0.00)',
    0.25: 'rgba(191,219,254,0.65)', // #bfdbfe light
    0.50: 'rgba(96,165,250,0.78)',  // #60a5fa
    0.75: 'rgba(37,99,235,0.86)',   // #2563eb
    1.00: 'rgba(30,58,138,0.92)'    // #1e3a8a deep
  };

  // Active fraction (0..1) for a district at a clock hour: zero outside its
  // [startHour, startHour+durationHours) window, a sine bump inside it so rain
  // ramps up at onset, peaks mid-window and passes at the tail. The window can
  // run past midnight (the slider clock wraps 14:00 → 02:00).
  function rainActiveFrac(d, clock) {
    const end = d.startHour + d.durationHours;
    let pos = null;
    if (clock >= d.startHour && clock < end) pos = clock - d.startHour;
    else if (clock + 24 >= d.startHour && clock + 24 < end) pos = clock + 24 - d.startHour;
    if (pos === null || d.durationHours <= 0) return 0;
    return Math.sin(Math.PI * (pos / d.durationHours));
  }
  // Effective probability 0..1 = the district's peak probability × active fraction.
  function rainActiveProb(d, clock) {
    return (d.rainfall / 100) * rainActiveFrac(d, clock);
  }

  function drawRain() {
    const clock = (14 + currentLeadHour()) % 24;
    // Stable base storm — movement comes from the per-district window ramp, not
    // from re-seeding, so the front arrives, peaks and passes coherently.
    const data = generateRainData();

    // Front field: one weighted point per district plus a few interpolated
    // midpoints between near neighbours so adjacent cells merge into one front
    // shape rather than separate discs.
    const pts = data.map(d => [d.lat, d.lon, rainActiveProb(d, clock)]);
    for (let i = 0; i < data.length; i++) {
      for (let j = i + 1; j < data.length; j++) {
        const a = data[i], b = data[j];
        if (Math.hypot(a.lat - b.lat, a.lon - b.lon) >= 0.045) continue;
        const pa = rainActiveProb(a, clock), pb = rainActiveProb(b, clock);
        if (pa + pb <= 0) continue;
        pts.push([(a.lat + b.lat) / 2, (a.lon + b.lon) / 2, ((pa + pb) / 2) * 0.9]);
      }
    }
    if (typeof L.heatLayer === 'function') {
      gHazard.addLayer(L.heatLayer(pts, { radius: 65, blur: 50, minOpacity: 0.18, max: 0.7, gradient: RAIN_GRADIENT }));
    } else {
      // Graceful fallback to soft discs where leaflet.heat is unavailable.
      data.forEach(d => {
        const c = rainfallColor(Math.round(rainActiveProb(d, clock) * 100));
        L.circle([d.lat, d.lon], { radius: 1800, color: c, weight: 0, fillColor: c, fillOpacity: 0.22, interactive: false }).addTo(gHazard);
      });
    }

    // District markers kept on top as small dots, coloured by the active
    // probability so they agree with the front; click opens the detail modal.
    data.forEach(d => {
      const pct = Math.round(rainActiveProb(d, clock) * 100);
      const color = rainfallColor(pct);
      L.circleMarker([d.lat, d.lon], { radius: 5, fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.95 })
        .bindTooltip(`${d.name} — ${pct}% now · ${rainfallLabel(pct)} (simulated)`, { sticky: true })
        .on('click', () => openRainModal(d))
        .addTo(gHazard);
    });
  }

  /* ---- Rain situation hero — mirrors the air/algae hero, bespoke to rain ----
   * Re-seeded at the current lead hour so it tracks the slider: how many
   * districts are Likely+, the peak rainfall window, and an officer verdict. */
  const RAIN_LEVEL_CLS = { 'Very likely': 'aq-level-high', 'Likely': 'aq-level-mod', 'Moderate': 'aq-level-low', 'Low chance': 'aq-level-low' };

  // Peak window across districts (hours with the most districts raining).
  function rainPeakWindow(data) {
    const counts = Array(24).fill(0);
    data.forEach(d => { for (let h = d.startHour; h < Math.min(24, d.startHour + d.durationHours); h++) counts[h]++; });
    const maxC = Math.max(0, ...counts);
    if (maxC === 0) return null;
    const peakHours = counts.reduce((a, c, h) => { if (c === maxC) a.push(h); return a; }, []);
    return { start: peakHours[0], end: peakHours[peakHours.length - 1] + 1, count: maxC };
  }

  function updateRainHero() {
    const hero = document.getElementById('rain-hero');
    if (!hero) return;
    // Same moving storm the map draws: each district's probability is its
    // active value at the current clock, so the hero tracks the front rather
    // than re-seeding. Window fields stay intact for the peak-window readout.
    const clock = (14 + currentLeadHour()) % 24;
    const data = generateRainData().map(d => ({ ...d, rainfall: Math.round(rainActiveProb(d, clock) * 100) }));
    const total = data.length;
    const veryLikely = data.filter(d => d.rainfall >= 65);
    const likely = data.filter(d => d.rainfall >= 50 && d.rainfall < 65);
    const moderate = data.filter(d => d.rainfall >= 30 && d.rainfall < 50);
    const likelyPlus = data.filter(d => d.rainfall >= 50);
    const peakPct = data.reduce((m, d) => Math.max(m, d.rainfall), 0);
    const band = rainfallLabel(peakPct);
    const peak = rainPeakWindow(data);

    const lvlEl = document.getElementById('rain-hero-level');
    const hdEl  = document.getElementById('rain-hero-headline');
    const bkEl  = document.getElementById('rain-hero-breakdown');
    const vdEl  = document.getElementById('rain-hero-verdict');

    if (lvlEl) { lvlEl.textContent = band; lvlEl.className = 'aq-hero-level ' + (RAIN_LEVEL_CLS[band] || 'aq-level-low'); }

    if (hdEl) {
      if (likelyPlus.length > 0 && peak) {
        hdEl.textContent = `Rain likely in ${likelyPlus.length} of ${total} districts, peak ${fmtHour(peak.start)} to ${fmtHour(peak.end)}`;
      } else if (moderate.length > 0) {
        hdEl.textContent = `Moderate rain chance in ${moderate.length} of ${total} districts`;
      } else {
        hdEl.textContent = `Low rain chance across all ${total} districts`;
      }
    }

    if (bkEl) {
      const bands = [
        { label: 'Very likely', color: '#1e3a8a', n: veryLikely.length },
        { label: 'Likely',      color: '#2563eb', n: likely.length },
        { label: 'Moderate',    color: '#60a5fa', n: moderate.length },
      ];
      const parts = bands.filter(b => b.n > 0).map(b =>
        `<span class="aq-breakdown-item"><span class="aq-breakdown-dot" style="background:${b.color}"></span>${b.n} ${b.label}</span>`);
      parts.push(`<span class="aq-breakdown-item" style="color:var(--text-tertiary)">${total} districts · simulated (no live data)</span>`);
      bkEl.innerHTML = parts.join('');
    }

    if (vdEl) {
      let verdict;
      if (likelyPlus.length > 0) {
        const names = likelyPlus.map(d => d.name);
        const shown = names.slice(0, 3).join(', ');
        verdict = `Advisory for ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.`;
      } else if (moderate.length > 0) {
        verdict = 'Monitor — moderate rain chance. No advisory needed yet.';
      } else {
        verdict = 'No rainfall advisory needed.';
      }
      vdEl.textContent = verdict;
      vdEl.className = 'aq-hero-verdict';
    }

    hero.style.display = 'flex';
  }

  function showRainHero() { const h = document.getElementById('rain-hero'); if (h) h.style.display = 'flex'; }
  function hideRainHero() { const h = document.getElementById('rain-hero'); if (h) h.style.display = 'none'; }

  /* ---- Rain duration strip — a district duration overview from aggDurBar() ---- */
  function updateRainStrip() {
    const body = document.getElementById('rain-strip-body');
    const sub  = document.getElementById('rain-strip-sub');
    if (!body) return;
    // Stable storm windows give the duration overview; "raining" counts the
    // districts active at the current clock so the sub line tracks the front.
    const clock = (14 + currentLeadHour()) % 24;
    const data = generateRainData();
    const raining = data.filter(d => rainActiveProb(d, clock) * 100 >= 30).length;
    const { html, peakLabel } = aggDurBar(data, 'on-rain');
    if (sub) sub.textContent = `${raining} of ${data.length} districts with rain · simulated (no live connection)`;
    body.innerHTML =
      `<div class="dur-bar rain-strip-bar">${html}</div>
       <div class="dur-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
       <div class="rain-strip-peak">${peakLabel}</div>`;
  }

  function showRainStrip() {
    updateRainStrip();
    const s = document.getElementById('rain-strip');
    if (s) s.style.display = 'block';
  }
  function hideRainStrip() {
    const s = document.getElementById('rain-strip');
    if (s) s.style.display = 'none';
  }

  /* ---- Rain district modal — mirrors the algae modal ----
   * Per-district metrics, the duration bar, an officer recommendation, audit
   * trail, an Issue / Lift advisory state machine, and a public message with
   * draft + send logged. Status + audit persist by district id (the forecast
   * itself is re-seeded each draw). */
  const RAIN_STATUS_LABEL = { none: 'No advisory', advisory: 'Advisory issued' };
  const RAIN_STATUS_BTN   = { none: 'Lift advisory', advisory: 'Issue advisory' };
  const _rainState = {};
  let _rainModalDistrict = null;
  let _rainPendingStatus = null;

  function rainStateFor(d) {
    if (!_rainState[d.id]) {
      _rainState[d.id] = {
        status: 'none',
        audit: [{ time: 'start of shift', text: 'Monitoring simulated rainfall forecast. No advisory active.' }],
      };
    }
    return _rainState[d.id];
  }

  function rainSeverityClass(pct) {
    return pct >= 65 ? 'val-high' : pct >= 50 ? 'val-warn' : 'val-ok';
  }

  function rainRecommendation(d) {
    const end = Math.min(23, d.startHour + d.durationHours);
    if (d.rainfall >= 65) return `Heavy rain likely in ${d.name} — ${d.rainfall}% probability, up to ${d.totalRainfall_mm} mm. Issue a rainfall advisory: warn of local flooding and surface water, and alert drainage and operations for the ${fmtHour(d.startHour)}–${fmtHour(end)} window.`;
    if (d.rainfall >= 50) return `Rain likely in ${d.name} (${d.rainfall}%, up to ${d.totalRainfall_mm} mm). Consider a precautionary advisory; monitor the forecast and ready drainage crews for the ${fmtHour(d.startHour)}–${fmtHour(end)} window.`;
    if (d.rainfall >= 30) return `Moderate rain chance in ${d.name} (${d.rainfall}%). No advisory needed yet; keep watching the simulated forecast.`;
    return `Low rain chance in ${d.name} (${d.rainfall}%). No action needed.`;
  }

  function renderRainAudit(d) {
    const el = document.getElementById('rain-modal-audit');
    if (!el) return;
    el.innerHTML = rainStateFor(d).audit.map(e =>
      `<div class="algae-modal-audit-entry"><span class="algae-modal-audit-time">${escapeHtml(e.time)}</span><span>${escapeHtml(e.text)}</span></div>`
    ).join('');
  }

  function renderRainStatusButtons(active) {
    const row = document.getElementById('rain-modal-status-row');
    if (!row) return;
    row.innerHTML = ['none', 'advisory'].map(s =>
      `<button class="algae-modal-status-btn ${active === s ? 'active-' + s : ''}" data-status="${s}">${RAIN_STATUS_BTN[s]}</button>`
    ).join('');
    row.querySelectorAll('.algae-modal-status-btn').forEach(btn => {
      btn.addEventListener('click', () => { _rainPendingStatus = btn.dataset.status; renderRainStatusButtons(_rainPendingStatus); });
    });
  }

  function openRainModal(d) {
    if (!d) return;
    _rainModalDistrict = d;
    const st = rainStateFor(d);
    _rainPendingStatus = st.status;

    document.getElementById('rain-modal-eyebrow').textContent = 'District · Stockholm';
    document.getElementById('rain-modal-title').textContent = d.name;

    const badge = document.getElementById('rain-modal-badge');
    badge.textContent = RAIN_STATUS_LABEL[st.status];
    badge.className = 'algae-modal-status-badge badge-' + st.status;

    const metrics = [
      { label: 'Rainfall probability', value: `${d.rainfall}%`, cls: rainSeverityClass(d.rainfall) },
      { label: 'Total expected',       value: `${d.totalRainfall_mm} mm`, cls: '' },
      { label: 'Dew point',            value: `${d.dewPoint} °C`, cls: '' },
      { label: 'Humidity',             value: `${d.humidity}%`, cls: '' },
    ];
    document.getElementById('rain-modal-metrics').innerHTML = metrics.map(m =>
      `<div class="algae-modal-obs-item">
        <div class="algae-modal-obs-label">${escapeHtml(m.label)}</div>
        <div class="algae-modal-obs-value ${m.cls}">${escapeHtml(m.value)}</div>
      </div>`
    ).join('');

    document.getElementById('rain-modal-note').innerHTML =
      `${rainfallLabel(d.rainfall)} · simulated SMHI-shaped forecast — no live connection`;

    const end = Math.min(23, d.startHour + d.durationHours);
    document.getElementById('rain-modal-duration').innerHTML =
      `<div class="rain-modal-dur-label">${fmtHour(d.startHour)} – ${fmtHour(end)} · ${d.durationHours} hr${d.durationHours > 1 ? 's' : ''}</div>
       <div class="dur-bar rain-strip-bar">${durBarHtml(d.startHour, d.durationHours, 'on-rain')}</div>
       <div class="dur-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>`;

    document.getElementById('rain-modal-rec').textContent = rainRecommendation(d);
    renderRainAudit(d);
    renderRainStatusButtons(_rainPendingStatus);

    document.getElementById('rain-modal-message').value = '';
    document.getElementById('rain-modal-sent').style.display = 'none';

    document.getElementById('rain-modal').style.display = 'flex';
  }

  function closeRainModal() {
    document.getElementById('rain-modal').style.display = 'none';
    _rainModalDistrict = null;
    _rainPendingStatus = null;
  }

  function rainGenerateDraft() {
    if (!_rainModalDistrict) return;
    const d = _rainModalDistrict;
    const s = _rainPendingStatus || rainStateFor(d).status;
    const templates = {
      advisory: `Stockholm stad informerar: Risk för kraftigt regn i ${d.name}, ${d.rainfall}% sannolikhet och upp till ${d.totalRainfall_mm} mm. Var beredd på lokala översvämningar och vatten på vägbanan. Undvik källarutrymmen vid skyfall.`,
      none:     `Stockholm stad informerar: Regn väntas i ${d.name} under dagen (${d.rainfall}% sannolikhet). Ingen varning råder för närvarande. Håll dig uppdaterad via stockholm.se.`,
    };
    document.getElementById('rain-modal-message').value = templates[s] || templates.none;
  }

  function rainSendAdvisory() {
    if (!_rainModalDistrict) return;
    const msg = document.getElementById('rain-modal-message').value.trim();
    if (!msg) { document.getElementById('rain-modal-message').focus(); return; }
    const d = _rainModalDistrict;
    const st = rainStateFor(d);

    if (_rainPendingStatus && _rainPendingStatus !== st.status) {
      const old = st.status;
      st.status = _rainPendingStatus;
      st.audit.unshift({ time: 'just now', text: `Rainfall advisory ${st.status === 'advisory' ? 'issued' : 'lifted'}: ${RAIN_STATUS_LABEL[old]} → ${RAIN_STATUS_LABEL[st.status]}. Message sent. Officer: You` });
      const badge = document.getElementById('rain-modal-badge');
      badge.textContent = RAIN_STATUS_LABEL[st.status];
      badge.className = 'algae-modal-status-badge badge-' + st.status;
    } else {
      st.audit.unshift({ time: 'just now', text: 'Advisory message sent (status unchanged). Officer: You' });
    }

    renderRainAudit(d);
    document.getElementById('rain-modal-sent').style.display = 'block';
  }

  function activateRain(haz) {
    hidePollen();
    hideAirHero();
    hideAlgaeHero();
    hideAlgaeRiskStrip();
    hideHeatHero();
    hideHeatStrip();
    hideFireHero();
    hideFireStrip();
    updateRainHero();
    showRainStrip();
    setLayerStatus([{ id: 'rain', label: haz.layers[0].label, state: 'offline', detail: 'simulated · SMHI adapter not connected' }]);
    setProvenance(haz.provenance, haz.confidence, true);
    if (haz.draw) haz.draw();
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
      note: haz.real ? (currentHazard === 'air' ? 'Live source-tagged readings.' : 'Live source-tagged forecast (not measured).') : 'PLACEHOLDER hazard — sample data, not a real measurement.',
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
      ], cue: 'soft fill = modelled (CAMS) · dots = measured stations' },
      layers: [
        { key: 'hazard', label: 'PM2.5 plume (CAMS) + stations', on: true, dot: '#E24B4A' },
        { key: 'integration', label: 'Integration layer', on: false, dot: '#534AB7' },
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
      draw: drawFire, activate: activateFire
    },
    heat: {
      eyebrow: 'Extreme heat', verb: 'Activate the municipal heat plan',
      decisionTitle: 'Municipal heat plan',
      sources: 'SMHI metfcst snow1g v1 (forecast)',
      legend: { title: 'Apparent temp (känns som)', items: [
        { c: '#2C7FB8', t: 'Comfortable <27°' }, { c: '#FAC775', t: 'Caution 27–29°' },
        { c: '#EF9F27', t: 'Warning 30–32°' }, { c: '#E24B4A', t: 'Extreme 33°+' }
      ] },
      layers: [
        { key: 'hazard', label: 'Apparent-temp surface (SMHI forecast)', on: true, dot: '#EF9F27' },
        { key: 'vulnerable', label: 'Vulnerable sites', on: true, dot: '#A32D2D' },
        { key: 'integration', label: 'Integration layer', on: false, dot: '#534AB7' }
      ],
      fields: [
        { label: 'Priority', kind: 'select', options: ['Care homes', 'Preschools', 'Both'] },
        { label: 'Window', kind: 'text', placeholder: 'e.g. 12:00–18:00' },
        { label: 'Scope', kind: 'text', placeholder: 'areas + sites' },
        { label: 'Message', kind: 'textarea', placeholder: 'Activation message…' }
      ],
      buttons: ['Activate', 'Stand down'], confidence: 'high', real: true,
      provenance: 'Forecast: SMHI metfcst snow1g v1 (NWP forecast, not measured).',
      draw: drawHeat,
      onLead: (lead) => { gHazard.clearLayers(); drawHeatZones(lead); gVulnerable.clearLayers(); drawHeatVulnerable(lead); updateHeatHero(); updateHeatStrip(); },
      activate: activateHeat
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
      draw: drawRain,
      onLead: (lead) => { gHazard.clearLayers(); drawRain(); updateRainHero(); updateRainStrip(); },
      activate: activateRain
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
