# Theme & Styles: unificare il pattern di riga tra i gruppi token e Sidebar/Active Item

## Contesto

La pagina "Theme & Styles" (`components/AdminTheme.tsx`) mostra oggi due layout diversi per token dello stesso tipo (coppia light/dark):

- **Sfondi, Border, Testo** (aggiunti in `56132d7`): componente `TokenRow`, una riga per token con swatch Light e Dark affiancati, raggruppati in accordion `<details open>`.
- **Sidebar & Active Item** (design originale, mai aggiornato): componente `ColorPicker` legacy, uno swatch per istanza, disposto in due colonne statiche "Light Theme" / "Dark Theme" non collassabili.

Questa incoerenza visiva è emersa confrontando due screenshot della pagina (sezioni Sfondi/Border/Testo espanse vs collassate) ed è stata confermata analizzando `git log` sui due blocchi di codice: sono stati scritti in momenti diversi senza un refactor di allineamento.

## Obiettivo

Applicare il pattern `TokenRow` + accordion (quello introdotto in `56132d7`, preferito dall'utente) anche alla sezione Sidebar & Active Item, cosicché tutti i gruppi di token con coppia light/dark condividano lo stesso layout.

Fuori scope: la riga "Primary Color" resta con `ColorPicker` a swatch singolo, perché non ha una coppia light/dark (colore unico per entrambi i temi) — non c'è inconsistenza da correggere lì.

## Implementazione

### `components/AdminTheme.tsx`

- Aggiungere un quarto elemento a `TOKEN_GROUPS`, titolo **"Sidebar & Active Item"**, con le 4 righe esistenti:
  - Sidebar Background → `sidebarBgLight` / `sidebarBgDark`
  - Sidebar Text → `sidebarTextLight` / `sidebarTextDark`
  - Active Item Background → `activeItemBgLight` / `activeItemBgDark`
  - Active Item Text → `activeItemTextLight` / `activeItemTextDark`
- Rimuovere il blocco JSX statico a due colonne (righe 135-151 attuali) e le relative 8 chiamate a `ColorPicker`.
- Nessuna modifica a `types/menu.ts` / `ThemeConfig`: le chiavi restano identiche, cambia solo il componente di rendering.
- Il componente `ColorPicker` resta in uso per "Primary Color": non va rimosso.

Il nuovo gruppo eredita automaticamente da `TOKEN_GROUPS.map(...)` lo stesso accordion `<details open>` (aperto di default, come gli altri tre), senza bisogno di logica ad hoc.

## Testing

- Build (`npm run build`) e lint (`npm run lint`) senza errori.
- Verifica visiva in browser: la pagina Theme & Styles mostra 4 gruppi (Sfondi, Border, Testo, Sidebar & Active Item) con lo stesso layout a riga doppia swatch, sia in stato espanso che collassato.
- Verifica funzionale: modificare un colore Sidebar/Active Item aggiorna lo stato locale (`updateTheme`) e si riflette a runtime esattamente come prima del refactor; Save e Reset to Defaults continuano a operare sull'intero `themeConfig` senza differenze.
