# Ammunition Invoice Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin email each shooter a plain-text ammunition invoice (itemized purchased shots per date, total in kr, Bankgiro 370-4624, reference `<namn> Ammunition`) from the "Att betala" list, one shooter or all at once.

**Architecture:** A new admin-gated Supabase edge function (`send-invoice`) sends mail through Brevo's transactional HTTP API and records per-shooter email + last-sent date in a new `skytt_faktura` table. The client (`index.html`) builds the plain-text body, captures emails inline, and adds per-row + bulk send buttons in the existing per-shooter table. No client ever reads the email table directly.

**Tech Stack:** Static HTML/JS app (no build, no test framework), Supabase (Postgres + Deno edge functions), Brevo transactional email API.

**Verification note:** This project has no test framework. Verification is `node --check` on the extracted inline script plus a manual smoke test, per `docs/superpowers/specs/...` and project convention. Tasks reflect that instead of unit tests.

**Parallelism:** Tasks 1, 3, 4 touch disjoint files and can be dispatched to parallel subagents. Task 2 (all `index.html` changes) is one file — do it as a single task, not split across agents. Task 5 (sw.js + final check) runs last because its final `node --check` depends on Task 2.

**Manual SQL (run once in Supabase, not part of any code task):**

```sql
create table skytt_faktura (
  skytt_namn      text primary key,
  email           text,
  faktura_skickad timestamptz
);
alter table skytt_faktura enable row level security;
```

---

### Task 1: Edge function `send-invoice`

**Files:**
- Create: `supabase/functions/send-invoice/index.ts`
- Create: `supabase/functions/send-invoice/deno.json`

- [ ] **Step 1: Create `deno.json`**

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: Create `index.ts`** (mirrors `admin-members`: CORS, admin-only auth check, action dispatch)

```ts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "Hillareds skytteförening";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // --- verify caller is an admin ---
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Missing auth" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ ok: false, error: "Invalid auth" }, 401);
  const callerId = userData.user.id;

  const { data: prof, error: profErr } = await admin
    .from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (profErr) return json({ ok: false, error: "Role lookup failed: " + profErr.message }, 500);
  if (!prof || prof.role !== "admin") return json({ ok: false, error: "Forbidden" }, 403);

  // --- dispatch ---
  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
  const action = payload?.action;

  try {
    if (action === "meta") {
      const { data, error } = await admin
        .from("skytt_faktura").select("skytt_namn, email, faktura_skickad");
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (action === "saveEmail") {
      const skytt_namn = (payload.skytt_namn ?? "").trim();
      const email = (payload.email ?? "").trim();
      if (!skytt_namn) return json({ ok: false, error: "Namn saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      const { error } = await admin.from("skytt_faktura").upsert({ skytt_namn, email });
      if (error) throw error;
      return json({ ok: true, data: { skytt_namn, email } });
    }

    if (action === "send") {
      const skytt_namn = (payload.skytt_namn ?? "").trim();
      const email = (payload.email ?? "").trim();
      const subject = payload.subject ?? "";
      const text = payload.text ?? "";
      if (!skytt_namn) return json({ ok: false, error: "Namn saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      if (!BREVO_API_KEY) return json({ ok: false, error: "BREVO_API_KEY saknas" }, 500);
      if (!isEmail(BREVO_SENDER_EMAIL)) return json({ ok: false, error: "BREVO_SENDER_EMAIL saknas/ogiltig" }, 500);

      const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({
          sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
          to: [{ email }],
          subject,
          textContent: text,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        return json({ ok: false, error: "Brevo " + resp.status + ": " + detail }, 502);
      }
      const { error } = await admin.from("skytt_faktura")
        .upsert({ skytt_namn, email, faktura_skickad: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true, data: { skytt_namn, email } });
    }

    return json({ ok: false, error: "Okänd action" }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 3: Type-check if Deno is available (optional)**

Run: `deno check supabase/functions/send-invoice/index.ts`
Expected: no errors. If `deno` is not installed locally, skip — the function is verified at deploy time (`supabase functions deploy send-invoice`) and in the Task 6 smoke test.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-invoice/index.ts supabase/functions/send-invoice/deno.json
git commit -m "Add send-invoice edge function (Brevo) for ammunition invoices"
```

---

