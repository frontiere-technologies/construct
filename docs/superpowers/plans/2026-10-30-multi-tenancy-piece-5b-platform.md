# Pezzo 5b della multi-tenancy: piano di realizzazione

> **Per chi esegue:** usare `superpowers:subagent-driven-development` oppure `superpowers:executing-plans`, secondo il metodo scelto dal proprietario. Leggere prima anche la specifica. Le caselle si spuntano con `- [✅]` soltanto dopo la relativa verifica.

**Obiettivo:** completare concessioni, limiti, modalità singola, esportazione, ripristino e cancellazione di un tenant senza indebolire l'isolamento o alterare identità condivise.

**Architettura:** catalogo stabile di capacità e configurazione di piattaforma per tenant; autorizzazione effettiva accorpata alle letture attuali e vincoli del database su assegnazioni e quote. Esportazione autenticata dall'app, ripristino dal comando operativo e cancellazione atomica dalla console, con registri espliciti delle tabelle gestite. Si mantiene Drizzle/Postgres e si separano connessione ordinaria, piattaforma e operatore.

**Tecnologie:** TypeScript, React 19, Next.js 16.4.2, Auth.js v5, Drizzle/Postgres, Zod, componenti e token shadcn, Vitest, pytest/Playwright tramite `uv`.

**Specifica:** [2026-10-29-multi-tenancy-piece-5b-platform-design.md](../specs/2026-10-29-multi-tenancy-piece-5b-platform-design.md), rivista e approvata dal proprietario il 2026-10-30. Piano approvato con scelta degli agenti e revisione per attività il 2026-10-30.

## Sommario e ordine

T01–T06 realizzano catalogo, menu, autorizzazione, gestione e limiti. T07 realizza la modalità singola. T08 collega i controlli alle schermate. T09–T12 completano consenso ed esportazione, ripristino ed eliminazione; dipendono dai dati e dai vincoli dei primi task. T13 chiude verifiche, guida e rilascio. Un solo piano mantiene coerenti le interfacce condivise; ogni task termina con un risultato verificabile e un commit locale.

Stato al 2026-11-02: T01–T09 realizzati e approvati con revisione indipendente; prossimoT10, T10–T13 aperti. Lo sviluppo resta alla 0063 e non è stato attivato il 5b. Le sole attività davvero completate e verificate sono spuntate sotto; i criteri complessivi della specifica rimangono aperti fino alle prove finali.

## Vincoli globali

Preferenza esplicita del proprietario aggiornata il 4 novembre: tutti i prossimi agenti, implementatori e revisori, usano GPT-6.1 con ragionamento Alto (gpt-6.1-sol/high). L'indicazione vale anche per riesami e revisioni complessive.

RLS forzata, chiavi composte, contesto di tenant locale alla transazione, funzioni `security invoker`, connessione di piattaforma separata e registro nella transazione della modifica sono vincoli di ogni task. Nessuna policy per persona, nessuna funzione `security definer`, nessun privilegio di operatore nel processo web.

La disabilitazione conserva le assegnazioni; la cancellazione delle assegnazioni è distinta. Le eccezioni esplicite prevalgono sull'area. Il limite di piattaforma si applica anche ad amministratore e assistenza. Il nucleo essenziale rimane disponibile con i suoi normali controlli di ruolo e stato.

Quote iniziali `null`, nessuna quota aggiuntiva; zero impedisce nuove risorse. Persone = tutte le appartenenze, ruoli = tutti inclusi quelli di sistema, menu = tutte le voci incluse categorie. Ridurre sotto l'uso non elimina dati. Timeout positivo o ereditato, mai meno severo del limite della connessione e mai persistente nel pool.

Esportazione: JSON versione 1, massimo **50 MiB non compressi = 52 428 800 byte**, massimo **60 000 ms totali**, oltre al timeout per query se più severo. Nessun file parziale o persistente sul server. Piattaforma solo con consenso di esportazione esplicito e assistenza valida; vecchi consensi non bastano. Modello non esportabile dall'app. Ripristino solo in un nuovo tenant sospeso, senza importare credenziali o privilegi globali. Eliminazione solo dalla piattaforma, tenant archiviato, slug confermato, `default` e modello protetti; resta soltanto evento, data, id amministratore e id tecnico del tenant.

Nessun intervento sul database di sviluppo, compresa lettura, senza un nuovo sì esplicito ogni volta. Nessun invio del ramo, richiesta di unione o unione senza OK separato. Integrazione e browser in sequenza, mai insieme; browser con `uv run pytest`. Non scrivere credenziali; non usare `git stash`; non includere `docs/input-specs/rbac-improvements/`; conservare le modifiche del proprietario a `sources/devops/db/operator.env.example`.

Prima del codice leggere le guide pertinenti della versione installata di Next in `node_modules/next/dist/docs/`. Tutto il codice applicativo nuovo è TypeScript, nomi secondo `AGENTS.md`, nessun `any` o indebolimento dei tipi. Non aggiungere dipendenze se quelle attuali bastano. Migrazioni in avanti, successive alla 0063, schema generato da file e mai corretto a mano.
Le chiavi di traduzione delle nuove etichette entrano nella nuova migrazione del task che introduce la schermata, per tutte le lingue di base già supportate; non si modifica una migrazione già verificata e salvata.

## Casi da sorvegliare nella revisione

| ID | Condizione reale | Comportamento atteso e task che lo prova |
|---|---|---|
| RF-1 | Consenso revocato mentre si prepara un file con fotografia stabile | La verifica aggiornata prima della risposta impedisce la consegna; T09, T10 |
| RF-2 | Menu copiato con id diversi, URL assoluti equivalenti o categorie spostate | La capacità reale rimane identica; nessun alias riapre una funzione sospesa; T03, T04 |
| RF-3 | Più richieste sull'ultimo posto o una transazione con fotografia vecchia | Una sola creazione riesce; nessun conteggio vecchio consente di superare la quota; T06 |
| RF-4 | Account appartenente a due tenant, eventi storici e token globali | Ripristino/eliminazione modificano soltanto il tenant, non credenziali o altri accessi; T11, T12 |
| RF-5 | Versioni vecchie dell'app e token di un'altra modalità ancora presenti | Nessuna concessione modificabile prima dell'aggiornamento completo; modalità singola senza nuove appartenenze; T05, T07, T13 |

## Convenzioni del piano e struttura dei file

`W` nelle sezioni seguenti significa `sources/microservices/web-construct/`; `D` significa `sources/devops/db/`. Espandere questi prefissi quando si eseguono comandi o si aprono file. Le indicazioni C/M/T significano creare/modificare/testare; sono inventari di file, non caselle già completate.

| Responsabilità | File principali nuovi | File esistenti da estendere |
|---|---|---|
| Catalogo e valutazione pura | `W/lib/tenancy/feature-catalog.ts`, `tenant-policy-types.ts`, `tenant-policy.ts` | Catalogo permessi e relative guardie |
| Configurazione e letture | `W/lib/tenancy/tenant-policy-service.ts`, `tenant-policy-lock.ts` | `lib/db/schema.ts`, autorizzazione e supporto |
| Menu e capacità | `W/lib/rbac/menu-feature-binding.ts` | Righe menu, azioni, menu laterale, pagina incorporata |
| Gestione della piattaforma | `W/lib/platform/tenant-policy-actions.ts`, `tenant-policy-schemas.ts` | Scheda tenant e registri |
| Quote e tempo delle query | `W/lib/tenancy/tenant-limits.ts` | Porte del database, servizi di creazione e copia |
| Modalità dell'installazione | `W/lib/tenancy/tenancy-mode.ts` | Token, host, selezione, guardie e navigazione |
| Schermate | `W/components/platform/TenantPolicyEditor.tsx`, `TenantGrantPurgeDialog.tsx` | Editor di ruoli/menu e impostazioni |
| Consenso all'esportazione | Estensione di `W/lib/tenancy/support-consent*.ts` | Impostazioni e letture della piattaforma |
| Formato ed esportazione | `W/lib/tenancy/tenant-archive-contract.json`, `tenant-archive-types.ts`, `tenant-archive-schema.ts`, `tenant-export-service.ts`, `tenant-export-access.ts` | Nuova rotta e pulsante nelle impostazioni |
| Ripristino operativo | `D/tenant-archive.mjs` | `db.mjs` e migrazione dedicata |
| Cancellazione | `W/lib/platform/tenant-delete-actions.ts`, `W/components/platform/TenantDeleteDialog.tsx` | Registri e scheda tenant |
| Verifica aggiornamento | `D/verify-tenant-upgrade.mjs` | Configurazione CI e guida operativa |

I file `.test.ts(x)` stanno accanto al codice. Quelli che usano Postgres sono `.integration.test.ts`; gli script operativi hanno test `.test.mjs`. Ogni task aggiorna i soli documenti e test che gli competono.

### Interfacce comuni da fissare in T01

```ts
// W/lib/tenancy/tenant-policy-types.ts
interface TenantLimits {
  queryTimeoutMs: number | null
  maxMembers: number | null
  maxRoles: number | null
  maxMenuEntries: number | null
}
interface TenantPolicySnapshot {
  revision: number
  areas: Record<AreaKey, boolean>
  overrides: Partial<Record<FeatureKey, boolean>>
  limits: TenantLimits
  enabledFeatures: FeatureKey[]
}
interface TenantPolicyDraft {
  expectedRevision: number
  areas: Record<AreaKey, boolean>
  overrides: Partial<Record<FeatureKey, boolean>>
  limits: TenantLimits
}
```

