# Spec: Tabs in the admin view

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

Replace the long vertical stack of four cards in the admin view (`#adminView`)
with a tabbed layout: a persistent toolbar of global controls, a tab bar, and
one visible panel at a time.

## Scope

`index.html` only — markup inside `#adminView`, a little CSS, a small tab
function, and one line of the role logic. No data-loading or render changes:
`renderAdmin()` already populates every panel, `loadMembers()` already runs on
admin entry, and the År selector already re-renders. Tabs are a pure visibility
layer on top.

## The four panels

1. **Analys & sammanställning** (stats, chart, "Skott & kostnad per skytt").
2. **Alla poster** (`#adminTbody` + search).
3. **Tävlingsresultat** (`#compCard` / `#compTables`).
4. **Medlemmar** (`#membersCard`) — admin only.

## Layout

```
┌ #adminView ────────────────────────────────────┐
│  År [2026▾]   ⤓CSV  ⤓Excel  ⚙Databas            │  .admin-toolbar (always visible)
│ [Analys][Alla poster][Tävling][Medlemmar]       │  .seg.admin-tabs
│ ┌ active panel (one .tab-panel) ───────────────┐│
│ │ …                                            ││
└─└───────────────────────────────────────────────┘
```

## Changes

### 1. Markup (`#adminView`, currently lines 247-…)

- **Toolbar:** move the controls `<div>` that currently sits in the Analys card
  head — the one containing `#a-year`, `#exportCsv`, `#exportXlsx`, `#dbSettings`
  (plus the `År` label) — out into a new `<div class="admin-toolbar">` placed as
  the first child of `#adminView`. **All ids stay the same** so existing event
  listeners and the `#dbSettings` role toggle keep working. The Analys card keeps
  its `<h2>Analys &amp; sammanställning</h2>`.
- **Tab bar:** add `<div class="seg admin-tabs">` after the toolbar with four
  `<button>`s, each carrying `data-tab` = the target panel id:
  - `data-tab="panelAnalys"` → "Analys" (starts with class `on`)
  - `data-tab="panelPoster"` → "Alla poster"
  - `data-tab="compCard"` → "Tävling"
  - `data-tab="membersCard"` → "Medlemmar", with `id="tabBtnMembers"`
- **Panels:** add class `tab-panel` to all four cards. The two cards without ids
  get `id="panelAnalys"` and `id="panelPoster"`; `#compCard` and `#membersCard`
  keep their ids. Non-active panels start hidden: `panelPoster` and `compCard`
  get the `hide` class; `membersCard` already has `hide` (keep it); `panelAnalys`
  stays visible.

### 2. CSS (next to existing rules)

```css
  .admin-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .admin-tabs{margin-bottom:16px;max-width:100%;overflow-x:auto}
```

The tab bar reuses the existing `.seg` / `.seg button.on` styling. `tab-panel` is
just a JS selector hook — no style needed; visibility is the existing
`.hide{display:none !important}`.

### 3. JS — `setAdminTab(id)`

```js
function setAdminTab(id){
  document.querySelectorAll("#adminView .tab-panel").forEach(p=>p.classList.toggle("hide", p.id!==id));
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("on", b.dataset.tab===id));
}
document.querySelectorAll(".admin-tabs button").forEach(b=>b.addEventListener("click",()=>setAdminTab(b.dataset.tab)));
```

Default active tab is Analys (set in the markup). The active tab persists in the
DOM across `renderAdmin()` calls and year changes (those only set inner content,
not panel `hide` state), so no reset logic is needed.

### 4. Role gating (one line)

Today line 1013 is:
```js
$("#membersCard").classList.toggle("hide", !isAdmin);
```
Change it to gate the **tab button** instead, letting tab logic own panel
visibility:
```js
$("#tabBtnMembers").classList.toggle("hide", !isAdmin);
```
Result: a **revisor** sees the Analys / Alla poster / Tävling tabs but no
Medlemmar tab (and `membersCard` stays hidden because it's never the active tab);
an **admin** sees all four. The `#dbSettings` admin-only toggle (line 1014) is
unchanged and still hides the Databas button for non-admins. Export buttons stay
available to revisors (they live in the always-visible toolbar).

## Verification

- `node --check` the extracted inline script.
- Bump `VERSION` in `sw.js`.
- Manual: as **admin**, confirm four tabs, switching shows exactly one panel, the
  toolbar (År/CSV/Excel/Databas) stays visible on every tab, changing År keeps
  the current tab, and Medlemmar still loads/manages members. As **revisor**,
  confirm no Medlemmar tab and no Databas button, but the other three tabs and
  export work.

## Out of scope (YAGNI)

- The top-level logg ⇄ admin view switch (separate, unchanged).
- Persisting the active tab across reloads.
- The "Skicka testmejl" Brevo button (separate, parked idea).
- Any data model, render, or export changes.
