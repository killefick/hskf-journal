# Tävlingsresultat per-tävling tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the admin Tävlingsresultat card as one table per competition (grouped by `tavling_namn`), with all "Övningsskjutning" rows merged into a single table shown last.

**Architecture:** Pure rendering change inside `renderComp()`. A new pure helper `compGroups(rows)` returns ordered `[name, sortedRows]` groups (node-testable, no DOM). `renderComp()` consumes it to emit one `<table>` per group into a `#compTables` container. No DB, write path, or export changes.

**Tech Stack:** Single static `index.html` (vanilla JS, no build), PWA service worker. No test framework — verification is a one-off node logic test + `node --check` of the inline script (project convention).

**Testing note:** Do not introduce a test runner. The node command in Task 1 extracts the real `compGroups` from `index.html` by brace-matching and asserts against it.

---

### Task 1: Group the competition view into one table per tävling

**Files:**
- Modify: `index.html:92` (add CSS rule)
- Modify: `index.html:287-292` (markup: single table → container)
- Modify: `index.html:646-653` (`renderComp` rewrite + new `compGroups` helper)

- [ ] **Step 1: Write the failing logic test**

Create `C:\GIT\hskf-journal\.tmp-comp-test.js` with exactly:

```js
const fs = require("fs");
const assert = require("assert");
const h = fs.readFileSync("index.html", "utf8");

// Extract `function compGroups(rows){ ... }` by brace-matching (robust to nested braces).
const start = h.indexOf("function compGroups(rows){");
if (start === -1) { console.error("compGroups not found"); process.exit(1); }
let depth = 0, end = -1;
for (let i = h.indexOf("{", start); i < h.length; i++) {
  if (h[i] === "{") depth++;
  else if (h[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
const src = h.slice(start, end);

const TAVLINGAR = ["Övningsskjutning","FSR Propagandatävlan","Vårpokalen","D. von Schedvins vandringspris","Korporationsskjutning","Höstpokalen"];
const compGroups = new Function("TAVLINGAR", "return (" + src + ")")(TAVLINGAR);

const rows = [
  {tavling_namn:"Höstpokalen", skytt:"A", poang:90, datum:"2026-09-01"},
  {tavling_namn:"Höstpokalen", skytt:"B", poang:95, datum:"2026-09-01"},
  {tavling_namn:"Övningsskjutning", skytt:"C", poang:40, datum:"2026-06-10"},
  {tavling_namn:"Övningsskjutning", skytt:"D", poang:null, datum:"2026-06-12"},
  {tavling_namn:"Vårpokalen", skytt:"E", poang:88, datum:"2026-05-03"},
  {tavling_namn:"Vårpokalen", skytt:"F", poang:97, datum:"2026-05-03"},
  {tavling_namn:"Klubbmatch", skytt:"G", poang:50, datum:"2026-07-01"},
  {tavling_namn:"", skytt:"H", poang:30, datum:"2026-04-01"},
];
const g = compGroups(rows);
const names = g.map(x => x[0]);
assert.deepStrictEqual(names, ["Vårpokalen","Höstpokalen","Övrigt","Klubbmatch","Övningsskjutning"], "group order: " + JSON.stringify(names));
assert.deepStrictEqual(g.find(x => x[0]==="Vårpokalen")[1].map(r => r.skytt), ["F","E"], "Vårpokalen by poäng desc");
assert.deepStrictEqual(g.find(x => x[0]==="Övningsskjutning")[1].map(r => r.skytt), ["D","C"], "Övning by date desc");
console.log("COMP_OK");
```

- [ ] **Step 2: Run it — expect FAIL (function not defined yet)**

