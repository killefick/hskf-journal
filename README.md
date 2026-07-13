# Skjutjournal – Hillareds skytteförening

Webapp för att registrera skjuttillfällen och summera skott per kalenderår. Underlag för
egenkontroll (förordning 1998:901), bullerbedömning (NFS 2005:15) och ev. villkor.

Hela appen är `index.html` – ingen byggprocess, inga beroenden. Övriga filer gör den
installerbar och hanterar medlemskonton.

```
index.html                          appen (HTML + CSS + JS)
manifest.json                       installerbar på hemskärm
sw.js                               service worker (offline + uppdateringsnotis)
icons/                              appikoner
supabase/functions/admin-members/   edge-funktion för medlemshantering (admin)
docs/supabase-setup.md              engångssteg i Supabase (RLS, deploy, redirect)
```

## Lägen

- **Inmatning** (medlem/admin): namn + antal skott + Enter. Datum (standard idag, kan
  ändras) och skjutledare ställs in en gång per pass. Markera passet som **tävling** för att
  registrera poäng per skytt; tävlingen väljs ur en fast lista (`TAVLINGAR` i `index.html`).
- **Admin & analys**: statistik, diagram, tävlingsresultat, redigera/radera poster, markera
  betalt, hantera medlemmar och export till CSV/Excel.

## Roller

Roll sätts i `profiles.role`, eller av en admin under **Admin & analys → Medlemmar**.

- `member`: loggar skott och läser journalen, rättar/raderar **egna** poster. Vid redigering
  är datum och skytt låsta så att ett pass inte råkar flyttas till fel dag.
- `revisor` (visas som **Ledare** i appen): betrodd granskare/ledare. Kan logga skott för vem som helst (som admin) och ser
  allt – inklusive medlemslistan och Admin & analys – samt exportera. Kan rätta/radera sina
  egna nyss inmatade poster, men kan **inte** hantera medlemmar, redigera/radera andras
  poster, markera betalt eller skicka fakturor. Begränsningarna gäller även på databasnivå
  (RLS + `guard_skjut_write`), inte bara i gränssnittet.
- `admin`: ändrar/raderar alla poster, ändrar datum vid redigering (ÅÅÅÅ-MM-DD), markerar
  skottpengar som betalda, hanterar medlemmar och når all analys.
- Lokalt läge (ingen Supabase) saknar inloggning och räknas som admin – endast för test.

### Medlemmar & lösenord

En admin lägger till, byter roll på, skickar lösenordsåterställning till och tar bort
medlemmar under **Medlemmar**. Inloggade kan själva återställa lösenord via "Glömt
lösenord?" på inloggningen. Detta kräver edge-funktionen och redirect-URL:en i
`docs/supabase-setup.md`. Enskilda skyttar behöver inga konton – de skrivs som fritext.

## Lagring

| Läge   | Lagring              | När                                              |
| ------ | -------------------- | ------------------------------------------------ |
| Lokalt | Webbläsaren          | Funkar direkt, för test. Delas ej mellan enheter |
| Delat  | Supabase (gratis)    | Alla ser samma journal från valfri enhet. **Rek.** |

## 1. Hosting

GitHub Pages publicerar bara från **publika** repon på gratisplanen. Välj ett:

- **Cloudflare Pages / Netlify** (gratis, repot kan vara privat). Connect to Git → välj repot
  → build command tomt, output `/` → Deploy.
- **GitHub Pages** (gör repot publikt): Settings → Pages → branch `main`, mapp `/`.

Anon-nyckeln i koden är publik by design och ger ingen åtkomst utan inloggning – ok även i
publikt repo, förutsatt att RLS är på och öppen registrering är av (se nedan).

## 2. Delad databas (Supabase)

1. supabase.com → New project → region EU (Frankfurt).
2. SQL Editor → kör:

