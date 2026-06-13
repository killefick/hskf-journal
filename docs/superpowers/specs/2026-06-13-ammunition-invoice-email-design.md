# Spec: Ammunition invoice emails

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

An admin can email each shooter a plain-text invoice for the ammunition they
bought: an itemized list of shooting days with purchased shots, the total in
kronor, and payment instructions (Bankgiro **370-4624**, message line
`<namn> Ammunition`). Invoices are sent from the existing "Att betala"
per-shooter list, one shooter at a time or in bulk.

## Context / constraints

- Shooters are stored as **free text** (`skjuttillfallen.skytt`); they are not
  all member accounts, so there is no email on file for them. We therefore store
  an email per shooter name in a new lookup table.
- The app has **no custom-email capability**. Member invites ride on Supabase's
  built-in auth email templates, which can only send fixed auth messages. Any
  arbitrary email — even one line of plain text — must go through an email
  provider. We use **Brevo's transactional email HTTP API** from a new edge
  function (Brevo is already the SMTP provider for this project).
- Emails are mildly sensitive. The client never reads the email table directly;
  all access is through an admin-gated edge function, the same trust model as
  `admin-members`.

## Data model

New table, keyed by the **trimmed** shooter name — the same key the "Att betala"
view already groups on (`(e.skytt||"–").trim()`):

```sql
create table skytt_faktura (
  skytt_namn      text primary key,   -- trimmad skyttnamn, matchar "Att betala"-grupperingen
  email           text,
  faktura_skickad timestamptz
);

alter table skytt_faktura enable row level security;
-- Inga policies: service_role (edge-funktionen) kringgår RLS; alla direkta
-- authenticated/anon-läsningar och skrivningar nekas.
```

Keying by trimmed (not lowercased) name matches existing grouping behaviour;
pre-existing case/spacing variants that already split a shooter into multiple
buckets are out of scope to fix here.

## Edge function — `supabase/functions/send-invoice/index.ts`

New function mirroring `admin-members`: CORS preamble, verify the caller's bearer
token resolves to a user whose `profiles.role === 'admin'`, then dispatch on
`action`. Reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) plus
new secrets `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`.

Actions:

- **`meta`** → `select skytt_namn, email, faktura_skickad from skytt_faktura`;
  returns the rows so the client can show stored email + last-sent date per row.
- **`saveEmail`** `{ skytt_namn, email }` → validate email, upsert
  `{ skytt_namn, email }` (leaves `faktura_skickad` untouched).
- **`send`** `{ skytt_namn, email, subject, text }` → validate email, POST to
  Brevo `https://api.brevo.com/v3/smtp/email` with `sender`
  (`BREVO_SENDER_EMAIL`/`NAME`), `to: [{ email }]`, `subject`, `textContent: text`.
  On a successful Brevo response, upsert `{ skytt_namn, email, faktura_skickad: now }`.
  On Brevo failure, return the error and do **not** record a send.

The function does not compute invoice contents — the client builds the body and
passes the finished `subject` + `text`. This keeps the cost/itemization logic in
one place (the client already has the journal data and `PRIS_PER_SKOTT`).

## Client — `index.html`

All invoice UI is admin-only (hidden from member/revisor), consistent with
existing gating.

**Loading meta.** When the "Att betala" view renders, call `send-invoice`
`meta` and build a `Map(skytt_namn → { email, faktura_skickad })` for display.

**Per-shooter row** (the existing per-shooter "Att betala" table): for shooters
with an outstanding balance, add:

- the stored email (if any) with a small **"ändra"** affordance to edit it
  (prompts, then `saveEmail`),
- `Faktura skickad <datum>` when `faktura_skickad` is set,
- a **`Skicka faktura`** button.

**Send one.** On `Skicka faktura`:

1. If no stored email → `prompt()` for one; on a valid address, `saveEmail` then
   continue (cancel/empty aborts).
2. Build the plain-text body (below) for that shooter + year.
3. Call `send`; on success update the local meta map (`faktura_skickad = now`)
   and re-render the row; show a success banner. On error, show a warning banner.

**Bulk send.** A **`Skicka alla fakturor`** button loops over every shooter with
an outstanding balance for the year:

- shooters **without** a stored email are skipped and collected into a
  "saknar e-post" report shown afterwards (no silent skips),
- shooters who already have a `faktura_skickad` date trigger a single up-front
  `confirm()` listing them before re-sending,
- each send reuses the single-send path; a summary banner reports how many were
  sent, skipped, and failed.

## Email content (plain text, Swedish)

Bills the **outstanding** amount only — köpt rows where `betald` is false —
itemized per shooting day, sorted by date:

```
Ämne: Faktura ammunition – Hillareds skytteförening <år>

Hej <namn>,

Faktura för ammunition – Hillareds skytteförening <år>.

Köpta skott:
  2026-03-12    50 skott
  2026-04-02   100 skott
Totalt: <antal> skott × <pris> kr = <summa> kr

Betalas till Bankgiro: 370-4624
Ange som meddelande: <namn> Ammunition

Tack!
Hillareds skytteförening
```

`<namn>` is the trimmed shooter name; the message/reference line is exactly
`<namn> Ammunition`.

## Manual setup — `docs/supabase-setup.md`

New step "Faktura för ammunition (e-post)":

1. Run the `skytt_faktura` table SQL above.
2. Set function secrets:
   `supabase secrets set BREVO_API_KEY=… BREVO_SENDER_EMAIL=… BREVO_SENDER_NAME="Hillareds skytteförening"`.
3. Verify the sender address in Brevo (Senders & domains) so mail is accepted.
4. `supabase functions deploy send-invoice`.

## Verification

- Extract the inline `<script>` from `index.html` and `node --check` it.
- Bump the `VERSION` constant in `sw.js` (per-deploy convention).
- Manual smoke test once secrets are set: a shooter with an outstanding balance,
  click `Skicka faktura`, enter an email, confirm the plain-text invoice arrives
  with correct itemization, total, Bankgiro, and reference line; confirm
  `Faktura skickad <datum>` appears.

## Implementation split (parallel, disjoint files)

- `supabase/functions/send-invoice/index.ts` (+ `deno.json`) — new function.
- `index.html` — table UI, meta load, send/bulk logic, body builder.
- `docs/supabase-setup.md` — new setup step.
- `README.md` — document invoicing under a new section.
- `sw.js` — VERSION bump.

## Out of scope (YAGNI)

- PDF or HTML invoices, attachments, branded templates.
- A separate email-management screen (emails are captured inline on send).
- Invoicing already-paid shots, or partial-payment tracking.
- Fixing pre-existing shooter-name spelling/case variants.
- Automatic/scheduled invoicing — sending is always an explicit admin action.
