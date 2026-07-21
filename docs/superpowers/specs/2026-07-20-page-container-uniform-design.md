# Uniformare il contenitore di primo livello di tutte le pagine (protected)

## Contesto

Le pagine sotto `app/(protected)/` condividono già il wrapper `<main className="flex-1 overflow-y-auto p-8">` (definito in `components/Layout.tsx`), ma il contenuto interno di ogni pagina è divergente:

- `max-w-*` diverso per pagina (`max-w-7xl` in AdminTheme/user-management/roles-permissions/ProfileForm/FunctionalityForm, `max-w-5xl` in FunctionalitiesTreeClient/RoleDetailClient, `max-w-4xl` in Home).
- Titolo espresso in modi diversi: `div.mb-8` con h1+p (AdminTheme, ProfileForm), `h1.mb-6` nudo (user-management, roles-permissions, Home), header composito con azioni (FunctionalityForm, RoleDetailClient).
- Solo AdminTheme avvolge "tutto il resto" in un unico contenitore `bg-surface p-6 rounded-xl border border-border shadow-sm` (tramite il componente `Card`). Le altre pagine non hanno alcun riquadro (tabelle/tree a piena larghezza) oppure usano più riquadri affiancati (ProfileForm, FunctionalityForm).

Il riferimento fornito dall'utente (screenshot DevTools di una pagina già conforme) corrisponde esattamente alla struttura attuale di `AdminTheme.tsx`, con `max-w-7xl` da promuovere a `max-w-8xl`.

## Obiettivo

Per ogni pagina in `app/(protected)/` (pagine di autenticazione escluse: login, register, forgot-password, set-password — layout centrato senza sidebar, per natura diverso), la struttura del primo contenitore deve essere:

```
main.flex-1.overflow-y-auto.p-8      (già condiviso, invariato)
  div.max-w-8xl.mx-auto
    div.mb-8                          (titolo)
    div.bg-surface.p-6.rounded-xl.border.border-border.shadow-sm.space-y-8
      ...tutto il resto...
```

Decisioni prese con l'utente:

- **Scope**: solo le pagine `(protected)`, incluso `Home.tsx` (dashboard "/" e catch-all), pur essendo un placeholder con dati fittizi.
- **Pagine con più blocchi affiancati oggi in card separate** (ProfileForm, ChangePasswordForm): si "appiattiscono" dentro l'unico `div bg-surface` — i blocchi interni perdono il proprio `bg-surface`/`shadow-sm` per evitare il doppio bordo, mantenendo `rounded-xl border border-border-subtle p-6` come separazione leggera (stesso pattern già usato dai due box di `FunctionalityForm`).
- **Pagine tabella/tree senza alcun riquadro oggi** (Utenti, Ruoli & permessi, Funzionalità, Dettaglio ruolo): toolbar/filtri e tabella/albero entrano insieme nell'unico `div bg-surface`.
- **`max-w-8xl`**: non esiste in Tailwind v4 core (scala si ferma a `7xl` = 80rem). Va aggiunto un token custom `--container-8xl: 88rem` in `app/globals.css` (`@theme`), seguendo il passo di +8rem già presente tra `6xl` (72rem) e `7xl` (80rem).
- **Duplicazione vs componente condiviso**: creare `components/PageContainer.tsx` e riusarlo in tutte le pagine coinvolte, invece di duplicare la markup 9 volte.

Fuori scope: pagine di autenticazione; contenuto interno delle singole card (styling dei form, delle tabelle, dei filtri) non cambia se non per l'adattamento ai box "leggeri" descritto sopra.

## Implementazione

### `app/globals.css`

Aggiungere nel blocco `@theme` esistente:

```css
--container-8xl: 88rem;
```

