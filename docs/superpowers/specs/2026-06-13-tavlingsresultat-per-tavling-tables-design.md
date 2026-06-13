# Spec: Tävlingsresultat — one table per tävling, övningsskjutning merged

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

In the admin **Tävlingsresultat** card, replace the single flat results table
with **one table per competition** (`tavling_namn`), while all
**"Övningsskjutning"** rows collapse into a single merged table shown last.

## Scope

On-screen rendering only: the `renderComp()` function (`index.html:646`) and the
competition card markup (`index.html:285-294`). The Excel/CSV export
(`index.html:748` and `index.html:772`) is **unchanged and out of scope** — it
keeps its flat, single-list form with the Tävling column.

## Behaviour

### Source rows
Same filter as today: for the selected year,
`entriesForYear(y).filter(e => e.tavling || (e.poang != null && e.poang !== ""))`.
`#compCount` continues to show the **total** number of qualifying rows.

### Grouping
Group qualifying rows by trimmed `tavling_namn`.

### Table order on the page
1. The fixed `TAVLINGAR` names **except** `"Övningsskjutning"`, in `TAVLINGAR`
   list order, for those that have at least one row.
2. Then any other / custom names present in the data but not in `TAVLINGAR`,
   sorted alphabetically with Swedish collation (`localeCompare(b, 'sv')`).
3. Then `"Övningsskjutning"` **always last**, if it has rows.

A group whose `tavling_namn` is empty is rendered with the heading `"Övrigt"`.
(Competition names can be custom — `fillTavlingar` supports an `(eget)` value —
so non-`TAVLINGAR` names are possible and must still get their own table.)

### Row sort within each table
- **Real competition** tables: by **poäng descending**. Rows with no poäng sort
  last (treat missing poäng as `-Infinity`). Tiebreak: date newest-first.
- **Övningsskjutning** table: by **date newest-first**.

### Each table
- An `<h3>` heading: the tävling name (or `"Övrigt"`) followed by a
  `<span class="hint">(N)</span>` row count for that table.
- Columns: **Datum · Skytt · Poäng** — the Tävling column is dropped because the
  name is now the heading. Poäng cell shows `fmt(poang)` when set, else blank.
  Datum cell uses `white-space:nowrap`; Poäng header right-aligned and cells use
  `class="num"`, matching the current table.

### Empty state
If there are zero qualifying rows, `#compTables` renders empty and `#compEmpty`
("Inga tävlingsresultat för året.") is shown — identical to current behaviour.
A competition with no rows in the year produces no table.

## Markup change

Replace (lines 287-292):

```html
      <div class="tbl-scroll">
        <table>
          <thead><tr><th>Datum</th><th>Tävling</th><th>Skytt</th><th style="text-align:right">Poäng</th></tr></thead>
          <tbody id="compTbody"></tbody>
        </table>
      </div>
```

with:

```html
      <div id="compTables"></div>
```

Keep the surrounding `#compCard`, the `<h2>` with `#compCount`, and `#compEmpty`.

## CSS

Add a small wrapper rule (next to the existing table styles):

```css
.comp-group{margin-bottom:18px}
```

Each group's table reuses the existing `.tbl-scroll` + `<table>` styling so it
looks like the current table.

## Verification

- `node --check` the extracted inline script.
- Bump the `VERSION` constant in `sw.js`.
- Manual: open Admin & analys → Tävlingsresultat for a year with mixed data;
  confirm one table per competition in `TAVLINGAR` order, competition rows sorted
  by poäng desc, a single Övningsskjutning table last sorted by date desc, the
  per-table counts, and the empty state for a year with no results.

## Out of scope (YAGNI)

- The Excel/CSV export format.
- Placement/standings numbering (1, 2, 3…) within a competition table.
- Showing empty competitions (names with no rows this year).
- Any change to the data model, write path, or `TAVLINGAR` list.
