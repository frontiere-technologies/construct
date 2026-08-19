# Review — Icon picker: codice morto e accessibilità (2026-08-19)

Scope: i due componenti `IconPicker` presenti nel progetto, il loro stato di utilizzo reale e la
qualità del picker vivo. Analisi statica su codice, test unitari, E2E e storia Git. Nessuna
modifica applicata.

Documenti correlati: [2026-08-19-ui-primitives-and-theming.md](2026-08-19-ui-primitives-and-theming.md),
[2026-08-19-i18n-key-inventory.md](2026-08-19-i18n-key-inventory.md).

## Sommario

Il progetto contiene due componenti chiamati `IconPicker`. **Non è duplicazione da consolidare: uno
dei due è codice morto.** `components/IconPicker.tsx` non è importato da nessuna parte — verificato
su codice applicativo, test Vitest ed E2E pytest. L'unico picker vivo è
`components/rbac/functionalities/IconPicker.tsx`, consumato da `FunctionalityForm.tsx:99`.

Il file morto è l'originale della migrazione a Next.js (commit `9b22fa7`). Il suo consumatore era
`AdminMenuBuilder.tsx`, rimosso da `0024d41` e sostituito dal picker RBAC in `8c7846e`. Il file
non è mai stato cancellato e da orfano è stato comunque toccato da due refactor successivi
(`0ba4af0` token semantici, `1171934` i18n): lavoro speso su codice che nessuno esegue. È inoltre
citato come "file da modificare" in due piani sotto `docs/superpowers/plans/`, quindi continuerà ad
attirare manutenzione finché resta in albero.

Cancellandolo si risolve contestualmente l'uso dell'import deprecato
`lucide-react/dynamicIconImports`: il file morto è il **solo** consumatore di quel path in tutto il
progetto (`IconRenderer` usa già il `import('lucide-react')` dinamico, che è la strada corretta).

Il picker vivo ha invece due difetti di accessibilità, ed entrambi sono punti in cui è *peggiore*
del file che stiamo cancellando — quello vecchio usava un `<button>` vero come trigger. Vanno
sistemati prima o insieme alla cancellazione, così l'idea buona non si perde.

## Task

- [ ] ID=DEAD-1, Severity=Low, Complexity=Low, Priority=P2, Title=Cancellare `components/IconPicker.tsx` (codice morto), Fix description=Rimuovere il file. Nessun import in tutto il repo. Risolve contestualmente l'import lucide deprecato.
- [ ] ID=A11Y-1, Severity=Medium, Complexity=Low, Priority=P1, Title=Controllo interattivo annidato nel trigger del picker RBAC, Fix description=Portare il trigger da `<div role="button">` a un `<button>` reale e spostare il bottone di rimozione fuori dal trigger, come sibling nel wrapper.
- [ ] ID=A11Y-2, Severity=Low, Complexity=Low, Priority=P2, Title=Campo di ricerca icone senza nome accessibile, Fix description=Aggiungere `aria-label` all'input di ricerca del tab "library", che oggi ha solo un `placeholder`.
- [ ] ID=FEAT-1, Severity=Info, Complexity=Medium, Priority=P3, Title=Ricerca limitata alle ~200 icone curate, Fix description=Decisione di prodotto. Valutare un fallback "cerca in tutte le icone lucide" quando la lista curata non produce risultati.

---

## DEAD-1 — Cancellare `components/IconPicker.tsx`

**Severity** Low · **Complexity** Low · **Priority** P2

### Evidenza

Ricerca su tutto il repo (esclusi `node_modules/` e `.next/`): l'unico import di un `IconPicker` è

```
components/rbac/functionalities/FunctionalityForm.tsx:6   import IconPicker from './IconPicker'
components/rbac/functionalities/FunctionalityForm.tsx:99   <IconPicker compact value={f.iconPath} onChange={v => set('iconPath', v)} />
```

Il path relativo `./IconPicker` risolve al picker RBAC, non a quello in `components/`. Nessun
riferimento a `components/IconPicker.tsx` in `app/`, `components/`, `lib/`, nei test Vitest, né
negli E2E pytest. Le sole altre occorrenze del nome sono in documenti storici sotto `docs/`.

Storia del file:

