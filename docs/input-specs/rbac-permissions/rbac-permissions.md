# Implementazione del sistema dei permessi (RBAC)

Implementa un sistema di autorizzazione basato su RBAC (Role Based Access Control) seguendo le specifiche riportate di seguito.

## Obiettivi

L'applicazione possiede già:

* autenticazione tramite JWT;
* gestione degli utenti;
* gestione dei ruoli;
* associazione Utente → Ruolo.

Occorre implementare il sistema dei permessi associati ai ruoli.

## Concetti

I permessi rappresentano le operazioni che un utente è autorizzato a eseguire all'interno dell'applicazione.

Ogni permesso è identificato da un codice univoco, ad esempio:

* users.create
* users.read
* users.update
* users.delete
* reports.view
* reports.export
* settings.manage

Il codice del permesso rappresenta il contratto tra il codice dell'applicazione e il database.

## Architettura

Il sistema deve essere composto da:

* tabella dei permessi;
* relazione Ruolo → Permesso;
* servizio di autorizzazione centralizzato;
* annotazione (o meccanismo equivalente) per dichiarare il permesso richiesto da ogni endpoint;
* filtro/interceptor che esegua automaticamente il controllo;
* cache dei permessi (facoltativa ma prevista dall'architettura).

La logica di autorizzazione non deve essere distribuita nei controller o nei servizi applicativi.

## Database

Creare una tabella `permissions` con almeno i seguenti campi:

* id
* code (univoco)
* description
* category
* type
* enabled

dove:

* `code` contiene il codice del permesso (es. `users.create`);
* `description` è una descrizione leggibile;
* `category` serve a raggruppare i permessi nella console di amministrazione;
* `type` distingue il tipo di permesso;
* `enabled` abilita o disabilita il permesso.

Creare inoltre la tabella di relazione:

`role_permissions`

contenente almeno:

* role_id
* permission_id

## Tipologie di permessi

Il sistema deve distinguere due tipologie.

### Permessi APPLICATION

Sono i permessi che proteggono le funzionalità dell'applicazione.

Caratteristiche:

* sono definiti dal software;
* vengono controllati dal backend;
* sono utilizzati per autorizzare API e servizi;
* il loro codice è stabile e non modificabile dagli amministratori.

Esempi:

* users.create
* users.delete
* reports.export

### Permessi MENU

Servono esclusivamente a controllare la visibilità delle voci di menu.

Caratteristiche:

* possono essere creati dinamicamente quando un amministratore crea nuove voci di menu;
* non proteggono la logica applicativa;
* sono utilizzati esclusivamente dalla UI.

Esempio:

* menu.maps_google.view

## Sincronizzazione dei permessi

I permessi APPLICATION non devono essere creati manualmente dagli amministratori.

Ad ogni nuova versione dell'applicazione, il sistema deve sincronizzare automaticamente il catalogo dei permessi nel database tramite migration, bootstrap o startup synchronization.

La sincronizzazione deve:

* inserire i nuovi permessi mancanti;
* aggiornare descrizione e categoria se cambiano;
* non eliminare automaticamente i permessi già esistenti.

## Console di amministrazione

Realizzare una console che permetta di:

* visualizzare tutti i permessi;
* filtrarli per categoria;
* filtrarli per tipo;
* modificarne descrizione e categoria;
* assegnarli ai ruoli;
* rimuoverli dai ruoli.

Il campo `code` deve essere di sola lettura.

## JWT

Il JWT contiene esclusivamente:

* userId
* username
* ruoli

I permessi non devono essere inseriti nel token.

Per ogni richiesta il sistema deve:

1. validare il JWT;
2. estrarre i ruoli;
3. recuperare i permessi associati ai ruoli (preferibilmente tramite cache);
4. verificare che il permesso richiesto sia presente.

## Servizio di autorizzazione

Implementare un `AuthorizationService` centralizzato.

Esporre almeno un metodo equivalente a:

```java
boolean hasPermission(UserContext user, String permission)
```

Il servizio deve:

* recuperare tutti i permessi dei ruoli dell'utente;
* verificare il possesso del permesso richiesto;
* essere facilmente estendibile con wildcard e gerarchie future.

## Protezione delle API

Ogni endpoint deve dichiarare il permesso necessario.

Esempio:

```java
@RequirePermission("users.create")
```

oppure un meccanismo equivalente.

Il controller deve limitarsi a dichiarare il permesso richiesto.

L'intera logica di autorizzazione deve essere centralizzata.

## Flusso di esecuzione

Request

↓

JWT Authentication Filter

↓

Validazione del JWT

↓

Estrazione dei ruoli

↓

Authorization Service

↓

Recupero dei permessi

↓

Verifica del permesso richiesto

↓

Controller

## Menu dinamici

L'applicazione dispone già di un sistema di menu configurabile a runtime.

L'amministratore può creare nuove voci di menu.

Quando viene creata una nuova voce, il sistema può creare automaticamente un permesso di tipo MENU, ad esempio:

`menu.maps_google.view`

Questo permesso viene assegnato ai ruoli per determinare quali utenti visualizzano la voce di menu.

La protezione della funzionalità sottostante continua comunque ad essere demandata ai permessi APPLICATION.

## Estendibilità

L'architettura deve essere progettata in modo da consentire facilmente future estensioni, tra cui:

* permessi gerarchici (`users.*`);
* wildcard;
* multi-tenant;
* ABAC (Attribute Based Access Control);
* controlli a livello della singola risorsa (record-level security).

## Obiettivo finale

Realizzare un sistema di autorizzazione robusto, centralizzato ed estendibile, con una chiara separazione tra:

* autenticazione;
* autorizzazione;
* gestione degli utenti;
* gestione dei ruoli;
* gestione dei permessi;
* gestione dei menu dinamici.

L'obiettivo è evitare logica di autorizzazione distribuita nel codice, mantenendo tutte le verifiche centralizzate e facilmente manutenibili.