### Task 2: Client — invoice UI and logic in `index.html`

All changes are in `index.html`. Do them in order; each step shows the exact anchor and replacement.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the bulk-send button to the per-shooter table header**

Find (line ~278):

```html
        <div style="margin-top:20px"><div class="label" style="margin-bottom:8px">Skott &amp; kostnad per skytt</div>
```

Replace with:

```html
        <div style="margin-top:20px"><div class="label" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px">Skott &amp; kostnad per skytt <button class="btn ghost tiny hide" id="sendAllFaktura">Skicka alla fakturor</button></div>
```

- [ ] **Step 2: Add `fakturaMeta` state**

Find (line ~613):

```js
let members=[];
```

Replace with:

```js
let members=[];
// skytt_namn -> { email, faktura_skickad } (laddas admin-gated via send-invoice)
let fakturaMeta={};
```

- [ ] **Step 3: Add the meta loader and invoice-text builder**

Insert these two functions immediately **before** `function renderAdmin(){` (line ~554):

```js
// Laddar e-post + senast-skickat per skytt (endast admin, via edge-funktionen).
async function loadFakturaMeta(){
  if(!REMOTE||!isAdmin){ fakturaMeta={}; return; }
  const {data,error}=await sb.functions.invoke("send-invoice",{body:{action:"meta"}});
  if(error||!data||!data.ok){ fakturaMeta={}; return; }
  const m={};
  (data.data||[]).forEach(r=>{ m[(r.skytt_namn||"").trim()]={email:r.email||"",faktura_skickad:r.faktura_skickad||null}; });
  fakturaMeta=m;
  renderAdmin();
}

// Bygger klartext-faktura för en skytt och ett år. Fakturerar endast kvarstående
// (köpt & ej betald) skott, en rad per skjutdag.
function buildInvoiceText(name, year){
  const byDate={};
  entriesForYear(year)
    .filter(e=>(e.skytt||"–").trim()===name && e.kopt && !e.betald && (+e.antal_skott||0)>0)
    .forEach(e=>{ byDate[e.datum]=(byDate[e.datum]||0)+(+e.antal_skott||0); });
  const dates=Object.keys(byDate).sort();
  const totalSkott=dates.reduce((s,d)=>s+byDate[d],0);
  const totalKr=totalSkott*(+PRIS_PER_SKOTT||0);
  const lines=dates.map(d=>`  ${d}    ${fmt(byDate[d])} skott`);
  const subject=`Faktura ammunition – Hillareds skytteförening ${year}`;
  const text=
`Hej ${name},

Faktura för ammunition – Hillareds skytteförening ${year}.

Köpta skott:
${lines.join("\n")}
Totalt: ${fmt(totalSkott)} skott × ${fmt(PRIS_PER_SKOTT)} kr = ${fmt(totalKr)} kr

Betalas till Bankgiro: 370-4624
Ange som meddelande: ${name} Ammunition

Tack!
Hillareds skytteförening`;
  return { subject, text, totalSkott, totalKr };
}
```

- [ ] **Step 4: Render email info + invoice button in the shooter table, and toggle the bulk button**

Find (lines ~575-584):

```js
  $("#shooterTbody").innerHTML=list.map(([n,v])=>{
    const act = !isAdmin||!hasPrices ? ""
      : v.out>0 ? `<button class="btn ghost tiny" data-paid="${esc(n)}" data-y="${y}">Markera betald</button>`
      : v.paid>0 ? `<span class="pill medlem" style="margin-right:6px">✓ betald</span><button class="btn ghost tiny" data-unpaid="${esc(n)}" data-y="${y}">Ångra</button>`
      : "";
    return `<tr><td>${esc(n)}</td><td class="num" style="text-align:left">${v.dagar.size}</td><td class="num">${fmt(v.skott)}</td><td class="num">${fmt(v.kopta)}</td><td class="num">${kr(v.out)}</td><td style="text-align:right;white-space:nowrap">${act}</td></tr>`;
  }).join("")||`<tr><td colspan="6" style="color:var(--ink-soft)">Inga poster</td></tr>`;
  $("#priceHint").textContent = hasPrices
```

Replace with:

```js
  $("#shooterTbody").innerHTML=list.map(([n,v])=>{
    const fm=fakturaMeta[n]||{};
    const fakturaInfo=(isAdmin&&hasPrices&&REMOTE&&v.out>0)
      ? `<div style="margin-top:4px;font-weight:400">`
        + (fm.email?`<span class="hint">${esc(fm.email)}</span>`:`<span class="hint" style="color:#b00020">ingen e-post</span>`)
        + ` <button class="btn ghost tiny" data-mailedit="${esc(n)}">✎ e-post</button>`
        + (fm.faktura_skickad?` <span class="pill medlem">Skickad ${esc(String(fm.faktura_skickad).slice(0,10))}</span>`:``)
        + `</div>`
      : "";
    const act = !isAdmin||!hasPrices ? ""
      : v.out>0 ? `<button class="btn ghost tiny" data-faktura="${esc(n)}" data-y="${y}">Skicka faktura</button> <button class="btn ghost tiny" data-paid="${esc(n)}" data-y="${y}">Markera betald</button>${fakturaInfo}`
      : v.paid>0 ? `<span class="pill medlem" style="margin-right:6px">✓ betald</span><button class="btn ghost tiny" data-unpaid="${esc(n)}" data-y="${y}">Ångra</button>`
      : "";
    return `<tr><td>${esc(n)}</td><td class="num" style="text-align:left">${v.dagar.size}</td><td class="num">${fmt(v.skott)}</td><td class="num">${fmt(v.kopta)}</td><td class="num">${kr(v.out)}</td><td style="text-align:right;white-space:nowrap">${act}</td></tr>`;
  }).join("")||`<tr><td colspan="6" style="color:var(--ink-soft)">Inga poster</td></tr>`;
  $("#sendAllFaktura").classList.toggle("hide", !(isAdmin&&hasPrices&&REMOTE&&list.some(([,v])=>v.out>0)));
  $("#priceHint").textContent = hasPrices
```

- [ ] **Step 5: Add the send/edit helper functions**

Insert immediately **after** the `setShooterPaid` function (after line ~927, before the `$("#shooterTbody").addEventListener` line):

```js
// Skickar en faktura till en skytt. Frågar efter e-post om den saknas och sparar den.
async function sendFaktura(name, year){
  const fm=fakturaMeta[name]||{};
  let email=fm.email;
  if(!email){
    email=(prompt(`E-postadress för faktura till ${name}:`)||"").trim();
    if(!email) return false;
    const sv=await sb.functions.invoke("send-invoice",{body:{action:"saveEmail",skytt_namn:name,email}});
    if(sv.error||!sv.data?.ok){ showBanner("warn","Kunde inte spara e-post: "+esc((sv.data&&sv.data.error)||(sv.error&&sv.error.message)||"okänt fel")); return false; }
    fakturaMeta[name]={...fm,email};
  }
  const {subject,text}=buildInvoiceText(name,year);
  const r=await sb.functions.invoke("send-invoice",{body:{action:"send",skytt_namn:name,email,subject,text}});
  if(r.error||!r.data?.ok){ showBanner("warn",`Kunde inte skicka faktura till ${esc(name)}: `+esc((r.data&&r.data.error)||(r.error&&r.error.message)||"okänt fel")); return false; }
  fakturaMeta[name]={email,faktura_skickad:new Date().toISOString()};
  return true;
}
// Ändrar/sätter sparad e-post för en skytt (utan att skicka).
async function editFakturaEmail(name){
  const cur=(fakturaMeta[name]&&fakturaMeta[name].email)||"";
  const email=(prompt(`E-postadress för ${name}:`,cur)||"").trim();
  if(!email||email===cur) return;
  const sv=await sb.functions.invoke("send-invoice",{body:{action:"saveEmail",skytt_namn:name,email}});
  if(sv.error||!sv.data?.ok){ showBanner("warn","Kunde inte spara e-post: "+esc((sv.data&&sv.data.error)||(sv.error&&sv.error.message)||"okänt fel")); return; }
  fakturaMeta[name]={...(fakturaMeta[name]||{}),email};
  renderAdmin();
}
```

- [ ] **Step 6: Extend the `#shooterTbody` click handler with faktura + mailedit cases**

Find (lines ~928-933):

