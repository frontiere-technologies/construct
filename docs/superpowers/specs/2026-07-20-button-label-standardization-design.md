# Standardizzazione label bottoni Annulla/Salva/Reset

## Obiettivo

Uniformare le label dei bottoni di azione su quattro pagine a **Annulla** / **Salva** (e **Reset** dove serve), e cambiare il comportamento della pagina tema in modo che le modifiche ai colori si applichino solo dopo il Salva.

## Pagine coinvolte

### 1. /profile — `components/ProfileForm.tsx`

- Oggi: solo un bottone "Save Profile" (nessun Cancel).
- Modifiche:
  - Aggiungere un bottone **"Annulla"** accanto al Save. `onClick`: `setProfile(initialProfile)` e reset di `status` a `null`. Resta in pagina, non naviga.
  - "Save Profile" → **"Salva"** (mantiene invariata la logica di `handleSave`, solo il testo cambia, incluso lo stato "Saving…" che può restare o diventare "Salvataggio…" — testo minore, a discrezione in fase di implementazione).

### 2. /functionalities/create — `components/rbac/functionalities/FunctionalityForm.tsx`

- Oggi: bottone Cancel = "Cancella" (naviga a `/functionalities`), bottone Save = "Crea funzionalità" in create mode, "Salva" in edit mode.
- Modifiche:
  - "Cancella" → **"Annulla"** (stessa logica, `router.push('/functionalities')`).
  - Il testo del Save diventa **"Salva"** in entrambe le modalità (create ed edit) — si rimuove la label condizionale `mode === 'create' ? 'Crea funzionalità' : 'Salva'`.
- Nota: questo componente è condiviso anche da `.../functionalities/[funcId]/edit/page.tsx`; il cambio si riflette automaticamente lì (già usava "Salva").

### 3. /roles-permissions → popup "Crea nuovo ruolo" — `components/rbac/roles/CreateRoleModal.tsx`

- Oggi: bottone Cancel = "Annulla" (già corretto), bottone Save = "Crea nuovo ruolo".
- Modifiche:
  - Solo il Save button: "Crea nuovo ruolo" → **"Salva"**. Logica invariata (`submit` → `createRole(name)` poi routing).
  - Nessun'altra modale RBAC (RenameRoleModal, RoleDetailClient, ManageRolesModal) è in scope: già usano Annulla/Salva.

### 4. /admin/theme — `components/AdminTheme.tsx`

- Label:
  - "Reset to Defaults" → **"Reset"**.
  - "Save Theme" → **"Salva"**.
  - Nuovo bottone **"Annulla"**.
- Cambio di comportamento (draft locale):
  - Oggi ogni `ColorPicker`/`TokenRow` chiama `updateTheme`, che scrive immediatamente in `settings.themeConfig` (contesto globale `UIContext`). Questo applica live il colore a tutta l'app e lo persiste in `localStorage` tramite l'effect già presente in `UIContext`, indipendentemente dal salvataggio su DB.
  - Nuovo comportamento: `AdminTheme` introduce uno stato locale `draftThemeConfig` (inizializzato da `settings.themeConfig`). Tutti i picker leggono/scrivono su `draftThemeConfig`, non più sul contesto globale — quindi le modifiche in corso non si applicano al resto dell'app né a `localStorage` finché non si preme Salva.
  - **Reset**: `draftThemeConfig = defaultThemeConfig`. Solo bozza locale, non applicato/persistito.
  - **Annulla**: `draftThemeConfig = settings.themeConfig`. Scarta la bozza, torna al tema attualmente attivo/salvato. Resta in pagina.
  - **Salva**: invariata la chiamata a `saveThemeConfig(draftThemeConfig)` per la persistenza su DB; in aggiunta, `setSettings({ ...settings, themeConfig: draftThemeConfig })` per applicare live il tema via `UIContext` (che a sua volta aggiorna CSS vars e `localStorage`). Stato di successo/errore invariato.
  - Sincronizzazione: un `useEffect` su `settings.themeConfig` riallinea `draftThemeConfig` quando il valore globale cambia da fuori (es. al mount, quando `UIContext` completa `loadThemeConfig()` da DB dopo l'hydration iniziale da `localStorage`) — per evitare che la bozza iniziale resti quella di `localStorage` pre-DB. Questo effect non deve sovrascrivere una bozza con modifiche non salvate già in corso da parte dell'utente in questa stessa sessione: si aggiorna solo se l'utente non ha ancora toccato nulla (nessuna modifica pendente), altrimenti si applica solo al mount iniziale.
- Nessun impatto su `UIContext.tsx` o `lib/theme-vars.ts`.

## Fuori scope

- Nessuna introduzione di un componente `Button` condiviso: si modificano solo le stringhe/JSX esistenti nei file elencati, seguendo lo stile inline già presente.
- Nessun cambiamento alle altre modali RBAC non menzionate dall'utente.

## Test

- Unit/E2E esistenti che verificano i testi dei bottoni per queste pagine vanno aggiornati se presenti (grep per "Cancella", "Crea funzionalità", "Crea nuovo ruolo", "Reset to Defaults", "Save Theme", "Save Profile").
- Verifica manuale in browser per /admin/theme: cambiare un colore, verificare che il resto dell'app NON cambi finché non si preme Salva; premere Annulla e verificare che i picker tornino al tema corrente; premere Reset e verificare che i picker mostrino i default (senza applicare); premere Salva e verificare che il tema si applichi live e persista dopo reload.
