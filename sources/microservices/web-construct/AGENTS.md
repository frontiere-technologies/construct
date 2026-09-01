# AGENTS.md — web-construct

Convenzioni React/TypeScript di questo microservizio. Leggi anche `../../../AGENTS.md`
(comandi, stack, decisione shadcn) e `../../../README.md`.

La sezione finale elenca le convenzioni diffuse che qui sono **respinte, con il motivo**,
così nessuno — persona o agente — rifà l'analisi da zero.

Il principio: **si automatizza ciò che si rompe in silenzio, si lascia alla revisione ciò che si
vede nel diff.** Un import di solo tipo da `lib/` a `components/`, un `console.log`, un colore
salvato sotto la soglia di contrasto: nessuno li nota rileggendo un diff, e senza un cricchetto in
CI sono desideri. Un barrel, un file battezzato male, un booleano dal nome fiacco: quelli si
vedono, e pretendere un cricchetto per ognuno costa più di quanto renda.

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
  produzione). Fuori da questi confini `console.*` non esiste, e non è solo un auspicio:
  `no-console` è `error` in tutto il progetto e la deroga per `warn`/`error` è dichiarata in
  `eslint.config.mjs` per quei due file soltanto. Un terzo confine va aggiunto là per esistere.
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

   Di questa regola `guards/file-naming.test.ts` difende la parte decidibile: nessun nome in
   `camelCase`, e un gambo in `PascalCase` deve corrispondere a un simbolo **dichiarato** nel
   file. Che quel simbolo sia davvero un componente o un context lo guarda la revisione: un
   file in `PascalCase` che dichiara una classe o un helper — e che quindi andrebbe in
   `kebab-case` — passa il controllo e resta sbagliato.

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
| `components/ui/` | le primitive di questo progetto, di forma shadcn: quello che scrive `npx shadcn add`, e quello che è stato scritto a mano allo stesso contratto. Più i loro test e le loro fixture di tipo, e nient'altro | `kebab-case` |
| `components/grid/` | il modulo data-grid | componenti `PascalCase`, helper `kebab-case` |
| `components/shared/` | elementi genuinamente riusabili tra feature (`AccessibleDialog`, `ConfirmModal`, `LoadingStatus`, `PageContainer`, `IconRenderer`) | `PascalCase` |
| `components/` (radice) | componenti di pagina e di guscio (`Sidebar`, `Layout`, le form), e gli helper puri che appartengono a uno solo di essi (`sidebar-presentation.ts`) | componenti `PascalCase`, helper `kebab-case` |
| `components/i18n/`, `components/rbac/` | cartelle di feature | regola 2 di sopra |
| `guards/` (radice del microservizio, **non** sotto `components/`) | guardie che camminano il sorgente (`app/`, `components/`) da fuori | `kebab-case` |

Il principio, non solo l'elenco: `components/ui/` è l'indirizzo dove scrive `npx shadcn add`
(`components.json` → `aliases.ui`), e tenerci **solo primitive** — non guardie, non componenti di
feature — è ciò che rende leggibili i diff dei prossimi `shadcn add` e applicabile la regola già
scritta in `../../../AGENTS.md` (ogni componente shadcn va riletto prima di essere accettato).

Il criterio è *primitiva*, non *provenienza*, e conviene dirlo perché oggi nessuno dei quattro
file viene dal fornitore così com'è: `button.tsx` è una riscrittura che elenca in testa tre punti
in cui diverge di proposito dallo stock (nessun `disabled:pointer-events-none`, nessun
`disabled:opacity-*`, ogni hover scritto `[&:not(:disabled)]:hover:`), tutti e tre difesi da una
guardia; `input.tsx` e `textarea.tsx` sono scritti a mano attorno a `inputBaseClasses`. Adattare è
previsto — è la regola del documento padre. Quello che non è previsto è che qui finisca qualcosa
che non è una primitiva.

Per sapere *cosa* il fornitore ha cambiato da quando una primitiva è stata copiata:
`npm run shadcn:drift` (con `--diff` per il dettaglio riga per riga). Legge il registry pubblico
e confronta. Sta in `sources/devops/shadcn-drift.mjs` e **non** è agganciato a `quality.yml`,
di proposito: pretendere fedeltà allo stock in CI vorrebbe dire disfare le divergenze qui sopra.
Si lancia a mano prima di aggiornare React, Radix o Tailwind, o prima di riprendere una primitiva
con `npx shadcn add`.

