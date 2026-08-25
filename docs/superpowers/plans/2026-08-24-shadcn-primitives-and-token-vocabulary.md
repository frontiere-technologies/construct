# Adozione shadcn/ui e unificazione del vocabolario dei token — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adottare shadcn/ui come libreria di primitive con il suo vocabolario di token come unico vocabolario di stile, costruire `Button` e `Input`, e chiudere UI-1 e THEME-2.

**Architecture:** Il confine è `lib/theme-vars.ts`: sotto restano i nomi di dominio di `ThemeConfig` (database invariato), sopra ci sono solo nomi shadcn. `resolveThemeVars()` smette di emettere `--theme-*` e comincia a emettere `--primary`, `--background`, `--card`. `app/globals.css` li lega alle utility Tailwind con `@theme inline`. Sopra queste fondamenta, `Button` e `Input` scritti con `cva`, e i call site migrati a lotti con la migrazione dei colori raw fatta contestualmente.

**Tech Stack:** React 19, Next.js 16 (App Router), Tailwind CSS v4, `class-variance-authority`, `tailwind-merge`, `clsx`, `@radix-ui/react-slot`, Vitest, Playwright/pytest.

**Specifica:** [2026-08-24-shadcn-primitives-and-token-vocabulary-design.md](../specs/2026-08-24-shadcn-primitives-and-token-vocabulary-design.md)

## Global Constraints

- Tutti i comandi `npm` si eseguono da `sources/microservices/web-construct/`.
- Python solo con `uv run`, mai `python`/`python3`/`pip`.
- I test dei componenti usano `renderToStaticMarkup` di `react-dom/server` in ambiente `node`. **Non** esistono jsdom, `@testing-library/react` o `happy-dom` nel progetto e questo piano non ne introduce.
- I file di test dei componenti stanno accanto al componente (`components/ui/button.test.tsx`), e `vitest.config.ts` li raccoglie già con `components/**/*.test.tsx`.
- `ThemeConfig` in `types/menu.ts` e lo schema del database **non cambiano**. Nessuna migration in questo piano.
- Nessun colore nuovo viene esposto in `AdminTheme.tsx`: i token aggiunti sono fissi.
- Ogni hover dentro le varianti si scrive `enabled:hover:`, mai `hover:`. È l'invariante che `components/ui/disabledButtonHoverStyles.test.ts` protegge.
- Il `Button` **non** porta `disabled:pointer-events-none`: `components/ui/buttonInteractionStyles.test.ts` asserisce che i bottoni disabilitati restino sensibili al mouse, altrimenti il cursore `not-allowed` non si vede.
- Le regole globali su `button` in `app/globals.css` restano dove sono, dentro `@layer base` e con `:where()`. Non spostarle.
- Prima di chiudere ogni task: `npm run lint`, `npm run test`, `npm run typecheck` verdi.
- Colore di marca da non toccare: `--color-brand-blue` (`#0f5a8a`, 13 occorrenze), serve al bordo dei bottoni di autenticazione.

---

## Mappatura dei token — riferimento per tutte le fasi

Questa tabella è la fonte di verità per i task 2, 3, 4 e 5. Nessun task deve reinventarla.

### Rinomini (il valore non cambia, solo il nome)

| Utility oggi | Utility nuova | Variabile CSS nuova | Campo `ThemeConfig` |
|---|---|---|---|
| `bg-page` | `bg-background` | `--background` | `pageLight` / `pageDark` |
| `bg-surface` | `bg-card` | `--card` | `surfaceLight` / `surfaceDark` |
| `bg-surface-overlay` | `bg-popover` | `--popover` | `surfaceOverlayLight` / `surfaceOverlayDark` |
| `bg-surface-hover` | `bg-accent` | `--accent` | `surfaceHoverLight` / `surfaceHoverDark` |
| `text-foreground-muted` | `text-muted-foreground` | `--muted-foreground` | `foregroundMutedLight` / `foregroundMutedDark` |
| `bg-sidebar-bg` | `bg-sidebar` | `--sidebar` | `sidebarBgLight` / `sidebarBgDark` |
| `text-sidebar-text` | `text-sidebar-foreground` | `--sidebar-foreground` | `sidebarTextLight` / `sidebarTextDark` |
| `bg-sidebar-active-bg` | `bg-sidebar-accent` | `--sidebar-accent` | `activeItemBgLight` / `activeItemBgDark` |
| `text-sidebar-active-text` | `text-sidebar-accent-foreground` | `--sidebar-accent-foreground` | `activeItemTextLight` / `activeItemTextDark` |

Il prefisso varia: esistono anche `text-surface-overlay`, `border-surface-hover` eccetera. Il rinomino sostituisce la **parte dopo il prefisso**, qualunque sia il prefisso.

### Invariati (già combaciano con shadcn)

`border-border`, `border-border-subtle`, `text-foreground`, `bg-primary`, `text-primary`, `border-primary`. Non toccarli: rinominarli è l'errore più facile di questo piano.

### Estensioni (shadcn non ha questo livello — il nome resta, cambia solo la variabile)

| Utility | Variabile CSS nuova | Campo `ThemeConfig` |
|---|---|---|
| `text-foreground-secondary` | `--foreground-secondary` | `foregroundSecondaryLight` / `foregroundSecondaryDark` |
| `text-foreground-faint` | `--foreground-faint` | `foregroundFaintLight` / `foregroundFaintDark` |
| `border-border-subtle` | `--border-subtle` | `borderSubtleLight` / `borderSubtleDark` |

### Riferimenti diretti `var(--theme-*)` — 15 occorrenze in 6 file

`var(--theme-primary)` → `var(--primary)`, `var(--theme-surface)` → `var(--card)`, `var(--theme-surface-hover)` → `var(--accent)`, `var(--theme-foreground)` → `var(--foreground)`, `var(--theme-border)` → `var(--border)`.

File: `app/(protected)/error.tsx`, `components/EmbeddedFrame.tsx`, `components/EmbeddedBlockedNotice.tsx`, `components/ui/LoadingStatus.tsx`, `components/ui/dataGridConfig.ts`, `components/ui/dataGridConfig.test.ts`.

---

## FASE 0 — Fondamenta e rinomino del vocabolario

### Task 1: Dipendenze, `components.json`, helper `cn()`

**Files:**
- Modify: `sources/microservices/web-construct/package.json`
- Create: `sources/microservices/web-construct/components.json`
- Create: `sources/microservices/web-construct/lib/utils.ts`
- Test: `sources/microservices/web-construct/lib/utils.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `cn(...inputs: ClassValue[]): string` da `@/lib/utils`. Ogni task successivo che compone classi usa questa funzione.

- [ ] **Step 1: Installare le tre dipendenze**

```bash
cd sources/microservices/web-construct
npm install class-variance-authority tailwind-merge @radix-ui/react-slot
```

Verifica che compaiano in `dependencies`, non in `devDependencies`.

- [ ] **Step 2: Scrivere il test di `cn()` che fallisce**

Crea `lib/utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('joins conditional classes the way clsx does', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })

  it('lets a later Tailwind utility win over an earlier one in the same group', () => {
    // Questo e' il motivo per cui serve tailwind-merge e non basta clsx: una
    // variante di cva puo' dichiarare px-4 e il call site sovrascriverlo con
    // px-2 senza che restino entrambe in conflitto nel DOM.
    expect(cn('px-4 py-2', 'px-2')).toBe('py-2 px-2')
  })

  it('keeps utilities from different groups side by side', () => {
    expect(cn('bg-primary', 'text-primary-foreground')).toBe('bg-primary text-primary-foreground')
  })
})
```

- [ ] **Step 3: Eseguire il test e verificare che fallisca**

```bash
npm run test -- lib/utils.test.ts
```

Atteso: FAIL, `Failed to resolve import "./utils"`.

- [ ] **Step 4: Scrivere `lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compone classi Tailwind risolvendo i conflitti a favore dell'ultima.
 *
 * `clsx` da solo concatena e basta: `clsx('px-4', 'px-2')` restituisce
 * entrambe, e quale vince dipende dall'ordine nel foglio di stile generato,
 * non dall'ordine in cui sono scritte. Con `twMerge` sopra, l'ultima vince
 * davvero — che e' il comportamento su cui si regge l'override di una variante
 * cva dal punto d'uso.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: Eseguire il test e verificare che passi**

```bash
npm run test -- lib/utils.test.ts
```

Atteso: PASS, 3 test.

- [ ] **Step 6: Creare `components.json`**

Serve perché `npx shadcn add <componente>` sappia dove scrivere e quali alias usare. `"cssVariables": true` è obbligatorio: senza, il CLI genera classi con colori fissi invece che con i token.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "gray",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

`"config": ""` è corretto per Tailwind v4, che non ha più `tailwind.config.ts`.

- [ ] **Step 7: Verifica completa e commit**

```bash
npm run lint && npm run test && npm run typecheck
```

```bash
git add package.json package-lock.json components.json lib/utils.ts lib/utils.test.ts
git commit -m "feat(ui): add the shadcn toolchain and the cn() class composer

Three dependencies and one four-line helper, which is the whole runtime
cost of the shadcn recipe: cva for the variant tables, tailwind-merge so
a call site can override a variant's utility instead of stacking against
it, and Radix Slot for asChild.

components.json exists so future components arrive already wired to the
project's aliases and, with cssVariables true, painted with the tokens
rather than fixed colours.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Riscrivere `app/globals.css` sul vocabolario shadcn

**Files:**
- Modify: `sources/microservices/web-construct/app/globals.css`
- Modify: `sources/microservices/web-construct/components/ui/buttonInteractionStyles.test.ts` (solo se i test falliscono; le regole `button` non si toccano, quindi non dovrebbe servire)

**Interfaces:**
- Consumes: niente.
- Produces: le variabili CSS `--background`, `--card`, `--popover`, `--accent`, `--border`, `--border-subtle`, `--foreground`, `--foreground-secondary`, `--muted-foreground`, `--foreground-faint`, `--primary`, `--primary-foreground`, `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--ring`, `--input`, `--secondary`, `--secondary-foreground`, `--muted`, `--radius`, `--destructive`, `--destructive-foreground`, `--destructive-muted`, `--destructive-muted-foreground`, `--destructive-border`, e le terne `--success-*` e `--warning-*`. Il task 3 emette i primi sedici a runtime; i task 6 e 9 li consumano come utility.

- [ ] **Step 1: Sostituire il blocco `:root` dei fallback**

Il blocco attuale che comincia con `--theme-primary: #4f46e5;` va sostituito **per intero** con questo. I valori sono identici, cambiano solo i nomi. Il commento sopra il blocco (quello che spiega che sono solo fallback e che devono concordare con `defaultThemeConfig`) va conservato, aggiornando il riferimento da `--theme-*` ai nomi nuovi.

```css
:root {
  --primary: #4f46e5;
  --primary-foreground: #ffffff;
  --sidebar: #ffffff;
  --sidebar-foreground: #4b5563;
  --sidebar-accent: #f3f4f6;
  --sidebar-accent-foreground: #111827;
  --background: #f9fafb;
  --card: #ffffff;
  --popover: #ffffff;
  --accent: #f3f4f6;
  --border: #e5e7eb;
  --border-subtle: #f3f4f6;
  --foreground: #111827;
  --foreground-secondary: #374151;
  --muted-foreground: #4b5563;
  --foreground-faint: #666f7d;

  /* Derivati, non configurabili: non hanno un campo in ThemeConfig e non
     compaiono in Admin -> Tema. Esistono perche' i componenti importati con
     `npx shadcn add` li citano, e senza di loro arriverebbero senza colore. */
  --ring: var(--primary);
  --input: var(--border);
  --secondary: var(--accent);
  --secondary-foreground: var(--foreground);
  --muted: var(--accent);
  --radius: 0.5rem;
}
```

