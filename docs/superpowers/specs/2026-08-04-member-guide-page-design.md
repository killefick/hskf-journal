# Spec: Member guide page (guide.html) linked from invite email and app

**Date:** 2026-08-04
**Status:** Approved, ready for implementation plan

## Goal

Newly registered members get a clear explanation of what to do after being
invited: set a password, install the app on their phone, register shooting
sessions, and understand the ammo invoice. The explanation lives at a stable
URL so it also helps existing members and can be printed/linked anywhere.

## Approach

A standalone static Swedish page **`guide.html`** at the repo root, served at
`https://hskf.se/guide.html`. The Supabase invite email template gets one added
line linking to it, and the app links to it ("Hjälp") from the login screen and
the logged-in menu/footer. The page requires no login — new members read it
before they can log in.

Rejected alternatives: a help section inside `index.html` (behind login, grows
the single file) and email-only instructions (frozen per sent email, not
findable later).

## Changes

### 1. New file — `guide.html` (repo root)

- Swedish (`lang="sv"`), mobile-first, self-contained (inline CSS, no JS
  needed).
- Styled with the app/poster palette: blue `#155b9e` / `#2079cc`, cream
  `#f3ecdd`, so it reads as the same product. Header band like the poster's.
- Content sections, in order:
  1. **Välkommen** — one paragraph: what the digital skjutjournal is and why
     the club uses it.
  2. **Kom igång** — invite email arrives from `noreply@hskf.se`; click the
     link, choose a password, you land in the app. Note: the invite link
     expires; if it stopped working, use "Glömt lösenord?" on the login page
     at `hskf.se` to get a fresh link.
  3. **Lägg till som app** — iPhone (Safari: Dela → Lägg till på hemskärmen)
     and Android (Chrome: meny ⋮ → Lägg till på startskärmen).
  4. **Registrera skytte** — short numbered steps mirroring the actual UI
     field labels in `index.html` (verified against the live markup during
     implementation, not paraphrased from memory).
  5. **Din statistik** — what a member sees about their own shooting.
  6. **Ammunitionsfaktura** — ammo invoices arrive by email from
     `noreply@hskf.se`, based on the sessions the member registered and the
     club's per-shot price.
  7. **Glömt lösenord / Kontakt** — reset flow; contact styrelsen for
     anything else (no personal email addresses on the page).
- Footer matching the poster: club name, org.nr, `hskf.se`.

### 2. `index.html` — Hjälp links

- Login screen: a small "Hjälp" link to `guide.html`.
- Logged-in view: a "Hjälp" link in the footer to `guide.html` (footer, not
  the menu — visible without opening anything).
- Bump `APP_VERSION`.

### 3. `sw.js`

- Bump `VERSION` (per-deploy convention).
- Do **not** add `guide.html` to `ASSETS`: it loads fine from the network, and
  keeping it out of the precache list means zero risk to the update flow
  (which was once bricked by a bad asset entry).

### 4. Supabase dashboard — invite email template (manual step)

Documented in `docs/supabase-setup.md`:

- In Authentication → Email Templates → "Invite user", add after the
  confirmation link:
  > En guide som visar hur du kommer igång finns på https://hskf.se/guide.html
- Optionally add the same line to the "Reset password" template.

These are one-time manual dashboard edits performed by the admin; the doc
records the exact copy.

## Verification

- `node --check` the extracted inline script from `index.html` (unchanged
  logic, but the file is edited).
- Confirm both version bumps: `sw.js` `VERSION` and `index.html`
  `APP_VERSION`.
- Open `guide.html` locally and check layout at mobile width.
- Optional manual smoke test after deploy: send a real invite, confirm the
  guide link appears and works.

## Out of scope (YAGNI)

- Emailing existing members about the guide.
- Translations.
- In-app onboarding overlay/checklist.
- Ledare/admin documentation (member basics only).