Run (Bash tool, repo root):
```bash
node .tmp-comp-test.js
```
Expected: `compGroups not found` and a non-zero exit (the helper doesn't exist yet).

- [ ] **Step 3: Add the CSS rule**

In `index.html`, find line 92:
```css
  .datum-fast{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#f3f8fd;color:var(--ink);font-size:16px;font-variant-numeric:tabular-nums}
```
Add a new line immediately after it:
```css
  .comp-group{margin-bottom:18px}
```

- [ ] **Step 4: Replace the competition-table markup**

Find (lines 287-292):
```html
      <div class="tbl-scroll">
        <table>
          <thead><tr><th>Datum</th><th>Tävling</th><th>Skytt</th><th style="text-align:right">Poäng</th></tr></thead>
          <tbody id="compTbody"></tbody>
        </table>
      </div>
```
Replace with:
```html
      <div id="compTables"></div>
```

- [ ] **Step 5: Rewrite `renderComp` and add the `compGroups` helper**

Find (lines 646-653):
```js
function renderComp(){
  const y=$("#a-year").value||currentYearStr();
  const rows=entriesForYear(y).filter(e=>e.tavling||(e.poang!=null&&e.poang!==""))
    .sort((a,b)=>(b.datum||"").localeCompare(a.datum||"")||((+b.poang||0)-(+a.poang||0)));
  $("#compCount").textContent=`(${rows.length})`;
  $("#compEmpty").style.display=rows.length?"none":"block";
  $("#compTbody").innerHTML=rows.map(e=>`<tr><td style="white-space:nowrap">${e.datum||""}</td><td>${esc(e.tavling_namn)}</td><td>${esc(e.skytt)}</td><td class="num">${(e.poang!=null&&e.poang!=="")?fmt(e.poang):""}</td></tr>`).join("");
}
```
Replace with:
```js
// Pure: groups competition rows by tavling_namn and returns ordered [name, sortedRows].
// Order: TAVLINGAR names (except practice) in list order, then other names alpha (sv),
// then "Övningsskjutning" last. Competition tables sort by poäng desc (blanks last,
// tiebreak date desc); the practice table sorts by date desc.
function compGroups(rows){
  const PRACTICE="Övningsskjutning";
  const groups=new Map();
  for(const e of rows){ const k=(e.tavling_namn||"").trim(); if(!groups.has(k))groups.set(k,[]); groups.get(k).push(e); }
  const pv=e=>(e.poang!=null&&e.poang!=="")?+e.poang:-Infinity;
  const order=[];
  for(const t of TAVLINGAR){ if(t!==PRACTICE && groups.has(t)) order.push(t); }
  [...groups.keys()].filter(k=>k!==PRACTICE && !TAVLINGAR.includes(k))
    .sort((a,b)=>a.localeCompare(b,"sv")).forEach(k=>order.push(k));
  if(groups.has(PRACTICE)) order.push(PRACTICE);
  return order.map(k=>{
    const list=groups.get(k).slice();
    if(k===PRACTICE) list.sort((a,b)=>(b.datum||"").localeCompare(a.datum||""));
    else list.sort((a,b)=>(pv(b)-pv(a))||(b.datum||"").localeCompare(a.datum||""));
    return [k||"Övrigt", list];
  });
}
function renderComp(){
  const y=$("#a-year").value||currentYearStr();
  const rows=entriesForYear(y).filter(e=>e.tavling||(e.poang!=null&&e.poang!==""));
  $("#compCount").textContent=`(${rows.length})`;
  $("#compEmpty").style.display=rows.length?"none":"block";
  $("#compTables").innerHTML=compGroups(rows).map(([name,list])=>
    `<div class="comp-group"><h3>${esc(name)} <span class="hint">(${list.length})</span></h3>`+
    `<div class="tbl-scroll"><table>`+
    `<thead><tr><th>Datum</th><th>Skytt</th><th style="text-align:right">Poäng</th></tr></thead>`+
    `<tbody>${list.map(e=>`<tr><td style="white-space:nowrap">${e.datum||""}</td><td>${esc(e.skytt)}</td><td class="num">${(e.poang!=null&&e.poang!=="")?fmt(e.poang):""}</td></tr>`).join("")}</tbody>`+
    `</table></div></div>`
  ).join("");
}
```

- [ ] **Step 6: Run the logic test — expect PASS**

Run:
```bash
node .tmp-comp-test.js
```
Expected: prints `COMP_OK`, exit 0.

- [ ] **Step 7: Syntax-check the whole inline script**

Run:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n;\n');fs.writeFileSync('.tmp-app.js',b);" && node --check .tmp-app.js && echo SYNTAX_OK && rm .tmp-app.js
```
Expected: `SYNTAX_OK`.

- [ ] **Step 8: Remove the temp test and commit**

```bash
rm .tmp-comp-test.js
git add index.html
git commit -m "Tavlingsresultat: one table per tavling, ovningsskjutning merged last"
```

---

### Task 2: Bump the service-worker version

**Files:**
- Modify: `sw.js:6`

- [ ] **Step 1: Bump `VERSION`**

Find:
```js
const VERSION = "v21";
```
Replace with:
```js
const VERSION = "v22";
```

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "Bump sw VERSION to v22"
```

---

## Self-review notes

- **Spec coverage:** grouping by name (Task 1 Step 5 `compGroups`), table order incl. custom/empty names + Övning last (`order` construction), within-table sort poäng-desc vs date-desc (the two `list.sort` branches), columns Datum/Skytt/Poäng with name as heading (renderComp template), empty state preserved (`#compEmpty` + `#compCount` unchanged), markup container (Step 4), CSS (Step 3), export untouched, sw bump (Task 2). All mapped.
- **Name consistency:** `compGroups` defined and called in the same step; `#compTables` created in Step 4 and written in Step 5; `pv` helper local to `compGroups`.
- **No placeholders:** every code step shows exact before/after.
