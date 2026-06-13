# Pass Winner + Totals Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bold the winning row in each competition table (not Övningsskjutning), and add a "Totals" tab with per-shooter season standings (points, wins, competition count) ranked.

**Architecture:** Pure-render additions in `index.html`. A pure `compTotals(rows)` helper computes standings (node-testable). `renderTotals()` fills a new tab panel and is called from `renderAdmin()`. `renderComp()` gains winner-bolding. The existing `setAdminTab()` handles the new tab automatically.

**Tech Stack:** Single static `index.html` (vanilla JS, no build), PWA service worker. No test framework — a one-off node logic test for `compTotals` + `node --check` (project convention).

**Testing note:** Do not add a test runner. The node test in Task 1 extracts the real `compTotals` from `index.html` by brace-matching.

---

### Task 1: `compTotals` standings helper (pure, TDD)

**Files:**
- Modify: `index.html` (add `compTotals` just before `function renderComp(){`)

- [ ] **Step 1: Write the failing test**

Create `C:\GIT\hskf-journal\.tmp-totals-test.js`:

```js
const fs = require("fs");
const assert = require("assert");
const h = fs.readFileSync("index.html", "utf8");
const start = h.indexOf("function compTotals(rows){");
if (start === -1) { console.error("compTotals not found"); process.exit(1); }
let depth = 0, end = -1;
for (let i = h.indexOf("{", start); i < h.length; i++) {
  if (h[i] === "{") depth++;
  else if (h[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
const compTotals = new Function("return (" + h.slice(start, end) + ")")();

const rows = [
  {tavling_namn:"Vårpokalen", skytt:"A", poang:97, datum:"2026-05-03"},
  {tavling_namn:"Vårpokalen", skytt:"B", poang:88, datum:"2026-05-03"},
  {tavling_namn:"Vårpokalen", skytt:"C", poang:null, datum:"2026-05-03"},
  {tavling_namn:"Höstpokalen", skytt:"A", poang:90, datum:"2026-09-01"},
  {tavling_namn:"Höstpokalen", skytt:"B", poang:95, datum:"2026-09-01"},
  {tavling_namn:"Klubbmatch", skytt:"D", poang:80, datum:"2026-07-01"},
  {tavling_namn:"Klubbmatch", skytt:"E", poang:80, datum:"2026-07-01"},
  {tavling_namn:"Övningsskjutning", skytt:"A", poang:50, datum:"2026-06-10"},
  {tavling_namn:"", skytt:"A", poang:30, datum:"2026-04-01"},
];
const r = compTotals(rows);
assert.deepStrictEqual(r.map(x => x.skytt), ["A","B","D","E"], "order: " + JSON.stringify(r.map(x=>x.skytt)));
assert.deepStrictEqual(r.find(x=>x.skytt==="A"), {skytt:"A", total:187, tavlingar:2, segrar:1});
assert.deepStrictEqual(r.find(x=>x.skytt==="B"), {skytt:"B", total:183, tavlingar:2, segrar:1});
assert.deepStrictEqual(r.find(x=>x.skytt==="D"), {skytt:"D", total:80, tavlingar:1, segrar:1});
assert.deepStrictEqual(r.find(x=>x.skytt==="E"), {skytt:"E", total:80, tavlingar:1, segrar:1});
assert(!r.find(x=>x.skytt==="C"), "C (blank poäng) must be excluded");
console.log("TOTALS_OK");
```

- [ ] **Step 2: Run it — expect FAIL (function not defined)**

Run: `node .tmp-totals-test.js`
Expected: `compTotals not found`, non-zero exit.

- [ ] **Step 3: Add the `compTotals` helper**

