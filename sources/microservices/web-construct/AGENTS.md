# AGENTS.md — web-construct

Convenzioni React/TypeScript di questo microservizio. Leggi anche `../../../CLAUDE.md`
(comandi, stack, decisione shadcn) e `../../../README.md`.

Queste regole nascono da una guida esterna, verificata contro il codice il 2026-08-26
([docs/reviews/2026-08-26-verify-naming-conventions-react.md](../../../docs/reviews/2026-08-26-verify-naming-conventions-react.md)).
Alcune sono state adottate, altre **respinte con motivo**: la sezione finale dice quali,
così nessuno — persona o agente — riapre l'analisi da zero fra tre mesi.

Il principio: una convenzione vale solo se è scritta qui **e** difesa da un cricchetto in CI.
Le regole senza controllo automatico sono desideri.

---

## Linguaggio e strumenti

- TypeScript per tutto il codice applicativo. Nessun `.js`/`.jsx`.
- `.tsx` **solo** per file che contengono JSX. Un file senza JSX è `.ts`, test compresi.
  JSX dentro una template string come fixture di test non conta: quel file resta `.ts`.
- `strict: true` non si indebolisce per far passare un'implementazione. Zero `any`,
  zero `@ts-ignore`. Un `@ts-expect-error` è ammesso solo come *asserzione voluta*
  (se il vincolo che descrive sparisse, il typecheck deve rompersi) e va commentato.
- `eslint-disable` sempre sulla riga singola e con il motivo accanto. Mai a livello di file.
- Virgolette singole, con un'eccezione: doppie solo dove una singola andrebbe scappata —
  apostrofi italiani dentro una stringa, fixture SQL. `lib/rbac/user-guards.ts:13`
  (`"Non puoi rimuovere l'ultimo amministratore attivo"`) è un esempio; ogni doppia
  rimasta nel codice è di questa forma. Nessun punto e virgola a fine riga.
  L'unico punto in cui un separatore serve davvero e' una riga che apre con `(` o `[` subito
  dopo un'espressione: senza separatore il parser la legge come una chiamata o un indice sul
  risultato della riga precedente. Non si risolve tenendosi il punto e virgola: si sposta la
  riga in questione sotto un `import` o una dichiarazione, dove il pericolo non esiste.
  `components/AppHydrationMarker.test.tsx` e
  `components/rbac/functionalities/TranslationsAccordion.test.tsx` hanno entrambi quella forma.
- Il logging passa da `lib/logger.ts` (pino), non da `console.*` — tranne ai confini lato
  client che pino non può raggiungere, dove `console.warn`/`console.error` sono ammessi a
  patto di portare il motivo accanto. Oggi sono due: `app/(protected)/error.tsx` (l'error
  boundary deve loggare anche quando il resto della pagina, i18n compreso, è quello che si
  è rotto) e `context/I18nContext.tsx` (avviso dev-only per una traduzione mancante, mai in
  produzione). Fuori da questi confini `console.*` non esiste.
- Parametri inutilizzati con prefisso `_` solo quando una firma esterna li impone
  (callback di `it.each`, callback di lookup DNS).
- Prima di consegnare: `npm run lint`, `npm run typecheck`, `npm test`.

## Nomi dei file e delle cartelle

Due regole, in quest'ordine:

1. **`components/ui/**` è sempre in `kebab-case`.** Non è una scelta estetica:
   `npx shadcn add` scrive `dialog.tsx`, `table.tsx` in minuscolo e continuerà a farlo.
   In quella cartella si segue il fornitore.
2. **Altrove il nome del file rispecchia il suo export principale quando quell'export è
   un componente React o un context** (`NavigationTree.tsx`, `I18nContext.tsx`,
   `RegisterForm.tsx`). **In ogni altro caso il nome è in `kebab-case`**
   (`nav-row-actions.ts`, `users-grid-query.ts`, `sidebar-presentation.ts`).

Nomi riservati dal framework invariati, sia nel nome sia nell'estensione: `page.tsx`,
`layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`, `not-found.tsx`, `template.tsx`,
`default.tsx`, `middleware.ts`. Questa è l'unica eccezione reale alla regola `.tsx`-solo-con-JSX
di sopra: `app/(protected)/(admin)/layout.tsx` non contiene JSX, ma rinominarlo `layout.ts`
allontanerebbe il file dalla convenzione Next che ogni lettore si aspetta, per un guadagno nullo.

**Il `camelCase` nei nomi di file non esiste.** Non appartiene a nessuna delle due regole:
un file che non esporta un componente va in `kebab-case`.