E c'è una regola in più che vale solo per questa cartella: **non occupare un nome dello stock con
semantica diversa.** Un `Select` in `components/ui/` significa, per chiunque conosca shadcn, il
listbox di Radix con `SelectTrigger`/`SelectContent`/`SelectItem`. Qui è esistito per due giorni
come `<select>` nativo, senza un solo consumatore applicativo, ed è stato rimosso il 2026-08-27:
un nome dello stock preso in prestito per un'altra cosa costa una collisione al prossimo
`shadcn add` e un'aspettativa sbagliata a ogni lettura. Se serve un `<select>` nativo vestito,
si chiama `NativeSelect`.

I test e le fixture di tipo di una primitiva stanno qui, con lei: `button.test.tsx`,
`input.test.tsx`, `button.types.tsx`. È la regola «i test stanno accanto all'implementazione»
applicata a questa cartella come a ogni altra, e vince sul «nient'altro» — che parla di
componenti, non della coda di file che ogni componente si porta dietro.

`components/shared/` si popola per principio — un elemento ci va perché è genuinamente
riusabile — non per residuo di ciò che è uscito da `ui/`. `guards/` sta alla radice del
microservizio, non sotto `components/`, perché una guardia non è un componente e non deve
stare all'indirizzo su cui scrive `npx shadcn add`: passerebbe sopra di lei.

Per un file che non rientra ovviamente in una casella: è pagina o guscio → radice di
`components/`; è una primitiva senza dominio, cioè un campo o un bottone o un contenitore
vestito e basta → `ui/`, che venga da `shadcn add` o dalle tue mani; è usato da più di una
feature → `shared/`. Se nessuna risposta convince ancora, resta dov'è finché un secondo
consumatore non prova che è condiviso — spostarlo prima è una previsione, non un fatto.

## Test

- I test stanno accanto all'implementazione: `nav-row-actions.test.ts`.
- Suffisso `.test.ts(x)`, **non** `.spec`. Non è una preferenza estetica: l'`include` di
  `vitest.config.ts` nomina `.test`, quindi un file `.spec` non fallirebbe — sparirebbe, senza
  che niente lo dica. Lo stesso vale per un test scritto in una cartella che l'`include` non
  copre, ed è già successo: fino al 2026-08-27 la lista lasciava fuori `app/`, `context/` e ogni
  `*.test.tsx` non sotto `components/`. Oggi l'`include` è un glob solo sulle radici sorgente al
  completo, e `sources/devops/test-collection.test.mjs` verifica — chiedendolo a `vitest list`,
  non leggendo la configurazione — che ogni `*.test.*` su disco sia davvero raccolto.
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
  (`buttonVariants`, `appGridTheme`, `UIContext`).
- Callback prop `onX` (`onChange`, `onOpenChange`). Handler locali `handleX` (`handleSubmit`).
  `guards/handler-naming.test.ts` rifiuta una *dichiarazione* chiamata `onX` in `app/`,
  `components/` e `context/`; il nome della prop non è una dichiarazione e resta `onX`. Fuori
  perimetro c'è `lib/`, dove `onWhite` e `onDark` di `lib/theme-vars.ts` non sono handler ma
  rapporti di contrasto.
  Setter di stato con la convenzione React (`setOpen`).
- **Acronimi: `Dto`, `Id`, `Url`, `Api`, `Svg`** — casing di parola, coerente in tutto il codice.
  `guards/acronym-casing.test.ts` li controlla sulle **dichiarazioni**, dove non serve nessuna
  deroga; sugli usi no, perché là gli stessi caratteri sono globali (`URLSearchParams`) e
  variabili d'ambiente (`DATABASE_URL`), entrambi legittimi.
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

È la separazione idiomatica standard, e il codice la segue. La variante che usa `type` anche
per le props è **respinta**, vedi sotto.

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
- Alias `@/` per ogni import che esca dalla cartella del file. **Non si risale mai**, nemmeno
  di un livello: `./` per i fratelli, `@/` per tutto il resto. `no-restricted-imports` in
  `eslint.config.mjs` vieta i pattern `../*` e `../**` — è più semplice del vecchio «mai
  `../..`» e ha lo stesso effetto, perché nell'albero non c'era altro che un `../`.
