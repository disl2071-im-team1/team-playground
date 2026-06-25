# Presentation deck

Live: https://team-playground-ten.vercel.app/presentation/index.html

The deck is **split into one file per section** so all five of us can edit in
parallel without merge conflicts. Each section is a self-contained HTML fragment
with its own markup and its own `<style>`. A thin shell (`index.html`) loads them
in the order listed in `sections.json`.

## Layout

```
public/presentation/
  index.html      ← shared shell: tokens, base CSS, nav + notes script, loader. EDIT RARELY.
  sections.json   ← ordered list of sections. EDIT ONLY to add / remove / reorder.
  sections/
    01-framing.html
    02-how-we-organized.html
    03-demo.html
    04-ai-usability-review.html
    05-ai-reflection.html
    06-stilla-performance-review.html
    07-summary.html
  README.md       ← this file
```

## The one rule that keeps PRs conflict-free

**Edit only your own section file.** If two people change different files, Git
merges them cleanly every time. Conflicts only happen when two people edit the
*same* file, so:

- Changing slide text, styling, or adding/removing slides *within* your section
  → touch only `sections/0X-your-section.html`. No conflicts.
- Changing the shared shell (`index.html`) or the section order (`sections.json`)
  → coordinate first, since everyone shares those two files. They rarely change.

## Suggested ownership

Fill in the `owner` field in `sections.json` and the `Owner:` line at the top of
your section file so it's clear who edits what.

| # | Section | Suggested owner |
|---|---------|-----------------|
| 01 | Framing | Pelle |
| 02 | How we organized | Pelle |
| 03 | Demo | Pablo |
| 04 | AI usability testing / review | (open) |
| 05 | AI reflection | Mike |
| 06 | Stilla's performance review | Mike |
| 07 | Summary + future projection | (open) |

## How to edit a section

1. `git switch main && git pull`
2. `git switch -c <name>/deck-<section>` (e.g. `pablo/deck-demo`)
3. Edit your one file under `sections/`.
4. Preview locally (any static server over HTTP, e.g. `npx serve public` then
   open `/presentation/index.html`) since the deck loads sections via `fetch`, so it
   must be served over HTTP, not opened as a `file://` path.
5. Open a PR. Because you touched only your section file, it won't conflict with
   anyone else's section PR.

## Anatomy of a section file

- Optional `<style>` block at the top for styles used **only** by this section
  (the shell hoists it into `<head>` at load). Keep selectors scoped to your
  section's classes so they don't leak.
- One or more `<section class="slide">…</section>` blocks. The first is usually
  the divider (`<section class="slide divider">`).
- Each slide can carry a `<div class="notes-src">…</div>`: hidden on the slide,
  shown in the speaker-notes panel (press **N**).

## Conventions

- No em dashes in slide text. Use commas, colons, middle dots (·) or periods.
- Reuse the shared classes from `index.html` where you can: `h2.title`,
  `ul.points.body`, `.label`, `.lead`, `.kicker`, `.divider`, `.ph-tag` /
  `.ph-note` for placeholders.
- Keys: **←/→** move, **N** notes, **F** fullscreen.
