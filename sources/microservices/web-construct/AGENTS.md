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
- Virgolette singole. Nessun punto e virgola a fine riga.
  L'unico punto in cui un separatore serve davvero e' una riga che apre con `(` o `[` subito
  dopo un'espressione: senza separatore il parser la legge come una chiamata o un indice sul
  risultato della riga precedente. Non si risolve tenendosi il punto e virgola: si sposta la
  riga in questione sotto un `import` o una dichiarazione, dove il pericolo non esiste.
  `components/AppHydrationMarker.test.tsx` e
  `components/rbac/functionalities/TranslationsAccordion.test.tsx` hanno entrambi quella forma.
- **Niente `console.*`.** Il logging passa da `lib/logger.ts` (pino).
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

Nomi riservati dal framework invariati: `page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`,
`loading.tsx`, `not-found.tsx`, `middleware.ts`.

**Il `camelCase` nei nomi di file non esiste.** Non appartiene a nessuna delle due regole:
un file che non esporta un componente va in `kebab-case`.

Nessuna cartella mescola le due strategie. `lib/`, `types/` e `app/` sono di fatto tutti
`kebab-case`, perché non esportano componenti — tranne i form colocati in `app/`, che sono
componenti e quindi restano in `PascalCase`.

Sottocomponenti privati: un file può contenere piccoli sottocomponenti che appartengono solo
al suo componente pubblico (`Sidebar.tsx` → `TruncatedSpan`, `L1Item`, `SubItem`). Si estraggono
quando vengono riusati o acquistano senso da soli. **Mai definire un componente dentro il corpo
di un altro componente.**

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
- Gruppi di import, in quest'ordine — imposto da `import/order`, con autofix:
  1. React e framework (`react`, `next/*`, `next-auth`)
  2. pacchetti esterni
  3. alias interni (`@/`)
  4. relativi (`./`, `../`)
- Alias `@/` per gli import fra feature. Relativi solo dentro lo stesso modulo locale.
  Mai `../..`.
- **Export nominati** per componenti, hook, utility e tipi. `export default` **solo** dove il
  framework lo impone (`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`).
  Il motivo non è l'ordine: le porte di qualità di questo progetto — `raw-color-ratchet`,
  `token-vocabulary`, `iconOnlyButtonAccessibleName` — leggono il sorgente per nome di
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
| Aggiungere un formatter (Prettier) | Lo stile manuale è già uniforme su virgolette e punto e virgola. L'unica cosa che cedeva era l'ordine degli import, che `import/order` risolve da solo. Prettier costerebbe la riformattazione di 20.000 righe per recuperare un file. |
| Rinominare tutti i file di componente in `kebab-case` | 62 rinomine per estetica. La regola dell'export principale ottiene cartelle coerenti a un trentesimo del costo. |

---

## Come si fanno rispettare

Ogni convenzione qui sopra deve avere una delle due:

- una regola ESLint (`import/order`, `import/no-default-export` su `components/**`), oppure
- un cricchetto `node --test` in `sources/devops/`, agganciato a `.github/workflows/quality.yml`.

Il secondo passo è quello che si dimentica: `npm run test:tokens` esiste in `package.json`
ma **non** è in `quality.yml`, quindi oggi non protegge niente. Quando aggiungi un cricchetto,
aggiungilo anche al workflow.
