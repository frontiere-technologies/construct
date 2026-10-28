# Specifica — Multi-tenancy, pezzo 5a: piattaforma (2026-10-26)

Prima metà del quinto dei sei pezzi della multi-tenancy. Si appoggia su:

- le specifiche dei pezzi [1](2026-10-13-multi-tenancy-foundations-design.md),
  [2](2026-10-20-multi-tenancy-piece-2-memberships-design.md) e
  [4](2026-10-21-multi-tenancy-piece-4-current-tenant-design.md);
- il [documento delle cose rimandate](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md),
  voci DEF-5.1, DEF-5.3, DEF-5.5, DEF-5.6, DEF-2.7;
- la [tabella dello stato](../../input-specs/multi-tenancy/multi-tenancy-roadmap.md), voci MT-5.1…5.6 e
  MT-2.7;
- lo [studio](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-study.md), MT-DEC-03.

Le decisioni sono state prese con il proprietario del progetto il 2026-10-26. Le scelte lasciate a
chi scrive la specifica sono segnate "**scelta di progetto**".

## Sommario

**Perché.** Dopo il pezzo 4 i tenant funzionano, ma la piattaforma li gestisce da comando o via SQL:
creazione con un link stampato a schermo, indirizzi da comando, modello modificabile solo via SQL,
lingue e traduzioni modificabili solo dal tenant predefinito, nessuna traccia di chi ha cambiato
cosa. Prima di mettere dentro clienti veri serve una console per la piattaforma e un registro delle
operazioni.

**Dopo questo pezzo:**

- il proprietario della piattaforma è **amministratore di piattaforma**: una qualità del suo
  account, non di un tenant;
