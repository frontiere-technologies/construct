# Uniformare le convenzioni React/TypeScript di web-construct

Data: 2026-08-26
Stato: **implementata.** Piano di esecuzione in
[docs/superpowers/plans/2026-08-26-react-naming-conventions.md](../plans/2026-08-26-react-naming-conventions.md);
consegnata nelle pull request impilate #69 e #70, CI verde su entrambe.

## Sommario

La verifica del 2026-08-26 ([docs/reviews/2026-08-26-verify-naming-conventions-react.md](../../reviews/2026-08-26-verify-naming-conventions-react.md))
ha misurato `sources/microservices/web-construct` contro una guida di convenzioni React/TypeScript
presa da un progetto esterno. Il codice è risultato solido sul piano meccanico — zero `any`,
zero `console.*`, zero barrel, `import type` sistematico, alias `@/` disciplinato, lint e
typecheck puliti, 634 test verdi — e incoerente su nomi e forma.

Cinque linee guida esterne sono state **respinte con motivo**; le altre sono state adottate e
scritte in [sources/microservices/web-construct/AGENTS.md](../../../sources/microservices/web-construct/AGENTS.md),
con un `CLAUDE.md` accanto che lo importa. Questo lavoro non decide più nulla sulle regole:
le rende vere nel codice e le mette sotto guardia automatica.

Portata: **36 file spostati o rinominati**, circa 40 file di import da aggiornare, due
accoppiamenti per percorso da riparare, due regole ESLint nuove, una guardia nuova, una
cartella nuova. In due pull request.

### Le tre decisioni prese in fase di progetto

1. **`components/ui/` diventa solo-fornitore.** Oggi contiene tre cose diverse: 5 file di
   primitive shadcn, 14 file di un modulo data-grid e 3 componenti propri del progetto. Il
   modulo data-grid esce in `components/grid/`, i componenti riusabili in `components/shared/`.
   Motivo: `components.json` dichiara già `aliases.ui = "@/components/ui"`, cioè quella cartella
   *è* l'indirizzo dove scrive `npx shadcn add`. Renderla solo-fornitore rende applicabile la
   regola già scritta in `CLAUDE.md` — ogni componente importato va riletto prima di accettarlo —
   e tiene i diff dei prossimi `shadcn add` leggibili.
2. **`components/shared/` si popola per principio, non per residuo.** Contiene i cinque elementi
   genuinamente riusabili, compresi `PageContainer` e `IconRenderer` che oggi stanno alla radice.
   Se prendesse solo i tre che escono da `ui/`, la cartella non otterrebbe la distinzione per cui
   è stata creata.
3. **Le guardie sul sorgente vivono in `guards/`.** Le quattro che oggi stanno in `components/ui/`
   non sono test di componente: camminano tutto `app/` e `components/`. In una cartella
   solo-fornitore non possono restare — `npx shadcn add` scrive lì.

## Struttura di arrivo

| Cartella | Contenuto | Convenzione sui nomi |
|---|---|---|
| `components/ui/` | solo primitive shadcn: `button`, `button.types`, `input`, `select`, `textarea` + test | `kebab-case` |
| `components/grid/` | il modulo data-grid, 14 file | componenti `PascalCase`, helper `kebab-case` |
| `components/shared/` | `AccessibleDialog`, `ConfirmModal`, `LoadingStatus`, `PageContainer`, `IconRenderer` | `PascalCase` |
| `components/` radice | componenti di pagina e di guscio: `Home`, `Login`, `Layout`, `Sidebar`, `AdminTheme`, le form | `PascalCase` |
| `components/i18n/`, `components/rbac/` | invariate nella struttura; 6 file `camelCase` → `kebab-case` | |
| `guards/` (nuova, accanto ad `app/`) | 4 guardie esistenti + `file-naming.test.ts` | `kebab-case` |

## Inventario dei file

### Da `components/ui/` (30 file) verso quattro destinazioni

**Restano in `components/ui/` — 7 file, zero rinomine** (già tutti in minuscolo):
`button.tsx`, `button.types.tsx`, `button.test.tsx`, `input.tsx`, `input.test.tsx`,
`select.tsx`, `textarea.tsx`.

**Vanno in `components/grid/` — 14 file:**

