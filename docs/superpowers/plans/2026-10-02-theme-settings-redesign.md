# Piano di implementazione — Nuova pagina Tema & Stili e pagina Impostazioni personali

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i 29 colori per-admin con un solo colore principale globale, da cui le varianti chiaro/scuro si calcolano con contrasto garantito, e dare a ogni utente una pagina `/settings` per lingua, tema chiaro/automatico/scuro e dimensione del testo.

**Architecture:** Il colore dell'app vive in `app_theme` (una riga), le preferenze personali in `users.theme_mode` / `users.text_scale`. Il layout radice le legge sul server e scrive nell'HTML un `<style>` con `--primary` per i due modi, `data-theme-mode` e `font-size` su `<html>`. Uno script inline in `<head>` mette la classe `dark` prima che la pagina compaia. Sfondi, bordi e testi diventano valori fissi in `globals.css`, specchiati da costanti TypeScript che un test confronta col CSS. `UIContext` e `localStorage.appSettings` spariscono.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind v4, shadcn/ui (`radix-ui`), Drizzle ORM su Postgres, Zod 4, Vitest (node e jsdom), Playwright/pytest (E2E), migrazioni SQL numerate applicate da `sources/devops/db/db.mjs`.

**Specifica di riferimento:** [`docs/superpowers/specs/2026-10-02-theme-settings-redesign-design.md`](../specs/2026-10-02-theme-settings-redesign-design.md). Le sigle `DEC-n` e gli ID della sezione «Lavori» (`DB-1`, `CORE-1`, …) sono definiti là.

## Riepilogo

Dodici task, in un ordine che tiene compilazione e test unitari verdi a ogni commit:

1. **Fondamenta** (T1–T5): la migrazione additiva, il calcolo del colore, il modello delle preferenze, le letture e le azioni server, i componenti shadcn. Nessuna di queste cambia ciò che l'utente vede.
2. **Interfaccia** (T6–T8): i mattoni condivisi, poi le due pagine e il pannello utente della sidebar.
3. **Passaggio** (T9): il layout diventa la fonte delle variabili CSS, `UIContext` e i 29 colori spariscono.
4. **Pulizia e verifica** (T10–T12): la migrazione distruttiva, gli E2E, la verifica finale in browser.

Fra T7 e T9 l'app è in uno stato di transizione: il colore salvato dalla nuova pagina admin si vede solo dopo T9. È voluto, e gli E2E (T11) girano dopo T9.

- [✅] ID=T1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Migrazione additiva 0031, Fix description=`app_theme`, `users.theme_mode`, `users.text_scale`, chiavi di traduzione nuove, Drizzle, `schema.sql`, `test-reset-e2e` esteso.
- [✅] ID=T2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Calcolo del colore in OKLCH, Fix description=`derivePrimary`, `primaryCss`, `LIGHT_PALETTE`/`DARK_PALETTE`, preset, in `lib/theme-vars.ts`.
- [✅] ID=T3, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Modello delle preferenze, Fix description=`lib/appearance.ts`: tipi, schema Zod, cookie, `THEME_MODE_SCRIPT`, `applyAppearance`.
- [✅] ID=T4, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Letture e azioni server, Fix description=`getAppearance`, `getAppPrimaryColor`, `saveAppearance`, `saveAppPrimaryColor`.
- [✅] ID=T5, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Componenti shadcn, Fix description=`toggle`, `toggle-group`, `slider` aggiunti, riletti e adattati.
- [ ] ID=T6, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Mattoni dell'interfaccia, Fix description=`SettingsSection`/`SettingsRow`, `ColorSwatches`, `PalettePreview`.
- [ ] ID=T7, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Pagina Admin Tema & Stili, Fix description=Riscrittura di `AdminTheme` sul colore unico.
- [ ] ID=T8, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Pagina Impostazioni e pannello utente, Fix description=`/settings`, `LanguageSwitcher` ristilizzato, link nella sidebar.
- [ ] ID=T9, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Passaggio al rendering server, Fix description=Layout, `globals.css`, eliminazione di `UIContext` e dei 29 colori, ag-grid in `rem`.
- [ ] ID=T10, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Migrazione distruttiva 0032, Fix description=Drop di `users.theme_config`, cancellazione delle chiavi obsolete.
- [ ] ID=T11, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Test E2E, Fix description=`switch_language`, `test_i18n.py`, `test_admin_theme.py`, `test_settings.py`.
- [ ] ID=T12, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Verifica finale, Fix description=Tutte le guardie, build, verifica in browser chiaro/scuro/scala.

## Global Constraints

- **Cartella di lavoro dei comandi npm:** `sources/microservices/web-construct/`. I comandi `node sources/devops/db/db.mjs …` e `uv run pytest` vanno lanciati dalla radice del repository.
- **Python:** sempre con `uv` (`uv run pytest`), mai `python`, `python3` o `pip`.
- **Le migrazioni applicate sono immutabili.** `assertAppliedMigrationChecksums` rifiuta una migrazione già applicata i cui byte cambiano. Se `0031` è già stata applicata e va corretta, si scrive la successiva.
- **Ogni migrazione è additiva o distruttiva, mai entrambe.** `0031` additiva (T1), `0032` distruttiva (T10), con il codice in mezzo.
- **`schema.sql` è generato:** dopo ogni migrazione, `node sources/devops/db/db.mjs schema-write`.
- **Due database, due configurazioni di anteprima.** `web-construct` usa il database di sviluppo (lì l'utente è admin); `web-construct-e2e` usa quello usa-e-getta. Le migrazioni si applicano a entrambi: `db.mjs apply` e `db.mjs test-apply`. Gli E2E girano solo contro `web-construct-e2e`, mai contro il database di sviluppo.
- **Vocabolario di stile:** solo nomi shadcn nelle `className`. I `--theme-*` non esistono. I colori dei pallini e dell'anteprima vanno in `style`, mai come classi `bg-<colore>-<n>` (`npm run test:raw-colors`).
- **Hover sui bottoni:** sempre `[&:not(:disabled)]:hover:`, mai `hover:` nudo, e niente `disabled:pointer-events-none` (vedi il commento in testa a `components/ui/button.tsx`).
- **Chiavi di traduzione:** ogni chiave usata in un `t()` deve essere seminata in una migrazione (`npm run test:i18n-keys`). Le chiavi si scrivono come letterali interi, mai costruite con template literal.
- **E2E e azioni server:** un helper che scatena un'azione server non aspetta mai `networkidle`. Aspetta un segnale che solo il giro completo può produrre: un testo comparso, oppure la risposta della richiesta POST dell'azione.
- **Contrasto:** soglia unica `CONTRAST_FLOOR = 4.5` per testo e colore principale.
- **Commit:** un commit per task, messaggio nella forma del ramo (`feat(theme): …`, `test(theme): …`), con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` come ultima riga.
- **Spuntare i riquadri:** a task concluso e verificato, mettere `- [✅]` sulla sua riga nel Riepilogo qui sopra e, quando tutti i task che la compongono sono chiusi, sulla voce corrispondente nella sezione «Lavori» della specifica. Stessa azione del commit, mai a fine lavoro in blocco.

| Voce della specifica | Task che la chiudono |
|---|---|
| DB-1 | T1, T10 |
| CORE-1 | T2, T9 |
| CORE-2 | T3, T9 |
| ACT-1 | T4 |
| UI-1 | T5 |
| UI-2 | T6, T7 |
| UI-3, UI-4 | T8 |
| I18N-1 | T1, T10 |
| E2E-1 | T11 |

---

### Task 1: Migrazione additiva 0031

**Files:**
- Create: `sources/devops/db/migrations/0031_theme_settings.sql`
- Modify: `sources/microservices/web-construct/lib/db/schema.ts` (tabella `users`, l.37–63; nuova tabella `appTheme`)
- Modify: `sources/devops/db/db.mjs:353-357` (`test-reset-e2e`)
- Modify: `sources/devops/db/schema.sql` (generato)

**Interfaces:**
- Consumes: niente.
- Produces:
  - tabella `public.app_theme(id boolean pk, primary_color varchar(7), date_mod timestamptz)`, una riga con `#4f46e5`;
  - colonne `users.theme_mode varchar(6) default 'system'` e `users.text_scale smallint default 100`;
  - Drizzle: `appTheme` con `primaryColor`, `dateMod`; `users.themeMode`, `users.textScale`;
  - le chiavi di traduzione elencate allo Step 1.

- [ ] **Step 1: Scrivi la migrazione**

`sources/devops/db/migrations/0031_theme_settings.sql`:

```sql
-- Nuova pagina Tema & Stili e pagina Impostazioni personali (specifica del 2026-10-02).
--
-- SOLO ADDITIVA, come la 0024: users.theme_config resta finche' il codice la legge. Il DROP di
-- quella colonna e la cancellazione delle chiavi di traduzione obsolete sono la 0032, da
-- applicare dopo il codice che smette di usarle.

-- 1. Il colore principale dell'app, uno per tutti (DEC-1). Una riga sola: la chiave booleana con
--    `check (id)` ammette soltanto `true`, quindi un secondo insert viola la chiave primaria.
--    In tabella c'e' solo il colore scelto; le varianti chiaro/scuro si ricalcolano a ogni
--    richiesta (DEC-8). Il colore si salva sempre in minuscolo, e il vincolo lo pretende.
create table public.app_theme (
  id            boolean primary key default true check (id),
  primary_color varchar(7) not null check (primary_color ~ '^#[0-9a-f]{6}$'),
  date_mod      timestamptz not null default now()
);
insert into public.app_theme (primary_color) values ('#4f46e5');

-- 2. Privilegi e RLS nella forma della 0024: le privilegi di default della 0002 non coprono una
--    tabella creata da una migrazione successiva. Solo select e update: la riga esiste gia' e
--    non si cancella.
alter table public.app_theme enable row level security;
grant select, update on table public.app_theme to construct_runtime;
create policy construct_runtime_server_access on public.app_theme
  for all to construct_runtime using (true) with check (true);

-- 3. Le preferenze personali (DEC-1, DEC-2). `system` come predefinito: chi non ha mai scelto
--    segue il sistema operativo, che e' l'unica scelta che rispetta una preferenza gia' espressa.
alter table public.users
  add column theme_mode varchar(6) not null default 'system'
    check (theme_mode in ('light', 'dark', 'system')),
  add column text_scale smallint not null default 100
    check (text_scale in (90, 100, 110, 120, 130));

-- 4. Le etichette delle due pagine e del link nel pannello utente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.section.primary_color","namespace":"theme","module":"rbac","description":"Theme admin: primary colour section title","it":"Colore principale","en":"Primary colour"},
    {"key":"theme.field.primary_color_hint","namespace":"theme","module":"rbac","description":"Theme admin: what the primary colour is used for","it":"Pulsanti, icone attive e bordo di selezione. Le varianti per chiaro e scuro sono calcolate in automatico.","en":"Buttons, active icons and the focus ring. The light and dark variants are worked out automatically."},
    {"key":"theme.field.swatches","namespace":"theme","module":"rbac","description":"Theme admin: accessible name of the colour swatch group","it":"Scegli il colore principale","en":"Choose the primary colour"},
    {"key":"theme.preset.indigo","namespace":"theme","module":"rbac","description":"Theme admin: indigo preset swatch","it":"Indaco","en":"Indigo"},
    {"key":"theme.preset.green","namespace":"theme","module":"rbac","description":"Theme admin: green preset swatch","it":"Verde","en":"Green"},
    {"key":"theme.preset.pink","namespace":"theme","module":"rbac","description":"Theme admin: pink preset swatch","it":"Rosa","en":"Pink"},
    {"key":"theme.preset.orange","namespace":"theme","module":"rbac","description":"Theme admin: orange preset swatch","it":"Arancio","en":"Orange"},
    {"key":"theme.preset.sky","namespace":"theme","module":"rbac","description":"Theme admin: sky blue preset swatch","it":"Azzurro","en":"Sky blue"},
    {"key":"theme.preset.custom","namespace":"theme","module":"rbac","description":"Theme admin: custom colour swatch that opens the colour picker","it":"Personalizzato","en":"Custom"},
    {"key":"theme.preview.title","namespace":"theme","module":"rbac","description":"Theme admin: palette preview section title","it":"Anteprima","en":"Preview"},
    {"key":"theme.preview.light","namespace":"theme","module":"rbac","description":"Theme admin: light-mode preview strip label","it":"Chiaro","en":"Light"},
    {"key":"theme.preview.dark","namespace":"theme","module":"rbac","description":"Theme admin: dark-mode preview strip label","it":"Scuro","en":"Dark"},
    {"key":"theme.preview.swatch.primary","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the primary colour","it":"Principale","en":"Primary"},
    {"key":"theme.preview.swatch.hover","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the hover surface","it":"Passaggio","en":"Hover"},
    {"key":"theme.preview.swatch.surface","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the card surface","it":"Superficie","en":"Surface"},
    {"key":"theme.preview.swatch.background","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the page background","it":"Sfondo","en":"Background"},
    {"key":"theme.preview.swatch.sidebar","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the sidebar","it":"Sidebar","en":"Sidebar"},
    {"key":"theme.status.unreadable","namespace":"theme","module":"rbac","description":"Theme admin: save refused because no readable variant of the colour exists","it":"Questo colore non si può rendere leggibile né in chiaro né in scuro e non è stato salvato.","en":"This colour cannot be made readable in light or dark mode and was not saved."},
    {"key":"settings.page.title","namespace":"settings","module":"core","description":"Personal settings page title","it":"Impostazioni","en":"Settings"},
    {"key":"settings.page.subtitle","namespace":"settings","module":"core","description":"Personal settings page subtitle","it":"Lingua e aspetto dell'applicazione, solo per te","en":"Language and appearance of the application, just for you"},
    {"key":"settings.section.language_region","namespace":"settings","module":"core","description":"Settings: language and region section title","it":"Lingua e regione","en":"Language and region"},
    {"key":"settings.field.language","namespace":"settings","module":"core","description":"Settings: language row label","it":"Lingua","en":"Language"},
    {"key":"settings.field.language_hint","namespace":"settings","module":"core","description":"Settings: language row hint","it":"Interfaccia, date e numeri si aggiornano subito","en":"Interface, dates and numbers update right away"},
    {"key":"settings.field.date_format","namespace":"settings","module":"core","description":"Settings: read-only date and number format example","it":"Formato data","en":"Date format"},
    {"key":"settings.section.appearance","namespace":"settings","module":"core","description":"Settings: appearance section title","it":"Aspetto","en":"Appearance"},
    {"key":"settings.field.theme","namespace":"settings","module":"core","description":"Settings: theme mode row label","it":"Tema","en":"Theme"},
    {"key":"settings.field.theme_hint","namespace":"settings","module":"core","description":"Settings: theme mode row hint","it":"Segue il sistema operativo oppure scegli tu","en":"Follow the operating system, or choose yourself"},
    {"key":"settings.theme.light","namespace":"settings","module":"core","description":"Settings: light theme option","it":"Chiaro","en":"Light"},
    {"key":"settings.theme.system","namespace":"settings","module":"core","description":"Settings: automatic theme option that follows the operating system","it":"Automatico","en":"Automatic"},
    {"key":"settings.theme.dark","namespace":"settings","module":"core","description":"Settings: dark theme option","it":"Scuro","en":"Dark"},
    {"key":"settings.field.text_size","namespace":"settings","module":"core","description":"Settings: text size row label","it":"Dimensione testo","en":"Text size"},
    {"key":"settings.field.text_size_hint","namespace":"settings","module":"core","description":"Settings: text size row hint","it":"Ingrandisce o riduce tutta l'interfaccia","en":"Makes the whole interface larger or smaller"},
    {"key":"settings.status.save_failed","namespace":"settings","module":"core","description":"Settings: a preference could not be saved and was reverted","it":"Impossibile salvare la preferenza. Riprova.","en":"Could not save the preference. Please try again."},
    {"key":"nav.settings","namespace":"nav","module":"core","description":"Sidebar user panel: link to the personal settings page","it":"Impostazioni","en":"Settings"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
```

- [ ] **Step 2: Aggiorna lo schema Drizzle**

In `sources/microservices/web-construct/lib/db/schema.ts`, nella tabella `users`, subito dopo `themeConfig: jsonb('theme_config'),` (l.46, che resta fino al Task 9):

```ts
  themeMode: varchar('theme_mode', { length: 6 }).notNull().default('system'),
  textScale: smallint('text_scale').notNull().default(100),
```

Subito dopo la chiusura di `users` (dopo l.63):

```ts
/** Il colore principale dell'app: una riga sola, garantita dal database (0031). */
export const appTheme = pgTable('app_theme', {
  id: boolean('id').primaryKey().default(true),
  primaryColor: varchar('primary_color', { length: 7 }).notNull(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})
```

`boolean`, `varchar`, `smallint` e `timestamp` sono già importati in testa al file.

- [ ] **Step 3: Estendi `test-reset-e2e`**

In `sources/devops/db/db.mjs`, sostituisci il ramo `if (command === 'test-reset-e2e') { … }` (l.353–357) con:

```js
    if (command === 'test-reset-e2e') {
      const emails = [process.env.TEST_EMAIL, process.env.TEST_EMAIL_USER].filter(Boolean)
      if (!emails.length) throw new Error('TEST_EMAIL or TEST_EMAIL_USER is required')
      // Lingua, tema e dimensione del testo stanno sul profilo, e il colore dell'app e' globale:
      // un test che li cambia e non li rimette a posto altera tutti quelli dopo, senza che
      // l'errore nomini mai la causa (vedi conftest.py, clean_language_preferences).
      const result = await sql`
        update users set id_language = null, theme_mode = 'system', text_scale = 100
        where email = any(${emails})
      `
      await sql`update app_theme set primary_color = '#4f46e5', date_mod = now()`
      console.log(`reset language and appearance for ${result.count} E2E fixture user(s) and the app colour`)
    } else if (command === 'test-delete-user') {
```

- [ ] **Step 4: Applica la migrazione ai due database e rigenera lo snapshot**

Dalla radice del repository:

```bash
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs test-apply
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs boundary-check
```

Atteso: `apply` e `test-apply` stampano la riga di `NOTICE` del seme (34 chiavi inserite); `boundary-check` stampa solo righe `ok`.

- [ ] **Step 5: Verifica**

Da `sources/microservices/web-construct/`:

```bash
npm run schema:check
npm run test:migrations
npm run test:i18n-keys
npm run typecheck
npm test
```

Atteso: tutti verdi. `test:i18n-keys` può elencare le chiavi nuove come «seminate ma non ancora usate»: è un elenco informativo, non un fallimento.

Controlla anche la riga sul database di sviluppo:

```bash
node sources/devops/db/db.mjs query "select primary_color from app_theme"
```

Atteso: una riga, `#4f46e5`.

- [ ] **Step 6: Commit**

```bash
git add sources/devops/db/migrations/0031_theme_settings.sql sources/devops/db/schema.sql sources/devops/db/db.mjs sources/microservices/web-construct/lib/db/schema.ts
git commit -m "feat(theme): add app_theme and personal appearance columns (0031)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Calcolo del colore in OKLCH

**Files:**
- Modify: `sources/microservices/web-construct/lib/theme-vars.ts`
- Test: `sources/microservices/web-construct/lib/theme-vars.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces (tutti esportati da `@/lib/theme-vars`):
  - `type PaletteToken` — i 14 nomi CSS senza `--` (`'background' | 'card' | … | 'sidebar-accent-foreground'`);
  - `LIGHT_PALETTE: Record<PaletteToken, string>`, `DARK_PALETTE: Record<PaletteToken, string>`;
  - `DEFAULT_PRIMARY = '#4f46e5'`;
  - `PRIMARY_PRESETS: readonly { id: 'indigo' | 'green' | 'pink' | 'orange' | 'sky'; color: string }[]`;
  - `interface PrimaryPair { primary: string; foreground: string }`;
  - `interface DerivedPrimary { light: PrimaryPair; dark: PrimaryPair }`;
  - `derivePrimary(seed: string): DerivedPrimary | null`;
  - `primaryCss(seed: string): string`;
  - `primaryForeground(primary: string): string` (esiste già; cambia solo la costante interna).

Il resto del file (`resolveThemeVars`, `themeContrastViolations`, i tipi su `ThemeConfig`) resta intatto fino al Task 9: lo usano ancora `UIContext` e la vecchia azione.

- [ ] **Step 1: Scrivi i test che falliscono**

In fondo a `lib/theme-vars.test.ts`, aggiungi (e aggiorna l'import in testa al file come indicato):

```ts
// in testa, accanto all'import esistente da './theme-vars':
import {
  DARK_PALETTE, DEFAULT_PRIMARY, LIGHT_PALETTE, PRIMARY_PRESETS,
  derivePrimary, primaryCss, type PrimaryPair,
} from './theme-vars'
```

```ts
/**
 * Il colore principale calcolato da un colore scelto (specifica §3).
 *
 * L'aritmetica del contrasto e' riscritta qui e non importata dal modulo, come
 * nel blocco «default palette contrast»: un test che misura con la stessa
 * funzione che verifica non si accorgerebbe di una formula sbagliata.
 */
describe('derivePrimary', () => {
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const channel = (v: number) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const surfaces = (p: typeof LIGHT_PALETTE) =>
    [p.background, p.card, p.popover, p.accent, p.sidebar, p['sidebar-accent']]

  const expectReadable = (pair: PrimaryPair, palette: typeof LIGHT_PALETTE) => {
    expect(pair.primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(pair.foreground).toMatch(/^#[0-9a-f]{6}$/)
    for (const surface of surfaces(palette)) {
      expect(ratio(pair.primary, surface)).toBeGreaterThanOrEqual(4.5)
    }
    expect(ratio(pair.foreground, pair.primary)).toBeGreaterThanOrEqual(4.5)
  }

  /** HSL -> hex, per generare colori di prova senza passare dal codice sotto test. */
  const hslToHex = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
      return Math.round(v * 255).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  it('keeps the shipped default untouched in light mode', () => {
    const derived = derivePrimary(DEFAULT_PRIMARY)!
    expect(derived.light).toEqual({ primary: '#4f46e5', foreground: '#ffffff' })
  })

  it('lightens the default in dark mode, where #4f46e5 reads 1.8:1 on the card', () => {
    expect(ratio('#4f46e5', DARK_PALETTE.card)).toBeLessThan(4.5)
    const derived = derivePrimary(DEFAULT_PRIMARY)!
    expect(derived.dark.primary).not.toBe('#4f46e5')
    expectReadable(derived.dark, DARK_PALETTE)
  })

  it.each(PRIMARY_PRESETS.map(p => [p.id, p.color]))('makes the %s preset readable in both modes', (_id, color) => {
    const derived = derivePrimary(color)!
    expectReadable(derived.light, LIGHT_PALETTE)
    expectReadable(derived.dark, DARK_PALETTE)
  })

  it('makes any colour readable in both modes', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const saturation of [0.3, 0.65, 1]) {
        for (const lightness of [0.2, 0.4, 0.6, 0.85]) {
          const seed = hslToHex(hue, saturation, lightness)
          const derived = derivePrimary(seed)
          expect(derived, seed).not.toBeNull()
          expectReadable(derived!.light, LIGHT_PALETTE)
          expectReadable(derived!.dark, DARK_PALETTE)
        }
      }
    }
  })

  it('returns a colour that already passes exactly as chosen', () => {
    expect(derivePrimary('#123456')!.light.primary).toBe('#123456')
  })

  it('normalises upper case to lower case', () => {
    expect(derivePrimary('#4F46E5')!.light.primary).toBe('#4f46e5')
  })

  it.each(['', '#fff', 'red', '#12345g', '4f46e5', '#4f46e5 '])('rejects %j, which is not six hex digits', value => {
    expect(derivePrimary(value)).toBeNull()
  })
})

describe('primaryCss', () => {
  it('writes both modes with selectors that beat the :root fallback in globals.css', () => {
    // html:root e html.dark pesano (0,1,1), :root di globals.css (0,1,0): vincono qualunque sia
    // l'ordine in cui il browser incontra il <style> del layout e il foglio di globals.css.
    const css = primaryCss(DEFAULT_PRIMARY)
    expect(css).toContain('html:root{--primary:#4f46e5;--primary-foreground:#ffffff}')
    expect(css).toMatch(/html\.dark\{--primary:#[0-9a-f]{6};--primary-foreground:#[0-9a-f]{6}\}/)
    expect(css.indexOf('html:root')).toBeLessThan(css.indexOf('html.dark'))
  })

  it('falls back to the default for a value that is not a colour', () => {
    expect(primaryCss('nope')).toBe(primaryCss(DEFAULT_PRIMARY))
  })
})

describe('fixed palette', () => {
  it('ships the same values in TypeScript and in globals.css', () => {
    // Fino al Task 9 globals.css ha solo il blocco :root; il confronto con .dark entra la'.
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    for (const [token, value] of Object.entries(LIGHT_PALETTE)) {
      const declared = css.match(new RegExp(`\\n  --${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
      expect(declared, token).toBe(value)
    }
  })
})
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run lib/theme-vars.test.ts
```

Atteso: FAIL, con `derivePrimary`, `primaryCss`, `LIGHT_PALETTE`… non esportati.

- [ ] **Step 3: Implementa**

In `lib/theme-vars.ts`:

1. Sostituisci `primaryForeground` con la versione che non dipende da `defaultThemeConfig`, e aggiungi la costante sopra di essa:

```ts
/** La scritta scura sul colore principale: il testo principale del modo chiaro. */
const DARK_LABEL = '#111827'

