# Migrazione incrementale del sottosistema i18n a `next-intl`

## Come usare questo documento

Questo documento e un prompt operativo da fornire in futuro a un sistema di coding agentico con accesso completo al repository. L'obiettivo e analizzare, progettare e realizzare una migrazione verificabile dall'attuale motore i18n custom a `next-intl`, senza assumere che l'intero sottosistema esistente debba essere riscritto.

Non iniziare modificando il codice. Esegui prima l'analisi e presenta la decisione architetturale richiesta nella sezione "Gate di approvazione". Procedi con l'implementazione soltanto dopo l'approvazione dell'utente.

## Obiettivo

Adotta `next-intl` come unico motore finale di risoluzione e formattazione dei messaggi dell'interfaccia. Esegui una migrazione incrementale, testabile e reversibile. Puoi ridisegnare anche persistenza, cache, API e provider se l'analisi dimostra benefici concreti, ma devi preservare tutti i comportamenti esterni inderogabili descritti in questo documento.

La migrazione non deve introdurre segmenti `[locale]`, prefissi di lingua o modifiche alle URL esistenti. `next-intl` deve essere configurato per ricavare la lingua dalla preferenza utente e dai meccanismi di risoluzione dell'applicazione.

## Contesto da leggere prima di proporre modifiche

Leggi integralmente e rispetta:

- `AGENTS.md`, `README.md` e `CLAUDE.md`;
- `docs/input-specs/i18n/i18n.md`;
- `docs/superpowers/specs/2026-07-28-i18n-system-design.md`;
- `docs/superpowers/plans/2026-07-28-i18n-system.md`, limitatamente alle decisioni, ai contratti e ai test ancora rilevanti;
- l'implementazione corrente sotto `sources/microservices/web-construct/lib/i18n/`;
- `sources/microservices/web-construct/context/I18nContext.tsx`;
- i layout, i provider, le API i18n, i Server Action, lo schema Drizzle e lo schema SQL;
- i componenti che usano `getI18n`, `useI18n`, `useT`, `t()` e `fmt`;
- tutti i test unitari, d'integrazione ed E2E relativi a i18n, autenticazione, sidebar e pannelli amministrativi.

Consulta la documentazione ufficiale corrente di `next-intl` al momento dell'esecuzione. Non basarti su API ricordate, esempi obsoleti o sull'assunzione che `next-intl` richieda routing localizzato. Scegli una versione compatibile con le versioni effettive di Next.js e React presenti nel repository e registra la motivazione della versione selezionata.

## Stato da preservare

PostgreSQL e il sistema attuale rimangono la baseline comportamentale finche una fase approvata non cambia esplicitamente tale responsabilita. Non perdere o sovrascrivere traduzioni create a runtime che non compaiono nei seed SQL.

I seguenti comportamenti sono inderogabili:

- [ ] ID=INV-1, Priority=P0, Title=URL stabili, Requirement=Nessuna route o URL esistente cambia e non vengono introdotti segmenti `[locale]` obbligatori.
- [ ] ID=INV-2, Priority=P0, Title=Amministrazione runtime, Requirement=Gli amministratori possono continuare a creare e gestire lingue, chiavi e valori senza modificare o distribuire codice.
- [ ] ID=INV-3, Priority=P0, Title=Persistenza della preferenza, Requirement=La lingua scelta continua a essere salvata sul profilo autenticato e nei cookie previsti per i visitatori anonimi.
- [ ] ID=INV-4, Priority=P0, Title=Ordine di risoluzione, Requirement=Rimane equivalente l'ordine sessione, profilo, cookie persistente, `Accept-Language`, lingua predefinita, ignorando lingue assenti o disattivate.
- [ ] ID=INV-5, Priority=P0, Title=Fallback, Requirement=Ogni messaggio usa lingua attiva, poi lingua predefinita, poi missing-key fallback senza interrompere il rendering.
- [ ] ID=INV-6, Priority=P0, Title=Cambio lingua non distruttivo, Requirement=Il cambio lingua aggiorna Server e Client Component senza reload completo e senza perdere lo stato locale di form, modali, filtri o selezioni.
- [ ] ID=INV-7, Priority=P0, Title=Aggiornamento runtime, Requirement=Una traduzione salvata diventa visibile entro i limiti di consistenza documentati senza nuovo login, riavvio o redeploy.
- [ ] ID=INV-8, Priority=P0, Title=Concorrenza sicura, Requirement=Gli aggiornamenti concorrenti mantengono optimistic locking o una garanzia almeno equivalente e non causano lost update silenziosi.
- [ ] ID=INV-9, Priority=P0, Title=Migrazione senza perdita dati, Requirement=Schema e contenuti esistenti vengono migrati con procedura idempotente, dry run, verifica e rollback.
- [ ] ID=INV-10, Priority=P0, Title=Sicurezza equivalente, Requirement=Autorizzazioni, escaping, audit, limiti dei payload e gestione degli errori non risultano indeboliti.
- [ ] ID=INV-11, Priority=P1, Title=Navigazione tradotta, Requirement=Il bridge con le traduzioni contenuto di `navigation_item` continua ad avere un fallback valido per lingue UI nuove o non supportate dal catalogo contenuti.
- [ ] ID=INV-12, Priority=P1, Title=Compatibilita operativa, Requirement=Build, deployment Node e comportamento multi-pod restano supportati.