| Da | A |
|---|---|
| `ColumnVisibilityToggle.tsx` | `components/grid/ColumnVisibilityToggle.tsx` |
| `DataGrid.tsx` | `components/grid/DataGrid.tsx` |
| `GridToolbar.tsx` | `components/grid/GridToolbar.tsx` |
| `GridToolbar.test.tsx` | `components/grid/GridToolbar.test.tsx` |
| `dataGridConfig.ts` | `components/grid/data-grid-config.ts` |
| `dataGridConfig.test.ts` | `components/grid/data-grid-config.test.ts` |
| `gridColumnFilters.ts` | `components/grid/grid-column-filters.ts` |
| `gridColumnFilters.test.ts` | `components/grid/grid-column-filters.test.ts` |
| `gridColumnSizing.ts` | `components/grid/grid-column-sizing.ts` |
| `gridColumnSizing.test.ts` | `components/grid/grid-column-sizing.test.ts` |
| `grid-reset.ts` | `components/grid/grid-reset.ts` |
| `grid-reset.test.ts` | `components/grid/grid-reset.test.ts` |
| `grid-url-sync.ts` | `components/grid/grid-url-sync.ts` |
| `grid-url-sync.test.ts` | `components/grid/grid-url-sync.test.ts` |

**Vanno in `components/shared/` — 5 file da `ui/` più 2 dalla radice:**
`AccessibleDialog.tsx`, `AccessibleDialog.test.tsx`, `ConfirmModal.tsx`, `LoadingStatus.tsx`,
`LoadingStatus.test.tsx`, più `components/PageContainer.tsx` e `components/IconRenderer.tsx`.
Nessuna rinomina: sono già in `PascalCase`.

**Vanno in `guards/` — 4 file, tutti rinominati in `kebab-case`:**

| Da | A |
|---|---|
| `buttonInteractionStyles.test.ts` | `guards/button-interaction-styles.test.ts` |
| `disabledButtonHoverStyles.test.ts` | `guards/disabled-button-hover-styles.test.ts` |
| `iconOnlyButtonAccessibleName.test.ts` | `guards/icon-only-button-accessible-name.test.ts` |
| `dialogConsumers.test.ts` | `guards/dialog-consumers.test.ts` |

7 + 14 + 5 + 4 = 30. Nessun file di `components/ui/` resta senza destinazione.

### Rinomine fuori da `components/ui/` — 11 file

**Gli 8 `camelCase` → `kebab-case`** (nessuno esporta un componente: le corrispondenze
`[A-Z]` trovate in verifica erano costanti `UPPER_SNAKE`):

| Da | A |
|---|---|
| `components/sidebarPresentation.ts` | `components/sidebar-presentation.ts` |
| `components/sidebarPresentation.test.ts` | `components/sidebar-presentation.test.ts` |
| `components/i18n/languages/languagesDatasource.ts` | `.../languages-datasource.ts` |
| `components/i18n/translations/translationsDatasource.ts` | `.../translations-datasource.ts` |
| `components/i18n/translations/translationStatusFilter.ts` | `.../translation-status-filter.ts` |
| `components/i18n/translations/translationStatusFilter.test.ts` | `.../translation-status-filter.test.ts` |
| `components/rbac/roles/rolesDatasource.ts` | `.../roles-datasource.ts` |
| `components/rbac/users/usersDatasource.ts` | `.../users-datasource.ts` |

