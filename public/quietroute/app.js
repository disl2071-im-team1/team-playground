(function () {
  'use strict';

  /* --------------------------------------------------------
   * Route data: Stockholm, Slussen → Odenplan
   * ------------------------------------------------------ */

  const ROUTES = {
    fast: {
      name: 'Fastest via Sveavägen',
      color: '#E24B4A',
      weight: 4,
      coords: [
        [59.3196, 18.0718], // Slussen
        [59.3240, 18.0710], // Gamla Stan north
        [59.3264, 18.0674], // Norrbro bridge
        [59.3284, 18.0655], // Norrmalmstorg
        [59.3318, 18.0636], // Hötorget  ← 82 dB zone
        [59.3355, 18.0576], // Sveavägen mid
        [59.3388, 18.0528], // Sveavägen north
        [59.3419, 18.0488]  // Odenplan
      ],
      times: { cycling: '22 min', walking: '52 min' },
      db: 76
    },
    clean: {
      name: 'Cleanest via Kungsholmen',
      color: '#0F6E56',
      weight: 4,
      coords: [
        [59.3196, 18.0718], // Slussen
        [59.3218, 18.0640], // Södermalm west
        [59.3250, 18.0540], // Kungsholmsbron approach
        [59.3278, 18.0487], // Kungsholmen south
        [59.3325, 18.0475], // Kungsholmen central
        [59.3370, 18.0480], // Kungsholmen north
        [59.3402, 18.0483], // Towards Odenplan
        [59.3419, 18.0488]  // Odenplan
      ],
      times: { cycling: '27 min · +5', walking: '64 min · +12' },
      db: 65
    },
    quiet: {
      name: 'Quietest via Kungsträdgården',
      color: '#1B6FDB',
      weight: 5,
      coords: [
        [59.3196, 18.0718], // Slussen
        [59.3220, 18.0765], // Skeppsbron
        [59.3258, 18.0760], // Toward Nationalmuseum
        [59.3295, 18.0722], // Kungsträdgården south (park)
        [59.3328, 18.0702], // Kungsträdgården north (park)
        [59.3356, 18.0660], // Birger Jarlsgatan
        [59.3390, 18.0572], // Approaching Odenplan
        [59.3419, 18.0488]  // Odenplan
      ],
      times: { cycling: '30 min · +8', walking: '70 min · +18' },
      db: 55
    }
  };

  /* --------------------------------------------------------
   * Mock noise zones (Bullerkartan data)
   * ------------------------------------------------------ */

  const NOISE_ZONES = [
    // High noise (>80 dB) — red
    { latlng: [59.3318, 18.0636], radius: 180, db: 82, label: 'Sveavägen / Hötorget', color: '#E24B4A' },
    { latlng: [59.3196, 18.0718], radius: 150, db: 80, label: 'Slussen junction', color: '#E24B4A' },
    // High but below threshold (75–80 dB) — orange
    { latlng: [59.3264, 18.0674], radius: 120, db: 78, label: 'Norrbro', color: '#E86835' },
    { latlng: [59.3284, 18.0655], radius: 110, db: 76, label: 'Norrmalmstorg', color: '#E86835' },
    { latlng: [59.3355, 18.0576], radius: 130, db: 75, label: 'Sveavägen mid', color: '#E86835' },
    // Moderate (65–75 dB) — amber
    { latlng: [59.3250, 18.0540], radius: 100, db: 70, label: 'Kungsholmsbron', color: '#EF9F27' },
    { latlng: [59.3356, 18.0660], radius: 100, db: 68, label: 'Birger Jarlsgatan', color: '#EF9F27' },
    // Low (55–65 dB) — yellow-green
    { latlng: [59.3295, 18.0722], radius: 140, db: 58, label: 'Kungsträdgården', color: '#97C459' },
    { latlng: [59.3328, 18.0702], radius: 130, db: 56, label: 'Kungsträdgården north', color: '#97C459' },
    { latlng: [59.3325, 18.0475], radius: 110, db: 62, label: 'Kungsholmen residential', color: '#97C459' },
    // Very quiet (<55 dB) — green
    { latlng: [59.3220, 18.0765], radius: 100, db: 50, label: 'Skeppsbron waterfront', color: '#1D9E75' },
    { latlng: [59.3370, 18.0480], radius: 100, db: 52, label: 'Kungsholmen park', color: '#1D9E75' }
  ];

  /* --------------------------------------------------------
   * State
   * ------------------------------------------------------ */

  let selectedRoute = 'quiet';
  let currentMode = 'cycling';
  let leafletMap;
  let polylines = {};
  let noiseLayer;

  /* --------------------------------------------------------
   * Tabs
   * ------------------------------------------------------ */

  const tabEls = document.querySelectorAll('.tab');
  const screenEls = document.querySelectorAll('.screen');

  tabEls.forEach(t => {
    t.addEventListener('click', () => {
      tabEls.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
      screenEls.forEach(s => s.classList.remove('active'));
      t.classList.add('active');
      t.setAttribute('aria-selected', 'true');
      document.getElementById('screen-' + t.dataset.screen).classList.add('active');
      if (t.dataset.screen === 'map' && leafletMap) {
        setTimeout(() => leafletMap.invalidateSize(), 50);
      }
    });
  });

  /* --------------------------------------------------------
   * Map
   * ------------------------------------------------------ */

  function dbToColor(db) {
    if (db >= 80) return '#E24B4A';
    if (db >= 75) return '#E86835';
    if (db >= 65) return '#EF9F27';
    if (db >= 55) return '#97C459';
    return '#1D9E75';
  }

  function initMap() {
    if (typeof L === 'undefined') { setTimeout(initMap, 50); return; }

    leafletMap = L.map('leaflet-map', { zoomControl: true, attributionControl: true })
      .setView([59.3310, 18.0600], 13);

    window._leafletMap = leafletMap;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(leafletMap);

    // Noise zones
    noiseLayer = L.layerGroup().addTo(leafletMap);
    NOISE_ZONES.forEach(z => {
      L.circle(z.latlng, {
        radius: z.radius,
        color: 'transparent',
        fillColor: z.color,
        fillOpacity: 0.22,
        interactive: true
      }).bindTooltip(`<strong>${z.label}</strong><br>${z.db} dB`, { sticky: true }).addTo(noiseLayer);
    });

    // 80 dB warning ring on Hötorget zone
    L.circle([59.3318, 18.0636], {
      radius: 200,
      color: '#E24B4A',
      weight: 1.5,
      fillOpacity: 0,
      dashArray: '4 4',
      interactive: false
    }).addTo(leafletMap);

    // Routes — draw in order: quiet last so blue is on top
    ['fast', 'clean', 'quiet'].forEach(key => {
      const r = ROUTES[key];
      const pl = L.polyline(r.coords, {
        color: r.color,
        weight: key === selectedRoute ? r.weight + 1 : r.weight - 1,
        opacity: key === selectedRoute ? 1 : 0.45,
        lineCap: 'round',
        lineJoin: 'round'
      }).bindTooltip(r.name, { sticky: true }).addTo(leafletMap);
      polylines[key] = pl;
    });

    // Terminal markers
    const start = ROUTES.fast.coords[0];
    const end = ROUTES.fast.coords[ROUTES.fast.coords.length - 1];
    L.circleMarker(start, { radius: 7, fillColor: '#FFFFFF', color: '#2C2C2A', weight: 2, fillOpacity: 1 })
      .bindTooltip('Slussen', { permanent: true, direction: 'left', offset: [-8, 0], className: 'route-end-label' })
      .addTo(leafletMap);
    L.circleMarker(end, { radius: 7, fillColor: '#2C2C2A', color: '#2C2C2A', weight: 2, fillOpacity: 1 })
      .bindTooltip('Odenplan', { permanent: true, direction: 'right', offset: [8, 0], className: 'route-end-label' })
      .addTo(leafletMap);

    // Legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <strong>Noise level (Bullerkartan)</strong>
        <div><span class="swatch" style="background:#E24B4A"></span>&gt;80 dB · Alert threshold</div>
        <div><span class="swatch" style="background:#E86835"></span>75–80 dB · Very loud</div>
        <div><span class="swatch" style="background:#EF9F27"></span>65–75 dB · Loud</div>
        <div><span class="swatch" style="background:#97C459"></span>55–65 dB · Moderate</div>
        <div><span class="swatch" style="background:#1D9E75"></span>&lt;55 dB · Quiet</div>
        <strong style="margin-top:6px">Routes</strong>
        <div><span class="line" style="background:#E24B4A"></span>Fastest</div>
        <div><span class="line" style="background:#0F6E56"></span>Cleanest</div>
        <div><span class="line" style="background:#1B6FDB"></span>Quietest</div>
      `;
      return div;
    };
    legend.addTo(leafletMap);
  }

  function updatePolylines() {
    Object.entries(polylines).forEach(([key, pl]) => {
      const isSelected = key === selectedRoute;
      pl.setStyle({
        weight: isSelected ? ROUTES[key].weight + 1 : ROUTES[key].weight - 1,
        opacity: isSelected ? 1 : 0.45
      });
      if (isSelected) pl.bringToFront();
    });
  }

  /* --------------------------------------------------------
   * Route card selection
   * ------------------------------------------------------ */

  const routeCards = document.querySelectorAll('.route-card');

  routeCards.forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.route;
      if (!key) return;
      selectedRoute = key;
      routeCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updatePolylines();
    });
  });

  /* --------------------------------------------------------
   * Transport mode toggle
   * ------------------------------------------------------ */

  const modeBtns = document.querySelectorAll('.mode-btn');

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
      updateTimes();
    });
  });

  function updateTimes() {
    document.getElementById('fast-time').textContent = ROUTES.fast.times[currentMode];
    document.getElementById('clean-time').textContent = ROUTES.clean.times[currentMode];
    document.getElementById('quiet-time').textContent = ROUTES.quiet.times[currentMode];
  }

  /* --------------------------------------------------------
   * Noise reduction % (dynamic)
   * ------------------------------------------------------ */

  function calcReduction() {
    const ref = (ROUTES.fast.db + ROUTES.clean.db) / 2;
    return Math.round(((ref - ROUTES.quiet.db) / ref) * 100);
  }

  function updateReduction() {
    const pct = calcReduction();
    const badge = document.getElementById('reduction-badge');
    const advice = document.getElementById('advice');
    if (badge) badge.textContent = pct + '% quieter';
    if (advice) {
      advice.textContent = `The quietest route reduces your decibel exposure by ${pct}% compared to other routes. Enjoy the peace and quiet.`;
    }
  }

  /* --------------------------------------------------------
   * Live dB simulation (fake-live reading)
   * ------------------------------------------------------ */

  function simulateLiveDb() {
    const base = 68;
    const el = document.getElementById('live-db');
    const dot = document.getElementById('live-dot');
    if (!el) return;
    setInterval(() => {
      const v = base + Math.floor((Math.random() - 0.5) * 8);
      el.textContent = v;
      dot.style.background = dbToColor(v);
    }, 2800);
  }

  /* --------------------------------------------------------
   * 80 dB Alert overlay
   * ------------------------------------------------------ */

  const overlay = document.getElementById('alert-overlay');
  const demoBtn = document.getElementById('demo-alert-btn');
  const dismissBtn = document.getElementById('alert-dismiss');
  const rerouteOptions = document.querySelectorAll('.reroute-option');

  function openAlert() {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    dismissBtn.focus();
  }

  function closeAlert(chosenRoute) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (chosenRoute) {
      selectedRoute = chosenRoute;
      routeCards.forEach(c => c.classList.remove('selected'));
      const target = document.getElementById('route-' + chosenRoute);
      if (target) target.classList.add('selected');
      updatePolylines();
    }
  }

  if (demoBtn) demoBtn.addEventListener('click', openAlert);
  if (dismissBtn) dismissBtn.addEventListener('click', () => closeAlert(null));

  rerouteOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const reroute = opt.dataset.reroute;
      // Map reroute choice back to a route key
      const routeMap = { a: 'quiet', b: 'clean', c: 'fast' };
      closeAlert(routeMap[reroute] || 'quiet');
    });
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (overlay.classList.contains('open')) closeAlert(null);
      if (modal.classList.contains('open')) closeModal();
    }
  });

  /* --------------------------------------------------------
   * Settings: warning lead distance
   * ------------------------------------------------------ */

  const leadInputs = document.querySelectorAll('input[name="lead"]');

  function loadSettings() {
    const saved = localStorage.getItem('qr-lead-distance') || '100';
    leadInputs.forEach(inp => {
      inp.checked = inp.value === saved;
    });
  }

  leadInputs.forEach(inp => {
    inp.addEventListener('change', () => {
      localStorage.setItem('qr-lead-distance', inp.value);
    });
  });

  /* --------------------------------------------------------
   * Modal
   * ------------------------------------------------------ */

  const modal = document.getElementById('modal');
  const modalEyebrow = document.getElementById('modal-eyebrow');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  function openModal(key) {
    const item = INFO[key];
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

  const INFO = {
    fast: {
      eyebrow: 'Route detail',
      title: 'Fastest route via Sveavägen',
      body: `<p>Sveavägen is central Stockholm's main north-south artery. It's the fastest line between Slussen and Odenplan, but it carries continuous bus and car traffic which pushes average noise levels to around 76 dB — with peaks above 80 dB near the Hötorget intersection.</p>
             <p>The dB values shown are modelled from Bullerkartan 2022 data, weighted equally across road, rail, and air traffic sources.</p>`
    },
    clean: {
      eyebrow: 'Route detail',
      title: 'Cleanest route via Kungsholmen',
      body: `<p>This route crosses west over Kungsholmsbron, loops through Kungsholmen island, and approaches Odenplan from the west. The island's residential streets and lower traffic volumes drop average noise to around 65 dB.</p>
             <p>Five extra minutes of cycling, but significantly less noise than the Sveavägen corridor. Air quality is also better, away from the main bus lanes.</p>`
    },
    quiet: {
      eyebrow: 'Route detail',
      title: 'Quietest route via Kungsträdgården',
      body: `<p>This route swings east past Skeppsbron, cuts through Kungsträdgården park, and approaches Odenplan via Birger Jarlsgatan. The park section brings noise down to around 50–55 dB — close to what WHO considers acceptable for residential areas.</p>
             <p>Eight extra minutes, but the quietest 30 minutes available on this corridor. No 80 dB zones on this path.</p>`
    }
  };

  document.querySelectorAll('[data-info]').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.info));
  });

  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });

  /* --------------------------------------------------------
   * Boot
   * ------------------------------------------------------ */

  function boot() {
    initMap();
    updateTimes();
    updateReduction();
    loadSettings();
    simulateLiveDb();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