/**
 * The label colour for anything filled with the primary colour: whichever of
 * white and the darkest foreground contrasts better. `derivePrimary` below only
 * returns colours on which this choice reaches 4.5:1.
 */
export function primaryForeground(primary: string): string {
  const onWhite = contrastRatio('#ffffff', primary)
  const onDark = contrastRatio(DARK_LABEL, primary)
  return onWhite >= onDark ? '#ffffff' : DARK_LABEL
}
```

2. In fondo al file, aggiungi:

```ts
/**
 * La tavolozza fissa (DEC-3): sfondi, bordi, testi e sidebar non si configurano
 * piu'. Sono i predefiniti di prima, gia' verificati per il contrasto da
 * `lib/theme-vars.test.ts`, e devono coincidere con `:root` e `.dark` di
 * `app/globals.css` — lo stesso file di test confronta le due copie.
 */
export type PaletteToken =
  | 'background' | 'card' | 'popover' | 'accent' | 'border' | 'border-subtle'
  | 'foreground' | 'foreground-secondary' | 'muted-foreground' | 'foreground-faint'
  | 'sidebar' | 'sidebar-foreground' | 'sidebar-accent' | 'sidebar-accent-foreground'

export const LIGHT_PALETTE: Record<PaletteToken, string> = {
  'background': '#f9fafb',
  'card': '#ffffff',
  'popover': '#ffffff',
  'accent': '#f3f4f6',
  'border': '#e5e7eb',
  'border-subtle': '#f3f4f6',
  'foreground': '#111827',
  'foreground-secondary': '#374151',
  'muted-foreground': '#4b5563',
  'foreground-faint': '#666f7d',
  'sidebar': '#ffffff',
  'sidebar-foreground': '#4b5563',
  'sidebar-accent': '#f3f4f6',
  'sidebar-accent-foreground': '#111827',
}

export const DARK_PALETTE: Record<PaletteToken, string> = {
  'background': '#030712',
  'card': '#1f2937',
  'popover': '#111827',
  'accent': '#1f2937',
  'border': '#374151',
  'border-subtle': '#1f2937',
  'foreground': '#ffffff',
  'foreground-secondary': '#d1d5db',
  'muted-foreground': '#9ca3af',
  'foreground-faint': '#8b919c',
  'sidebar': '#111827',
  'sidebar-foreground': '#9ca3af',
  'sidebar-accent': '#1f2937',
  'sidebar-accent-foreground': '#ffffff',
}

/**
 * Le superfici su cui `--primary` compare. La soglia e' quella del testo (4,5)
 * e non quella dei componenti (3), perche' `--primary` veste anche testo: la
 * variante `link` di `components/ui/button.tsx`.
 */
const PRIMARY_SURFACES: PaletteToken[] = ['background', 'card', 'popover', 'accent', 'sidebar', 'sidebar-accent']

export const DEFAULT_PRIMARY = '#4f46e5'

export const PRIMARY_PRESETS = [
  { id: 'indigo', color: '#4f46e5' },
  { id: 'green', color: '#059669' },
  { id: 'pink', color: '#db2777' },
  { id: 'orange', color: '#ea580c' },
  { id: 'sky', color: '#0284c7' },
] as const

export interface PrimaryPair {
  primary: string
  foreground: string
}

export interface DerivedPrimary {
  light: PrimaryPair
  dark: PrimaryPair
}

/** OKLCH, con la tinta in radianti: serve solo dentro questo modulo. */
interface Oklch {
  l: number
  c: number
  h: number
}

const srgbToLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** sRGB -> OKLab -> OKLCH, con le matrici di Björn Ottosson. */
function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.slice(1), 16)
  const r = srgbToLinear((n >> 16) & 255)
  const g = srgbToLinear((n >> 8) & 255)
  const b = srgbToLinear(n & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

/** I tre canali sRGB lineari, non tagliati: fuori da [0, 1] il colore non e' rappresentabile. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h)
  const B = c * Math.sin(h)
  const l3 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m3 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s3 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
}

const inGamut = (rgb: number[]) => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)

/**
 * OKLCH -> hex. Se il colore cade fuori da sRGB si riduce la saturazione, non la
 * luminosita': la luminosita' e' cio' che il chiamante sta regolando.
 */
function oklchToHex(color: Oklch): string {
  let chroma = color.c
  let rgb = oklchToLinearRgb(color)
  for (let i = 0; i < 60 && !inGamut(rgb); i++) {
    chroma *= 0.9
    rgb = oklchToLinearRgb({ ...color, c: chroma })
  }
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
  return `#${rgb.map(v => byte(v).toString(16).padStart(2, '0')).join('')}`
}

function readableOn(primary: string, palette: Record<PaletteToken, string>): boolean {
  return PRIMARY_SURFACES.every(token => contrastRatio(primary, palette[token]) >= CONTRAST_FLOOR)
    && contrastRatio(primaryForeground(primary), primary) >= CONTRAST_FLOOR
}

const LIGHTNESS_STEP = 0.01

/**
 * Il colore scelto, se gia' si legge; altrimenti la stessa tinta e saturazione a
 * luminosita' via via piu' bassa (chiaro, `direction = -1`) o piu' alta (scuro,
 * `+1`), fermandosi al primo valore che si legge. Agli estremi c'e' sempre il
 * nero o il bianco, che si leggono entrambi: `null` resta un caso di difesa.
 */
function fitPrimary(seed: string, palette: Record<PaletteToken, string>, direction: -1 | 1): PrimaryPair | null {
  if (readableOn(seed, palette)) return { primary: seed, foreground: primaryForeground(seed) }
  const start = hexToOklch(seed)
  for (let step = 1; step <= 1 / LIGHTNESS_STEP; step++) {
    const l = Math.min(1, Math.max(0, start.l + direction * step * LIGHTNESS_STEP))
    const candidate = oklchToHex({ ...start, l })
    if (readableOn(candidate, palette)) return { primary: candidate, foreground: primaryForeground(candidate) }
    if (l === 0 || l === 1) break
  }
  return null
}

/**
 * Le varianti chiaro e scuro di un colore scelto (specifica §3). `null` per un
 * valore che non e' `#rrggbb`, o se un modo non ha nessuna variante leggibile.
 */
export function derivePrimary(seed: string): DerivedPrimary | null {
  if (!isHex(seed)) return null
  const color = seed.toLowerCase()
  const light = fitPrimary(color, LIGHT_PALETTE, -1)
  const dark = fitPrimary(color, DARK_PALETTE, 1)
  return light && dark ? { light, dark } : null
}

/**
 * Il CSS che `app/layout.tsx` scrive nel `<style>` della pagina. I selettori
 * `html:root` e `html.dark` pesano (0,1,1) e battono il `:root` di
 * `globals.css` (0,1,0) qualunque sia l'ordine dei due fogli nel documento.
 */
export function primaryCss(seed: string): string {
  const derived = derivePrimary(seed) ?? derivePrimary(DEFAULT_PRIMARY)!
  const block = (pair: PrimaryPair) => `--primary:${pair.primary};--primary-foreground:${pair.foreground}`
  return `html:root{${block(derived.light)}}html.dark{${block(derived.dark)}}`
}
```

`isHex`, `contrastRatio` e `CONTRAST_FLOOR` esistono già nel file. Se `CONTRAST_FLOOR` è dichiarata sotto `primaryForeground`, lasciala dov'è: il codice nuovo sta in fondo al file e la vede.

- [ ] **Step 4: Lancia i test e verifica che passino**

```bash
npx vitest run lib/theme-vars.test.ts
```

Atteso: PASS, compresi i blocchi preesistenti.

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/theme-vars.ts sources/microservices/web-construct/lib/theme-vars.test.ts
git commit -m "feat(theme): derive light and dark primary from one colour in OKLCH

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Modello delle preferenze

**Files:**
- Create: `sources/microservices/web-construct/lib/appearance.ts`
- Test: `sources/microservices/web-construct/lib/appearance.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces (da `@/lib/appearance`, nessuna dipendenza server, importabile dal client):
  - `THEME_MODES`, `type ThemeMode = 'light' | 'dark' | 'system'`;
  - `TEXT_SCALES`, `type TextScale = 90 | 100 | 110 | 120 | 130`;
  - `interface Appearance { mode: ThemeMode; scale: TextScale }`, `DEFAULT_APPEARANCE`;
  - `APPEARANCE_COOKIE = 'construct_appearance'`, `APPEARANCE_COOKIE_MAX_AGE`;
  - `DARK_CLASS = 'dark'`;
  - `appearancePatchSchema` (Zod), `type AppearancePatch = { mode?: ThemeMode; scale?: TextScale }`;
  - `serializeAppearance(a: Appearance): string`, `parseAppearanceCookie(raw?: string | null): Appearance | null`;
  - `toAppearance(row: { themeMode: string; textScale: number }): Appearance`;
  - `THEME_MODE_SCRIPT: string`;
  - `applyAppearance(root: HTMLElement, a: Appearance, prefersDark: boolean): void`;
  - `prefersDarkScheme(): boolean`.

- [ ] **Step 1: Scrivi i test che falliscono**

`lib/appearance.test.ts`:

```ts
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DARK_CLASS, DEFAULT_APPEARANCE, THEME_MODE_SCRIPT, appearancePatchSchema, applyAppearance,
  parseAppearanceCookie, serializeAppearance, toAppearance,
} from './appearance'

describe('appearance cookie', () => {
  it('round-trips every valid value', () => {
    for (const mode of ['light', 'dark', 'system'] as const) {
      for (const scale of [90, 100, 110, 120, 130] as const) {
        expect(parseAppearanceCookie(serializeAppearance({ mode, scale }))).toEqual({ mode, scale })
      }
    }
  })

  it.each([undefined, null, '', 'dark', 'dark.105', 'sepia.100', 'dark.100.1', 'DARK.100'])(
    'rejects %j instead of guessing',
    raw => expect(parseAppearanceCookie(raw)).toBeNull(),
  )
})

describe('toAppearance', () => {
  it('passes valid profile values through', () => {
    expect(toAppearance({ themeMode: 'dark', textScale: 120 })).toEqual({ mode: 'dark', scale: 120 })
  })

  it('falls back field by field on a value the database should never hold', () => {
    expect(toAppearance({ themeMode: 'sepia', textScale: 120 })).toEqual({ mode: DEFAULT_APPEARANCE.mode, scale: 120 })
    expect(toAppearance({ themeMode: 'dark', textScale: 105 })).toEqual({ mode: 'dark', scale: DEFAULT_APPEARANCE.scale })
  })
})

describe('appearancePatchSchema', () => {
  it('accepts a partial patch', () => {
    expect(appearancePatchSchema.safeParse({ mode: 'light' }).success).toBe(true)
    expect(appearancePatchSchema.safeParse({ scale: 130 }).success).toBe(true)
  })

  it.each([{ mode: 'sepia' }, { scale: 105 }, { scale: '110' }, { mode: 'dark', extra: 1 }])(
    'rejects %j',
    patch => expect(appearancePatchSchema.safeParse(patch).success).toBe(false),
  )
})

describe('THEME_MODE_SCRIPT', () => {
  let listeners: (() => void)[]
  let osDark: boolean

  beforeEach(() => {
    listeners = []
    osDark = false
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() { return osDark },
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      }),
    })
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-mode')
    document.documentElement.classList.remove(DARK_CLASS)
  })

  const run = (mode: string) => {
    document.documentElement.setAttribute('data-theme-mode', mode)
    new Function(THEME_MODE_SCRIPT)()
  }
  const isDark = () => document.documentElement.classList.contains(DARK_CLASS)

  it('adds the dark class for dark and removes it for light', () => {
    run('dark')
    expect(isDark()).toBe(true)
    run('light')
    expect(isDark()).toBe(false)
  })

  it('follows the operating system in system mode, including later changes', () => {
    osDark = true
    run('system')
    expect(isDark()).toBe(true)
    osDark = false
    listeners.forEach(fn => fn())
    expect(isDark()).toBe(false)
  })

  it('ignores operating-system changes once the user picked a fixed mode', () => {
    run('system')
    document.documentElement.setAttribute('data-theme-mode', 'light')
    osDark = true
    listeners.forEach(fn => fn())
    expect(isDark()).toBe(false)
  })
})

describe('applyAppearance', () => {
  afterEach(() => {
    const root = document.documentElement
    root.removeAttribute('data-theme-mode')
    root.classList.remove(DARK_CLASS)
    root.style.removeProperty('font-size')
  })

  it('writes the mode, the dark class and the text scale on the root', () => {
    const root = document.documentElement
    applyAppearance(root, { mode: 'dark', scale: 120 }, false)
    expect(root.getAttribute('data-theme-mode')).toBe('dark')
    expect(root.classList.contains(DARK_CLASS)).toBe(true)
    expect(root.style.fontSize).toBe('120%')
  })

  it('resolves system mode with the operating-system preference it is given', () => {
    const root = document.documentElement
    applyAppearance(root, { mode: 'system', scale: 100 }, true)
    expect(root.classList.contains(DARK_CLASS)).toBe(true)
    applyAppearance(root, { mode: 'system', scale: 100 }, false)
    expect(root.classList.contains(DARK_CLASS)).toBe(false)
  })

  it('does not touch the inline custom properties set by the theme preview', () => {
    const root = document.documentElement
    root.style.setProperty('--primary', '#123456')
    applyAppearance(root, { mode: 'light', scale: 90 }, false)
    expect(root.style.getPropertyValue('--primary')).toBe('#123456')
    root.style.removeProperty('--primary')
  })
})
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run lib/appearance.test.ts
```

Atteso: FAIL, `Cannot find module './appearance'`.

- [ ] **Step 3: Implementa**

`lib/appearance.ts`:

```ts
import { z } from 'zod'

/**
 * Le preferenze personali di aspetto (specifica §2.2, §2.3, §4). Nessuna
 * dipendenza server: lo importano il layout, le azioni e la pagina Impostazioni.
 */

export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const TEXT_SCALES = [90, 100, 110, 120, 130] as const
export type TextScale = (typeof TEXT_SCALES)[number]

export interface Appearance {
  mode: ThemeMode
  scale: TextScale
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', scale: 100 }

/** Letto solo per i visitatori anonimi: per un utente autenticato vince il profilo (§2.3). */
export const APPEARANCE_COOKIE = 'construct_appearance'
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** La classe che `@custom-variant dark` in `app/globals.css` riconosce. */
export const DARK_CLASS = 'dark'

export const appearancePatchSchema = z.object({
  mode: z.enum(THEME_MODES).optional(),
  scale: z.literal(TEXT_SCALES).optional(),
}).strict()

export type AppearancePatch = z.infer<typeof appearancePatchSchema>

const isThemeMode = (v: string): v is ThemeMode => (THEME_MODES as readonly string[]).includes(v)
const isTextScale = (v: number): v is TextScale => (TEXT_SCALES as readonly number[]).includes(v)

/** `dark.110`: abbastanza corto per un cookie, nessun JSON da validare. */
export function serializeAppearance(appearance: Appearance): string {
  return `${appearance.mode}.${appearance.scale}`
}

export function parseAppearanceCookie(raw?: string | null): Appearance | null {
  const match = raw?.match(/^([a-z]+)\.(\d+)$/)
  if (!match) return null
  const scale = Number(match[2])
  return isThemeMode(match[1]) && isTextScale(scale) ? { mode: match[1], scale } : null
}

/** I vincoli del database garantiscono gia' i valori; questo e' il piano di riserva campo per campo. */
export function toAppearance(row: { themeMode: string; textScale: number }): Appearance {
  return {
    mode: isThemeMode(row.themeMode) ? row.themeMode : DEFAULT_APPEARANCE.mode,
    scale: isTextScale(row.textScale) ? row.textScale : DEFAULT_APPEARANCE.scale,
  }
}

/**
 * Mette o toglie la classe `dark` prima che la pagina compaia, leggendo
 * `data-theme-mode` su `<html>`. Sempre presente, non solo in modo `system`:
 * l'ascoltatore resta attivo anche se l'utente passa a `system` dalla pagina
 * Impostazioni senza ricaricare.
 *
 * La classe non la gestisce React (specifica §4): un `router.refresh()` la
 * toglierebbe a un utente in `system` con sistema operativo scuro.
 */
export const THEME_MODE_SCRIPT =
  `(function(){var d=document.documentElement,q=window.matchMedia('(prefers-color-scheme: dark)');` +
  `function a(){var m=d.getAttribute('data-theme-mode');d.classList.toggle('${DARK_CLASS}',m==='dark'||(m==='system'&&q.matches))}` +
  `a();q.addEventListener('change',a)})()`

/** Lo stesso effetto dello script, dal client, quando l'utente cambia una preferenza. */
export function applyAppearance(root: HTMLElement, appearance: Appearance, prefersDark: boolean): void {
  root.setAttribute('data-theme-mode', appearance.mode)
  root.classList.toggle(DARK_CLASS, appearance.mode === 'dark' || (appearance.mode === 'system' && prefersDark))
  root.style.fontSize = `${appearance.scale}%`
}

export function prefersDarkScheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
```

- [ ] **Step 4: Lancia i test e verifica che passino**

```bash
npx vitest run lib/appearance.test.ts
```

Atteso: PASS. Se `z.literal(TEXT_SCALES)` non compila con la versione di Zod installata, sostituiscilo con `z.union([z.literal(90), z.literal(100), z.literal(110), z.literal(120), z.literal(130)])`, che è equivalente.

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/appearance.ts sources/microservices/web-construct/lib/appearance.test.ts
git commit -m "feat(theme): model personal appearance and the pre-paint theme script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Letture e azioni server

**Files:**
- Create: `sources/microservices/web-construct/lib/appearance-server.ts`
- Create: `sources/microservices/web-construct/lib/theme-server.ts`
- Create: `sources/microservices/web-construct/lib/appearance-actions.ts`
- Modify: `sources/microservices/web-construct/lib/theme-actions.ts`
- Test: `sources/microservices/web-construct/lib/appearance-actions.test.ts`
- Test: `sources/microservices/web-construct/lib/theme-actions.test.ts`

**Interfaces:**
- Consumes: `appTheme`, `users.themeMode`, `users.textScale` (T1); `derivePrimary`, `DEFAULT_PRIMARY` (T2); tutto `@/lib/appearance` (T3); `requireAdmin()` da `@/lib/rbac/auth-guard`; `shouldUseSecureCookies` da `@/lib/i18n/cookie-security`.
- Produces:
  - `getAppearance(): Promise<Appearance>` (`@/lib/appearance-server`, deduplicata per richiesta);
  - `getAppPrimaryColor(): Promise<string>` (`@/lib/theme-server`, deduplicata per richiesta);
  - `saveAppearance(patch: AppearancePatch): Promise<{ error: string | null; appearance?: Appearance }>` (`@/lib/appearance-actions`);
  - `saveAppPrimaryColor(color: string): Promise<{ error: SavePrimaryError | null }>` con `type SavePrimaryError = 'unauthorized' | 'invalid' | 'unreadable' | 'failed'` (`@/lib/theme-actions`).

- [ ] **Step 1: Scrivi i test che falliscono**

`lib/appearance-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  set: vi.fn(),
  returning: vi.fn(),
  cookieSet: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookieSet }) }))
vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        mocks.set(values)
        return { where: () => ({ returning: mocks.returning }) }
      },
    }),
  },
}))

const { saveAppearance } = await import('./appearance-actions')

describe('saveAppearance', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset())
    mocks.auth.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.returning.mockResolvedValue([{ themeMode: 'dark', textScale: 110 }])
  })

  it('refuses a request without a session', async () => {
    mocks.auth.mockResolvedValue(null)
    expect(await saveAppearance({ mode: 'dark' })).toEqual({ error: 'Not authenticated' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each([{ mode: 'sepia' }, { scale: 105 }, {}])('refuses %j without writing', async patch => {
    expect((await saveAppearance(patch as never)).error).toBe('Invalid appearance')
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('writes only the fields it was given', async () => {
    await saveAppearance({ mode: 'dark' })
    expect(mocks.set).toHaveBeenCalledWith({ themeMode: 'dark' })
  })

  it('returns the stored row and mirrors it into the cookie', async () => {
    const result = await saveAppearance({ scale: 110 })
    expect(result).toEqual({ error: null, appearance: { mode: 'dark', scale: 110 } })
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'construct_appearance', 'dark.110',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
    )
  })

  it('reports a database failure instead of throwing', async () => {
    mocks.returning.mockRejectedValue(new Error('boom'))
    expect(await saveAppearance({ mode: 'light' })).toEqual({ error: 'Save failed' })
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })
})
```

`lib/theme-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/db', () => ({
  db: { update: () => ({ set: (values: unknown) => mocks.set(values) }) },
}))
vi.mock('@/lib/theme-vars', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/theme-vars')>()
  return { ...actual, derivePrimary: vi.fn(actual.derivePrimary) }
})

const { saveAppPrimaryColor } = await import('./theme-actions')
const { derivePrimary } = await import('@/lib/theme-vars')

describe('saveAppPrimaryColor', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset().mockResolvedValue({ userId: 'admin-1', roleIds: [1] })
    mocks.set.mockReset().mockResolvedValue(undefined)
  })

  it('refuses anyone requireAdmin refuses', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('Unauthorized'))
    expect(await saveAppPrimaryColor('#123456')).toEqual({ error: 'unauthorized' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each(['red', '#fff', '#12345g', ''])('refuses %j', async value => {
    expect(await saveAppPrimaryColor(value)).toEqual({ error: 'invalid' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('refuses a colour with no readable variant', async () => {
    vi.mocked(derivePrimary).mockReturnValueOnce(null)
    expect(await saveAppPrimaryColor('#123456')).toEqual({ error: 'unreadable' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('stores the colour in lower case', async () => {
    expect(await saveAppPrimaryColor('#ABCDEF')).toEqual({ error: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ primaryColor: '#abcdef' }))
  })

  it('reports a database failure instead of throwing', async () => {
    mocks.set.mockRejectedValue(new Error('boom'))
    expect(await saveAppPrimaryColor('#123456')).toEqual({ error: 'failed' })
  })
})
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run lib/appearance-actions.test.ts lib/theme-actions.test.ts
```

Atteso: FAIL — modulo `./appearance-actions` assente, `saveAppPrimaryColor` non esportata.

- [ ] **Step 3: Implementa le letture**

`lib/appearance-server.ts`:

```ts
import { cache } from 'react'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { APPEARANCE_COOKIE, DEFAULT_APPEARANCE, parseAppearanceCookie, toAppearance, type Appearance } from './appearance'

const log = createLogger('appearance')

/**
 * Le preferenze di aspetto della richiesta (specifica §2.3): il profilo per un
 * utente autenticato, il cookie per un visitatore anonimo, poi i predefiniti.
 * Il profilo viene prima del cookie perche' un cookie di un anno su un secondo
 * browser resterebbe fermo a una scelta che l'utente ha gia' cambiato altrove.
 */
export const getAppearance = cache(async (): Promise<Appearance> => {
  const session = await auth()
  const userId = session?.user?.id
  if (userId) {
    try {
      const [row] = await db
        .select({ themeMode: users.themeMode, textScale: users.textScale })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      if (row) return toAppearance(row)
    } catch (err) {
      log.error({ err }, 'failed to read the appearance preference')
    }
  }
  const store = await cookies()
  return parseAppearanceCookie(store.get(APPEARANCE_COOKIE)?.value) ?? DEFAULT_APPEARANCE
})
```

`lib/theme-server.ts`:

```ts
import { cache } from 'react'
import { db } from '@/lib/db'
import { appTheme } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { DEFAULT_PRIMARY } from './theme-vars'

const log = createLogger('theme')

/**
 * Il colore principale dell'app (DEC-1). Un database irraggiungibile non deve
 * impedire di disegnare la pagina: si ripiega sul predefinito.
 */
export const getAppPrimaryColor = cache(async (): Promise<string> => {
  try {
    const [row] = await db.select({ primaryColor: appTheme.primaryColor }).from(appTheme).limit(1)
    return row?.primaryColor ?? DEFAULT_PRIMARY
  } catch (err) {
    log.error({ err }, 'failed to read the application colour')
    return DEFAULT_PRIMARY
  }
})
```

- [ ] **Step 4: Implementa le azioni**

`lib/appearance-actions.ts`:

```ts
'use server'

import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { shouldUseSecureCookies } from '@/lib/i18n/cookie-security'
import {
  APPEARANCE_COOKIE, APPEARANCE_COOKIE_MAX_AGE, appearancePatchSchema, serializeAppearance, toAppearance,
  type Appearance, type AppearancePatch,
} from './appearance'

const log = createLogger('appearance')

/**
 * Salva una preferenza di aspetto sul profilo e la ricopia nel cookie, che
 * serve solo alle pagine anonime (specifica §2.3). Restituisce i valori come
 * stanno sul database, non come sono arrivati.
 */
export async function saveAppearance(
  patch: AppearancePatch,
): Promise<{ error: string | null; appearance?: Appearance }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: 'Not authenticated' }

  const parsed = appearancePatchSchema.safeParse(patch)
  if (!parsed.success || (parsed.data.mode === undefined && parsed.data.scale === undefined)) {
    return { error: 'Invalid appearance' }
  }

  const values: { themeMode?: Appearance['mode']; textScale?: Appearance['scale'] } = {}
  if (parsed.data.mode !== undefined) values.themeMode = parsed.data.mode
  if (parsed.data.scale !== undefined) values.textScale = parsed.data.scale

  try {
    const [row] = await db
      .update(users)
      .set(values)
      .where(eq(users.id, userId))
      .returning({ themeMode: users.themeMode, textScale: users.textScale })
    if (!row) return { error: 'Not authenticated' }

    const appearance = toAppearance(row)
    const store = await cookies()
    store.set(APPEARANCE_COOKIE, serializeAppearance(appearance), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureCookies(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL, process.env.NODE_ENV),
      maxAge: APPEARANCE_COOKIE_MAX_AGE,
    })
    return { error: null, appearance }
  } catch (err) {
    log.error({ err }, 'failed to save the appearance preference')
    return { error: 'Save failed' }
  }
}
```

In `lib/theme-actions.ts` aggiungi in testa gli import mancanti e in fondo la funzione nuova. `saveThemeConfig` e `loadThemeConfig` restano fino al Task 9.

```ts
// import da aggiungere in testa, accanto a quelli esistenti
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { appTheme } from '@/lib/db/schema'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createLogger } from '@/lib/logger'
import { derivePrimary } from '@/lib/theme-vars'
```

`eq` è già importato da `drizzle-orm`: unisci `sql` allo stesso import (`import { eq, sql } from 'drizzle-orm'`). Lo stesso vale per `@/lib/db/schema` (`import { appTheme, users } from '@/lib/db/schema'`) e per `@/lib/theme-vars` (`import { derivePrimary, themeContrastViolations, type ContrastViolation } from '@/lib/theme-vars'`).

```ts
const log = createLogger('theme')

const primaryColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toLowerCase())

export type SavePrimaryError = 'unauthorized' | 'invalid' | 'unreadable' | 'failed'

/**
 * Il colore principale dell'app, uno per tutti (DEC-1). `requireAdmin` e non
 * `session.user.isAdmin`: verifica i ruoli sul database, quindi un admin
 * declassato con un JWT ancora valido viene rifiutato.
 */
export async function saveAppPrimaryColor(color: string): Promise<{ error: SavePrimaryError | null }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'unauthorized' }
  }

  const parsed = primaryColorSchema.safeParse(color)
  if (!parsed.success) return { error: 'invalid' }
  if (!derivePrimary(parsed.data)) return { error: 'unreadable' }

  try {
    await db.update(appTheme).set({ primaryColor: parsed.data, dateMod: sql`now()` })
    return { error: null }
  } catch (err) {
    log.error({ err }, 'failed to save the application colour')
    return { error: 'failed' }
  }
}
```

- [ ] **Step 5: Lancia i test e verifica che passino**

```bash
npx vitest run lib/appearance-actions.test.ts lib/theme-actions.test.ts
npm run typecheck
```

Atteso: PASS e nessun errore di tipo. Se `typecheck` rifiuta `dateMod: sql\`now()\`` per via di `mode: 'string'`, usa `dateMod: new Date().toISOString()`.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/lib/appearance-server.ts sources/microservices/web-construct/lib/theme-server.ts sources/microservices/web-construct/lib/appearance-actions.ts sources/microservices/web-construct/lib/appearance-actions.test.ts sources/microservices/web-construct/lib/theme-actions.ts sources/microservices/web-construct/lib/theme-actions.test.ts
git commit -m "feat(theme): read and save the app colour and personal appearance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Componenti shadcn `toggle-group` e `slider`

**Files:**
- Create (con `npx shadcn add`, poi adattati): `components/ui/toggle.tsx`, `components/ui/toggle-group.tsx`, `components/ui/slider.tsx`
- Test: `components/ui/toggle-group.test.tsx`, `components/ui/slider.test.tsx`

**Interfaces:**
- Consumes: niente.
- Produces: `ToggleGroup`, `ToggleGroupItem` da `@/components/ui/toggle-group`; `Slider` da `@/components/ui/slider`. API quella di shadcn: `ToggleGroup type="single" value onValueChange`, `Slider min max step value onValueChange onValueCommit`.

- [ ] **Step 1: Aggiungi i componenti**

Da `sources/microservices/web-construct/`:

```bash
npx shadcn@latest add toggle-group slider
git status --short
```

Atteso: tre file nuovi in `components/ui/`. Se `app/globals.css` o `package.json` risultano modificati, scarta quelle modifiche: le variabili che shadcn aggiunge non appartengono al nostro vocabolario.

```bash
git checkout -- app/globals.css
```

Se `package.json` ha guadagnato una dipendenza `@radix-ui/react-*`, toglila e fai importare il componente da `radix-ui` (già dipendenza), nello stesso modo di `components/ui/dropdown-menu.tsx`. Per esempio: `import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"`.

- [ ] **Step 2: Rileggi e adatta (AGENTS.md: mai incollare lo stock senza rileggerlo)**

In `toggle.tsx`, nella `cva` di `toggleVariants`:
- togli `disabled:pointer-events-none` e `disabled:opacity-50`. Il motivo è lo stesso di `button.tsx`: `globals.css` applica già `filter: opacity(0.6)` e il cursore `not-allowed` deve restare visibile.
- riscrivi ogni `hover:` come `[&:not(:disabled)]:hover:`. Per esempio, `hover:bg-muted hover:text-muted-foreground` diventa `[&:not(:disabled)]:hover:bg-accent [&:not(:disabled)]:hover:text-foreground`.
- lo stato selezionato deve essere `data-[state=on]:bg-accent data-[state=on]:text-foreground`.
- nella variante `outline`, `border-input` va bene perché `--input` esiste in `globals.css`. `shadow-xs` va bene anch'esso.
- lascia stare le classi `aria-invalid:*` e `focus-visible:*`: usano `--destructive` e `--ring`, che esistono.

In `slider.tsx`:
- la traccia (`data-slot="slider-track"`) da `bg-muted` diventa `bg-switch-off`. `--muted` vale `--accent` (`#f3f4f6`), cioè 1,1:1 sulla card bianca, quindi la traccia sparirebbe. `--switch-off` è il colore che il progetto ha già scelto per lo stesso problema (vedi il suo commento in `globals.css`).
- il cursore (`data-slot="slider-thumb"`) usa `border-primary bg-background`. Togli `disabled:pointer-events-none` se c'è.

In `toggle-group.tsx` non dovrebbe servire nulla oltre agli import. Controlla comunque che non contenga `hover:` nudi.

- [ ] **Step 3: Scrivi i test**

`components/ui/toggle-group.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

describe('ToggleGroup', () => {
  it('exposes a single-choice group as radios with the checked one marked', () => {
    const html = renderToStaticMarkup(
      <ToggleGroup type="single" value="b" aria-label="Scelta">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    )
    expect(html).toContain('role="radio"')
    expect(html).toMatch(/aria-checked="true"[^>]*>B</)
  })

  it('keeps the project button rules: no pointer-events-none, no bare hover', () => {
    for (const file of ['toggle.tsx', 'toggle-group.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      expect(source, file).not.toContain('disabled:pointer-events-none')
      expect(source, file).not.toMatch(/(^|[\s"'`])hover:/m)
    }
  })
})
```

`components/ui/slider.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Slider } from './slider'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