`AreaKey` = `people | roles | navigation | appearance | catalogs | tenant-settings`. `FeatureKey` comprende i codici attivi di queste aree, `use-custom-content`, `manage-tenant-theme`, e le capacità essenziali `core-app`, `read-tenant-audit`, `manage-support-consent`, `export-tenant-data`. L'accesso/profilo/preferenze/scelta restano dichiarazioni essenziali delle porte attuali; `core-app` identifica i loro eventuali collegamenti nel menu. Nessuna area modificabile contiene queste ultime capacità.
I due tipi delle chiavi sono esportati da `feature-catalog.ts`; `tenant-policy-types.ts` li importa soltanto come tipi, evitando dipendenze circolari.

I codici inutilizzati non acquistano nuove porte: `manage-permissions`, `manage-languages`, `edit-translations`, `manage-translation-keys` sono dichiarati inutilizzati nell'inventario, separati dalle funzioni concedibili. I normali dizionari e la scelta della lingua non dipendono dalla concessione delle pagine amministrative dei cataloghi.

## Task 1 — T01 — Catalogo stabile e regole pure

- [✅] ID=MT5B-T01, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Catalogo e precedenza, Fix description=Definire chiavi, dipendenze e calcolo delle capacità senza database; copre MT5B-OK-1.

**File:** C `W/lib/tenancy/{feature-catalog,tenant-policy-types,tenant-policy}.ts`; T `W/lib/tenancy/tenant-policy.test.ts`, `W/guards/feature-catalog.test.ts`.

**Interfacce:** produce i tipi comuni; `evaluateTenantFeatures(areas: Record<AreaKey, boolean>, overrides: Partial<Record<FeatureKey, boolean>>): ReadonlySet<FeatureKey>`; `findMissingDependencies(features: ReadonlySet<FeatureKey>): FeatureKey[]`; `featureForPermission(code: PermissionCode): FeatureKey | null`. Il catalogo contiene chiave, area o nucleo essenziale, permesso individuale eventuale e dipendenze. Esportare `FEATURE_CATALOG`, `AREA_KEYS`, `FEATURE_KEYS` come letterali immutabili.

- [✅] T01.0 Prima dell'esecuzione applicare `using-git-worktrees`: controllare gli allegati della chat, riusare un isolamento adatto o crearne uno gestito a partire dal `development` locale con questi documenti, ramo `feature/multi-tenancy-piece-5b`. Usare esplicitamente il percorso restituito. Conservare nel checkout originale file del proprietario e stash. Per le verifiche riusare le variabili del database usa e getta già configurate, senza riscrivere credenziali o introdurre quelle dell'operatore nel processo web.
- [✅] T01.1 Scrivere i test prima del valutatore. La tabella di precedenza comprende tutte le sei combinazioni area/eccezione e le chiavi sconosciute sono rifiutate dai validatori; le capacità essenziali restano presenti. Test esatto di dipendenza:

```ts
it('does not silently grant the read capability required by an invitation', () => {
  const features = evaluateTenantFeatures(allAreasDisabled, { 'invite-users': true })
  expect(features.has('read-users')).toBe(false)
  expect(findMissingDependencies(features)).toContain('read-users')
})
```

`allAreasDisabled` è una costante di test costruita da `AREA_KEYS`, non una configurazione applicativa nuova. Dipendenze: invito/status/assegnazione ruoli → `read-users`; gestione/concessione ruoli → `read-roles`; modifica menu → `read-menu`. La concessione di ruoli a utenti richiede anche la consultazione dei ruoli. Le dipendenze sono transitive e il catalogo non può avere cicli.

- [✅] T01.2 Eseguire `npm test -- lib/tenancy/tenant-policy.test.ts guards/feature-catalog.test.ts` da W: deve fallire perché il valutatore non esiste, non per errore di raccolta.
- [✅] T01.3 Implementare le interfacce sopra; la guardia confronta permessi realmente dichiarati dalle porte e inventario, accettando soltanto le esclusioni inutilizzate nominate. Nessuna funzione sconosciuta è concessa per difetto.
- [✅] T01.4 Ripetere lo stesso comando: tutti i casi passano; eseguire `npm run typecheck`.
- [✅] T01.5 Rileggere il cambiamento e creare commit locale `feat(tenancy): define platform feature catalog`; includere soltanto i file del task.

## Task 2 — T02 — Configurazione persistente e copia iniziale

- [✅] ID=MT5B-T02, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Configurazione protetta per tenant, Fix description=Persistenza con RLS, impostazioni iniziali compatibili e copia dal modello; copre MT5B-OK-1 e OK-7.

**File:** C `D/migrations/0064_tenant_feature_policy.sql`, `W/lib/tenancy/tenant-policy-service.ts`, `tenant-policy-lock.ts`, `policy-test-fixture.ts`; M `W/lib/db/schema.ts`, `W/lib/db/testing.ts`, `W/lib/schema-contract.integration.test.ts`, `D/db.mjs`, snapshot `D/schema.sql`; T `W/lib/tenancy/tenant-policy-schema.integration.test.ts`, `tenant-policy-service.integration.test.ts`, `tenant-template.integration.test.ts`.

**Dati:** cataloghi globali in sola lettura `feature_area`, `app_feature`, `app_feature_dependency`; configurazione per tenant `tenant_platform_policy` (revision bigint inizialmente 1 e quattro limiti), `tenant_area_entitlement` (area, enabled), `tenant_entitlement` (feature, allowed; riga assente = eredita). Configurazioni leggibili ma non modificabili da `construct_runtime`; indice/chiave iniziale `id_tenant`, riferimenti al catalogo e RLS forzata. Nessun catalogo modificabile dalla schermata.

**Interfacce:** consuma T01; produce `selectTenantPolicy(tx: TenantTx | PlatformTx): Promise<TenantPolicySnapshot>`, `readTenantPolicy(tenantId: TenantId): Promise<TenantPolicySnapshot>`, `lockTenantPolicy(tx: TenantTx | PlatformTx): Promise<void>` e SQL `app_private.effective_tenant_feature_codes() returns table(code text)`. `lock_tenant_policy()` SQL prende il blocco transazionale del tenant corrente; usare una chiave dedicata a partire dal suo id, senza conversioni a intero a 32 bit.

Per i test produce `createPolicyFixture(label: string): Promise<PolicyFixture>`: tenant copiato dal modello, `tenantId`, `slug`, `adminId`, `memberId`, `platformAdminId`, `roleId`, `menuEntryId`, `close(): Promise<void>`. Account sintetici senza credenziali, sessioni sostituite ai soli confini Next come nei test 5a; pulizia solo degli id creati. Non esportare questo helper nel codice applicativo.

- [✅] T02.1 Scrivere test che confrontano cataloghi SQL e T01, tentano modifiche di policy come runtime e verificano il rifiuto, leggono A senza vedere B e verificano area iniziale accesa/limiti nulli. Test copia: modificare il modello, creare A, cambiare il modello ancora; A conserva la fotografia iniziale. Aggiornare l'elenco delle tabelle note nei test del modello.

```ts
it('preserves current access when creating the initial policy', async () => {
  const fixture = await createPolicyFixture('initial')
  try {
    const policy = await readTenantPolicy(fixture.tenantId)
    expect(Object.values(policy.areas)).toEqual(AREA_KEYS.map(() => true))
    expect(policy.limits).toEqual({ queryTimeoutMs: null, maxMembers: null, maxRoles: null, maxMenuEntries: null })
  } finally { await fixture.close() }
})
```
- [✅] T02.2 Con solo database usa e getta eseguire `npm run test:integration:local -- lib/tenancy/tenant-policy-schema.integration.test.ts lib/tenancy/tenant-policy-service.integration.test.ts lib/tenancy/tenant-template.integration.test.ts`: fallimento atteso per schema mancante.
- [✅] T02.3 Implementare migrazione, modelli Drizzle, servizi e helper. Aggiornare `copy_tenant` nella nuova migrazione e i percorsi di creazione; nessun tenant esistente si sincronizza con il modello. Introdurre il blocco comune prima dei blocchi già esistenti. Esplicitare l'ordine: policy del tenant → riga tenant quando necessaria → blocchi esistenti di membri/menu/ruoli. Aggiornare anche le funzioni SQL che li prendono in ordine diverso. Non serializzare le letture ordinarie.
Tutte le funzioni SQL nuove hanno `security invoker set search_path = ''`, riferimenti qualificati e `EXECUTE` tolto a PUBLIC e concesso soltanto ai ruoli necessari. Dopo `protect_tenant_table` si tolgono esplicitamente le scritture runtime sulle tre configurazioni. `effective_tenant_feature_codes()` valida anche le dipendenze come T01.
- [✅] T02.4 Applicare solo alla prova con `node sources/devops/db/db.mjs test-apply` dalla radice, rigenerare lo snapshot dai file tramite `schema-write` (non apre connessioni), ripetere i test mirati e `schema-check`. Aggiornare contestualmente le sonde di `boundary-check` per queste tabelle/permessi, senza eseguirlo sullo sviluppo.
- [✅] T02.5 Commit locale `feat(tenancy): persist protected tenant policies`; registrare la migrazione 0064 senza modificare 0001–0063.


**Precisazioni del coordinatore prima dell’esecuzione di T02 (registro, decisioni 3–6):** SQL e servizio restituiscono soltanto capacità con dipendenze effettive; il valutatore puro T01 resta grezzo per la validazione della bozza. Il tipo della transazione di piattaforma è espresso tramite l’equivalente strutturale PlatformAuditTx già esistente, con prova di tipo nel modulo lib/platform consentito; la guardia platform-boundary non si indebolisce. Il nuovo fixture è aggiunto come percorso test-only nominato alla guardia tenant-boundary, con prove detector. Il vecchio blocco globale del menu viene sostituito dal blocco comune per tenant, non mantenuto; anche helper/test di navigazione interessati entrano nel perimetro T02.

