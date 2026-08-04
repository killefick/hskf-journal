# Member Guide Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Swedish guide page at `https://hskf.se/guide.html` for new members, linked from the invite email template and from the app ("Hjälp").

**Architecture:** One new self-contained static HTML file at the repo root (inline CSS, no JS, system fonts). Two one-line links added to `index.html`. Version bumps in `sw.js` and `index.html`. One documentation edit in `docs/supabase-setup.md` recording the email-template line the admin pastes into the Supabase dashboard.

**Tech Stack:** Plain HTML/CSS, GitHub Pages (deploys on push to `main`), Node for syntax-checking the inline script.

**Spec:** `docs/superpowers/specs/2026-08-04-member-guide-page-design.md`

**Spec deviation (verified against the code):** the spec's "Din statistik" section assumed members have a personal stats view. They don't — a member's logged-in view is the minimal log view only (today's date, own name locked, "Antal skott" + "Lägg till", and today's entry list; `index.html:1466-1470`). The guide therefore describes what members actually see (today's list) instead of a stats page, and lets the invoice email serve as the periodic summary.

## Global Constraints

- All user-facing guide text is Swedish; page has `lang="sv"`.
- Palette must match the app (`index.html:21-27`): paper `#e9f1f9`, ink `#1d2733`, ink-soft `#5a6b7b`, forest `#2079cc`, forest-d `#155b9e`, cream `#f3ecdd`, line `#cfddeb`.
- Do **not** add `guide.html` to `ASSETS` in `sw.js` (precache list must only ever contain the existing, verified-served entries — a bad entry has bricked updates before).
- Per-deploy convention: bump `sw.js` `VERSION` **and** `index.html` `APP_VERSION` together. Both are currently `"v.91"`; this deploy makes both `"v.92"`.
- No test framework exists. Verification = `node --check` on the extracted inline script + manual eyeballing.
- Commits go directly on `main` (user's standing preference); push deploys to GitHub Pages.

---

### Task 1: Create `guide.html`

**Files:**
- Create: `guide.html` (repo root)

**Interfaces:**
- Produces: the public URL `https://hskf.se/guide.html`, referenced verbatim by Task 2 (app links) and Task 3 (email template doc).

- [ ] **Step 1: Write the file**

Create `guide.html` at the repo root with exactly this content:

```html
<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kom igång – Skjutjournal, Hillareds skytteförening</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<meta name="theme-color" content="#155b9e">
<style>
  :root{
    --paper:#e9f1f9; --card:#ffffff; --ink:#1d2733; --ink-soft:#5a6b7b;
    --forest:#2079cc; --forest-d:#155b9e; --cream:#f3ecdd;
    --line:#cfddeb; --line-2:#e2ebf4;
    --shadow:0 1px 2px rgba(15,40,70,.06),0 8px 24px -12px rgba(15,40,70,.30);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font-family:"Hanken Grotesk","Segoe UI",system-ui,sans-serif;
    font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
  header{background:linear-gradient(160deg,var(--forest) 0%,var(--forest-d) 100%);
    color:var(--cream);padding:34px 18px 30px;text-align:center}
  header .club{font-size:12px;letter-spacing:.18em;text-transform:uppercase;
    color:#aacbe8;font-weight:600;margin:0 0 6px}
  header h1{font-size:clamp(26px,5vw,36px);margin:0 0 8px;line-height:1.1;font-weight:700}
  header p{margin:0;font-size:14px;color:#c2d7ea}
  main{max-width:680px;margin:0 auto;padding:26px 18px 10px}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;
    box-shadow:var(--shadow);padding:20px 22px;margin-bottom:18px}
  h2{font-size:19px;margin:0 0 10px;color:var(--forest-d)}
  p{margin:0 0 10px}
  p:last-child{margin-bottom:0}
  ol{margin:0;padding-left:0;list-style:none;counter-reset:steg}
  ol li{counter-increment:steg;display:flex;gap:12px;align-items:baseline;margin-bottom:10px}
  ol li::before{content:counter(steg);flex:0 0 26px;height:26px;line-height:26px;
    text-align:center;background:var(--forest);color:var(--cream);border-radius:50%;
    font-weight:700;font-size:14px;align-self:center}
  ol li:last-child{margin-bottom:0}
  b{color:var(--forest-d)}
  .note{background:var(--cream);border-radius:10px;padding:12px 14px;font-size:14px;margin-top:12px}
  a{color:var(--forest);font-weight:600}
  .cta{display:inline-block;background:var(--forest);color:var(--cream);text-decoration:none;
    border-radius:10px;padding:12px 22px;font-weight:600;margin-top:4px}
  footer{text-align:center;color:var(--ink-soft);font-size:12.5px;padding:14px 18px 30px;line-height:1.7}
</style>
</head>
<body>

<header>
  <p class="club">Hillareds skytteförening</p>
  <h1>Kom igång med skjutjournalen</h1>
  <p>Så här registrerar du ditt skytte i föreningens digitala skjutjournal</p>
</header>

<main>

  <section>
    <h2>Välkommen</h2>
    <p>Föreningen använder en digital skjutjournal på <a href="https://hskf.se">hskf.se</a>.
    Där registrerar du hur många skott du skjutit – varje gång du skjuter.
    Journalen är föreningens underlag för egenkontroll och för fakturering av ammunition.</p>
  </section>

  <section>
    <h2>1. Skaffa inloggning</h2>
    <ol>
      <li><span>Du får ett välkomstmejl från <b>noreply@hskf.se</b> med ämnet
        ”Välkommen till Hillareds skytteförenings skjutjournal”.</span></li>
      <li><span>Klicka på länken <b>Välj lösenord och logga in</b> i mejlet.</span></li>
      <li><span>Välj ett eget lösenord – sedan är du inloggad och klar.</span></li>
    </ol>
    <div class="note"><b>Har länken slutat fungera?</b> Den är bara giltig en begränsad tid.
    Gå till <a href="https://hskf.se">hskf.se</a>, fyll i din e-postadress och tryck på
    ”Glömt lösenord?” så får du en ny länk.</div>
  </section>

  <section>
    <h2>2. Lägg till som app i mobilen</h2>
    <p>Då fungerar journalen som en vanlig app, med egen ikon på hemskärmen.</p>
    <p><b>iPhone:</b> öppna <a href="https://hskf.se">hskf.se</a> i Safari, tryck på
    dela-knappen (fyrkanten med pil) och välj <b>Lägg till på hemskärmen</b>.</p>
    <p><b>Android:</b> öppna <a href="https://hskf.se">hskf.se</a> i Chrome, tryck på
    menyn (⋮) och välj <b>Lägg till på startskärmen</b>.</p>
  </section>

  <section>
    <h2>3. Registrera ditt skytte</h2>
    <ol>
      <li><span>Öppna appen (eller <a href="https://hskf.se">hskf.se</a>) och logga in.</span></li>
      <li><span>Fyll i <b>Antal skott</b>.</span></li>
      <li><span>Tryck på <b>Lägg till</b>.</span></li>
    </ol>
    <p style="margin-top:10px">Datumet sätts automatiskt till idag och skotten registreras
    på dig. Dagens registreringar visas i listan under formuläret.</p>
  </section>

  <section>
    <h2>Ammunition och faktura</h2>
    <p>Skjuter du föreningens ammunition debiteras den två gånger per år. Fakturan
    kommer med e-post från <b>noreply@hskf.se</b> och bygger på det som registrerats
    på dig i journalen – därför är det viktigt att alla skott registreras.</p>
  </section>

  <section>
    <h2>Frågor?</h2>
    <p><b>Glömt lösenordet?</b> Fyll i din e-postadress på inloggningssidan och tryck
    på ”Glömt lösenord?”.</p>
    <p><b>Annat?</b> Hör av dig till styrelsen, så hjälper vi dig.</p>
    <p style="margin-top:14px"><a class="cta" href="https://hskf.se">Öppna skjutjournalen →</a></p>
  </section>

</main>

<footer>Hillareds skytteförening · org.nr 865000-4503 · <a href="https://hskf.se">hskf.se</a></footer>

</body>
</html>
```

Note: the font stack lists "Hanken Grotesk" first so the page uses it when the
browser has it cached from the app, falling back to system fonts — the guide
deliberately loads no external fonts.

- [ ] **Step 2: Eyeball it locally**

Open the file in a browser (`start guide.html` from PowerShell in the repo root).
Check: renders correctly at mobile width (DevTools, 375 px), all six sections
present, no horizontal scroll, links point at `https://hskf.se`.

- [ ] **Step 3: Commit**

```powershell
git add guide.html
git commit -m "Add member guide page (guide.html)"
```

---

### Task 2: Hjälp links in the app + version bumps

**Files:**
- Modify: `index.html` (login card ~line 221, footer ~line 337, `APP_VERSION` line 435)
- Modify: `sw.js` (`VERSION` line 6)

**Interfaces:**
- Consumes: `guide.html` from Task 1 (relative link — same origin, works locally and on hskf.se).

- [ ] **Step 1: Add Hjälp link to the login card**

In `index.html`, the login card currently ends with (line 221):

```html
        <div style="text-align:center;margin-top:12px"><a href="#" id="forgotLink" style="font-size:13px;color:var(--forest)">Glömt lösenord?</a></div>
```

Replace with:

```html
        <div style="text-align:center;margin-top:12px"><a href="#" id="forgotLink" style="font-size:13px;color:var(--forest)">Glömt lösenord?</a> <span style="color:var(--line)">·</span> <a href="guide.html" style="font-size:13px;color:var(--forest)">Hjälp</a></div>
```

- [ ] **Step 2: Add Hjälp link to the footer**

The footer currently reads (lines 337–340):

```html
  <footer>
    Underlag för egenkontroll (förordning 1998:901) och bullerbedömning (NFS 2005:15).
    <br><span id="appVer" class="hint"></span>
  </footer>
```

Replace with:

```html
  <footer>
    Underlag för egenkontroll (förordning 1998:901) och bullerbedömning (NFS 2005:15).
    <br><a href="guide.html" style="color:var(--forest)">Hjälp – kom igång med journalen</a>
    <br><span id="appVer" class="hint"></span>
  </footer>
```

- [ ] **Step 3: Bump both versions**

In `index.html` line 435: `const APP_VERSION = "v.91";` → `const APP_VERSION = "v.92";`
In `sw.js` line 6: `const VERSION = "v.91";` → `const VERSION = "v.92";`
Do **not** touch the `ASSETS` list in `sw.js`.

- [ ] **Step 4: Syntax-check the inline script**

```powershell
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];fs.writeFileSync('_check.js',m.map(x=>x[1]).join('\n'));"
node --check _check.js
del _check.js
```

Expected: `node --check` prints nothing (exit 0).

- [ ] **Step 5: Commit**

```powershell
git add index.html sw.js
git commit -m "Link Hjälp/guide from login and footer; v.92"
```

---

### Task 3: Document the invite-email line in `docs/supabase-setup.md`

**Files:**
- Modify: `docs/supabase-setup.md` (sections 6a lines 88–95 and 6b lines 109–117)

**Interfaces:**
- Consumes: the URL `https://hskf.se/guide.html` from Task 1.
- Produces: the exact copy the admin pastes into the Supabase dashboard (manual step — Authentication → Email Templates).

- [ ] **Step 1: Update the invite template (6a)**

In the 6a HTML body block, after the line

```
    <p>När du har loggat in kan du registrera dina skjuttillfällen och se din statistik.</p>
```

insert:

```
    <p>En guide som visar hur du kommer igång finns på
    <a href="https://hskf.se/guide.html">hskf.se/guide.html</a>.</p>
```

Also change the pre-existing line above to match reality (members have no stats view):

```
    <p>När du har loggat in kan du registrera dina skjutna skott.</p>
```

- [ ] **Step 2: Update the reset-password template (6b)**

In the 6b HTML body block, after the line

```
    <p><a href="{{ .ConfirmationURL }}">Välj nytt lösenord</a></p>
```

insert:

```
    <p>Guide: <a href="https://hskf.se/guide.html">hskf.se/guide.html</a></p>
```

- [ ] **Step 3: Add a dated note that the dashboard must be updated**

Directly under the `### 6a. Svensk mall för inbjudan` heading, add:

```
> **2026-08-04:** mallen nedan uppdaterad med länk till guiden
> (https://hskf.se/guide.html). Klistra in den nya brödtexten i dashboarden
> (Authentication → Email Templates → "Invite user" resp. "Reset Password").
```

- [ ] **Step 4: Commit and push**

```powershell
git add docs/supabase-setup.md
git commit -m "Document guide link in invite/reset email templates"
git push
```

Push deploys `guide.html` + v.92 to GitHub Pages.

---

### Manual follow-up (user, Supabase dashboard)

Not a code task — after deploy, the admin pastes the updated 6a/6b template
bodies into Supabase (Authentication → Email Templates). Until then, invite
emails go out without the guide link; the app links work immediately.

### Final verification

- Visit `https://hskf.se/guide.html` after Pages deploy (may take a minute).
- Load `https://hskf.se`, confirm the update banner appears and, after tapping
  it, the footer shows v.92 and the Hjälp links work logged-out and logged-in.
- Optional: send a test invite after the dashboard edit and confirm the guide
  link renders in the email.