describe('Slider', () => {
  it('renders a slider thumb carrying its value and bounds', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => root.render(<Slider min={90} max={130} step={10} value={[110]} aria-label="Dimensione" />))
    const thumb = container.querySelector('[role="slider"]')
    expect(thumb?.getAttribute('aria-valuenow')).toBe('110')
    expect(thumb?.getAttribute('aria-valuemin')).toBe('90')
    expect(thumb?.getAttribute('aria-valuemax')).toBe('130')
    act(() => root.unmount())
    container.remove()
  })

  it('draws the track with the switch-off colour, not the invisible --muted', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Slider value={[50]} />))
    expect(container.querySelector('[data-slot="slider-track"]')?.className).toContain('bg-switch-off')
    act(() => root.unmount())
  })
})
```

`aria-label` passato a `Slider` deve arrivare al thumb. Se lo stock lo passa solo alla radice, aggiungi in `slider.tsx` la prop `thumbLabel?: string` e falla arrivare come `aria-label` a ogni `SliderPrimitive.Thumb`. Il test qui sopra non dipende da questo; la pagina Impostazioni (T8) sì.

- [ ] **Step 4: Lancia i test e le guardie**

```bash
npx vitest run components/ui guards
npm run test:tokens
npm run test:raw-colors
npm run typecheck
npm run lint
```

Atteso: tutto verde.

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/ui/toggle.tsx sources/microservices/web-construct/components/ui/toggle-group.tsx sources/microservices/web-construct/components/ui/slider.tsx sources/microservices/web-construct/components/ui/toggle-group.test.tsx sources/microservices/web-construct/components/ui/slider.test.tsx
git commit -m "feat(ui): add shadcn toggle-group and slider, adapted to the project rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mattoni dell'interfaccia

**Files:**
- Create: `components/settings/SettingsSection.tsx`
- Create: `components/theme/ColorSwatches.tsx`
- Create: `components/theme/PalettePreview.tsx`
- Test: `components/theme/ColorSwatches.test.tsx`, `components/theme/PalettePreview.test.tsx`

**Interfaces:**
- Consumes: `primaryForeground`, `LIGHT_PALETTE`, `DARK_PALETTE`, `type DerivedPrimary` (T2).
- Produces:
  - `SettingsSection({ icon: LucideIcon, title: string, children })` e `SettingsRow({ label?: string, hint?: string, children })` da `@/components/settings/SettingsSection`;
  - `ColorSwatches({ options: SwatchOption[], value: string, groupLabel: string, customLabel: string, disabled?: boolean, onChange(color: string) })`, `type SwatchOption = { id: string; color: string; label: string }`, `CUSTOM_SWATCH_ID = 'custom'` da `@/components/theme/ColorSwatches`;
  - `PalettePreview({ derived: DerivedPrimary, labels: PalettePreviewLabels })`, `type PalettePreviewLabels = { light; dark; primary; hover; surface; background; sidebar }` (tutte `string`) da `@/components/theme/PalettePreview`;
  - `data-testid` usati dagli E2E: `theme-swatch-<id>`, `theme-swatch-custom`, `theme-custom-color`, `theme-primary-hex`, `theme-preview-light`, `theme-preview-dark`, `theme-preview-<modo>-<cella>`.

- [ ] **Step 1: Scrivi i test che falliscono**

`components/theme/ColorSwatches.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorSwatches, type SwatchOption } from './ColorSwatches'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const options: SwatchOption[] = [
  { id: 'indigo', color: '#4f46e5', label: 'Indaco' },
  { id: 'green', color: '#059669', label: 'Verde' },
]

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(value: string, onChange = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(
    <ColorSwatches options={options} value={value} groupLabel="Colore" customLabel="Personalizzato" onChange={onChange} />,
  ))
  return onChange
}

const swatch = (id: string) => container!.querySelector(`[data-testid="theme-swatch-${id}"]`) as HTMLButtonElement

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('ColorSwatches', () => {
  it('checks the preset that matches the value and names every swatch', () => {
    render('#059669')
    expect(swatch('green').getAttribute('aria-checked')).toBe('true')
    expect(swatch('indigo').getAttribute('aria-checked')).toBe('false')
    expect(swatch('indigo').getAttribute('aria-label')).toBe('Indaco')
    expect(container!.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Colore')
  })

  it('checks the custom swatch, painted with the value, when no preset matches', () => {
    render('#123456')
    expect(swatch('custom').getAttribute('aria-checked')).toBe('true')
    expect(swatch('custom').style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(container!.querySelector('[data-testid="theme-primary-hex"]')?.textContent).toBe('#123456')
  })

  it('reports the colour of a clicked preset', () => {
    const onChange = render('#4f46e5')
    act(() => swatch('green').click())
    expect(onChange).toHaveBeenCalledWith('#059669')
  })

  it('reports a colour typed into the custom picker in lower case', () => {
    const onChange = render('#4f46e5')
    const input = container!.querySelector('[data-testid="theme-custom-color"]') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#ABCDEF')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('#abcdef')
  })

  it('opens the native picker when the custom swatch is clicked', () => {
    render('#4f46e5')
    const input = container!.querySelector('[data-testid="theme-custom-color"]') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    act(() => swatch('custom').click())
    expect(click).toHaveBeenCalled()
  })

  it('disables every swatch and the picker while disabled', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(
      <ColorSwatches options={options} value="#4f46e5" groupLabel="Colore" customLabel="Personalizzato" disabled onChange={vi.fn()} />,
    ))
    for (const id of ['indigo', 'green', 'custom']) expect(swatch(id).disabled).toBe(true)
    expect((container.querySelector('[data-testid="theme-custom-color"]') as HTMLInputElement).disabled).toBe(true)
  })
})
```

`components/theme/PalettePreview.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derivePrimary } from '@/lib/theme-vars'
import { PalettePreview } from './PalettePreview'