(Attiva l'utility `max-w-8xl` in tutto il progetto, coerente con la scala nativa 6xl/7xl.)

### `components/PageContainer.tsx` (nuovo)

```tsx
import type { ReactNode } from 'react'

interface PageContainerProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function PageContainer({ title, subtitle, actions, children }: PageContainerProps) {
  return (
    <div className="max-w-8xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-foreground-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-8">
        {children}
      </div>
    </div>
  )
}
```

Se una pagina non ha `subtitle`/`actions`, li si omette semplicemente (props opzionali).

### `components/AdminTheme.tsx`

- Rimuovere `max-w-7xl mx-auto`, il `div.mb-8` di titolo e `<Card className="space-y-8">`.
- Avvolgere il contenuto esistente (sezione Global + `TOKEN_GROUPS.map` + barra Save/Reset) in `<PageContainer title="Theme & Styles" subtitle="Customize your application appearance">`.
- Rimuovere l'import di `Card` (non più usato in questo file).

### `app/(protected)/user-management/page.tsx`

- Sostituire `<div className="max-w-7xl mx-auto"><h1 ...>Utenti</h1><UsersTableClient .../></div>` con `<PageContainer title="Utenti"><UsersTableClient .../></PageContainer>`.
- `UsersTableClient` non cambia (già ritorna un fragment senza wrapper proprio).

### `app/(protected)/roles-permissions/page.tsx`

- Stessa modifica: `<PageContainer title="Ruoli & permessi"><RolesTableClient .../></PageContainer>`.
- `RolesTableClient` non cambia.

### `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`

- Il wrapper `max-w-5xl mx-auto` + `h1.mb-4` è dentro questo componente client (la page.tsx è solo un pass-through). Sostituirlo con `<PageContainer title="Funzionalità">`, spostando dentro come children: barra ricerca/filtri + tab (Tutto/Operazioni) + `<NavigationTree>`.
- Il bottone "Crea nuovo" (oggi nella riga toolbar) resta nel body, non nell'`actions` del container (non è un'azione di pagina ma di lista, resta vicino ai filtri).

### `components/rbac/roles/RoleDetailClient.tsx`

- Sostituire `max-w-5xl mx-auto` con `PageContainer`: `title={role.roleName}`, breadcrumb (`Ruoli & permessi / Dettagli`) come `subtitle`, bottoni Modifica/Annulla/Salva come `actions`.
- Il resto (tab Sezioni/Operazioni + `PermissionsTree` + modale rename) diventa children.

### `components/Home.tsx`

- Sostituire `max-w-4xl mx-auto` + `h1.mb-6` con `<PageContainer title={toTitle(pathname)}>`.
- Le 3 mini-card statistiche (`bg-surface p-6 rounded-xl shadow-sm border-border-subtle`) perdono `bg-surface`/`shadow-sm`, restano `rounded-xl border border-border-subtle p-6` (coerenti col resto del progetto).
- Il blocco "Content Area" (`bg-surface p-8 rounded-xl shadow-sm border-border-subtle min-h-[400px]`) stessa cosa: diventa `rounded-xl border border-border-subtle p-8 min-h-[400px]`, senza `bg-surface`/`shadow-sm`.

### `components/ProfileForm.tsx`

- Sostituire `max-w-7xl mx-auto` + `div.mb-8` (titolo/sottotitolo) con `<PageContainer title="Profile" subtitle="Manage your account settings">`.
- Il blocco form profilo, oggi `<Card className="w-full">`, diventa `<div className="w-full rounded-xl border border-border-subtle p-6">` (niente `bg-surface`/`shadow-sm` propri).
- Rimuovere l'import di `Card` (non più usato in questo file).
- La griglia `grid gap-6 ${...}` con `ChangePasswordForm` accanto resta invariata come layout.

### `components/ChangePasswordForm.tsx`

- `<Card className="w-full">` → `<div className="w-full rounded-xl border border-border-subtle p-6">`.
- Rimuovere l'import di `Card`.

### `components/rbac/functionalities/FunctionalityForm.tsx`

- Sostituire `max-w-7xl mx-auto` + header row (`flex items-center justify-between mb-6`) con `<PageContainer title={...} actions={<>...bottone Salva/Crea + errore...</>}>`.
- La griglia a 2 colonne (box `rounded-xl border border-border-subtle p-4`) resta invariata: già coerente col pattern "box leggero", nessun appiattimento necessario.

### `components/Card.tsx`

- Nessuna modifica: il componente resta disponibile per usi futuri anche se, dopo questo refactor, non ha più chiamanti diretti in questi file (`AdminTheme`, `ProfileForm`, `ChangePasswordForm` smettono di usarlo perché il loro riquadro esterno è ora `PageContainer`).

## Testing

- `npm run build` e `npm run lint` senza errori (verificano anche che `max-w-8xl` sia una classe valida dopo la modifica a `globals.css`).
- Verifica visiva in browser (light/dark) per ogni pagina toccata: Theme, Utenti, Ruoli & permessi, Dettaglio ruolo, Funzionalità (lista + create + edit), Profile, Home/dashboard — confermare che non ci siano doppi bordi/sfondi, che `max-w-8xl` sia effettivamente più largo di `max-w-7xl`/`5xl`/`4xl` di prima, e che i bottoni azione (Salva, Modifica, ecc.) restino ben posizionati nell'header.
- `uv run pytest` (e2e) per assicurarsi che nessun test rompa — nessun test attuale referenzia le classi toccate, ma è una verifica di non-regressione economica da fare comunque.
