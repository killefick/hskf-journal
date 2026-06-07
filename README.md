# Skjutjournal – Hillareds skytteförening

Webapp för att registrera skjuttillfällen och automatiskt summera antalet skott per
kalenderår. Underlag för egenkontroll (förordning 1998:901), bullerbedömning (NFS 2005:15)
och eventuella villkor.

Hela appen är `index.html` (ingen byggprocess, inga beroenden att installera). Övriga filer
är stödfiler för installation som app och ikoner.

```
hskf-journal/
├── index.html          # själva appen (HTML + CSS + JS)
├── manifest.json       # gör appen installerbar (hemskärm)
├── sw.js               # service worker (offline + uppdateringsnotis)
├── README.md           # denna fil
├── .gitignore          # håller känslig data utanför repot
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── apple-touch-icon.png
```

## Två lägen i appen

- **Inmatning** (standard): skriv i princip bara **namn + antal skott** och tryck Enter.
  Datum och skjutledare ställs in *en gång* under "Dagens pass" och
  gäller alla skyttar du registrerar efter det.
- **Admin & analys** (knapp uppe till höger, visas bara för **admin**): statistik, diagram
  (skott per månad, skott per skytt), redigera/radera poster och export till **CSV** och **Excel**
  med komplett, godkännandeklar sammanställning. Vanliga konton (`member`) ser bara inmatningen.

## Lagring

| Läge | Lagring | När |
|------|---------|-----|
| **Lokalt** | Endast i webbläsaren | Funkar direkt, för test. Delas inte mellan enheter. |
| **Delat** | Gratis Supabase-databas | Alla ser samma journal, från valfri enhet. **Rekommenderas.** |

---

## 1. Hosting – OBS för privat repo

GitHub Pages publicerar **bara från publika repon** på gratisplanen. Privata repon kräver
GitHub Pro/Team/Enterprise. Välj därför ett av följande:

**Alternativ A – Cloudflare Pages eller Netlify (gratis, behåll repot privat).** Rekommenderas.
1. Pusha `index.html` + `README.md` till `killefick/hskf-journal`.
2. Cloudflare Pages: dash.cloudflare.com → *Workers & Pages* → *Create* → *Pages* →
   *Connect to Git* → välj repot → build command: *(tomt)*, output dir: `/` → *Deploy*.
   (Netlify fungerar likadant: *Add new site → Import from Git*.)
3. Du får en gratis adress, t.ex. `https://hskf-journal.pages.dev`.

**Alternativ B – GitHub Pages (gör repot publikt).** Själva koden blir då synlig, men appen
innehåller inga hemligheter förutom Supabase-anon-nyckeln, som är publik *by design*.
1. Pusha filerna. 2. **Settings → Pages** → *Deploy from a branch* → branch `main`, mapp `/ (root)`.
3. Sidan nås på `https://killefick.github.io/hskf-journal/`.

**Alternativ C – GitHub Pages med privat repo.** Kräver GitHub Pro (då funkar steg B med privat repo).

### Pusha (du har credentials)
```bash
git clone https://github.com/killefick/hskf-journal.git
cp -r index.html README.md manifest.json sw.js .gitignore icons/ hskf-journal/
cd hskf-journal && git add . && git commit -m "Skjutjournal-webapp" && git push
```
Alla filerna ska ligga i repo-roten (samma mapp som `index.html`).

### Mobil / installera som app
Appen är byggd mobil-först. På telefonen kan ni lägga den på hemskärmen så den öppnas i
helskärm utan webbläsarens adressrad:
- **iPhone (Safari):** Dela-knappen → *Lägg till på hemskärmen*.
- **Android (Chrome):** menyn ⋮ → *Installera app* / *Lägg till på hemskärmen*.

`manifest.json`, `sw.js` och `icons/`-mappen måste vara med i repot för att detta ska
fungera. Service workern gör att appen laddar även med dålig täckning vid banan; i lokalt läge
fungerar den helt offline (delat läge kräver nät för att synka mot databasen).

### Pusha en uppdatering (notis till installerade användare)
När du ändrat appen och vill att de som lagt den på hemskärmen ska få notisen
**"Uppdatering finns"**: höj `VERSION` högst upp i `sw.js` (t.ex. `"v2"` → `"v3"`) och pusha.
Nästa gång appen öppnas/får fokus upptäcks den nya versionen och en notis visas med
**Uppdatera nu** – ett klick laddar om till senaste versionen. (Online uppdateras själva
sidan ändå automatiskt; versionshöjningen är till för installerade/offline-lägen.)

---

## 2. Delad databas + inloggning (Supabase) – gratis

