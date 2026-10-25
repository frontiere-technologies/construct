# Multi-tenancy: cose rimandate dopo il pezzo 1

Data: 2026-10-13
Origine: brainstorming del 2026-10-13 sulla
[specifica del pezzo 1](../../superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md),
le fondamenta dell'isolamento. Qui c'è tutto quello che è stato deciso di **non** fare in quel
pezzo, con il pezzo in cui va fatto e il riferimento a requisiti e studio:

- [requisiti](multi-tenancy-requirements.md): TB-DEC-*, MT-*, WL-*;
- [studio](2026-10-13-multi-tenancy-study.md): MT-DEC-*, MT-DB-*, MT-APP-*, MT-AUTH-*,
  MT-PLAT-*, MT-TEST-*, MT-OPS-*.

## Sommario

Il pezzo 1 rende il database e lo strato dati multi-tenant con **un solo tenant**: nessuna
funzione nuova per chi usa l'app. Restano da fare cinque pezzi, nell'ordine in cui dipendono uno
dall'altro.

| Pezzo | Cosa porta | Decisioni ancora aperte |
|---|---|---|
| 2. Tenant e appartenenze | `tenant_membership`, disattivazione per tenant, lingue e tema per tenant, creazione di un tenant da modello | nessuna di impianto |
| 3. Identità e accesso | `user_identity`, inviti per tenant, domini verificati, provider per tenant | MT-DEC-07 |
| 4. Tenant corrente | tenant nel token, cambio di tenant, risoluzione dall'host, test HTTP fra tenant | MT-DEC-08 |
| 5. Piattaforma | amministratore di piattaforma, console, funzionalità concesse, assistenza, audit, interruttore dell'interfaccia | MT-DEC-03, MT-DEC-04 |
| 6. Domini e brand per host | sottodomini e domini dedicati, accesso con molti domini, brand prima dell'accesso | nessuna nuova |

Decisioni già prese nel brainstorming, che valgono anche per i pezzi successivi:

- schema sempre multi-tenant;
- qualunque PostgreSQL 15+;
- `construct_owner` senza BYPASSRLS;
- ruoli di sistema copiati per tenant con `system_key`;
- transazione esplicita (`withTenant`);
- pooler scelto dalla configurazione;
- tabelle nuove di tenant per default;
- `id_tenant` dal contesto;
- nessun filtro esplicito obbligatorio.

Sono nella specifica del pezzo 1 come MTF-DEC-1…12.

## Pezzo 2: tenant e appartenenze

