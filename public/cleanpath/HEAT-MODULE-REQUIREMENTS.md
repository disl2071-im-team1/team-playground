# Heatwave Preparedness Module · Requirements

A repositioning of the Clean Path prototype. The consumer-facing, privacy-first navigation tool becomes a municipal environmental monitoring module for city officers. The framing is that a meteorological station built this tool and offers it to municipalities, so the voice is institutional and operational, not personal.

## Who it is for

A municipal preparedness coordinator working across social services and elderly care. Not a consumer, not a commuter. Someone who has to make a call that affects vulnerable residents, and has to make it early.

## The situation it serves

- **Trigger.** A forecast heatwave. SMHI issues a värmebölja warning, with several days running above the threshold.
- **Goal.** Decide when to activate the heat plan, and which areas and vulnerable groups to prioritise first.
- **What they do here.** See forecast heat across the municipality against where vulnerable facilities sit (care homes, preschools), and time the advisory and relief to land before the peak.
- **Outcome.** Relief that reaches the right places ahead of the peak, not after the first admissions.

## Why temperature is the anchor

Temperature is largely measured, not modelled. It comes from SMHI stations, which makes it the high-confidence layer. That is deliberate. It stands in contrast to the modelled algae and fire layers, where the data is inferred rather than observed. The module should make this contrast legible, not hide it. An officer acting on measured heat is on firmer ground than an officer acting on a model, and the interface should say so.

## Requirements

Each requirement is testable. "Done" means the acceptance criterion can be demonstrated.

### R1 · Measured heat forecast across the municipality

Show a forecast air-temperature layer for the municipality over the next several days, sourced from SMHI. Label it clearly as **measured (high confidence)** so it reads differently from the modelled layers.

*Acceptance:* the map renders forecast temperature by area for a configurable horizon (at least 5 days), each value traceable to an SMHI source, and the layer carries a visible "measured" confidence tag.

### R2 · Vulnerable-facility overlay

Overlay the locations of vulnerable facilities (care homes, preschools, and similar) on top of the heat forecast, as a layer the officer can toggle. The point is to see heat against where vulnerable people actually are.

*Acceptance:* facilities render as a distinct, toggleable layer; each marker shows facility name and type; the overlay sits on the same map as the heat forecast so the two can be read together.

### R3 · Värmebölja threshold and multi-day persistence

Detect when forecast temperature crosses the SMHI värmebölja threshold and persists across consecutive days. Surface a clear "activate heat plan" signal, with the first day the threshold is crossed and how many days it holds.

*Acceptance:* given a forecast that meets the threshold for the defined run of consecutive days, the module flags a trigger state and names the start day and duration; a forecast that does not meet it shows no trigger.

### R4 · Lead time to the peak

Show the timeline from now to the forecast peak, with a clear "act by" marker so the coordinator can time the advisory and relief to land before the peak rather than after it.

*Acceptance:* the interface identifies the peak day and an "act by" point ahead of it, and presents the days in between as a readable timeline.

### R5 · Prioritisation of areas and groups

Rank areas and facilities by combined risk: forecast heat weighted against the density of vulnerable facilities. The coordinator should be able to read off which areas and groups to reach first.

*Acceptance:* the module produces an ordered list of areas or facilities to prioritise, the ordering reflects both heat and vulnerability, and the basis for each ranking is visible (not a black box).

### R6 · Confidence as a first-class signal

Every layer carries a confidence label. Temperature is marked **measured**. The algae and fire layers are marked **modelled**. The contrast is part of the design, so an officer always knows how much weight a layer can bear.

*Acceptance:* every active layer shows a confidence label; measured and modelled layers are visually distinguishable at a glance; the distinction is explained once in plain language.

### R7 · Officer framing, not consumer framing

Reframe the module for a municipal audience. Remove the personal and consumer elements (individual profile, on-device privacy receipts, personal route exposure). Replace the consumer voice with an operational one, presented as a tool a meteorological station provides to municipalities.

*Acceptance:* no screen addresses an individual end user or their personal data; copy speaks to a preparedness coordinator and their decision; the meteorological-station-for-municipalities framing appears in the header or intro.

## Out of scope (for this iteration)

- Real-time admissions or health-system data.
- Automated dispatch of relief. The module informs the decision; it does not execute it.
- The modelled algae and fire layers as fully built features. They are referenced as the contrast that makes the measured temperature layer meaningful, and can be stubbed.