Nessuna cartella mescola le due strategie. `lib/` e `types/` sono di fatto tutti `kebab-case`,
perché non esportano mai un componente. `app/` segue la stessa regola 2 di sopra, non
un'eccezione a parte: dove un file esporta un componente il nome lo rispecchia in `PascalCase`
(le form colocate come `RegisterForm.tsx`, `app/Providers.tsx`), altrove è `kebab-case`. Non è
un elenco chiuso di casi — è la regola generale, applicata a una cartella dove capitano entrambi.

Sottocomponenti privati: un file può contenere piccoli sottocomponenti che appartengono solo
al suo componente pubblico (`Sidebar.tsx` → `TruncatedSpan`, `L1Item`, `SubItem`). Si estraggono
quando vengono riusati o acquistano senso da soli. **Mai definire un componente dentro il corpo
di un altro componente.**

### Dove va un file nuovo

| Cartella | Contenuto | Nomi |
|---|---|---|
| `components/ui/` | solo primitive shadcn — quello che scrive `npx shadcn add` — e nient'altro | `kebab-case` |
| `components/grid/` | il modulo data-grid | componenti `PascalCase`, helper `kebab-case` |
| `components/shared/` | elementi genuinamente riusabili tra feature (`AccessibleDialog`, `ConfirmModal`, `LoadingStatus`, `PageContainer`, `IconRenderer`) | `PascalCase` |
| `components/` (radice) | componenti di pagina e di guscio (`Sidebar`, `Layout`, le form) | `PascalCase` |
| `components/i18n/`, `components/rbac/` | cartelle di feature | regola 2 di sopra |
| `guards/` (radice del microservizio, **non** sotto `components/`) | guardie che camminano il sorgente (`app/`, `components/`) da fuori | `kebab-case` |

Il principio, non solo l'elenco: `components/ui/` è solo-fornitore perché è l'indirizzo dove
scrive `npx shadcn add` (`components.json` → `aliases.ui`) — tenerci solo quello rende
applicabile la regola già scritta in `../../../CLAUDE.md` (ogni componente shadcn va riletto
prima di essere accettato) e i diff dei prossimi `shadcn add` restano leggibili.
`components/shared/` si popola per principio — un elemento ci va perché è genuinamente
riusabile — non per residuo di ciò che è uscito da `ui/`. `guards/` sta alla radice del
microservizio, non sotto `components/`, perché una guardia non è un componente e non deve
condividere una cartella solo-fornitore: `npx shadcn add` scriverebbe sopra di lei.

Per un file che non rientra ovviamente in una casella: è pagina o guscio → radice di
`components/`; è una primitiva di libreria → non esiste questo caso, quelle vengono solo da
`shadcn add`; è usato da più di una feature → `shared/`. Se nessuna risposta convince ancora,
resta dov'è finché un secondo consumatore non prova che è condiviso — spostarlo prima è una
previsione, non un fatto.

## Test

- I test stanno accanto all'implementazione: `nav-row-actions.test.ts`.
- Suffisso `.test.ts(x)`, **non** `.spec`. È il default di vitest e `vitest.config.ts` ci si aggancia.
- I test che toccano un database reale sono `*.integration.test.ts`: esclusi dal run normale,
  attivati da `npm run test:integration`. È la corsia lenta del progetto.
- Esportare un helper puro per testarlo direttamente è **legittimo e preferito** al testarlo
  attraverso cinque strati di interfaccia.

## Nomi dei simboli

- Componenti, classi, context, tipi, enum: `PascalCase`. Hook: `usePascalCase`.
- Variabili, parametri, funzioni, proprietà: `camelCase`.
- `UPPER_SNAKE_CASE` **solo** per letterali immutabili di modulo e configurazione fissa
  (`FETCH_TIMEOUT_MS`, `GRID_BLOCK_SIZE`, `PLACEHOLDER_RE`). Non tutti i `const` vanno in
  maiuscolo: varianti, factory, context e componenti mantengono il casing semantico
  (`buttonVariants`, `appGridTheme`, `UserContext`).
- Callback prop `onX` (`onChange`, `onOpenChange`). Handler locali `handleX` (`handleSubmit`).
  Setter di stato con la convenzione React (`setOpen`).
- **Acronimi: `Dto`, `Id`, `Url`, `Api`, `Svg`** — casing di parola, coerente in tutto il codice.
  Non `DTO`, non `URL` dentro un identificatore composto.
- Nessun prefisso `A`/`I` su classi astratte e interfacce.