```js
$("#shooterTbody").addEventListener("click",async e=>{
  if(!isAdmin) return;
  const p=e.target.closest("[data-paid]"), u=e.target.closest("[data-unpaid]");
  if(p && confirm(`Markera ${p.dataset.paid}s köpta skott som betalda för ${p.dataset.y}?`)) await setShooterPaid(p.dataset.paid,p.dataset.y,true);
  else if(u && confirm(`Ångra betald-markering för ${u.dataset.unpaid} (${u.dataset.y})?`)) await setShooterPaid(u.dataset.unpaid,u.dataset.y,false);
});
```

Replace with:

```js
$("#shooterTbody").addEventListener("click",async e=>{
  if(!isAdmin) return;
  const p=e.target.closest("[data-paid]"), u=e.target.closest("[data-unpaid]");
  const f=e.target.closest("[data-faktura]"), me=e.target.closest("[data-mailedit]");
  if(f){
    if(confirm(`Skicka faktura till ${f.dataset.faktura}?`) && await sendFaktura(f.dataset.faktura,f.dataset.y)){
      showBanner("ok",`Faktura skickad till ${f.dataset.faktura}.`,4000); renderAdmin();
    }
  }
  else if(me){ await editFakturaEmail(me.dataset.mailedit); }
  else if(p && confirm(`Markera ${p.dataset.paid}s köpta skott som betalda för ${p.dataset.y}?`)) await setShooterPaid(p.dataset.paid,p.dataset.y,true);
  else if(u && confirm(`Ångra betald-markering för ${u.dataset.unpaid} (${u.dataset.y})?`)) await setShooterPaid(u.dataset.unpaid,u.dataset.y,false);
});
```

- [ ] **Step 7: Add the bulk-send handler**

Insert immediately **after** the `#shooterTbody` click handler block from Step 6:

```js
// Skicka alla fakturor: alla skyttar med kvarstående belopp för året.
$("#sendAllFaktura").addEventListener("click",async()=>{
  if(!isAdmin) return;
  const y=$("#a-year").value||currentYearStr();
  const out={};
  entriesForYear(y).forEach(e=>{const k=(e.skytt||"–").trim(); out[k]=(out[k]||0)+rowOutstanding(e);});
  const targets=Object.keys(out).filter(n=>out[n]>0);
  if(!targets.length){ showBanner("warn","Inga skyttar med kvarstående belopp."); return; }
  const missing=targets.filter(n=>!(fakturaMeta[n]&&fakturaMeta[n].email));
  const already=targets.filter(n=>fakturaMeta[n]&&fakturaMeta[n].email&&fakturaMeta[n].faktura_skickad);
  if(already.length && !confirm(`Faktura har redan skickats till: ${already.join(", ")}.\nSkicka igen till alla med e-post?`)) return;
  if(!confirm(`Skicka faktura till ${targets.length-missing.length} skytt(ar)?${missing.length?` (${missing.length} saknar e-post och hoppas över)`:""}`)) return;
  let sent=0, failed=0;
  for(const n of targets){
    const fm=fakturaMeta[n];
    if(!(fm&&fm.email)) continue;
    const {subject,text}=buildInvoiceText(n,y);
    const r=await sb.functions.invoke("send-invoice",{body:{action:"send",skytt_namn:n,email:fm.email,subject,text}});
    if(r.error||!r.data?.ok){ failed++; } else { sent++; fakturaMeta[n]={email:fm.email,faktura_skickad:new Date().toISOString()}; }
  }
  renderAdmin();
  showBanner(failed?"warn":"ok",`Skickade ${sent} faktura/-or.${failed?` ${failed} misslyckades.`:""}${missing.length?` Saknar e-post: ${missing.join(", ")}.`:""}`,7000);
});
```

- [ ] **Step 8: Load faktura meta when the admin view opens**

Find (lines ~904-905):

```js
  renderAdmin();
  if(isAdmin && REMOTE) loadMembers();
```

Replace with:

```js
  renderAdmin();
  if(isAdmin && REMOTE){ loadMembers(); loadFakturaMeta(); }
```

- [ ] **Step 9: Verify the inline script parses**

Run:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('check.tmp.js',m[m.length-1][1]);"
node --check check.tmp.js && rm check.tmp.js
```

Expected: no output from `node --check` (success). If it errors, fix the reported line before committing.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Invoice UI: per-shooter + bulk Skicka faktura in Att betala"
```