## Analisi obbligatoria e baseline

Prima di scegliere l'architettura:

- [ ] ID=ANA-1, Priority=P0, Title=Inventario consumer, Requirement=Elenca file e pattern che consumano traduzioni o formatter, distinguendo Server Component, Client Component, Server Action, Route Handler e codice non React.
- [ ] ID=ANA-2, Priority=P0, Title=Inventario dati, Requirement=Misura lingue, chiavi, valori, namespace, placeholder e valori mancanti sia nei seed sia nel database target disponibile.
- [ ] ID=ANA-3, Priority=P0, Title=Messaggi dinamici, Requirement=Individua chiavi costruite dinamicamente e valori che non possono beneficiare direttamente della tipizzazione statica.
- [ ] ID=ANA-4, Priority=P0, Title=Baseline funzionale, Requirement=Esegui e registra test, lint, type checking, build ed E2E disponibili prima delle modifiche, separando problemi preesistenti da regressioni.
- [ ] ID=ANA-5, Priority=P1, Title=Baseline prestazioni, Requirement=Misura payload i18n serializzato, JavaScript client correlato, numero di query e comportamento della cache su almeno una route pubblica e una protetta.
- [ ] ID=ANA-6, Priority=P0, Title=Compatibilita next-intl, Requirement=Verifica sulle fonti ufficiali l'integrazione corrente con le versioni Next.js e React del progetto, Server Component, Client Component, richiesta senza routing localizzato e messaggi caricati da database.
- [ ] ID=ANA-7, Priority=P0, Title=Rischi ICU, Requirement=Analizza placeholder `{{param}}`, apostrofi, parentesi graffe, plurali e altri contenuti che richiedono conversione o escaping secondo ICU.

## Decisione architetturale

Confronta almeno le seguenti opzioni:

1. mantenere schema, servizi amministrativi, risoluzione lingua e cache, usando `next-intl` come motore sopra un adapter;
2. ridisegnare una o piu parti di persistenza, cache, API o provider e migrare i dati;
3. mantenere esplicitamente una parte custom quando `next-intl` non copre una responsabilita applicativa reale.

Per ogni opzione valuta complessita, rischio, quantita di codice eliminabile, impatto sul payload, operativita multi-pod, migrazione dati, rollback, developer experience e manutenzione futura. Preferisci l'intervento minimo che ottiene benefici dimostrabili. Non giustificare una riscrittura solo con uniformita estetica o riduzione nominale del numero di file.

### Gate di approvazione

Prima di installare dipendenze o modificare file applicativi, presenta all'utente:

- [ ] ID=GATE-1, Priority=P0, Title=Rapporto baseline, Requirement=Risultati dell'analisi con misure e rischi concreti.
- [ ] ID=GATE-2, Priority=P0, Title=ADR proposta, Requirement=Architettura raccomandata, alternative scartate e responsabilita che resteranno custom.
- [ ] ID=GATE-3, Priority=P0, Title=Piano incrementale, Requirement=Fasi, commit previsti, test per fase e criteri di rollback.
- [ ] ID=GATE-4, Priority=P0, Title=Migrazione dati, Requirement=Strategia per tutti i valori runtime, non soltanto per i seed.
- [ ] ID=GATE-5, Priority=P0, Title=Approvazione esplicita, Requirement=Attendi l'approvazione dell'utente prima di implementare.

## Architettura iniziale raccomandata

Salvo diversa decisione approvata, procedi con un adapter-first:

```text
PostgreSQL + admin + cache + risoluzione lingua
                       |
                       v
             adapter dei messaggi
                       |
                       v
                  next-intl
                       |
                       v
       API legacy temporanee + API native
                       |
                       v
          Server e Client Component
```

L'adapter deve permettere di introdurre `next-intl` senza cambiare contemporaneamente tutti i consumer. `getI18n`, `useI18n` e `useT` possono restare temporaneamente come compatibility facade, ma non devono diventare un livello permanente che duplica inutilmente la libreria.

Durante la transizione deve esistere una sola fonte autorevole per i messaggi. PostgreSQL resta tale fonte finche un'eventuale migrazione completa non viene approvata ed eseguita atomicamente.

## Fasi di migrazione

Ogni fase deve produrre un commit autonomo, revisionabile e reversibile. Non includere refactoring non collegati.

- [ ] ID=PHASE-1, Priority=P0, Title=Baseline e ADR, Requirement=Completa analisi, misure, scelta architetturale e approvazione senza modificare il comportamento applicativo.
- [ ] ID=PHASE-2, Priority=P0, Title=Fondazione next-intl, Requirement=Installa e configura `next-intl` senza routing localizzato; aggiungi test minimi server/client e mantieni invariato il motore attivo oppure proteggi il nuovo percorso con un meccanismo di rollback approvato.
- [ ] ID=PHASE-3, Priority=P0, Title=Adapter compatibile, Requirement=Collega i dizionari runtime a `next-intl`, preserva fallback e missing-key reporting e confronta automaticamente gli output legacy e nuovi.
- [ ] ID=PHASE-4, Priority=P0, Title=Migrazione ICU, Requirement=Converti i messaggi da `{{param}}` a ICU `{param}` tramite procedura idempotente con dry run, report, validazione e rollback; includi seed e dati runtime.
- [ ] ID=PHASE-5, Priority=P0, Title=Validazione amministrativa, Requirement=Impedisci il salvataggio di nuovi valori ICU non validi e mostra errori utili senza perdere il testo inserito.
- [ ] ID=PHASE-6, Priority=P0, Title=Pilota, Requirement=Migra un namespace o una piccola area rappresentativa che includa almeno un Server Component e un Client Component; verifica parita prima di estendere la migrazione.
- [ ] ID=PHASE-7, Priority=P0, Title=Migrazione dei consumer, Requirement=Converti incrementalmente le altre aree, mantenendo verdi i test e rimuovendo la facade solo dai consumer gia migrati.
- [ ] ID=PHASE-8, Priority=P1, Title=Payload per namespace, Requirement=Introduci caricamento selettivo soltanto sulla base delle misure; mantieni globali esclusivamente i messaggi realmente condivisi.
- [ ] ID=PHASE-9, Priority=P0, Title=Cutover, Requirement=Rendi `next-intl` l'unico motore dopo avere verificato tutti i consumer, i job e gli endpoint; conserva una procedura di rollback della release e dei dati.
- [ ] ID=PHASE-10, Priority=P0, Title=Rimozione legacy, Requirement=Rimuovi translator, interpolator, formatter e provider custom ridondanti; conserva solo responsabilita non coperte dalla libreria e documentane il motivo.
- [ ] ID=PHASE-11, Priority=P0, Title=Documentazione finale, Requirement=Aggiorna README, documentazione architetturale, procedure amministrative, aggiunta chiavi/lingue, troubleshooting e rollback.

## Requisiti di implementazione