## Task 3 — T03 — Associazione del menu alle capacità reali

- [✅] ID=MT5B-T03, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Menu senza aggiramenti, Fix description=Classificare pagine e contenuti propri con chiavi stabili, preservando il menu esistente; copre RF-2 e MT5B-OK-1/2.

**File:** C `D/migrations/0065_menu_feature_binding.sql`, `W/lib/rbac/menu-feature-binding.ts`; M `W/lib/db/schema.ts`, `W/lib/rbac/{types,nav-row-mapper,sidebar-adapter,navigation-service,navigation-actions,action-input-schemas}.ts`, `W/app/(protected)/embedded/[itemId]/page.tsx`; T `W/lib/rbac/menu-feature-binding.test.ts`, `menu-feature-binding.integration.test.ts`, test esistenti delle azioni/menu laterale.

**Interfacce:** `MenuFeatureBinding { areaKey: AreaKey | null; featureKey: FeatureKey | null }`; `bindMenuTarget(input: { link: string | null; functionalityType: number | null; areaKey: AreaKey | null }, appOrigin: string): MenuFeatureBinding`; `canUseMenuEntry(policy: TenantPolicySnapshot, binding: MenuFeatureBinding): boolean`. Aggiungere `area_key` e `feature_key` al menu; categorie neutre ammesse. La nuova associazione usa percorsi canonici, non nomi o id copiati.

Decisione di esecuzione T03 (registro, Ruling 8): l'origine fidata è quella di `AUTH_URL` o `NEXTAUTH_URL`, passata come contesto locale alla transazione alle scritture di menu, alla creazione dei tenant e al migratore; non si duplica la configurazione in una tabella, non si aggiunge una query a ogni `withTenant`. Per classificare un URL assoluto serve l'origine; in sua assenza l'operazione fallisce con errore leggibile. Anche la copia trasporta e rivalida l'associazione, senza un percorso che salti il controllo. Sono quindi ammessi file aggiuntivi circoscritti: helper dell'origine, `D/db.mjs`, moduli/test del migratore, `W/lib/platform/tenant-actions.ts`, guardia dell'inventario delle pagine e documentazione dell'origine pubblica nel rilascio. Il percorso generico esistente è la pagina `[...slug]`, non un solo prefisso; una pagina reale nuova deve essere catalogata esplicitamente. I tipi storici 4 e 5 conservano il comportamento attuale e vengono classificati in base alla destinazione, senza introdurre funzioni nuove.

Decisione di esecuzione T03 (registro, Ruling 9): la coerenza dell'associazione nel database non richiede che un'area storica sia accesa. La nuova scelta esplicita dell'area è verificata dal server sotto il blocco comune nella transazione che scrive; spostamento e copia conservano le associazioni sospese senza abilitarle. Questo evita un percorso SQL che salti la validazione e mantiene distinta la presenza del dato dal diritto di usarlo. Le nuove assegnazioni SQL vengono limitate da T04.

Correzione di revisione T03 (registro, Ruling 11–12): la destinazione canonica separata è il solo indirizzo effettivamente aperto; il link originale resta conservato. Il server usa URL nativo, SQL valida/classifica il canonico senza ricostruire WHATWG/IDNA; il migratore prepara la mappa tecnica completa nella medesima transazione per preservare anche URL storici Unicode/non canonici prima utilizzabili. Normalizzatore sorgente TypeScript condiviso e artefatto .mjs generato per la CLI, con controllo di allineamento; nessuna nuova dipendenza o loader. Sono ammessi i relativi nuovi file di generazione/verifica e gli aggiornamenti dei consumatori, compresa la pagina incorporata, oltre alla nuova colonna/copia/schema. I relativi restano relativi alla radice e i protocolli mantengono il comportamento precedente del menu. La copia e in seguito archivio/ripristino coprono anche questo dato; nessuna bonifica manuale obbligatoria o modifica del link originale.

- [✅] T03.1 Scrivere test di alias: `/user-management`, stesso URL assoluto sull'origine configurata, parametro/frammento o barra finale continuano a richiedere `read-users`. Un collegamento esterno/pagina incorporata richiede `use-custom-content`; non si può spacciare una pagina interna per esterna. Una voce nella copia ha un id diverso ma la stessa capacità; una categoria neutra Amministrazione può contenere aree diverse.

```ts
it('binds absolute aliases to the original internal capability', () => {
  const binding = bindMenuTarget({ link: 'https://construct.example.test/user-management/?sort=name#grid', functionalityType: 2, areaKey: 'people' }, 'https://construct.example.test')
  expect(binding).toEqual({ areaKey: 'people', featureKey: 'read-users' })
})
```
- [✅] T03.2 Eseguire `npm test -- lib/rbac/menu-feature-binding.test.ts` e poi il test d'integrazione mirato, in sequenza: falliscono per associazione mancante.
- [✅] T03.3 Implementare normalizzazione con `URL`, origine fidata dell'installazione e tabella esplicita delle rotte. Per pagine interne sconosciute usare l'attuale pagina iniziale essenziale soltanto se il percorso è davvero la pagina generica esistente; una futura porta protetta nuova richiede catalogazione. Validare sul server e nel database che tipo/URL/feature siano coerenti. La migrazione classifica contenuti propri in Navigazione e non li sposta. Le voci interne mantengono l'area della capacità; i contenuti propri possono avere un'altra area di presentazione solo se accesa. Se la capacità è consentita come eccezione nella sua stessa area, l'area spenta non annulla l'eccezione. Cambiare padre non riscrive l'associazione.
Associare la pagina condivisa `/admin/tenant-settings` a `manage-support-consent` essenziale: la sezione registrazione autonoma resta controllata separatamente. Aggiornare la copia SQL affinché trasporti `area_key`/`feature_key` senza dedurli dagli id nuovi.
- [✅] T03.4 Ripetere unità e integrazione mirate: passano anche spostamento, duplicazione, cambio URL, voci immutabili e categorie senza figli. Non cambiare i controlli sugli indirizzi delle pagine incorporate già presenti.
- [✅] T03.5 Commit locale `feat(navigation): bind menu entries to tenant features` e nuovo snapshot generato.

## Task 4 — T04 — Autorizzazione effettiva e blocco SQL delle nuove assegnazioni

- [✅] ID=MT5B-T04, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Concessioni applicate a ogni porta, Fix description=Intersezione prima delle scorciatoie amministrative e vincoli SQL con sospensione reversibile; copre MT5B-OK-1/2.

**File:** C `D/migrations/0066_tenant_grant_guards.sql`, `W/lib/tenancy/tenant-feature-access.ts`; M `W/lib/rbac/{actor,auth-roles,auth-guard,grant-guards,grant-service,roles-actions,users-actions,navigation-actions}.ts`, `W/lib/tenancy/{support-consent,tenant-settings-actions}.ts`, `W/lib/theme-actions.ts`, `W/app/(protected)/(admin)/admin/theme/page.tsx`, `W/guards/permission-declared.test.ts`, test dei viaggi al database; T `W/lib/tenancy/tenant-feature-enforcement.integration.test.ts`, test esistenti attore/guardie e fra tenant.

**Interfacce:** `AuthorizationSnapshot` e `SupportAccess` ricevono `enabledFeatures: FeatureKey[]` nella stessa istruzione. `Actor` riceve `features: ReadonlySet<FeatureKey>` e `canManageSupportConsent: boolean`, calcolato dai permessi originari (o amministratore), prima dell'intersezione, e falso in assistenza. `permissions` rimane l'insieme effettivo. `requireAdministratorFeature(feature: FeatureKey): Promise<Actor>` e `requireAdministratorFeaturePage(feature: FeatureKey): Promise<Actor>`; `requireSupportConsentManager(): Promise<Actor>` richiede il flag dedicato e rifiuta `support`. Per leggere la pagina comune usare `requireTenantSettingsPage(): Promise<Actor>`, che accetta anche l'amministratore in assistenza valido senza permettergli di modificare il consenso. Non introdurre una guardia pubblica generica che ignori le concessioni.

`TenantGrantContext { policy: TenantPolicySnapshot; menuBindings: ReadonlyMap<number, MenuFeatureBinding> }` è costruito dentro la transazione dai servizi. Aggiungere questo argomento obbligatorio a `canGrantFunctionality`, `assertCanGrantFunctionalities`, `assertCanChangeRoles`, `canChangeRole`; gli altri argomenti mantengono ordine e tipo esistenti. Nessun ripiego se manca una voce nell'associazione. `canGrantCode` usa `actor.features` prima del ramo amministratore; `grantableItemIds` e i caricamenti delle pagine chiamano le stesse regole, senza un secondo valutatore client.

Decisione di esecuzione T04 (registro, Ruling 13): distinguere il permesso essenziale `manage-support-consent` dal permesso opzionale `manage-tenant-settings`. Il solo flag prima dell'intersezione non conserva il consenso quando T05 cancella il grant condiviso. La 0066 aggiunge il nuovo permesso, collega la capacità essenziale e ne copia una volta le deleghe da tutte le assegnazioni attuali alle impostazioni, senza rimuovere/renominare il codice attuale o autorizzare nuove persone. Il flag usa poi il codice essenziale; nuovi grant alle impostazioni non implicano il consenso. Sono ammessi aggiornamenti ai due cataloghi TypeScript, relativi test e voce tradotta del nuovo permesso. Provare migrazione delle deleghe, gestione con area opzionale spenta, cancellazione della sola assegnazione opzionale e revoca distinta del consenso; amministratore e assistenza mantengono i vincoli. T05 e T08 rispettano la separazione. La specifica conserva così i diritti delle persone già autorizzate e l'essenzialità del consenso, evitando effetti collaterali del purge.