- [ ] ID=DEF-2.1, Severity=High, Complexity=High, Priority=P0, Estimate=days, Title=Appartenenze ai tenant, Fix description=Tabella `tenant_membership (id_tenant, user_id, stato, ultimo accesso)` con stati invitato, in attesa, attivo, disattivato; sostituisce `tenantValidationPending` e `multiTenancyEnabled` nei DTO (MT-02 dei requisiti). Stato: tabella e stati active/deactivated nel pezzo 2; invited e pending nel pezzo 3.
- [✅] ID=DEF-2.2, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Disattivazione per tenant e globale, Fix description=La disattivazione di oggi (USR-03) diventa per tenant, su `tenant_membership`; `users.id_user_status` resta la disattivazione globale, riservata alla piattaforma. Risolve il limite noto di `set_user_status_guarded`, che nel pezzo 1 cambia lo stato globale ma verifica l'invariante solo nel tenant corrente. Fatto nel pezzo 2.
- [✅] ID=DEF-2.3, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=days, Title=Griglia utenti dalle appartenenze, Fix description=`lib/rbac/users-service.ts` oggi elenca tutti gli utenti; deve partire da `tenant_membership` del tenant corrente (studio §4.7). Fatto nel pezzo 2.
- [ ] ID=DEF-2.4, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=days, Title=Lingue e traduzioni per tenant, Fix description=`tenant_language (id_tenant, id_language, is_active, is_default)` con una predefinita per tenant; `translation_override`; versione del dizionario per coppia tenant-lingua; revisione del trigger `translation_key_bump_versions`; `set_default_language` per tenant; cache dei dizionari con chiave `(tenant, lingua)` (TB-DEC-04, MT-DB-9, MT-APP-3). `app_language`, `translation_key` e `translation_value` smettono di essere globali scrivibili dall'app.
- [ ] ID=DEF-2.5, Severity=Low, Complexity=Medium, Priority=P2, Estimate=days, Title=Libreria di temi per tenant, Fix description=Nel pezzo 1 `app_theme` ha solo `id_tenant` come chiave; la libreria di temi con nome e uno attivo (TB-DEC-10, PERM-07 dell'inventario) arriva qui o più avanti.
- [✅] ID=DEF-2.6, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Creazione di un tenant da modello, Fix description=Funzione di piattaforma che crea un tenant copiando voci di menu di sistema, ruoli di sistema (con `system_key`), tema e lingue predefinite, poi invita il primo amministratore (MT-08, MT-DB-10). Fatto nel pezzo 2.
- [ ] ID=DEF-2.7, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Ruolo 2 "Tenant Super Administrator", Fix description=Nel pezzo 1 resta una riga di tenant senza `system_key` e senza logica. Va eliminata quando il pezzo 5 definisce l'amministratore di piattaforma come attributo dell'identità.

## Pezzo 3: identità e accesso

- [ ] ID=DEF-3.1, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Identità OIDC per issuer e subject, Fix description=Tabella `user_identity (provider, issuer, subject)`, per Entra `(tid, oid)`; il primo accesso non cerca più l'utente per email (`lib/auth.ts:188-204`) (MT-AUTH-1, rischio nOAuth).
- [ ] ID=DEF-3.2, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Inviti per tenant, Fix description=L'invito crea un'appartenenza "invitato" e risponde sempre allo stesso modo anche se l'identità esiste (oggi `lib/auth-invitations.ts:25` lo rivela); `password_set_tokens` distingue invito (per tenant) e reimpostazione (globale) e smette di essere provvisoria (MT-AUTH-2).
- [ ] ID=DEF-3.3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Decidere MT-DEC-07, Fix description=Con identità globale la password è una sola: il reset avviato da un tenant vale per tutti. Decidere se va bene e con quale brand si presenta la mail.
- [ ] ID=DEF-3.4, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Domini verificati per tenant, Fix description=`allowed_domains` diventa `tenant_domain` con verifica DNS TXT ripetuta; ingresso automatico mai come amministratore e mai su un account esistente; `domainCache` (`lib/auth.ts:25`) con chiave per tenant (MT-AUTH-3).
- [ ] ID=DEF-3.5, Severity=Medium, Complexity=High, Priority=P1, Estimate=days, Title=Provider di accesso per tenant, Fix description=Provider OIDC configurati per tenant, segreti cifrati, login che mostra solo i provider del tenant, registrazione autonoma configurabile (MT-09).
- [ ] ID=DEF-3.6, Severity=Low, Complexity=Low, Priority=P2, Estimate=hours, Title=Limiti di accesso anche per tenant, Fix description=`auth_rate_limit` aggiunge una dimensione per tenant sui tentativi per account (MT-OPS-3).

## Pezzo 4: tenant corrente

- [✅] ID=DEF-4.1, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Tenant nel token rivalidato, Fix description=`activeTenantId` nel JWT; `resolveRequestTenant()` lo legge e il callback `jwt` rivaluta l'appartenenza a ogni richiesta; menu laterale con i ruoli del tenant corrente; nessun ingresso accetta `id_tenant` dal client (MT-APP-1, MT-06). Fatto nel pezzo 4.
- [✅] ID=DEF-4.2, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=days, Title=Cambio di tenant, Fix description=Voce "Cambia organizzazione", azione che verifica l'appartenenza e chiama `unstable_update`, ultimo tenant ricordato (MT-05, MT-APP-4). Prima decidere MT-DEC-08: selettore sempre visibile (come chiede la #12) o solo con più tenant. Fatto nel pezzo 4.
- [✅] ID=DEF-4.3, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Tenant dall'host prima dell'accesso, Fix description=Layout radice, `/api/i18n/*`, `register`, `forgot-password`, `set-password` ricavano il tenant dall'host; host sconosciuto secondo TB-DEC-05 (MT-04, MT-APP-2). Fatto nel pezzo 4.
- [✅] ID=DEF-4.4, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Test HTTP fra tenant su ogni ingresso, Fix description=Una persona del tenant A ripete ogni server action, route handler e pagina con id del tenant B: sempre 404 o 403, mai dati di B. Richiede appartenenze (pezzo 2) e tenant dal token (DEF-4.1), per questo non è nel pezzo 1 (MT-TEST-5). Fatto nel pezzo 4.
- [ ] ID=DEF-4.5, Severity=Low, Complexity=Low, Priority=P3, Estimate=hours, Title=Invalidazione della cache per tenant, Fix description=`revalidatePath('/', 'layout')` in 12 punti svuota la cache di navigazione di tutti a ogni modifica; con molti tenant valutare un'invalidazione più mirata.

## Pezzo 5: piattaforma

- [ ] ID=DEF-5.1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Decidere MT-DEC-03, Fix description=Amministratore di piattaforma come attributo dell'identità globale; decidere se può entrare in un tenant per assistenza o vedere solo metadati e aggregati.
- [ ] ID=DEF-5.2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Decidere MT-DEC-04, Fix description=Funzionalità concesse per tenant: granularità (codice, cartella del menu modello), se l'admin del tenant crea voci di menu proprie, cosa succede ai ruoli quando una concessione viene tolta.
- [ ] ID=DEF-5.3, Severity=Medium, Complexity=High, Priority=P1, Estimate=days, Title=Console di piattaforma, Fix description=Griglia e dettaglio dei tenant, ciclo di vita (attivo, sospeso, archiviato), domini, amministratori, funzionalità concesse; `withPlatform` con audit; letture fra tenant solo come aggregati (MT-10, MT-PLAT-1). La colonna `tenant.status` esiste dal pezzo 1 ma nessuno la legge.
- [ ] ID=DEF-5.4, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Funzionalità concesse rispettate, Fix description=`tenant_entitlement`, controllo in `grant-guards.ts` e vincolo nel database (MT-PLAT-2).
- [ ] ID=DEF-5.5, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Accesso di assistenza registrato, Fix description=Motivo, scadenza, fascia visibile, audit con attore reale e per conto di (MT-11, MT-PLAT-3).
- [ ] ID=DEF-5.6, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Tabella di audit, Fix description=`audit_event` scritta nella stessa transazione della modifica; sostituisce l'audit solo-log di `lib/i18n/audit.ts` e prende il posto di `role_history`, eliminata nel pezzo 1 (PERM-12, MT-PLAT-4).
- [ ] ID=DEF-5.7, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Interruttore delle funzioni di tenant, Fix description=Impostazione che, per un'applicazione derivata senza tenant, spegne console di piattaforma, selettore del tenant e risoluzione dall'host (MTF-DEC-2).
- [ ] ID=DEF-5.8, Severity=Low, Complexity=Medium, Priority=P2, Estimate=days, Title=Limiti per tenant, Fix description=`statement_timeout` in `withTenant`, quote facoltative su utenti, ruoli, voci (MT-13, MT-OPS-3).
- [ ] ID=DEF-5.9, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Esportazione ed eliminazione di un tenant, Fix description=Esportazione completa, prova di ripristino di un solo tenant, eliminazione definitiva a cascata sulle chiavi composte (MT-14, MT-TEST-6).

## Pezzo 6: domini e brand per host

- [ ] ID=DEF-6.1, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Sottodominio e dominio dedicato, Fix description=WL-03 dei requisiti, con certificati automatici su Kubernetes.
- [ ] ID=DEF-6.2, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Accesso con molti domini, Fix description=Dominio di autenticazione centrale con codice monouso, URL base dal dominio primario, cookie per host (TB-DEC-09, WL-04).
- [ ] ID=DEF-6.3, Severity=Medium, Complexity=High, Priority=P1, Estimate=days, Title=Brand prima dell'accesso, Fix description=WL-02 dei requisiti, issue [construct#3](https://github.com/frontiere-technologies/construct/issues/3) e [construct#11](https://github.com/frontiere-technologies/construct/issues/11).

## Rifiniture del pezzo 1

Note rimaste dalle revisioni del pezzo 1 e del lavoro sulle prestazioni (2026-10-14…20). Non sono
difetti dell'isolamento: rendono più severi i controlli che lo sorvegliano (test di contratto in
`lib/schema-contract.integration.test.ts` e `db.mjs boundary-check`, che vanno cambiati insieme),
così che un indebolimento futuro del confine non passi inosservato.

