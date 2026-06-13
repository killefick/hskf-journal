# Spec: Admin can edit the shooter name in "Ändra post"

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

Let an **admin** change the shooter name (`skytt`) when editing an entry. Today
the Skytt field in the Ändra-post modal is read-only for everyone.

## Approach

Mirror the existing **Datum** field exactly: it already renders an editable input
for admins and a read-only div for everyone else, and the save handler reads it
only inside `if(isAdmin)`. The Skytt field gets the same treatment. Non-admins
editing their own entries still see the name read-only. Free-text input (matches
how names are entered elsewhere — no shooter datalist).

Renaming affects only the edited entry; its grouping in the per-shooter / Tävling
/ Totals views updates accordingly. No bulk rename.

## Changes (`index.html`)

### 1. Markup (line 346)
Replace the static read-only div with a wrapper, like `#e-datum-wrap`:
```html
    <div class="field"><label>Skytt</label><div id="e-skytt-wrap"></div></div>
```

### 2. `openEdit` (line 951)
Replace `$("#e-skytt").textContent=e.skytt||"";` with the admin/read-only swap
(mirrors the `#e-datum` block above it), keeping the `#e-skott` line:
```js
  $("#e-skytt-wrap").innerHTML = isAdmin
    ? '<input type="text" id="e-skytt" autocomplete="off">'
    : '<div id="e-skytt" class="datum-fast"></div>';
  if(isAdmin) $("#e-skytt").value=e.skytt||""; else $("#e-skytt").textContent=e.skytt||"";
  $("#e-skott").value=e.antal_skott||"";
```

### 3. Save handler — add to the existing `if(isAdmin)` block (lines 964-968)
After the datum lines, read and validate the name:
```js
    const namn=$("#e-skytt").value.trim();
    if(!namn){ alert("Ange ett namn."); return; }
    row.skytt=namn;
```
So an admin's edit includes `row.skytt`; a non-admin's does not (unchanged).

## Verification

- `node --check` the extracted inline script.
- Bump `VERSION` in `sw.js`.
- Manual: as admin, Ändra post on an entry → the Skytt field is an editable input
  prefilled with the name → change it, Spara → the row shows the new name and
  re-groups in the per-shooter/Tävling/Totals views. Clearing the name and
  saving shows "Ange ett namn." As a non-admin editing an own entry, Skytt stays
  read-only.

## Out of scope (YAGNI)

- Autocomplete datalist of existing shooters.
- Bulk-renaming all of a shooter's entries at once.
- Letting non-admins rename.