const labels = {
  light: 'Chiaro', dark: 'Scuro', primary: 'Principale', hover: 'Passaggio',
  surface: 'Superficie', background: 'Sfondo', sidebar: 'Sidebar',
}

describe('PalettePreview', () => {
  it('paints each mode with its own primary pair and fixed palette', () => {
    const derived = derivePrimary('#4f46e5')!
    const html = renderToStaticMarkup(<PalettePreview derived={derived} labels={labels} />)
    expect(html).toContain('data-testid="theme-preview-light"')
    expect(html).toContain('data-testid="theme-preview-dark"')
    expect(html).toMatch(/data-testid="theme-preview-light-primary"[^>]*background-color:#4f46e5;color:#ffffff/)
    expect(html).toMatch(new RegExp(`data-testid="theme-preview-dark-primary"[^>]*background-color:${derived.dark.primary}`))
    expect(html).toMatch(/data-testid="theme-preview-dark-background"[^>]*background-color:#030712/)
  })
})
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run components/theme
```

Atteso: FAIL, moduli assenti.

- [ ] **Step 3: Implementa**

`components/settings/SettingsSection.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Una sezione delle pagine Tema & Stili e Impostazioni: icona, titolo con la
 * riga sotto, come le intestazioni di sezione di prima (specifica §6).
 */
export function SettingsSection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 border-b border-border pb-2 font-medium text-foreground">
        <Icon size={16} className="text-primary" aria-hidden="true" />
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** Etichetta e spiegazione a sinistra, controllo a destra; impilati su schermi stretti. */
export function SettingsRow({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {label && <p className="text-sm text-foreground-secondary">{label}</p>}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
```

`components/theme/ColorSwatches.tsx`:

```tsx
'use client'

import { useRef } from 'react'
import { RadioGroup } from 'radix-ui'
import { Check, Pipette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { primaryForeground } from '@/lib/theme-vars'

export interface SwatchOption {
  id: string
  color: string
  label: string
}

export const CUSTOM_SWATCH_ID = 'custom'

interface ColorSwatchesProps {
  options: SwatchOption[]
  /** Il colore corrente, `#rrggbb` minuscolo. */
  value: string
  groupLabel: string
  customLabel: string
  disabled?: boolean
  onChange: (color: string) => void
}

const swatchCls = cn(
  'relative flex h-8 w-8 items-center justify-center rounded-full',
  'ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'data-[state=checked]:ring-2 data-[state=checked]:ring-foreground',
)

/**
 * I pallini del colore principale (specifica §6.1). La primitiva `RadioGroup`
 * di radix-ui, non il `radio-group` di shadcn: quello disegna sempre il proprio
 * cerchietto con indicatore e non lascia posto a un pallino colorato (§6.4).
 *
 * Il pallino «Personalizzato» apre il selettore nativo con un click (o Invio /
 * Spazio). Le frecce lo raggiungono senza aprire nulla: un selettore che si apre
 * mentre si scorre il gruppo con la tastiera sarebbe una trappola.
 */
export function ColorSwatches({ options, value, groupLabel, customLabel, disabled, onChange }: ColorSwatchesProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const selectedId = options.find(option => option.color === value)?.id ?? CUSTOM_SWATCH_ID
  const customSelected = selectedId === CUSTOM_SWATCH_ID

  return (
    <div className="flex items-center gap-3">
      <RadioGroup.Root
        value={selectedId}
        onValueChange={id => {
          const option = options.find(o => o.id === id)
          if (option) onChange(option.color)
        }}
        aria-label={groupLabel}
        orientation="horizontal"
        disabled={disabled}
        className="flex items-center gap-3"
      >
        {options.map(option => (
          <RadioGroup.Item
            key={option.id}
            value={option.id}
            aria-label={option.label}
            title={option.label}
            data-testid={`theme-swatch-${option.id}`}
            className={swatchCls}
            style={{ backgroundColor: option.color }}
          >
            <RadioGroup.Indicator>
              <Check size={16} style={{ color: primaryForeground(option.color) }} aria-hidden="true" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
        <RadioGroup.Item
          value={CUSTOM_SWATCH_ID}
          aria-label={customLabel}
          title={customLabel}
          data-testid="theme-swatch-custom"
          onClick={() => colorInputRef.current?.click()}
          className={cn(swatchCls, 'border border-border')}
          style={customSelected ? { backgroundColor: value } : undefined}
        >
          {customSelected
            ? <Check size={16} style={{ color: primaryForeground(value) }} aria-hidden="true" />
            : <Pipette size={16} className="text-muted-foreground" aria-hidden="true" />}
        </RadioGroup.Item>
      </RadioGroup.Root>
      <input
        ref={colorInputRef}
        type="color"
        value={value}
        onChange={e => onChange(e.target.value.toLowerCase())}
        disabled={disabled}
        tabIndex={-1}
        aria-label={customLabel}
        data-testid="theme-custom-color"
        className="sr-only"
      />
      <span className="w-16 font-mono text-xs uppercase text-muted-foreground" data-testid="theme-primary-hex">{value}</span>
    </div>
  )
}
```

Il testo esadecimale ha la classe `uppercase` ma il contenuto resta minuscolo: il test controlla `textContent`, gli E2E il testo nel DOM. Se Playwright legge il testo trasformato, negli E2E (T11) confronta con `to_have_text(re.compile(value, re.I))`.

`components/theme/PalettePreview.tsx`:

```tsx
import { DARK_PALETTE, LIGHT_PALETTE, type DerivedPrimary, type PaletteToken, type PrimaryPair } from '@/lib/theme-vars'

export interface PalettePreviewLabels {
  light: string
  dark: string
  primary: string
  hover: string
  surface: string
  background: string
  sidebar: string
}

interface Cell {
  key: 'primary' | 'hover' | 'surface' | 'background' | 'sidebar'
  bg: string
  fg: string
}

function cells(pair: PrimaryPair, palette: Record<PaletteToken, string>): Cell[] {
  return [
    { key: 'primary', bg: pair.primary, fg: pair.foreground },
    { key: 'hover', bg: palette.accent, fg: palette.foreground },
    { key: 'surface', bg: palette.card, fg: palette.foreground },
    { key: 'background', bg: palette.background, fg: palette.foreground },
    { key: 'sidebar', bg: palette.sidebar, fg: palette['sidebar-foreground'] },
  ]
}

/**
 * L'anteprima della tavolozza nei due modi (specifica §6.1). I colori sono quelli
 * veri, calcolati o fissi, non i token: la striscia «Scuro» deve mostrare il modo
 * scuro anche mentre la pagina e' in chiaro.
 */
export function PalettePreview({ derived, labels }: { derived: DerivedPrimary; labels: PalettePreviewLabels }) {
  const rows = [
    { key: 'light', title: labels.light, cells: cells(derived.light, LIGHT_PALETTE) },
    { key: 'dark', title: labels.dark, cells: cells(derived.dark, DARK_PALETTE) },
  ]
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.key} data-testid={`theme-preview-${row.key}`}>
          <p className="mb-1 text-xs text-muted-foreground">{row.title}</p>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium">
            {row.cells.map(cell => (
              <div
                key={cell.key}
                data-testid={`theme-preview-${row.key}-${cell.key}`}
                className="flex h-12 min-w-0 flex-1 items-center justify-center truncate px-1"
                style={{ backgroundColor: cell.bg, color: cell.fg }}
              >
                {labels[cell.key]}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Lancia i test e le guardie**

```bash
npx vitest run components/theme guards
npm run test:raw-colors
npm run test:tokens
npm run typecheck
```

Atteso: tutto verde.

- [ ] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/components/settings sources/microservices/web-construct/components/theme
git commit -m "feat(theme): add settings sections, colour swatches and palette preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pagina Admin → Tema & Stili

**Files:**
- Modify (riscrittura completa): `components/AdminTheme.tsx`
- Modify: `app/(protected)/(admin)/admin/theme/page.tsx`
- Modify (riscrittura completa): `components/AdminTheme.test.tsx`

**Interfaces:**
- Consumes: `saveAppPrimaryColor` (T4), `getAppPrimaryColor` (T4), `DEFAULT_PRIMARY`, `PRIMARY_PRESETS`, `derivePrimary` (T2), `DARK_CLASS` (T3), `SettingsSection`, `SettingsRow`, `ColorSwatches`, `PalettePreview` (T6).
- Produces: `AdminTheme({ savedColor: string })` e `applyPrimaryPreview(root: HTMLElement, derived: DerivedPrimary | null): void` da `@/components/AdminTheme`. La pagina non usa più `useUI`.

- [ ] **Step 1: Scrivi i test che falliscono**

`components/AdminTheme.test.tsx` (sostituisce il file intero):

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { derivePrimary } from '@/lib/theme-vars'
import { applyPrimaryPreview } from './AdminTheme'

// Il pannello incatena moduli 'use server' -> '@/lib/auth' -> next-auth, che
// l'ambiente di vitest non risolve: si stubbano i confini, come prima.
vi.mock('@/lib/theme-actions', () => ({ saveAppPrimaryColor: vi.fn() }))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

/**
 * L'anteprima dal vivo (specifica §4): scrive il colore non ancora salvato come
 * stile inline su <html>, scegliendo la variante del modo in cui la pagina e'
 * adesso, e lo toglie quando gli si passa null.
 */
describe('applyPrimaryPreview', () => {
  const root = document.documentElement
  const derived = derivePrimary('#4f46e5')!

  afterEach(() => {
    root.classList.remove('dark')
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-foreground')
  })

  it('writes the light variant while the page is light', () => {
    applyPrimaryPreview(root, derived)
    expect(root.style.getPropertyValue('--primary')).toBe(derived.light.primary)
    expect(root.style.getPropertyValue('--primary-foreground')).toBe(derived.light.foreground)
  })

  it('writes the dark variant while the page is dark', () => {
    root.classList.add('dark')
    applyPrimaryPreview(root, derived)
    expect(root.style.getPropertyValue('--primary')).toBe(derived.dark.primary)
  })

  it('removes the preview so the server-rendered colour shows again', () => {
    applyPrimaryPreview(root, derived)
    applyPrimaryPreview(root, null)
    expect(root.style.getPropertyValue('--primary')).toBe('')
    expect(root.style.getPropertyValue('--primary-foreground')).toBe('')
  })
})
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run components/AdminTheme.test.tsx
```

Atteso: FAIL, `applyPrimaryPreview` non esportata.

- [ ] **Step 3: Riscrivi il componente**

`components/AdminTheme.tsx` (sostituisce il file intero):

```tsx
'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Palette } from 'lucide-react'
import { saveAppPrimaryColor } from '@/lib/theme-actions'
import { DEFAULT_PRIMARY, PRIMARY_PRESETS, derivePrimary, type DerivedPrimary } from '@/lib/theme-vars'
import { DARK_CLASS } from '@/lib/appearance'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { ColorSwatches } from '@/components/theme/ColorSwatches'
import { PalettePreview } from '@/components/theme/PalettePreview'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/button'

/** Chiavi intere, non costruite: `npm run test:i18n-keys` le cerca come letterali. */
const PRESET_LABEL_KEYS: Record<(typeof PRIMARY_PRESETS)[number]['id'], string> = {
  indigo: 'theme.preset.indigo',
  green: 'theme.preset.green',
  pink: 'theme.preset.pink',
  orange: 'theme.preset.orange',
  sky: 'theme.preset.sky',
}

/**
 * L'anteprima dal vivo (specifica §4): il colore non ancora salvato, come stile
 * inline su <html>, nella variante del modo corrente. Lo stile inline vince sul
 * `<style>` del layout; `null` lo toglie e lascia ricomparire il colore salvato.
 */
export function applyPrimaryPreview(root: HTMLElement, derived: DerivedPrimary | null): void {
  if (!derived) {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-foreground')
    return
  }
  const pair = root.classList.contains(DARK_CLASS) ? derived.dark : derived.light
  root.style.setProperty('--primary', pair.primary)
  root.style.setProperty('--primary-foreground', pair.foreground)
}

type SaveStatus = 'idle' | 'success' | 'error' | 'unreadable'

export const AdminTheme: React.FC<{ savedColor: string }> = ({ savedColor }) => {
  const { t } = useI18n()
  const router = useRouter()
  const [color, setColor] = useState(savedColor)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const derived = derivePrimary(color) ?? derivePrimary(DEFAULT_PRIMARY)!

  useEffect(() => {
    applyPrimaryPreview(document.documentElement, derivePrimary(color))
  }, [color])

  // Uscendo dalla pagina l'anteprima se ne va, salvata o no: il colore giusto da
  // li' in poi e' quello del <style> del layout.
  useEffect(() => () => applyPrimaryPreview(document.documentElement, null), [])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    const { error } = await saveAppPrimaryColor(color)
    setSaving(false)
    if (error === null) {
      setSaveStatus('success')
      // Riscrive il <style> del layout con il colore appena salvato.
      router.refresh()
    } else {
      setSaveStatus(error === 'unreadable' ? 'unreadable' : 'error')
    }
    // Un rifiuto per leggibilita' resta finche' non si sceglie altro; gli altri esiti sfumano.
    if (error !== 'unreadable') setTimeout(() => setSaveStatus('idle'), 3000)
  }

  const options = PRIMARY_PRESETS.map(preset => ({
    id: preset.id,
    color: preset.color,
    label: t(PRESET_LABEL_KEYS[preset.id]),
  }))

  return (
    <PageContainer title={t('theme.page.title')} subtitle={t('theme.page.subtitle')}>
      <SettingsSection icon={Palette} title={t('theme.section.primary_color')}>
        <SettingsRow hint={t('theme.field.primary_color_hint')}>
          <ColorSwatches
            options={options}
            value={color}
            groupLabel={t('theme.field.swatches')}
            customLabel={t('theme.preset.custom')}
            disabled={saving}
            onChange={next => {
              setColor(next)
              if (saveStatus === 'unreadable') setSaveStatus('idle')
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Eye} title={t('theme.preview.title')}>
        <PalettePreview
          derived={derived}
          labels={{
            light: t('theme.preview.light'),
            dark: t('theme.preview.dark'),
            primary: t('theme.preview.swatch.primary'),
            hover: t('theme.preview.swatch.hover'),
            surface: t('theme.preview.swatch.surface'),
            background: t('theme.preview.swatch.background'),
            sidebar: t('theme.preview.swatch.sidebar'),
          }}
        />
      </SettingsSection>

      <div className="pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {saveStatus === 'idle' && (
            <span className="text-sm text-foreground-faint">{t('theme.banner.unsaved_hint')}</span>
          )}
          {saveStatus === 'success' && (
            <span className="text-sm text-success-muted-foreground">{t('theme.status.saved')}</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-destructive-muted-foreground">{t('theme.status.save_failed')}</span>
          )}
          {saveStatus === 'unreadable' && (
            <p className="text-sm text-destructive-muted-foreground" role="alert">{t('theme.status.unreadable')}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setColor(DEFAULT_PRIMARY)} disabled={saving}>
            {t('theme.actions.reset_defaults')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('theme.status.saving') : t('common.actions.save')}
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}
```

`app/(protected)/(admin)/admin/theme/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getAppPrimaryColor } from '@/lib/theme-server'
import { AdminTheme } from '@/components/AdminTheme'

export default async function ThemePage() {
  const session = await auth()
  if (!session?.user?.isAdmin) redirect('/')

  return <AdminTheme savedColor={await getAppPrimaryColor()} />
}
```

- [ ] **Step 4: Lancia i test e le guardie**

```bash
npx vitest run components/AdminTheme.test.tsx guards
npm run test:i18n-keys
npm run typecheck
npm run lint
```

Atteso: tutto verde. `test:i18n-keys` ora trova usate le chiavi `theme.*` nuove.

- [ ] **Step 5: Verifica in browser (stato di transizione)**

Avvia l'anteprima `web-construct` (database di sviluppo, dove l'utente è admin) con lo strumento del riquadro Browser, poi apri `/admin/theme` e verifica:
- ci sono cinque pallini più "Personalizzato", e l'indaco è selezionato;
- cliccando "Verde", i pulsanti della pagina cambiano colore subito e il codice accanto ai pallini diventa `#059669`;
- l'anteprima ha due strisce, e la striscia "Scuro" mostra un principale più chiaro;
- "Valori di Default" torna all'indaco;
- in console nessun errore.

Prima del Task 9 il colore salvato non si vede ancora dopo un ricaricamento (lo copre ancora `UIContext`). È atteso; non salvare.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/AdminTheme.tsx sources/microservices/web-construct/components/AdminTheme.test.tsx "sources/microservices/web-construct/app/(protected)/(admin)/admin/theme/page.tsx"
git commit -m "feat(theme): rebuild the theme page around one app-wide primary colour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pagina Impostazioni e pannello utente

**Files:**
- Create: `app/(protected)/settings/page.tsx`
- Create: `components/settings/SettingsPage.tsx`
- Modify: `components/LanguageSwitcher.tsx`
- Modify: `components/Sidebar.tsx` (import l.8–17; `useUI` l.253; `toggleTheme` l.476–477; pannello utente l.588–647)
- Modify: `components/Sidebar.accessibility.test.tsx`, `components/Sidebar.truncation.test.tsx` (togliere il mock di `useUI`)
- Test: `components/settings/SettingsPage.test.tsx`, `components/Sidebar.user-panel.test.tsx`

**Interfaces:**
- Consumes: `getAppearance` (T4), `saveAppearance` (T4), `applyAppearance`, `prefersDarkScheme`, tipi da `@/lib/appearance` (T3), `ToggleGroup`/`ToggleGroupItem`/`Slider` (T5), `SettingsSection`/`SettingsRow` (T6), `useI18n()` (`t`, `fmt`, `languages`).
- Produces:
  - route `/settings`;
  - `SettingsPage({ initialAppearance: Appearance })`;
  - `LanguageSwitcher()` senza props (prima: `collapsed`, `itemClassName`), con gli stessi `data-testid` (`language-switcher`, `language-option-<code>`, `language-switcher-options`);
  - link `/settings` nel pannello utente, nome accessibile `t('nav.settings')`.

- [ ] **Step 1: Scrivi i test che falliscono**

`components/settings/SettingsPage.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

const mocks = vi.hoisted(() => ({ saveAppearance: vi.fn() }))

vi.mock('@/lib/appearance-actions', () => ({ saveAppearance: mocks.saveAppearance }))
vi.mock('@/components/LanguageSwitcher', () => ({ default: () => <div data-testid="language-switcher" /> }))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    fmt: { date: () => '02/10/2026', number: () => '1.234.567' },
    languages: [{ code: 'it' }, { code: 'en' }],
  }),
}))

const { SettingsPage } = await import('./SettingsPage')

let root: Root | undefined
let container: HTMLDivElement | undefined
const html = document.documentElement

beforeEach(() => {
  mocks.saveAppearance.mockReset()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsPage initialAppearance={{ mode: 'light', scale: 100 }} />))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  html.classList.remove('dark')
  html.removeAttribute('data-theme-mode')
  html.style.removeProperty('font-size')
})

const radio = (name: string) =>
  Array.from(container!.querySelectorAll('[role="radio"]')).find(el => el.textContent?.includes(name)) as HTMLButtonElement

describe('SettingsPage', () => {
  it('applies a mode at once and saves it', async () => {
    mocks.saveAppearance.mockResolvedValue({ error: null, appearance: { mode: 'dark', scale: 100 } })
    await act(async () => radio('settings.theme.dark').click())
    expect(html.classList.contains('dark')).toBe(true)
    expect(html.getAttribute('data-theme-mode')).toBe('dark')
    expect(mocks.saveAppearance).toHaveBeenCalledWith({ mode: 'dark' })
    expect(radio('settings.theme.dark').getAttribute('aria-checked')).toBe('true')
  })

  it('reverts the choice and says so when the save fails', async () => {
    mocks.saveAppearance.mockResolvedValue({ error: 'Save failed' })
    await act(async () => radio('settings.theme.dark').click())
    expect(html.classList.contains('dark')).toBe(false)
    expect(radio('settings.theme.light').getAttribute('aria-checked')).toBe('true')
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('settings.status.save_failed')
  })

  it('shows the language switcher and a read-only date format example', () => {
    expect(container!.querySelector('[data-testid="language-switcher"]')).not.toBeNull()
    expect(container!.textContent).toContain('02/10/2026 · 1.234.567')
  })

  it('offers the text size as a slider between 90 and 130', () => {
    const thumb = container!.querySelector('[role="slider"]')
    expect(thumb?.getAttribute('aria-valuenow')).toBe('100')
    expect(thumb?.getAttribute('aria-valuemin')).toBe('90')
    expect(thumb?.getAttribute('aria-valuemax')).toBe('130')
  })
})
```

`components/Sidebar.user-panel.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const navigation = vi.hoisted(() => ({ pathname: '/unmatched-route' }))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/context/use-auth', () => ({
  useAuth: () => ({ user: { email: 'reviewer@example.com' }, signOut: vi.fn() }),
}))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Sidebar menuItems={[]} />))
  act(() => (container!.querySelector('[data-testid="sidebar-account-button"]') as HTMLButtonElement).click())
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('Sidebar user panel', () => {
  it('links to the personal settings page', () => {
    const panel = document.getElementById('sidebar-user-panel')!
    const link = panel.querySelector('a[href="/settings"]')
    expect(link?.textContent).toContain('nav.settings')
  })

  it('no longer carries the theme switch or the language switcher', () => {
    const panel = document.getElementById('sidebar-user-panel')!
    expect(panel.querySelector('[role="switch"]')).toBeNull()
    expect(panel.querySelector('[data-testid="language-switcher"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run components/settings/SettingsPage.test.tsx components/Sidebar.user-panel.test.tsx
```

Atteso: FAIL. `./SettingsPage` non esiste, e il pannello ha ancora l'interruttore e non ha il link.

- [ ] **Step 3: Ristilizza `LanguageSwitcher`**

In `components/LanguageSwitcher.tsx`:

1. Togli l'interfaccia `LanguageSwitcherProps` e cambia la firma in `export default function LanguageSwitcher() {`.
2. Import: `import { Check, ChevronDown, Globe } from 'lucide-react'`.
3. Il pulsante d'apertura diventa:

```tsx
      <button
        ref={triggerRef}
        type="button"
        data-testid="language-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('profile.language')}
        disabled={isSwitching}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
        className="inline-flex w-56 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-50"
      >
        <Globe size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate text-left">{current?.nativeName ?? code}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
```

4. L'elenco si apre verso il basso, con i colori del popover:

```tsx
          className="absolute top-full left-0 z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg outline-none"
```

5. Le opzioni:

```tsx
                className={clsx(
                  'flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-sm',
                  active && 'bg-accent',
                  selected ? 'font-medium text-foreground' : 'text-foreground-secondary',
                )}
```

6. Aggiorna il commento in testa al componente: ora è un campo della pagina Impostazioni, non una riga della sidebar. La navigazione da tastiera resta invariata.

La logica (tastiera, focus, `pendingFocusRef`, `languages.length < 2`) non cambia.

- [ ] **Step 4: Crea la pagina**

`components/settings/SettingsPage.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { Calendar, Check, Languages, Monitor, Moon, Sun } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { saveAppearance } from '@/lib/appearance-actions'
import {
  applyAppearance, prefersDarkScheme, TEXT_SCALES,
  type Appearance, type AppearancePatch, type TextScale, type ThemeMode,
} from '@/lib/appearance'
import { PageContainer } from '@/components/shared/PageContainer'
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsSection'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Slider } from '@/components/ui/slider'
import LanguageSwitcher from '@/components/LanguageSwitcher'

type Field = 'mode' | 'scale'

const MODE_OPTIONS: { mode: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { mode: 'light', labelKey: 'settings.theme.light', icon: Sun },
  { mode: 'system', labelKey: 'settings.theme.system', icon: Monitor },
  { mode: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
]

/**
 * Le preferenze personali (specifica §6.2). Ogni scelta si applica subito e si
 * salva da sola; se il salvataggio fallisce torna all'ultimo valore salvato e
 * lo dice accanto al controllo.
 */
export function SettingsPage({ initialAppearance }: { initialAppearance: Appearance }) {
  const { t, fmt, languages } = useI18n()
  const [appearance, setAppearance] = useState(initialAppearance)
  const [failed, setFailed] = useState<Field | null>(null)
  const committed = useRef(initialAppearance)
  const [today] = useState(() => new Date())

  const show = (next: Appearance) => {
    setAppearance(next)
    applyAppearance(document.documentElement, next, prefersDarkScheme())
  }

  const commit = async (patch: AppearancePatch, field: Field) => {
    show({ ...committed.current, ...patch })
    setFailed(null)
    const result = await saveAppearance(patch)
    if (result.error || !result.appearance) {
      show(committed.current)
      setFailed(field)
      return
    }
    committed.current = result.appearance
  }

  const failure = (field: Field) =>
    failed === field && <p role="alert" className="mt-1 text-xs text-destructive-muted-foreground">{t('settings.status.save_failed')}</p>

  return (
    <PageContainer title={t('settings.page.title')} subtitle={t('settings.page.subtitle')}>
      <SettingsSection icon={Languages} title={t('settings.section.language_region')}>
        {languages.length >= 2 && (
          <SettingsRow label={t('settings.field.language')} hint={t('settings.field.language_hint')}>
            <LanguageSwitcher />
          </SettingsRow>
        )}
        <SettingsRow label={t('settings.field.date_format')}>
          <span className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
            <Calendar size={16} className="text-muted-foreground" aria-hidden="true" />
            <span suppressHydrationWarning>{fmt.date(today)} · {fmt.number(1234567)}</span>
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Sun} title={t('settings.section.appearance')}>
        <SettingsRow label={t('settings.field.theme')} hint={t('settings.field.theme_hint')}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={appearance.mode}
            onValueChange={value => { if (value) commit({ mode: value as ThemeMode }, 'mode') }}
            aria-label={t('settings.field.theme')}
          >
            {MODE_OPTIONS.map(({ mode, labelKey, icon: Icon }) => (
              <ToggleGroupItem key={mode} value={mode} className="gap-1.5 px-3">
                {appearance.mode === mode ? <Check size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
                {t(labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {failure('mode')}
        </SettingsRow>

        <SettingsRow label={t('settings.field.text_size')} hint={t('settings.field.text_size_hint')}>
          <div className="flex w-64 items-center gap-3">
            <Slider
              min={TEXT_SCALES[0]}
              max={TEXT_SCALES[TEXT_SCALES.length - 1]}
              step={10}
              value={[appearance.scale]}
              onValueChange={([value]) => show({ ...appearance, scale: value as TextScale })}
              onValueCommit={([value]) => commit({ scale: value as TextScale }, 'scale')}
              aria-label={t('settings.field.text_size')}
            />
            <span className="w-10 text-right text-sm tabular-nums text-foreground-secondary">{appearance.scale}%</span>
          </div>
          {failure('scale')}
        </SettingsRow>
      </SettingsSection>
    </PageContainer>
  )
}
```

`t(labelKey)` riceve chiavi che compaiono come letterali interi in `MODE_OPTIONS`, quindi `test:i18n-keys` le vede. Se il nome accessibile del cursore non arriva al thumb (vedi Task 5, Step 3), passa la prop `thumbLabel` aggiunta là.

`app/(protected)/settings/page.tsx`:

```tsx
import { getAppearance } from '@/lib/appearance-server'
import { SettingsPage } from '@/components/settings/SettingsPage'

/** Accesso: qualunque utente autenticato; il middleware rimanda gli altri a /login. */
export default async function Settings() {
  return <SettingsPage initialAppearance={await getAppearance()} />
}
```

- [ ] **Step 5: Aggiorna il pannello utente della sidebar**

In `components/Sidebar.tsx`:
1. Import lucide: togli `Sun`, `Moon` e aggiungi `Settings` (`import { LogOut, CircleUser, User, Settings, ChevronLeft, ChevronRight, PanelLeftOpen, X } from 'lucide-react'`).
2. Togli `import { useUI } from '@/context/UIContext'` e `import LanguageSwitcher from './LanguageSwitcher'`.
3. Togli `const { settings, setSettings } = useUI()` (l.253) e `toggleTheme` (l.476–477).
4. Nel pannello utente, sostituisci il blocco `{/* Theme Mode */} … ` fino a `<LanguageSwitcher … />` compreso (l.607–646) con:

```tsx
            {/* Settings */}
            <Link
              href="/settings"
              onMouseEnter={userPanelPresentation.columnCollapsed ? e => showTooltip(e, t('nav.settings')) : undefined}
              onMouseLeave={userPanelPresentation.columnCollapsed ? hideTooltip : undefined}
              aria-label={userPanelPresentation.columnCollapsed ? t('nav.settings') : undefined}
              className={clsx(
                userPanelItemCls,
                pathname === '/settings' ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium ring-1 ring-inset ring-primary/70' : ''
              )}
            >
              <Settings size={16} className={pathname === '/settings' ? 'text-primary' : ''} />
              {!userPanelPresentation.columnCollapsed && <span className="min-w-0 truncate">{t('nav.settings')}</span>}
            </Link>
```

5. In `components/Sidebar.accessibility.test.tsx` e `components/Sidebar.truncation.test.tsx` togli il blocco `vi.mock('@/context/UIContext', …)`: la sidebar non importa più quel modulo.

- [ ] **Step 6: Lancia i test e le guardie**

```bash
npx vitest run components guards
npm run test:i18n-keys
npm run test:tokens
npm run typecheck
npm run lint
```

Atteso: tutto verde.

- [ ] **Step 7: Verifica in browser**

Avvia l'anteprima `web-construct`, apri il pannello utente e clicca "Impostazioni". Verifica:
- la pagina ha le due sezioni;
- il cambio lingua funziona come prima;
- "Scuro" rende la pagina scura subito;
- il cursore ingrandisce l'interfaccia;
- dopo un ricaricamento il modo resta.

Il ricaricamento può mostrare un lampo del modo sbagliato finché il Task 9 non sposta la classe sul server; `UIContext` è ancora attivo. Non è ancora il caso da verificare.

- [ ] **Step 8: Commit**

```bash
git add "sources/microservices/web-construct/app/(protected)/settings" sources/microservices/web-construct/components/settings sources/microservices/web-construct/components/LanguageSwitcher.tsx sources/microservices/web-construct/components/Sidebar.tsx sources/microservices/web-construct/components/Sidebar.accessibility.test.tsx sources/microservices/web-construct/components/Sidebar.truncation.test.tsx sources/microservices/web-construct/components/Sidebar.user-panel.test.tsx
git commit -m "feat(settings): add the personal settings page and link it from the user panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Passaggio al rendering server

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css` (commento `@custom-variant` l.4–9; blocco `:root` dei token l.51–84; nuovo blocco `.dark`)
- Modify: `app/Providers.tsx`
- Delete: `context/UIContext.tsx`
- Modify: `types/menu.ts` (via `ThemeConfig`, `AppSettings`, `defaultThemeConfig`, `defaultSettings`, `mergeThemeConfig`)
- Delete: `types/menu.test.ts`
- Modify: `lib/theme-vars.ts` (via `PairedToken`, `PAIRED_TOKENS`, `SURFACE_KEYS`, `FOREGROUND_KEYS`, `EXACT_PAIRS`, `ContrastViolation`, `themeContrastViolations`, `resolveThemeVars`, `safeColor`, import da `@/types/menu`)
- Modify: `lib/theme-vars.test.ts`
- Modify: `lib/theme-actions.ts` (via `saveThemeConfig`, `loadThemeConfig`)
- Modify: `lib/theme-dark-variant.test.ts`
- Modify: `lib/db/schema.ts` (via `themeConfig`)
- Modify: `components/AppHydrationMarker.test.tsx` (via il mock di `UIContext`)
- Modify: `components/Login.tsx` (commento l.88–92)
- Modify: `components/grid/data-grid-config.ts`, `components/grid/data-grid-config.test.ts`

**Interfaces:**
- Consumes: `getAppearance` (T4), `getAppPrimaryColor` (T4), `primaryCss`, `LIGHT_PALETTE`, `DARK_PALETTE` (T2), `THEME_MODE_SCRIPT`, `DARK_CLASS` (T3).
- Produces: `<html data-theme-mode=… style="font-size:…%">`, `<style id="app-primary">`, lo script in `<head>`. Spariscono `@/context/UIContext`, `useUI`, `ThemeConfig` e il resto dell'elenco sopra.

- [ ] **Step 1: Riscrivi i test che descrivono il nuovo assetto**

In `lib/theme-dark-variant.test.ts`, sostituisci la lettura di `UIContext` con la costante condivisa:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { DARK_CLASS, THEME_MODE_SCRIPT } from './appearance'

const globals = postcss.parse(readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'))

function darkCustomVariant() {
  return globals.nodes.find(node =>
    node.type === 'atrule' && node.name === 'custom-variant' && /^dark\b/.test(node.params))
}

describe('Tailwind dark variant strategy', () => {
  it('declares the dark variant, so `dark:` utilities are not left on the OS preference', () => {
    expect(darkCustomVariant()).toBeDefined()
  })

  it('binds the dark variant to the class the pre-paint script toggles', () => {
    const variant = darkCustomVariant()
    expect(variant && 'params' in variant ? variant.params : '').toContain(`.${DARK_CLASS}`)
    expect(THEME_MODE_SCRIPT).toContain(`'${DARK_CLASS}'`)
  })
})
```

In `lib/theme-vars.test.ts`:
1. Togli `import { defaultThemeConfig } from '@/types/menu'` e, dall'import di `./theme-vars`, `resolveThemeVars` e `themeContrastViolations`. `primaryForeground` resta.
2. Cancella i blocchi `describe('resolveThemeVars', …)` e `describe('themeContrastViolations', …)`, con il commento che li precede. Prima, però, salva le due asserzioni su `primaryForeground` che stanno dentro `resolveThemeVars` (l.38–39) in un blocco a sé, senza la riga su `resolveThemeVars`:

```ts
describe('primaryForeground', () => {
  it('picks white on a dark primary and the darkest foreground on a pale one', () => {
    expect(primaryForeground('#4f46e5')).toBe('#ffffff')
    expect(primaryForeground('#fbbf24')).toBe('#111827')
  })
})
```
3. Nel blocco `describe('default palette contrast', …)`, sostituisci `const c = defaultThemeConfig` e le due righe `lightSurfaces` / `darkSurfaces` con:

```ts
  const L = LIGHT_PALETTE
  const D = DARK_PALETTE
  const lightSurfaces = [L.background, L.card, L.popover, L.accent, L.sidebar, L['sidebar-accent']]
  const darkSurfaces = [D.background, D.card, D.popover, D.accent, D.sidebar, D['sidebar-accent']]
```

   Poi riscrivi i riferimenti `c.*` così:
   - `c.foregroundLight` → `L.foreground`, `c.foregroundDark` → `D.foreground`;
   - `c.foregroundSecondaryLight/Dark` → `L/D['foreground-secondary']`;
   - `c.foregroundMutedLight/Dark` → `L/D['muted-foreground']`;
   - `c.foregroundFaintLight/Dark` → `L/D['foreground-faint']`;
   - `c.sidebarTextLight/Dark` → `L/D['sidebar-foreground']`;
   - `c.sidebarBgLight/Dark` → `L/D.sidebar`;
   - `c.activeItemBgLight/Dark` → `L/D['sidebar-accent']`;
   - `c.activeItemTextLight/Dark` → `L/D['sidebar-accent-foreground']`;
   - `c.primaryColor` → `DEFAULT_PRIMARY`.
4. Cancella il test `'keeps the globals.css fallbacks in step with defaultThemeConfig'`: lo sostituisce il blocco `fixed palette` qui sotto.
5. Sostituisci il blocco `describe('fixed palette', …)` del Task 2 con la versione che confronta anche `.dark`:

```ts
describe('fixed palette', () => {
  /**
   * La tavolozza esiste in due copie: le costanti TypeScript, che il calcolo del
   * colore principale e questi test leggono, e `globals.css`, che il browser
   * legge. Se divergono, il contrasto verificato qui non e' quello mostrato.
   */
  const sheet = postcss.parse(readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8'))
  const declared = (selector: string, token: string) => {
    let value: string | undefined
    sheet.walkRules(rule => {
      if (rule.selector !== selector) return
      rule.walkDecls(`--${token}`, decl => { value ??= decl.value })
    })
    return value
  }

  it.each(Object.keys(LIGHT_PALETTE))('ships --%s identically in TypeScript and in :root / .dark', token => {
    expect(declared(':root', token)).toBe(LIGHT_PALETTE[token as keyof typeof LIGHT_PALETTE])
    expect(declared('.dark', token)).toBe(DARK_PALETTE[token as keyof typeof DARK_PALETTE])
  })

  it('keeps the :root primary fallback on the default colour', () => {
    expect(declared(':root', 'primary')).toBe(DEFAULT_PRIMARY)
    expect(declared(':root', 'primary-foreground')).toBe('#ffffff')
  })
})
```

   e aggiungi in testa `import postcss from 'postcss'`.

In `components/grid/data-grid-config.test.ts`, dentro `describe('appGridThemeParams', …)`:

```ts
  it('sizes the grid text in rem, so it follows the personal text scale', () => {
    expect(appGridThemeParams.fontSize).toBe('0.875rem')
  })
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
npx vitest run lib/theme-dark-variant.test.ts lib/theme-vars.test.ts components/grid/data-grid-config.test.ts
```

Atteso: FAIL. Mancano il blocco `.dark` della tavolozza in `globals.css` e `fontSize`.

- [ ] **Step 3: `globals.css`**

1. Commento sopra `@custom-variant dark`: sostituisci la frase su `UIContext` con «Bind `dark:` to the class THEME_MODE_SCRIPT (lib/appearance.ts) puts on <html> before first paint, not to the OS preference: in `system` mode the script itself follows the OS, so the two can never disagree.»
2. Sostituisci il commento sopra il blocco `:root` dei token (l.51–56) con:

```css
/* La tavolozza fissa (specifica del 2026-10-02, DEC-3). Deve coincidere con
   LIGHT_PALETTE e DARK_PALETTE in lib/theme-vars.ts: lib/theme-vars.test.ts
   confronta le due copie token per token.

   --primary e --primary-foreground qui sono solo una riserva. Il valore vero
   arriva dal <style id="app-primary"> che app/layout.tsx scrive dal colore in
   app_theme, con selettori (html:root, html.dark) che pesano piu' di questi. */
```

3. Nel commento «Derivati, non configurabili», sostituisci «non hanno un campo in ThemeConfig e non compaiono in Admin -> Tema» con «non compaiono in Admin -> Tema».
4. Subito dopo la chiusura di quel blocco `:root` (dopo `--radius: 0.5rem;` e la `}`), aggiungi:

```css
.dark {
  --sidebar: #111827;
  --sidebar-foreground: #9ca3af;
  --sidebar-accent: #1f2937;
  --sidebar-accent-foreground: #ffffff;
  --background: #030712;
  --card: #1f2937;
  --popover: #111827;
  --accent: #1f2937;
  --border: #374151;
  --border-subtle: #1f2937;
  --foreground: #ffffff;
  --foreground-secondary: #d1d5db;
  --muted-foreground: #9ca3af;
  --foreground-faint: #8b919c;
}
```

5. Nei commenti dei colori di stato e di `--switch-off`, sostituisci «NOT in ThemeConfig» con «NOT configurable».

- [ ] **Step 4: Il layout**

`app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { getI18nBundle } from '@/lib/i18n/server'
import { getAppearance } from '@/lib/appearance-server'
import { getAppPrimaryColor } from '@/lib/theme-server'
import { primaryCss } from '@/lib/theme-vars'
import { THEME_MODE_SCRIPT } from '@/lib/appearance'
import { Providers } from './Providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Construct',
  description: 'Construct application',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved in the root layout so /login, /register and the rest of the public
  // surface are translated and themed too, not just the protected area.
  const [i18n, appearance, primaryColor] = await Promise.all([
    getI18nBundle(), getAppearance(), getAppPrimaryColor(),
  ])

  return (
    // suppressHydrationWarning: la classe `dark` la mette THEME_MODE_SCRIPT prima
    // dell'idratazione, quindi su <html> l'HTML del server e il DOM differiscono
    // per costruzione. React non gestisce quella classe (specifica §4).
    <html
      lang={i18n.language.code}
      data-theme-mode={appearance.mode}
      style={{ fontSize: `${appearance.scale}%` }}
      suppressHydrationWarning
    >
      <head>
        <style id="app-primary" dangerouslySetInnerHTML={{ __html: primaryCss(primaryColor) }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_MODE_SCRIPT }} />
      </head>
      <body>
        <Providers i18n={i18n}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 5: Togli `UIContext` e i 29 colori**

1. `app/Providers.tsx`: togli l'import di `UIProvider` e l'elemento `<UIProvider>`, lasciando `<AppHydrationMarker />` e `{children}` direttamente dentro `<I18nProvider>`.
2. Cancella `context/UIContext.tsx`.
3. `components/AppHydrationMarker.test.tsx`: togli il blocco `vi.mock('@/context/UIContext', …)`.
4. `types/menu.ts`: togli `ThemeConfig`, `AppSettings`, il commento e la costante `defaultThemeConfig`, `defaultSettings`, `mergeThemeConfig`. Restano `MenuPosition`, `MenuItemType`, `MenuItem`.
5. Cancella `types/menu.test.ts`: provava solo `mergeThemeConfig`.
6. `lib/theme-vars.ts`: togli l'import da `@/types/menu`, `safeColor`, `PairedToken`, `PAIRED_TOKENS` e il suo commento, `SURFACE_KEYS`, `FOREGROUND_KEYS`, `EXACT_PAIRS`, `ContrastViolation`, `themeContrastViolations`, `resolveThemeVars`. Restano `isHex`, `relativeLuminance`, `contrastRatio`, `DARK_LABEL`, `primaryForeground`, `CONTRAST_FLOOR` e tutto il codice del Task 2. Il confine fra vocabolari che il vecchio commento descriveva non esiste più: aggiorna la riga su `lib/theme-vars.ts` in AGENTS.md (sezione «Livello UI: shadcn/ui»), così che dica che da lì in giù vivono il colore principale calcolato e la tavolozza fissa, non più i nomi di `ThemeConfig`.
7. `lib/theme-actions.ts`: togli `saveThemeConfig`, `loadThemeConfig`, il loro commento e gli import non più usati (`eq`, `auth`, `users`, `themeContrastViolations`, `ContrastViolation`, `ThemeConfig`).
8. `lib/theme-actions.test.ts`: togli `vi.mock('@/lib/auth', …)` se `theme-actions.ts` non importa più `@/lib/auth`.
9. `lib/db/schema.ts`: togli `themeConfig: jsonb('theme_config'),`. Se `jsonb` non è più usato altrove nel file, toglilo dall'import.
10. `components/Login.tsx`, commento al punto 2 (l.88–92): sostituisci «UIProvider lives in the root layout, so `.dark` reaches /login for anyone whose localStorage still carries `theme: 'dark'` from a previous session» con «the root layout themes /login too, so `.dark` reaches it for any browser whose appearance cookie still says `dark` from the last user who signed in».

- [ ] **Step 6: ag-grid**

In `components/grid/data-grid-config.ts`, dentro `appGridThemeParams`, aggiungi come prima voce:

```ts
  // In rem, non in px: segue la dimensione del testo scelta nelle Impostazioni,
  // che agisce sul font-size di <html>.
  fontSize: '0.875rem',
```

- [ ] **Step 7: Lancia tutto**

```bash
npm test
npm run typecheck
npm run lint
npm run test:i18n-keys
npm run test:tokens
npm run test:raw-colors
grep -rn "UIContext\|useUI\|ThemeConfig\|theme_config\|themeConfig\|appSettings" app components context lib types
```

Atteso: test, tipi e lint verdi. Il `grep` non deve trovare nulla nel codice applicativo; restano solo le migrazioni storiche, che non sono in queste cartelle.

- [ ] **Step 8: Verifica in browser**

Avvia l'anteprima `web-construct` e verifica nell'ordine. Per leggere i valori usa `javascript_tool` con `document.documentElement.outerHTML.slice(0, 400)` e `getComputedStyle(document.documentElement).getPropertyValue('--primary')`.

1. **Admin → Tema & Stili**: scegli "Verde", "Salva". Compare "Theme saved." e, dopo un ricaricamento, i pulsanti restano verdi. Il `<style id="app-primary">` contiene il verde.
2. **Impostazioni → Scuro**, poi ricarica. La pagina nasce scura, senza lampo chiaro, e `--primary` è la variante scura.
3. **Impostazioni → Automatico**, con `resize_window` a `colorScheme: 'dark'` e poi `'light'`: la classe `dark` segue.
4. **Dimensione testo 130%**, poi apri Gestione utenti: il testo della griglia ag-grid è più grande di quello a 100%. Controlla il `font-size` calcolato di `.ag-cell`. Se resta 14px, ag-grid non ha accettato `rem`: imposta `fontSize: { calc: '0.875rem' }`, oppure valuta `'calc(0.875 * 1rem)'`, e riverifica.
5. Riporta tutto a: indaco salvato, Automatico, 100%.
6. `read_console_messages` con `onlyErrors`: nessun errore, in particolare nessun avviso di idratazione su `<html>`.

- [ ] **Step 9: Commit**

```bash
git add -A sources/microservices/web-construct AGENTS.md
git commit -m "feat(theme): render appearance and the app colour on the server, drop UIContext

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Migrazione distruttiva 0032

**Files:**
- Create: `sources/devops/db/migrations/0032_theme_settings_cleanup.sql`
- Modify: `sources/devops/db/schema.sql` (generato)

**Interfaces:**
- Consumes: il codice del Task 9, che non legge più `users.theme_config` né le chiavi cancellate qui.
- Produces: `users.theme_config` non esiste più; 26 chiavi di traduzione in meno.

- [ ] **Step 1: Verifica che nessuno usi più ciò che stai per cancellare**

```bash
grep -rnE "theme_config|themeConfig|theme\.section\.(global|backgrounds|border|text|sidebar)|theme\.field\.(primary_color|page_background|surface|border|foreground|sidebar|active_item)|theme\.token\.|theme\.status\.contrast_rejected|nav\.theme_" sources/microservices/web-construct/app sources/microservices/web-construct/components sources/microservices/web-construct/lib sources/microservices/web-construct/context sources/tests
```

Atteso: l'unica corrispondenza ammessa è `theme.field.primary_color_hint`, che resta. Qualunque altra va tolta dal codice prima di proseguire.

- [ ] **Step 2: Scrivi la migrazione**

`sources/devops/db/migrations/0032_theme_settings_cleanup.sql`:

```sql
-- Seconda meta' della specifica del 2026-10-02: la parte distruttiva, applicata dopo il codice che
-- ha smesso di leggere users.theme_config (Task 9) e di chiamare le chiavi qui sotto.
--
-- I temi salvati non si migrano (DEC-3): erano per singolo admin e li vedeva solo chi li aveva
-- salvati. Il colore dell'app vive in app_theme dalla 0031.
alter table public.users drop column theme_config;

-- Le etichette dei 29 colori fini, del vecchio rifiuto per contrasto e dell'interruttore
-- chiaro/scuro della sidebar. La forma `delete from translation_key where key in (...)` e' quella
-- che sources/devops/i18n-key-inventory.test.mjs riconosce, come nella 0012.
do $$
declare
  v_keys_before integer;
  v_keys_after  integer;
begin
  select count(*) into v_keys_before from translation_key;

  delete from translation_key
   where key in (
     'theme.section.global',
     'theme.section.backgrounds',
     'theme.section.border',
     'theme.section.text',
     'theme.section.sidebar',
     'theme.field.primary_color',
     'theme.field.page_background',
     'theme.field.surface',
     'theme.field.surface_overlay',
     'theme.field.surface_hover',
     'theme.field.border',
     'theme.field.border_subtle',
     'theme.field.foreground',
     'theme.field.foreground_secondary',
     'theme.field.foreground_muted',
     'theme.field.foreground_faint',
     'theme.field.sidebar_bg',
     'theme.field.sidebar_text',
     'theme.field.active_item_bg',
     'theme.field.active_item_text',
     'theme.token.light',
     'theme.token.dark',
     'theme.status.contrast_rejected',
     'nav.theme_mode',
     'nav.theme_to_dark',
     'nav.theme_to_light'
   );

  select count(*) into v_keys_after from translation_key;
  raise notice 'removed % obsolete theme translation keys', v_keys_before - v_keys_after;
end $$;
```

Prima di salvare, apri `sources/devops/db/migrations/0012_home_logo_only.sql` e controlla che le righe di `translation_value` se ne vadano con la chiave (chiave esterna `on delete cascade`). Se la 0012 cancella esplicitamente anche da `translation_value`, fai lo stesso qui, nello stesso ordine.

- [ ] **Step 3: Applica, rigenera, verifica**

Dalla radice del repository:

```bash
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs test-apply
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs boundary-check
```

Atteso: `NOTICE: removed 26 obsolete theme translation keys` su entrambi i database; `boundary-check` tutto `ok`.

Da `sources/microservices/web-construct/`:

```bash
npm run schema:check
npm run test:migrations
npm run test:i18n-keys
npm test
```

Atteso: tutto verde.

- [ ] **Step 4: Commit**

```bash
git add sources/devops/db/migrations/0032_theme_settings_cleanup.sql sources/devops/db/schema.sql
git commit -m "feat(theme): drop users.theme_config and the retired theme labels (0032)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Test E2E

**Files:**
- Modify: `sources/tests/e2e/helpers.py` (`switch_language`, l.166–200)
- Modify: `sources/tests/e2e/test_i18n.py` (test `test_deactivating_a_language_removes_it_from_the_switcher`, l.291–330)
- Modify (riscrittura completa): `sources/tests/e2e/test_admin_theme.py`
- Create: `sources/tests/e2e/test_settings.py`

**Interfaces:**
- Consumes: i `data-testid` del Task 6 (`theme-swatch-*`, `theme-custom-color`, `theme-primary-hex`), i testi italiani seminati nel Task 1, `test-reset-e2e` esteso nel Task 1, le fixture di `conftest.py` (`logged_in_page`, `non_admin_page`, `admin_storage_state`, `base_url`, `browser`).
- Produces: niente per altri task.

Tutti i comandi di questo task si lanciano con l'anteprima **`web-construct-e2e`** attiva, mai con `web-construct`.

- [ ] **Step 1: Aggiorna `switch_language`**

In `helpers.py`, sostituisci la funzione intera:

```python
def switch_language(page, code: str) -> None:
    """Open the settings page and pick a language by its code.

    The switcher moved from the sidebar account panel to /settings on
    2026-10-02 (spec: docs/superpowers/specs/2026-10-02-theme-settings-redesign-design.md).
    Navigating there is deliberate: every caller navigates on afterwards anyway.

    Waits for the switch to actually land, not for the network to go quiet.
    `wait_for_load_state("networkidle")` was the previous signal and it is the
    wrong one here: choosing a language calls `setLanguage()`, which runs
    `setPreferredLanguage()` inside a React `startTransition`, so the request is
    issued *after* the click handler returns. networkidle is evaluated against
    the state at the moment it is called — the page is already loaded and quiet
    — so it resolved instantly, before the server action had been issued. When
    the caller was a cleanup step at the end of a test, the fixture then closed
    the browser context and killed the request: the language stayed on the
    previous choice, the server never logged a `setPreferredLanguage` call, and
    every later test in the run rendered in the wrong language.

    The trigger renders the current language's native name, so that text is the
    signal that the round trip finished and the RSC tree re-rendered.
    """
    parts = urlsplit(page.url)
    nav(page, f"{parts.scheme}://{parts.netloc}/settings")
    switcher = page.locator('[data-testid="language-switcher"]')
    switcher.click()
    option = page.locator(f'[data-testid="language-option-{code}"]')
    native_name = option.inner_text().strip()
    option.click()
    expect(switcher).to_contain_text(native_name, timeout=15_000)
    # The trigger is `disabled` for as long as `isSwitching` is true; waiting for it
    # to come back confirms the transition committed rather than merely started.
    expect(switcher).to_be_enabled(timeout=15_000)
```

In testa a `helpers.py` aggiungi `from urllib.parse import urlsplit`, se non c'è.

- [ ] **Step 2: Aggiorna `test_i18n.py`**

Nel test `test_deactivating_a_language_removes_it_from_the_switcher`, sostituisci le righe che aprono il pannello utente e il selettore (`page.locator('[data-testid="sidebar-account-button"]').click()` seguito da `page.locator('[data-testid="language-switcher"]').click()`, l.315–316) con:

```python
        nav(page, f"{base_url}/settings")
        page.locator('[data-testid="language-switcher"]').click()
```

Poi sostituisci il blocco di chiusura del pannello (il commento sulle l.319–324 e la riga `page.locator('[data-testid="sidebar-account-button"]').click()` alla l.325) con:

```python
        # Escape closes the listbox; switch_language() navigates to /settings
        # on its own, so there is no panel state to restore any more.
        page.keyboard.press("Escape")
```

Rileggi il resto del test: ogni altro riferimento a `sidebar-account-button` legato alla lingua va trattato allo stesso modo. Quelli legati al logout restano.

- [ ] **Step 3: Riscrivi `test_admin_theme.py`**

```python
import re

from playwright.sync_api import expect
from helpers import nav

# Must match DEFAULT_PRIMARY in sources/microservices/web-construct/lib/theme-vars.ts
# and the row seeded by migration 0031. Duplicated because pytest cannot import
# the TypeScript constant; "Valori di Default" is what ties the two together.
PRIMARY_DEFAULT = "#4f46e5"
GREEN = "#059669"
# Already readable on every light surface, so the light variant is the colour itself.
CUSTOM = "#123456"


def _primary_var(page):
    return page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()"
    )


def _set_custom_color(page, value):
    page.locator('[data-testid="theme-custom-color"]').evaluate(
        """(el, val) => {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        value,
    )


def _save(page):
    page.get_by_role("button", name="Salva", exact=True).click()
    page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)


def _restore_default(page, base_url):
    """The app colour is global: a test that leaves it changed repaints every later test."""
    nav(page, f"{base_url}/admin/theme")
    page.get_by_role("button", name="Valori di Default", exact=True).click()
    _save(page)


def _hex(page):
    return page.get_by_test_id("theme-primary-hex")


def test_theme_buttons_labeled_default_values_salva(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    expect(page.get_by_role("button", name="Valori di Default", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Salva", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Annulla", exact=True)).to_have_count(0)


def test_swatch_applies_live_and_is_dropped_on_leaving(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    saved = _primary_var(page)

    page.get_by_test_id("theme-swatch-green").click()
    expect(page.get_by_test_id("theme-swatch-green")).to_have_attribute("aria-checked", "true")
    expect(_hex(page)).to_have_text(re.compile(GREEN, re.I))
    assert _primary_var(page) != saved, "the chosen colour must apply before Save"

    # Leaving without saving drops the preview: the saved colour shows again.
    nav(page, f"{base_url}/")
    assert _primary_var(page) == saved


def test_custom_colour_applies_live(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    _set_custom_color(page, CUSTOM)
    expect(page.get_by_test_id("theme-swatch-custom")).to_have_attribute("aria-checked", "true")
    assert _primary_var(page) == CUSTOM


def test_reset_returns_to_the_default(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    page.get_by_test_id("theme-swatch-green").click()
    page.get_by_role("button", name="Valori di Default", exact=True).click()
    expect(page.get_by_test_id("theme-swatch-indigo")).to_have_attribute("aria-checked", "true")
    expect(_hex(page)).to_have_text(re.compile(PRIMARY_DEFAULT, re.I))
    assert _primary_var(page) == PRIMARY_DEFAULT


def test_save_persists_after_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/admin/theme")
        _set_custom_color(page, CUSTOM)
        _save(page)

        nav(page, f"{base_url}/admin/theme")
        expect(_hex(page)).to_have_text(re.compile(CUSTOM, re.I))
        assert _primary_var(page) == CUSTOM
    finally:
        _restore_default(page, base_url)


def test_saved_colour_reaches_every_user(logged_in_page, non_admin_page, base_url):
    admin = logged_in_page
    try:
        nav(admin, f"{base_url}/admin/theme")
        _set_custom_color(admin, CUSTOM)
        _save(admin)

        nav(non_admin_page, f"{base_url}/")
        assert _primary_var(non_admin_page) == CUSTOM
    finally:
        _restore_default(admin, base_url)


def test_controls_disabled_while_saving(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/admin/theme")
    # Keep the server-action request pending long enough to observe the busy state.
    page.evaluate(
        """() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (...args) => {
                await new Promise(resolve => setTimeout(resolve, 750));
                return originalFetch(...args);
            };
        }"""
    )
    swatch = page.get_by_test_id("theme-swatch-green")
    page.get_by_role("button", name="Salva", exact=True).click()
    expect(swatch).to_be_disabled()
    expect(page.get_by_role("button", name="Valori di Default", exact=True)).to_be_disabled()
    page.locator("text=Theme saved.").wait_for(state="visible", timeout=10_000)
    expect(swatch).to_be_enabled()
```

`test_controls_disabled_while_saving` salva il colore già salvato, quindi non lascia nulla da ripristinare.

- [ ] **Step 4: Scrivi `test_settings.py`**

```python
from contextlib import contextmanager

from playwright.sync_api import expect
from helpers import nav


@contextmanager
def _server_action(page):
    """Wait for the server action the block triggers, not for networkidle.

    The settings page applies a choice to the DOM at once and saves it after,
    so a DOM assertion passes before the save has landed. The POST carrying the
    `next-action` header is the signal that the round trip finished.
    """
    with page.expect_response(
        lambda r: r.request.method == "POST" and "next-action" in r.request.headers,
        timeout=15_000,
    ):
        yield


def _is_dark(page):
    return page.evaluate("document.documentElement.classList.contains('dark')")


def _font_size(page):
    return page.evaluate("document.documentElement.style.fontSize")


def _choose_mode(page, label):
    item = page.get_by_role("radio", name=label, exact=True)
    if item.get_attribute("aria-checked") == "true":
        return
    with _server_action(page):
        item.click()


def _restore(page, base_url):
    """Mode and text size live on the profile: leaving them changed alters every later test."""
    nav(page, f"{base_url}/settings")
    _choose_mode(page, "Automatico")
    # One step at a time, each awaited: a key that does not move the value fires
    # no server action, so waiting for one after it would hang until the timeout.
    current = int(_font_size(page).rstrip("%") or "100")
    if current != 100:
        page.get_by_role("slider").focus()
    while current != 100:
        key = "ArrowLeft" if current > 100 else "ArrowRight"
        with _server_action(page):
            page.keyboard.press(key)
        current += -10 if key == "ArrowLeft" else 10
    assert _font_size(page) == "100%"


def test_settings_is_linked_from_the_user_panel(logged_in_page, base_url):
    page = logged_in_page
    page.locator('[data-testid="sidebar-account-button"]').click()
    panel = page.locator("#sidebar-user-panel")
    expect(panel.locator('[data-testid="language-switcher"]')).to_have_count(0)
    expect(panel.get_by_role("switch")).to_have_count(0)
    panel.get_by_role("link", name="Impostazioni").click()
    page.wait_for_url("**/settings", timeout=10_000)
    expect(page.get_by_role("heading", name="Impostazioni")).to_be_visible()


def test_light_and_dark_survive_a_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/settings")
        _choose_mode(page, "Scuro")
        assert _is_dark(page)
        nav(page, f"{base_url}/settings")
        assert _is_dark(page), "dark must be rendered from the profile, not restored by the client"

        _choose_mode(page, "Chiaro")
        assert not _is_dark(page)
        nav(page, f"{base_url}/settings")
        assert not _is_dark(page)
    finally:
        _restore(page, base_url)


def test_automatic_follows_the_operating_system(browser, base_url, admin_storage_state):
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        storage_state=admin_storage_state,
        color_scheme="dark",
    )
    page = ctx.new_page()
    try:
        nav(page, f"{base_url}/settings")
        _choose_mode(page, "Chiaro")
        _choose_mode(page, "Automatico")
        assert _is_dark(page)
        page.emulate_media(color_scheme="light")
        page.wait_for_function("!document.documentElement.classList.contains('dark')", timeout=5_000)
    finally:
        _restore(page, base_url)
        ctx.close()


def test_text_size_scales_and_survives_a_reload(logged_in_page, base_url):
    page = logged_in_page
    try:
        nav(page, f"{base_url}/settings")
        thumb = page.get_by_role("slider")
        thumb.focus()
        with _server_action(page):
            page.keyboard.press("ArrowRight")
        assert _font_size(page) == "110%"
        nav(page, f"{base_url}/")
        assert _font_size(page) == "110%"
    finally:
        _restore(page, base_url)
```

- [ ] **Step 5: Lancia i test toccati, poi la suite intera**

Con l'anteprima `web-construct-e2e` attiva, dalla radice del repository:

```bash
uv run pytest sources/tests/e2e/test_admin_theme.py sources/tests/e2e/test_settings.py -v
uv run pytest sources/tests/e2e/test_i18n.py -v
uv run pytest
```

Atteso: tutto verde. Se molti test falliscono insieme con timeout su testi italiani, sospetta prima uno stato lasciato a metà (lingua, modo, scala, colore) e solo dopo i singoli test. Lo dice il Global Constraint sugli E2E.

- [ ] **Step 6: Commit**

```bash
git add sources/tests/e2e/helpers.py sources/tests/e2e/test_i18n.py sources/tests/e2e/test_admin_theme.py sources/tests/e2e/test_settings.py
git commit -m "test(theme): cover the new theme page, the settings page and the moved switcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verifica finale

**Files:** nessun file nuovo. Se emergono correzioni, vanno nel file che le richiede, con un commit a parte.

- [ ] **Step 1: Tutte le verifiche automatiche**

Da `sources/microservices/web-construct/`:

```bash
npm run lint
npm run typecheck
npm test
npm run test:i18n-keys
npm run test:tokens
npm run test:raw-colors
npm run test:migrations
npm run test:collection
npm run schema:check
npm run build
```

Dalla radice: `node sources/devops/db/db.mjs boundary-check`.

Atteso: tutto verde, e la build senza avvisi nuovi.

- [ ] **Step 2: Verifica in browser e prova visiva**

Avvia l'anteprima `web-construct` e cattura screenshot di:
- `/admin/theme` in chiaro;
- `/admin/theme` in scuro;
- `/settings` in chiaro a 100%;
- `/settings` in scuro a 130%;
- `/admin/theme` a larghezza 375 (`resize_window` con preset `mobile`). Non deve esserci scorrimento orizzontale e le righe devono impilarsi.

Riporta poi viewport (`preset: desktop`), modo e scala ai valori di partenza.

- [ ] **Step 3: Spunta le voci**

Nella sezione «Lavori» della specifica metti `- [✅]` su ogni voce i cui task sono tutti chiusi (tabella nei Global Constraints). Nel Riepilogo di questo piano metti `- [✅]` su T12.

```bash
git add docs/superpowers/specs/2026-10-02-theme-settings-redesign-design.md docs/superpowers/plans/2026-10-02-theme-settings-redesign.md
git commit -m "docs(theme): tick the completed theme and settings work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