1. **supabase.com** → konto → **New project** → region **EU (Frankfurt)**. Spara lösenordet.
2. **SQL Editor** → kör (tabell, roller och rollstyrd åtkomst):

   ```sql
   -- 1) Journaltabell
   create table skjuttillfallen (
     id uuid primary key default gen_random_uuid(),
     datum date not null,
     skytt text not null,
     antal_skott int not null default 0,
     skjutledare text,
     anmarkning text,
     created_by uuid default auth.uid(),   -- vem som registrerade
     created_at timestamptz default now()
   );

   -- 2) Profiler med roll: 'member' eller 'admin'
   create table profiles (
     id uuid primary key references auth.users on delete cascade,
     full_name text,
     role text not null default 'member'
   );
   alter table profiles enable row level security;
   create policy "read own profile" on profiles
     for select to authenticated using (id = auth.uid());

   -- 3) Hjälpfunktion: är inloggad användare admin?
   create or replace function public.is_admin() returns boolean
     language sql security definer stable set search_path = public as $$
       select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
     $$;

   -- 4) Skapa profil automatiskt för nya användare + fyll på befintliga
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

   -- 5) Åtkomst till journalen
   alter table skjuttillfallen enable row level security;
   -- alla inloggade får läsa och logga (skriva nytt)
   create policy "read"   on skjuttillfallen for select to authenticated using (true);
   create policy "insert" on skjuttillfallen for insert to authenticated with check (true);
   -- ändra/radera: bara admin, eller den som själv registrerade posten (rätta egen miss)
   create policy "update" on skjuttillfallen for update to authenticated
     using (created_by = auth.uid() or public.is_admin())
     with check (created_by = auth.uid() or public.is_admin());
   create policy "delete" on skjuttillfallen for delete to authenticated
     using (created_by = auth.uid() or public.is_admin());
   ```

   **Gör någon till admin** (kör efter att kontot finns):
   ```sql
   update profiles set role='admin'
     where id = (select id from auth.users where email = 'nils@exempel.se');
   ```

3. **Authentication → Providers**: se till att **Email** är på. Slå av **Allow new users to
   sign up** (under Authentication → Settings/Sign In) så att inte vem som helst kan skapa konto.
4. **Authentication → Users → Add user**: skapa ett konto för var och en som ska kunna logga
   (skjutledare/styrelse). Sätt e-post + lösenord. Vill du att deras namn ska visas och förifyllas
   som skjutledare: lägg till **User metadata** `{"full_name": "Förnamn Efternamn"}` på användaren
   (annars visas e-posten). Bara dessa konton kommer in – enskilda skyttar behöver inga konton,
   de skrivs som fritext.
5. **Project Settings → API**: kopiera **Project URL** och **anon public**-nyckeln.
6. Lägg in värdena i CONFIG högst upp i `index.html` och pusha:

   ```js
   const CONFIG = {
     SUPABASE_URL: "https://abcd.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi..."
   };
   ```
   Med inloggning + låst RLS är detta tryggt även i ett publikt repo: anon-nyckeln ger ingen
   åtkomst utan giltig inloggning. (Alternativt anges värdena per enhet via inloggningssidan kan
   inte nås då – använd CONFIG.) Ladda om sidan: nu möts användarna av en inloggningsruta.

---

## Export – vad som tas med (godkännandeklar journal)

Både CSV och Excel innehåller:
- **Föreningsuppgifter**: namn, org.nr, skjutbana/fastighet, tillsynsmyndighet.
- **Verksamhetsbeskrivning**: kaliber, skjutplatser, prövningsnivå.
- **Hela loggen**: datum, skytt, antal skott,
  skjutledare/ansvarig, anmärkning.
- **Årssammanställning**: totalt antal skott, antal poster, skjutdagar, aktiva skyttar,
  skott per månad.
- **Signaturblock**: "Sammanställt av skjutbaneansvarig" + datum/underskrift.
- **Hänvisningar**: förordning (1998:901), NFS 2005:15, FAP 525-1 / SäkB.

Excel-filen får två flikar: *Skjutjournal* (uppgifter + logg) och *Sammanställning*.

## Om säkerhet & roller
- Inloggning (Supabase Auth) + RLS krävs för all åtkomst; utloggade (anon) nekas helt. Därför
  är det ok att lägga URL och anon-nyckel i koden även i ett publikt repo.
- **Roller:** `member` kan logga skott och läsa journalen samt rätta/radera **egna** poster.
  `admin` kan dessutom ändra/radera alla poster och nå Admin & analys-vyn med export. Rollen
  sätts i `profiles`-tabellen (se SQL ovan). Admin-knappen visas bara för admin.
- Varje post får `created_by` = den inloggades användar-ID, och `skjutledare` förifylls med den
  inloggades namn. Konton skapas av admin i Supabase; håll öppen registrering avstängd.
- Lokalt läge (ingen Supabase i CONFIG) har ingen inloggning och räknas som admin – endast för test.