Decisione preliminare registrata: revocare ruoli/grant sospesi rimane possibile. Assegnare un ruolo esistente valuta i suoi diritti effettivi; le righe dormienti conservate nel ruolo non sono nuovi grant della funzione. Le nuove righe role_permission/role_functionality sulle capacità sospese restano vietate. Provare anche questi casi, senza un nuovo trigger di concessione sulle membership.

`withTenantFeature<T>(actor: Actor, feature: FeatureKey, fn: (tx: TenantTx) => Promise<T>): Promise<T>` in `tenant-feature-access.ts` apre la transazione, prende il blocco T02, rilegge la concessione e solo allora esegue la modifica. Tema, utenti, ruoli, menu e impostazioni ordinarie lo usano con la capacità dell'azione; i servizi interni ricevono la transazione esistente. I controlli individuali restano la prima guardia della porta. Le azioni essenziali non diventano dipendenti da un'area opzionale.

- [✅] T04.1 Scrivere test parametrizzati per persona, amministratore e assistenza: spegnere lettura utenti/tema blocca guardie e richieste dirette; cambiare concessione tra due richieste è immediato. La sospensione conserva righe, vieta nuove `role_permission`/`role_functionality` anche chiamando SQL, consente revoca e riattivazione. Gestire un consenso già assegnato resta possibile anche se l'area impostazioni è spenta.

Con sessione amministratore e area Aspetto spenta nel `beforeEach`:
```ts
it('does not let the tenant administrator bypass a disabled theme', async () => {
  await expect(requireAdministratorFeature('manage-tenant-theme')).rejects.toThrow('Unauthorized')
})
```
- [✅] T04.2 Eseguire unità attore/guardie e poi `npm run test:integration:local -- lib/tenancy/tenant-feature-enforcement.integration.test.ts lib/db/round-trip-budget.integration.test.ts`: falliscono sui casi nuovi.
- [✅] T04.3 Implementare letture accorpate e intersezione; mantenere distinti permessi e menu. Le guardie di concessione controllano prima la capacità del tenant e poi i diritti dell'attore. Gli aggiornamenti di ruoli rivalidano dentro la transazione che scrive e prendono il blocco T02. SQL invoker su inserimento/cambio della capacità verifica la concessione; revoche e aggiornamenti estranei restano possibili. Copia e ripristino storico owner-only possono ricostruire righe sospese durante la nascita del tenant, senza abilitarle: modalità SQL interna rifiutata al runtime, mai parametro del browser.
- [✅] T04.4 Ripetere i comandi. Aggiungere prova di gara tra sospensione e assegnazione e prova che il contesto interno di copia non apre un aggiramento al runtime. Gli attuali tetti dei viaggi per autorizzazione restano validi. Cataloghi globali e permessi di piattaforma non diventano permessi del tenant.
La gara comprende anche una modifica del tema già ammessa dalla guardia iniziale: se la sospensione è confermata prima della transazione di scrittura, nessuna riga viene modificata.
- [✅] T04.5 Commit locale `feat(auth): enforce tenant feature ceiling for all actors`.

## Task 5 — T05 — Modifica atomica della policy e cancellazione distinta delle assegnazioni

- [✅] ID=MT5B-T05, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Azioni della piattaforma verificabili, Fix description=Salvataggio con revisione, anteprima e cancellazione delle sole assegnazioni selezionate, registro atomico; copre MT5B-OK-1/2 e RF-5.

**File:** C `W/lib/platform/{tenant-policy-actions,tenant-policy-schemas}.ts`, `tenant-policy-actions.integration.test.ts`; M `W/lib/platform/tenant-service.ts`, `W/lib/audit/audit-types.ts`, `W/.env.template`, `sources/devops/k8s/base/configmap.yaml`, `sources/devops/env-contract.test.mjs`.

**Interfacce:** `saveTenantPolicy(tenantId: number, draft: TenantPolicyDraft): Promise<PolicyActionResult>`; `previewTenantGrantPurge(tenantId: number, keys: FeatureKey[]): Promise<PurgePreview>`; `purgeTenantGrants(tenantId: number, preview: PurgePreview): Promise<PolicyActionResult>`. Risultato unione `{ ok: true; revision: number } | { ok: false; reason: 'invalid' | 'conflict' | 'disabled' }`. `PurgePreview` contiene `revision`, `keys`, `roleCount`, `permissionGrantCount`, `menuGrantCount`, `fingerprint` (digest degli id delle assegnazioni selezionate). Tutti gli input sono Zod strict e la prima istruzione richiede amministratore di piattaforma.

- [✅] T05.1 Scrivere test: due amministratori salvano dalla stessa revisione, il secondo riceve `conflict`; dipendenze mancanti danno `invalid` senza cambiamenti; il fallimento del secondo registro annulla tutto. La pulizia ricalcola anteprima sotto blocco e rifiuta un'impronta vecchia. Non elimina menu/ruoli o assegnazioni di funzioni ancora concesse nascoste nella selezione.
Per Ruling 13, la pulizia di `manage-tenant-settings` non elimina né disattiva il permesso essenziale distinto `manage-support-consent`; provare che il delegato conservi la gestione del consenso dopo il purge opzionale. Non selezionare permessi essenziali tramite un'area opzionale o una vecchia associazione condivisa.

Con `fixture` T02, sessione piattaforma e scritture abilitate:
```ts
it('rejects a second save from the same revision', async () => {
  const previous = await readTenantPolicy(fixture.tenantId)
  const draft: TenantPolicyDraft = { expectedRevision: previous.revision, areas: previous.areas, overrides: previous.overrides, limits: previous.limits }
  expect((await saveTenantPolicy(fixture.tenantId, draft)).ok).toBe(true)
  expect(await saveTenantPolicy(fixture.tenantId, draft)).toEqual({ ok: false, reason: 'conflict' })
})
```
- [✅] T05.2 Eseguire il solo test d'integrazione del task: deve fallire sui nuovi comandi.
- [✅] T05.3 Implementare sotto `withPlatform`, contesto del tenant e blocco T02. Salvare aree, eccezioni, limiti e incremento della revisione nella stessa transazione. Registrare differenze strutturate nei due registri. Pulizia ammessa per le capacità sospese esplicitamente elencate; un'area si espande nelle sole capacità sospese. Un alias segue la capacità T03. Il digest stale non viene accettato soltanto perché i conteggi coincidono.
Decisione di esecuzione T05 (registro, Ruling 14): la selezione di area della schermata T08 si espande nelle sole chiavi di capacità sospese mostrate nel riepilogo; le azioni conservano la firma `FeatureKey[]`. Il server rivalida ogni chiave e rifiuta essenziali o capacità ancora concesse, ricalcolando l’anteprima sotto il blocco. Nessun nuovo input privilegiato di area o cancellazione implicita delle eccezioni. Per Ruling 15 il purge non inferisce categorie da un’area: `feature_key` nullo non corrisponde a una funzione selezionata; eventuali assegnazioni storiche di categoria restano fuori da questa pulizia. La porta canonica esistente rifiuta anche la loro revoca puntuale; T05 non introduce un percorso nuovo per le categorie. Limite registrato per il triage finale, senza promettere una revoca non presente.

- [✅] T05.4 Introdurre `CONSTRUCT_PLATFORM_POLICY_WRITES=0|1`, predefinito `0`: finché non vale `1`, salvataggi e pulizia sono chiusi con `disabled`. È il blocco di rilascio finché restano istanze vecchie; letture disponibili. Testarlo e documentarlo nel modello web e nel contratto delle variabili, senza modificare credenziali né cancellare modifiche del proprietario.
- [✅] T05.5 Ripetere integrazione mirata e `npm run test:env-contract`; poi commit locale `feat(platform): manage tenant policies and purge suspended grants`.

## Task 6 — T06 — Quote concorrenti e tempo delle query

- [✅] ID=MT5B-T06, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Limiti affidabili, Fix description=Conteggi esatti e protezioni SQL su tutti i percorsi; timeout locale alla transazione; copre MT5B-OK-3 e RF-3.

**File:** C `D/migrations/0067_tenant_resource_limits.sql`, `W/lib/tenancy/tenant-limits.ts`, relativi test unitari/d'integrazione; M `W/lib/db/tenant-db.ts`, `W/lib/rbac/{users-actions,roles-actions,navigation-actions}.ts`, `W/lib/tenancy/membership.ts`, percorsi SQL di copia/registrazione/creazione e `D/db.mjs`; T `W/lib/tenancy/tenant-limits-concurrency.integration.test.ts`, test delle porte/viaggi.

**Interfacce:** `TenantUsage { members: number; roles: number; menuEntries: number }`; `selectTenantUsage(tx: TenantTx | PlatformTx): Promise<TenantUsage>`; `effectiveQueryTimeoutMs(connectionLimitMs: number, tenantLimitMs: number | null): number`, con `0` del database = nessun limite preesistente. `withTenant` conserva firma e opzioni di transazione esistenti.

- [✅] T06.1 Scrivere unità: limite connessione 1000/tenant 2000 restituisce 1000; connessione 0/tenant 2000 restituisce 2000; tenant null conserva il valore. Scrivere integrazione per ultimo posto fra due richieste, quota nulla/zero, appartenenze disattivate contate, due ruoli di sistema e categorie contate, abbassamento sotto uso senza cancellazione, invito già membro senza consumo nuovo e copia del modello insufficiente interamente annullata.

