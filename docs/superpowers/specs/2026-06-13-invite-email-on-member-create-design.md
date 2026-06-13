# Spec: Swedish invite email on new-member creation

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

When an admin creates a new member, the member receives an email (in Swedish)
telling them where to go and what to do, rather than the admin having to hand
over credentials manually. The member follows a secure link, chooses their own
password, and lands in the app.

## Approach

Use Supabase's **native invite flow** (`inviteUserByEmail`) instead of creating
an account with an admin-typed password. No external email service, no API keys
— the email is sent by Supabase from a Swedish template configured once in the
dashboard, and the app reuses its existing set-password modal for the landing.

This replaces the current `create` behaviour, where the admin types a password
(`createUser({ email, password, email_confirm:true })`) and shares it manually.

## Changes

### 1. Edge Function — `supabase/functions/admin-members/index.ts`, `create` action

- Drop the `password` parameter and its `length < 8` validation.
- Replace
  `admin.auth.admin.createUser({ email, password, email_confirm:true })`
  with
  `admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name } })`.
- `redirectTo` comes from the request payload (the client sends
  `location.origin + location.pathname`, the same URL the password-reset flow
  uses — already allowlisted in Supabase Redirect URLs, setup step 3).
- Keep the existing `profiles` upsert (`id`, `full_name`, `role`). `profiles`
  remains the source of truth for name and role; `data.full_name` is only a
  convenience copy in user metadata.
- Email and role validation are unchanged. A duplicate email still surfaces as
  an error (same behaviour as `createUser` today).

### 2. Client — `index.html`

**Member modal**
- Remove the "Lösenord (minst 8 tecken)" field (`#m-pass`, ~line 371).
- Remove the `$("#m-pass").value=""` reset in the add-member button handler.
- Remove `password` from the `create` invoke body and its validation in the
  save handler.
- Add `redirectTo: location.origin + location.pathname` to the invoke body.
- Change the success banner text to **"Inbjudan skickad."**

**Invite landing**
- An invite link returns with `type=invite` in the URL hash, which supabase-js
  surfaces as a `SIGNED_IN` event — **not** `PASSWORD_RECOVERY`. The current
  `onAuthStateChange` handler only opens the set-password modal on
  `PASSWORD_RECOVERY`, so an invited user would be silently signed in with no
  password set.
- Fix: capture the invite flag early, before supabase-js clears the hash:
  `const inviteFlow = /type=invite/.test(location.hash);`
- Extend the handler to also open `#pwModal` when
  `evt === "SIGNED_IN" && inviteFlow` (then clear the flag).
- Reuse the existing `#pwModal` and its save logic
  (`sb.auth.updateUser({ password })`) unchanged. Optionally set a welcoming
  Swedish heading (e.g. "Välj ett lösenord") for the invite case.

### 3. Supabase dashboard — documented as a new step 6 in `docs/supabase-setup.md`

These are manual one-time steps (the assistant has no project access).

**Invite email template** (Authentication → Email Templates → "Invite user"),
Swedish copy using the `{{ .ConfirmationURL }}` variable:

- **Subject:** Välkommen till Hillareds skytteförenings skjutjournal
- **Body (outline):**
  - Greeting / welcome to Hillareds skytteförening.
  - "Ett konto har skapats åt dig i föreningens digitala skjutjournal."
  - "Klicka på länken nedan för att välja ett lösenord och logga in:"
  - The `{{ .ConfirmationURL }}` link.
  - "När du har loggat in kan du registrera dina skjuttillfällen och se din statistik."
  - "Om du inte väntade dig det här mejlet kan du bortse från det."

**Custom SMTP** (Authentication → SMTP Settings): required. Supabase's built-in
email sender only delivers to a few project-team addresses and is heavily
rate-limited, so real member invites will not arrive without custom SMTP
configured.

The password-reset redirect URL (setup step 3) already covers the invite
redirect — no new allowlist entry needed.

## Verification

- `node --check` the extracted inline script from `index.html`.
- Bump the `VERSION` constant in `sw.js` (per-deploy convention).
- Manual smoke test once SMTP is configured: create a member, confirm the
  Swedish email arrives, click the link, set a password, land in the app.

## Out of scope (YAGNI)

- Resend-invite button for pending members.
- Branded / custom HTML email via an external service (Approach B).
- Retroactive welcome email for existing admin-created accounts.
