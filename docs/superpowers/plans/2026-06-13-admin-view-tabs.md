# Admin View Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin view's four stacked cards into a tabbed layout with a persistent toolbar of global controls (År + exports + Databas) above the tab bar.

**Architecture:** Pure visibility layer over the existing cards. A global toolbar holds the controls moved out of the Analys card head; a `.seg.admin-tabs` bar switches which `.tab-panel` card is shown via the existing `.hide` class. `renderAdmin()`/`loadMembers()` already populate every panel, so no data or render logic changes — only markup, a little CSS, a small `setAdminTab()` function, and one line of role gating.

**Tech Stack:** Single static `index.html` (vanilla JS, no build), PWA service worker. No test framework — verification is `node --check` of the inline script plus manual role/tab checks (project convention).

**Testing note:** Do not add a test runner. The tab logic is DOM wiring; verify via `node --check` and the manual steps.

---

### Task 1: Tabbed admin view

**Files:**
- Modify: `index.html` (CSS block ~line 94; admin-view markup ~lines 247-293; JS ~line 853; role line ~1013)

- [ ] **Step 1: Add the CSS rules**

Find (line 94):
```css
  .comp-group h3{margin-left:12px}
```
Replace with:
```css
  .comp-group h3{margin-left:12px}
  .admin-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .admin-tabs{margin-bottom:16px;max-width:100%;overflow-x:auto}
```

- [ ] **Step 2: Insert the toolbar + tab bar and convert the Analys card to a panel**

Find (the `#adminView` opening through the Analys card head — lines 247-258):
```html
  <div id="adminView" class="hide">
    <div class="card">
      <div class="card-head">
        <h2>Analys &amp; sammanställning</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label for="a-year" style="margin:0">År</label>
          <select id="a-year" style="width:auto"></select>
          <button class="btn ghost tiny" id="exportCsv">⤓ CSV</button>
          <button class="btn ghost tiny" id="exportXlsx">⤓ Excel</button>
          <button class="btn ghost tiny" id="dbSettings">⚙ Databas</button>
        </div>
      </div>
```
Replace with:
```html
  <div id="adminView" class="hide">
    <div class="admin-toolbar">
      <label for="a-year" style="margin:0">År</label>
      <select id="a-year" style="width:auto"></select>
      <button class="btn ghost tiny" id="exportCsv">⤓ CSV</button>
      <button class="btn ghost tiny" id="exportXlsx">⤓ Excel</button>
      <button class="btn ghost tiny" id="dbSettings">⚙ Databas</button>
    </div>
    <div class="seg admin-tabs">
      <button data-tab="panelAnalys" class="on">Analys</button>
      <button data-tab="panelPoster">Alla poster</button>
      <button data-tab="compCard">Tävling</button>
      <button data-tab="membersCard" id="tabBtnMembers">Medlemmar</button>
    </div>
    <div class="card tab-panel" id="panelAnalys">
      <div class="card-head">
        <h2>Analys &amp; sammanställning</h2>
      </div>
```

This moves the global controls (ids unchanged) into `.admin-toolbar`, adds the tab bar, and makes the Analys card the first panel (visible by default).

- [ ] **Step 3: Make the "Alla poster" card a hidden panel**

Find:
```html
    <div class="card">
      <div class="card-head"><h2>Alla poster <span id="rowCount" class="hint"></span></h2>
```
Replace with:
```html
    <div class="card tab-panel hide" id="panelPoster">
      <div class="card-head"><h2>Alla poster <span id="rowCount" class="hint"></span></h2>
```

- [ ] **Step 4: Make the Tävlingsresultat card a hidden panel**

Find:
```html
    <div class="card" id="compCard">
```
Replace with:
```html
    <div class="card tab-panel hide" id="compCard">
```

- [ ] **Step 5: Make the Medlemmar card a panel**

Find:
```html
    <div class="card hide" id="membersCard">
```
Replace with:
```html
    <div class="card tab-panel hide" id="membersCard">
```

- [ ] **Step 6: Add the `setAdminTab` function and wire the tab buttons**

Find (line 853):
```js
$("#a-year").addEventListener("change",renderAdmin);
```
Replace with:
```js
$("#a-year").addEventListener("change",renderAdmin);
function setAdminTab(id){
  document.querySelectorAll("#adminView .tab-panel").forEach(p=>p.classList.toggle("hide", p.id!==id));
  document.querySelectorAll(".admin-tabs button").forEach(b=>b.classList.toggle("on", b.dataset.tab===id));
}
document.querySelectorAll(".admin-tabs button").forEach(b=>b.addEventListener("click",()=>setAdminTab(b.dataset.tab)));
```

- [ ] **Step 7: Gate the Medlemmar tab button instead of the card**

Find (line ~1013):
```js
  $("#membersCard").classList.toggle("hide", !isAdmin);
```
Replace with:
```js
  $("#tabBtnMembers").classList.toggle("hide", !isAdmin);
```

Now panel visibility is owned by tab logic; the Medlemmar tab is hidden for non-admins, so `membersCard` is never their active tab and stays hidden.

- [ ] **Step 8: Syntax-check the inline script**

Run (Bash tool, repo root):
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n;\n');fs.writeFileSync('.tmp-app.js',b);" && node --check .tmp-app.js && echo SYNTAX_OK && rm .tmp-app.js
```
Expected: `SYNTAX_OK`.

- [ ] **Step 9: Verify the structural edits landed**

Run:
```bash
node -e "const h=require('fs').readFileSync('index.html','utf8');const need=['class=\"admin-toolbar\"','class=\"seg admin-tabs\"','data-tab=\"panelAnalys\"','data-tab=\"membersCard\"','id=\"tabBtnMembers\"','id=\"panelPoster\"','function setAdminTab','\$(\"#tabBtnMembers\").classList.toggle'];const miss=need.filter(s=>!h.includes(s));console.log(miss.length?('MISSING: '+miss.join(' | ')):'STRUCT_OK');"
```
Expected: `STRUCT_OK`. (Also confirms the old `$("#membersCard").classList.toggle("hide", !isAdmin)` line is gone — it was replaced in Step 7.)

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Admin view: tab bar + persistent toolbar over the four cards"
```

---

### Task 2: Bump the service-worker version

**Files:**
- Modify: `sw.js:6`

- [ ] **Step 1: Bump `VERSION`**

Find:
```js
const VERSION = "v23";
```
Replace with:
```js
const VERSION = "v24";
```

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "Bump sw VERSION to v24"
```

---

## Manual verification (after deploy / hard-refresh)

- **As admin:** four tabs (Analys, Alla poster, Tävling, Medlemmar); clicking each shows exactly one panel; the toolbar (År / CSV / Excel / Databas) stays visible on every tab; changing År keeps the current tab and refreshes its content; the Medlemmar tab still lists and manages members.
- **As revisor:** no Medlemmar tab and no Databas button; the other three tabs plus CSV/Excel export all work.

## Self-review notes

- **Spec coverage:** toolbar relocation w/ ids preserved (Step 2), tab bar + four panels (Steps 2-5), CSS (Step 1), `setAdminTab` + wiring (Step 6), role gating via `#tabBtnMembers` (Step 7), Databas/`#dbSettings` toggle untouched (not modified), sw bump (Task 2). All mapped.
- **Name consistency:** panel ids `panelAnalys` / `panelPoster` / `compCard` / `membersCard` match the buttons' `data-tab` values; `#tabBtnMembers` defined in Step 2, gated in Step 7. `setAdminTab` defined and wired in the same step.
- **No placeholders:** every step shows exact before/after.
