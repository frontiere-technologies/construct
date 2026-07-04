# Theme tokens: centralizzare i colori light/dark + revisione pagina Theme & Styles

## Contesto

`app/globals.css` centralizza già 5 colori personalizzabili (primary, sidebar bg/text, active item bg/text) tramite `--theme-*` CSS custom properties, applicate a runtime da `context/UIContext.tsx` e gestite dalla pagina `components/AdminTheme.tsx` ("Theme & Styles").

Il resto dell'app usa invece classi Tailwind `dark:` hardcoded direttamente nei componenti: 122 occorrenze in 28 file, con un piccolo numero di combinazioni ripetute molte volte (es. `border-gray-200 dark:border-gray-700` × 46, `bg-white dark:bg-gray-900` × ~23). Queste combinazioni non sono personalizzabili e sono duplicate ovunque.

## Obiettivo

1. Estrarre le combinazioni light/dark più frequenti in token CSS semantici centralizzati in `globals.css`, sullo stesso meccanismo già esistente.
2. Renderli personalizzabili dalla pagina Theme & Styles, come i 5 token attuali.
3. Sostituire le classi Tailwind hardcoded nei 28 file con le nuove utility basate sui token.
4. Rivedere la pagina Theme & Styles (layout/UX) alla luce dei nuovi controlli aggiunti.

Fuori scope: le combinazioni usate una sola volta (colori di stato rosso/verde, `dark:bg-primary`, focus-within, ecc.) restano hardcoded.

## Token

10 nuovi token semantici, ciascuno con valore light e dark (20 campi). I valori di default coincidono con le classi Tailwind più ricorrenti trovate nel codice, quindi il refactor non cambia l'aspetto visivo di default (salvo due micro-incoerenze esistenti, vedi sotto).

| Token | Utility generata | Light | Dark | Sostituisce |
|---|---|---|---|---|
| `page` | `bg-page` | `#f9fafb` | `#030712` | sfondo pagina (`Layout.tsx`) |
| `surface` | `bg-surface` | `#ffffff` | `#1f2937` | Card, badge, superfici base |
| `surface-overlay` | `bg-surface-overlay` | `#ffffff` | `#111827` | dropdown/modal/popover/input |
| `surface-hover` | `bg-surface-hover` | `#f3f4f6` | `#1f2937` | hover righe/menu |
| `border` | `border-border` | `#e5e7eb` | `#374151` | border default |
| `border-subtle` | `border-border-subtle` | `#f3f4f6` | `#1f2937` | divisori tenui, alcune card |
| `foreground` | `text-foreground` | `#111827` | `#ffffff` | titoli + testo base |
| `foreground-secondary` | `text-foreground-secondary` | `#374151` | `#d1d5db` | label |
| `foreground-muted` | `text-foreground-muted` | `#6b7280` | `#9ca3af` | testo secondario/help |
| `foreground-faint` | `text-foreground-faint` | `#9ca3af` | `#6b7280` | placeholder/icone/timestamp |

Nomi scelti per non collidere con il token esistente `primary` (colore brand per bottoni/icone attive, resta invariato) e per evitare ridondanze tipo `text-text-primary`.

**Decisioni di merge/unificazione** (basate sull'analisi delle occorrenze reali):
- `foreground` unifica quello che nell'analisi iniziale erano due token quasi identici (`text-primary` gray-900/white per i titoli, `text-body` gray-900/gray-100 per il testo base di `Layout.tsx`). La differenza `white` vs `gray-100` in dark mode è impercettibile; si usa `white` (valore più frequente: 9 occorrenze vs 7).
- `border-subtle` unifica `border-gray-100 dark:border-gray-800` (7 occorrenze) e `border-gray-200 dark:border-gray-800` (6 occorrenze, incoerenza preesistente). Effetto: in light mode 6 border diventano leggermente più chiari (gray-200 → gray-100).
- `foreground-muted` unifica `text-gray-500 dark:text-gray-400` con le 3 occorrenze incoerenti `text-gray-600 dark:text-gray-400`. Effetto: in light mode 3 testi diventano leggermente più chiari (gray-600 → gray-500).

Entrambe le unificazioni sono micro-variazioni visive minori che correggono incoerenze già presenti nel codice, non introducono un nuovo look.

## Implementazione

### `types/menu.ts`
`ThemeConfig` si estende con i 20 nuovi campi (10 token × Light/Dark). `defaultThemeConfig` riceve i valori della tabella sopra. Nessuna migrazione DB: `theme_config` è già `jsonb` e il merge `{ ...defaultThemeConfig, ...saved }` in `UIContext.tsx` gestisce automaticamente i config salvati prima di questo cambio.

### `app/globals.css`
Ogni token aggiunge una riga in `:root` (`--theme-page`, `--theme-surface`, ...) e una riga in `@theme` (`--color-page: var(--theme-page)`, ...), seguendo esattamente il pattern già usato per i 5 token esistenti.

### `context/UIContext.tsx`
L'effetto che oggi imposta le 5 CSS custom properties (`root.style.setProperty(...)`) si estende con le stesse chiamate per i 10 nuovi token, usando lo stesso helper `safeColor` (fallback al default se il valore salvato non è un hex valido) e la stessa logica di scelta light/dark in base a `isDark`.

### Migrazione dei 28 componenti
Sostituzione 1:1 delle combinazioni di classi Tailwind con le nuove utility (es. `border-gray-200 dark:border-gray-700` → `border-border`, `bg-white dark:bg-gray-900` → `bg-surface-overlay`, `hover:bg-gray-100 dark:hover:bg-gray-800` → `hover:bg-surface-hover`). L'elenco preciso file/riga è quello raccolto durante l'analisi (28 file, ~110 delle 122 occorrenze totali coperte dai 10 token; il resto resta hardcoded per le ragioni di scope sopra).

### `components/AdminTheme.tsx` — pagina "Theme & Styles"
Riorganizzazione in sezioni, ciascuna con colonne Light/Dark dove applicabile (pattern già usato per Sidebar/Active Item):
- **Global**: Primary Color (invariato)
- **Sfondi**: Page, Surface, Surface Overlay, Surface Hover
- **Border**: Border, Border Subtle
- **Testo**: Foreground, Foreground Secondary, Foreground Muted, Foreground Faint
- **Sidebar** (esistente, invariato)
- **Active Item** (esistente, invariato)

Con 29 color picker totali (9 attuali + 20 nuovi) la pagina diventa lunga: si valuta durante l'implementazione se raggruppare le sezioni "Sfondi"/"Border"/"Testo" in blocchi collassabili (`<details>` o accordion) per mantenere la pagina scansionabile, mantenendo "Global", "Sidebar" e "Active Item" sempre visibili come oggi. Reset-to-defaults e Save restano invariati (operano già sull'intero oggetto `themeConfig`).

## Testing

- Build (`npm run build`) e lint (`npm run lint`) senza errori.
- Verifica visiva in browser in light e dark mode: nessuna regressione visibile nelle pagine che usano i componenti toccati (Sidebar, RBAC tables/forms, Home, modali, dropdown).
- Verifica funzionale della pagina Theme & Styles: modifica di un token nuovo si riflette a runtime, Save persiste su Supabase, Reset to Defaults ripristina tutti i 29 campi, un config salvato precedente (senza i nuovi campi) continua a caricarsi correttamente grazie al merge con i default.