`--radius: 0.5rem` corrisponde a `rounded-lg`, la dimensione dominante nell'inventario dei bottoni.

- [ ] **Step 2: Sostituire i token di stato**

I blocchi `:root` e `.dark` che contengono `--state-danger-fg` eccetera vanno sostituiti con questi. **Nessun call site li usa oggi** (verificato: zero occorrenze), quindi il rinomino non tocca altri file.

```css
/* Colori di stato: distruttivo, successo, avviso.
   Deliberatamente NON in ThemeConfig e NON esposti in Admin -> Tema. Portano
   significato, non marchio — un cliente che ridipinge "pericolo" di verde
   renderebbe bugiardo un bottone di eliminazione.

   Ogni stato ha quattro valori: il pieno (con la sua etichetta) per il bottone
   distruttivo, e la terna tenue (testo, superficie, bordo) per gli avvisi. Il
   testo supera 4.5:1 sulla propria superficie, i bordi superano il 3:1 che
   WCAG 1.4.11 chiede a un confine di componente.

   L'etichetta sul pieno e' opposta fra i due temi, e non e' una svista: bianco
   su #dc2626 legge 4.83:1 e va bene, bianco su #ef4444 legge 3.76:1 e non
   basta, mentre #111827 sullo stesso rosso legge 4.71:1. Il valore che shadcn
   spedisce di serie e' bianco in entrambi. */
:root {
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;
  --destructive-muted: #fee2e2;
  --destructive-muted-foreground: #b91c1c;
  --destructive-border: #dc2626;
  --success: #15803d;
  --success-foreground: #ffffff;
  --success-muted: #dcfce7;
  --success-muted-foreground: #15803d;
  --success-border: #15803d;
  --warning: #b45309;
  --warning-foreground: #ffffff;
  --warning-muted: #fef3c7;
  --warning-muted-foreground: #92400e;
  --warning-border: #b45309;
}

.dark {
  --destructive: #ef4444;
  --destructive-foreground: #111827;
  --destructive-muted: #7f1d1d;
  --destructive-muted-foreground: #fca5a5;
  --destructive-border: #ef4444;
  --success: #22c55e;
  --success-foreground: #111827;
  --success-muted: #14532d;
  --success-muted-foreground: #86efac;
  --success-border: #22c55e;
  --warning: #f59e0b;
  --warning-foreground: #111827;
  --warning-muted: #78350f;
  --warning-muted-foreground: #fcd34d;
  --warning-border: #f59e0b;
}
```

- [ ] **Step 3: Sostituire il blocco `@theme` con `@theme inline`**

```css
/* `inline` e non `@theme` semplice: con `@theme` Tailwind emette
   `--color-primary: var(--primary)` dentro :root e le utility puntano a
   `--color-primary`, aggiungendo un rimbalzo. Con `inline` la utility punta
   direttamente a `var(--primary)`, che e' anche cio' che serve se un giorno un
   sottoalbero ridefinira' un token: con il rimbalzo l'override non lo
   raggiungerebbe. E' anche la forma che shadcn usa, quindi i componenti
   importati non richiedono adattamenti. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-foreground-secondary: var(--foreground-secondary);
  --color-muted-foreground: var(--muted-foreground);
  --color-foreground-faint: var(--foreground-faint);
  --color-card: var(--card);
  --color-card-foreground: var(--foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--foreground);
  --color-border: var(--border);
  --color-border-subtle: var(--border-subtle);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--border);
  --color-sidebar-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-destructive-muted: var(--destructive-muted);
  --color-destructive-muted-foreground: var(--destructive-muted-foreground);
  --color-destructive-border: var(--destructive-border);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-success-muted: var(--success-muted);
  --color-success-muted-foreground: var(--success-muted-foreground);
  --color-success-border: var(--success-border);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-warning-muted: var(--warning-muted);
  --color-warning-muted-foreground: var(--warning-muted-foreground);
  --color-warning-border: var(--warning-border);
  --color-brand-blue: #0f5a8a;
  --radius-lg: var(--radius);
  --container-8xl: 88rem;
}
```

`--color-brand-blue` e `--container-8xl` sono presi tali e quali dal blocco vecchio.

- [ ] **Step 4: Non toccare le regole `button` in `@layer base`**

Restano esattamente dove sono, col loro commento. Il task le lascia intatte di proposito: sono la ragione per cui le varianti del `Button` non avranno bisogno di `!`.

- [ ] **Step 5: Verificare che i guard sul CSS passino ancora**

```bash
npm run test -- components/ui/buttonInteractionStyles.test.ts
```

Atteso: PASS, 4 test. Se fallisce, le regole `button` sono state toccate per sbaglio: rimettile com'erano invece di adattare il test.

- [ ] **Step 6: Non fare commit — il task 3 chiude la modifica**

`lib/theme-vars.test.ts` è ora rosso, e deve esserlo: due dei suoi test leggono `app/globals.css` cercando `--theme-` e `--state-`, nomi che questo task ha appena tolto. Sono le due metà dello stesso rinomino e nessuna delle due sta in piedi da sola, quindi vanno in un commit unico.

```bash
npm run test -- lib/theme-vars.test.ts
```

Atteso: FAIL. Prosegui col task 3 senza committare.

---


### Task 3: `resolveThemeVars()` emette i nomi shadcn

**Files:**
- Modify: `sources/microservices/web-construct/lib/theme-vars.ts:11-27` (l'array `PAIRED_TOKENS` e le due righe del primary)
- Modify: `sources/microservices/web-construct/lib/theme-vars.test.ts`
- Test: lo stesso file di test

**Interfaces:**
- Consumes: `app/globals.css` del task 2, che dichiara i fallback con i nomi nuovi.
- Produces: `resolveThemeVars(config, isDark)` restituisce ancora un `Record<string, string>` di 16 chiavi, ma le chiavi sono `--primary`, `--primary-foreground`, `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--background`, `--card`, `--popover`, `--accent`, `--border`, `--border-subtle`, `--foreground`, `--foreground-secondary`, `--muted-foreground`, `--foreground-faint`. `context/UIContext.tsx:51-53` le scrive su `document.documentElement` senza sapere come si chiamano, quindi **non va toccato**.

- [ ] **Step 1: Aggiornare i test perché descrivano i nomi nuovi**

In `lib/theme-vars.test.ts`, sostituire ogni chiave `--theme-*` con la corrispondente della tabella di mappatura. Le sostituzioni, una per una:

| nel test oggi | diventa |
|---|---|
| `--theme-primary` | `--primary` |
| `--theme-primary-foreground` | `--primary-foreground` |
| `--theme-sidebar-bg` | `--sidebar` |
| `--theme-sidebar-text` | `--sidebar-foreground` |
| `--theme-active-bg` | `--sidebar-accent` |
| `--theme-active-text` | `--sidebar-accent-foreground` |
| `--theme-page` | `--background` |
| `--theme-surface` | `--card` |
| `--theme-surface-overlay` | `--popover` |
| `--theme-surface-hover` | `--accent` |
| `--theme-border` | `--border` |
| `--theme-border-subtle` | `--border-subtle` |
| `--theme-foreground` | `--foreground` |
| `--theme-foreground-secondary` | `--foreground-secondary` |
| `--theme-foreground-muted` | `--muted-foreground` |
| `--theme-foreground-faint` | `--foreground-faint` |

L'elenco ordinato nel test `resolves all 16 CSS variables` va riscritto **e riordinato**, perché `.sort()` alfabetico dà un ordine diverso coi nomi nuovi:

```ts
  it('resolves all 16 CSS variables', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(Object.keys(vars).sort()).toEqual([
      '--accent',
      '--background',
      '--border',
      '--border-subtle',
      '--card',
      '--foreground',
      '--foreground-faint',
      '--foreground-secondary',
      '--muted-foreground',
      '--popover',
      '--primary',
      '--primary-foreground',
      '--sidebar',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-foreground',
    ])
  })
```

- [ ] **Step 2: Aggiornare il test che legge i fallback da `globals.css`**

Il vecchio test costruisce la regex con `--theme-${name}`. Sostituirlo con:

```ts
  it('keeps the globals.css fallbacks in step with defaultThemeConfig', () => {
    // The :root block paints the first frame, before resolveThemeVars runs. When
    // the two disagree the app flashes a colour it never otherwise shows — which
    // is what the primary fallback did, at #2563eb against a #6366f1 default.
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    const fallback = (name: string) => css.match(new RegExp(`\\n  --${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
    expect(fallback('primary')).toBe(c.primaryColor)
    expect(fallback('muted-foreground')).toBe(c.foregroundMutedLight)
    expect(fallback('foreground-faint')).toBe(c.foregroundFaintLight)
  })
```

Il `\\n  ` all'inizio serve: senza, `--primary` verrebbe trovato dentro `--primary-foreground` e la prima corrispondenza sarebbe quella sbagliata.

- [ ] **Step 3: Riscrivere il test degli stati semantici**

Il vecchio test cerca `--state-danger-fg` e naviga il file per indici di stringa. I nomi sono cambiati e gli stati ora hanno anche un pieno con la sua etichetta, che il vecchio test non copriva. Sostituirlo per intero con:

```ts
  it('gives every semantic state a legible triple and a legible solid fill', () => {
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    const light = css.slice(css.indexOf(':root {', css.indexOf('Colori di stato')))
    const dark = css.slice(css.indexOf('.dark {', css.indexOf('Colori di stato')))
    const read = (source: string, name: string) =>
      source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] as string

    for (const state of ['destructive', 'success', 'warning']) {
      const solidL = read(light, state), labelL = read(light, `${state}-foreground`)
      const fgL = read(light, `${state}-muted-foreground`), surfL = read(light, `${state}-muted`)
      const bordL = read(light, `${state}-border`)
      const solidD = read(dark, state), labelD = read(dark, `${state}-foreground`)
      const fgD = read(dark, `${state}-muted-foreground`), surfD = read(dark, `${state}-muted`)
      const bordD = read(dark, `${state}-border`)

      for (const v of [solidL, labelL, fgL, surfL, bordL, solidD, labelD, fgD, surfD, bordD]) {
        expect(v).toMatch(/^#[0-9a-f]{6}$/)
      }

      // Il pieno e la sua etichetta. E' il caso che shadcn sbaglia di serie:
      // bianco su #ef4444 legge 3.76:1, sotto la soglia, e nel tema scuro
      // l'etichetta deve essere scura.
      expect(contrast(labelL, solidL)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(labelD, solidD)).toBeGreaterThanOrEqual(4.5)

      // Il testo tenue: sulla superficie peggiore del tema e sulla propria.
      expect(worst(fgL, lightSurfaces)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(fgL, surfL)).toBeGreaterThanOrEqual(4.5)
      expect(worst(fgD, darkSurfaces)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(fgD, surfD)).toBeGreaterThanOrEqual(4.5)

      // Il bordo: WCAG 1.4.11 chiede 3:1 contro cio' che gli sta dietro.
      expect(worst(bordL, lightSurfaces)).toBeGreaterThanOrEqual(3)
      expect(worst(bordD, darkSurfaces)).toBeGreaterThanOrEqual(3)
    }
  })