In `index.html`, find:
```js
function renderComp(){
```
Replace with (the helper inserted immediately before `renderComp`):
```js
// Pure: per-shooter season standings from real competition rows (excludes
// Övningsskjutning and unnamed). Each competition is one day; the winner(s) are the
// top score that day. Returns [{skytt,total,tavlingar,segrar}] sorted total desc,
// then segrar desc, then name (sv).
function compTotals(rows){
  const byComp=new Map();
  for(const e of rows){
    const name=(e.tavling_namn||"").trim();
    if(!name||name==="Övningsskjutning") continue;
    const p=(e.poang!=null&&e.poang!=="")?+e.poang:null;
    if(p==null) continue;
    if(!byComp.has(name)) byComp.set(name,[]);
    byComp.get(name).push({skytt:(e.skytt||"–").trim(), p});
  }
  const agg=new Map();
  for(const list of byComp.values()){
    const maxP=Math.max(...list.map(r=>r.p));
    for(const r of list){
      if(!agg.has(r.skytt)) agg.set(r.skytt,{total:0,tavlingar:0,segrar:0});
      const a=agg.get(r.skytt);
      a.total+=r.p; a.tavlingar+=1; if(r.p===maxP) a.segrar+=1;
    }
  }
  return [...agg.entries()].map(([skytt,a])=>({skytt,...a}))
    .sort((x,y)=>(y.total-x.total)||(y.segrar-x.segrar)||x.skytt.localeCompare(y.skytt,"sv"));
}
function renderComp(){
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `node .tmp-totals-test.js`
Expected: `TOTALS_OK`.

- [ ] **Step 5: Remove temp test, commit**

```bash
rm .tmp-totals-test.js
git add index.html
git commit -m "Add compTotals: pure per-shooter season standings helper"
```

---

### Task 2: Totals tab — markup, render, wiring

**Files:**
- Modify: `index.html` (tab bar; new panel; `renderTotals`; `renderAdmin` call)

- [ ] **Step 1: Add the Totals tab button**

Find:
```html
      <button data-tab="compCard">Tävling</button>
      <button data-tab="membersCard" id="tabBtnMembers">Medlemmar</button>
```
Replace with:
```html
      <button data-tab="compCard">Tävling</button>
      <button data-tab="panelTotals">Totals</button>
      <button data-tab="membersCard" id="tabBtnMembers">Medlemmar</button>
```

- [ ] **Step 2: Add the Totals panel (between the Tävling and Medlemmar panels)**

Find:
```html
      <div class="empty" id="compEmpty"><div>Inga tävlingsresultat för året.</div></div>
    </div>

    <div class="card tab-panel hide" id="membersCard">
```
Replace with:
```html
      <div class="empty" id="compEmpty"><div>Inga tävlingsresultat för året.</div></div>
    </div>

    <div class="card tab-panel hide" id="panelTotals">
      <div class="card-head"><h2>Totalt &amp; ranking <span id="totalsCount" class="hint"></span></h2></div>
      <div class="tbl-scroll">
        <table>
          <thead><tr><th>#</th><th>Skytt</th><th style="text-align:right">Segrar</th><th style="text-align:right">Tävlingar</th><th style="text-align:right">Poäng</th></tr></thead>
          <tbody id="totalsTbody"></tbody>
        </table>
      </div>
      <div class="empty" id="totalsEmpty"><div>Inga tävlingspoäng för året.</div></div>
    </div>

    <div class="card tab-panel hide" id="membersCard">
```

- [ ] **Step 3: Add `renderTotals` (next to `renderComp`)**

Find:
```js
/* ---------- shared ---------- */
function renderAll(){ renderLog(); if(!$("#adminView").classList.contains("hide"))renderAdmin(); }
```
Replace with:
```js
function renderTotals(){
  const y=$("#a-year").value||currentYearStr();
  const t=compTotals(entriesForYear(y));
  $("#totalsCount").textContent=t.length?`(${t.length})`:"";
  $("#totalsEmpty").style.display=t.length?"none":"block";
  $("#totalsTbody").innerHTML=t.map((r,i)=>`<tr><td class="num" style="text-align:left">${i+1}</td><td>${esc(r.skytt)}</td><td class="num">${r.segrar}</td><td class="num">${r.tavlingar}</td><td class="num">${fmt(r.total)}</td></tr>`).join("");
}
/* ---------- shared ---------- */
function renderAll(){ renderLog(); if(!$("#adminView").classList.contains("hide"))renderAdmin(); }
```

- [ ] **Step 4: Call `renderTotals()` from `renderAdmin`**

Find:
```js
  renderComp();
}
```
Replace with:
```js
  renderComp();
  renderTotals();
}
```

- [ ] **Step 5: Syntax-check, then commit**

Run:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n;\n');fs.writeFileSync('.tmp-app.js',b);" && node --check .tmp-app.js && echo SYNTAX_OK && rm .tmp-app.js
```
Expected: `SYNTAX_OK`. Then:
```bash
git add index.html
git commit -m "Add Totals tab: per-shooter season standings panel + render"
```

---

### Task 3: Bold the winner of each competition table

**Files:**
- Modify: `index.html` (CSS ~line 95; `renderComp`)