**Booleani** — comunicano un predicato (`isLoading`, `hasPermission`, `canSubmit`,
`shouldRefresh`), con tre eccezioni che **non** si rinominano:

- idioma React/DOM: `open`, `disabled`, `loading`, `collapsed`, `expanded`, `visible`;
- nomi che rispecchiano una colonna del database o un alias SQL (`authorized`, `allowed`):
  il contratto è esterno, il nome lo segue;
- proprietà il cui oggetto contenitore porta già il predicato: `rowActions()` che ritorna
  `{ add, edit, remove }` si legge `actions.add`, e va bene così.

Applica questa regola dove il nome si legge da solo, non meccanicamente.

## Tipi

**`interface` per le forme oggetto e le props. `type` per ciò che `interface` non sa esprimere**:
unioni di letterali, `z.infer`, `Pick`/`Omit`/`Record`, tipi funzione.

È la separazione idiomatica standard e il codice la segue già. La guida esterna chiedeva
`type` anche per le props: **respinta**, vedi sotto.

Props semplici: tipizzale inline quando sono due o tre campi.

```tsx
export function UserAvatar({ name, src }: { name: string; src?: string }) {
```

## Import ed export

- `'use client'` / `'use server'` **prima** degli import.
- `import type` per le dipendenze di solo tipo.
- Gruppi di import, in quest'ordine — imposto da `import-x/order`, con autofix (`import-x` e
  non `import`: la copia di `eslint-plugin-import` che `eslint-config-next` spedisce non
  conosce l'interfaccia v3 del resolver TypeScript installato, vedi `eslint.config.mjs`):
  1. React e framework (`react`, `next/*`, `next-auth`)
  2. pacchetti esterni
  3. alias interni (`@/`)
  4. relativi (`./`, `../`)
- Alias `@/` per gli import fra feature. Relativi solo dentro lo stesso modulo locale.
  Mai `../..`.
- **Export nominati** per componenti, hook, utility e tipi. `export default` **solo** dove il
  framework lo impone (`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`).
  Il motivo non è l'ordine: le porte di qualità di questo progetto — `raw-color-ratchet`,
  `token-vocabulary`, `icon-only-button-accessible-name` — leggono il sorgente per nome di
  simbolo. L'export default permette a ogni import di rinominare il simbolo a piacere e
  costringe quei controlli ad arrampicarsi sugli alias.
- Nessun barrel (`index.ts`) e nessun wrapper che non aggiunga un confine reale.

## Livelli

`lib/` non importa da `components/`. Se un helper in `lib/` ha bisogno di una costante di
presentazione, quella costante sta nel posto sbagliato.

---

## Linee guida esterne respinte, con motivo

Non riaprirle senza un motivo nuovo.

| Regola esterna | Perché no |
|---|---|
| Test con suffisso `.spec` | 87 file da rinominare per zero beneficio. `.test` è il default di vitest e la configurazione ci si aggancia già. |
| `type` invece di `interface` per props e forme dati | Il codice segue già la separazione idiomatica `interface`=forma / `type`=unione o derivazione. La guida vuole *una* regola, non *quella*: convertire 118 dichiarazioni renderebbe il codice meno espressivo. |
| Non esportare helper usati solo dai test | Ha ragione in astratto e torto sul compromesso: testare una funzione pura direttamente batte testarla attraverso l'interfaccia. |
| Aggiungere un formatter (Prettier) | Lo stile manuale è già uniforme su virgolette e punto e virgola. L'unica cosa che cedeva era l'ordine degli import, che `import-x/order` risolve da solo. Prettier costerebbe la riformattazione di 20.000 righe per recuperare un file. |
| Rinominare tutti i file di componente in `kebab-case` | 62 rinomine per estetica. La regola dell'export principale ottiene cartelle coerenti a un trentesimo del costo. |

---

## Come si fanno rispettare

Ogni convenzione qui sopra deve avere una delle due:

- una regola ESLint (`import-x/order`, `import-x/no-default-export` su `components/**`), oppure
- un cricchetto `node --test` in `sources/devops/`, agganciato a `.github/workflows/quality.yml`.

Il secondo passo è quello che si dimentica: `npm run test:tokens` è rimasto per settimane in
`package.json`, scritto e verde in locale, senza essere agganciato a `quality.yml` — quindi non
proteggeva niente in CI nonostante sembrasse un cricchetto attivo. Questo lavoro lo ha aggiunto
al workflow. Quando aggiungi un nuovo cricchetto, aggiungilo anche lì, nello stesso commit: è il
passo che si scorda, non quello dopo.