```

Due note per chi implementa. La prima: questo test usa `contrast`, `worst`, `lightSurfaces` e `darkSurfaces`, che sono definite nello scope del `describe('default palette contrast')` — va sostituito **dentro quel blocco**, non spostato altrove. La seconda: il vecchio test conteneva una funzione `block` mai usata davvero, neutralizzata con `void block`. Non riportarla.

- [ ] **Step 4: Eseguire i test e verificare che falliscano per il motivo giusto**

```bash
npm run test -- lib/theme-vars.test.ts
```

Atteso: FAIL sui test che leggono `resolveThemeVars`, con messaggi del tipo `expected undefined to be '#4f46e5'` — perché la funzione emette ancora `--theme-primary`. I test che leggono `globals.css` invece devono già **passare**, perché il task 2 ha rinominato il CSS.

- [ ] **Step 5: Rinominare le chiavi in `lib/theme-vars.ts`**

Sostituire l'array `PAIRED_TOKENS`:

```ts
const PAIRED_TOKENS: PairedToken[] = [
  { cssVar: '--sidebar', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
  { cssVar: '--sidebar-foreground', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
  { cssVar: '--sidebar-accent', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
  { cssVar: '--sidebar-accent-foreground', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
  { cssVar: '--background', lightKey: 'pageLight', darkKey: 'pageDark' },
  { cssVar: '--card', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
  { cssVar: '--popover', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
  { cssVar: '--accent', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
  { cssVar: '--border', lightKey: 'borderLight', darkKey: 'borderDark' },
  { cssVar: '--border-subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
  { cssVar: '--foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
  { cssVar: '--foreground-secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
  { cssVar: '--muted-foreground', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
  { cssVar: '--foreground-faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
]
```

E in `resolveThemeVars`:

```ts
  const vars: Record<string, string> = {
    '--primary': primary,
    '--primary-foreground': primaryForeground(primary),
  }
```

Aggiungere sopra `PAIRED_TOKENS` il commento che spiega il confine, perché è la cosa meno ovvia del file:

```ts
/**
 * Il confine fra i due vocabolari del progetto.
 *
 * A sinistra i nomi shadcn, che sono gli unici che un componente scrive mai. A
 * destra i campi di ThemeConfig, che sono uno schema di dati: vivono sul
 * database, li modifica Admin -> Tema e nessuno li scrive in una className.
 * Rinominarli per farli somigliare ai token costerebbe una migration
 * distruttiva sulle configurazioni gia' salvate in cambio di niente.
 */
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

```bash
npm run test -- lib/theme-vars.test.ts
```

Atteso: PASS, tutti i test.

- [ ] **Step 7: Verifica completa e commit dei task 2 e 3 insieme**

```bash
npm run lint && npm run test && npm run typecheck
```

`npm run test` completo può ancora fallire su `raw-color-ratchet` o su test che asseriscono classi: se fallisce, il fallimento appartiene al task 4 e va risolto lì, ma **annotalo** invece di ignorarlo.

```bash
git add app/globals.css lib/theme-vars.ts lib/theme-vars.test.ts
git commit -m "refactor(theme): emit shadcn token names from resolveThemeVars

The rename's other half. lib/theme-vars.ts is now the boundary between
the two vocabularies the project has: shadcn names above it, ThemeConfig
field names below. UIContext writes whatever keys it is handed, so it
needed no change at all.

The semantic-state test grew a case it did not have: each state now
carries a solid fill with its own label, and the label is asserted
against the fill in both themes. That assertion is the one that would
have caught shadcn's stock white-on-#ef4444 at 3.76:1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Rinominare le 249 utility nei 28 file

**Files:**
- Modify (28): `app/(protected)/error.tsx`, `components/AdminTheme.tsx`, `components/ChangePasswordForm.tsx`, `components/EmbeddedBlockedNotice.tsx`, `components/Home.tsx`, `components/LanguageSwitcher.tsx`, `components/Layout.tsx`, `components/PageContainer.tsx`, `components/ProfileForm.tsx`, `components/Sidebar.tsx`, `components/i18n/languages/LanguageFormModal.tsx`, `components/i18n/translations/CreateTranslationKeyModal.tsx`, `components/i18n/translations/TranslationEditorDrawer.tsx`, `components/rbac/CustomSelect.tsx`, `components/rbac/FilterDrawer.tsx`, `components/rbac/GridRowActionsMenu.tsx`, `components/rbac/NavigationTree.tsx`, `components/rbac/filters/EnumSelectFilter.tsx`, `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`, `components/rbac/functionalities/FunctionalityForm.tsx`, `components/rbac/functionalities/IconPicker.tsx`, `components/rbac/roles/CreateRoleModal.tsx`, `components/rbac/roles/RenameRoleModal.tsx`, `components/rbac/users/ManageRolesModal.tsx`, `components/rbac/users/RoleMultiSelect.tsx`, `components/ui/ColumnVisibilityToggle.tsx`, `components/ui/ConfirmModal.tsx`, `components/ui/GridToolbar.tsx`
- Create: `sources/devops/token-vocabulary.test.mjs`
- Modify: `sources/microservices/web-construct/package.json` (nuovo script `test:tokens`)

**Interfaces:**
- Consumes: la tabella di mappatura in testa a questo piano.
- Produces: un codebase in cui nessun nome del vocabolario vecchio sopravvive, garantito da `npm run test:tokens`.

- [✅] **Step 1: Scrivere il guard che fallisce**

Questo test è la vera rete di sicurezza del task: un rinomino sbagliato scolora un punto dell'interfaccia senza rompere niente, e nessun test esistente lo vedrebbe. Crea `sources/devops/token-vocabulary.test.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = new URL('../microservices/web-construct/', import.meta.url).pathname

/**
 * Il progetto ha un vocabolario di token solo, quello di shadcn.
 *
 * Non e' pedanteria di stile: i nomi vecchi non esistono piu' come variabili
 * CSS, quindi una `bg-surface` sopravvissuta a un rinomino non e' un nome fuori
 * moda, e' un elemento senza colore. Tailwind non emette la utility, il
 * compilatore non se ne accorge e nessun test di comportamento se ne accorge:
 * l'unico modo di trovarla e' cercarla.
 */
const FORBIDDEN = [
  // Variabili del vocabolario vecchio, in qualunque forma.
  { pattern: /--theme-[a-z-]+/g, hint: 'usa il nome shadcn, es. --primary invece di --theme-primary' },
  { pattern: /--state-[a-z-]+/g, hint: 'gli stati ora sono --destructive-*, --success-*, --warning-*' },
  // Utility del vocabolario vecchio. Il negative lookahead evita di
  // intercettare i nomi che restano validi: `border-border-subtle` contiene
  // `border-border`, e `text-foreground-secondary` contiene `text-foreground`.
  { pattern: /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|decoration|accent|shadow|caret)-(?:page|surface|surface-overlay|surface-hover|foreground-muted|sidebar-bg|sidebar-text|sidebar-active-bg|sidebar-active-text)(?![-\w])/g, hint: 'vedi la tabella di mappatura nel piano 2026-08-24' },
]

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(tsx?|css)$/.test(path) ? [path] : []
  })
}

test('no name from the retired token vocabulary survives anywhere', () => {
  const offenders = []
  for (const dir of ['app', 'components', 'lib', 'context', 'types']) {
    for (const path of sourceFiles(join(ROOT, dir))) {
      const source = readFileSync(path, 'utf8')
      for (const { pattern, hint } of FORBIDDEN) {
        for (const match of source.match(pattern) ?? []) {
          offenders.push(`${relative(ROOT, path)}: ${match} — ${hint}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`)
})
```

Aggiungi lo script a `package.json`, accanto agli altri `test:*`:

```json
    "test:tokens": "node --test ../../devops/token-vocabulary.test.mjs",
```

- [✅] **Step 2: Eseguire il guard e verificare che fallisca**

```bash
npm run test:tokens
```

Atteso: FAIL, con circa 250 righe di violazioni. Leggile: sono l'elenco di lavoro di questo task.

- [✅] **Step 3: Applicare i rinomini, uno alla volta**

Nove sostituzioni, in **quest'ordine**. L'ordine conta: `surface-overlay` e `surface-hover` vanno prima di `surface`, altrimenti la sostituzione corta le mangia.

```bash
cd sources/microservices/web-construct
for pair in \
  'surface-overlay:popover' \
  'surface-hover:accent' \
  'sidebar-active-bg:sidebar-accent' \
  'sidebar-active-text:sidebar-accent-foreground' \
  'sidebar-bg:sidebar' \
  'sidebar-text:sidebar-foreground' \
  'foreground-muted:muted-foreground' \
  'page:background' \
  'surface:card' ; do
  old="${pair%%:*}"; new="${pair##*:}"
  grep -rlP "\b(bg|text|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|decoration|accent|shadow|caret)-${old}(?![-\w])" app components lib context --include='*.tsx' --include='*.ts' \
    | xargs -r perl -pi -e "s/\b(bg|text|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|decoration|accent|shadow|caret)-\Q${old}\E(?![-\w])/\$1-${new}/g"
  echo "fatto: ${old} -> ${new}"
done
```

Dopo ogni sostituzione, `git diff --stat` per vedere quali file sono cambiati. Se una sostituzione tocca zero file, è un errore: significa che il nome era già sparito e le precedenti hanno mangiato troppo.

- [✅] **Step 4: Eseguire il guard e verificare che passi**

```bash
npm run test:tokens
```

Atteso: PASS. Se restano violazioni sui `--theme-*`, appartengono al task 5 e vanno risolte lì: in tal caso salta al task 5 e torna qui per il commit.

- [✅] **Step 5: Rileggere il diff a mano cercando i falsi positivi**

```bash
git diff -U0 | grep -E '^\+' | grep -oE '(bg|text|border|ring)-[a-z-]+' | sort | uniq -c | sort -rn
```

Controlla che non compaiano nomi inattesi. In particolare, verifica che questi siano **rimasti invariati** e non siano stati toccati:

```bash
grep -rc "border-border-subtle\|text-foreground-secondary\|text-foreground-faint" app components --include='*.tsx' | grep -v ':0'
```

Atteso: le stesse 13, 26 e 8 occorrenze misurate prima del task.

- [✅] **Step 6: Verifica completa e commit**

```bash
npm run lint && npm run test && npm run typecheck && npm run test:tokens && npm run build
```

```bash
git add -A
git commit -m "refactor(ui): rename 249 utilities onto the shadcn vocabulary

Mechanical, but the kind of mechanical that fails quietly: a surviving
bg-surface is not an out-of-date name, it is an element with no colour,
and neither the compiler nor any behavioural test can see it.

So the rename ships with a guard rather than with care. token-vocabulary
walks every source file for the retired names and prints where they are;
it is the only thing standing between this change and a page that paints
white on white in one corner nobody opened.

The three names that look renameable and are not — border-border-subtle,
text-foreground-secondary, text-foreground-faint — are the four-level text
ladder shadcn has no room for. The substitutions are ordered so the short
names cannot eat the long ones.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: I 15 riferimenti diretti `var(--theme-*)`, ag-grid compreso

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/error.tsx:26`
- Modify: `sources/microservices/web-construct/components/EmbeddedFrame.tsx:14`
- Modify: `sources/microservices/web-construct/components/EmbeddedBlockedNotice.tsx:19`
- Modify: `sources/microservices/web-construct/components/ui/LoadingStatus.tsx:6`
- Modify: `sources/microservices/web-construct/components/ui/dataGridConfig.ts:23-37`
- Modify: `sources/microservices/web-construct/components/ui/dataGridConfig.test.ts`

**Interfaces:**
- Consumes: le variabili dichiarate dal task 2.
- Produces: niente di nuovo. Chiude il rinomino.

- [ ] **Step 1: Aggiornare l'atteso in `dataGridConfig.test.ts`**

Il test asserisce i valori del tema di ag-grid. Sostituire ogni `var(--theme-X)` con il nome nuovo secondo la tabella: `primary` → `primary`, `surface` → `card`, `surface-hover` → `accent`, `foreground` → `foreground`, `border` → `border`.

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

```bash
npm run test -- components/ui/dataGridConfig.test.ts
```

Atteso: FAIL, il codice emette ancora `var(--theme-surface)`.

- [ ] **Step 3: Applicare le sostituzioni nei sei file**

```bash
cd sources/microservices/web-construct
perl -pi -e '
  s/var\(--theme-surface-hover\)/var(--accent)/g;
  s/var\(--theme-surface\)/var(--card)/g;
  s/var\(--theme-primary\)/var(--primary)/g;
  s/var\(--theme-foreground\)/var(--foreground)/g;
  s/var\(--theme-border\)/var(--border)/g;
' "app/(protected)/error.tsx" components/EmbeddedFrame.tsx components/EmbeddedBlockedNotice.tsx components/ui/LoadingStatus.tsx components/ui/dataGridConfig.ts components/ui/dataGridConfig.test.ts
```

`surface-hover` prima di `surface`, per la stessa ragione del task 4.

- [ ] **Step 4: Convertire BTN-8 — i due `bg-[var(--primary)]` diventano `bg-primary`**

`app/(protected)/error.tsx:26` e `components/EmbeddedBlockedNotice.tsx:19` scrivono il token a mano dentro una parentesi quadra, aggirando il tema di Tailwind. Sostituire `bg-[var(--primary)] text-white` con `bg-primary text-primary-foreground` in entrambi.

`text-white` diventa `text-primary-foreground` perché è la stessa correzione: il bianco fisso non sa su quale primario finirà, ed è l'errore che `primaryForeground()` esiste per evitare.

- [ ] **Step 5: Eseguire i test e verificare che passino**

```bash
npm run test -- components/ui/dataGridConfig.test.ts && npm run test:tokens
```

Atteso: PASS entrambi. `test:tokens` ora non trova più nessun `--theme-`.

- [ ] **Step 6: Verifica in browser — pagina per pagina, nei due temi**

Questa è la verifica che il task 4 non poteva fare e che nessun test sostituisce.

```bash
npm run dev
```

Con gli strumenti del browser, per **ognuna** di queste pagine, in tema chiaro e poi scuro: barra laterale, tabella ruoli, dettaglio ruolo, tabella utenti, albero funzionalità, tabella lingue, tabella traduzioni, Admin → Tema, profilo, accesso, pagina di errore.

Per ciascuna verifica tre cose:
1. Nessun elemento è sparito o è diventato bianco su bianco.
2. Le griglie ag-grid hanno ancora sfondo, bordi e riga evidenziata al passaggio del mouse.
3. Da Admin → Tema, cambiando il colore primario, l'intera pagina risponde — griglie comprese.

Il punto 3 è quello che dice se il rinomino ha davvero funzionato: prima di questo lavoro non funzionava, ed è la funzione di prodotto che THEME-2 esiste per riparare.

- [ ] **Step 7: Verifica completa, E2E e commit**

```bash
npm run lint && npm run test && npm run typecheck && npm run build
```

```bash
cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct && uv run pytest
```

```bash
git add -A
git commit -m "refactor(ui): move the last direct var(--theme-*) reads across

Fifteen references that never went through a Tailwind utility, ten of
them in dataGridConfig. ag-grid reads the tokens straight, so it is the
one consumer a mistake here would break differently from everything else
— and also the one that now follows Admin -> Theme for free.

Closes BTN-8 on the way past: two buttons spelled bg-[var(--primary)] by
hand, and paired it with a fixed text-white. Both become bg-primary with
the derived label, which is the colour that knows what it is sitting on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## FASE 1 — La primitiva `Button`

### Task 6: `components/ui/button.tsx`

**Files:**
- Create: `sources/microservices/web-construct/components/ui/button.tsx`
- Test: `sources/microservices/web-construct/components/ui/button.test.tsx`
- Create: `sources/microservices/web-construct/components/ui/button.types.tsx` (vincolo di tipo, non un file vitest)

**Interfaces:**
- Consumes: `cn` da `@/lib/utils` (task 1), le utility del task 2.
- Produces:
  - `buttonVariants(opts?: { variant?: ButtonVariant; size?: ButtonSize }): string`
  - `Button(props: ButtonProps): JSX.Element`, esportato come named export da `@/components/ui/button`
  - `type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'link'`
  - `type ButtonSize = 'default' | 'sm' | 'icon'`
  - `type ButtonProps`, unione in cui il ramo con `size: 'icon'` **richiede** `aria-label: string`

I task 8 e 10–13 importano `Button` e passano `variant` e `size` con questi nomi esatti.

**Una decisione da capire prima di scrivere il codice: chi possiede lo stato disabilitato.**

BTN-4 dice che lo stato disabilitato va scritto una volta sola. Oggi è scritto in tre modi nei call site (`disabled:opacity-40`, `disabled:opacity-50`, `disabled:cursor-not-allowed` a intermittenza) **più** una quarta volta in `app/globals.css`, che applica `filter: opacity(0.6)` a ogni `button:disabled`. I valori si moltiplicano: un bottone con `disabled:opacity-40` rende in realtà 0.24.

Siccome la decisione 5 della specifica tiene le regole globali dov'erano per tutta la durata della migrazione, «una volta sola» significa **in `globals.css`**, non nella primitiva. Quindi:

- il `Button` **non** dichiara nessuna `disabled:opacity-*`; l'opacità arriva dalla regola globale
- il `Button` **non** dichiara `disabled:cursor-not-allowed`; il cursore arriva dalla regola globale
- il `Button` **non** dichiara `disabled:pointer-events-none`, che è la classe stock di shadcn e cancellerebbe il cursore `not-allowed` rendendolo inosservabile
- il contributo della primitiva allo stato disabilitato è **non reagire al passaggio del mouse**, ottenuto scrivendo ogni hover come `enabled:hover:`

I call site che oggi scrivono la propria opacità la perdono durante la migrazione: è il punto, non un effetto collaterale.

- [✅] **Step 1: Scrivere il test di comportamento che fallisce**

Crea `components/ui/button.test.tsx`. Il progetto rende i componenti con `renderToStaticMarkup` in ambiente `node`: non c'è jsdom, quindi si asseriscono le classi e gli attributi nel markup, non le interazioni.

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, buttonVariants } from './button'

describe('Button', () => {
  it('renders a real button element by default', () => {
    const html = renderToStaticMarkup(<Button>Salva</Button>)
    expect(html).toMatch(/^<button /)
    expect(html).toContain('Salva')
  })

  it('paints the primary action with the theme token, not a fixed grey', () => {
    // Sedici dei diciannove bottoni di conferma usavano bg-gray-900, che il
    // pannello Admin -> Tema non puo' cambiare. E' la ragione per cui UI-1
    // esiste: non era incoerenza estetica, era una funzione di prodotto rotta.
    const html = renderToStaticMarkup(<Button>Salva</Button>)
    expect(html).toContain('bg-primary')
    expect(html).toContain('text-primary-foreground')
    expect(html).not.toContain('bg-gray-900')
  })

  it('gives the secondary action the same horizontal padding as the primary', () => {
    // BTN-3: tredici secondari usavano px-3 e tre px-4, quindi accanto a un
    // primario px-4 il secondario era piu' stretto e nessuno l'aveva deciso.
    const primary = renderToStaticMarkup(<Button>Salva</Button>)
    const secondary = renderToStaticMarkup(<Button variant="outline">Annulla</Button>)
    expect(primary).toContain('px-4')
    expect(secondary).toContain('px-4')
  })

  it('guards every hover with the enabled state', () => {
    // Un bottone disabilitato non deve reagire al passaggio del mouse. Qui
    // l'invariante e' garantito per costruzione, una volta, invece che
    // ricontrollato su ogni punto d'uso.
    for (const variant of ['default', 'outline', 'ghost', 'destructive', 'link'] as const) {
      const classes = buttonVariants({ variant })
      const unguarded = classes.match(/(?<!enabled:)hover:[\w-]+/g) ?? []
      expect(unguarded, `variante ${variant}`).toEqual([])
    }
  })

  it('leaves the disabled treatment to the global rule instead of stacking on it', () => {
    // globals.css applica gia' filter: opacity(0.6) e cursor: not-allowed a ogni
    // button:disabled. Una disabled:opacity-40 qui si moltiplicherebbe con
    // quella, rendendo 0.24 — che non e' nessuno dei valori scritti nei call
    // site, ed e' esattamente l'osservazione di BTN-4.
    const html = renderToStaticMarkup(<Button disabled>Salva</Button>)
    expect(html).not.toMatch(/disabled:opacity-\d+/)
    expect(html).not.toContain('disabled:cursor-not-allowed')
  })

  it('keeps a disabled button hit-testable so the not-allowed cursor is visible', () => {
    // La classe che shadcn spedisce di serie e' disabled:pointer-events-none, e
    // contraddice l'asserzione che buttonInteractionStyles.test.ts fa gia' su
    // globals.css: senza hit-testing il cursore not-allowed non si vede mai.
    const html = renderToStaticMarkup(<Button disabled>Salva</Button>)
    expect(html).not.toContain('pointer-events-none')
  })

  it('lets a call site override a variant utility instead of stacking against it', () => {
    const html = renderToStaticMarkup(<Button className="px-2">Salva</Button>)
    expect(html).toContain('px-2')
    expect(html).not.toMatch(/class="[^"]*px-4/)
  })

  it('renders the child element when asChild is set, keeping the variant classes', () => {
    const html = renderToStaticMarkup(
      <Button asChild variant="link"><a href="/roles">Ruoli</a></Button>
    )
    expect(html).toMatch(/^<a /)
    expect(html).toContain('href="/roles"')
    expect(html).toContain('text-primary')
  })

  it('carries the accessible name through on an icon-only button', () => {
    const html = renderToStaticMarkup(
      <Button size="icon" aria-label="Rinomina ruolo"><span aria-hidden="true">x</span></Button>
    )
    expect(html).toContain('aria-label="Rinomina ruolo"')
  })
})
```

- [✅] **Step 2: Scrivere il vincolo di tipo che fallisce**

Crea `components/ui/button.types.ts`. **Non è un file vitest** e non deve chiamarsi `.test.ts`: non c'è niente da eseguire a runtime, e un `expect(x).toBeTruthy()` messo lì solo per far accettare il file a vitest sarebbe un test che finge di asserire. Il controllo lo fa `npm run typecheck`, già presente nella pipeline dal commit `fc72693`.

```tsx
import { Button } from './button'

/**
 * L'etichetta accessibile di un bottone con sola icona, imposta dai tipi.
 *
 * Questo file non viene eseguito: esiste perche' `npm run typecheck` lo
 * compili. Ogni `@ts-expect-error` qui sotto e' un'asserzione — se il vincolo
 * che descrive sparisse, la direttiva diventerebbe inutilizzata e TypeScript
 * fallirebbe con "Unused '@ts-expect-error' directive". Il test e' che il
 * codice NON compili.
 *
 * L'inventario del 2026-08-21 ha trovato sei bottoni con sola icona senza nome
 * accessibile. Il caso che decide la questione e' TagInput.tsx:20 contro
 * RoleMultiSelect.tsx:38: stesso bottone, stessa icona X, stessa funzione, due
 * autori — uno ha messo l'aria-label e l'altro no. Nessuna quantita' di
 * attenzione risolve quel problema; un tipo lo risolve.
 */

// Ammesso: bottone con sola icona che porta la sua etichetta.
export const iconWithLabel = <Button size="icon" aria-label="Chiudi" />

// Rifiutato: bottone con sola icona senza etichetta.
// @ts-expect-error size="icon" richiede aria-label
export const iconWithoutLabel = <Button size="icon" />

// Ammesso: un bottone con testo visibile non deve dichiarare un'etichetta.
export const textButton = <Button>Salva</Button>
```

Rinomina il file in `components/ui/button.types.tsx`, perché contiene JSX. Verifica che **non** finisca fra i file raccolti da `vitest.config.ts`: il pattern è `components/**/*.test.tsx`, e questo nome non lo soddisfa.

- [✅] **Step 3: Eseguire i test e verificare che falliscano**

```bash
npm run test -- components/ui/button
```

Atteso: FAIL, `Failed to resolve import "./button"`.

- [✅] **Step 4: Scrivere `components/ui/button.tsx`**

```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize = 'default' | 'sm' | 'icon'

/**
 * Le varianti sono ricavate dai gruppi d'intento misurati in
 * docs/reviews/2026-08-21-button-inventory.md, non inventate: `default` copre i
 * 19 bottoni di conferma, `outline` i 17 secondari, `ghost` i 15 con sola icona
 * e le 6 voci d'elenco, `link` i 2 testuali.
 *
 * Tre cose che il Button di shadcn fa di serie e qui non si fanno, ognuna
 * perche' contraddice una decisione gia' presa e gia' testata nel progetto:
 *
 * - niente `disabled:pointer-events-none`: buttonInteractionStyles.test.ts
 *   asserisce che un bottone disabilitato resti sensibile al mouse, altrimenti
 *   il cursore not-allowed non si vede mai;
 * - niente `disabled:opacity-*`: globals.css applica gia' filter: opacity(0.6)
 *   a ogni button:disabled, e le due si moltiplicherebbero;
 * - ogni hover e' scritto `enabled:hover:`, cosi' un bottone disabilitato non
 *   reagisce al passaggio del mouse. E' l'invariante che
 *   disabledButtonHoverStyles.test.ts sorveglia sui punti d'uso e che qui e'
 *   garantito per costruzione.
 *
 * Le regole globali su `button` in globals.css stanno dentro @layer base con
 * :where(), quindi queste utility le sovrascrivono senza bisogno del
 * modificatore `!`. Prima del 2026-08-21 non era cosi'.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground enabled:hover:opacity-90',
        outline: 'border border-border bg-transparent enabled:hover:bg-accent',
        ghost: 'text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground enabled:hover:opacity-90',
        link: 'text-primary underline-offset-4 enabled:hover:underline',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-2',
        icon: 'p-1',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonBase = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  variant?: ButtonVariant
  asChild?: boolean
}

/**
 * In modalita' sola icona l'etichetta e' obbligatoria a livello di tipi.
 *
 * L'unione ha due rami perche' e' l'unico modo di legare l'obbligo al valore di
 * un'altra prop: col ramo `size: 'icon'` scelto, `aria-label` non e' opzionale
 * e il compilatore rifiuta il bottone senza nome invece di lasciarlo passare.
 */
export type ButtonProps =
  | (ButtonBase & { size?: Exclude<ButtonSize, 'icon'>; 'aria-label'?: string })
  | (ButtonBase & { size: 'icon'; 'aria-label': string })

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
```

- [✅] **Step 5: Eseguire i test e verificare che passino**

```bash
npm run test -- components/ui/button && npm run typecheck
```

Atteso: PASS, 9 test di comportamento. `typecheck` verde: significa che il `@ts-expect-error` ha trovato l'errore che si aspettava. Se `typecheck` fallisce con `Unused '@ts-expect-error' directive`, il vincolo sull'etichetta **non** funziona e l'unione va corretta — è quello il modo in cui questo file segnala un problema.

- [✅] **Step 6: Commit**

```bash
git add components/ui/button.tsx components/ui/button.test.tsx components/ui/button.types.tsx
git commit -m "feat(ui): add the Button primitive UI-1 asked for

Variants read off the measured intent groups rather than invented: 19
confirm buttons, 17 secondaries, 15 icon-only, 6 list items, 2 text
links. shadcn's stock names happened to fit all of them.

Three stock behaviours dropped, each contradicting something already
decided and already tested here. disabled:pointer-events-none would make
the not-allowed cursor unobservable. disabled:opacity-* would multiply
with the 0.6 filter globals.css already applies — which is why the three
values written across the call sites never rendered as any of the three.
And every hover is spelled enabled:hover:, so the invariant the AST guard
polices at call sites is true here by construction.

The icon size demands aria-label at the type level. Six icon-only buttons
have no accessible name today, and the pair that settles the argument is
TagInput against RoleMultiSelect: same button, same icon, same job, two
authors, one label. A type fixes that; attention does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Estendere il guard AST perché veda anche `<Button>`

**Files:**
- Modify: `sources/microservices/web-construct/components/ui/disabledButtonHoverStyles.test.ts:20`

**Interfaces:**
- Consumes: `Button` del task 6.
- Produces: niente. Impedisce che il guard diventi inerte.

Il guard oggi controlla `node.tagName.getText(source) === 'button'`. Nel momento in cui un call site diventa `<Button>`, il guard smette di vederlo — e **non fallisce**: continua a passare verde su un codebase in cui non controlla più niente. È il rischio che UI-1 segnala come «poco visibile», e va chiuso nello stesso commit in cui i primi call site migrano.

- [ ] **Step 1: Scrivere il caso che dimostra il buco**

Aggiungi in `components/ui/disabledButtonHoverStyles.test.ts`, dentro il `describe`, prima del test esistente:

```ts
  it('sees a Button call site, not only a native button', () => {
    // Senza questo il guard diventa inerte man mano che UI-1 procede: ogni
    // <button> migrato a <Button> esce dal suo campo visivo, e il test resta
    // verde su un codebase che non controlla piu'.
    const fixture = `
      export function Sample({ busy }: { busy: boolean }) {
        return <Button disabled={busy} className="hover:bg-accent">x</Button>
      }
    `
    expect(unsafeHoversIn('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:3 (hover:bg-accent)',
    ])
  })

  it('still sees a native button', () => {
    const fixture = `
      export function Sample({ busy }: { busy: boolean }) {
        return <button disabled={busy} className="hover:bg-accent">x</button>
      }
    `
    expect(unsafeHoversIn('fixture.tsx', fixture)).toEqual([
      'fixture.tsx:3 (hover:bg-accent)',
    ])
  })

  it('accepts a hover that is guarded by the enabled state', () => {
    const fixture = `
      export function Sample({ busy }: { busy: boolean }) {
        return <Button disabled={busy} className="enabled:hover:bg-accent">x</Button>
      }
    `
    expect(unsafeHoversIn('fixture.tsx', fixture)).toEqual([])
  })
```

- [ ] **Step 2: Eseguire e verificare che fallisca**

```bash
npm run test -- components/ui/disabledButtonHoverStyles.test.ts
```

Atteso: FAIL, `unsafeHoversIn is not defined`. La funzione oggi si chiama `unsafeDisabledButtonHovers` e prende solo un percorso: legge il file da disco, quindi non è verificabile su un frammento.

- [ ] **Step 3: Separare l'analisi dalla lettura del file, e riconoscere `Button`**

Sostituire `unsafeDisabledButtonHovers` con due funzioni: una pura che analizza del testo, e un involucro che legge il file.

```ts
const BUTTON_TAGS = new Set(['button', 'Button'])

/**
 * Analizza il testo di un sorgente. Separata dalla lettura del file perche' un
 * guard che sa esaminare solo il disco non e' verificabile: prima di questa
 * modifica nessun test dimostrava che il visitor trovasse davvero qualcosa, e
 * infatti non si sarebbe notato che aveva smesso.
 */
export function unsafeHoversIn(path: string, sourceText: string): string[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders: string[] = []

  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && BUTTON_TAGS.has(node.tagName.getText(source))) {
      const disabled = node.attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'disabled')
      const className = node.attributes.properties.find(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className')

      if (disabled && className && ts.isJsxAttribute(className) && className.initializer) {
        const unsafe = className.initializer.getText(source).match(/(?<!enabled:)hover:[\w-]+/g) ?? []
        if (unsafe.length) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          offenders.push(`${path}:${line} (${unsafe.join(', ')})`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return offenders
}

function unsafeDisabledButtonHovers(path: string): string[] {
  return unsafeHoversIn(relative(process.cwd(), path), readFileSync(path, 'utf8'))
}
```

- [ ] **Step 4: Eseguire e verificare che passi**

```bash
npm run test -- components/ui/disabledButtonHoverStyles.test.ts
```

Atteso: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add components/ui/disabledButtonHoverStyles.test.ts
git commit -m "test(ui): teach the disabled-hover guard to see Button call sites

The guard matched the literal tag name 'button'. As UI-1 migrates call
sites to <Button> it would have stopped seeing them one by one — and
stayed green the whole way, which is the failure mode worth worrying
about: not a test that breaks, a test that quietly stops checking.

Splitting the analysis from the file read is what makes that provable.
Until now nothing demonstrated the visitor found anything at all, so
nothing would have noticed when it found nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: File pilota — `RoleDetailClient.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/RoleDetailClient.tsx:47-85`
- Modify: `sources/devops/raw-color-baseline.json`

**Interfaces:**
- Consumes: `Button` del task 6.
- Produces: il modello che i lotti dei task 10–13 ripetono.

Scelto come pilota perché in venti righe contiene quattro dei casi del piano: un primario a `bg-gray-900` (BTN-1), un secondario `outline`, un bottone con sola icona **senza nome accessibile** (BTN-2), una scheda che è gruppo F e quindi **resta un `<button>` nativo**, e sette colori raw da migrare.

- [ ] **Step 1: Migrare i tre bottoni nel perimetro**

Il bottone di rinomina — gruppo C, oggi senza nome accessibile:

```tsx
              <Button
                variant="ghost"
                size="icon"
                data-testid="rename-role-btn"
                aria-label={t('roles.detail.rename')}
                onClick={() => setRenaming(true)}
              ><Pencil size={18} /></Button>
```

Se la chiave `roles.detail.rename` non esiste nel catalogo i18n, aggiungila: il guard `npm run test:i18n-keys` fallisce altrimenti, ed è il comportamento voluto.

Il secondario e il primario in fondo:

```tsx
      <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
        <Button variant="outline" onClick={cancel}>{t('common.actions.cancel')}</Button>
        <Button
          onClick={save} disabled={busy || isSystem}
          title={isSystem ? t('roles.detail.system_readonly_hint') : undefined}
        >{t('common.actions.save')}</Button>
      </div>
```

Il primario perde `bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed`: il colore arriva dal token, l'opacità e il cursore dalla regola globale.

- [ ] **Step 2: Lasciare la scheda com'è, e dire perché**

Il `<button>` delle schede `sezioni`/`operazioni` è gruppo F, fuori dal perimetro di UI-1. Resta un `<button>` nativo. Migrarne i colori raw sì, la struttura no.

- [ ] **Step 3: Migrare i sette colori raw dello stesso file**

| oggi | diventa |
|---|---|
| `text-gray-500` (sottotitolo del percorso) | `text-muted-foreground` |
| `hover:text-gray-700` (collegamento del percorso) | `hover:text-foreground` |
| `border-gray-900 ... dark:border-white` (scheda attiva) | `border-foreground` |
| `text-gray-500` (scheda inattiva) | `text-muted-foreground` |

`border-foreground` sostituisce la coppia chiaro/scuro in una classe sola: è il caso che THEME-2 descrive quando dice che un colore espresso con token non ha bisogno della variante `dark:`.

- [ ] **Step 4: Aggiornare il cricchetto**

`sources/devops/raw-color-baseline.json`: la voce `components/rbac/roles/RoleDetailClient.tsx` scende da 7 a 0, e `total` da 231 a 224. Il cricchetto impedisce al numero di salire, quindi va abbassato a mano quando scende davvero.

- [✅] **Step 5: Verifica automatica**

```bash
npm run lint && npm run test && npm run typecheck && npm run test:tokens && npm run test:raw-colors && npm run test:i18n-keys && npm run build
```

- [ ] **Step 6: Verifica in browser**

```bash
npm run dev
```

Sulla pagina di dettaglio di un ruolo, in tema chiaro e poi scuro:

1. Il bottone Salva è del colore primario del tema, non nero. Cambia colore da Admin → Tema.
2. Il bottone Salva su un ruolo di sistema è disabilitato, appare attenuato una volta sola (non due) e mostra il cursore `not-allowed` al passaggio del mouse.
3. Il bottone Salva disabilitato **non** si solleva né cambia colore al passaggio del mouse.
4. Il bottone di rinomina ha un nome accessibile: verificalo nell'albero di accessibilità del browser, non solo nel sorgente.
5. Annulla e Salva hanno la stessa imbottitura orizzontale e appaiono proporzionati.
6. Le schede `sezioni`/`operazioni` sono invariate rispetto a prima.

- [ ] **Step 7: E2E e commit** (E2E deferito al chiamante; il commit e stato fatto da questa sessione)

```bash
cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct && uv run pytest sources/tests/e2e
```

```bash
git add -A
git commit -m "refactor(rbac): migrate the pilot file to the Button primitive

Twenty lines containing four of the plan's cases: a confirm button
painted with a fixed grey the theme panel cannot reach, an outline
secondary, an icon button with no accessible name, and a tab that is out
of UI-1's scope and stays a native button.

The rename button had no name at all. It has one now, and the type
signature is why the next one cannot be forgotten.

Raw colours in this file go to zero, and the ratchet drops to 224. The
active tab's border-gray-900 dark:border-white collapses into a single
border-foreground — the dark: variant existed only because the colour
was fixed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## FASE 2 — La primitiva `Input`

### Task 9: `components/ui/input.tsx`, `textarea.tsx`, `select.tsx`

**Files:**
- Create: `sources/microservices/web-construct/components/ui/input.tsx`
- Create: `sources/microservices/web-construct/components/ui/textarea.tsx`
- Create: `sources/microservices/web-construct/components/ui/select.tsx`
- Test: `sources/microservices/web-construct/components/ui/input.test.tsx`

**Interfaces:**
- Consumes: `cn` da `@/lib/utils`.
- Produces: `Input`, `Textarea`, `Select` come named export dai rispettivi moduli, ognuno che accetta tutti gli attributi nativi del proprio elemento più `className`.

Il modello dominante nei 47 punti d'uso, dopo il rinomino della fase 0, è:

```
w-full px-3 py-2 rounded-lg border border-border bg-popover text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50
```

`ProfileForm.tsx:71` mostra la variante disabilitata: `bg-gray-100 dark:bg-gray-700 text-foreground-faint cursor-not-allowed`. Il colore raw diventa `bg-accent` e la coppia `dark:` sparisce.

`Select` qui è l'elemento `<select>` nativo con lo stesso vestito, **non** il componente Radix. Sostituire `CustomSelect.tsx` con Radix Select è un lavoro a sé, fuori dal perimetro concordato.

- [✅] **Step 1: Scrivere il test che fallisce**

Crea `components/ui/input.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input } from './input'
import { Textarea } from './textarea'
import { Select } from './select'

describe('Input', () => {
  it('renders a native input carrying its type and value through', () => {
    const html = renderToStaticMarkup(<Input type="email" defaultValue="a@b.it" />)
    expect(html).toMatch(/^<input /)
    expect(html).toContain('type="email"')
    expect(html).toContain('value="a@b.it"')
  })

  it('paints itself with theme tokens, never with a fixed colour', () => {
    const html = renderToStaticMarkup(<Input />)
    expect(html).toContain('bg-popover')
    expect(html).toContain('border-border')
    expect(html).toContain('text-foreground')
    expect(html).not.toMatch(/bg-(gray|slate|zinc)-\d+/)
  })

  it('shows a visible focus ring, which most call sites had and some did not', () => {
    const html = renderToStaticMarkup(<Input />)
    expect(html).toContain('focus:ring-2')
  })

  it('lets a call site override a base utility instead of stacking against it', () => {
    const html = renderToStaticMarkup(<Input className="px-1" />)
    expect(html).toContain('px-1')
    expect(html).not.toMatch(/class="[^"]*px-3/)
  })

  it('dresses the disabled field with a token, not a raw grey', () => {
    const html = renderToStaticMarkup(<Input disabled />)
    expect(html).toContain('disabled:bg-accent')
    expect(html).not.toContain('bg-gray-100')
  })
})

describe('Textarea', () => {
  it('renders a native textarea wearing the same clothes as Input', () => {
    const html = renderToStaticMarkup(<Textarea rows={3} />)
    expect(html).toMatch(/^<textarea /)
    expect(html).toContain('bg-popover')
    expect(html).toContain('border-border')
  })
})

describe('Select', () => {
  it('renders a native select wearing the same clothes as Input', () => {
    const html = renderToStaticMarkup(<Select><option value="a">A</option></Select>)
    expect(html).toMatch(/^<select /)
    expect(html).toContain('bg-popover')
    expect(html).toContain('<option value="a">A</option>')
  })
})
```

- [✅] **Step 2: Eseguire e verificare che fallisca**

```bash
npm run test -- components/ui/input.test.tsx
```

Atteso: FAIL, `Failed to resolve import "./input"`.

- [✅] **Step 3: Scrivere i tre componenti**

`components/ui/input.tsx`:

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Le classi di base sono il modello dominante nei 47 punti d'uso misurati da
 * UI-1, non una scelta nuova. Le due differenze rispetto a com'erano scritte a
 * mano: l'anello di focus c'e' sempre (alcuni campi non ce l'avevano, ed erano
 * i campi in cui la navigazione da tastiera si perdeva), e il vestito dello
 * stato disabilitato usa un token invece della coppia bg-gray-100/dark:bg-gray-700.
 */
export const inputBaseClasses =
  'w-full px-3 py-2 rounded-lg border border-border bg-popover text-foreground text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/50 ' +
  'disabled:bg-accent disabled:text-foreground-faint disabled:cursor-not-allowed'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(inputBaseClasses, className)} {...props} />
}
```

`components/ui/textarea.tsx`:

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'
import { inputBaseClasses } from './input'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn(inputBaseClasses, className)} {...props} />
}
```

`components/ui/select.tsx`:

```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'
import { inputBaseClasses } from './input'

/**
 * L'elemento <select> nativo, vestito come Input. Non e' il Select di Radix:
 * sostituire CustomSelect.tsx con un componente accessibile a discesa e' un
 * lavoro a se', fuori dal perimetro di UI-1.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, ...props }: SelectProps) {
  return <select className={cn(inputBaseClasses, className)} {...props} />
}
```

- [✅] **Step 4: Eseguire e verificare che passi**

```bash
npm run test -- components/ui/input.test.tsx && npm run typecheck
```

Atteso: PASS, 7 test.

- [✅] **Step 5: Commit**

```bash
git add components/ui/input.tsx components/ui/textarea.tsx components/ui/select.tsx components/ui/input.test.tsx
git commit -m "feat(ui): add the Input, Textarea and Select primitives

Base classes lifted from the dominant shape across the 47 measured call
sites rather than designed fresh, so migrating a field is a deletion.

Two things change on the way in. The focus ring is now unconditional —
some fields had it and some did not, and the ones that did not were where
keyboard navigation went invisible. And the disabled dress uses a token
instead of bg-gray-100 paired with a dark: variant, which is one fewer
place the theme panel cannot reach.

Select here is the native element wearing the same clothes, not Radix.
Replacing CustomSelect with a real accessible listbox is its own job.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## FASE 3 — Migrazione a lotti

### Ricetta di migrazione — vale per i task 10, 11, 12 e 13

Ogni lotto ripete **questa** procedura sul proprio elenco di file. Non è un rimando: è la procedura completa, e i task che seguono aggiungono solo l'elenco dei file e i numeri attesi.

**1. Per ogni `<button>` del file, decidere il gruppo prima di toccarlo.** L'elenco per gruppo è in [2026-08-21-button-inventory.md](../../reviews/2026-08-21-button-inventory.md), sezione «Elenco completo, per gruppo». I gruppi A, B, C, D, G, J si migrano; **E (interruttore), F (scheda), H (apertura elenco), I (badge di rimozione) e K (barra laterale) restano `<button>` nativi** e ricevono solo la migrazione dei colori.

**2. Applicare la variante.**

| gruppo | sostituzione |
|---|---|
| A · azione primaria | `<Button>` — niente `variant`, è il default. Se il call site aveva `px-3` invece di `px-4`, usa `size="sm"` |
| B · azione secondaria | `<Button variant="outline">` |
| C · sola icona | `<Button variant="ghost" size="icon" aria-label={...}>` — l'etichetta è obbligatoria, il compilatore la pretende |
| D · voce di elenco | `<Button variant="ghost">` |
| G · autenticazione | `<Button variant="outline" className="w-full border-brand-blue">` — il bordo di marca resta |
| J · link testuale | `<Button variant="link">` |

**3. Cancellare, non tradurre.** Dal call site spariscono: le classi di colore e imbottitura che la variante fornisce (`bg-gray-900`, `text-white`, `px-4 py-2`, `text-sm`, `rounded-lg`, `border border-border`), `disabled:opacity-40`, `disabled:opacity-50`, `disabled:cursor-not-allowed`, e `type="button"` **solo se** il bottone non è dentro un `<form>`. Restano: `onClick`, `disabled`, `data-testid`, `data-dialog-close`, `data-dialog-initial-focus`, `title` quando è un vero suggerimento e non un ripiego per il nome accessibile, e le classi di posizionamento (`absolute`, `w-full`, `flex-1`).

**4. Convergere da `title` ad `aria-label` (BTN-6)** dove `title` era l'unico nome accessibile.

**5. Migrare ogni campo** con `Input`, `Textarea` o `Select`, cancellando le classi che la primitiva già fornisce.

**6. Migrare i colori raw dello stesso file**, contestualmente. La tabella:

| colore raw | token |
|---|---|
| `bg-gray-900`, `bg-gray-800` (azione) | la variante `default` del `Button` |
| `text-white` su un pieno | `text-primary-foreground` o `text-destructive-foreground` |
| `text-gray-400`, `text-gray-500` | `text-muted-foreground` |
| `text-gray-600`, `text-gray-700` | `text-foreground-secondary` |
| `text-gray-900`, `dark:text-white` | `text-foreground` |
| `bg-gray-50`, `bg-gray-100`, `dark:bg-gray-700`, `dark:bg-gray-800` | `bg-accent` |
| `border-gray-200`, `border-gray-300`, `dark:border-gray-600`, `dark:border-gray-700` | `border-border` |
| `text-red-600`, `text-red-700` | `text-destructive-muted-foreground` |
| `bg-red-50`, `bg-red-100` | `bg-destructive-muted` |
| `text-green-600`, `text-green-700`, `text-emerald-600` | `text-success-muted-foreground` |
| `bg-green-50`, `bg-green-100` | `bg-success-muted` |
| `text-amber-600`, `text-amber-700` | `text-warning-muted-foreground` |
| `bg-amber-50`, `bg-amber-100` | `bg-warning-muted` |

**Quando un raw ha già una controparte `dark:`, la coppia collassa in una classe sola.** È il caso che THEME-2 descrive: un colore espresso con token non ha bisogno della variante `dark:`, perché il token cambia già valore col tema.

**7. Abbassare il cricchetto.** In `sources/devops/raw-color-baseline.json`, azzerare (o ridurre) la voce di ogni file toccato e ricalcolare `total`. Se un colore raw **deve** restare, lascialo nel cricchetto e annota la ragione nel messaggio di commit: sarà una voce del residuo giustificato della fase 4.

**8. Verifica automatica.**

```bash
npm run lint && npm run test && npm run typecheck && npm run test:tokens && npm run test:raw-colors && npm run test:i18n-keys && npm run build
```

**9. Verifica in browser, nei due stati del tema.** Per ogni pagina del lotto:

1. Ogni bottone migrato ha il colore giusto e risponde ad Admin → Tema.
2. Ogni bottone disabilitato del lotto è attenuato una volta sola, mostra `not-allowed`, e non reagisce al passaggio del mouse.
3. Ogni bottone con sola icona ha un nome accessibile nell'albero di accessibilità del browser.
4. Nessun testo è sotto la soglia di contrasto: controlla i punti che erano `text-gray-400` e `text-gray-500`, che sono i quattro difetti che THEME-3 ha lasciato aperti.

**10. E2E, poi commit.**

```bash
cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct && uv run pytest sources/tests/e2e
```

---

### Task 10: Lotto `rbac/`

**Files (14):** `components/rbac/CustomSelect.tsx`, `components/rbac/FilterDrawer.tsx`, `components/rbac/GridRowActionsMenu.tsx`, `components/rbac/NavigationTree.tsx`, `components/rbac/PermissionsTree.tsx`, `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`, `components/rbac/functionalities/FunctionalityForm.tsx`, `components/rbac/functionalities/IconPicker.tsx`, `components/rbac/functionalities/TagInput.tsx`, `components/rbac/roles/CreateRoleModal.tsx`, `components/rbac/roles/RenameRoleModal.tsx`, `components/rbac/roles/RolesTableClient.tsx`, `components/rbac/users/ManageRolesModal.tsx`, `components/rbac/users/RoleMultiSelect.tsx`, `components/rbac/users/StatusBadge.tsx`

**Interfaces:** consuma `Button`, `Input`, `Textarea`, `Select`. Non produce interfacce nuove.

- [ ] **Step 1: Applicare la ricetta di migrazione ai 14 file**

Il lotto più grande e quello con più casi particolari. Quattro cose da guardare:

- `IconPicker.tsx` ha 33 colori raw, il numero più alto del progetto, e 7 bottoni. Contiene anche `hover:[transform:none]` senza `!`, che `buttonInteractionStyles.test.ts` verifica esplicitamente: **non aggiungere il `!`** e non rimuovere la classe.
- `NavigationTree.tsx:94` e `:109` sono due dei sei bottoni senza nome accessibile. Oltre all'`aria-label`, `:109` ha bisogno di `aria-expanded` e `:94` è una maniglia di trascinamento di dnd-kit: gli attributi di dnd-kit danno ruolo e descrizione ma non un nome, quindi l'etichetta serve comunque.
- `GridRowActionsMenu.tsx:70` ha bisogno di `aria-label` **e** `aria-haspopup`, che la primitiva non può conoscere.
- `TagInput.tsx:20` e `PermissionsTree.tsx:16` sono i due casi che l'inventario usa come esempio: il primo è un bottone senza classi né etichetta, il secondo è un interruttore di gruppo E che **resta nativo** e riceve solo il colore (BTN-7: allinealo a `bg-primary`, come quello di `Sidebar.tsx:625`).

- [ ] **Step 2: Abbassare il cricchetto da 224 a 126**

98 occorrenze in questo lotto: `CustomSelect` 8, `FilterDrawer` 4, `NavigationTree` 6, `PermissionsTree` 3, `FunctionalitiesTreeClient` 11, `FunctionalityForm` 6, `IconPicker` 33, `TagInput` 2, `CreateRoleModal` 2, `RenameRoleModal` 1, `RolesTableClient` 5, `ManageRolesModal` 4, `RoleMultiSelect` 5, `StatusBadge` 8.

`StatusBadge.tsx` è quello da guardare: i suoi 8 raw sono verdi e rossi di stato, che è precisamente il caso per cui esistono `--success-muted` e `--destructive-muted`.

- [ ] **Step 3: Verifica automatica** — comando al punto 8 della ricetta.

- [ ] **Step 4: Verifica in browser** — punto 9 della ricetta, sulle pagine: tabella ruoli, dettaglio ruolo, tabella utenti, gestione ruoli utente, albero funzionalità, modulo funzionalità, selettore di icone.

- [ ] **Step 5: E2E e commit**

```bash
git add -A
git commit -m "refactor(rbac): migrate the rbac area onto the primitives

The largest batch and the one with the awkward cases. Four icon-only
buttons here had no accessible name; the type signature would not let
them stay that way.

StatusBadge is the batch's point: its eight raw greens and reds are
exactly what --success-muted and --destructive-muted were defined for,
and they were sitting unused since the groundwork landed.

PermissionsTree's toggle stays a native button — it is group E, its own
component, not a Button variant — but its on state moves from
bg-gray-900 dark:bg-primary to plain bg-primary, matching the sidebar's.
That is BTN-7, and the dark: variant disappears because the token
already changes with the theme.

Ratchet 224 -> 126.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Lotto `i18n/`

**Files (6):** `components/i18n/languages/LanguageFormModal.tsx`, `components/i18n/languages/LanguagesTableClient.tsx`, `components/i18n/translations/CreateTranslationKeyModal.tsx`, `components/i18n/translations/TranslationEditorDrawer.tsx`, `components/i18n/translations/TranslationValueCell.tsx`, `components/i18n/translations/TranslationsTableClient.tsx`

**Interfaces:** consuma le primitive. Non produce interfacce nuove.

- [ ] **Step 1: Applicare la ricetta ai 6 file**

`TranslationEditorDrawer.tsx` è il file denso del lotto: 5 bottoni di cui tre secondari consecutivi (righe 165, 178, 181) scritti in tre modi diversi, più 10 colori raw. I tre secondari diventano tre `<Button variant="outline">` identici, che è il punto dell'esercizio.

Le due tabelle (`LanguagesTableClient`, `TranslationsTableClient`) hanno un primario `px-3`, quindi `size="sm"`.

- [ ] **Step 2: Abbassare il cricchetto da 126 a 100**

26 occorrenze: `LanguageFormModal` 3, `LanguagesTableClient` 3, `CreateTranslationKeyModal` 3, `TranslationEditorDrawer` 10, `TranslationValueCell` 4, `TranslationsTableClient` 3.

- [ ] **Step 3: Verifica automatica** — comando al punto 8 della ricetta.

- [ ] **Step 4: Verifica in browser** — punto 9, sulle pagine: tabella lingue, modulo lingua, tabella traduzioni, cassetto di modifica traduzione, creazione chiave.

- [ ] **Step 5: E2E e commit**

```bash
git add -A
git commit -m "refactor(i18n): migrate the i18n area onto the primitives

TranslationEditorDrawer carried the batch's lesson: three secondary
buttons, adjacent in the same drawer, written three different ways. They
are now three identical Button calls, which is the whole argument for the
primitive stated in one file.

Ratchet 126 -> 100.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Lotto accesso

**Files (8):** `components/Login.tsx`, `components/ChangePasswordForm.tsx`, `app/forgot-password/ForgotPasswordForm.tsx`, `app/forgot-password/page.tsx`, `app/register/RegisterForm.tsx`, `app/register/page.tsx`, `app/set-password/SetPasswordForm.tsx`, `app/set-password/page.tsx`

**Interfaces:** consuma le primitive. Non produce interfacce nuove.

- [✅] **Step 1: Trattare il gruppo G con attenzione particolare**

Quattro dei cinque bottoni di autenticazione sono **identici carattere per carattere** in quattro file diversi. L'inventario li chiama la nota positiva: dove il modello era chiaro, la copia a mano ha tenuto. Sono anche l'unico gruppo che una migrazione sbadata può solo peggiorare.

La regola per questo lotto: dopo la migrazione i quattro devono essere ancora identici fra loro, e visivamente indistinguibili da prima. Il bordo `border-brand-blue` e la larghezza piena restano al call site, perché sono di quest'area e non del vocabolario generale.

- [✅] **Step 2: Il bottone Google di `Login.tsx` è residuo giustificato**

`Login.tsx` ha 31 colori raw, il secondo numero del progetto. Una parte è il bottone di accesso con Google, che porta i colori di marca di Google: **non si migrano**. Restano nel cricchetto e la ragione va scritta nel commit, perché la fase 4 li elencherà come residuo previsto.

`Login.tsx:197` è anche l'unico primario `bg-gray-500` del progetto — un grigio diverso da tutti gli altri, quindi nessuno l'ha scelto. Diventa `<Button>` come gli altri diciotto.

- [✅] **Step 3: Migrare i campi**

Quattro dei cinque moduli hanno campi password con il bottone «mostra/nascondi» accanto (`SetPasswordForm.tsx:72`, `Login.tsx:117`). Sono gruppo C: `<Button variant="ghost" size="icon">` con `aria-label`, e le classi di posizionamento (`absolute right-3 top-1/2 -translate-y-1/2`) restano al call site.

- [✅] **Step 4: Abbassare il cricchetto da 100 al valore che risulta**

74 occorrenze nel lotto (`ForgotPasswordForm` 9, `forgot-password/page` 1, `RegisterForm` 9, `register/page` 1, `SetPasswordForm` 11, `set-password/page` 7, `Login` 31, `ChangePasswordForm` 5), **meno** quelle di marca che restano. Il valore finale si misura, non si prevede: esegui `npm run test:raw-colors`, leggi il numero che il test riporta, e scrivi quello.

- [ ] **Step 5: Verifica automatica** — comando al punto 8 della ricetta.

- [ ] **Step 6: Verifica in browser** — punto 9, sulle pagine: accesso, registrazione, password dimenticata, impostazione password, cambio password. Verifica in più che i quattro bottoni di autenticazione siano ancora identici fra loro. (deferito: eseguito dal chiamante, non da questa sessione)

- [ ] **Step 7: E2E e commit**

Il lotto tocca i percorsi di autenticazione, quindi la suite E2E è qui più significativa che altrove.

```bash
cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct && uv run pytest
```

```bash
git add -A
git commit -m "refactor(auth): migrate the sign-in area onto the primitives

The one group that could only get worse: four of the five auth buttons
were already identical character for character across four files. They
stay identical, and they stay looking the same — the brand-blue border
and full width are this area's, not the vocabulary's.

Login's grey confirm button was the project's only bg-gray-500, which
means nobody chose it. It is now the same Button as the other eighteen.

Google's brand colours stay raw and stay in the ratchet on purpose: they
are somebody else's palette and the theme has no business repainting
them. Phase 4 lists them as expected residue rather than debt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Lotto telaio

**Files (9):** `components/Sidebar.tsx`, `components/AdminTheme.tsx`, `components/ProfileForm.tsx`, `components/Home.tsx`, `components/ui/ConfirmModal.tsx`, `components/ui/ColumnVisibilityToggle.tsx`, `components/ui/GridToolbar.tsx`, `app/(protected)/error.tsx`, `components/EmbeddedBlockedNotice.tsx`

**Interfaces:** consuma le primitive. Non produce interfacce nuove.

- [ ] **Step 1: Lasciare in pace i nove bottoni della barra laterale**

`Sidebar.tsx` è gruppo K: le sue classi stanno già in `HIGHLIGHT_CLS`, `cls` e `userPanelItemCls`, cioè è l'unico posto del progetto dove il problema era già stato risolto, in piccolo. L'inventario dice esplicitamente di lasciarli come sono. Di questo file si migrano solo i 2 colori raw.

- [ ] **Step 2: Chiudere BTN-5 in `AdminTheme.tsx`**

`AdminTheme.tsx:188` è l'unico secondario che usa `border-gray-300 dark:border-gray-600` invece di `border-border`: con il tema configurabile è l'unico bottone secondario che non segue il bordo scelto. Diventa `<Button variant="outline">` e il problema sparisce insieme alle classi.

C'è un che di appropriato nel fatto che il pannello del tema fosse il componente che non seguiva il tema.

- [ ] **Step 3: `ConfirmModal.tsx` merita la variante distruttiva**

`ConfirmModal.tsx:39` è un primario `bg-gray-900` usato anche per confermare eliminazioni. Se il componente ha già un modo di sapere che l'azione è distruttiva, usa `<Button variant="destructive">`; se non ce l'ha, **non inventarlo qui** — resta `<Button>` e la questione va annotata, perché aggiungere una prop a `ConfirmModal` cambia otto chiamanti ed è un lavoro suo.

`components/ui/dialogConsumers.test.ts` vincola otto file a usare `AccessibleDialog` con `titleId=` e `data-dialog-close`: gli attributi `data-dialog-close` devono sopravvivere alla migrazione dei bottoni, altrimenti quel test fallisce. È il comportamento voluto.

- [ ] **Step 4: Abbassare il cricchetto da quello che risulta a quello che risulta**

26 occorrenze attese (`AdminTheme` 11, `Home` 3, `ProfileForm` 8, `Sidebar` 2, `ConfirmModal` 2). Misura il valore finale invece di predirlo.

- [ ] **Step 5: Verifica automatica** — comando al punto 8 della ricetta.

- [ ] **Step 6: Verifica in browser** — punto 9, su: ogni pagina con la barra laterale, Admin → Tema, profilo, pagina iniziale, una finestra di conferma, la barra strumenti di una griglia, il selettore di colonne visibili, la pagina di errore.

Verifica in più, che è la prova finale di THEME-2: da Admin → Tema cambia il colore primario, la superficie e il bordo, e controlla che **ogni** area migrata risponda. Prima di questo lavoro non rispondeva.

- [ ] **Step 7: E2E e commit**

```bash
git add -A
git commit -m "refactor(ui): migrate the application chrome onto the primitives

AdminTheme:188 was the only secondary button spelling its border
border-gray-300 dark:border-gray-600 instead of border-border, which
made the theme panel the one component that did not follow the theme.
That is BTN-5, and it disappears with the classes.

The sidebar's nine buttons stay exactly as they are. Their classes
already live in shared variables — it is the one place in the project
where this problem had been solved, in miniature, before UI-1 existed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## FASE 4 — Chiudere THEME-2

### Task 14: Residuo dei colori raw e i quattro difetti di contrasto

**Files:**
- Modify: i file che `npm run test:raw-colors` riporta ancora sopra zero
- Modify: `sources/devops/raw-color-baseline.json`
- Modify: `docs/reviews/2026-08-19-ui-primitives-and-theming.md`

**Interfaces:** nessuna interfaccia nuova.

- [ ] **Step 1: Misurare cosa resta**

```bash
cd sources/microservices/web-construct && npm run test:raw-colors
```

Il test riporta il totale e la ripartizione per file. Ogni voce rimasta è o un file che i lotti non hanno toccato, o un residuo di marca.

- [ ] **Step 2: Migrare quello che resta e non è di marca**

Con la tabella al punto 6 della ricetta di migrazione.

- [ ] **Step 3: Chiudere i quattro difetti di contrasto di THEME-3**

THEME-3 ha trovato quattro punti sotto la soglia, tutti classi `text-gray-*` statiche che passano in un tema e falliscono nell'altro. L'elenco con classe e numero è in
[2026-08-19-ui-primitives-and-theming.md](../../reviews/2026-08-19-ui-primitives-and-theming.md), sezione «I quattro punti, con classe e numero». Se i lotti li hanno già coperti, verificalo misurando invece di assumerlo.

Attenzione a una cosa che THEME-3 ha già scoperto e messo per iscritto: **la migrazione ai token da sola non chiude il problema di accessibilità.** Un token può essere perfettamente cablato al tema e restare illeggibile. Dopo la sostituzione, misura il contrasto effettivo del punto, non limitarti a constatare che ora usa un token.

- [ ] **Step 4: Scrivere il residuo giustificato**

Il criterio di accettazione di THEME-2 chiede che le occorrenze siano «ridotte a un residuo giustificato e documentato». Aggiungi in `raw-color-baseline.json` un campo `justified` che spieghi ogni voce sopravvissuta, per file:

```json
{
  "total": 0,
  "justified": {
    "components/Login.tsx": "colori di marca del bottone di accesso con Google: sono la tavolozza di un terzo e il tema non deve ridipingerli"
  },
  "perFile": {}
}
```

Se il campo rompe `raw-color-ratchet.test.mjs`, adatta il test a ignorarlo: è metadato, non una misura.

- [ ] **Step 5: Verifica completa, browser, E2E, commit**

```bash
npm run lint && npm run test && npm run typecheck && npm run test:tokens && npm run test:raw-colors && npm run build
```

```bash
cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct && uv run pytest
```

```bash
git add -A
git commit -m "refactor(theme): close THEME-2 with a residue that is written down

What is left is listed with a reason next to it, which is what the
acceptance criterion asked for and what a bare number never gives you: a
ratchet at 12 tells nobody whether those twelve are debt or decisions.

THEME-3's four contrast defects are measured after substitution, not
assumed fixed by it. Its own finding was that a token can be perfectly
wired to the theme and still be illegible — migrating the name does not
migrate the ratio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## FASE 5 — Documentazione

### Task 15: Ribaltare DOC-1 e chiudere i task nelle review

**Files:**
- Modify: `CLAUDE.md`, sezione «Livello UI: né shadcn/ui né Material UI»
- Modify: `docs/reviews/2026-08-19-ui-primitives-and-theming.md`
- Modify: `docs/reviews/2026-08-21-button-inventory.md`

**Interfaces:** nessuna.

- [ ] **Step 1: Riscrivere la sezione «Livello UI» di `CLAUDE.md`**

È il task più importante della fase e il più facile da rimandare. Finché quella sezione resta com'è, ogni contributore e ogni sessione di AI legge una decisione revocata e riapre la discussione — che è esattamente ciò che DOC-1 era stato scritto per evitare, applicato ora alla decisione opposta.

La sezione nuova deve dire, in forma breve: che il progetto **usa** shadcn/ui; che il vocabolario dei token è quello di shadcn e i `--theme-*` non esistono più; che `lib/theme-vars.ts` è il confine oltre il quale ci sono i nomi di `ThemeConfig`, che restano nomi di dominio; che le griglie restano ag-grid; e che i componenti importati con `npx shadcn add` vanno **riletti** prima di essere accettati, con i due esempi concreti trovati durante questo lavoro (`disabled:pointer-events-none` e `--destructive-foreground` bianco su rosso scuro).

Sostituisci il rimando all'analisi di DOC-1 con un rimando alla specifica del 2026-08-24, e lascia una riga che dice che DOC-1 è stato ribaltato e quando: un lettore che trova la review vecchia deve poter capire che non vale più.

- [ ] **Step 2: Aggiornare `2026-08-19-ui-primitives-and-theming.md`**

Spunta `- [✅]` UI-1 e THEME-2 nella sezione «Task», con una descrizione dell'esito. Aggiungi in coda alla voce DOC-1 una nota datata che dice che la decisione è stata ribaltata il 2026-08-24, con il rimando alla specifica. **Non cancellare l'analisi di DOC-1:** i suoi quattro motivi restano il ragionamento che è stato fatto, e due dei quattro si sono rivelati veri lo stesso — le griglie sono rimaste ag-grid, e il conflitto sul theming è esistito davvero, solo che è stato risolto rinominando invece che convivendo.

Spunta anche i criteri di accettazione residui di THEME-3, se la fase 4 li ha chiusi.

- [ ] **Step 3: Aggiornare `2026-08-21-button-inventory.md`**

Spunta `- [✅]` le voci BTN-1…BTN-8, ognuna con una riga sull'esito. BTN-7 va spuntato solo se il task 10 ha davvero allineato l'interruttore di `PermissionsTree`; se non l'ha toccato, resta aperto e va detto.

- [ ] **Step 4: Verificare che il guard sui documenti passi**

```bash
cd sources/microservices/web-construct && npm run test:docs-contract
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: reverse DOC-1 and close UI-1, THEME-2 and BTN-1..BTN-8

CLAUDE.md carried a decision the project no longer holds, in the one file
written to be read by every contributor and every AI session. Left there
it would have done exactly what DOC-1 was written to prevent, pointed the
other way.

DOC-1's analysis stays where it is rather than being deleted. Two of its
four objections turned out to be right anyway: the grids did stay
ag-grid, and the theming conflict was real — it was resolved by renaming
the vocabulary rather than by living with two, which was an option the
original analysis did not consider.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