- [ ] ID=IMP-1, Priority=P0, Title=Nessun routing locale, Requirement=Configura la request locale senza aggiungere cartelle `[locale]`, redirect o pathname localizzati.
- [ ] ID=IMP-2, Priority=P0, Title=Server first, Requirement=Usa le API server di `next-intl` nei Server Component e non serializzare messaggi al browser quando non servono a Client Component.
- [ ] ID=IMP-3, Priority=P0, Title=Client minimo, Requirement=Passa ai provider client soltanto i messaggi necessari ai relativi subtree o namespace, quando la misurazione giustifica lo splitting.
- [ ] ID=IMP-4, Priority=P0, Title=ICU sicuro, Requirement=Usa ICU Message Format per interpolazione e plurali; non introdurre HTML non fidato o `dangerouslySetInnerHTML`.
- [ ] ID=IMP-5, Priority=P0, Title=Fallback esplicito, Requirement=Configura e testa il fallback richiesto invece di affidarsi accidentalmente ai default della libreria.
- [ ] ID=IMP-6, Priority=P0, Title=Missing key controllate, Requirement=Deduplica i log, non registrare parametri potenzialmente personali e mantieni un output sicuro in sviluppo e produzione.
- [ ] ID=IMP-7, Priority=P1, Title=Tipizzazione realistica, Requirement=Abilita type safety per il catalogo staticamente noto senza fingere che TypeScript conosca chiavi create runtime; valuta una generazione tipi separata solo se robusta e utile.
- [ ] ID=IMP-8, Priority=P0, Title=Cache coerente, Requirement=Definisci proprietario, chiave, versione, invalidazione, TTL e comportamento in errore di ogni cache; evita cache globali che condividono stato locale tra richieste.
- [ ] ID=IMP-9, Priority=P0, Title=Errori non distruttivi, Requirement=Una traduzione mancante o malformata non deve interrompere il rendering; gli errori di amministrazione devono essere azionabili.
- [ ] ID=IMP-10, Priority=P0, Title=Worktree sicuro, Requirement=Preserva modifiche utente preesistenti, non ripulire file non correlati e non usare operazioni Git distruttive.

## Migrazione e integrita dei dati

Non usare i soli seed come rappresentazione completa del catalogo. Prima di modificare la sintassi o lo schema, estrai e analizza i valori effettivi del database dell'ambiente autorizzato.

- [ ] ID=DATA-1, Priority=P0, Title=Backup e rollback, Requirement=Definisci backup, ripristino e compatibilita applicativa durante ogni cambio dati.
- [ ] ID=DATA-2, Priority=P0, Title=Dry run, Requirement=La migrazione elenca record convertibili, invariati, ambigui ed errati senza scrivere dati.
- [ ] ID=DATA-3, Priority=P0, Title=Idempotenza, Requirement=Eseguire nuovamente la migrazione non duplica dati e non riconverte valori gia migrati.
- [ ] ID=DATA-4, Priority=P0, Title=Convalida completa, Requirement=Compila o analizza ogni messaggio ICU in ogni lingua prima del cutover.
- [ ] ID=DATA-5, Priority=P0, Title=Atomicita, Requirement=Ogni unita di migrazione lascia il catalogo interamente nel vecchio o nel nuovo formato, mai in uno stato parziale non interpretabile.
- [ ] ID=DATA-6, Priority=P0, Title=Concorrenza, Requirement=Blocca o coordina le modifiche amministrative durante finestre incompatibili e preserva le versioni usate dall'optimistic locking.
- [ ] ID=DATA-7, Priority=P1, Title=Osservabilita, Requirement=Registra conteggi e identificatori tecnici degli errori senza esporre contenuti sensibili.

## Strategia di test

Scrivi prima i test che definiscono ogni cambiamento comportamentale. Mantieni test di caratterizzazione del legacy fino al cutover.

### Test unitari

