# Lathund – tävlingsprogram

Datum: 2026-08-10

## Problem

Skyttarna vet inte vad som ingår i respektive tävling. Informationen finns bara på
papper. Den behöver finnas i appen, läsbar **även utan inloggning**, och
**redigerbar av admin** utan kodändring.

Idag ligger tävlingslistan hårdkodad i `index.html` (`const TAVLINGAR`, rad 448)
med fem namn. `Föreningsmästerskap` saknas där. Programmen finns inte alls.

## Beslut

| Fråga | Beslut |
|---|---|
| Programmen per tävling | Skiljer sig åt – eget program per tävling |
| Placering | Egen vy i `index.html`, nås från masthead-knappen `Tävlingar` |
| Tävlingslistan | **En gemensam källa** – samma data driver lathunden och rullgardinen |
| Övningsskjutning | Utelämnas ur lathunden; behåller sin särställning i koden |
| Årshantering | Ingen – samma program alla år, inget årtal i gränssnittet |
| Redigering | Fritext per programrad, inte strukturerade fält |

## Datamodell

Ny rad i befintliga `app_settings` (nyckel/värde, jsonb), nyckel `tavlingar`:

```json
[
  { "namn": "FSR Propagandatävlan",
    "program": ["5 övningsskott liggande", "5 skott liggande, markering efter vardera"] },
  { "namn": "Vårpokalen", "program": ["…"] }
]
```

Arrayens ordning styr både lathundens ordning och rullgardinens.
Tomt `program` är tillåtet – tävlingen visas då utan punktlista.

Tävlingsnamnet lagras även fortsättningsvis som **text** på journalraden
(`skjuttillfallen.tavling_namn`). Att byta namn på eller ta bort en tävling i
lathunden rör därför inte historiska poster.

## RLS – publik läsning

`app_settings` är idag helt dold för `anon`
(`revoke select on public.app_settings from anon`, docs/supabase-setup.md:418).
Migreringen öppnar **enbart** nyckeln `tavlingar`:

```sql
grant select on public.app_settings to anon;

drop policy if exists "read_public" on public.app_settings;
create policy "read_public" on public.app_settings for select to anon
  using (key = 'tavlingar');
```

RLS filtrerar rad för rad, så `pris_per_skott` förblir osynlig utloggad.
Skrivpolicyn (`is_admin()`) är oförändrad.

## Klienten

**Läsning.** `loadTavlingar()` speglar `loadPrice()`: läser raden, faller tillbaka
på den hårdkodade `TAVLINGAR_DEFAULT` om tabellen, raden eller nätet saknas (PWA
offline). Anropas i `init` innan första render – före inloggning, så att
lathunden fungerar i utloggat läge.

**Vy.** `#compGuideView` bredvid `authView`/`logView`/`adminView`. Ett kort per
tävling: namnet som rubrik, programmet som numrerad lista, i `<details open>` så
man kan fälla ihop på mobil. Masthead får knappen `Tävlingar` intill `Hjälp`,
alltid synlig. Vyn minns vilken vy som var öppen och återställer den vid
`← Tillbaka`.

**Rullgardinen.** `fillTavlingar()` (rad 1156) läser samma lista i stället för
konstanten. `Övningsskjutning` fortsätter vara default för poster utan vald
tävling och exkluderas från Tävlingar-fliken (rad 940) – oförändrat.

## Admin-redigering

Knappen `✎ Redigera` överst i lathundsvyn, synlig bara när `isAdmin`. Ingen ny
admin-flik – allt på ett ställe, och redigeringen sker där resultatet syns.

Redigeringsläget visar per tävling:

- namnfält
- textarea, en rad = en programpunkt (tomma rader ignoreras)
- `↑` `↓` för ordning, `✕` för ta bort

Längst ned `+ Lägg till tävling`, samt `Spara` / `Avbryt`. Sparning skriver hela
arrayen med `upsert` mot `app_settings` och renderar om. Fel visas i den
befintliga bannern med samma hänvisning till migreringen som `savePrice()`.

Lokalt läge (utan Supabase) sparar i `localStorage` under `hskf_tavlingar`,
precis som `loadPrice()`/`savePrice()` gör för priset.

## Seed-data

Seedas med användarens text ordagrant – samma program på alla sex tävlingar –
och rättas därefter i admin. `5x liggande` skrivs ut som `5 skott liggande`.
Tävlingar i ordning: FSR Propagandatävlan, Vårpokalen, D. von Schedvins
vandringspris, Korporationsskjutning, Höstpokalen, Föreningsmästerskap.

`Föreningsmästerskap` tillkommer därmed i rullgardinen.

## Verifiering

- `node --check` på det inlinade skriptet
- Lathunden syns utloggad (inkognito) och inloggad
- `pris_per_skott` går **inte** att läsa utloggad efter migreringen
- Rullgardinen innehåller Föreningsmästerskap
- Bumpa `APP_VERSION` i `index.html` och `VERSION` i `sw.js`