**Le 2 estensioni**: `components/AppHydrationMarker.tsx` → `.ts` (esporta un componente che
ritorna `null`, senza JSX: il nome resta `PascalCase`, cambia solo l'estensione) e
`components/rbac/NavigationTree.test.tsx` → `.test.ts` (verifica solo `typeIcon()`).

**`app/providers.tsx` → `app/Providers.tsx`**: esporta il componente `Providers`, quindi il nome
lo rispecchia. È l'**unica rinomina di solo maiuscolo/minuscolo** del lavoro: su APFS, che non
distingue le maiuscole, `git mv` in un passo non registra nulla e serve il passaggio per un nome
temporaneo.

## Regole ESLint

La sonda del 2026-08-26, eseguita col plugin `import` che next spedisce, ha verificato che `import/order` e `import/no-default-export` rilevano
esattamente le violazioni attese (44 errori di ordinamento auto-correggibili, `Prefer named
exports` su `DataGrid`), ma ha scoperto un conflitto latente: la copia di `eslint-plugin-import`
spedita da `eslint-config-next` è la 2.32, **non conosce `import/resolver-next`** (nessuna
occorrenza nel suo `lib/`), mentre `eslint-import-resolver-typescript` installato è la 3.10.1 e
espone l'interfaccia v3. Il risultato è un `Resolve error: typescript with invalid interface
loaded as resolver` per ogni file — 149 in tutto. Non si vede oggi solo perché nessuna regola
`import/*` è accesa. Tentativi già esclusi: sovrascrivere `settings['import/resolver']` non
funziona, perché ESLint fonde `settings` in profondità e l'entrata `typescript` sopravvive anche
impostandola a `false`.

**Soluzione**: `eslint-plugin-import-x` come `devDependency` esplicita, con
`createTypeScriptImportResolver` via `resolver-next`. Chiude il conflitto di interfaccia e
smette di dipendere da un pacchetto transitivo — che era comunque da sistemare.

**Gruppi di import** (`import-x/order`): framework (`react`, `next/*`, `next-auth`) → pacchetti
esterni → alias `@/` → relativi. Senza righe vuote fra i gruppi, per non riformattare 250 file.

**Export nominati** (`import-x/no-default-export`, solo su `components/**`): i **6 che si
spostano comunque** — `DataGrid`, `GridToolbar`, `ColumnVisibilityToggle`, `AccessibleDialog`,
`ConfirmModal`, `LoadingStatus` — diventano nominati nello stesso commit dello spostamento,
perché i loro import si toccano già. I **27 fermi** vanno in un blocco `files:` che disattiva la
regola per loro e che si accorcia col tempo. Proprietà voluta: se domani uno di quei 27 viene
rinominato, la sua riga non combacia più e ESLint inizia a pretendere l'export nominato — che è
il comportamento giusto, perché quel file è stato toccato. La regola **non** si applica ad `app/**`,
dove Next impone `export default` per `page`, `layout`, `route`, `error` e `loading`.

## La guardia nuova

`guards/file-naming.test.ts` controlla tre cose, scelte perché hanno zero falsi positivi:

1. nessun nome di file in `camelCase`, in nessuna cartella;
2. `components/ui/**` interamente in `kebab-case`;
3. un file `.tsx` che non contiene JSX è un errore (JSX dentro una template string come fixture
   di test non conta: quei file restano `.ts`).

**Esenzione temporanea, dichiarata nel file della guardia.** In PR-A la guardia esenta
`components/ui/**`, perché quella cartella contiene ancora i 10 nomi `camelCase` che solo PR-B
sistema: senza l'esenzione `npm test` sarebbe rosso su una PR già fusa. L'esenzione è una riga
commentata col suo motivo e la sua data di scadenza (il compito B-5, che la rimuove). È lo stesso
modello della lista che si accorcia usato per gli export default e per `raw-color-baseline.json`:
la CI resta verde in ogni momento, e il metodo "prima la guardia" resta intatto — la guardia
nasce comunque rossa sugli 8 nomi fuori da `ui/` e sulle 2 estensioni, che è ciò che PR-A corregge.

**Fuori portata di proposito**: una guardia sugli acronimi (`Dto` contro `DTO`). Richiederebbe una
lista di eccezioni per `useUI` e `toJSON`, e i trasgressori su 20.304 righe erano *uno*. La
correzione una volta sola più la riga in AGENTS.md bastano. Se ricapita, si aggiunge allora.

## Accoppiamenti per percorso da riparare

Sono due, ed è l'elenco completo — ricavato scandendo tutti i percorsi fissi nei test e nei
cricchetti:

1. `sources/devops/raw-color-baseline.json` indicizza per percorso di file. Dei 10 file tracciati,
   uno solo si muove: `components/ui/AccessibleDialog.tsx = 1`. La chiave va aggiornata **nello
   stesso commit** dello spostamento, o il cricchetto vede un file nuovo con 1 colore grezzo
   sopra una soglia assente e la CI diventa rossa.
2. `guards/dialog-consumers.test.ts` legge `components/ui/ConfirmModal.tsx` per percorso fisso.

Gli altri 11 percorsi fissi nei test (`FilterDrawer`, `ManageRolesModal`, `IconPicker`,
`LanguageFormModal`, `CreateTranslationKeyModal`, `TranslationEditorDrawer`, `CreateRoleModal`,
`RenameRoleModal`, `RoleMultiSelect`, `UIContext`, `app/globals.css`) citano file che non si
muovono. I due cricchetti di stile — `raw-color-ratchet` e `token-vocabulary` — camminano le
cartelle e sono insensibili alle rinomine. Gli e2e in Python non sono accoppiati ai nomi dei
sorgenti: l'unico riferimento è `types/menu.ts`, che cambia solo i punti e virgola.

## Documenti

I ~20 file in `docs/` che citano i nomi vecchi sono piani e specifiche datati: **archivio storico,
non si toccano.** Riscrivere un piano di luglio per farlo combaciare col codice di agosto cancella
il racconto di cosa è stato fatto allora. Si aggiornano solo i documenti vivi:
`docs/leftovers/2026-08-25-shadcn-migration-leftovers.md` e le caselle in
`docs/reviews/2026-08-26-verify-naming-conventions-react.md`.

## Metodo

Per ogni convenzione: **prima la guardia, che deve fallire elencando i trasgressori; poi la
correzione, fino al verde.** È il modo in cui questo progetto ha già trattato i colori grezzi e il
vocabolario dei token. Se la guardia si scrive dopo le rinomine, l'unica prova che funziona è che
non si lamenta — e quella non è una prova.

## PR-A — meccanica

- [✅] ID=A-1, Complexity=Medium, Priority=P0, Title=Configurazione ESLint provata su un file, Fix description=Aggiungere `eslint-plugin-import-x` e `eslint-import-resolver-typescript` come devDependency esplicite; configurare `import-x/order` con `createTypeScriptImportResolver` via `resolver-next`; dimostrare su `components/ui/DataGrid.tsx` e `lib/rbac/users-service.ts` che le violazioni di ordinamento sono rilevate e che non compare nessun `Resolve error`, prima di lanciare l'autofix su tutto.
- [✅] ID=A-2, Complexity=Low, Priority=P0, Title=Guardia sui nomi dei file scritta e rossa, Fix description=Creare `guards/file-naming.test.ts` con i tre controlli (nessun `camelCase`, `components/ui/**` in kebab, `.tsx` solo con JSX); aggiungere `guards/**/*.test.ts` a `vitest.config.ts`; esentare `components/ui/**` con una riga commentata che ne dichiara il motivo e la scadenza (compito B-5); verificare che elenchi i trasgressori attesi — gli 8 nomi `camelCase` fuori da `ui/` e le 2 estensioni — prima di correggerne uno.
- [✅] ID=A-3, Complexity=Low, Priority=P1, Title=Ordinamento degli import applicato, Fix description=Lanciare `eslint --fix` per `import-x/order` sui 26 file interessati; verificare che `npm run lint`, `npm run typecheck` e `npm test` restino verdi.
- [✅] ID=A-4, Complexity=Low, Priority=P1, Title=UserDTO diventa UserDto, Fix description=Rinominare il tipo su tutti i 27 usi, allineandolo ai sette `*Dto` già presenti; nessun altro acronimo va toccato.
- [✅] ID=A-5, Complexity=Low, Priority=P2, Title=Punti e virgola di types/menu.ts, Fix description=Togliere i punti e virgola dalle 49 righe di `types/menu.ts` e dalla riga isolata in `components/rbac/functionalities/TranslationsAccordion.test.tsx:8`, allineandoli al resto del codice.
- [✅] ID=A-6, Complexity=Low, Priority=P2, Title=Le due estensioni sbagliate, Fix description=`components/AppHydrationMarker.tsx` → `.ts` e `components/rbac/NavigationTree.test.tsx` → `.test.ts`; aggiornare gli import e verificare che vitest raccolga ancora entrambi i test.
- [✅] ID=A-7, Complexity=Medium, Priority=P1, Title=Gli otto nomi camelCase fuori da ui/, Fix description=Rinominare in `kebab-case` gli 8 file elencati nell'inventario e aggiornare i loro import; a fine compito `guards/file-naming.test.ts` deve essere verde per la parte fuori da `components/ui/`.

## PR-B — strutturale

- [✅] ID=B-1, Complexity=Medium, Priority=P0, Title=Estrazione di components/grid/, Fix description=Spostare i 14 file del modulo data-grid, rinominando in `kebab-case` i 6 helper `camelCase`; aggiornare i circa 14 file che li importano; convertire `DataGrid`, `GridToolbar` e `ColumnVisibilityToggle` a export nominati nello stesso commit.
- [✅] ID=B-2, Complexity=Medium, Priority=P0, Title=Creazione di components/shared/, Fix description=Spostare `AccessibleDialog`, `ConfirmModal`, `LoadingStatus` da `components/ui/` e `PageContainer`, `IconRenderer` dalla radice; aggiornare i circa 25 file che li importano; convertire `AccessibleDialog`, `ConfirmModal` e `LoadingStatus` a export nominati.
- [✅] ID=B-3, Complexity=Low, Priority=P0, Title=Riparare i due accoppiamenti per percorso, Fix description=Aggiornare la chiave `components/ui/AccessibleDialog.tsx` in `sources/devops/raw-color-baseline.json` e il percorso di `ConfirmModal` in `dialog-consumers.test.ts`; ciascuno nello stesso commit dello spostamento che lo causa. Verificare con `npm run test:raw-colors`.
- [✅] ID=B-4, Complexity=Low, Priority=P1, Title=Le quattro guardie in guards/, Fix description=Spostare e rinominare in `kebab-case` le quattro guardie da `components/ui/`, senza riscritture: restano TypeScript sotto vitest. Verificare che continuino a trovare ciò che trovavano (i percorsi che leggono sono relativi a `process.cwd()`, non alla loro posizione).
- [✅] ID=B-5, Complexity=Low, Priority=P1, Title=components/ui/ resta solo-fornitore, Fix description=Verificare che in `components/ui/` restino esattamente i 7 file delle primitive shadcn; **rimuovere l'esenzione `components/ui/**` da `guards/file-naming.test.ts`** e verificare che sia verde su tutti e tre i controlli senza esenzioni residue.
- [✅] ID=B-6, Complexity=Medium, Priority=P1, Title=Export nominati con lista che si accorcia, Fix description=Accendere `import-x/no-default-export` su `components/**` con un blocco `files:` che elenca i 27 file rimasti con export default; la regola non si applica ad `app/**`. Commentare nel file di configurazione perché la lista esiste e che è fatta per accorciarsi.
- [✅] ID=B-7, Complexity=Low, Priority=P2, Title=app/providers.tsx diventa Providers.tsx, Fix description=Rinomina di solo maiuscolo: usare `git mv` in due passi attraverso un nome temporaneo, perché su APFS in un passo Git non registra il cambiamento. Aggiornare i 2 import (`app/layout.tsx` e `components/AppHydrationMarker.test.tsx`).
- [✅] ID=B-8, Complexity=Low, Priority=P0, Title=test:tokens agganciato a quality.yml, Fix description=Aggiungere `npm run test:tokens` a `.github/workflows/quality.yml`: lo script esiste in `package.json` dal 2026-08-24 ma non è mai stato messo in CI, quindi il cricchetto del vocabolario dei token oggi non protegge niente.
- [✅] ID=B-9, Complexity=Low, Priority=P2, Title=Aggiornare i documenti vivi, Fix description=Aggiornare `docs/leftovers/2026-08-25-shadcn-migration-leftovers.md` e spuntare le voci in `docs/reviews/2026-08-26-verify-naming-conventions-react.md`. I piani e le specifiche datati non si toccano: sono archivio.

## Come si sa che è finito

Su entrambe le PR, in questo ordine:

```
npm run lint          # nessun errore import-x/order né no-default-export
npm run typecheck     # nessun percorso rotto dalle rinomine
npm test              # 634 test più le guardie, tutti verdi
npm run test:raw-colors
npm run test:tokens
```

E i due controlli che le rinomine potrebbero rompere in silenzio:

- `npm run test:raw-colors` deve restare verde **senza** rilanciare
  `UPDATE_RAW_COLOR_BASELINE=1`: se serve rigenerare il baseline, significa che una chiave è
  stata dimenticata invece di aggiornata.
- `git log --follow` su due file spostati deve mostrare la storia precedente, prova che gli
  spostamenti sono passati da `git mv` e non da cancella-e-ricrea.

## Linee guida esterne respinte

Registrate in [AGENTS.md](../../../sources/microservices/web-construct/AGENTS.md) con il motivo,
per non riaprirle: test con suffisso `.spec` (87 file per zero beneficio), `type` invece di
`interface` per le props (il codice segue già la separazione idiomatica `interface`=forma /
`type`=unione o derivazione), divieto di esportare helper usati solo dai test (testare una
funzione pura direttamente batte testarla attraverso l'interfaccia), aggiungere Prettier
(riformatterebbe 20.000 righe per recuperare un file), rinominare tutti i file di componente in
`kebab-case` (62 rinomine per estetica).