- **Export nominati** per componenti, hook, utility e tipi. `export default` **solo** dove il
  framework lo impone (`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `loading.tsx`).
  Il motivo non è l'ordine: le porte di qualità di questo progetto — `raw-color-ratchet`,
  `token-vocabulary`, `icon-only-button-accessible-name` — leggono il sorgente per nome di
  simbolo. L'export default permette a ogni import di rinominare il simbolo a piacere e
  costringe quei controlli ad arrampicarsi sugli alias.

  La regola vale per il codice nuovo; sul codice esistente è un debito dichiarato. **24 file
  sotto `components/` usano ancora `export default`** e sono elencati per nome in
  `eslint.config.mjs`, dove `import-x/no-default-export` è spento apposta per loro. Quella lista
  è fatta per accorciarsi: quando ne converti uno, cancella la sua riga, e aggiorna questo
  numero. Il meccanismo si difende anche da solo — rinominare un file senza convertirlo fa
  saltare la corrispondenza ed ESLint ricomincia a pretendere l'export nominato.
- Nessun barrel (`index.ts`) e nessun wrapper che non aggiunga un confine reale.

## Livelli

`lib/` non importa da `components/`. Se un helper in `lib/` ha bisogno di una costante di
presentazione, quella costante sta nel posto sbagliato.

---

## Convenzioni respinte, con il motivo

Non riaprirle senza un motivo nuovo.

| Regola | Perché no |
|---|---|
| Test con suffisso `.spec` | 88 file da rinominare per zero beneficio, e `.test` è il suffisso su cui l'`include` di `vitest.config.ts` è già puntato — un `.spec` non verrebbe eseguito da nessuno. |
| `type` invece di `interface` per props e forme dati | Il codice segue la separazione idiomatica `interface`=forma / `type`=unione o derivazione. Avere *una* regola sola non vale *quella* regola: convertire 118 dichiarazioni renderebbe il codice meno espressivo. |
| Non esportare helper usati solo dai test | Ha ragione in astratto e torto sul compromesso: testare una funzione pura direttamente batte testarla attraverso l'interfaccia. |
| Aggiungere un formatter (Prettier) | Lo stile manuale è uniforme su virgolette e punto e virgola. L'unica cosa che non lo è da sola è l'ordine degli import, che `import-x/order` risolve. Prettier costerebbe la riformattazione di 20.000 righe per recuperare un file. |
| Rinominare tutti i file di componente in `kebab-case` | 62 rinomine per estetica. La regola dell'export principale ottiene cartelle coerenti a un trentesimo del costo. |

---

## Come si fanno rispettare

Ogni convenzione qui sopra che si può rompere in silenzio deve avere una delle tre:

- una regola ESLint (`import-x/order`, `import-x/no-default-export` su `components/**`);
- una guardia vitest in `guards/`, alla radice del microservizio — è dove stanno oggi
  `file-naming`, `acronym-casing`, `handler-naming`, `button-interaction-styles`,
  `disabled-button-hover-styles`, `dialog-consumers`, `icon-only-button-accessible-name`.
  Girano dentro `npm test`, quindi in CI ci arrivano da sole;
- un cricchetto `node --test` in `sources/devops/`, agganciato a mano a
  `.github/workflows/quality.yml`.

Per le altre la revisione basta. Non è un permesso di lasciar perdere: è il criterio per decidere
quali difese valgono il codice che costano, e si applica quando si aggiunge una regola qui, non
dopo.

**Quale delle ultime due** dipende da una domanda sola: la guardia sorveglia qualcosa da cui
dipende la propria esecuzione? Se sì, non può stare in `guards/`. Il caso che ha insegnato la
regola è `test-collection`: scritto prima come guardia vitest, e inutile lì, perché la stessa
modifica che restringe l'`include` di `vitest.config.ts` smette di raccogliere anche la guardia —
verificato, non dedotto. Sta in `sources/devops/`, dove `node --test` la esegue comunque.
Stessa logica per un controllo sulla configurazione di vitest, su `package.json` o su ESLint.

L'aggancio è il passo che si dimentica: un cricchetto scritto e verde in locale, ma non
agganciato a `quality.yml`, non protegge niente in CI pur sembrando attivo. Quando ne aggiungi
uno, aggancialo al workflow nello stesso commit: è il passo che si scorda, non quello dopo. Una
guardia in `guards/` non ha questo problema — ma ha l'altro, quello del paragrafo qui sopra.
