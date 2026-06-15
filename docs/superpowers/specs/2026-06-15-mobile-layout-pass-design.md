# Design: mobile layout polish pass

Date: 2026-06-15
Status: Approved (pending spec review)

## Problem

The app is used at the range on phones. It already has a responsive base
(viewport meta, `@media` breakpoints at 480/680/760, `.tbl-scroll` wrappers),
but a parallel audit found genuine breakage and ergonomic issues on a
~360–414px screen. This is a focused polish pass — mostly CSS inside `@media`
blocks plus two tiny HTML class swaps. No redesign, no layout rewrite.

## Fixes

Ordered by severity. Selectors/lines are approximate (will shift).

### HIGH

**H1 — Admin tab bar is clipped (tabs unreachable).**
`.seg{overflow:hidden}` (line 99) overrides the intended
`.admin-tabs{overflow-x:auto}` (line 98) on the same element
(`<div class="seg admin-tabs">`), so the *Medlemmar*/*Total* tabs are cut off
with no scroll on a phone. Fix — raise specificity:
```css
.seg.admin-tabs{overflow-x:auto;overflow-y:hidden}
```
(Harmless on desktop: no overflow → no scrollbar.)

**H2 — Member-row & shooter-row action cells overflow.**
Both cells use an *inline* `white-space:nowrap`, which no media query can
override, so the role-select + 4 buttons (Medlemmar) / faktura buttons (Att
betala) force a long horizontal scroll. The journal admin table already uses a
`.row-actions` div for the same job — adopt it here too.
- `renderMembers` actions cell (line ~713): replace
  `<td style="white-space:nowrap;text-align:right">…</td>` with
  `<td><div class="row-actions">…</div></td>`.
- `renderAdmin` shooter cell (line ~641, the `act` is rendered into a
  `<td style="text-align:right;white-space:nowrap">`): wrap its contents in
  `<div class="row-actions">…</div>` and drop the inline `white-space:nowrap`.
- CSS — let `.row-actions` wrap on phones:
```css
@media(max-width:560px){ .row-actions{flex-wrap:wrap;white-space:normal} }
```

**H3 — Tall modals can't scroll (e.g. 8-field edit modal).**
`.modal{overflow:hidden}` with no `max-height` and a non-scrolling `.m-body`
means a modal taller than the viewport clips the foot buttons (Spara/Avbryt)
with no way to reach them. Fix — cap height, keep head/foot fixed, scroll the
body:
```css
.modal{max-height:calc(100dvh - 36px);display:flex;flex-direction:column}
.modal .m-body{overflow-y:auto;min-height:0}
```
(`.modal-bg` pads 18px each side → −36px. `.modal` keeps its existing
`overflow:hidden`/`border-radius`; the body becomes the scroll region.
`min-height:0` is required so the flex child can shrink below its content height
and actually scroll — without it the body refuses to scroll.)

**H4 — Month bar chart shrinks to ~6px labels.**
`barChart()` SVG has a ~552px viewBox forced to `width:100%`, so on a phone the
labels become unreadable. Fix — on phones, keep native size and scroll:
```css
@media(max-width:480px){
  .chart{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .chart svg{width:auto;height:150px}
}
```

### MEDIUM

**M1 — Touch targets below ~44px.** Bump padding on phones only:
```css
@media(max-width:680px){
  .btn.tiny{padding:9px 12px}
  .slist .x{padding:9px 13px;font-size:15px;line-height:1}
  .icon-btn{padding:11px 14px}
}
```

**M2 — Stat tiles can overflow with a long "kr" value.** Shrink the big number
on small phones:
```css
@media(max-width:400px){ .stat .v{font-size:24px} .stat .v small{font-size:12px} }
```

### LOW

**L1 — Phantom blank label above the "Lägg till" button** leaves a gap when the
quick-add grid stacks. Hide it on phones:
```css
@media(max-width:680px){ .quick .qadd label{display:none} }
```

## Implementation notes

- Almost everything lives in the one `<style>` block (~lines 30–162). Add each
  rule next to the related existing rule, or in a small consolidated phone block
  — implementer's choice, but keep it readable.
- Only two HTML edits (H2): the `renderMembers` actions `<td>` and the
  `renderAdmin` shooter actions `<td>`. Both just adopt the existing
  `.row-actions` div and drop the inline `white-space:nowrap`.
- Because the bulk is one CSS region, this is **not** a good parallel-subagent
  job (agents would collide in the same `<style>` block) — do it as one focused
  change.

## Verification

- `node --check` style: run the inline-script parse check (CSS changes don't
  affect it, but H2 touches render JS, so confirm it still parses).
- Manual, in a narrow viewport (DevTools ~390px or a real phone):
  1. Admin tabs all reachable (scroll the bar to *Medlemmar*).
  2. Medlemmar + Att betala action buttons wrap within the row — no sideways
     scroll to reach "Ta bort" / "Markera betald".
  3. Open the edit-entry modal → it fits, body scrolls, Spara/Avbryt reachable.
  4. Month chart is legible (scrolls instead of shrinking).
  5. Tiny buttons / session ✕ are comfortably tappable.
  6. Stat tiles don't clip a long "Att betala totalt" value.
- Bump `sw.js` VERSION.

## Files touched

- `index.html` — CSS in the `<style>` block; two `<td>` class swaps in
  `renderMembers` / `renderAdmin`.
- `sw.js` — VERSION bump.

## Out of scope (YAGNI)

- Converting tables to stacked card layouts.
- Scroll-affordance fades/shadows on tables/charts.
- Any change to desktop layout.
