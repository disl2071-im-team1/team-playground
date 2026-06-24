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

  function fmtHour(h) { return String(Math.min(23, h)).padStart(2, '0') + ':00'; }

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
      const res = await fetch('/api/air-quality', { cache: 'no-cache' });
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
      const res = await fetch('/api/stockholm-air', { cache: 'no-cache' });
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
      const res = await fetch(url, { cache: 'no-cache' });
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

  // Real observed bathing-water status from the HaV "Badplatser och badvatten"
  // API, fetched on tab activation (see /api/algae-status). This is OBSERVED
  // municipal sampling (periodic/seasonal), days old at times — never a live
  /* ============================================================
   * Officer-decision persistence (localStorage)
   *
   * The API provides the real baseline (HaV sampling, SMHI forecasts). The
   * officer's actions — status changes, declared/lifted bans, audit entries —
   * are a SEPARATE local layer stored here and merged on top of the baseline on
   * load. We never persist or overwrite the API data itself, only decisions.
   * Shape: { algae|fire|heat|rain: { <site/zone/district id>: { status, audit } } }
   * ========================================================== */
  const OFFICER_KEY = 'cleanpath.officerState.v1';
  let _storageOK = true;
  let _officer = { algae: {}, fire: {}, heat: {}, rain: {} };

  function officerLoad() {
    try {
      const raw = localStorage.getItem(OFFICER_KEY);
      if (raw) _officer = Object.assign({ algae: {}, fire: {}, heat: {}, rain: {} }, JSON.parse(raw));
    } catch (e) {
      _storageOK = false; // private mode / disabled storage — fall back to memory
      console.warn('[cleanpath] officer-state storage unavailable; using in-memory only.', e);
    }
  }
  function officerSave() {
    if (!_storageOK) return;
    try {
      localStorage.setItem(OFFICER_KEY, JSON.stringify(_officer));
    } catch (e) {
      _storageOK = false;
      console.warn('[cleanpath] officer-state save failed; using in-memory only.', e);
      officerStoreNote();
    }
  }
  function officerGet(hazard, id) {
    return (_officer[hazard] && _officer[hazard][id]) || null;
  }
  // Persist only the officer's decision (status + audit), never API data.
  function officerSet(hazard, id, status, audit) {
    if (!_officer[hazard]) _officer[hazard] = {};
    _officer[hazard][id] = { status, audit };
    officerSave();
  }
  function officerClear() {
    _officer = { algae: {}, fire: {}, heat: {}, rain: {} };
    officerSave();
  }
  // Surface a one-line note when storage is unavailable (decisions won't persist).
  function officerStoreNote() {
    const el = document.getElementById('officer-store-note');
    if (!el) return;
    if (_storageOK) { el.style.display = 'none'; return; }
    el.textContent = 'Browser storage unavailable — officer decisions are kept for this session only.';
    el.style.display = 'block';
  }
  // Wipe the local officer layer (after confirm) and redraw from the API baseline.
  function clearShiftHistory() {
    const ok = window.confirm(
      'Clear all officer decisions and audit trails stored in this browser?\n\n' +
      'The live API data (HaV sampling, SMHI forecasts) is not affected. This cannot be undone.');
    if (!ok) return;
    officerClear();
    Object.keys(_heatState).forEach(k => delete _heatState[k]);
    Object.keys(_rainState).forEach(k => delete _rainState[k]);
    Object.keys(_algaeAudit).forEach(k => delete _algaeAudit[k]);
    FIRE_ZONES.forEach(z => { z.status = 'none'; z.audit = fireAuditSeed(); });
    if (currentHazard) selectHazard(currentHazard); // re-activate → redraw from baseline
  }

  // sensor and never a forecast. Sites are populated from the real response.
  let ALGAE_SITES = [];
  let algaeOk = null; // null while loading, true once populated, false on failure
  let _algaeRetrieved = null;
  const _algaeAudit = {}; // per-site officer audit, persists across redraws

  // Seed a site's audit from the persisted officer layer, else the shift-start line.
  function algaeAuditFor(id) {
    if (!_algaeAudit[id]) {
      const saved = officerGet('algae', id);
      _algaeAudit[id] = saved ? saved.audit.slice() : [{ time: 'start of shift', text: 'Monitoring HaV bathing-water sampling. No advisory posted.' }];
    }
    return _algaeAudit[id];
  }
  function algaeDataAge(ageDays) {
    if (ageDays == null) return 'unknown';
    if (ageDays <= 0) return 'today';
    if (ageDays === 1) return '1 day ago';
    return `${ageDays} days ago`;
  }
  function algaeRecommendation(site) {
    if (site.status === 'closed') return `HaV records a season-long advice against bathing at ${site.name}. Keep the closure notice posted and re-check the next sampling round.`;
    if (site.status === 'advisory') return `HaV records an ongoing advice against bathing at ${site.name}${site.advisory ? ' (' + site.advisory + ')' : ''}. Maintain the public advisory and monitor the next sample.`;
    if (site.status === 'watch') return `HaV flags a bloom risk at ${site.name} with no advisory in force. Keep the site on watch and consider precautionary signage.`;
    return `${site.name} is clear in the latest HaV sample. No advisory needed; continue routine seasonal sampling.`;
  }
  function algaeFactors(site) {
    const o = site.observed || {};
    const f = [];
    if (site.advisory) f.push({ icon: '⚠️', text: `Ongoing advice against bathing (HaV): ${site.advisory}` });
    if (site.bloom) f.push({ icon: '🦠', text: 'Algae / cyanobacteria bloom risk flagged by HaV' });
    if (site.classification) f.push({ icon: '🏅', text: `EU bathing-water classification: ${site.classification}` });
    if (o.assessment) f.push({ icon: '🔬', text: `Latest sample assessment: ${o.assessment}` });
    if (site.stale) f.push({ icon: '🕐', text: `Last sample ${site.dataAge} — overdue, treat as low confidence` });
    if (!f.length) f.push({ icon: '✅', text: 'No bloom risk or advisory in the latest HaV sampling.' });
    return f;
  }
  function algaeSignals(site) {
    const s = [];
    if (site.status === 'closed') s.push('closed');
    if (site.status === 'advisory') s.push('advisory');
    if (site.status === 'watch') s.push('watch');
    if (site.bloom) s.push('bloom');
    if (site.stale) s.push('stale');
    return s;
  }

  function updateAlgaeHero() {
    const hero = document.getElementById('algae-hero');
    if (!hero) return;
    const lvlEl  = document.getElementById('algae-hero-level');
    const hdEl   = document.getElementById('algae-hero-headline');
    const bkEl   = document.getElementById('algae-hero-breakdown');
    const vdEl   = document.getElementById('algae-hero-verdict');

    if (algaeOk !== true) {
      const failed = algaeOk === false;
      if (lvlEl) { lvlEl.textContent = '—'; lvlEl.className = 'aq-hero-level aq-level-low'; }
      if (hdEl) hdEl.textContent = failed ? 'Sampling data unavailable' : 'Loading HaV sampling…';
      if (bkEl) bkEl.innerHTML = '';
      if (vdEl) { vdEl.textContent = failed ? 'HaV Badplatser och badvatten API did not respond.' : ''; vdEl.className = 'aq-hero-verdict'; }
      hero.style.display = 'flex';
      return;
    }

    const total = ALGAE_SITES.length;
    const advisories = ALGAE_SITES.filter(s => s.status === 'advisory' || s.status === 'closed').length;
    const watches = ALGAE_SITES.filter(s => s.status === 'watch').length;
    // Freshness note from the real sample dates (oldest sample across the network).
    const maxAge = ALGAE_SITES.reduce((m, s) => (s.ageDays != null && s.ageDays > m ? s.ageDays : m), 0);
    const fresh = `<span class="aq-breakdown-item" style="color:var(--text-tertiary)">HaV sampling · oldest sample ${algaeDataAge(maxAge)}</span>`;

    if (advisories === 0 && watches === 0) {
      if (lvlEl)  { lvlEl.textContent = 'Clear'; lvlEl.className = 'aq-hero-level aq-level-low'; }
      if (hdEl)   hdEl.textContent = 'All bathing sites are clear across Stockholm';
      if (bkEl)   bkEl.innerHTML = `<span class="aq-breakdown-item">${total} sites monitored — no active advisories</span>` + fresh;
      if (vdEl)   { vdEl.textContent = 'No bathing advisories in the latest HaV sampling.'; vdEl.className = 'aq-hero-verdict'; }
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
      parts.push(fresh);
      if (bkEl)   bkEl.innerHTML = parts.join('');
      if (vdEl)   { vdEl.textContent = advisories ? 'Avoid swimming at affected sites.' : 'Exercise caution at watch sites.'; vdEl.className = 'aq-hero-verdict'; }
    }

    hero.style.display = 'flex';
  }

  function showAlgaeHero() { const h = document.getElementById('algae-hero'); if (h) h.style.display = 'flex'; }
  function hideAlgaeHero() { const h = document.getElementById('algae-hero'); if (h) h.style.display = 'none'; }

  // Real signal rollups derived from the HaV per-site status.
  const ALGAE_SIGNAL_META = {
    'advisory': { icon: '⚠️', shortLabel: 'Bathing advisory', severity: 3 },
    'closed':   { icon: '⛔', shortLabel: 'Closed (season)',   severity: 3 },
    'bloom':    { icon: '🦠', shortLabel: 'Bloom risk',        severity: 2 },
    'watch':    { icon: '👁️', shortLabel: 'On watch',          severity: 2 },
    'stale':    { icon: '🕐', shortLabel: 'Overdue sample',    severity: 1 },
  };

  function updateAlgaeRiskStrip() {
    const grid = document.getElementById('algae-risk-grid');
    if (!grid) return;

    if (algaeOk !== true) {
      grid.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">${algaeOk === false ? 'Sampling data unavailable.' : 'Loading HaV sampling…'}</div>`;
      return;
    }

    const total = ALGAE_SITES.length;

    // Count sites per real signal (advisory / closed / bloom / watch / stale).
    const counts = {};
    ALGAE_SITES.forEach(site => {
      algaeSignals(site).forEach(tag => { counts[tag] = (counts[tag] || 0) + 1; });
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

  async function loadAlgaeStatus(haz) {
    setStatus('algae', 'pending', 'loading HaV sampling…');
    try {
      const res = await fetch('/api/algae-status', { cache: 'no-cache' });
      const data = await res.json();
      if (currentHazard !== 'algae') return; // officer switched tabs mid-flight
      if (!data.ok) throw new Error(data.reason || 'unavailable');

      ALGAE_SITES = (data.sites || [])
        .filter(s => s.ok !== false && s.lat != null && s.lon != null)
        .map(s => {
          // API status is the baseline; a persisted officer decision overrides it.
          const saved = officerGet('algae', s.id);
          return {
            id: s.id, name: s.name, ll: [s.lat, s.lon], status: saved ? saved.status : s.status,
            bloom: s.bloom, advisory: s.advisory, classification: s.classification,
            lastSampled: s.lastSampled, ageDays: s.ageDays,
            dataAge: algaeDataAge(s.ageDays), stale: (s.ageDays != null && s.ageDays > 14),
            observed: s.observed || {}, audit: algaeAuditFor(s.id),
          };
        });
      algaeOk = true;
      _algaeRetrieved = data.retrieved;
      // Re-render the decision panel so the Site dropdown reflects the live sites.
      if (currentHazard === 'algae') renderDecisionPanel(haz);

      const n = ALGAE_SITES.length;
      const latest = ALGAE_SITES.reduce((m, s) => (s.lastSampled && (!m || s.lastSampled > m) ? s.lastSampled : m), null);
      const latestLabel = latest ? new Date(latest).toISOString().slice(0, 10) : '—';
      setStatus('algae', 'ok', `HaV sampling · ${n} sites · last sample ${latestLabel}`);
      setProvenance(`Observed: HaV Badplatser och badvatten API v2.3 — municipal sampling (periodic, seasonal). Latest sample ${latestLabel}. Observed sampling, not a live sensor and not a forecast.`, 'observed', false);

      gHazard.clearLayers();
      updateAlgaeHero();
      showAlgaeRiskStrip();
      if (haz.draw) haz.draw();
    } catch (err) {
      if (currentHazard !== 'algae') return;
      algaeOk = false;
      ALGAE_SITES = [];
      gHazard.clearLayers();
      setStatus('algae', 'offline', 'sampling data unavailable (' + err.message + ')');
      setProvenance('Sampling data unavailable — HaV Badplatser och badvatten API did not respond.', 'observed', false);
      updateAlgaeHero();
      updateAlgaeRiskStrip();
    }
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
    algaeOk = null;
    ALGAE_SITES = [];
    showAlgaeHero();
    showAlgaeRiskStrip();
    updateAlgaeHero();  // shows "Loading HaV sampling…"
    updateAlgaeRiskStrip();
    setLayerStatus([{ id: 'algae', label: haz.layers[0].label, state: 'pending', detail: 'loading HaV sampling…' }]);
    setProvenance(haz.provenance, haz.confidence, false);
    loadAlgaeStatus(haz);
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

  // Pollenrapporten reports an integer level on a 0–7 scale (0 Inga halter …
  // 7 Mycket höga). Collapse the 8 steps onto the five existing card bands so
  // the visuals are unchanged.
  const POLLEN_MAX = 7;
  function pollenBand(level) {
    if (level <= 0) return { label: 'None',      cls: 'pollen-badge-none',  color: '#91A896' };
    if (level <= 2) return { label: 'Low',       cls: 'pollen-badge-low',   color: '#2D8653' };
    if (level <= 4) return { label: 'Moderate',  cls: 'pollen-badge-mod',   color: '#D4A042' };
    if (level <= 6) return { label: 'High',      cls: 'pollen-badge-high',  color: '#C24F4F' };
    return               { label: 'Very high',   cls: 'pollen-badge-vhigh', color: '#A03030' };
  }

  function renderPollen(types, updated, scaleMax) {
    const strip = document.getElementById('pollen-strip');
    const grid  = document.getElementById('pollen-grid');
    const sub   = document.getElementById('pollen-updated');
    if (!strip || !grid) return;

    if (sub && updated) sub.textContent = 'Updated ' + updated;

    const max = scaleMax || POLLEN_MAX; // the API's level-scale max (Pollenrapporten = 7)
    grid.innerHTML = types.map(t => {
      const level = t.level;
      const band  = pollenBand(level);
      const pct   = Math.round((level / max) * 100); // absolute on the level scale
      const icon  = t.icon || '🌿';
      return `<div class="pollen-card">
        <div class="pollen-card-glow" style="background:radial-gradient(circle at 20% 80%, ${band.color}, transparent 70%)"></div>
        <span class="pollen-icon">${icon}</span>
        <div class="pollen-name">${escapeHtml(t.name)}</div>
        <span class="pollen-name-sv">${escapeHtml(t.sv)}</span>
        <span class="pollen-count pollen-level" style="color:${band.color}">Level ${level} / ${max}</span>
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
    const strip = document.getElementById('pollen-strip');
    const grid  = document.getElementById('pollen-grid');
    const sub   = document.getElementById('pollen-updated');
    try {
      const res = await fetch('/api/pollen', { cache: 'no-cache' });
      if (!res.ok) throw new Error('upstream');
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.types) || !data.types.length) throw new Error('no data');
      renderPollen(data.types, data.updated, data.scaleMax);
    } catch {
      // No synthetic pollen — say so honestly and show nothing fabricated.
      if (sub) sub.textContent = 'pollen data unavailable';
      if (grid) grid.innerHTML = '';
      if (currentHazard === 'air' && strip) strip.style.display = 'block';
    }
  }

  function hidePollen() {
    const strip = document.getElementById('pollen-strip');
    if (strip) strip.style.display = 'none';
  }

  // The CAMS plume is driven by the time slider; the station dots are not (WAQI
  // has no forecast). At lead > 0 flag the hero as a forecast and say so, so the
  // mixed now/forecast state is explicit.
  function updateAirForecastLabel(lead) {
    const el = document.getElementById('aq-hero-forecast');
    if (!el) return;
    if (lead > 0) {
      el.textContent = `Forecast +${lead}h · CAMS plume only — station readings stay present-time`;
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none'; // lead 0 = live
    }
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
    updateAirForecastLabel(currentLeadHour());
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
          .bindTooltip(`${site.name} — modelled local spread · ~${r} m`, { sticky: true })
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

  /* ---- Shared modal keyboard a11y ----
   * Escape to close, a Tab focus-trap, and focus restore. One modal is open at
   * a time, so a single active-trap record is enough. Applied to all four
   * decision modals via their open/close paths. */

  let _activeModalTrap = null;

  function modalFocusables(modal) {
    return Array.from(modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function openModalA11y(modalId, closeFn) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (_activeModalTrap) closeModalA11y(); // never stack listeners
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const handler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
      if (e.key !== 'Tab') return;
      const els = modalFocusables(modal);
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !modal.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last || !modal.contains(active)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler, true);
    _activeModalTrap = { handler, prevFocus: document.activeElement };

    // Move focus inside: first focusable, else the close button, else the modal.
    const els = modalFocusables(modal);
    const target = els[0] || modal.querySelector('[id$="-modal-close"]') || modal;
    if (target && target.focus) target.focus();
  }

  function closeModalA11y() {
    if (!_activeModalTrap) return;
    document.removeEventListener('keydown', _activeModalTrap.handler, true);
    const prev = _activeModalTrap.prevFocus;
    _activeModalTrap = null;
    if (prev && prev.focus) prev.focus();
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

    // Observed sample values — real HaV fields only (no synthetic numbers).
    const o = site.observed || {};
    const obsEl = document.getElementById('algae-modal-obs');
    const obsMap = {
      'E. coli':       o.eColi != null ? `${o.eColiPrefix || ''}${o.eColi} cfu/100ml` : '—',
      'Enterococci':   o.enterococci != null ? `${o.enterococciPrefix || ''}${o.enterococci} cfu/100ml` : '—',
      'Water temp':    o.waterTemp != null ? `${o.waterTemp} °C` : '—',
      'Sample result': o.assessment || '—',
    };
    const valClass = site.status === 'advisory' || site.status === 'closed' ? 'val-high'
                   : site.status === 'watch' ? 'val-warn' : 'val-ok';
    obsEl.innerHTML = Object.entries(obsMap).map(([k, v]) =>
      `<div class="algae-modal-obs-item">
        <div class="algae-modal-obs-label">${escapeHtml(k)}</div>
        <div class="algae-modal-obs-value ${k === 'Sample result' ? valClass : ''}">${escapeHtml(v)}</div>
      </div>`
    ).join('');

    const ageEl = document.getElementById('algae-modal-age');
    ageEl.textContent = `Last HaV sample: ${site.dataAge}`;
    ageEl.className = 'algae-modal-data-age' + (site.stale ? ' stale' : '');
    if (site.stale) ageEl.textContent += ' · ⚠ Sample overdue — treat as low confidence';

    // Risk factors — derived from the real HaV signals.
    document.getElementById('algae-modal-factors').innerHTML = algaeFactors(site).map(f =>
      `<div class="algae-modal-factor"><span class="algae-modal-factor-icon">${f.icon}</span><span>${escapeHtml(f.text)}</span></div>`
    ).join('');

    // Recommendation (derived from the observed status).
    document.getElementById('algae-modal-rec').textContent = algaeRecommendation(site);

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
    openModalA11y('algae-modal', closeAlgaeModal);
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
    closeModalA11y();
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

  function algaeSendAdvisory() {
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
    officerSet('algae', _modalSite.id, _modalSite.status, _modalSite.audit);

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
    document.getElementById('algae-modal-send').addEventListener('click', algaeSendAdvisory);

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

  // Static zone identity + officer state (status/audit persist across redraws).
  // index/fwi/band/drivers are populated from the real SMHI FWI on activation
  // (see /api/fire-risk); index is the SMHI 1–6 fire-risk class (fwiindex).
  function fireAuditSeed() {
    return [{ time: 'start of shift', text: 'Monitoring SMHI fwif1g fire-risk forecast. No restriction active.' }];
  }
  const FIRE_ZONES = [
    { id: 'nw', short: 'NW zone', name: 'NW zone — Järvafältet',      latlngs: fireBox(59.36, 18.02, 0.03), status: 'none', audit: fireAuditSeed(), index: null, fwi: null, band: null, drivers: [] },
    { id: 'ne', short: 'NE zone', name: 'NE zone — Norra Djurgården', latlngs: fireBox(59.36, 18.12, 0.03), status: 'none', audit: fireAuditSeed(), index: null, fwi: null, band: null, drivers: [] },
    { id: 'sw', short: 'SW zone', name: 'SW zone — Älvsjöskogen',     latlngs: fireBox(59.29, 18.02, 0.03), status: 'none', audit: fireAuditSeed(), index: null, fwi: null, band: null, drivers: [] },
    { id: 'se', short: 'SE zone', name: 'SE zone — Nackareservatet',  latlngs: fireBox(59.29, 18.12, 0.03), status: 'none', audit: fireAuditSeed(), index: null, fwi: null, band: null, drivers: [] },
  ];
  // Forecast state: null while loading, true once populated, false on failure
  // (we never fall back to synthetic data).
  let fireForecastOk = null;
  let _fireApprovedTime = null, _fireValidTime = null;

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
    if (fireForecastOk !== true) return; // loading/unavailable — empty layer
    // Feathered modelled risk surface (reuses the heat-layer pattern). Radius
    // and blur are kept coarse on purpose so it reads as a low-resolution
    // model, never per-block precision. The values are real SMHI FWI, but FWI
    // is a model — so the surface stays a modelled index, never a measurement.
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
        .bindTooltip(`${z.name} — ${fireBand(z.index)}${z.fwi != null ? ' · FWI ' + z.fwi : ''} (SMHI FWI, modelled)`, { sticky: true })
        .on('click', () => openFireModal(z))
        .addTo(gHazard);
    });
  }

  /* ---- Fire situation hero — mirrors the air/algae hero, bespoke to fire ---- */
  const FIRE_LEVEL_CLS = { Extreme: 'aq-level-vhigh', High: 'aq-level-high', Moderate: 'aq-level-mod', Low: 'aq-level-low' };

  function updateFireHero() {
    const hero = document.getElementById('fire-hero');
    if (!hero) return;
    const lvlEl0 = document.getElementById('fire-hero-level');
    const hdEl0  = document.getElementById('fire-hero-headline');
    const bkEl0  = document.getElementById('fire-hero-breakdown');
    const vdEl0  = document.getElementById('fire-hero-verdict');
    if (fireForecastOk !== true) {
      const failed = fireForecastOk === false;
      if (lvlEl0) { lvlEl0.textContent = '—'; lvlEl0.className = 'aq-hero-level aq-level-low'; }
      if (hdEl0) hdEl0.textContent = failed ? 'Fire-risk forecast unavailable' : 'Loading SMHI FWI…';
      if (bkEl0) bkEl0.innerHTML = '';
      if (vdEl0) { vdEl0.textContent = failed ? 'SMHI fwif1g v1 did not respond.' : ''; vdEl0.className = 'aq-hero-verdict'; }
      hero.style.display = 'flex';
      return;
    }
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
      parts.push(`<span class="aq-breakdown-item" style="color:var(--text-tertiary)">${total} zones · modelled, SMHI/MSB FWI</span>`);
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
   * Aggregates the real SMHI FWI driver components across zones (wind, fine
   * fuel moisture, drought code): how many zones carry each at an elevated
   * level. The values are real; FWI is still a model, so "modelled". */
  const FIRE_DRIVER_META = {
    'wind': { icon: '💨', label: 'High wind' },
    'ffmc': { icon: '🌿', label: 'Dry fine fuel (FFMC)' },
    'dc':   { icon: '☀️', label: 'Drought (DC)' },
  };

  function updateFireStrip() {
    const grid = document.getElementById('fire-strip-grid');
    const sub  = document.getElementById('fire-strip-sub');
    if (!grid) return;
    const total = FIRE_ZONES.length;

    if (fireForecastOk !== true) {
      if (sub) sub.textContent = fireForecastOk === false
        ? 'Fire-risk forecast unavailable · SMHI fwif1g v1'
        : 'Loading SMHI FWI…';
      grid.innerHTML = '';
      return;
    }

    if (sub) sub.textContent = `Modelled FWI drivers across ${total} zones · SMHI/MSB FWI`;

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

  // Format a model valid time (ISO) as "HH:00, DD Mon" (viewer-local).
  function fireWhen(iso) {
    const d = new Date(iso);
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${String(d.getHours()).padStart(2, '0')}:00, ${d.getDate()} ${mon}`;
  }

  // Officer recommendation from the modelled band — no synthetic specifics.
  function fireRecommendation(z) {
    const band = fireBand(z.index);
    if (band === 'Extreme') return `Modelled fire-risk is Extreme (SMHI FWI) in ${z.name}. Declare an open-burning ban immediately, notify the public and brief the rescue service.`;
    if (band === 'High') return `Modelled fire-risk is High (SMHI FWI) in ${z.name}. An open-burning ban is advised; post signage at trailheads and re-check the FWI daily.`;
    if (band === 'Moderate') return `Modelled fire-risk is Moderate (SMHI FWI) in ${z.name}. No ban yet; prepare a precautionary burning advisory and monitor the forecast.`;
    return `Modelled fire-risk is Low (SMHI FWI) in ${z.name}. No restriction needed; continue routine monitoring of the brandrisk forecast.`;
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
      `Modelled fire-risk index <strong style="color:${fireColor(z.index)}">${z.index} of 6</strong> · ${fireBand(z.index)}${z.fwi != null ? ' · FWI ' + z.fwi : ''} · SMHI fwif1g v1 (modelled, for MSB)${_fireValidTime ? ' — valid ' + fireWhen(_fireValidTime) : ''}`;

    document.getElementById('fire-modal-rec').textContent = fireRecommendation(z);
    renderFireAudit(z);
    renderFireStatusButtons(_firePendingStatus);

    document.getElementById('fire-modal-message').value = '';
    document.getElementById('fire-modal-sent').style.display = 'none';

    document.getElementById('fire-modal').style.display = 'flex';
    openModalA11y('fire-modal', closeFireModal);
  }

  function closeFireModal() {
    document.getElementById('fire-modal').style.display = 'none';
    closeModalA11y();
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
    officerSet('fire', z.id, z.status, z.audit);

    renderFireAudit(z);
    document.getElementById('fire-modal-sent').style.display = 'block';
  }

  function fireBaseLabel(iso) {
    if (!iso) return 'unknown';
    return `${iso.slice(11, 16)} UTC ${iso.slice(0, 10)}`;
  }

  async function loadFireRisk(haz) {
    setStatus('fire', 'pending', 'loading SMHI FWI…');
    try {
      const res = await fetch('/api/fire-risk', { cache: 'no-cache' });
      const data = await res.json();
      if (currentHazard !== 'fire') return; // officer switched tabs mid-flight
      if (!data.ok) throw new Error(data.reason || 'unavailable');

      const byId = {};
      data.zones.forEach(z => { byId[z.id] = z; });
      FIRE_ZONES.forEach(z => {
        const r = byId[z.id];
        if (r) { z.index = r.fwiindex; z.fwi = r.fwi; z.band = r.band; z.drivers = r.drivers || []; }
      });
      fireForecastOk = true;
      _fireApprovedTime = data.approvedTime;
      _fireValidTime = data.validTime;

      const base = fireBaseLabel(data.approvedTime);
      const vlabel = data.validTime ? fireWhen(data.validTime) : '—';
      setStatus('fire', 'ok', `SMHI FWI · modelled · valid ${vlabel}`);
      setProvenance(`Modelled: SMHI fwif1g v1 (Canadian FWI), computed for MSB. Model run ${base}, valid ${vlabel}.`, 'modelled', false);

      gHazard.clearLayers();
      updateFireHero();
      updateFireStrip();
      if (haz.draw) haz.draw();
    } catch (err) {
      if (currentHazard !== 'fire') return;
      fireForecastOk = false;
      gHazard.clearLayers();
      setStatus('fire', 'offline', 'fire-risk forecast unavailable (' + err.message + ')');
      setProvenance('Fire-risk forecast unavailable — SMHI fwif1g v1 did not respond.', 'modelled', false);
      updateFireHero();
      updateFireStrip();
    }
  }

  function activateFire(haz) {
    hidePollen();
    hideAirHero();
    hideAlgaeHero();
    hideAlgaeRiskStrip();
    hideHeatHero();
    hideHeatStrip();
    hideRainHero();
    hideRainStrip();
    fireForecastOk = null; // reset to loading state
    showFireHero();
    showFireStrip();
    updateFireHero();  // shows "Loading SMHI FWI…"
    updateFireStrip();
    setLayerStatus([{ id: 'fire', label: haz.layers[0].label, state: 'pending', detail: 'loading SMHI FWI…' }]);
    setProvenance(haz.provenance, haz.confidence, false);
    loadFireRisk(haz);
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
  // Inline-SVG pictograms for vulnerable sites: a medical cross (care/eldercare)
  // and a child figure (preschool). Inline SVG keeps rendering consistent across
  // browsers and legible at the ~18px pin size. Care = round badge, preschool =
  // rounded-square badge, so they read apart even before colour. Used by the map
  // pin, the modal and the strip legend so the legend matches the map.
  function vulnIconSVG(type, opts) {
    const o = opts || {};
    const size = o.size || 16;
    const fill = o.fill || 'currentColor'; // badge colour (band colour on the map)
    const mark = o.mark || '#fff';          // pictogram colour
    const stroke = o.stroke ? ` stroke="${o.stroke}" stroke-width="1.5"` : '';
    const rx = type === 'care' ? 7 : 3;
    const badge = o.badge === false ? '' : `<rect x="1" y="1" width="14" height="14" rx="${rx}" fill="${fill}"${stroke}/>`;
    const glyph = type === 'care'
      ? `<path d="M7 4h2v3h3v2H9v3H7V9H4V7h3z" fill="${mark}"/>`
      : `<circle cx="8" cy="5" r="1.8" fill="${mark}"/><path d="M8 7.4c-1.8 0-3.1 1.3-3.1 3V12h6.2v-1.6c0-1.7-1.3-3-3.1-3z" fill="${mark}"/>`;
    return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" style="display:block">${badge}${glyph}</svg>`;
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
      // fill = currentColor → the band colour set inline below; white outline keeps
      // the badge legible over the thermal surface (replaces the old text halo).
      const html = `<span class="vuln-glyph" style="color:${color}">${ring}${vulnIconSVG(v.type, { size: 16, stroke: '#fff' })}</span>`;
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
      { type: 'care', color: '#A32D2D', label: 'Care homes' },
      { type: 'pre',  color: '#534AB7', label: 'Preschools' },
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
        <span class="pollen-icon">${vulnIconSVG(cat.type, { size: 22, fill: cat.color })}</span>
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
      const saved = officerGet('heat', d.name);
      _heatState[d.name] = saved
        ? { status: saved.status, audit: saved.audit.slice() }
        : { status: 'standby', audit: [{ time: 'start of shift', text: 'Monitoring forecast apparent temperature. No heat plan active.' }] };
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
            <span class="heat-vuln-icon ${isCare ? '' : 'pre'}">${vulnIconSVG(v.type, { size: 12, badge: false })}</span>
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
    openModalA11y('heat-modal', closeHeatModal);
  }

  function closeHeatModal() {
    document.getElementById('heat-modal').style.display = 'none';
    closeModalA11y();
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
    officerSet('heat', d.name, st.status, st.audit);

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
      const res = await fetch('/api/heat-forecast', { cache: 'no-cache' });
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
   * Rain hazard — real SMHI precipitation forecast (snow1g v1)
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

  // Real SMHI precipitation forecast (metfcst snow1g v1), fetched on tab
  // activation (see /api/rain-forecast). NWP forecast data — high confidence,
  // but forecast, never a measurement. SMHI gives an amount (mm/h), not a
  // probability, so everything here is intensity, not likelihood.
  // Forecast state: { ok, approvedTime, byName: { [name]: { [leadHour]: hour } } }.
  // null while loading; { ok:false } on failure — we never fall back to synthetic.
  let rainForecast = null;
  function rainSeries(name) {
    return (rainForecast && rainForecast.ok && rainForecast.byName[name]) || null;
  }
  function rainAt(d, lead) {
    const s = rainSeries(d.name);
    return s ? (s[lead] || null) : null;
  }
  function rainMm(d, lead) {
    const h = rainAt(d, lead);
    return h ? h.mmMean : null;
  }
  // Real forecast valid time (HH:00, viewer-local) for a lead, from the shared
  // timegrid — so the hero/strip/modal show the model's hours.
  function rainValidTime(lead) {
    if (!rainForecast || !rainForecast.ok) return null;
    const first = Object.values(rainForecast.byName)[0];
    const h = first && first[lead];
    if (!h) return null;
    return String(new Date(h.validTime).getHours()).padStart(2, '0') + ':00';
  }

  // Intensity bands by mean amount (mm/h): None <0.1, Light 0.1–<2.5,
  // Moderate 2.5–<7.6, Heavy 7.6+. This is intensity, never likelihood.
  function rainBand(mm) {
    if (mm == null) return null;
    if (mm < 0.1) return 'None';
    if (mm < 2.5) return 'Light';
    if (mm < 7.6) return 'Moderate';
    return 'Heavy';
  }
  // Blue ramp by band (reuses the existing palette).
  function rainColor(mm) {
    if (mm == null || mm < 0.1) return '#bfdbfe'; // None
    if (mm < 2.5) return '#60a5fa';               // Light
    if (mm < 7.6) return '#2563eb';               // Moderate
    return '#1e3a8a';                             // Heavy
  }

  // Radar-field gradient: light → deep blue, low end fades to transparent so
  // dry ground reads as a gap. Normalised against ~6 mm/h (Heavy saturates).
  const RAIN_GRADIENT = {
    0.00: 'rgba(191,219,254,0.00)',
    0.10: 'rgba(191,219,254,0.65)', // #bfdbfe Light
    0.42: 'rgba(96,165,250,0.80)',  // #60a5fa
    0.70: 'rgba(37,99,235,0.88)',   // #2563eb Moderate
    1.00: 'rgba(30,58,138,0.94)'    // #1e3a8a Heavy
  };
  const RAIN_MAX_MM = 6; // heat-layer normalisation ceiling (mm/h)

  function drawRain() {
    if (!rainForecast || !rainForecast.ok) return; // loading/unavailable — empty layer
    const lead = currentLeadHour();
    const items = RAIN_DISTRICTS
      .map(d => ({ d, mm: rainMm(d, lead) }))
      .filter(x => x.mm != null);

    // Front field: one weighted point per district (weight = mm/h) plus a few
    // interpolated midpoints between near neighbours so adjacent cells merge
    // into one front shape rather than separate discs.
    const pts = items.map(x => [x.d.lat, x.d.lon, x.mm]);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (Math.hypot(a.d.lat - b.d.lat, a.d.lon - b.d.lon) >= 0.045) continue;
        if (a.mm + b.mm <= 0) continue;
        pts.push([(a.d.lat + b.d.lat) / 2, (a.d.lon + b.d.lon) / 2, ((a.mm + b.mm) / 2) * 0.9]);
      }
    }
    if (typeof L.heatLayer === 'function') {
      gHazard.addLayer(L.heatLayer(pts, { radius: 65, blur: 50, minOpacity: 0.18, max: RAIN_MAX_MM, gradient: RAIN_GRADIENT }));
    } else {
      // Graceful fallback to soft discs where leaflet.heat is unavailable.
      items.forEach(x => {
        const c = rainColor(x.mm);
        L.circle([x.d.lat, x.d.lon], { radius: 1800, color: c, weight: 0, fillColor: c, fillOpacity: 0.22, interactive: false }).addTo(gHazard);
      });
    }

    // District markers kept on top as small dots, coloured by intensity so they
    // agree with the front; click opens the detail modal.
    RAIN_DISTRICTS.forEach(d => {
      const mm = rainMm(d, lead);
      if (mm == null) return;
      const color = rainColor(mm);
      L.circleMarker([d.lat, d.lon], { radius: 5, fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.95 })
        .bindTooltip(`${d.name} — ${mm.toFixed(1)} mm/h · ${rainBand(mm)} (SMHI forecast)`, { sticky: true })
        .on('click', () => openRainModal(d))
        .addTo(gHazard);
    });
  }

  /* ---- Rain situation hero — mirrors the air/algae hero, bespoke to rain ----
   * Tracks the slider: how many districts are at Moderate+ intensity at the
   * current lead, the peak rainfall window from the real series, and a verdict.
   * SMHI forecast (snow1g v1) — real NWP precipitation, never a measurement. */
  const RAIN_LEVEL_CLS = { Heavy: 'aq-level-vhigh', Moderate: 'aq-level-high', Light: 'aq-level-mod', None: 'aq-level-low' };

  // Area-aggregate mean amount (mm/h) per leadHour across all districts.
  function rainAggregate() {
    if (!rainForecast || !rainForecast.ok) return [];
    const leads = new Set();
    Object.values(rainForecast.byName).forEach(m => Object.keys(m).forEach(k => leads.add(+k)));
    return [...leads].sort((a, b) => a - b).map(lead => {
      const vals = RAIN_DISTRICTS.map(d => rainMm(d, lead)).filter(v => v != null);
      const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      return { lead, mean };
    });
  }
  // Contiguous run of hours where the area-aggregate sits at Moderate+ (>=2.5),
  // falling back to Light+ (>=0.1) if nothing reaches Moderate. null when dry.
  function rainPeakWindow() {
    const agg = rainAggregate();
    if (!agg.length) return null;
    const peak = agg.reduce((a, b) => (b.mean > a.mean ? b : a), agg[0]);
    if (peak.mean < 0.1) return null;
    const thr = peak.mean >= 2.5 ? 2.5 : 0.1;
    const byLead = {}; agg.forEach(a => { byLead[a.lead] = a.mean; });
    let s = peak.lead, e = peak.lead;
    while (byLead[s - 1] != null && byLead[s - 1] >= thr) s--;
    while (byLead[e + 1] != null && byLead[e + 1] >= thr) e++;
    return { startLead: s, endLead: e, band: thr >= 2.5 ? 'Moderate' : 'Light' };
  }

  function updateRainHero() {
    const hero = document.getElementById('rain-hero');
    if (!hero) return;
    const lvlEl = document.getElementById('rain-hero-level');
    const hdEl  = document.getElementById('rain-hero-headline');
    const bkEl  = document.getElementById('rain-hero-breakdown');
    const vdEl  = document.getElementById('rain-hero-verdict');

    if (!rainForecast || !rainForecast.ok) {
      const failed = rainForecast && rainForecast.ok === false;
      if (lvlEl) { lvlEl.textContent = '—'; lvlEl.className = 'aq-hero-level aq-level-low'; }
      if (hdEl) hdEl.textContent = failed ? 'Forecast unavailable' : 'Loading SMHI forecast…';
      if (bkEl) bkEl.innerHTML = '';
      if (vdEl) { vdEl.textContent = failed ? 'SMHI metfcst snow1g v1 did not respond.' : ''; vdEl.className = 'aq-hero-verdict'; }
      hero.style.display = 'flex';
      return;
    }

    const lead = currentLeadHour();
    const total = RAIN_DISTRICTS.length;
    const mms = RAIN_DISTRICTS.map(d => ({ name: d.name, mm: rainMm(d, lead) })).filter(x => x.mm != null);
    const heavy = mms.filter(x => x.mm >= 7.6);
    const moderate = mms.filter(x => x.mm >= 2.5 && x.mm < 7.6);
    const light = mms.filter(x => x.mm >= 0.1 && x.mm < 2.5);
    const modPlus = heavy.length + moderate.length;
    const peakMm = mms.reduce((m, x) => Math.max(m, x.mm), 0);
    const band = rainBand(peakMm) || 'None';
    const win = rainPeakWindow();

    if (lvlEl) { lvlEl.textContent = band; lvlEl.className = 'aq-hero-level ' + (RAIN_LEVEL_CLS[band] || 'aq-level-low'); }

    if (hdEl) {
      if (modPlus > 0 && win) {
        hdEl.textContent = `Moderate+ rain in ${modPlus} of ${total} districts, peak ${rainValidTime(win.startLead)} to ${rainValidTime(win.endLead)}`;
      } else if (light.length > 0) {
        hdEl.textContent = `Light rain in ${light.length} of ${total} districts`;
      } else {
        hdEl.textContent = `No significant rain across the ${total} districts`;
      }
    }

    if (bkEl) {
      const bands = [
        { label: 'Heavy',    color: '#1e3a8a', n: heavy.length },
        { label: 'Moderate', color: '#2563eb', n: moderate.length },
        { label: 'Light',    color: '#60a5fa', n: light.length },
      ];
      const parts = bands.filter(b => b.n > 0).map(b =>
        `<span class="aq-breakdown-item"><span class="aq-breakdown-dot" style="background:${b.color}"></span>${b.n} ${b.label}</span>`);
      parts.push(`<span class="aq-breakdown-item" style="color:var(--text-tertiary)">${total} districts · SMHI forecast</span>`);
      bkEl.innerHTML = parts.join('');
    }

    if (vdEl) {
      let verdict;
      if (modPlus > 0) {
        const names = heavy.concat(moderate).map(x => x.name);
        const shown = names.slice(0, 3).join(', ');
        verdict = `Advisory for ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.`;
      } else if (light.length > 0) {
        verdict = 'Monitor — light rain only. No advisory needed yet.';
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

  /* ---- Rain duration strip — district rain count across the forecast hours ---- */
  // Bar cell per leadHour (0..23), shaded by how many districts are at Light+.
  function rainStripBarHtml() {
    const counts = Array(24).fill(0);
    for (let lead = 0; lead < 24; lead++) {
      RAIN_DISTRICTS.forEach(d => { const mm = rainMm(d, lead); if (mm != null && mm >= 0.1) counts[lead]++; });
    }
    const maxC = Math.max(1, ...counts);
    const nowLead = currentLeadHour();
    return counts.map((c, lead) => {
      const cls = ['dur-hr'];
      if (c > 0) cls.push('on-rain');
      if (lead === nowLead) cls.push('dur-now');
      const style = c > 0 ? ` style="opacity:${(0.3 + (c / maxC) * 0.7).toFixed(2)}"` : '';
      return `<div class="${cls.join(' ')}"${style} title="+${lead}h · ${c} district${c !== 1 ? 's' : ''}"></div>`;
    }).join('');
  }

  function updateRainStrip() {
    const body = document.getElementById('rain-strip-body');
    const sub  = document.getElementById('rain-strip-sub');
    if (!body) return;

    if (!rainForecast || !rainForecast.ok) {
      if (sub) sub.textContent = rainForecast && rainForecast.ok === false
        ? 'Forecast unavailable · SMHI metfcst snow1g v1'
        : 'Loading SMHI forecast…';
      body.innerHTML = '';
      return;
    }

    const lead = currentLeadHour();
    const raining = RAIN_DISTRICTS.filter(d => { const mm = rainMm(d, lead); return mm != null && mm >= 0.1; }).length;
    const win = rainPeakWindow();
    const peakLabel = win
      ? `<strong>Peak:</strong> ${rainValidTime(win.startLead)} – ${rainValidTime(win.endLead)} · ${win.band}+`
      : 'No significant rain in the forecast window';
    if (sub) sub.textContent = `${raining} of ${RAIN_DISTRICTS.length} districts with rain · SMHI forecast ${rainValidTime(lead) || ''}`.trim();
    body.innerHTML =
      `<div class="dur-bar rain-strip-bar">${rainStripBarHtml()}</div>
       <div class="dur-ticks"><span>+0h</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+23h</span></div>
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
      const saved = officerGet('rain', d.id);
      _rainState[d.id] = saved
        ? { status: saved.status, audit: saved.audit.slice() }
        : { status: 'none', audit: [{ time: 'start of shift', text: 'Monitoring SMHI rainfall forecast. No advisory active.' }] };
    }
    return _rainState[d.id];
  }

  function rainSeverityClass(mm) {
    return mm >= 7.6 ? 'val-high' : mm >= 2.5 ? 'val-warn' : 'val-ok';
  }

  function rainRecommendation(d) {
    const mm = rainMm(d, currentLeadHour());
    if (mm == null) return `Forecast unavailable for ${d.name} at this hour.`;
    const band = rainBand(mm);
    if (band === 'Heavy') return `Heavy rain forecast for ${d.name} — ${mm.toFixed(1)} mm/h. Issue a rainfall advisory: warn of local flooding and surface water, and alert drainage and operations.`;
    if (band === 'Moderate') return `Moderate rain forecast for ${d.name} (${mm.toFixed(1)} mm/h). Consider a precautionary advisory and ready drainage crews.`;
    if (band === 'Light') return `Light rain forecast for ${d.name} (${mm.toFixed(1)} mm/h). No advisory needed yet; keep watching the SMHI forecast.`;
    return `No significant rain forecast for ${d.name} at this hour.`;
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

  // This district's forecast intensity across the next hours (mm/h per leadHour).
  function rainModalCurve(d, lead) {
    const s = rainSeries(d.name);
    if (!s) return '<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">Forecast unavailable</div>';
    const leads = Object.keys(s).map(Number).sort((a, b) => a - b);
    const maxMm = Math.max(0.1, ...leads.map(l => s[l].mmMean));
    const bars = Array.from({ length: 24 }, (_, l) => {
      const h = s[l];
      if (!h) return '<div class="dur-hr"></div>';
      const cls = ['dur-hr'];
      if (h.mmMean >= 0.1) cls.push('on-rain');
      if (l === lead) cls.push('dur-now');
      const style = h.mmMean >= 0.1 ? ` style="opacity:${(0.3 + (h.mmMean / maxMm) * 0.7).toFixed(2)}"` : '';
      return `<div class="${cls.join(' ')}"${style} title="+${l}h · ${h.mmMean.toFixed(1)} mm/h · ${h.band}"></div>`;
    }).join('');
    const wettest = leads.reduce((a, l) => (s[l].mmMean > s[a].mmMean ? l : a), leads[0]);
    const wmm = s[wettest].mmMean;
    const label = wmm >= 0.1
      ? `Wettest: ${rainValidTime(wettest)} · ${wmm.toFixed(1)} mm/h`
      : 'No significant rain over the forecast';
    return `<div class="rain-modal-dur-label">${label}</div>
       <div class="dur-bar rain-strip-bar">${bars}</div>
       <div class="dur-ticks"><span>+0h</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+23h</span></div>`;
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

    const lead = currentLeadHour();
    const h = rainAt(d, lead);
    const mm = h ? h.mmMean : null;
    const band = rainBand(mm);
    // Default render uses the mean amount only; min/max are kept in the payload
    // for a future uncertainty band (their snow1g semantics aren't a clean
    // bound around the mean, so they are not surfaced here).
    const metrics = [
      { label: 'Forecast amount',   value: mm != null ? `${mm.toFixed(1)} mm/h` : '—', cls: mm != null ? rainSeverityClass(mm) : '' },
      { label: 'Intensity',         value: band || '—', cls: '' },
      { label: 'Valid time',        value: rainValidTime(lead) || '—', cls: '' },
      { label: 'Forecast horizon',  value: `+${lead}h`, cls: '' },
    ];
    document.getElementById('rain-modal-metrics').innerHTML = metrics.map(m =>
      `<div class="algae-modal-obs-item">
        <div class="algae-modal-obs-label">${escapeHtml(m.label)}</div>
        <div class="algae-modal-obs-value ${m.cls}">${escapeHtml(m.value)}</div>
      </div>`
    ).join('');

    document.getElementById('rain-modal-note').textContent =
      `${band || '—'} · SMHI metfcst snow1g v1 forecast — not a measurement`;

    document.getElementById('rain-modal-duration').innerHTML = rainModalCurve(d, lead);

    document.getElementById('rain-modal-rec').textContent = rainRecommendation(d);
    renderRainAudit(d);
    renderRainStatusButtons(_rainPendingStatus);

    document.getElementById('rain-modal-message').value = '';
    document.getElementById('rain-modal-sent').style.display = 'none';

    document.getElementById('rain-modal').style.display = 'flex';
    openModalA11y('rain-modal', closeRainModal);
  }

  function closeRainModal() {
    document.getElementById('rain-modal').style.display = 'none';
    closeModalA11y();
    _rainModalDistrict = null;
    _rainPendingStatus = null;
  }

  function rainGenerateDraft() {
    if (!_rainModalDistrict) return;
    const d = _rainModalDistrict;
    const mm = rainMm(d, currentLeadHour());
    const amt = mm != null ? mm.toFixed(1) : '0';
    const s = _rainPendingStatus || rainStateFor(d).status;
    const templates = {
      advisory: `Stockholm stad informerar: Risk för kraftigt regn i ${d.name}, prognos upp till ${amt} mm/h enligt SMHI. Var beredd på lokala översvämningar och vatten på vägbanan. Undvik källarutrymmen vid skyfall.`,
      none:     `Stockholm stad informerar: Regn väntas i ${d.name} (prognos ${amt} mm/h enligt SMHI). Ingen varning råder för närvarande. Håll dig uppdaterad via stockholm.se.`,
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
    officerSet('rain', d.id, st.status, st.audit);

    renderRainAudit(d);
    document.getElementById('rain-modal-sent').style.display = 'block';
  }

  // Format an ISO model time as "HH:MM UTC YYYY-MM-DD" for status/provenance.
  function rainBaseLabel(iso) {
    if (!iso) return 'unknown';
    return `${iso.slice(11, 16)} UTC ${iso.slice(0, 10)}`;
  }

  async function loadRainForecast(haz) {
    setStatus('rain', 'pending', 'loading SMHI forecast…');
    try {
      const res = await fetch('/api/rain-forecast', { cache: 'no-cache' });
      const data = await res.json();
      if (currentHazard !== 'rain') return; // officer switched tabs mid-flight
      if (!data.ok) throw new Error(data.reason || 'unavailable');

      const byName = {};
      data.districts.forEach(dist => {
        const m = {};
        dist.hours.forEach(h => { m[h.leadHour] = h; });
        byName[dist.name] = m;
      });
      rainForecast = { ok: true, approvedTime: data.approvedTime, byName };

      const horizon = Math.max(0, ...Object.values(byName).flatMap(m => Object.keys(m).map(Number)));
      const base = rainBaseLabel(data.approvedTime);
      setStatus('rain', 'ok', `SMHI forecast +${horizon}h · base ${base}`);
      setProvenance(`Forecast: SMHI metfcst snow1g v1 (NWP precipitation, not measured). Model run ${base}.`, 'high', false);

      gHazard.clearLayers();
      updateRainHero();
      updateRainStrip();
      if (haz.draw) haz.draw();
    } catch (err) {
      if (currentHazard !== 'rain') return;
      rainForecast = { ok: false };
      gHazard.clearLayers();
      setStatus('rain', 'offline', 'forecast unavailable (' + err.message + ')');
      setProvenance('Forecast unavailable — SMHI metfcst snow1g v1 did not respond.', 'high', false);
      updateRainHero();
      updateRainStrip();
    }
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
    rainForecast = null; // reset to loading state
    showRainHero();
    showRainStrip();
    updateRainHero();  // shows "Loading SMHI forecast…"
    updateRainStrip();
    setLayerStatus([{ id: 'rain', label: haz.layers[0].label, state: 'pending', detail: 'loading SMHI forecast…' }]);
    setProvenance(haz.provenance, haz.confidence, false);
    loadRainForecast(haz);
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

    // The algae Site dropdown is built entirely from the live HaV response, so it
    // can never show stale hardcoded names. Empty until the first load resolves;
    // loadAlgaeStatus re-renders this panel once ALGAE_SITES is populated.
    if (currentHazard === 'algae') {
      const siteSel = document.getElementById('fld-site');
      if (siteSel) siteSel.innerHTML = ALGAE_SITES.map(s => `<option>${escapeHtml(s.name)}</option>`).join('');
    }

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
      note: haz.real
        ? (currentHazard === 'air' ? 'Live source-tagged readings.'
          : haz.confidence === 'observed' ? 'Source-tagged observed sampling — periodic, not live/real-time.'
          : haz.confidence === 'modelled' ? 'Live source-tagged modelled data (not measured).'
          : 'Live source-tagged forecast (not measured).')
        : 'PLACEHOLDER hazard — sample data, not a real measurement.',
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
        { key: 'integration', label: 'Integration layer', on: false, dot: '#534AB7' }
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
      sources: 'HaV Badplatser och badvatten API v2.3 (municipal sampling)',
      legend: { title: 'Bathing status (HaV)', items: [
        { c: '#9CA3AF', t: 'None' }, { c: '#FAC775', t: 'Watch' },
        { c: '#EF9F27', t: 'Advisory' }, { c: '#E24B4A', t: 'Closed' }
      ] },
      layers: [
        { key: 'hazard', label: 'Bloom status (HaV sampling)', on: true, dot: '#EF9F27' }
      ],
      fields: [
        { label: 'Site', kind: 'select', options: [] }, // populated from live ALGAE_SITES in renderDecisionPanel
        { label: 'Status', kind: 'select', options: ['None', 'Watch', 'Advisory', 'Closed'] },
        { label: 'Scope', kind: 'text', placeholder: 'this site only' },
        { label: 'Message', kind: 'textarea', placeholder: 'Notice text…' }
      ],
      buttons: ['Post', 'Lift'], confidence: 'observed', real: true,
      provenance: 'Observed: HaV Badplatser och badvatten API v2.3 — municipal sampling (periodic, seasonal). Not a live sensor and not a forecast.',
      draw: drawAlgae, activate: activateAlgae
    },
    fire: {
      eyebrow: 'Fire risk', verb: 'Declare or lift an open-burning ban',
      decisionTitle: 'Open-burning ban',
      sources: 'SMHI fwif1g v1 (Canadian FWI, modelled for MSB)',
      legend: { title: 'Fire-risk index (FWI)', items: [
        { c: '#1D9E75', t: 'Low' }, { c: '#FAC775', t: 'Moderate' },
        { c: '#EF9F27', t: 'High' }, { c: '#E24B4A', t: 'Extreme' }
      ], cue: 'Zone-level FWI model, not street-level.' },
      layers: [
        { key: 'hazard', label: 'Fire-risk index (SMHI FWI, modelled)', on: true, dot: '#EF9F27' }
      ],
      fields: [
        { label: 'Zone', kind: 'select', options: ['NW', 'NE', 'SW', 'SE'] },
        { label: 'Level', kind: 'select', options: ['Low', 'Moderate', 'High', 'Extreme'] },
        { label: 'Scope', kind: 'text', placeholder: 'by zone' },
        { label: 'Notice', kind: 'textarea', placeholder: 'Ban notice…' }
      ],
      buttons: ['Declare', 'Lift'], confidence: 'modelled', real: true,
      provenance: 'Modelled: SMHI fwif1g v1 (Canadian FWI), computed for MSB.',
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
        { key: 'vulnerable', label: 'Vulnerable sites', on: true, dot: '#A32D2D' }
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
      sources: 'SMHI metfcst snow1g v1 (forecast)',
      legend: {
        title: 'Rain · Intensity (mm/h)',
        items: [
          { c: '#bfdbfe', t: 'None (<0.1)' },
          { c: '#60a5fa', t: 'Light (0.1–2.5)' },
          { c: '#2563eb', t: 'Moderate (2.5–7.6)' },
          { c: '#1e3a8a', t: 'Heavy (7.6+)' }
        ]
      },
      layers: [
        { key: 'hazard', label: 'Rainfall (SMHI forecast)', on: true, dot: '#2563eb' }
      ],
      fields: [
        { label: 'Area', kind: 'draw' },
        { label: 'Level', kind: 'select', options: ['Watch', 'Advisory', 'Warning'] },
        { label: 'Affected districts', kind: 'text', placeholder: 'e.g. Södermalm, Vasastan' },
        { label: 'Message', kind: 'textarea', placeholder: 'Advisory text…' }
      ],
      buttons: ['Issue', 'Lift'],
      confidence: 'high',
      real: true,
      provenance: 'Forecast: SMHI metfcst snow1g v1 (NWP precipitation forecast, not measured).',
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
  const hhmm = h => String(h).padStart(2, '0') + ':00';

  // Top-right "Live" badge: a real wall clock, decoupled from the slider.
  // Set on load and refreshed every 60s; it shows "now", never the forecast.
  function startClock() {
    const clock = document.getElementById('shell-clock');
    if (!clock) return;
    const tick = () => {
      const d = new Date();
      clock.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    tick();
    setInterval(tick, 60000);
  }

  function initSlider() {
    const slider = document.getElementById('time-slider');
    const period = document.getElementById('slider-period');
    const baseLabel = document.getElementById('slider-base');
    if (!slider) return;
    // Anchor the slider to the actual hour at boot. Display-only: data is keyed
    // by lead index, not by this label, so the indexing is unchanged.
    const BASE_HOUR = new Date().getHours();
    if (baseLabel) baseLabel.textContent = hhmm(BASE_HOUR); // "now" anchor
    const update = () => {
      const lead = currentLeadHour();
      const t = (BASE_HOUR + lead) % 24; // forecast target hour
      if (period) period.textContent = (lead === 0 ? 'now' : `+${lead}h`) + ` · ${hhmm(t)}`;
    };
    let debounce;
    slider.addEventListener('input', () => {
      update();
      if (currentHazard === 'air') {
        updateAirForecastLabel(currentLeadHour());
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
    officerLoad();
    // Fire zones are a static array; merge any persisted officer decisions on top.
    FIRE_ZONES.forEach(z => {
      const saved = officerGet('fire', z.id);
      if (saved) { z.status = saved.status; z.audit = saved.audit.slice(); }
    });
    officerStoreNote();
    initMap();
    initSlider();
    startClock();
    document.getElementById('export-report').addEventListener('click', exportReport);
    document.getElementById('clear-shift').addEventListener('click', clearShiftHistory);
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