| Commit | Effetto |
|---|---|
| `9b22fa7` | `feat: add IconRenderer and IconPicker components` — nasce il file, consumato da `AdminMenuBuilder.tsx` |
| `0024d41` | `refactor(web): remove legacy menu_items system` — rimuove il sistema che lo usava |
| `8c7846e` | `feat(rbac): icon picker, Admin nav consolidation` — nasce il picker RBAC che lo sostituisce |
| `0ba4af0` | migrazione ai token semantici — tocca il file **già orfano** |
| `1171934` | i18n — tocca il file **già orfano** |

`AdminMenuBuilder.tsx` e `Card.tsx`, citati nei piani dell'epoca, non esistono più in albero:
conferma indipendente che il consumatore è stato rimosso.

### Import lucide deprecato (risolto da questo task)

`components/IconPicker.tsx:4` è l'unico posto nel progetto che importa
`lucide-react/dynamicIconImports`. Con lucide-react 1.21.0 quel file esiste ancora
(`node_modules/lucide-react/dynamicIconImports.mjs`) e il pacchetto non ha una `exports` map, quindi
il subpath risolve e compila — ma è il percorso legacy, sostituito da `lucide-react/dynamic`. Un
futuro major di lucide lo romperebbe, e lo si scoprirebbe compilando codice che nessuno esegue.
Non serve alcun intervento separato: cancellando il file, l'import sparisce.

### Cosa si perde (valutare prima di cancellare)

Il file morto ha due cose che il picker vivo non ha. Se interessano, vanno portate **prima** nel
picker RBAC (vedi A11Y-1 e FEAT-1), altrimenti si perdono:

1. **Trigger accessibile** — usa un `<button type="button">` vero. Il picker vivo usa un
   `<div role="button">`. Vedi A11Y-1.
2. **Ricerca su tutto il catalogo lucide** (~1600 nomi da `dynamicIconImports`). Il picker vivo
   cerca solo dentro la lista curata `ICONS` (~200 nomi). Vedi FEAT-1.
3. **Error boundary per singola icona** (`IconItemBoundary`). Valore reale basso: `IconRenderer` già
   degrada a `HelpCircle` per un nome inesistente, quindi il boundary non copre un caso concreto.

### Fix

Cancellare `sources/microservices/web-construct/components/IconPicker.tsx`.

I documenti sotto `docs/superpowers/plans/` che lo citano sono registrazioni storiche di lavoro già
svolto: **non** vanno aggiornati.

### Criteri di accettazione

- [ ] Il file non esiste più.
- [ ] `npm run lint` pulito.
- [ ] `npm run build` completa (il type-check copre tutti i file in `tsconfig`, non solo quelli importati).
- [ ] `npm run test` verde.
- [ ] `grep -rn "dynamicIconImports" app components lib` non restituisce nulla.
- [ ] E2E: la pagina di creazione/modifica funzionalità continua a mostrare e salvare l'icona.

### Rischi

Nessuno identificato. Il file non è nel grafo degli import, quindi non è nemmeno nel bundle: la
cancellazione non può cambiare il comportamento a runtime.

---

## A11Y-1 — Controllo interattivo annidato nel trigger

**Severity** Medium · **Complexity** Low · **Priority** P1
**File** `components/rbac/functionalities/IconPicker.tsx`

### Problema

Il trigger del picker è un `div` con ruolo `button` (righe 106-108):

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={() => setOpen(o => !o)}
  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { ... } }}
  aria-label={...}
>
```

e **al suo interno**, a riga 124-131, contiene un secondo controllo interattivo — il `<button>` con
la X rossa che azzera l'icona selezionata:

```tsx
<button type="button" onClick={clear} aria-label={t('functionalities.icon.remove_label')}>
  <X size={9} />