- [ ] **Step 1: Add the winner CSS class**

Find:
```css
  .comp-group h3{margin-left:12px}
```
Replace with:
```css
  .comp-group h3{margin-left:12px}
  .comp-win{font-weight:700}
```

- [ ] **Step 2: Bold the winning row(s) in `renderComp`**

Find:
```js
  $("#compTables").innerHTML=compGroups(rows).map(([name,list])=>
    `<div class="comp-group"><h3>${esc(name)} <span class="hint">(${list.length})</span></h3>`+
    `<div class="tbl-scroll"><table>`+
    `<thead><tr><th>Datum</th><th>Skytt</th><th style="text-align:right">Poäng</th></tr></thead>`+
    `<tbody>${list.map(e=>`<tr><td style="white-space:nowrap">${e.datum||""}</td><td>${esc(e.skytt)}</td><td class="num">${(e.poang!=null&&e.poang!=="")?fmt(e.poang):""}</td></tr>`).join("")}</tbody>`+
    `</table></div></div>`
  ).join("");
```
Replace with:
```js
  $("#compTables").innerHTML=compGroups(rows).map(([name,list])=>{
    const isOvning=name==="Övningsskjutning";
    let maxP=-Infinity;
    if(!isOvning) for(const e of list){ const p=(e.poang!=null&&e.poang!=="")?+e.poang:-Infinity; if(p>maxP)maxP=p; }
    return `<div class="comp-group"><h3>${esc(name)} <span class="hint">(${list.length})</span></h3>`+
    `<div class="tbl-scroll"><table>`+
    `<thead><tr><th>Datum</th><th>Skytt</th><th style="text-align:right">Poäng</th></tr></thead>`+
    `<tbody>${list.map(e=>{const p=(e.poang!=null&&e.poang!=="")?+e.poang:null;const win=!isOvning&&p!=null&&p===maxP;return `<tr${win?' class="comp-win"':''}><td style="white-space:nowrap">${e.datum||""}</td><td>${esc(e.skytt)}</td><td class="num">${p!=null?fmt(p):""}</td></tr>`;}).join("")}</tbody>`+
    `</table></div></div>`;
  }).join("");
```

- [ ] **Step 3: Syntax + structural check**

Run:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n;\n');fs.writeFileSync('.tmp-app.js',b);" && node --check .tmp-app.js && echo SYNTAX_OK && rm .tmp-app.js
node -e "const h=require('fs').readFileSync('index.html','utf8');const need=['function compTotals','function renderTotals','data-tab=\"panelTotals\"','id=\"panelTotals\"','id=\"totalsTbody\"','class=\"comp-win\"','.comp-win{font-weight:700}','renderTotals();'];const miss=need.filter(s=>!h.includes(s));console.log(miss.length?('MISSING: '+miss.join(' | ')):'STRUCT_OK');"
```
Expected: `SYNTAX_OK` then `STRUCT_OK`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Tavlingsresultat: bold the winning row of each competition table"
```

---

### Task 4: Bump the service-worker version

**Files:**
- Modify: `sw.js:6`

- [ ] **Step 1: Bump `VERSION`**

Find:
```js
const VERSION = "v26";
```
Replace with:
```js
const VERSION = "v27";
```

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "Bump sw VERSION to v27"
```

---

## Manual verification (after deploy / hard-refresh)

- **Tävling tab:** each competition table shows its top score in bold (ties → both bold); Övningsskjutning has nothing bolded.
- **Totals tab:** appears between Tävling and Medlemmar (for admin *and* revisor); lists shooters ranked by total competition points, with correct Segrar and Tävlingar; Övningsskjutning points are not included; empty state shows for a year with no competition points; changing År updates it.

## Self-review notes

- **Spec coverage:** bold winner non-Övning (Task 3), `.comp-win` CSS (Task 3), `compTotals` w/ exclusions + sort + segrar/tavlingar (Task 1), `renderTotals` + columns (Task 2 Step 3), tab button + panel between Tävling and Medlemmar, no role gating (Task 2 Steps 1-2), `renderAdmin` call (Task 2 Step 4), sw bump (Task 4). All mapped.
- **Name consistency:** `compTotals`→`renderTotals`→`#totalsTbody`/`#totalsCount`/`#totalsEmpty`/`#panelTotals` and `data-tab="panelTotals"` all align; `.comp-win` defined (Task 3 Step 1) and applied (Task 3 Step 2).
- **No placeholders:** every step shows exact before/after.