```ts
it('never relaxes a stricter connection timeout', () => {
  expect(effectiveQueryTimeoutMs(1000, 2000)).toBe(1000)
  expect(effectiveQueryTimeoutMs(0, 2000)).toBe(2000)
  expect(effectiveQueryTimeoutMs(1000, null)).toBe(1000)
})
```
- [✅] T06.2 Eseguire test unitario e integrazione mirata in sequenza: i casi nuovi falliscono.
- [✅] T06.3 Implementare guardie SQL sulle tabelle contate e sui percorsi canonici sotto il blocco T02. Contare nello stesso ambito che inserisce. Per non usare una fotografia obsoleta dopo il blocco, le scritture runtime contate richiedono `READ COMMITTED`; rifiutare un isolamento diverso con errore specifico e test, invece di consentire una quota errata. Copia/ripristino atomici di un tenant nuovo validano anche l'uso finale. Il riordino del menu e la riattivazione di un membro non aumentano l'uso. Nomi degli errori SQL stabili `tenant_member_quota`, `tenant_role_quota`, `tenant_menu_quota`.
Decisione di esecuzione T06 (registro, Ruling 16): READ COMMITTED è richiesto per le scritture sulle risorse contate anche all’owner, senza bypass di copia/ripristino. Letture ed esportazione con il solo audit restano possibili a fotografia stabile. T11/T13 dichiarano questo vincolo dei comandi operativi e il suo costo, senza ampliare i privilegi.

- [✅] T06.4 Impostare il timeout nella fase iniziale di `withTenant`, locale alla transazione, prima del lavoro. Recuperare configurazione/limite della connessione in una fase accorpata, mai per ogni query del servizio. Aggiungere prova `pg_sleep` oltre limite, annullamento della modifica e connessione riusata da B senza residui. Aggiornare il tetto fisso delle porte soltanto per il costo di configurazione misurato e documentato; non allargare il tetto delle letture di autorizzazione.
- [✅] T06.5 Ripetere i test, compresa gara con isolamento diverso e blocchi menu/ultimo amministratore senza attese indefinite; commit locale `feat(tenancy): enforce resource quotas and transaction query timeout`.

## Task 7 — T07 — Modalità dell'installazione con una sola organizzazione

- [✅] ID=MT5B-T07, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Modalità singola senza privilegi impliciti, Fix description=Disabilitare davvero gli ingressi multi-tenant mantenendo default e isolamento; copre MT5B-OK-5 e RF-5.

**File:** C `W/lib/tenancy/tenancy-mode.ts`, relativi test unitari/d'integrazione; M `W/lib/tenancy/{host-tenants,token-tenant,tenant-selection,tenant-actions}.ts`, `W/lib/rbac/auth-guard.ts`, `W/lib/platform/platform-access.ts`, `W/components/{Sidebar,TenantSwitcher}.tsx`, `W/app/select-tenant/page.tsx`, `W/proxy.ts`, `W/.env.template`, `sources/devops/k8s/base/configmap.yaml`, `sources/devops/env-contract.test.mjs`; T `W/lib/tenancy/single-tenant-mode.integration.test.ts`.

**Interfacce:** `readTenancyMode(): 'multi' | 'single'` legge solo `CONSTRUCT_TENANCY_MODE`, predefinito `multi`; valori diversi fanno fallire la configurazione esplicitamente. `isMultiTenantEnabled(): boolean`. Nessun valore dal client.

- [✅] T07.1 Scrivere test di token già su B e in assistenza, URL dedicato, account senza membership default, amministratore di piattaforma senza membership e ritorno a multi. In single tutte le guardie della piattaforma/selector rifiutano anche richieste dirette; la modalità non crea righe in `tenant_membership`.

```ts
it('rejects an unknown installation mode instead of silently enabling tenants', () => {
  vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'singel')
  expect(() => readTenancyMode()).toThrow()
})
```
- [✅] T07.2 Eseguire unità e integrazione del task; fallimento atteso prima della nuova modalità.
- [✅] T07.3 Implementare risoluzione a default e controllo dell'origine canonica; prima del vecchio ramo che assicura la membership predefinita all'accesso, applicare il divieto di crearla automaticamente in single. Eliminare il ripiego verso B dai percorsi di token e host; i token non validi richiedono nuovo accesso o rimangono senza tenant. Nascondere selettore/console e chiudere guardie e azioni, incluse quelle dei cataloghi globali. Lasciare disponibili i comandi operativi con i loro controlli.
Decisione di esecuzione T07 (registro, Ruling 17): in single non si assicura automaticamente neppure il ruolo REGISTERED a un membro esistente. Nessun privilegio implicito; righe esistenti invariate, multi conserva il comportamento precedente. Il file membership.ts e prove dei due percorsi canonici entrano nel task. Prima dell’attivazione gli accessi/ruoli necessari vanno predisposti esplicitamente, come documenterà T13.

Decisione di esecuzione T07 (registro, Ruling 18): refreshTenant è ricalcolo essenziale autenticato e rimane disponibile anche in single, senza input di scelta e senza scrittura lastTenantId. «Riprova» usa solo il resolver single verso default/host canonico, con membership/ruoli preesistenti; nessun token B/assistenza o creazione implicita. chooseTenant, selettore e console restano chiusi.

Decisione di esecuzione T07 (registro, Ruling 19): il ramo ready single rivalida default/host canonico nello snapshot di autorizzazione già accorpato, senza enumerazione dei tenant o lookup aggiuntivo a ogni richiesta. Predicato multi invariato, budget conservato e misurato; nessun caching o privilegio implicito. Sono ammessi modifica circoscritta dello snapshot e test dei due modi.

- [✅] T07.4 Ripetere test e contratto variabili; verificare le stesse policy RLS e connessioni prima/dopo. Le righe di B sono invariate.
- [✅] T07.5 Commit locale `feat(tenancy): add single-organization installation mode`.

## Task 8 — T08 — Schermata concessioni e limiti, editor del tenant

- [✅] ID=MT5B-T08, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Gestione comprensibile delle concessioni, Fix description=Collegare T05/T06 alle schermate e distinguere sospensione da cancellazione; copre MT5B-OK-2/3/7.

**File:** C `W/components/platform/TenantPolicyEditor.tsx`, `W/components/platform/TenantGrantPurgeDialog.tsx`, relativi test; M `W/components/platform/TenantDetail.tsx`, `W/app/platform/tenants/[tenantId]/page.tsx`, `W/components/rbac/roles/RoleDetailClient.tsx`, `W/components/rbac/PermissionsTree.tsx`, `W/components/rbac/functionalities/FunctionalityForm.tsx`, `W/components/rbac/NavigationTree.tsx`, `W/app/(protected)/(admin)/admin/tenant-settings/page.tsx`; C migrazione `D/migrations/0068_tenant_policy_ui.sql`; T `sources/tests/e2e/test_tenant_policies.py`.

**Interfacce:** `TenantPolicyEditor({ tenantId, initialPolicy, usage }: { tenantId: number; initialPolicy: TenantPolicySnapshot; usage: TenantUsage })`; `TenantGrantPurgeDialog({ tenantId, preview, onComplete }: { tenantId: number; preview: PurgePreview; onComplete: () => void })`. Riutilizzare le azioni T05 e i tipi T01/T06, nessuna seconda regola client di autorizzazione.

- [✅] T08.1 Scrivere test delle opzioni Eredita/Consenti/Nega, provenienza del valore, dipendenze, assegnazioni sospese, avviso di quota inferiore all'uso e conflitto di revisione. Il click «Salva» non chiama mai la pulizia. La conferma di pulizia mostra numero di ruoli e singole assegnazioni.

Nel test del componente con azioni sostituite e invocazione del salvataggio secondo i test React già presenti, le asserzioni di `it('save never purges role assignments')` sono:
```ts
expect(saveTenantPolicy).toHaveBeenCalledOnce()
expect(purgeTenantGrants).not.toHaveBeenCalled()
```
Ripetere lo stesso comportamento reale nel browser: una sospensione conserva il numero di assegnazioni prima/dopo «Salva».
- [✅] T08.2 Eseguire i soli test dei nuovi componenti: falliscono prima dei componenti.
- [✅] T08.3 Implementare componenti con primitive già presenti, controlli accessibili e traduzioni. Nei ruoli mostrare assegnazioni sospese revocabili e impedire nuove concessioni; nell'editor menu usare T03 per le aree disponibili. Il tasto per gestire il consenso rimane accessibile se la registrazione autonoma non è concessa. Nessun `--theme-*`, nessuna nuova griglia artigianale.
La pagina delle impostazioni usa `requireTenantSettingsPage` T04; la sezione registrazione autonoma verifica il permesso effettivo, quella consenso usa il flag dedicato e rifiuta le modifiche in assistenza. Nei test coprire sia persona delegata sia assistenza senza consentire auto-autorizzazione.
Decisione di esecuzione T08 (registro, Ruling20): la0068 ancora bozza non distribuita/non committata può essere corretta per i difetti reali dei seed emersi prima del gate (placeholder e due etichette audit). Prima trial in rollback, poi ricostruzione coordinata della sola prova a server/test fermi; nessuna modifica manuale a checksum/storia,0001–0067 immutate. Non aggiungere0069 o rinumerare i task futuri per iterare questa bozza.

- [✅] T08.4 Ripetere unità, poi integrazione mirata se cambia una porta e soltanto dopo avviare E2E contro la prova. Casi `test_suspend_restore_and_purge_grants` e `test_policy_conflict_and_quota_notice`; invocazione `uv run pytest sources/tests/e2e/test_tenant_policies.py`. Salvare immagini della verifica con dati sintetici. Non riusare il server localhost:3000 collegato allo sviluppo.
- [✅] T08.5 Commit locale `feat(platform): expose tenant feature policies and limits`.

## Task 9 — T09 — Consenso esplicito all'esportazione

