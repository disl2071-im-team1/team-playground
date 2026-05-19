(function () {
  'use strict';

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

  const periods = {
    night:     { label: 'Night · low',       advice: 'Air is at its cleanest. Both routes are safe, take the fastest via Bishopsgate.',                              cs: 12, fs: 18 },
    morning:   { label: 'Rush hour',         advice: 'Bishopsgate is peaking. The Cut adds 5 min and cuts exposure by 60%.',                                          cs: 34, fs: 81 },
    midday:    { label: 'Midday · easing',   advice: 'Pollution dropping as traffic thins. The Cut still helps but the gap is smaller.',                              cs: 28, fs: 58 },
    afternoon: { label: 'Afternoon',         advice: 'The cleanest route avoids the Bishopsgate traffic peak and cuts your exposure by more than half. Worth the extra 5 minutes.', cs: 31, fs: 72 },
    evening:   { label: 'Evening rush',      advice: 'Second peak. Avoid Holborn Viaduct and Bishopsgate. The Cut strongly recommended.',                             cs: 38, fs: 84 },
    late:      { label: 'Late · clearing',   advice: 'Wind has shifted, air is clearing. The difference between routes is small now.',                                cs: 19, fs: 32 }
  };

  function bucket(h) {
    if (h < 6) return 'night';
    if (h < 10) return 'morning';
    if (h < 14) return 'midday';
    if (h < 17) return 'afternoon';
    if (h < 20) return 'evening';
    return 'late';
  }

  function updateSlider() {
    const h = parseInt(slider.value, 10);
    const hh = String(h).padStart(2, '0') + ':00';
    sliderTime.textContent = hh;
    timeLabel.textContent = hh;
    const p = periods[bucket(h)];
    periodLabel.textContent = p.label;
    advice.textContent = p.advice;
    rfScore.textContent = Math.round(p.fs);
    rcScore.textContent = Math.round(p.cs);
    rfBar.style.width = Math.round(p.fs) + '%';
    rcBar.style.width = Math.round(p.cs) + '%';
  }

  slider.addEventListener('input', updateSlider);
  updateSlider();

  const modal = document.getElementById('modal');
  const modalEyebrow = document.getElementById('modal-eyebrow');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');

  const info = {
    fast: {
      eyebrow: 'Route detail',
      title: 'Fastest route via Bishopsgate',
      body: `<p>This route hugs Bishopsgate and clips the A40 to save five minutes. Both are heavy bus corridors with constant diesel traffic, so PM2.5 and NO₂ peak here during commuting hours.</p>
             <p>If you take this route, your phone records the exposure cost and uses it as a baseline. The system isn't telling you not to — just showing you what the trade-off costs.</p>`
    },
    clean: {
      eyebrow: 'Route detail',
      title: 'Cleanest route via The Cut & Southwark Street',
      body: `<p>This route stays south of the river longer, uses The Cut and Lower Marsh, crosses on a quieter bridge, then approaches Old Street through Bank rather than Liverpool Street.</p>
             <p>The detour adds about 5 minutes but cuts measured exposure by more than half, mostly because it avoids the Bishopsgate bus corridor entirely.</p>`
    },
    'threat-corp': {
      eyebrow: 'Threat model',
      title: 'What if a data broker acquires Clean Path?',
      body: `<p>There's no commute database to sell. The architecture means we never had one in the first place — your routes, preferences, and history live on your phone, encrypted at rest, and never sync up.</p>
             <p>What an acquirer would inherit: anonymous environmental readings from the public sensor mesh, which are already open data. Not a per-user product. The asset they'd hope to monetise simply doesn't exist.</p>`
    },
    'threat-state': {
      eyebrow: 'Threat model',
      title: 'What if a government subpoenas user data?',
      body: `<p>We can't hand over what we never had. There are no user accounts, no central server logging trips, no IP addresses tied to identities. The mesh broadcasts sensor readings; your phone reads them locally and decides for itself.</p>
             <p>This is structurally different from Google Maps or Citymapper, where your full movement history is on file and could be subpoenaed. The difference isn't policy — it's architecture.</p>`
    },
    'threat-mesh': {
      eyebrow: 'Threat model',
      title: 'What if a sensor lies?',
      body: `<p>A compromised or faulty sensor can broadcast false readings, but mesh consensus protects the map. Each node's readings are cross-referenced against its neighbours, and outliers more than 2σ from local consensus are flagged and excluded.</p>
             <p>One bad node can't poison the map. Sustained drift is detected over hours, and the node is quarantined until it's recalibrated.</p>`
    },
    'profile-edit': {
      eyebrow: 'Profile',
      title: 'What Sam can edit, and what we don\u2019t ask',
      body: `<p><strong>Editable:</strong> neighbourhood (for default routing context), travel modes, sensitivity preferences ("clean as possible," "balanced," "fastest"), notification settings, accessibility needs.</p>
             <p><strong>Never asked:</strong> legal name, email, phone, date of birth, employer, health record number. The avatar initials are a local display preference, not an identifier. The "Anonymous ID" chip rotates daily on-device and is never sent anywhere.</p>`
    },
    trend: {
      eyebrow: 'Weekly trend',
      title: 'What\u2019s driving the high days',
      body: `<p>Your Tuesday (74) and Friday (61) match peak commute days when you used Bishopsgate both ways. Weekends crash to 18–22 because you barely leave Southwark, which is in a cleaner pocket.</p>
             <p>Thursday's 38 is your lowest weekday all week — the day you tried The Cut route. The data is suggesting the route, not your effort, is what's moving the number.</p>`
    },
    context: {
      eyebrow: 'Context',
      title: 'What does 38 mean?',
      body: `<p>The score is normalised against WHO PM2.5 guidelines (5 µg/m³ annual mean, 15 µg/m³ 24-hour mean). A score of 38 means today's exposure is roughly 38% of the daily threshold — well within the safe range.</p>
             <p>Anything below 50 on a typical workday is good for inner London. Above 70 starts to add up over weeks for sensitive groups like Sam (mild asthma).</p>`
    },
    improve: {
      eyebrow: 'Practical',
      title: 'Realistic ways to lower this',
      body: `<p><strong>Easy wins:</strong> Leave 20 minutes earlier or later to miss the 08:00 peak. Take The Cut instead of Bishopsgate when you can. Choose the canal route home — it adds five minutes but cuts the afternoon score nearly in half.</p>
             <p><strong>Harder, but real:</strong> Switch one cycle commute per week to a Tube journey on days when surface PM2.5 is highest (the Underground has its own air quality issues but for short journeys it can be net cleaner).</p>
             <p>We won't suggest things you can't control. Moving house, changing jobs, or buying a different bike isn't an exposure intervention — it's a life change.</p>`
    },
    share: {
      eyebrow: 'Sharing',
      title: 'Share with GP · export, don\u2019t sync',
      body: `<p>Clean Path generates a signed PDF on your phone — a 30-day summary with daily exposure scores, weekly averages, and notable events. You hand it (or AirDrop it, or email it) to your GP yourself. Nothing syncs to a third-party health platform.</p>
             <p>What the GP sees: aggregate exposure trends and patterns. What they don't see: your individual routes, your home address, or the timestamps that would let anyone reconstruct your movements.</p>`
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
})();