---

### Task 3: Document the Supabase setup

**Files:**
- Modify: `docs/supabase-setup.md`

- [ ] **Step 1: Append a new setup step** at the end of the file:

```markdown
## 7. Faktura för ammunition (e-post)

Admin kan skicka en klartext-faktura per e-post till varje skytt med kvarstående
skottpengar (knapparna **Skicka faktura** / **Skicka alla fakturor** under
**Att betala**). Fakturan listar köpta skott per datum, totalsumma, Bankgiro
**370-4624** och meddelandet `<namn> Ammunition`. E-post per skytt sparas i en
egen tabell; klienten läser den aldrig direkt – allt går via en admin-skyddad
edge-funktion som skickar via Brevo.

### 7a. Tabell för e-post och skickat-status

```sql
create table skytt_faktura (
  skytt_namn      text primary key,   -- trimmad skyttnamn, matchar "Att betala"
  email           text,
  faktura_skickad timestamptz
);

-- RLS på utan policies: service_role (edge-funktionen) kringgår RLS, alla
-- direkta authenticated/anon-läsningar och skrivningar nekas.
alter table skytt_faktura enable row level security;
```

### 7b. Brevo-hemligheter och deploy

Sätt API-nyckel och avsändare som funktionshemligheter (Supabase CLI, inloggad
och länkad till projektet). Avsändaradressen måste vara verifierad i Brevo
(Senders & domains), annars vägras utskick:

```bash
supabase secrets set \
  BREVO_API_KEY=xkeysib-... \
  BREVO_SENDER_EMAIL=styrelsen@hillaredsskf.se \
  BREVO_SENDER_NAME="Hillareds skytteförening"

supabase functions deploy send-invoice
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/supabase-setup.md
git commit -m "Docs: Supabase setup for ammunition invoicing"
```

---

### Task 4: Document invoicing in the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Fakturering" section** immediately after the "Pris och betalning" section (after its closing ``` ``` const PRIS_PER_SKOTT = 9; ``` ``` block, before "## Export"):

```markdown
## Fakturering (ammunition)

Under **Admin & analys → Att betala** kan admin mejla en klartext-faktura till
varje skytt med kvarstående belopp. Per rad finns **Skicka faktura**; saknas
e-post frågar appen efter den och sparar den (ändras med **✎ e-post**).
**Skicka alla fakturor** mejlar alla med kvarstående belopp på en gång – skyttar
utan e-post hoppas över och rapporteras, och redan fakturerade kräver en
bekräftelse innan de mejlas igen. Skickade fakturor visar **Skickad ÅÅÅÅ-MM-DD**.

Fakturan listar köpta (ej betalda) skott per datum, totalsumma, Bankgiro
**370-4624** och meddelandet `<namn> Ammunition`. Utskick sker via edge-funktionen
`send-invoice` och Brevo – se `docs/supabase-setup.md` steg 7 för tabell,
hemligheter och deploy.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Docs: README section for ammunition invoicing"
```

---

### Task 5: Bump service worker version and final verification

**Files:**
- Modify: `sw.js:6`

- [ ] **Step 1: Bump VERSION**

Find: `const VERSION = "v29";`
Replace: `const VERSION = "v30";`

- [ ] **Step 2: Re-run the inline-script check** (confirms Task 2 is intact on the committed tree)

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('check.tmp.js',m[m.length-1][1]);"
node --check check.tmp.js && rm check.tmp.js
```

Expected: success (no error output).

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "Bump sw VERSION to v30 for invoicing release"
```

---

## Manual smoke test (after deploy + SQL + secrets)

1. Run the `skytt_faktura` SQL, set the three Brevo secrets, `supabase functions deploy send-invoice`.
2. As admin, open **Att betala** for a year with an outstanding shooter.
3. Click **Skicka faktura**, enter your own email when prompted.
4. Confirm the email arrives: correct per-date lines, total (`antal × pris = summa`),
   Bankgiro 370-4624, message `<namn> Ammunition`.
5. Confirm the row now shows **Skickad ÅÅÅÅ-MM-DD** and the stored email.
6. Click **✎ e-post**, change the address, confirm it persists after reload.
7. Click **Skicka alla fakturor**; confirm skip/re-send warnings and the summary banner.
```
