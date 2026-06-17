/* ===========================================================
   Värmevakt — municipal heat planning, inlined as Clean Path's
   Heat tab. Vanilla JS, reuses the Leaflet already loaded by
   Clean Path. All element ids are prefixed "vv-" and triggers
   use data-vv-* so nothing collides with Clean Path.
   Forecast data is demo data, shaped like SMHI output.
   =========================================================== */
(function () {
  "use strict";

  /* SMHI värmebölja: max temp >= 25.0 C for 3+ consecutive days. */
  const THRESHOLD = 25;
  const MIN_RUN = 3;

  /* 7-day forecast, anchored to "today" = Wed 17 Jun 2026.
     highC = municipality-wide daily max used for the warning. */
  const FORECAST = [
    { dow: "Wed", date: "17 Jun", highC: 21 },
    { dow: "Thu", date: "18 Jun", highC: 23 },
    { dow: "Fri", date: "19 Jun", highC: 26 },
    { dow: "Sat", date: "20 Jun", highC: 29 },
    { dow: "Sun", date: "21 Jun", highC: 31 },
    { dow: "Mon", date: "22 Jun", highC: 27 },
    { dow: "Tue", date: "23 Jun", highC: 24 },
  ];
  const TODAY_IDX = 0;

  /* Districts: urban heat-island offset vs the municipality high. */
  const DISTRICTS = [
    { id: "norrmalm",    name: "Norrmalm",    lat: 59.337, lon: 18.058, offset: +1.6 },
    { id: "sodermalm",   name: "Södermalm",   lat: 59.314, lon: 18.072, offset: +1.1 },
    { id: "ostermalm",   name: "Östermalm",   lat: 59.337, lon: 18.085, offset: +0.6 },
    { id: "vasastan",    name: "Vasastan",    lat: 59.346, lon: 18.045, offset: +0.5 },
    { id: "kungsholmen", name: "Kungsholmen", lat: 59.330, lon: 18.030, offset: -0.2 },
    { id: "skarholmen",  name: "Skärholmen",  lat: 59.277, lon: 17.907, offset: -0.6 },
    { id: "alvsjo",      name: "Älvsjö",      lat: 59.278, lon: 18.010, offset: -1.1 },
  ];

  /* Vulnerable facilities. */
  const FACILITIES = [
    { name: "Solgården äldreboende", type: "care", district: "norrmalm", lat: 59.339, lon: 18.061 },
    { name: "Klara vård- och omsorg", type: "care", district: "norrmalm", lat: 59.333, lon: 18.054 },
    { name: "Förskolan Myran", type: "preschool", district: "norrmalm", lat: 59.341, lon: 18.050 },
    { name: "Söder äldrecentrum", type: "care", district: "sodermalm", lat: 59.312, lon: 18.078 },
    { name: "Vintertullens äldreboende", type: "care", district: "sodermalm", lat: 59.305, lon: 18.090 },
    { name: "Förskolan Sjöhästen", type: "preschool", district: "sodermalm", lat: 59.318, lon: 18.065 },
    { name: "Förskolan Bullerbyn", type: "preschool", district: "sodermalm", lat: 59.310, lon: 18.058 },
    { name: "Östermalms servicehus", type: "care", district: "ostermalm", lat: 59.340, lon: 18.090 },
    { name: "Förskolan Ekorren", type: "preschool", district: "ostermalm", lat: 59.334, lon: 18.082 },
    { name: "Vasa äldreboende", type: "care", district: "vasastan", lat: 59.348, lon: 18.042 },
    { name: "Förskolan Tuppen", type: "preschool", district: "vasastan", lat: 59.343, lon: 18.049 },
    { name: "Kungsholmens servicehus", type: "care", district: "kungsholmen", lat: 59.331, lon: 18.028 },
    { name: "Förskolan Pärlan", type: "preschool", district: "kungsholmen", lat: 59.329, lon: 18.035 },
    { name: "Skärholmens äldreboende", type: "care", district: "skarholmen", lat: 59.278, lon: 17.905 },
    { name: "Vårbergs äldrecentrum", type: "care", district: "skarholmen", lat: 59.275, lon: 17.892 },
    { name: "Förskolan Galaxen", type: "preschool", district: "skarholmen", lat: 59.280, lon: 17.912 },
    { name: "Förskolan Solrosen", type: "preschool", district: "skarholmen", lat: 59.273, lon: 17.918 },
    { name: "Älvsjö äldreboende", type: "care", district: "alvsjo", lat: 59.279, lon: 18.008 },
    { name: "Förskolan Linden", type: "preschool", district: "alvsjo", lat: 59.276, lon: 18.014 },
  ];

  /* Heat colour scale (80's sunset). */
  function heatColor(t) {
    if (t >= 29) return "#F72585";
    if (t >= 27) return "#FF4D6D";
    if (t >= 25) return "#FF8E2B";
    if (t >= 23) return "#FFD23F";
    if (t >= 21) return "#2EC4B6";
    return "#00C2CB";
  }
  function heatBand(t) {
    if (t >= 29) return "Extreme";
    if (t >= 27) return "Very hot";
    if (t >= 25) return "Heatwave";
    if (t >= 23) return "Warm";
    if (t >= 21) return "Mild";
    return "Cool";
  }

  /* Derived forecast facts. */
  function analyseForecast() {
    let best = { start: -1, len: 0 };
    let runStart = -1, runLen = 0;
    FORECAST.forEach((d, i) => {
      if (d.highC >= THRESHOLD) {
        if (runStart === -1) runStart = i;
        runLen++;
        if (runLen > best.len) best = { start: runStart, len: runLen };
      } else {
        runStart = -1; runLen = 0;
      }
    });
    const active = best.len >= MIN_RUN;
    let peakIdx = 0;
    FORECAST.forEach((d, i) => { if (d.highC > FORECAST[peakIdx].highC) peakIdx = i; });
    const actByIdx = active ? Math.max(0, best.start - 1) : -1;
    return { active, runStart: best.start, runLen: best.len, peakIdx, actByIdx };
  }

  const F = analyseForecast();
  let selectedIdx = F.active ? F.peakIdx : TODAY_IDX;

  const $ = (id) => document.getElementById(id);
  const districtTemp = (d, idx) => Math.round((FORECAST[idx].highC + d.offset) * 10) / 10;
  const facsIn = (id) => FACILITIES.filter((f) => f.district === id);
  const careCount = (id) => facsIn(id).filter((f) => f.type === "care").length;
  const preCount = (id) => facsIn(id).filter((f) => f.type === "preschool").length;

  function priorities(idx) {
    const scored = DISTRICTS.map((d) => {
      const temp = districtTemp(d, idx);
      const tempNorm = Math.max(0, Math.min(1, (temp - 20) / (33 - 20)));
      const vuln = careCount(d.id) * 2 + preCount(d.id);
      return { d, temp, raw: tempNorm * vuln };
    });
    const max = Math.max(...scored.map((s) => s.raw)) || 1;
    return scored
      .map((s) => ({ ...s, score: Math.round((s.raw / max) * 100) }))
      .sort((a, b) => b.score - a.score);
  }

  /* ---- Map (lazy) ---- */
  let map = null, heatLayer = null, careLayer = null, preLayer = null;
  const visible = { heat: true, care: true, preschool: true };

  function initMap() {
    map = L.map("vv-map", { scrollWheelZoom: false }).setView([59.315, 18.02], 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);
    heatLayer = L.layerGroup().addTo(map);
    careLayer = L.layerGroup().addTo(map);
    preLayer = L.layerGroup().addTo(map);
    drawFacilities();
    drawHeat();
  }

  function drawHeat() {
    if (!heatLayer) return;
    heatLayer.clearLayers();
    DISTRICTS.forEach((d) => {
      const t = districtTemp(d, selectedIdx);
      const c = L.circleMarker([d.lat, d.lon], {
        radius: 26,
        fillColor: heatColor(t),
        fillOpacity: 0.6,
        color: "#221C46",
        weight: 2,
      }).bindPopup(
        `<div class="popup-title">${d.name}</div>
         <div class="popup-row"><span>${heatBand(t)}</span><span class="popup-temp">${t}°C</span></div>
         <div class="popup-row"><span>Care homes</span><span>${careCount(d.id)}</span></div>
         <div class="popup-row"><span>Preschools</span><span>${preCount(d.id)}</span></div>`
      );
      c._district = d.id;
      heatLayer.addLayer(c);
    });
  }

  function drawFacilities() {
    FACILITIES.forEach((f) => {
      const isCare = f.type === "care";
      const icon = L.divIcon({
        className: "",
        html: `<div class="fac-marker ${isCare ? "fac-care" : "fac-preschool"}">${isCare ? "🏡" : "🧸"}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const m = L.marker([f.lat, f.lon], { icon }).bindPopup(
        `<div class="popup-title">${f.name}</div>
         <div class="popup-row"><span>${isCare ? "Care home" : "Preschool"}</span></div>`
      );
      (isCare ? careLayer : preLayer).addLayer(m);
    });
  }

  function flyToDistrict(id) {
    if (!map) return;
    const d = DISTRICTS.find((x) => x.id === id);
    if (!d) return;
    map.flyTo([d.lat, d.lon], 13, { duration: 0.6 });
    heatLayer.eachLayer((l) => { if (l._district === id) l.openPopup(); });
  }

  /* ---- Trigger banner ---- */
  function renderBanner() {
    const banner = $("vv-trigger-banner");
    const title = $("vv-trigger-title");
    const detail = $("vv-trigger-detail");
    const actby = $("vv-trigger-actby");
    const eyebrow = $("vv-trigger-eyebrow");

    if (F.active) {
      const start = FORECAST[F.runStart];
      const peak = FORECAST[F.peakIdx];
      eyebrow.textContent = "SMHI värmebölja warning";
      title.textContent = "Activate the heat plan";
      detail.textContent = `${F.runLen} days at or above ${THRESHOLD}°C from ${start.dow} ${start.date} · peak ${peak.dow} ${peak.date} at ${peak.highC}°C.`;
      const ab = FORECAST[F.actByIdx];
      const daysToPeak = F.peakIdx - TODAY_IDX;
      actby.innerHTML =
        `<div class="actby-label">Act by</div>
         <div class="actby-day">${ab.dow} ${ab.date}</div>
         <div class="actby-sub">${daysToPeak} days to peak</div>`;
    } else {
      banner.classList.add("calm");
      eyebrow.textContent = "Forecast";
      title.textContent = "No heatwave in the 7-day outlook";
      detail.textContent = "Nothing crosses the värmebölja threshold for 3 days running.";
      actby.style.display = "none";
    }
  }

  /* ---- Slider (replaces the day-chip timeline) ---- */
  function renderSlider() {
    const slider = $("vv-slider");
    slider.value = selectedIdx;
    slider.addEventListener("input", () => selectDay(+slider.value));

    const ticks = $("vv-slider-ticks");
    ticks.innerHTML = FORECAST.map((d, i) => {
      let cls = "vv-tick";
      if (i === F.peakIdx) cls += " is-peak";
      else if (i === F.actByIdx) cls += " is-actby";
      else if (i === TODAY_IDX) cls += " is-today";
      return `<button class="${cls}" data-idx="${i}" type="button">${d.dow}</button>`;
    }).join("");
    ticks.addEventListener("click", (e) => {
      const b = e.target.closest("[data-idx]");
      if (b) selectDay(+b.dataset.idx);
    });
  }

  function updateSlider() {
    const d = FORECAST[selectedIdx];
    $("vv-slider").value = selectedIdx;
    $("vv-slider-day").textContent = `${d.dow} ${d.date}`;
    const tEl = $("vv-slider-temp");
    tEl.textContent = `${d.highC}°`;
    tEl.style.color = heatColor(d.highC);

    const tag = $("vv-slider-tag");
    if (selectedIdx === F.peakIdx) { tag.className = "dc-tag tag-peak"; tag.textContent = "Peak"; }
    else if (selectedIdx === F.actByIdx) { tag.className = "dc-tag tag-actby"; tag.textContent = "Act by"; }
    else if (selectedIdx === TODAY_IDX) { tag.className = "dc-tag tag-today"; tag.textContent = "Today"; }
    else { tag.className = "dc-tag-empty"; tag.textContent = ""; }

    $("vv-slider-ticks").querySelectorAll("[data-idx]").forEach((b) => {
      b.classList.toggle("active", +b.dataset.idx === selectedIdx);
    });
  }

  function selectDay(i) {
    selectedIdx = i;
    $("vv-map-day-label").textContent = `${FORECAST[i].dow} ${FORECAST[i].date}`;
    $("vv-priority-day").textContent =
      i === F.peakIdx ? "on the peak day" : `on ${FORECAST[i].dow} ${FORECAST[i].date}`;
    drawHeat();
    updateSlider();
    renderPriorities();
  }

  /* ---- Priority list ---- */
  function renderPriorities() {
    const list = $("vv-priority-list");
    list.innerHTML = "";
    priorities(selectedIdx).forEach((p, idx) => {
      const li = document.createElement("li");
      li.className = "priority-item";
      li.innerHTML =
        `<span class="prio-rank">${idx + 1}</span>
         <div class="prio-mid">
           <div class="prio-name">${p.d.name}</div>
           <div class="prio-fac">${careCount(p.d.id)} care · ${preCount(p.d.id)} preschool</div>
           <div class="prio-bar-track"><div class="prio-bar" style="width:${p.score}%;background:${heatColor(p.temp)}"></div></div>
         </div>
         <div class="prio-right">
           <div class="prio-temp">${p.temp}°</div>
           <div class="prio-band" style="color:${heatColor(p.temp)}">${heatBand(p.temp)}</div>
         </div>`;
      li.addEventListener("click", () => flyToDistrict(p.d.id));
      list.appendChild(li);
    });
  }

  /* ---- Legend (shown in the Info pop-up) ---- */
  function legendBody() {
    const steps = [
      { c: "#00C2CB", l: "<21" },
      { c: "#2EC4B6", l: "21" },
      { c: "#FFD23F", l: "23" },
      { c: "#FF8E2B", l: "25" },
      { c: "#FF4D6D", l: "27" },
      { c: "#F72585", l: "29+" },
    ];
    const scale = steps
      .map((s) => `<div class="hl-step"><div class="hl-swatch" style="background:${s.c}"></div><div class="hl-label">${s.l}°</div></div>`)
      .join("");
    return `
      <p>Districts are coloured by forecast daily-max temperature.</p>
      <div class="heat-legend">${scale}</div>
      <div class="fac-legend">
        <span class="fac-key"><span class="fac-dot fac-care">🏡</span> Care home</span>
        <span class="fac-key"><span class="fac-dot fac-preschool">🧸</span> Preschool</span>
      </div>
      <p>Temperature is <strong>measured</strong> at SMHI stations, so this is the layer you can lean on. The algae and wildfire layers are <strong>modelled</strong>, inferred rather than observed, and stay off until that is built.</p>`;
  }

  /* ---- Layer toggles ---- */
  function wireLayers() {
    $("vv-layer-row").addEventListener("click", (e) => {
      const btn = e.target.closest(".layer-toggle");
      if (!btn || btn.disabled) return;
      const key = btn.dataset.layer;
      if (!(key in visible)) return;
      visible[key] = !visible[key];
      btn.classList.toggle("on", visible[key]);
      btn.classList.toggle("off", !visible[key]);
      const layer = key === "heat" ? heatLayer : key === "care" ? careLayer : preLayer;
      if (!layer) return;
      if (visible[key]) layer.addTo(map); else map.removeLayer(layer);
    });
  }

  /* ---- Modal ---- */
  const MODALS = {
    demo: {
      eyebrow: "About the data",
      title: "This is a demo forecast",
      body: `<p>The temperatures here are demo data, shaped like what SMHI publishes. There are no live API calls in this prototype.</p>
             <p>In production, Värmevakt reads measured temperature from SMHI stations and forecasts on the same grid the warnings use.</p>`,
    },
    legend: {
      eyebrow: "Map legend",
      title: "How to read the map",
      body: legendBody(),
    },
  };
  function openModal(key) {
    const m = MODALS[key];
    if (!m) return;
    $("vv-modal-eyebrow").textContent = m.eyebrow;
    $("vv-modal-title").textContent = m.title;
    $("vv-modal-body").innerHTML = m.body;
    $("vv-modal").classList.add("open");
  }
  function wireModal() {
    const root = $("vv-root");
    root.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-vv-info]");
      if (trigger) { openModal(trigger.getAttribute("data-vv-info")); return; }
      if (e.target.closest("[data-vv-close]")) $("vv-modal").classList.remove("open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") $("vv-modal").classList.remove("open");
    });
  }

  /* ---- Boot: render everything that doesn't need the map now,
          lazy-init the Leaflet map when the Heat tab is first shown. ---- */
  function boot() {
    if (!$("vv-root")) return;
    renderBanner();
    renderSlider();
    wireLayers();
    wireModal();
    selectDay(selectedIdx); // labels + slider + priorities; drawHeat no-ops until map exists

    const heatTab = document.querySelector('.tab[data-screen="heat"]');
    if (!heatTab) return;
    let started = false;
    heatTab.addEventListener("click", () => {
      // wait for the tab to become visible, then size the map correctly
      setTimeout(() => {
        if (!started) { initMap(); started = true; }
        if (map) map.invalidateSize();
      }, 60);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
