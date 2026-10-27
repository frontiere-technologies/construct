# Multi-tenancy: stato dell'implementazione

Aggiornato: 2026-10-26. Tiene insieme in un'unica tabella quello che è fatto e quello che resta.
Le voci dettagliate restano nel [documento delle cose rimandate](2026-10-13-multi-tenancy-deferred.md)
(ID `DEF-*`) e nelle specifiche dei singoli pezzi.

## Sommario

- **Fatti:** pezzo 1 (fondamenta dell'isolamento) con il lavoro sulle prestazioni, pezzo 2 (tenant
  e appartenenze), pezzo 4 (tenant corrente). Database di sviluppo alla migrazione 0056.
- **In corso:** pezzo 5 (piattaforma), fase di specifica; proposta di dividerlo in 5a (console,
  amministratore di piattaforma, assistenza, registro) e 5b (funzioni concesse, limiti,
  esportazione ed eliminazione).
- **Da fare dopo:** pezzo 3 (identità e accesso), poi pezzo 6 (domini e brand). Ordine consigliato:
  5 → 3 → 6; si inverte 5 e 3 se servono a breve persone vere di organizzazioni separate.

## Come si legge

- **Stato:** `[✅]` fatto e unito su `development`; `[~]` in corso; `[ ]` da fare.
- **Priorità:** P0 bloccante per il pezzo, P1 importante, P2 utile, P3 facoltativo.
- **Stima:** tempo per un sistema di sviluppo assistito (Claude e simili), non per una persona:
  `minutes`, `hours`, `days`, `weeks`.
- **Riferimento:** specifica, voce `DEF-*` o pull request.

## Tabella

