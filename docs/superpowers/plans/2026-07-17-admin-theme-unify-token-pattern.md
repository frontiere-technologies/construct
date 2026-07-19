# Theme & Styles: unificare pattern TokenRow su Sidebar & Active Item — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far usare alla sezione "Sidebar & Active Item" della pagina `/admin/theme` lo stesso componente `TokenRow` (riga con swatch Light/Dark affiancati, dentro accordion) già usato dai gruppi Sfondi/Border/Testo, eliminando il layout legacy a due colonne statiche.

**Architecture:** Modifica di un solo file, `components/AdminTheme.tsx`. Si aggiunge un quarto elemento a `TOKEN_GROUPS` (già mappato genericamente in JSX su `<details open>` + `TokenRow`) e si rimuove il blocco JSX statico che renderizzava la stessa sezione con `ColorPicker` a swatch singolo. Nessun nuovo componente, nessuna modifica al data model.

**Tech Stack:** React 19 + TypeScript + Next.js 15 (App Router), Tailwind CSS v4. Nessuna libreria nuova.

## Global Constraints

- Nessuna modifica a `types/menu.ts` / `ThemeConfig`: le chiavi `sidebarBgLight`, `sidebarBgDark`, `sidebarTextLight`, `sidebarTextDark`, `activeItemBgLight`, `activeItemBgDark`, `activeItemTextLight`, `activeItemTextDark` restano invariate.
- Il componente `ColorPicker` (righe 10-29) resta in uso per "Primary Color" — non va rimosso, solo non più usato per Sidebar/Active Item.
- `npm run build` e `npm run lint` devono passare senza errori al termine.
- Verifica visiva obbligatoria in browser (light e dark mode) prima di dichiarare il task completo — build/lint da soli non bastano.

---

## Task 1: Unificare la sezione Sidebar & Active Item al pattern TokenRow

**Files:**
- Modify: `sources/microservices/web-construct/components/AdminTheme.tsx:58-84` (array `TOKEN_GROUPS`)
- Modify: `sources/microservices/web-construct/components/AdminTheme.tsx:135-151` (blocco JSX statico da rimuovere)

**Interfaces:**
- Consumes: `TokenRow` (props `label: string`, `lightValue: string`, `darkValue: string`, `onChangeLight: (v: string) => void`, `onChangeDark: (v: string) => void`), già definito a `AdminTheme.tsx:31-51` — nessuna modifica alla sua firma.
- Consumes: `TokenGroup` type (`{ title: string; rows: { label: string; lightKey: keyof ThemeConfig; darkKey: keyof ThemeConfig }[] }`), già definito a `AdminTheme.tsx:53-56` — nessuna modifica alla sua forma.
- Produces: nessuna nuova interfaccia esposta ad altri file — modifica contenuta interamente dentro `AdminTheme.tsx`.

- [✅] **Step 1: Aggiungere il quarto gruppo a `TOKEN_GROUPS`**

Aprire `sources/microservices/web-construct/components/AdminTheme.tsx` e sostituire l'array `TOKEN_GROUPS` (righe 58-84) aggiungendo un quarto elemento in coda:

```tsx
const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Sfondi',
    rows: [
      { label: 'Page Background', lightKey: 'pageLight', darkKey: 'pageDark' },
      { label: 'Surface', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
      { label: 'Surface Overlay', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
      { label: 'Surface Hover', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
    ],
  },
  {
    title: 'Border',
    rows: [
      { label: 'Border', lightKey: 'borderLight', darkKey: 'borderDark' },
      { label: 'Border Subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
    ],
  },
  {
    title: 'Testo',
    rows: [
      { label: 'Foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
      { label: 'Foreground Secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
      { label: 'Foreground Muted', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
      { label: 'Foreground Faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
    ],
  },
  {
    title: 'Sidebar & Active Item',
    rows: [
      { label: 'Sidebar Background', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
      { label: 'Sidebar Text', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
      { label: 'Active Item Background', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
      { label: 'Active Item Text', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
    ],
  },
]
```