```sql
create table skjuttillfallen (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  skytt text not null,
  antal_skott int not null default 0,
  skjutledare text,
  anmarkning text,
  tavling boolean not null default false,
  tavling_namn text,
  poang numeric,
  kopt boolean not null default false,
  betald boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role text not null default 'member'
);
alter table profiles enable row level security;
create policy "read own profile" on profiles
  for select to authenticated using (id = auth.uid());

create or replace function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
  $$;

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles (id, full_name, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'member')
    on conflict (id) do nothing;
    return new;
  end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
insert into public.profiles (id, full_name, role)
  select id, coalesce(raw_user_meta_data->>'full_name',''), 'member'
  from auth.users on conflict (id) do nothing;

alter table skjuttillfallen enable row level security;
create policy "read"   on skjuttillfallen for select to authenticated using (true);
create policy "insert" on skjuttillfallen for insert to authenticated
  with check (public.is_admin() or created_by = auth.uid());
create policy "update" on skjuttillfallen for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());
create policy "delete" on skjuttillfallen for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Column-level guard. RLS is row-level only, so without this a member could call
-- the REST API directly and flip billing/attribution fields on their OWN rows
-- (e.g. set betald=true to erase ammunition debt, or change skytt_id).
--   * admin   — unrestricted
--   * revisor — may log (insert) for ANY shooter, like an admin, but may not
--               mark paid, reassign a shooter, or change purchased-ammo status
--   * member  — may only log for themselves, never pre-marked as paid
-- All non-admins are blocked from changing betald/kopt/skytt_id on existing rows.
create or replace function public.guard_skjut_write() returns trigger
  language plpgsql security definer set search_path = public as $$
  declare caller_role text;
  begin
    if public.is_admin() then return new; end if;
    select role into caller_role from public.profiles where id = auth.uid();
    if (tg_op = 'INSERT') then
      if coalesce(caller_role,'member') <> 'revisor' then
        if new.created_by is distinct from auth.uid()
          then raise exception 'created_by must be the current user'; end if;
        if new.skytt_id is distinct from auth.uid()
          then raise exception 'members can only log their own shots'; end if;
      end if;
      if coalesce(new.betald, false) <> false
        then raise exception 'only an admin can mark an entry as paid'; end if;
      return new;
    end if;
    if (tg_op = 'UPDATE') then
      if new.skytt_id is distinct from old.skytt_id
        then raise exception 'only an admin can change the shooter'; end if;
      if coalesce(new.kopt,false) is distinct from coalesce(old.kopt,false)
        then raise exception 'only an admin can change purchased-ammo status'; end if;
      if coalesce(new.betald,false) is distinct from coalesce(old.betald,false)
        then raise exception 'only an admin can change paid status'; end if;
      return new;
    end if;
    return new;
  end; $$;
drop trigger if exists guard_skjut_write on skjuttillfallen;
create trigger guard_skjut_write
  before insert or update on skjuttillfallen
  for each row execute function public.guard_skjut_write();
```

3. Authentication → Providers: slå på **Email**. Slå **av** "Allow new users to
   sign up" — **detta är obligatoriskt**. Appen har ingen självregistrering: nya
   medlemmar skapas bara av en admin (Medlemmar → Lägg till medlem), som mejlar en
   inbjudan; medlemmen sätter sitt lösenord via länken innan hen kan logga in. Är
   självregistrering på kan vem som helst skapa ett konto och då läsa hela
   journalen (read-policyn är `using (true)`). Se `docs/supabase-setup.md` steg 11.
4. Skapa det första kontot (Authentication → Users → Add user) och gör det till admin –
   resten av medlemmarna läggs till i appen under **Medlemmar**:

```sql
update profiles set role='admin'
  where id = (select id from auth.users where email = 'nils@exempel.se');
```

5. Project Settings → API: kopiera **Project URL** och **anon**-nyckeln till `CONFIG` högst
   upp i `index.html`. Tomt = lokalt läge.

```js
const CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "..."
};
```

6. För medlemshantering i appen, självbetjäning av lösenord och revisor-rollens läs-spärr:
   följ stegen i `docs/supabase-setup.md` (deploy av edge-funktion, redirect-URL, RLS).

### Migrering (äldre databas)

Kör de kolumner som saknas:

```sql
alter table skjuttillfallen
  add column if not exists tavling boolean not null default false,
  add column if not exists tavling_namn text,
  add column if not exists poang numeric,
  add column if not exists kopt boolean not null default false,
  add column if not exists betald boolean not null default false;
```

## Pris och betalning

`PRIS_PER_SKOTT` högst upp i `index.html` (kr per skott, decimal med punkt). Endast skott
markerade som **köpt** debiteras – egen ammunition är gratis. Kostnad = köpta skott × priset.

Admin & analys visar **Att betala** per skytt och totalt. När en skytt betalat klickar admin
**Markera betald** på raden, vilket nollställer deras "Att betala". Posterna ligger kvar i
journalen (flaggas `betald`) och kan ångras.

```js
const PRIS_PER_SKOTT = 9;
```

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

## Export

CSV och Excel innehåller föreningsuppgifter, hela loggen (med köpt/betald, poäng och
tävlingsnamn), årssammanställning, signaturblock och hänvisningar. Excel får flikarna
*Skjutjournal*, *Sammanställning*, *Tävlingsresultat* (om året har tävlingar) och *Att betala*
(om pris > 0). "Att betala" visar kvarstående belopp; betalt redovisas separat.

## Uppdatera installerade appar

Höj `VERSION` i `sw.js` **och** `APP_VERSION` i `index.html` (håll dem i synk; t.ex.
`v50` → `v51`) och pusha. Nästa gång appen öppnas (eller får fokus) aktiveras den nya
versionen automatiskt och sidan laddar om sig själv – ingen prompt. Versionen visas i
sidfoten.