</button>
```

Un elemento con `role="button"` ha *presentational children*: gli assistive technology appiattiscono
il suo contenuto a testo, quindi il bottone di rimozione annidato non viene esposto come controllo
autonomo. In pratica la X non è raggiungibile in modo affidabile né da screen reader né da
navigazione con Tab, ed è azionabile solo col mouse. Inoltre `onKeyDown` sul contenitore intercetta
`Enter`/`Space`, quindi anche riuscendo a mettere il focus sulla X il comportamento da tastiera è
ambiguo.

### Fix proposto

Ristrutturare in due controlli fratelli dentro il wrapper già esistente (`div.relative.shrink-0`):

- Il trigger diventa un `<button type="button">`, eliminando `role`, `tabIndex` e `onKeyDown`
  manuali: la semantica nativa fornisce focus e attivazione da tastiera gratis.
- La X di rimozione esce dal trigger e resta un `<button>` posizionato in `absolute` nel wrapper,
  con `z-index` sopra il trigger. Non serve più `e.stopPropagation()` in `clear`, perché il click
  non attraversa più il trigger — verificarlo però, perché la sovrapposizione in absolute può
  ancora richiederlo a seconda del layout finale.

Attenzione a un vincolo esterno: `app/globals.css` applica regole globali su
`button:not(:disabled)` (`transform: translateY(-1px)` in hover). Un trigger che diventa un
`<button>` erediterà quel micro-spostamento in hover, che oggi non ha. Se l'effetto è indesiderato
su questo controllo, va neutralizzato localmente — e la scelta va coordinata con UI-1
(`2026-08-19-ui-primitives-and-theming.md`), che decide dove vivono gli stili di interazione dei
bottoni.

### Criteri di accettazione

- [ ] Il trigger è un `<button type="button">`; nessun `role="button"` nel file.
- [ ] Nessun controllo interattivo annidato dentro un altro controllo interattivo.
- [ ] Con Tab si raggiungono trigger e X di rimozione come due stop distinti; `Enter` e `Space` attivano quello che ha il focus.
- [ ] La X compare solo quando `value` è valorizzato (comportamento attuale invariato).
- [ ] Verifica E2E nel browser su `/functionalities/create`: selezione icona, rimozione icona, apertura/chiusura popover con click esterno.

---

## A11Y-2 — Input di ricerca senza nome accessibile

**Severity** Low · **Complexity** Low · **Priority** P2
**File** `components/rbac/functionalities/IconPicker.tsx:160-167`

L'input di ricerca del tab "library" ha solo un `placeholder`
(`t('icon_picker.search_placeholder')`). Il placeholder non è un nome accessibile: sparisce alla
digitazione e non tutti gli screen reader lo annunciano. L'icona `Search` accanto è decorativa e non
fornisce un nome.

**Fix** aggiungere `aria-label={t('icon_picker.search_placeholder')}` all'input, riusando la chiave
già seedata. Nessuna nuova chiave i18n necessaria.

**Accettazione** l'input espone un nome accessibile; nessuna nuova chiave i18n introdotta.

---

## FEAT-1 — Ricerca limitata alle icone curate

**Severity** Info · **Complexity** Medium · **Priority** P3
**File** `components/rbac/functionalities/IconPicker.tsx:10-57`

Non è un difetto, è una decisione di prodotto da prendere consapevolmente.

La lista `ICONS` è un subset curato hardcoded (~200 nomi PascalCase, deduplicato con
`[...new Set(ICONS)]`), pensato per voci di navigazione e amministrazione. La ricerca filtra solo
dentro quel subset. Conseguenza: se un utente cerca un'icona che esiste in lucide ma non è in lista,
non la trova **e non ha modo di capire che esiste** — la ricerca restituisce semplicemente
"nessun risultato".

Il file cancellato da DEAD-1 cercava invece su tutto il catalogo.

### Opzioni

1. **Lasciare com'è.** Il subset curato è una scelta difendibile: risultati coerenti, griglia
   ordinata, nessun rischio di icone fuori registro visivo.
2. **Fallback sul catalogo completo.** Quando la ricerca curata non dà risultati, offrire
   esplicitamente "cerca in tutte le icone" caricando i nomi da `lucide-react/dynamic` (il path
   moderno, **non** `dynamicIconImports`). Il caricamento va fatto solo su richiesta, per non
   riportare ~1600 nomi nel bundle dell'area admin.

### Dipendenza con I18N-1

Se si sceglie l'opzione 2, due delle tre chiavi i18n oggi orfane tornano utili
(`icon_picker.select_placeholder`, `icon_picker.empty`) e la segnalazione di
`2026-08-19-i18n-key-inventory.md` si riduce da tre a una. Se si sceglie l'opzione 1, le tre chiavi
restano orfane e vanno gestite come descritto in quel documento.