- [✅] ID=MT5B-T09, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Consenso distinto e rivalidato, Fix description=Estendere l'assistenza senza ampliare retroattivamente i consensi; copre MT5B-OK-6 e RF-1.

**File:** C `D/migrations/0069_tenant_export_consent.sql`; M `W/lib/db/schema.ts`, `W/lib/tenancy/{support-consent,support-consent-actions}.ts`, `W/components/settings/TenantSettings.tsx`, `W/lib/platform/tenant-service.ts`; C `W/lib/tenancy/tenant-export-access.ts`; T `W/lib/tenancy/tenant-export-access.integration.test.ts`, test impostazioni.

**Interfacce:** `tenant_settings.support_export_allowed boolean not null default false`. `grantSupportConsent(duration: SupportDuration, options?: { allowExport: boolean }): Promise<{ ok: true; until: string }>`; assenza opzioni = false, rinnovo con false toglie l'estensione. `requireTenantExporter(): Promise<Actor>` richiede amministratore del tenant o assistenza con estensione valida; `assertTenantExportStillAllowed(actor: Actor): Promise<void>` rilegge in nuova transazione, senza cache React né fotografia della preparazione. La guardia del consenso usa T04 e rifiuta la piattaforma in assistenza.

- [✅] T09.1 Scrivere test per consenso 5a (false dopo migrazione), concesso, scaduto, revocato, rinnovato senza estensione, amministratore tenant senza assistenza e piattaforma con assistenza ma senza estensione. Modello sempre rifiutato. Il tentativo della piattaforma di concedersi l'estensione è rifiutato e non lascia registri.

Con `fixture` T02, intestazioni dell'indirizzo principale e sessione sostituita al confine come nei test 5a:
```ts
// it('does not upgrade an old support consent into an export consent')
mocks.session = { user: { id: fixture.adminId, tenantId: fixture.tenantId, tenantState: 'ready' } }
await grantSupportConsent('1h')
mocks.session = { user: { id: fixture.platformAdminId, tenantState: 'none' } }
await startSupport(fixture.tenantId, 'Verifica consenso esportazione')
mocks.session = { user: { id: fixture.platformAdminId, tenantId: fixture.tenantId, tenantState: 'support' } }
await expect(requireTenantExporter()).rejects.toThrow('Unauthorized')
```
`'1h'` è il letterale già presente in `support-consent-durations.ts`; `startSupport` è l'azione esistente `lib/platform/support-actions.ts`. La negazione deve dipendere dall'estensione mancante, non da un ingresso di assistenza assente.
- [✅] T09.2 Eseguire integrazione del task e test impostazioni in sequenza: falliscono sui nuovi casi.
- [✅] T09.3 Implementare dato, letture, guardie e casella esplicita inizialmente spenta; registrare la scelta, usare l'orologio del database e le regole di ingresso aperto già esistenti. Nessuna estensione scritta dal file di ripristino. La piattaforma legge solo stato/scadenza consentiti, non dati del tenant senza assistenza.
- [✅] T09.4 Ripetere test e aggiungere revoca/account disattivato/ruolo rimosso tra due controlli. Il secondo controllo vede il nuovo stato anche se la fotografia di esportazione è antecedente.
- [✅] T09.5 Commit locale `feat(tenancy): require explicit consent for platform exports`.

## Task 10 — T10 — Archivio versione 1 ed esportazione autenticata

- [✅] ID=MT5B-T10, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Esportazione completa e limitata, Fix description=Formato chiuso, copertura di tutte le tabelle e consegna soltanto dopo verifica aggiornata; copre MT5B-OK-4/6 e RF-1.

**File:** C `W/lib/tenancy/{tenant-archive-contract.json,tenant-archive-types.ts,tenant-archive-schema.ts,tenant-export-service.ts}`, `W/app/api/tenant/export/route.ts`, `W/components/settings/TenantDataExport.tsx`, relativi test; C `D/migrations/0070_tenant_data_contract.sql`; M inventario porte fra tenant, guardia delle porte e impostazioni.

**Interfacce:** `TenantArchive` contiene `formatVersion: 1`, `schemaVersion: string`, `catalogVersion: 1`, `exportedAt: string`, `sourceTenant`, `identities`, `tables`, `counts`, `globalReferences`, `hosts`. Valori JSON senza `undefined`, bigint serializzati come stringhe decimali per evitare perdita di precisione. `parseTenantArchive(value: unknown): TenantArchive` rifiuta campi non previsti, credenziali e codici sconosciuti. `prepareTenantExport(actor: Actor, signal: AbortSignal): Promise<Uint8Array>`; `EXPORT_MAX_BYTES = 52_428_800`, `EXPORT_DEADLINE_MS = 60_000`. La rotta GET chiama la guardia T09 come prima istruzione e risponde con JSON in allegato, `Cache-Control: no-store`, senza URL pubblico.

Decisioni di esecuzione T10 (registro, Ruling21–22): esecutore export isolato nello strato `lib/db`, a vita processo e con stessa identità runtime, una connessione/coda annullabile e istruzioni di transazione pubbliche tracciabili. Nessun nuovo client per richiesta o costo ai percorsi ordinari. Annullamento della query e rollback realmente conclusi prima del riuso, con prove preliminari obbligatorie. Per includere l'autorizzazione nei 60 secondi, la rotta può predisporre soltanto cronometro/segnale/scope prima della guardia, senza database o dati; `requireTenantExporter()` resta la prima istruzione del callback e la prima operazione con autorità. Le firme T09 restano invariate; il `finally` esterno pulisce tutte le risorse anche al fallimento della guardia.

Ruling23: nell'adapter export soltanto, restringere il timeout SQL locale al minimo positivo fra valore corrente e tempo residuo prima delle query di lavoro e verificare il residuo prima del COMMIT. Configurazione annullabile senza ricorsione, mai prima di SET TRANSACTION; abort impedisce nuovo lavoro e non ostacola rollback. Timer/cancellazione restano principali. Il costo fino a un'istruzione aggiuntiva per query riguarda solo export, incluse le sue guardie, e non cambia i budget ordinari. Provare residuo e conservazione di un timeout già più severo.

**Registro dei dati:** il contratto JSON elenca tabelle/campi esportabili e gestione dei riferimenti; nessun elenco dedotto genericamente da `id_tenant`. La migrazione aggiunge SQL `app_private.assert_tenant_data_coverage(p_operation text) returns void`, con gli elenchi noti per `export`, `restore`, `delete` confrontati con `app_private.table_class`. Elenco tenant completo atteso: `role`, `user_role`, `role_permission`, `menu_entry`, `menu_entry_tag`, `role_functionality`, `app_theme`, `tenant_membership`, `tenant_settings`, `tenant_audit_event`, `tenant_platform_policy`, `tenant_area_entitlement`, `tenant_entitlement`. Un'aggiunta non dichiarata fallisce. Globali `users` solo proiezione identificativa consentita e host solo metadati; `allowed_domains`, `password_set_tokens`, `auth_rate_limit`, cataloghi globali e registro piattaforma non sono righe esportabili/importabili di un tenant. Test di parità tra contratto e schema/elenchi SQL.

La 0070 aggiunge al registro tenant `origin text not null default 'live'` (`live | restored`), `source_tenant_id text null`, `source_event_id text null`. Il contratto comprende questi campi e li tratta come provenienza storica, non autorità. Le letture che determinano un ingresso di assistenza aperto considerano soltanto eventi `origin='live'`; gli attuali eventi ricevono tale valore senza modificare i dettagli.

- [✅] T10.1 Scrivere test formato e integrazione con dati non vuoti in ogni tabella di A, B presente e un'identità condivisa. Assert: nessuna riga di B, password/hash/token/segreto/sessione/flag piattaforma; contatori esatti, id numerici grandi conservati come stringhe e registro filtrato con campi ammessi per operazione. Una tabella nuova classificata tenant ma non gestita causa errore.

Con l'archivio di prova completo già validato, `it('rejects privilege fields even in an otherwise valid archive')` usa:
```ts
expect(() => parseTenantArchive({ ...archive, isPlatformAdmin: true })).toThrow()
expect(EXPORT_MAX_BYTES).toBe(52_428_800)
expect(EXPORT_DEADLINE_MS).toBe(60_000)
```
Le prove dei due limiti devono anche provocare il superamento nell'esportatore, non limitarsi a confrontare costanti.
- [✅] T10.2 Eseguire i test del formato e poi `tenant-export.integration.test.ts`: falliscono prima dell'esportatore.
- [✅] T10.3 Implementare fotografia coerente in transazione `REPEATABLE READ` applicativa; nessuna scrittura alle risorse contate, evento preparato nello stesso ambito. Ordinare dati per risultati ripetibili; limitare la lettura/serializzazione con conteggio dei byte e scadenza reale, senza caricare una risposta illimitata prima del controllo. I dettagli del registro hanno uno schema ammesso, non solo un filtro per nome della chiave. La fotografia non include l'evento che prepara quel medesimo file.
- [✅] T10.4 Costruire interamente il risultato entro i limiti prima di inviare intestazioni/corpo; poi chiamare `assertTenantExportStillAllowed`. Errore o revoca = nessun file. Registrare preparazione anche nella piattaforma quando l'attore è in assistenza; il registro non afferma consegna completata. Testare 52 428 800 byte ammessi e uno in più rifiutato, deadline 60 000 ms con orologio controllato, abort della richiesta, nessun file temporaneo e nessuna consegna parziale.
La scadenza deve interrompere anche la query in corso e annullare la transazione; una semplice corsa fra promesse che lasci il lavoro sul database in esecuzione non basta. Verificare l'API di annullamento nella versione installata del driver prima di implementarla.
- [✅] T10.5 Collegare il pulsante nelle impostazioni, aggiungere E2E `test_export_requires_tenant_admin_or_explicit_support_consent` al gruppo policy/dati e provarlo solo dopo integrazione conclusa. Commit locale `feat(tenancy): export versioned tenant data with consent and limits`.