- [ ] ID=DEF-1.1, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Policy delle tabelle globali controllate per intero, Fix description=Oggi il contratto verifica solo che esista la policy della classe (`global_access` o `global_read`). Va verificato anche che esista `global_owner`, che ogni policy nomini i ruoli giusti (`construct_owner`, `construct_runtime`, mai PUBLIC), che una tabella `global_write` dia davvero a `construct_runtime` i permessi di scrittura, e che una `global_read` non conceda nemmeno `truncate`.
- [ ] ID=DEF-1.2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Ruoli della policy `tenant_access`, Fix description=La policy permissiva `tenant_access` è riconosciuta da nome, tipo e comando, non dai ruoli: va controllato che sia `to construct_runtime, construct_owner`, come `tenant_boundary`.
- [ ] ID=DEF-1.3, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Righe orfane nel registro, Fix description=Una riga di `app_private.table_class` per una tabella cancellata oggi viene ignorata. Il contratto e `boundary-check` devono segnalarla.
- [ ] ID=DEF-1.4, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Tutte le viste con `security_invoker`, Fix description=La specifica del pezzo 1 (§4.1) chiede `security_invoker = true` su tutte le viste; il contratto controlla solo `role_list_view`. Una vista nuova senza `security_invoker` scavalcherebbe la RLS.
- [ ] ID=DEF-1.5, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=`boundary-check` robusto su un database vecchio, Fix description=Su un database non ancora migrato (senza `construct_schema_migration`, o con il registro ma senza `public.tenant`) alcune sonde si interrompono con un errore grezzo invece di riportare FAIL. Ogni sonda deve riportare una riga.
- [ ] ID=DEF-1.6, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Valore predefinito di `id_tenant` con lo schema, Fix description=La sonda accetta qualunque espressione che contenga `current_tenant_id`; va richiesto `app_private.current_tenant_id()`.
- [ ] ID=DEF-1.7, Severity=Low, Complexity=Low, Priority=P2, Estimate=hours, Title=Vincoli unici e chiave differita nel confronto con Drizzle, Fix description=Il contratto non confronta con il modello Drizzle i vincoli unici (`role_tenant_role_key`, `menu_entry_tenant_entry_key`, `tenant_slug_key`) né il `deferrable initially deferred` di `menu_entry_parent_fkey`.
- [ ] ID=DEF-1.8, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Permesso esplicito su `apply_role_functionality_deltas`, Fix description=La funzione funziona solo grazie all'`execute` che PUBLIC ha ancora. Una migrazione deve concedere `execute` a `construct_runtime` e poi toglierlo a PUBLIC, in quest'ordine, altrimenti la modifica dei ruoli si rompe.
- [ ] ID=DEF-1.9, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=PostgreSQL 15 e utente non superuser in CI, Fix description=La specifica promette "qualunque PostgreSQL 15+", ma la CI usa PostgreSQL 17 con un superuser. Su PostgreSQL 15 un utente non superuser non può scrivere `alter role … nobypassrls` (0002, 0045). Va aggiunta in CI una variante con PostgreSQL 15 e un utente delle migrazioni con `CREATEROLE`, oppure resa condizionale quella istruzione.
- [ ] ID=DEF-1.10, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Proprietario controllato per intero, Fix description=Il contratto verifica gli oggetti di `construct_owner`, ma non che l'utente delle migrazioni ne sia membro, che il ruolo abbia `usage` e `create` su `public` e `create` sul database, né i permessi predefiniti verso `construct_runtime`.
- [ ] ID=DEF-1.11, Severity=Low, Complexity=Low, Priority=P3, Estimate=hours, Title=Test di concorrenza che mostrano di accorgersi di una fuga, Fix description=Il test di concorrenza non conta le righe esatte per tenant (una visibilità parziale non si vede) e non è mai stato fatto fallire con una fuga voluta. Aggiungere il conteggio esatto e una prova che fallisce togliendo temporaneamente la policy su un database usa e getta, con pulizia filtrata per tenant.

