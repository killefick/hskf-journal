# Skjutjournal – Hillareds skytteförening

Webapp för att registrera skjuttillfällen och summera skott per kalenderår. Underlag för
egenkontroll (förordning 1998:901), bullerbedömning (NFS 2005:15) och ev. villkor.

Hela appen är `index.html` – ingen byggprocess, inga beroenden. Övriga filer gör den
installerbar som app.

```
index.html      appen (HTML + CSS + JS)
manifest.json   installerbar på hemskärm
sw.js           service worker (offline + uppdateringsnotis)
icons/          appikoner
```

## Lägen

- **Inmatning** (alla inloggade): namn + antal skott + Enter. Datum och skjutledare ställs
  in en gång per pass. Markera passet som **tävling** för att även registrera poäng per skytt; tävlingen väljs ur en fast lista (`TAVLINGAR` i `index.html`).
- **Admin & analys** (bara `admin`): statistik, diagram, tävlingsresultat, redigera/radera
  poster och export till CSV/Excel.

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
create policy "insert" on skjuttillfallen for insert to authenticated with check (true);
create policy "update" on skjuttillfallen for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());
create policy "delete" on skjuttillfallen for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());
```

3. Authentication → Providers: slå på **Email**. Slå **av** "Allow new users to sign up".
4. Authentication → Users → Add user: skapa konton för dem som ska logga (skjutledare/styrelse).
   Lägg ev. till User metadata `{"full_name": "Förnamn Efternamn"}` så namnet förifylls.
   Enskilda skyttar behöver inga konton – de skrivs som fritext.
5. Gör någon till admin:

```sql
update profiles set role='admin'
  where id = (select id from auth.users where email = 'nils@exempel.se');
```

6. Project Settings → API: kopiera **Project URL** och **anon**-nyckeln, lägg in i `CONFIG`
   högst upp i `index.html`. Tomt = lokalt läge.

```js
const CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "..."
};
```

### Migrering (om databasen skapades före tävlingsstödet)

Kör en gång i SQL Editor:

```sql
alter table skjuttillfallen
  add column if not exists tavling boolean not null default false,
  add column if not exists tavling_namn text,
  add column if not exists poang numeric;
```

## Pris per skott

Sätts på ett ställe – `PRIS_PER_SKOTT` högst upp i `index.html` (kr per skott, decimal med
punkt). Kostnad per skytt = antal skott × priset. Admin & analys visar "Att betala" per skytt
och totalt, och det följer med i exporterna.

```js
const PRIS_PER_SKOTT = 9;
```

## Export

CSV och Excel innehåller föreningsuppgifter, hela loggen (med poäng och tävlingsnamn),
årssammanställning, signaturblock och hänvisningar. Excel får flikarna *Skjutjournal*,
*Sammanställning*, *Tävlingsresultat* (om året har tävlingar) och *Att betala* (om pris > 0).

## Roller

- `member`: loggar skott och läser journalen, kan rätta/radera **egna** poster.
- `admin`: kan ändra/radera alla poster och nå Admin & analys. Sätts i `profiles`.
- Lokalt läge (ingen Supabase) saknar inloggning och räknas som admin – endast för test.

## Uppdatera installerade appar

Höj `VERSION` i `sw.js` (t.ex. `v3` → `v4`) och pusha. Nästa gång appen öppnas visas
"Uppdatering finns" med ett klick för att ladda om.