- [ ] ID=TEST-U1, Priority=P0, Title=Fallback e missing key, Requirement=Copri lingua attiva, lingua predefinita, valore vuoto, chiave assente e deduplica dei log.
- [ ] ID=TEST-U2, Priority=P0, Title=ICU, Requirement=Copri interpolazione, apostrofi, parentesi, cardinali, ordinali, `select` e lingue con categorie plurali multiple.
- [ ] ID=TEST-U3, Priority=P0, Title=Formatter, Requirement=Copri date, orari, timezone, numeri, percentuali, valute, tempi relativi e input non validi.
- [ ] ID=TEST-U4, Priority=P0, Title=Risoluzione lingua, Requirement=Copri tutte le sorgenti, priorita, codici non validi, lingue disattivate e assenza della lingua predefinita.
- [ ] ID=TEST-U5, Priority=P0, Title=Parita, Requirement=Confronta output legacy e `next-intl` per tutti i messaggi esistenti che non cambiano intenzionalmente semantica.

### Test d'integrazione

- [ ] ID=TEST-I1, Priority=P0, Title=Database e cache, Requirement=Copri caricamento aggregato, hit, invalidazione per lingua, modifica chiave, errore DB e comportamento multi-pod simulabile.
- [ ] ID=TEST-I2, Priority=P0, Title=Azioni amministrative, Requirement=Copri creazione, modifica, cancellazione, default, attivazione, disattivazione e validazione ICU.
- [ ] ID=TEST-I3, Priority=P0, Title=Concorrenza reale, Requirement=Copri interleaving di transazioni e conflitti su metadati e valori per lingua.
- [ ] ID=TEST-I4, Priority=P0, Title=Migrazione dati, Requirement=Copri dry run, applicazione, seconda esecuzione, record non convertibile e rollback.

### Test end-to-end

- [ ] ID=TEST-E1, Priority=P0, Title=Cambio lingua, Requirement=Verifica UI pubblica e protetta, Server e Client Component e persistenza dopo logout/login.
- [ ] ID=TEST-E2, Priority=P0, Title=Stato client, Requirement=Verifica che form incompleti, modali, filtri e selezioni sopravvivano al cambio lingua.
- [ ] ID=TEST-E3, Priority=P0, Title=Fallback runtime, Requirement=Modifica o rimuovi una traduzione non predefinita e verifica il fallback senza errori console/server.
- [ ] ID=TEST-E4, Priority=P0, Title=Lingua disattivata, Requirement=Verifica switcher, profilo esistente e fallback automatico.
- [ ] ID=TEST-E5, Priority=P0, Title=Autorizzazioni, Requirement=Verifica che utenti non amministratori non possano leggere superfici riservate o mutare il catalogo.
- [ ] ID=TEST-E6, Priority=P0, Title=Conflitto amministrativo, Requirement=Due editor concorrenti non devono sovrascriversi silenziosamente.
- [ ] ID=TEST-E7, Priority=P1, Title=Route complete, Requirement=Visita tutte le principali route in almeno lingua predefinita e una secondaria senza missing key o hydration error inattesi.

## Verifiche e metriche finali

Esegui i comandi previsti dalla versione corrente di `CLAUDE.md` e dal `package.json`. Come minimo, quando disponibili e configurati:

- [ ] ID=VERIFY-1, Priority=P0, Title=Lint, Requirement=Il lint passa senza nuove esclusioni ingiustificate.
- [ ] ID=VERIFY-2, Priority=P0, Title=Unit test, Requirement=La suite Vitest passa.
- [ ] ID=VERIFY-3, Priority=P0, Title=Integration test, Requirement=La suite DB passa su un database esplicitamente autorizzato.
- [ ] ID=VERIFY-4, Priority=P0, Title=Build, Requirement=La build di produzione passa.
- [ ] ID=VERIFY-5, Priority=P0, Title=E2E, Requirement=La suite Playwright/pytest rilevante passa.
- [ ] ID=VERIFY-6, Priority=P1, Title=Payload, Requirement=Confronta dimensioni raw e compresse dei messaggi, payload RSC e JavaScript client prima/dopo per route rappresentative.
- [ ] ID=VERIFY-7, Priority=P1, Title=Performance cache, Requirement=Confronta query, hit/miss e tempo di costruzione dei dizionari prima/dopo.

Una regressione misurabile deve essere spiegata e approvata. Non usare una soglia arbitraria senza baseline; indica valore assoluto, percentuale, condizioni di misura e motivazione.

## Criteri di completamento

La migrazione puo essere dichiarata completa soltanto quando:

- [ ] ID=DONE-1, Priority=P0, Title=Unico motore, Requirement=`next-intl` e l'unico motore che risolve e formatta i messaggi UI.
- [ ] ID=DONE-2, Priority=P0, Title=Nessun consumer legacy, Requirement=Una ricerca statica e i test confermano che nessun consumer usa accidentalmente il vecchio translator o formatter.
- [ ] ID=DONE-3, Priority=P0, Title=Catalogo valido, Requirement=Tutti i valori persistiti risultano validi secondo la sintassi finale.
- [ ] ID=DONE-4, Priority=P0, Title=Invarianti rispettate, Requirement=Tutti gli elementi `INV-*` sono verificati.
- [ ] ID=DONE-5, Priority=P0, Title=Suite verdi, Requirement=Tutte le verifiche applicabili `VERIFY-*` sono completate con evidenza recente.
- [ ] ID=DONE-6, Priority=P0, Title=Legacy rimosso, Requirement=Codice custom ridondante eliminato; ogni parte conservata ha responsabilita, test e motivazione documentati.
- [ ] ID=DONE-7, Priority=P0, Title=Rollback provato, Requirement=La procedura di rollback applicativo e dati e documentata e almeno simulata in un ambiente sicuro.
- [ ] ID=DONE-8, Priority=P0, Title=Documentazione aggiornata, Requirement=Architettura, operazioni, amministrazione, aggiunta lingue/chiavi e troubleshooting riflettono il sistema finale.

## Non-obiettivi

- [ ] ID=NONGOAL-1, Priority=P0, Title=Nessun routing localizzato, Requirement=Non introdurre URL per lingua, SEO multilingua o pathname tradotti salvo una futura richiesta separata.
- [ ] ID=NONGOAL-2, Priority=P0, Title=Nessuna traduzione automatica, Requirement=Non integrare servizi AI o translation management esterni salvo richiesta separata.
- [ ] ID=NONGOAL-3, Priority=P0, Title=Nessun refactoring opportunistico, Requirement=Non modificare autenticazione, RBAC, navigazione o design system oltre a quanto strettamente necessario alla migrazione.
- [ ] ID=NONGOAL-4, Priority=P0, Title=Nessuna perdita funzionale, Requirement=Non semplificare eliminando pannelli admin, preferenze, audit, cache coherence o controllo di concorrenza.

## Condizioni di arresto

Fermati e chiedi istruzioni invece di assumere quando:

- non e disponibile un database autorizzato necessario per inventariare o migrare valori runtime;
- una migrazione proposta puo perdere o rendere illeggibili dati esistenti;
- la versione compatibile di `next-intl` richiede un cambiamento sostanziale non previsto;
- i test baseline sono gia falliti e non e possibile distinguere regressioni da problemi preesistenti;
- emergono conflitti con modifiche utente presenti nel worktree;
- serve cambiare URL, autenticazione, autorizzazioni o infrastruttura di produzione;
- una fase non dispone di un rollback praticabile.

## Output richiesti al termine

Consegna:

- [ ] ID=OUT-1, Priority=P0, Title=Decisioni, Requirement=ADR finale con alternative, motivazioni e responsabilita rimaste custom.
- [ ] ID=OUT-2, Priority=P0, Title=Migrazione, Requirement=Codice, schema e dati migrati tramite commit incrementali e reversibili.
- [ ] ID=OUT-3, Priority=P0, Title=Evidenze, Requirement=Output sintetico di test, build ed E2E eseguiti.
- [ ] ID=OUT-4, Priority=P1, Title=Misure, Requirement=Tabella prima/dopo di payload e prestazioni rilevanti.
- [ ] ID=OUT-5, Priority=P0, Title=Operazioni, Requirement=Runbook di deploy, validazione post-deploy e rollback.
- [ ] ID=OUT-6, Priority=P0, Title=Rapporto finale, Requirement=Elenco file modificati, dati migrati, rischi residui, debito accettato e lavoro futuro escluso.

Non dichiarare il lavoro completato se rimangono checklist P0 non soddisfatte. Marca come completati soltanto i requisiti verificati con evidenza; per quelli non applicabili registra una motivazione esplicita invece di considerarli implicitamente superati.