| Stato | ID | Pezzo | Attività | Descrizione | Priorità | Stima | Riferimento | Note |
|---|---|---|---|---|---|---|---|---|
| [✅] | MT-1.1 | 1 | Colonna `id_tenant` e RLS forzata | Ogni tabella di tenant ha `id_tenant` e una policy restrittiva; il database rifiuta letture e scritture senza tenant. | P0 | days | spec 2026-10-13, PR #82 | Migrazioni 0044–0047 |
| [✅] | MT-1.2 | 1 | Porte verso il database | `withTenant` / `withGlobal`; tenant impostato solo nella transazione. | P0 | days | spec 2026-10-13, PR #82 | |
| [✅] | MT-1.3 | 1 | Ruoli del database | `construct_owner` senza BYPASSRLS, `construct_runtime`, `boundary-check`. | P0 | hours | PR #82 | |
| [✅] | MT-1.4 | 1 | Prestazioni dopo l'isolamento | Autorizzazione in un'istruzione sola, letture in parallelo, tetti dei viaggi verso il database. | P1 | days | spec 2026-10-15, PR #83, #84 | Pagine con metà dei viaggi |
| [ ] | MT-1.5 | 1 | Rifiniture dei controlli di confine | Contratto di schema e `boundary-check` più severi (policy, viste, proprietario, PostgreSQL 15 in CI). | P1 | days | DEF-1.1…1.11 | Non sono difetti dell'isolamento |
| [✅] | MT-2.1 | 2 | Appartenenze ai tenant | `tenant_membership` con stati attivo/disattivato; ruoli solo per i membri. | P0 | days | spec 2026-10-20, PR #86 | Stati invitato/in attesa nel pezzo 3 |
| [✅] | MT-2.2 | 2 | Disattivazione per tenant | "Disattiva" agisce sul tenant corrente; regola dell'ultimo amministratore per tenant. | P0 | hours | PR #86, migrazione 0052 | |
| [✅] | MT-2.3 | 2 | Pagina Utenti dai membri | Elenco solo dei membri del tenant; "Aggiungi persona" per email con risposta neutra. | P1 | days | PR #86 | |
| [✅] | MT-2.4 | 2 | Tenant modello e creazione | Modello copiato in ogni tenant nuovo; comando `db.mjs tenant-create`. | P1 | days | PR #86 | |
| [ ] | MT-2.5 | 2 | Lingue e traduzioni per tenant | Lingue attive e traduzioni personalizzate per tenant. | P2 | days | DEF-2.4 | Oggi globali, modificabili solo dal predefinito |
| [ ] | MT-2.6 | 2 | Raccolta di temi per tenant | Più temi con nome, uno attivo. | P3 | days | DEF-2.5 | Oggi un tema per tenant |
| [ ] | MT-2.7 | 2 | Eliminare il ruolo 2 | Togliere "Tenant Super Administrator", ruolo senza logica. | P2 | minutes | DEF-2.7 | Insieme all'amministratore di piattaforma (5a) |
| [ ] | MT-3.1 | 3 | Identità per provider | Tabella `user_identity` (provider, issuer, subject), non solo email. | P0 | days | DEF-3.1 | |
| [ ] | MT-3.2 | 3 | Inviti per tenant | Appartenenza "invitato", accettazione, risposta sempre neutra. | P0 | days | DEF-3.2 | |
| [ ] | MT-3.3 | 3 | Decisione sul reset della password | Password unica: decidere se un reset da un tenant vale per tutti. | P1 | minutes | DEF-3.3, MT-DEC-07 | Decisione del proprietario |
| [ ] | MT-3.4 | 3 | Domini verificati | Dominio email del cliente verificato via DNS; ingresso automatico nel suo tenant. | P1 | days | DEF-3.4 | |
| [ ] | MT-3.5 | 3 | Provider di accesso per tenant | Provider OIDC configurati per tenant, segreti cifrati. | P1 | days | DEF-3.5 | |
| [ ] | MT-3.6 | 3 | Limiti di accesso per tenant | Tentativi di accesso contati anche per tenant. | P2 | hours | DEF-3.6 | |
| [✅] | MT-4.1 | 4 | Tenant nel token | Tenant scelto nel token, ricontrollato a ogni richiesta senza viaggi in più. | P0 | days | spec 2026-10-21, PR #87 | |
| [✅] | MT-4.2 | 4 | Tenant dall'indirizzo | Registro `tenant_host`; indirizzi dedicati e indirizzo principale. | P0 | days | PR #87 | Prova con `a.localhost`, `b.localhost` |
| [✅] | MT-4.3 | 4 | Scelta e cambio di tenant | Pagina di scelta a schede, ultimo tenant usato, selettore nella barra laterale. | P1 | days | PR #87 | |
| [✅] | MT-4.4 | 4 | Registrazioni autonome per tenant | Interruttore nelle impostazioni del tenant; registrazione nel tenant dell'indirizzo. | P1 | hours | PR #87 | |
| [✅] | MT-4.5 | 4 | Link e pagine prima dell'accesso | Tema e link nelle email dal tenant dell'indirizzo, mai dall'intestazione `Host`. | P0 | hours | PR #87 | |
| [✅] | MT-4.6 | 4 | Test fra tenant su ogni ingresso | 63 ingressi provati con i dati di un altro tenant; fallisce se ne compare uno nuovo senza caso. | P0 | days | PR #87 | |
| [ ] | MT-4.7 | 4 | Cache per singolo tenant | Svuotare la cache delle pagine solo per il tenant che cambia. | P3 | hours | DEF-4.5 | Oggi si svuota per tutti |
| [~] | MT-5.1 | 5a | Amministratore di piattaforma | Attributo dell'account, non del tenant; il primo da comando, gli altri dalla console. | P0 | days | DEF-5.1, MT-DEC-03 | Specifica in corso |
| [ ] | MT-5.2 | 5a | Console: elenco e creazione dei tenant | Griglia dei tenant, "Nuovo tenant" con nome, slug, indirizzo e primo amministratore invitato per email. | P0 | days | DEF-5.3 | Sostituisce `tenant-create` da comando |
| [ ] | MT-5.3 | 5a | Console: scheda del tenant | Stato (attivo, sospeso, archiviato), indirizzi, amministratori, reinvio dell'invito. | P0 | days | DEF-5.3 | |
| [ ] | MT-5.4 | 5a | Accesso di assistenza | "Entra come piattaforma" con motivo, durata limitata e fascia visibile; permette di modificare il modello dall'app. | P1 | days | DEF-5.5 | |
| [ ] | MT-5.5 | 5a | Registro delle operazioni | Tabella `audit_event` scritta nella stessa transazione della modifica. | P1 | days | DEF-5.6 | |
| [ ] | MT-5.6 | 5a | Cataloghi comuni alla piattaforma | Lingue e traduzioni modificabili dall'amministratore di piattaforma, non più dal solo predefinito. | P1 | hours | final review pezzo 4 | |
| [ ] | MT-5.7 | 5b | Funzioni concesse per tenant | Quali aree dell'app un tenant può usare, rispettate nei controlli e nel database. | P1 | days | DEF-5.2, DEF-5.4, MT-DEC-04 | Decisione del proprietario |
| [ ] | MT-5.8 | 5b | Interruttore delle funzioni di tenant | Spegnere console e selettore per un'applicazione derivata con un solo tenant. | P2 | hours | DEF-5.7 | |
| [ ] | MT-5.9 | 5b | Limiti per tenant | Tempo massimo delle query, quote su utenti, ruoli, voci di menu. | P2 | days | DEF-5.8 | |
| [ ] | MT-5.10 | 5b | Esportazione ed eliminazione di un tenant | Esportazione completa, prova di ripristino, eliminazione sicura. | P2 | days | DEF-5.9 | |
| [ ] | MT-6.1 | 6 | Sottodomini e domini dedicati | Domini veri con certificati automatici su Kubernetes. | P1 | days | DEF-6.1, WL-03 | |
| [ ] | MT-6.2 | 6 | Accesso unico su più domini | Dominio di accesso centrale; Google utilizzabile anche sugli indirizzi dedicati. | P1 | days | DEF-6.2 | Oggi Google solo sull'indirizzo principale |
| [ ] | MT-6.3 | 6 | Brand prima dell'accesso | Logo e pagina d'ingresso per tenant; pagina "organizzazione non trovata" sui sottodomini sconosciuti. | P2 | days | DEF-6.3, WL-02, TB-DEC-05 | |
| [ ] | MT-X.1 | trasversale | Id di richiesta nei log | `requestId`, `userId`, `tenantId` in ogni riga di log. | P1 | hours | DEF-X.1 | |
| [ ] | MT-X.2 | trasversale | Guida per le applicazioni derivate | Come aggiungere tabelle di tenant o globali e servizi con `withTenant`. | P1 | hours | DEF-X.2 | |
| [ ] | MT-X.3 | trasversale | Data API di Supabase disattivata | Impostazione di progetto negli ambienti Supabase. | P1 | minutes | DEF-X.3 | Operatività |
| [ ] | MT-X.4 | trasversale | Versione di PostgreSQL in produzione | Almeno 15, con le correzioni di sicurezza note. | P2 | minutes | DEF-X.4 | Quando esisterà una produzione |
| [ ] | MT-X.5 | trasversale | Id pubblici non indovinabili | Decidere se usare UUID negli URL e nelle API. | P3 | minutes | DEF-X.5, MT-DEC-09 | |
| [ ] | MT-X.6 | trasversale | Dipartimenti sotto il tenant | Albero facoltativo dentro un tenant. | P3 | hours | DEF-X.6, MT-DEC-05 | Solo se serve a un cliente |
| [ ] | MT-X.7 | trasversale | Regola per le cache di Next.js | Ogni cache riceve il tenant come argomento. | P3 | minutes | DEF-X.7 | Oggi nessuna cache usata |
| [ ] | MT-X.8 | trasversale | Runner della CI di nuovo su ubuntu-latest | Oggi fissato su Ubuntu 24.04 perché Playwright non supporta ancora la 26.04. | P2 | minutes | PR #87 | Quando si aggiorna Playwright |