- [✅] **Step 2: Rimuovere il blocco JSX statico a due colonne**

Nello stesso file, individuare ed eliminare interamente il blocco (attualmente righe 135-151, subito dopo il `{TOKEN_GROUPS.map(...)}` e prima del footer con i bottoni Reset/Save):

```tsx
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h3 className="font-medium text-foreground border-b pb-2 border-border">Light Theme — Sidebar & Active Item</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgLight} onChange={v => updateTheme('sidebarBgLight', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextLight} onChange={v => updateTheme('sidebarTextLight', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgLight} onChange={v => updateTheme('activeItemBgLight', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextLight} onChange={v => updateTheme('activeItemTextLight', v)} />
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-foreground border-b pb-2 border-border">Dark Theme — Sidebar & Active Item</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgDark} onChange={v => updateTheme('sidebarBgDark', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextDark} onChange={v => updateTheme('sidebarTextDark', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgDark} onChange={v => updateTheme('activeItemBgDark', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextDark} onChange={v => updateTheme('activeItemTextDark', v)} />
          </div>
        </div>

```

Dopo la rimozione, il flusso JSX deve andare direttamente da `{TOKEN_GROUPS.map(...)}` (che ora include anche il gruppo "Sidebar & Active Item") al `<div className="pt-4 border-t border-border ...">` del footer Reset/Save, senza altro markup intermedio.

- [✅] **Step 3: Verificare che non restino riferimenti orfani**

```bash
cd sources/microservices/web-construct && grep -n "Light Theme — Sidebar\|Dark Theme — Sidebar" components/AdminTheme.tsx
```

Expected: nessun output (nessuna corrispondenza).

- [✅] **Step 4: Lint**

```bash
cd sources/microservices/web-construct && npm run lint
```

Expected: nessun errore. `ColorPicker` deve risultare ancora usato (per "Primary Color"), quindi nessun warning "unused" atteso su di esso.

- [✅] **Step 5: Build**

```bash
cd sources/microservices/web-construct && npm run build
```

Expected: build completata senza errori TypeScript (le chiavi `lightKey`/`darkKey` del nuovo gruppo devono tipare correttamente contro `keyof ThemeConfig`).

- [✅] **Step 6: Verifica visiva in browser**

Avviare il dev server se non già attivo:

```bash
cd sources/microservices/web-construct && npm run dev
```

Con un browser (es. Playwright headless o `claude-in-chrome`), navigare su `http://localhost:3000/admin/theme` autenticati come admin:

1. Screenshot della pagina con tutti i gruppi espansi di default: verificare che siano visibili 4 gruppi in accordion — Sfondi, Border, Testo, **Sidebar & Active Item** — tutti con lo stesso layout a riga (label + swatch Light + swatch Dark).
2. Cliccare sul summary "Sidebar & Active Item" per collassarlo/espanderlo: verificare che si comporti come gli altri tre gruppi (accordion nativo `<details>`).
3. Cambiare il colore di "Sidebar Background" (swatch Dark) e verificare che il valore si rifletta nello stato (es. controllare il testo del futuro Save/Reset non serve, basta che l'input `color` accetti il nuovo valore senza errori console).
4. Cliccare "Save Theme": verificare che appaia il messaggio "Theme saved." e nessun errore in console.
5. Cliccare "Reset to Defaults": verificare che tutti i colori tornino ai default, inclusi quelli del nuovo gruppo.

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/components/AdminTheme.tsx
git commit -m "$(cat <<'EOF'
refactor(admin-theme): unify Sidebar & Active Item to TokenRow pattern

Merges the legacy two-column ColorPicker layout into TOKEN_GROUPS so all
light/dark token pairs share the same accordion + dual-swatch row.
EOF
)"
```