- dalla **console** vede tutti i tenant, ne crea di nuovi (il primo amministratore riceve un'email
  d'invito), li sospende, li archivia, gestisce indirizzi e amministratori;
- entra in un tenant **solo con il permesso** del suo amministratore, per un tempo limitato, con
  una fascia visibile; nel modello entra sempre;
- ogni modifica finisce in un **registro**: la piattaforma vede gli eventi della piattaforma,
  l'amministratore di un tenant vede quelli del suo tenant, compresi gli interventi della
  piattaforma;
- **lingue e traduzioni** le modifica la piattaforma.

Il pezzo 5b (dopo) porterà funzioni concesse per tenant, limiti, esportazione ed eliminazione.

## Decisioni

- [✅] ID=MT5-DEC-1, Title=Amministratore di piattaforma come qualità dell'account, Requirement=È un attributo dell'account (globale), non un ruolo di un tenant. Non rende membro di nessun tenant e non dà accesso ai dati dei tenant. La persona può restare anche membro normale di qualche tenant, dove lavora come chiunque altro. **Scelta di progetto** per quest'ultima parte.
- [✅] ID=MT5-DEC-2, Title=Primo amministratore di piattaforma da comando, Requirement=Il primo si nomina con un comando di `db.mjs` (una volta sola); gli altri li nomina o li toglie un amministratore di piattaforma dalla console. Non si può togliere l'ultimo.
- [✅] ID=MT5-DEC-3, Title=Console sull'indirizzo principale, Requirement=La console sta solo sull'indirizzo principale, in una sezione "Piattaforma" della barra laterale visibile solo agli amministratori di piattaforma. Chi è amministratore di piattaforma ma non è membro di nessun tenant sull'indirizzo, dopo l'accesso arriva sulla console invece che sul messaggio "Non sei configurato". **Scelta di progetto.**
- [✅] ID=MT5-DEC-4, Title=Elenco dei tenant, Requirement=Griglia di tutti i tenant con nome, slug, indirizzo principale, stato, numero di persone attive, amministratori, data di creazione. Il modello è in cima, segnato a parte. Gli archiviati si vedono solo con un filtro.
- [✅] ID=MT5-DEC-5, Title=Nuovo tenant dalla console, Requirement=Modulo con nome, slug (proposto dal nome), indirizzo dedicato facoltativo, email del primo amministratore. Il tenant nasce copiato dal modello, come con `tenant-create`. Il primo amministratore riceve una vera email d'invito con il link per impostare la password, che punta all'indirizzo del tenant. Se l'account esiste già con una password, nessuna email: la console dice che può già entrare. **Scelta di progetto** per l'account esistente. Il comando `tenant-create` resta per gli script.
- [✅] ID=MT5-DEC-6, Title=Scheda del tenant, Requirement=Per ogni tenant: dati e stato, indirizzi (aggiungi, togli, scegli il principale), amministratori (aggiungi per email, rimanda l'invito), stato del permesso di assistenza, ed eventi della piattaforma su quel tenant.
- [✅] ID=MT5-DEC-7, Title=Sospeso, Requirement=Stop temporaneo. Chi lavora nel tenant ne esce alla richiesta successiva; chi prova a entrare e non ha altri tenant sull'indirizzo vede "Questo spazio è sospeso. Contatta il tuo amministratore." (non il generico "Non sei configurato"). Chi lavora anche in altri tenant li usa normalmente. I dati restano intatti; registrazioni, inviti e accessi di assistenza sono bloccati. La piattaforma lo riattiva con un clic.
- [✅] ID=MT5-DEC-8, Title=Archiviato, Requirement=Tenant chiuso ma non cancellato: per le persone vale tutto ciò che vale per il sospeso; sparisce dall'elenco principale della console (filtro "archiviati"); si ripristina con una conferma esplicita; gli indirizzi dedicati restano legati a lui finché la piattaforma non li toglie. Archiviare chiede un motivo.
- [✅] ID=MT5-DEC-9, Title=Conferme e motivi, Requirement=Ogni cambio di stato chiede una conferma; l'archiviazione e l'accesso di assistenza chiedono anche un motivo scritto, che finisce nel registro.
- [✅] ID=MT5-DEC-10, Title=Assistenza solo con permesso del tenant, Requirement=L'amministratore di un tenant concede, dalle impostazioni del tenant, "Consenti assistenza alla piattaforma" per una durata a scelta (1 ora, 1 giorno, 1 settimana) e lo revoca quando vuole. Senza permesso valido la piattaforma non può entrare. Con il permesso, dalla scheda del tenant "Entra come piattaforma" chiede un motivo; durante l'accesso c'è una fascia sempre visibile con tenant e scadenza; allo scadere, alla revoca o alla sospensione del tenant si esce da soli. In un tenant sospeso o archiviato non si entra. **Scelta di progetto** per le durate.
- [✅] ID=MT5-DEC-11, Title=Nel modello si entra sempre, Requirement=Il modello non ha persone né dati di clienti: la piattaforma ci entra senza permesso (sempre con fascia e registro), ed è così che lo modifica dall'app.
- [✅] ID=MT5-DEC-12, Title=Cosa può fare la piattaforma dentro un tenant, Requirement=Durante l'assistenza ha gli stessi permessi di un amministratore del tenant, tranne concedere o revocare il permesso di assistenza. **Scelta di progetto.**
- [✅] ID=MT5-DEC-13, Title=Emergenze fuori dall'app, Requirement=Se un tenant perde tutti gli amministratori resta la procedura di emergenza via SQL (`docs/runbooks/legacy-rbac-recovery.md`); l'app non ha un accesso senza permesso.
- [✅] ID=MT5-DEC-14, Title=Registro di tutte le modifiche, Requirement=Si registrano le modifiche della piattaforma e le modifiche fatte dentro ogni tenant (ruoli, permessi, menu, persone, stato delle appartenenze, tema, impostazioni del tenant, permesso di assistenza). Ogni voce: quando, chi ha agito, in che veste (persona del tenant o piattaforma in assistenza), quale tenant, quale operazione, su cosa, con i dettagli essenziali (prima/dopo dove ha senso). Le preferenze personali (profilo, aspetto, lingua, password) e gli accessi all'app non si registrano. **Scelta di progetto** per l'esclusione.
- [✅] ID=MT5-DEC-15, Title=Registro scritto con la modifica, Requirement=La voce del registro si scrive nella stessa transazione della modifica: se la modifica fallisce non c'è la voce, se la voce non si può scrivere la modifica non avviene. Le voci non si modificano né si cancellano dall'app. **Scelta di progetto** per la non modificabilità.
- [✅] ID=MT5-DEC-16, Title=Due viste separate del registro, Requirement=La piattaforma vede solo gli eventi della piattaforma: creazione, cambi di stato, indirizzi, amministratori di piattaforma e di tenant nominati dalla console, ingressi e uscite di assistenza, modifiche a lingue e traduzioni (e il registro del modello, MT5-DEC-21). Non vede cosa fanno le persone dentro i tenant. L'amministratore di un tenant vede il registro del suo tenant: le modifiche delle sue persone e tutto ciò che la piattaforma ha fatto nel suo tenant, comprese le singole modifiche fatte durante l'assistenza.
- [✅] ID=MT5-DEC-17, Title=Lingue e traduzioni alla piattaforma, Requirement=Le modifiche a lingue e traduzioni (cataloghi comuni a tutti i tenant) le fa l'amministratore di piattaforma; il vincolo del pezzo 4 "solo dal tenant predefinito" sparisce. Gli amministratori dei tenant continuano a vederle.
- [✅] ID=MT5-DEC-19, Title=L'assistenza si fa dall'indirizzo principale, Requirement=Anche per un tenant con indirizzo dedicato, la piattaforma lavora in assistenza dall'indirizzo principale, quello della console: durante l'assistenza l'indirizzo principale serve quel tenant solo alla persona in assistenza. Niente passaggi di sessione fra indirizzi (arriveranno con il pezzo 6). Uscire dall'assistenza riporta alla console. **Scelta di progetto.**
- [✅] ID=MT5-DEC-20, Title=Chi scrive dove nel registro, Requirement=Le azioni della console che toccano un tenant (stato, indirizzi, amministratori, inviti, ingresso e uscita di assistenza) si scrivono nel registro della piattaforma **e** in quello del tenant, nella stessa transazione. Concessione e revoca del permesso di assistenza sono azioni del tenant: vanno nel registro del tenant; la console mostra solo lo stato attuale del permesso. Alla scadenza naturale del permesso non si scrive nulla: la voce d'ingresso riporta già la scadenza. **Scelta di progetto.**
- [✅] ID=MT5-DEC-21, Title=Il registro del modello lo legge la piattaforma, Requirement=Il modello non ha amministratori né dati di clienti: le modifiche fatte nel modello vanno nel suo registro di tenant, che la piattaforma può leggere dalla console. **Scelta di progetto.**
- [✅] ID=MT5-DEC-22, Title=Comandi nel registro, Requirement=I comandi di `db.mjs` che toccano la piattaforma (creazione di tenant, indirizzi, nomina degli amministratori di piattaforma) scrivono anch'essi nel registro della piattaforma, con veste "comando" e l'utente del sistema operativo se disponibile. **Scelta di progetto.**
- [✅] ID=MT5-DEC-23, Title=Account degli amministratori di piattaforma, Requirement=Comando e console nominano un account esistente o lo creano; un account nuovo riceve il link per impostare la password verso l'indirizzo principale (stampato dal comando, per email dalla console). Gli amministratori di piattaforma sono esclusi dall'ingresso automatico nel tenant predefinito al primo accesso, così chi non è membro di nessun tenant arriva sulla console. **Scelta di progetto.**
- [✅] ID=MT5-DEC-24, Title=Lingue e traduzioni nella console, Requirement=Le pagine di lingue e traduzioni sono raggiungibili dalla console per l'amministratore di piattaforma (anche senza tenant) e restano in sola lettura per gli amministratori dei tenant. Le scritture restano sul ruolo dell'app, perché quelle tabelle sono già globali e scrivibili dall'app, con il controllo dell'amministratore di piattaforma; vanno nel registro della piattaforma. **Scelta di progetto.**
- [✅] ID=MT5-DEC-25, Title=Inviti in un tenant sospeso, Requirement=In un tenant sospeso o archiviato la console non aggiunge amministratori né rimanda inviti, e il tenant non manda inviti né accetta registrazioni. Impostare o recuperare la password resta possibile, perché l'account è globale: la persona entra negli altri suoi tenant o vede il messaggio di tenant sospeso. **Scelta di progetto.**
- [✅] ID=MT5-DEC-18, Title=Via il ruolo 2, Requirement=Il ruolo "Tenant Super Administrator" (senza logica dal pezzo 1) si elimina da tutti i tenant e dal modello. **Scelta di progetto.**

## 1. Perimetro

### 1.1 Dentro

1. Attributo di amministratore di piattaforma, comando per il primo, gestione dalla console
   (MT5-DEC-1, 2).
2. Console sull'indirizzo principale: elenco, nuovo tenant con invito, scheda del tenant, stati
   (MT5-DEC-3…9).
3. Permesso di assistenza nelle impostazioni del tenant e accesso di assistenza; ingresso libero nel
   modello (MT5-DEC-10…13).
4. Registro con le due viste e la pagina del registro per l'amministratore del tenant
   (MT5-DEC-14…16).
5. Lingue e traduzioni modificabili dalla piattaforma (MT5-DEC-17).
6. Eliminazione del ruolo 2 (MT5-DEC-18).
7. Messaggio "Questo spazio è sospeso" (MT5-DEC-7).

### 1.2 Fuori (pezzo 5b o dopo)

- Funzioni concesse per tenant (DEF-5.2, 5.4), interruttore delle funzioni di tenant (DEF-5.7),
  limiti per tenant (DEF-5.8), esportazione ed eliminazione di un tenant (DEF-5.9): pezzo 5b.
- Inviti per tenant con stati "invitato"/"in attesa", domini verificati: pezzo 3.
- Domini veri, accesso unico su più domini, brand: pezzo 6.
- Conservazione e pulizia del registro nel tempo, esportazione del registro: dopo. **Scelta di
  progetto.**

### 1.3 Criteri di successo

- [✅] ID=MT5-OK-1, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Nessuna modifica senza voce nel registro, Fix description=Ogni azione e rotta che modifica dati di tenant o della piattaforma scrive la sua voce nella stessa transazione; un test fallisce se compare un ingresso che modifica dati senza registro.
- [✅] ID=MT5-OK-2, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=La piattaforma non vede dentro i tenant, Fix description=Senza un permesso di assistenza valido, l'amministratore di piattaforma non legge né modifica dati di un tenant (salvo il modello) e non legge il registro dei tenant; con il permesso, entra solo nel tenant che l'ha concesso e solo fino alla scadenza.
- [✅] ID=MT5-OK-3, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Ciclo di vita dalla console, Fix description=Creare un tenant (con email al primo amministratore), sospenderlo, riattivarlo, archiviarlo, ripristinarlo, gestirne indirizzi e amministratori, tutto dalla console e con le voci nel registro della piattaforma. Verificato senza browser (Task 8: azioni, registri, token, inviti, componenti con test unitari) e con il browser (Task 11: `test_platform.py` crea il tenant dalla console con l'invio dell'invito registrato, lo sospende, lo riattiva ed entra in assistenza).
- [✅] ID=MT5-OK-4, Severity=High, Complexity=Low, Priority=P1, Estimate=hours, Title=Il registro del tenant è del tenant, Fix description=L'amministratore di A vede le voci di A (comprese quelle della piattaforma in assistenza) e mai quelle di B o della piattaforma su altri tenant.
- [✅] ID=MT5-OK-5, Severity=High, Complexity=Low, Priority=P1, Estimate=hours, Title=Nessun cambiamento per chi non è piattaforma, Fix description=Chi non è amministratore di piattaforma usa l'app come dopo il pezzo 4; l'E2E esistente passa.

## 2. Database

### 2.1 Amministratore di piattaforma

Attributo globale dell'account (per esempio colonna `users.is_platform_admin boolean not null
default false`, o tabella globale dedicata con data e autore della nomina: **lasciato al piano**).
Il comando `db.mjs` per il primo (per esempio `platform-admin-add --email`) lavora con l'identità
delle migrazioni come gli altri comandi della piattaforma.

### 2.2 Scrivere i dati della piattaforma dall'app

`tenant`, `tenant_host` e la creazione dal modello sono scritti oggi solo da `construct_owner`
(comandi `db.mjs`); il ruolo dell'app (`construct_runtime`) li legge soltanto, e la regola del pezzo
1 vieta le funzioni `security definer`. Per la console serve quindi un'identità di piattaforma
separata: un utente del database dedicato alle sole operazioni della console, membro di
`construct_owner` come l'utente delle migrazioni, senza BYPASSRLS, usato solo da un modulo
dell'app riservato alla piattaforma (con un controllo automatico che nessun altro modulo lo
importi) e solo dopo aver verificato che chi chiede è amministratore di piattaforma. Le
credenziali stanno in una variabile d'ambiente propria, documentata come le altre. **Scelta di
progetto**; la forma esatta (nomi, privilegi minimi, come si provvede l'utente) è lasciata al piano,
che deve tenere il contratto di schema e `boundary-check` in regola e aggiungere un controllo su
questa identità.

### 2.3 Permesso di assistenza

Dati di tenant (scritti dall'amministratore del tenant): fino a quando vale il permesso, chi l'ha
concesso e quando. Si possono tenere in `tenant_settings` o in una tabella di tenant dedicata
(**lasciato al piano**). Un permesso scaduto o revocato non vale.

### 2.4 Registro

Due tabelle (**scelta di progetto**, per rispettare le due viste anche nel database):

- **registro del tenant**: tabella di tenant, protetta dalla RLS come le altre; la scrive l'app
  dentro la `withTenant` della modifica; la legge l'amministratore del tenant. Contiene anche le
  azioni della piattaforma in assistenza, con la veste "piattaforma".
- **registro della piattaforma**: tabella globale scritta dall'identità di piattaforma, dai comandi
  di `db.mjs` (MT5-DEC-22) e dalle modifiche a lingue e traduzioni (MT5-DEC-24), letta solo dagli
  amministratori di piattaforma. La veste distingue persona, piattaforma in assistenza e comando;
  per un comando la persona può mancare.

Colonne minime comuni: momento, persona che ha agito (id ed email al momento dell'azione), veste,
tenant (per la piattaforma: il tenant toccato, se c'è), operazione (codice stabile), oggetto (tipo e
id), dettagli (JSON con i valori essenziali, mai password o token). Nessuna modifica né
cancellazione dall'app (né dal ruolo dell'app: solo `insert` e `select`).

### 2.5 Ruolo 2

Una migrazione toglie il ruolo senza `system_key` "Tenant Super Administrator" da ogni tenant e dal
modello (le concessioni cadono in cascata). Una persona che avesse solo quel ruolo resta con il
ruolo base.

## 3. Applicazione

### 3.1 Autorizzazione

- L'istruzione unica dell'autorizzazione legge anche se la persona è amministratore di piattaforma,
  senza viaggi in più.
- Nuovi controlli per le porte della piattaforma (azioni, rotte, pagine), indipendenti dal tenant
  corrente, dichiarati come gli altri e coperti dall'inventario degli ingressi.
- Lingue e traduzioni: la scrittura richiede l'amministratore di piattaforma (MT5-DEC-17); la regola
  "solo dal tenant predefinito" del pezzo 4 si toglie.

### 3.2 Assistenza nel token

- Un nuovo stato del tenant nel token per "piattaforma in assistenza in questo tenant", con tenant,
  scadenza e motivo; rivalidato a ogni richiesta come gli altri: si esce se il permesso è scaduto o
  revocato, se il tenant non è più attivo, se la persona non è più amministratore di piattaforma, o
  se l'indirizzo non è quello principale (MT5-DEC-19).
- Durante l'assistenza l'attore ha i permessi di un amministratore del tenant (MT5-DEC-12) e ogni
  modifica va nel registro del tenant con la veste "piattaforma".
- Il modello si raggiunge con lo stesso meccanismo senza permesso (MT5-DEC-11). Non avendo un
  indirizzo dedicato, si lavora nel modello dall'indirizzo principale.
- Uscire dall'assistenza riporta alla console.

### 3.3 Console

- Area "Piattaforma" sull'indirizzo principale: elenco dei tenant (griglia come le altre dell'app),
  scheda del tenant, nuovo tenant, amministratori di piattaforma, registro della piattaforma.
- La sezione "Piattaforma" nella barra laterale non viene dal menu dei tenant (che è un dato di
  tenant): si aggiunge solo per gli amministratori di piattaforma. **Scelta di progetto**; la forma
  esatta è lasciata al piano.
- Nuovo tenant: la creazione e l'iscrizione del primo amministratore stanno in una sola operazione
  sul database; l'email d'invito parte dopo, con l'indirizzo del tenant, come gli inviti di oggi.
  "Rimanda l'invito" nella scheda.

### 3.4 Lato tenant

- Impostazioni del tenant: "Consenti assistenza alla piattaforma" con le durate e "Revoca"; mostra
  se c'è un'assistenza in corso.
- Pagina "Registro" nell'area di amministrazione del tenant, protetta da un permesso nuovo (per
  esempio `read-tenant-audit`, concesso a `TENANT_ADMIN`), con filtri per periodo, persona e tipo
  di operazione.
- Messaggio "Questo spazio è sospeso. Contatta il tuo amministratore." quando l'unico tenant della
  persona sull'indirizzo è sospeso o archiviato.
- Testi in italiano e inglese, seminati come le altre chiavi.

## 4. Test

- **Registro completo:** un inventario delle porte che modificano dati (ricavato come quello del
  pezzo 4) fallisce se una porta non scrive la sua voce o non è esentata con motivo (preferenze
  personali, accesso); per ogni porta, la voce c'è dopo il successo e non c'è dopo un fallimento.
- **Due viste:** l'amministratore di A non vede voci di B né della piattaforma su altri tenant; la
  piattaforma non legge il registro dei tenant.
- **Assistenza:** senza permesso non si entra; con permesso si entra solo in quel tenant e fino alla
  scadenza; la revoca e la sospensione fanno uscire alla richiesta successiva; durante l'assistenza
  le modifiche finiscono nel registro del tenant con la veste "piattaforma"; il modello si
  raggiunge senza permesso.
- **Ciclo di vita:** creazione (con email al primo amministratore, link all'indirizzo del tenant),
  sospensione con il messaggio dedicato, riattivazione, archiviazione con motivo, ripristino;
  indirizzi e amministratori.
- **Identità di piattaforma:** solo il modulo della piattaforma la usa; ogni porta della
  piattaforma rifiuta chi non è amministratore di piattaforma; contratto di schema e
  `boundary-check` in regola.
- **Ruolo 2:** sparito da tutti i tenant e dal modello; nessuna persona resta senza ruolo base.
- **E2E:** console (crea, sospendi, riattiva), permesso di assistenza e ingresso con fascia, pagina
  del registro del tenant; l'E2E di oggi invariato.
- **Tetti dei viaggi** invariati.

## 5. Rilascio e rischi

### 5.1 Rilascio

Migrazioni nuove (dalla 0057), il codice, e la nuova identità di piattaforma nel database con la
sua variabile d'ambiente. Sul database di sviluppo: migrazioni, provvista dell'identità e nomina
del primo amministratore di piattaforma, con conferma del proprietario, dopo il merge.

### 5.2 Rischi

- [✅] ID=MT5-RISK-1, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Identità di piattaforma troppo potente, Fix description=Un utente del database membro di `construct_owner` dentro l'app è un rischio se usato fuori dalla console: un controllo automatico deve impedire ogni import fuori dal modulo della piattaforma, e ogni porta deve verificare l'amministratore di piattaforma prima di aprire una transazione.
- [✅] ID=MT5-RISK-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Assistenza che dura oltre il permesso, Fix description=La rivalidazione a ogni richiesta deve far uscire subito a scadenza, revoca o sospensione; test con il tempo che scorre.
- [✅] ID=MT5-RISK-3, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Registro che manca su una porta, Fix description=Senza inventario, una porta nuova dimenticherebbe la voce; il test di MT5-OK-1 lo impedisce.
- [✅] ID=MT5-RISK-4, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Dati sensibili nel registro, Fix description=I dettagli non devono contenere password, token o testi d'invito; controllo nei test.

### 5.3 Limiti noti

- Il registro cresce senza pulizia (nessuna conservazione definita) fino a una decisione futura.
- L'assistenza si fa dall'indirizzo principale anche per i tenant con indirizzo dedicato
  (MT5-DEC-19); il passaggio di sessione fra indirizzi arriverà con il pezzo 6.