## Trasversali, non ancora assegnati a un pezzo

- [ ] ID=DEF-X.1, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Id di richiesta nei log, Fix description=Logger figlio per richiesta con `requestId`, `userId`, `tenantId` (MT-OPS-1). Nel pezzo 1 gli errori 42501 sono loggati con `tenantId` e modulo, ma senza id di richiesta.
- [ ] ID=DEF-X.2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Guida per le applicazioni derivate, Fix description=Come si aggiunge una tabella di tenant o globale (`protect_tenant_table`, `declare_global_table`), come si scrivono servizi con `withTenant`, come si scrive un seme in una migrazione. Consigliata subito dopo il pezzo 1, prima che un'applicazione derivata aggiunga tabelle.
- [ ] ID=DEF-X.3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Data API di Supabase disattivata, Fix description=Operatività, non codice: disattivarla a livello di progetto negli ambienti Supabase (MT-OPS-2). Le revoche nelle migrazioni restano condizionali.
- [ ] ID=DEF-X.4, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Versione di PostgreSQL in produzione, Fix description=Verificare che la produzione sia almeno sulla 17.6 (o su versioni minori con le correzioni di CVE-2024-10976 e CVE-2025-8713) e su PostgreSQL 15 o successivo (MT-OPS-4).
- [ ] ID=DEF-X.5, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Id pubblici non indovinabili, Fix description=Decidere se aggiungere `public_id` UUID per URL e API (MT-DEC-09). Non necessario per l'isolamento.
- [ ] ID=DEF-X.6, Severity=Low, Complexity=Medium, Priority=P3, Estimate=hours, Title=Dipartimenti sotto il tenant, Fix description=Albero facoltativo dentro il confine del tenant, chiesto nel commento della #12; chiedere se serve al primo cliente (MT-DEC-05).
- [ ] ID=DEF-X.7, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Regola per le future funzioni `'use cache'`, Fix description=Ogni funzione con `'use cache'` riceve `tenantId` come argomento, usa etichette `t:{id}:…` e lascia il controllo d'accesso fuori dalla cache. Oggi il progetto non usa cache di Next.js fra richieste; da scrivere nella guida di DEF-X.2.
