# Spec: Bold pass winner + "Totals" standings tab

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

Two related additions to the admin points view:
1. **Bold the winner** of each competition table in Tävlingsresultat (not Övningsskjutning).
2. A new **"Totals" tab** showing per-shooter season standings (sum of competition points per year, with wins and competition counts), ranked.

## Scope

`index.html` only — `renderComp()` (bolding), a new pure `compTotals()` helper, a
new `renderTotals()`, a new tab button + panel in `#adminView`, a call from
`renderAdmin()`, and a CSS class. Plus the standard `sw.js` bump. No data, schema,
or export changes. Competitions are always one day, so each competition table is a
single occasion.

## Feature 1 — Bold the winner of each competition table

In `renderComp()`, when rendering each group from `compGroups(rows)`:
- For every group **except `"Övningsskjutning"`**, compute the maximum poäng among
  rows that have a poäng.
- Render each row whose poäng equals that maximum with the class `comp-win`
  (bold). Ties → all co-winners bold. A table with no scored rows bolds nothing.
- The Övningsskjutning table renders plain (no bolding).
- Unnamed "Övrigt" tables (rare) follow the same rule — their top score is bolded.

CSS: `.comp-win{font-weight:700}` applied to the winning `<tr>`.

## Feature 2 — "Totals" tab (season standings)

### Pure helper `compTotals(rows)`

Self-contained (no dependency on `compGroups`). Given the year's entries:
- Keep only **real competition** scored rows: `tavling_namn` trimmed is non-empty
  **and** not `"Övningsskjutning"`, **and** poäng is set. (Unnamed rows are
  excluded — they aren't a named competition.)
- Group those rows by `tavling_namn`. For each competition, the winner(s) are the
  shooter(s) with the max poäng in that competition.
- Aggregate per shooter (`(skytt||"–").trim()`):
  - `total` = sum of their competition poäng
  - `tavlingar` = number of competitions they scored in
  - `segrar` = number of those competitions they won (poäng === that
    competition's max)
- Return an array of `{skytt, total, tavlingar, segrar}` sorted by `total`
  descending, tiebreak `segrar` descending, then `skytt.localeCompare(b,"sv")`.

### `renderTotals()`

- Reads the selected year (`$("#a-year").value || currentYearStr()`), calls
  `compTotals(entriesForYear(y))`.
- Fills `#totalsCount` with `(N)` (N = number of ranked shooters), toggles
  `#totalsEmpty`, and fills `#totalsTbody` with one row per shooter:
  rank (row index + 1), Skytt, Segrar, Tävlingar, Poäng (`fmt(total)`).
- Called from `renderAdmin()` right after `renderComp()`, so it reacts to the År
  selector.

### Markup

- **Tab button:** add `<button data-tab="panelTotals">Totals</button>` to the
  `.admin-tabs` bar, inserted **between** the `compCard` (Tävling) button and the
  `membersCard` (Medlemmar) button. No role gating — visible to admin and revisor.
- **Panel:** add `<div class="card tab-panel hide" id="panelTotals">` after the
  `#compCard` panel and before `#membersCard`, containing:
  - head `<h2>Totalt &amp; ranking <span id="totalsCount" class="hint"></span></h2>`
  - a `.tbl-scroll` table with `<thead>`: `#`, `Skytt`, `Segrar` (right),
    `Tävlingar` (right), `Poäng` (right), and `<tbody id="totalsTbody">`
  - `<div class="empty" id="totalsEmpty"><div>Inga tävlingspoäng för året.</div></div>`

The existing `setAdminTab()` handles the new tab/panel automatically (it operates
on all `.tab-panel` and `.admin-tabs button`).

## Verification

- A node logic test for `compTotals` (extract from `index.html` by brace-matching,
  assert ordering, totals, segrar, tävlingar, and Övningsskjutning exclusion).
- `node --check` the extracted inline script.
- Bump `VERSION` in `sw.js`.
- Manual: pick a year with competition data — each Tävling table bolds its top
  score (Övningsskjutning none); the Totals tab lists shooters ranked by total
  competition points with correct Segrar/Tävlingar; revisor sees the Totals tab.

## Out of scope (YAGNI)

- Dense ranking for tied totals (uses 1, 2, 3… row order).
- Exporting totals to CSV/Excel.
- Any data model, write path, or `TAVLINGAR` change.