## Task 11 — T11 — Ripristino operativo in un nuovo tenant

- [✅] ID=MT5B-T11, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Ripristino isolato e verificato, Fix description=Verifica preventiva e importazione atomica con identità rimappate, nessun privilegio globale dal file; copre MT5B-OK-4/6 e RF-4.

**File:** C `D/migrations/0071_restore_tenant_archive.sql`, `D/tenant-archive.mjs`, `D/tenant-archive.test.mjs`, `W/lib/tenancy/tenant-restore-command.integration.test.ts`; M `D/db.mjs`. I parser nuovi sono testati in `tenant-archive.test.mjs`. Il comando legge il contratto JSON T10 dal percorso dell'app, non importa TypeScript con alias da uno script Node.

**Interfacce:** `parseTenantRestoreArguments(args: string[]): RestoreOptions` e `runTenantRestore(sql, options): Promise<RestoreReport>` nel modulo operativo, tipi documentati con JSDoc. Opzioni `--file`, `--slug`, `--name`, `--user-map`, `--actor`, `--accept-policy`, `--apply`; senza `--apply` solo verifica preventiva. `--user-map` è un JSON da id origine a UUID destinazione; mai corrispondenza automatica per email. Comandi `tenant-restore` e `test-tenant-restore`, con connessioni rispettivamente migrazioni/test-migrazioni e controlli usa e getta esistenti per il secondo. SQL owner-only `app_private.restore_tenant_archive(p_archive jsonb, p_slug text, p_name text, p_user_map jsonb, p_actor uuid) returns bigint`.

- [✅] T11.1 Scrivere test parser e integrazione: esportare A con B presente, fornire mappa completa, ripristinare A2 sospeso e confrontare dati e diritti; gli id ruolo/menu cambiano e i riferimenti restano coerenti. B e account globali invariati. Include assegnazioni dormienti, utenti condivisi e attori storici non più presenti.

Nel caso `it('restores A into A2 without touching B or shared accounts')`, conservare prima/dopo righe ordinate delle tabelle di B e dei campi di users, senza stamparli:
```ts
expect(afterB).toEqual(beforeB)
expect(afterUsers).toEqual(beforeUsers)
expect(restoredTenant.status).toBe('suspended')
expect(restoredRoleIds).not.toEqual(sourceRoleIds)
```
- [✅] T11.2 Eseguire `node --test sources/devops/db/tenant-archive.test.mjs` e poi integrazione del comando sulla prova: casi nuovi falliscono.
- [✅] T11.3 Implementare validazione chiusa coerente con contratto T10, verifica preventiva con conteggi/quote e assenza di scritture. `--apply` richiede `--accept-policy`, mappa completa e attore tecnico esplicito; il comando mostra l'effetto della configurazione di piattaforma ma non valori personali o credenziali. Validare nuovamente dentro la transazione che applica, non fidarsi del rapporto di verifica precedente. Rifiutare esistenza slug, formato/versione/campi/codici ignoti, mappa incompleta o ambigua e quote insufficienti.
- [✅] T11.4 Nella funzione SQL creare nuovo tenant sospeso, rimappare chiavi e ricostruire righe note in ordine; caricare grant storici con il percorso owner-only T04. Non creare/modificare users o password, non ripristinare consensi/sessioni/token/host attivi, non acquisire ruolo speciale del modello/default. Richiedere almeno un amministratore attivo nella destinazione e preservare gli attori storici come tali. Annotare origine tecnica degli eventi importati e del ripristino; impedire che vecchi eventi `support.*` riaprano assistenza.
Gli eventi importati ricevono sempre `origin='restored'` e riferimenti sorgente, anche se il file sosteneva `live`; i nuovi eventi dell'importatore sono `live`. I campi di provenienza non sovrascrivono identità o privilegi.
- [✅] T11.5 Provare fallimento dopo metà importazione, prima dell'evento finale e concorrenza sullo slug: zero residui, un solo tenant eventuale. Il comando usa limiti operativi espliciti propri e READ COMMITTED per le scritture contate (Ruling 16), senza cambiare timeout del web. Ripetere test e commit locale `feat(tenancy): restore tenant archives through guarded operator command`.

## Task 12 — T12 — Eliminazione definitiva con sola traccia minima

- [✅] ID=MT5B-T12, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Cancellazione completa e atomica, Fix description=Eliminare dati e vecchi registri lasciando solo l'evento concordato; copre MT5B-OK-4/6 e RF-4, risolve DEF-A.

**File:** C `D/migrations/0072_erase_tenant.sql`, `W/lib/platform/tenant-delete-actions.ts`, `W/components/platform/TenantDeleteDialog.tsx`, relativi test; M `W/components/platform/TenantDetail.tsx`, `W/lib/audit/{audit-types,platform-audit}.ts`, viste del registro, contratto T10 se necessario; T `W/lib/platform/tenant-delete-actions.integration.test.ts`, `sources/tests/e2e/test_tenant_data.py`.

**Interfacce:** `deleteTenantPermanently(tenantId: number, confirmationSlug: string): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'protected' | 'not_archived' | 'changed' }>`; SQL owner-only `app_private.erase_tenant(p_id bigint, p_slug text, p_actor uuid) returns void`. Prima guardia piattaforma; id dal client mai sufficiente da solo. La funzione verifica contesto del tenant, account attore attivo con attributo piattaforma, slug corrente, stato archiviato e protezioni.

- [✅] T12.1 Scrivere integrazione A/B con identità condivisa, vecchi registri contenenti dati riconoscibili, link/host, grant sospesi e token. A archiviato si elimina; default/modello/attivo/slug errato non si eliminano. In A non restano righe; B, account e token globali sono identici. Il solo evento residuo di A ha `operation='tenant.delete'`, `id_tenant=null`, `object_id` tecnico, `actor_user_id` tecnico, istante e dettagli vuoti; `actor_email` è null.

Nel caso `it('keeps exactly one minimal deletion event')`, sulle righe selezionate con associazione strutturata ad A:
```ts
expect(events).toHaveLength(1)
expect(events[0]).toMatchObject({ operation: 'tenant.delete', idTenant: null, objectId: String(fixture.tenantId), actorEmail: null, details: {} })
expect(afterB).toEqual(beforeB)
```
- [✅] T12.2 Eseguire integrazione mirata: fallisce prima della nuova funzione e azione.
- [✅] T12.3 Inventariare ogni operazione del registro 5a e nuova. Tutti gli eventi riferiti al tenant devono essere tracciabili da associazioni strutturate; per vecchie operazioni note migrare l'associazione usando campi tecnici, senza ricerche testuali sui dettagli. Eventi globali realmente indipendenti, come la nomina a piattaforma di una persona, restano globali. Se un tipo contiene più tenant, separare le porzioni con riferimento esplicito prima di consentire l'eliminazione. La copertura fallisce sui tipi non classificati.
- [✅] T12.4 Implementare cancellazione e evento minimo nella stessa transazione, sotto blocco T02 e riga tenant. Risolvere i riferimenti dei registri senza lasciare lo storico tramite il solo SET NULL. Revocare token strettamente tenant tramite riferimento strutturato dove disponibile; i token globali attuali restano globali e non ricreano membership. Gestire i vincoli dell'ultimo amministratore per cancellazione integrale solo owner e tenant archiviato, senza aprirli nelle normali revoche. `users.last_tenant_id` si azzera; nessuna cancellazione users, neanche senza altre membership.
- [✅] T12.5 Provare fallimento dell'inserimento dell'evento finale e scrittura concorrente; tutto annullato o concluso senza righe che ricompaiono. I registri restano immodificabili dal runtime. Collegare conferma accessibile con slug e avviso; nessuna esportazione obbligatoria/implicita. Browser con `uv run pytest sources/tests/e2e/test_tenant_data.py` soltanto dopo integrazione. Commit locale `feat(platform): erase archived tenants with minimal deletion trace`.

## Task 13 — T13 — Verifiche complete, aggiornamento dalla 0063 e guida di rilascio

- [✅] ID=MT5B-T13, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Chiusura verificata e rilascio separato, Fix description=Coprire tutte le porte/tabelle, provare installazione nuova e aggiornata, consegnare guida e mantenere autorizzazioni operative separate; copre MT5B-OK-1…8.

**File:** C `D/verify-tenant-upgrade.mjs`, relativo test `.test.mjs`, `docs/runbooks/tenant-data-lifecycle.md`, `docs/reviews/2026-10-30-multi-tenancy-piece-5b-handoff.md`; M `.github/workflows/quality.yml`, `README.md`, `W/lib/schema-contract.integration.test.ts`, `W/lib/tenancy/cross-tenant-entry-points.integration.test.ts`, inventari audit/dati, `D/db.mjs` sonde di confine, specifica/roadmap/rimandati e questo piano.

**Interfacce operative:** lo script di aggiornamento usa esclusivamente server di prova locale con `TEST_DATABASE_DISPOSABLE=1`, `TEST_MIGRATION_DATABASE_URL` e destinazione dedicata `construct_upgrade_test`. Crea quella banca dati sul medesimo server usa e getta, applica fino alla 0063, inserisce A/B e dati storici, poi applica 0064–0074 e confronta. La 0073 corregge l’ordine dei blocchi confermato da MT5B-XLOCK-1 (Ruling 29). La 0074 impedisce grant con fotografia superata e aggiunge i messaggi di rifiuto per quota (Ruling 31–32). Credenziali riutilizzate in memoria, mai stampate; nessuna lettura o ripiego verso `.env.local`. Il codice del runner rifiuta un server non locale e rimuove solo la banca dati di prova nominata. Non usa il database condiviso dai test mentre integrazione o browser sono in esecuzione.

- [✅] T13.1 Scrivere ed eseguire test del runner che rifiutano ambiente non usa e getta, nome diverso e indirizzo non locale. Integrare in CI la prova di aggiornamento prima dei test di integrazione e del browser, in sequenza, preservando la prova esistente di installazione nuova. Verificare che alla 0063 i dati rimangano equivalenti dopo l'aggiornamento: accesso conservato, menu non spostato, vecchi consensi senza estensione, quote nulle.
Il test Node `upgrade runner refuses a non-local target` esegue il runner come processo con URL sintetico non locale e controlla `assert.notEqual(result.status, 0)`: nessuna connessione deve essere tentata. Il confronto di dati prima/dopo rimane una prova reale sulla banca dati usa e getta dedicata.
- [✅] T13.2 Completare inventario delle porte fra tenant e delle funzioni: nuova rotta export, azioni policy/pulizia/eliminazione, modalità singola, tema e pagine incorporate. Ripetere richieste con id di B come membro di A; i nuovi ingressi non coperti fanno fallire la guardia. Completare copertura tabella nuova/operazione audit nuova e dualità contratto di schema/sonde di confine. In CI aggiungere `boundary-check` dopo provisioning con connessioni runtime/piattaforma di test, mai con quelle dello sviluppo.
- [✅] ID=MT5B-XLOCK-1, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Verificare ordine dei blocchi tra delta SQL e quote, Fix description=Provare con barriera reale la possibile interazione tra apply_role_*_deltas della 0046 (revoca grant prima di UPDATE role), guardia quota 0067 (policy prima di UPDATE) e purge T05 (policy prima dei grant). Coprire la revoca non ancora arrivata a UPDATE e verificare assenza di cicli o rollback non gestiti. Se confermato, correzione minima in avanti e prova ROSSO/VERDE, senza ritoccare migrazioni già approvate; portare evidenze al revisore finale.

- [✅] T13.3 Eseguire dalla W, sull'ambiente isolato di prova, `npm run lint`, `npm run typecheck`, `npm test`, i sette script di contratto presenti in package.json e `npm run build`. Dalla radice eseguire i test Node delle migrazioni/nuovi moduli e `schema-check`. Poi `npm run test:integration:local` da W: conclusione con zero fallimenti. Annotare conteggi attuali, non ricopiare i numeri del 5a.
- [✅] T13.4 A integrazione conclusa avviare un processo web separato contro il database di test, con accesso di prova solo lì e le sole connessioni limitata/piattaforma. Usare le configurazioni locali esistenti della prova, non il server dello sviluppo; porta 3001, `AUTH_URL=http://localhost:3001` nel web e `BASE_URL=http://localhost:3001` in pytest. Sovrascrivere le due connessioni con quelle della prova prima che Next legga `.env.local` e togliere dall'ambiente web gli accessi dell'operatore. Eseguire `uv run pytest sources/tests/e2e` dalla radice con ambiente di test caricato, conservare immagini dei nuovi flussi e verificare assenza di segreti nei risultati. Riprovare il ritorno multi/single in processi distinti, non cambiando la variabile durante una richiesta.
- [✅] T13.5 Scrivere la guida con configurazione/conteggi/quote, consenso, formato ed esclusioni, verifica preventiva/ripristino, cancellazione, copie di sicurezza e log, limiti del file e responsabilità. Documentare rilascio: migrazioni compatibili → nuove istanze con `CONSTRUCT_PLATFORM_POLICY_WRITES=0` → conferma che tutte usano i controlli nuovi → abilita scritture policy a `1`. Dopo concessioni restrittive niente ritorno a vecchie immagini che le ignorano: correzione in avanti o accessi fermi. Conservare traccia tecnica esterna necessaria per riapplicare cancellazioni dopo un recupero integrale.
Includere l'origine pubblica `AUTH_URL`/`NEXTAUTH_URL` anche nell'ambiente del job delle migrazioni e nei comandi di creazione da modelli con link assoluti; aggiornare l'esempio del job. Esplicitare il limite introdotto dalla 0065: una vecchia immagine senza contesto origine conserva le letture ma non può scrivere link assoluti. Verificare questo limite e descrivere la finestra operativa, senza dichiarare compatibilità completa non provata.
Dopo la correzione di revisione T03 (Ruling 11), il confine autorevole è la destinazione canonica: verificare e aggiornare la guida anche per le immagini che continuano a rendere il valore originale. Il solo vecchio limite sugli URL assoluti non descrive più tutta la compatibilità. Nessuna vecchia immagine che legge il dato originale può essere dichiarata compatibile con il nuovo confine; coordinare sostituzione delle istanze, scritture del menu e attivazione delle policy. Includere nel pacchetto CLI il modulo generato e nel controllo del progetto la sua verifica di allineamento.
Per l'esportazione, distinguere la prova PostgreSQL diretta dalla verifica del pooler in modalità transazione. Se è già disponibile un pooler di prova autorizzato, ripetere su quello annullamento di una query, annullamento della transazione e richiesta successiva senza residui. Se non è disponibile, lasciare esplicita la verifica da fare sul percorso di destinazione prima dell'attivazione. Non usare lo sviluppo senza il sì richiesto e non dichiarare verificato Supavisor sulla base del solo PostgreSQL locale.
- [✅] T13.6 Rivedere l'intero ramo, chiudere le correzioni con verifiche pertinenti e commit locali. Spuntare i criteri MT5B-OK e le voci DEF/roadmap soltanto per ciò che è fatto e verificato; separare stato del codice da attivazione. Chiedere OK per invio/richiesta/unione come operazioni distinte e, solo dopo l'unione, un nuovo sì per ogni intervento sullo sviluppo. Questo ultimo passo resta aperto finché tali operazioni non sono concluse e verificate.

Aggiornamento T13.6 del 5 novembre 2026. Revisione e correzioni concluse fino al codice a6099be, PR #90 unita con commit 55bb758 e CI Quality n.51 superata, inclusi 174 E2E. Migrazioni di sviluppo 0064–0074 applicate con autorizzazione del proprietario, origine http://localhost:3000 e rinuncia al backup autorizzata; confine 33/33 superato. Verifica sintetica dello scope reale di export su Supavisor conclusa con sslmode=verify-full in memoria e CA pubblica tramite NODE_EXTRA_CA_CERTS, inclusi CancelRequest, cleanup e contesto/timeout della richiesta successiva. Dopo il sì esplicito del proprietario, sviluppo attivo su localhost:3000 con PGSSL=verify-full, la stessa CA tramite NODE_EXTRA_CA_CERTS e CONSTRUCT_PLATFORM_POLICY_WRITES=1; readiness e /login HTTP 200 verificati. Con questo profilo runtime e piattaforma hanno concluso transazioni READ ONLY, incluso il cambio di ruolo locale della piattaforma. Il file originale .env.local resta invariato e da solo non configura TLS; profilo sicuro e flag di attivazione vanno ripetuti a ogni avvio. MT-5.9 e DEF-5.8 riconciliati; T13.6 e T13 conclusi per lo sviluppo locale.

## Comandi e ambiente di verifica

I comandi unitari nelle sezioni T01–T12 si eseguono da W. Quelli `node sources/...` e `uv run pytest ...` partono dalla radice. `npm run test:integration:local -- <file>` usa `local-test.env` già configurato e mai riportato qui. I file nuovi hanno nomi esatti come sopra; l'esecutore controlla la raccolta prima di accettare una prova.

Preparazione consentita della prova: `sources/devops/db/local-test-db.sh up`, con Docker disponibile. Non avviare o ripreparare la prova mentre un altro test la usa. Non stampare variabili di connessione. `schema-write` e `schema-check` elaborano migrazioni locali senza database; ogni altro comando non di test deve avere una destinazione di prova esplicita durante queste verifiche. Il controllo di confine in CI riceve solo variabili del servizio usa e getta.

Ogni task termina così: rilettura mirata → verifica fresca → spunta della casella completata → commit dei soli percorsi propri, piano incluso. Non usare `git add -A` o `git stash`. Un fallimento di verifica blocca la spunta, non si attenua il test per farlo passare.

## Controllo del piano prima della consegna

- [✅] ID=MT5B-PLAN-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Copertura e interfacce del piano, Fix description=Rilettura completata il 2026-10-30: ogni criterio è associato ai task nella tabella seguente; tipi/interfacce ricontrollati, componenti esistenti individuati, cinque casi RF coperti. Chiariti consenso essenziale su pagina condivisa, provenienza dei registri importati e classificazione globale di allowed_domains. Nessuna implementazione considerata completata.
- [✅] ID=MT5B-PLAN-2, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Lettura e metodo di esecuzione, Fix description=Piano presentato e metodo confermato dal proprietario il 2026-10-30: «Agenti con revisione per ogni attività». Avvio autorizzato; database di sviluppo e remoto restano soggetti agli OK separati.

## Corrispondenza con i criteri della specifica

| Criterio | Task responsabili |
|---|---|
| MT5B-OK-1 | T01, T02, T03, T04, T05, T13 |
| MT5B-OK-2 | T03, T04, T05, T08 |
| MT5B-OK-3 | T06, T08 |
| MT5B-OK-4 | T10, T11, T12 |
| MT5B-OK-5 | T07, T13 |
| MT5B-OK-6 | T09, T10, T11, T12, T13 |
| MT5B-OK-7 | T02, T08, T13 |
| MT5B-OK-8 | T13 |
