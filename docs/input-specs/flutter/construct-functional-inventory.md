# Construct: inventario delle funzionalità

Data: 2026-10-07
Origine: richiesta di elencare tutte le funzionalità oggi implementate da Construct, come base per
costruire da zero un'applicazione Flutter equivalente per telefono, tablet e desktop.
Fonte: il codice di `sources/microservices/web-construct` e le migrazioni in
`sources/devops/db/migrations` (0001–0040), letti direttamente. Le specifiche in
`docs/superpowers/` non sono state usate come fonte, perché in parte superate.
Aggiornamento del 2026-10-07: aggiunta la **Parte II (TO-BE)** con multi-tenancy, white labeling e
funzionalità interne governate dall'RBAC.
Aggiornamento del 2026-10-13: le decisioni e le voci sulla multi-tenancy (TB-DEC-01…05,
TB-DEC-09, TB-DEC-10, MT-01…14, WL-02…04) sono state spostate in
[multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md), perché non dipendono da Flutter.

> **Come leggere il documento.**
> La **Parte I (AS-IS)**, sezioni 1–17, descrive ciò che **esiste oggi** nel codice.
> La **Parte II (TO-BE)**, sezioni 18–22, descrive ciò che **non esiste ancora** e si vuole
> nell'app nuova. Ogni voce TO-BE ha il titolo che inizia con **[TO-BE]** e un ID con prefisso
> `MT-`, `WL-`, `PERM-` o `TB-DEC-`.

## Sommario

Construct è un **modello di applicazione gestionale**: chi lo usa ci costruisce sopra la propria
applicazione aggiungendo voci di menu. Già pronti ci sono:

- **accesso** con OIDC (Google, Microsoft Entra ID, Keycloak) o con email e password, più
  registrazione, inviti, recupero e cambio password;
- **autorizzazione a ruoli** ricaricata dal database a ogni richiesta, così che disattivare un utente
  o togliergli il ruolo di amministratore abbia effetto subito;
- **un menu di navigazione salvato nel database**, costruito da un pannello di amministrazione e
  filtrato per ruolo. Ogni voce è una categoria, una pagina esterna incorporata, un link esterno o
  un link interno;
- **quattro pannelli di amministrazione basati su griglie** (utenti, ruoli, lingue, traduzioni), con
  paginazione, ordinamento e filtri eseguiti sul server;
- **lingue e traduzioni salvate nel database**, modificabili senza rilasciare una nuova versione,
  con lingua di riserva e controllo delle modifiche concorrenti;
- **preferenze personali** (tema chiaro, scuro o automatico e dimensione del testo) e un **tema
  globale** scelto dall'amministratore, con controllo del contrasto secondo le regole WCAG;
- la parte **operativa**: controlli di salute, log strutturati, migrazioni del database, confine dei
  privilegi del database, container e Kubernetes.

Il documento è organizzato per aree. Ogni funzionalità è una casella da spuntare quando l'app
Flutter la implementa. Le stime (`Estimate`) indicano quanto impiegherebbe un sistema di vibe coding
a rifare la funzionalità in Flutter, dando per scontato che l'API esista già. Il campo `Severity`
della convenzione di AGENTS.md qui è omesso, perché non si tratta di difetti. In fondo ci sono:

- il modello dati;
- le API esistenti;
- una tabella di costanti e limiti;
- l'elenco dei **comportamenti attuali incompleti o incoerenti**, da decidere se replicare;
- le note di adattamento a telefono, tablet e desktop.

### Il conto

| Area | Voci | Sezione |
|---|---|---|
| Autenticazione e ciclo di vita dell'account | 14 | [1](#1-autenticazione-e-ciclo-di-vita-dellaccount) |
| Autorizzazione (RBAC) | 5 | [2](#2-autorizzazione-rbac) |
| Gestione utenti | 4 | [3](#3-gestione-utenti) |
| Ruoli e permessi | 5 | [4](#4-ruoli-e-permessi) |
| Costruttore del menu (Funzionalità) | 7 | [5](#5-costruttore-del-menu-funzionalità) |
| Navigazione e contenitore dell'app | 7 | [6](#6-navigazione-e-contenitore-dellapp) |
| Griglie dati | 9 | [7](#7-griglie-dati) |
| Lingue e traduzioni | 10 | [8](#8-lingue-e-traduzioni) |
| Profilo e impostazioni personali | 4 | [9](#9-profilo-e-impostazioni-personali) |
| Tema globale | 5 | [10](#10-tema-globale) |
| Componenti condivisi e accessibilità | 7 | [11](#11-componenti-condivisi-e-accessibilità) |
| Operatività | 8 | [12](#12-operatività) |
| Decisioni da prendere | 18 | [16](#16-comportamenti-attuali-da-decidere) |
| **[TO-BE]** Decisioni d'impianto | 4 (+7 spostate) | [18](#18-to-be-decisioni-dimpianto) |
| **[TO-BE]** Multi-tenancy | spostata in [multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md) | [19](#19-to-be-multi-tenancy) |
| **[TO-BE]** White labeling, anche prima dell'accesso | 6 (+3 spostate) | [20](#20-to-be-white-labeling-anche-prima-dellaccesso) |
| **[TO-BE]** Funzionalità interne governate dall'RBAC | 12 | [21](#21-to-be-funzionalità-interne-governate-dallrbac) |
| **[TO-BE]** Effetti sulle voci AS-IS | — | [22](#22-to-be-effetti-sulle-voci-as-is) |

### Schermate esistenti

| Percorso | Chi | Contenuto |
|---|---|---|
| `/login` | pubblico | accesso |
| `/register` | pubblico | richiesta di registrazione (solo email) |
| `/forgot-password` | pubblico | richiesta di reimpostazione password |
| `/set-password?token=` | pubblico, anche da autenticati | impostazione password da invito o reimpostazione |
| `/` e qualunque percorso protetto senza pagina | autenticato | pagina iniziale (solo logo) |
| `/profile` | autenticato | profilo e cambio password |
| `/settings` | autenticato | lingua, tema, dimensione del testo |
| `/embedded/:id` | autenticato con permesso sulla voce | pagina esterna incorporata |
| `/user-management` | amministratore | griglia utenti |
| `/roles-permissions` | amministratore | griglia ruoli |
| `/roles-permissions/:id` | amministratore | dettaglio ruolo e permessi |
| `/functionalities` | amministratore | albero del menu |
| `/functionalities/create` (`?parent=`) | amministratore | nuova voce di menu |
| `/functionalities/:id/edit` | amministratore | modifica voce di menu |
| `/admin/theme` | amministratore | tema globale |
| `/admin/languages` | amministratore | griglia lingue |
| `/admin/translations` | amministratore | griglia traduzioni |
| `/admin/translations/create` (`?from=`) | amministratore | nuova chiave di traduzione |
| `/admin/translations/:id/edit` (`?from=`) | amministratore | modifica chiave di traduzione |

---

> # Parte I — AS-IS
> Sezioni 1–17: ciò che esiste oggi nel codice.

## 1. Autenticazione e ciclo di vita dell'account

- [ ] ID=AUTH-01, Priority=P0, Complexity=Medium, Estimate=days, Title=Accesso con email e password
  - Campi email e password, con un pulsante per mostrare e nascondere la password. L'email viene
    normalizzata (spazi tolti, tutto minuscolo).
  - L'accesso riesce solo se l'utente esiste, ha una password impostata, è **attivo** e la password
    coincide (bcrypt, costo 12).
  - **Ogni motivo di rifiuto dà lo stesso messaggio generico** ("Email o password non corretti."):
    utente sconosciuto, utente senza password, utente disattivato, password sbagliata. Il motivo
    vero finisce solo nel log del server.
  - Il confronto bcrypt avviene sempre, anche se l'utente non esiste (con un hash fittizio), così il
    tempo di risposta non rivela se l'account c'è.
  - Limite di frequenza: 10 tentativi per email e 30 per IP ogni 15 minuti. Oltre il limite si riceve
    lo stesso errore generico.
  - Se l'accesso riesce, `auth_provider` dell'utente diventa `credentials`.
  - Collegamenti sotto il modulo: "Password dimenticata?", "Non hai un account? Registrati", e la
    nota "Problemi di accesso? Contatta l'amministratore".
  - Riquadro di conferma in base al parametro `?message=`: `password-set` ("password impostata") e
    `password-changed` ("password cambiata").

- [ ] ID=AUTH-02, Priority=P0, Complexity=High, Estimate=days, Title=Accesso OIDC (Google, Microsoft Entra ID, Keycloak)
  - Ogni provider è attivo solo se sono configurate le sue variabili d'ambiente. Entra ID usa il
    tenant indicato, se presente.
  - **Domini ammessi**: il dominio dell'email deve comparire tra le righe attive di `allowed_domains`
    (confronto esatto). L'elenco resta in memoria per 60 secondi. Se il database non risponde si usa
    l'ultimo elenco noto; se non ce n'è nessuno, ogni accesso OIDC viene rifiutato.
  - Un utente esistente ma disattivato viene rifiutato ("Accesso negato").
  - Al primo accesso l'utente viene creato o aggiornato per email: nome, provider e avatar. Lo stato
    resta quello predefinito, cioè attivo.
  - Errori mostrati in pagina: accesso negato, errore di accesso OAuth, errore nel ritorno OAuth,
    errore generico.
  - Su mobile serve OIDC con PKCE nel browser di sistema: vedi
    [la decisione DEC-01](#16-comportamenti-attuali-da-decidere).

- [ ] ID=AUTH-03, Priority=P0, Complexity=Low, Estimate=hours, Title=Ruolo "Utente registrato" assegnato a ogni accesso
  - A ogni accesso di un utente attivo viene garantito il ruolo 0 ("Utente registrato"). Se c'è già,
    non succede nulla.
  - Il ruolo 0 non si può togliere da nessuna parte.

- [ ] ID=AUTH-04, Priority=P0, Complexity=Medium, Estimate=days, Title=Sessione con ricarica di stato e ruoli a ogni richiesta
  - La sessione espone: id utente, ruoli, flag amministratore, flag account attivo, provider usato
    nella sessione corrente, nome, email, immagine.
  - **A ogni richiesta** stato e ruoli vengono riletti dal database. Un utente disattivato o tolto
    dagli amministratori perde i diritti alla richiesta successiva, senza aspettare che il token
    scada.
  - Per un account disattivato la sessione ha id vuoto, nessun ruolo e nessun diritto di
    amministratore, e l'utente viene trattato come non autenticato.
  - Durata attuale della sessione: 30 giorni (il valore predefinito di Auth.js), senza revoca lato
    server.

- [ ] ID=AUTH-05, Priority=P0, Complexity=Low, Estimate=hours, Title=Protezione delle pagine
  - Pubbliche: `/login`, `/register`, `/forgot-password`, `/set-password`.
  - Chi non è autenticato, o non è attivo, viene mandato a `/login` da qualunque altra pagina. Oggi
    **la pagina richiesta non viene ricordata**: dopo l'accesso si torna a `/`.
  - Chi è autenticato e apre `/login`, `/register` o `/forgot-password` viene mandato a `/`.
    `/set-password` resta raggiungibile, così i link d'invito funzionano anche da collegati.
  - Pagine di amministrazione (`/admin/*`, `/user-management`, `/functionalities`,
    `/roles-permissions`): chi non è amministratore torna a `/`. Le operazioni di amministrazione
    ricontrollano anche il database prima di agire.

- [ ] ID=AUTH-06, Priority=P1, Complexity=Medium, Estimate=days, Title=Registrazione autonoma
  - Si chiede **solo l'email**. Dopo l'invio compare sempre lo stesso messaggio: "Se l'email è
    autorizzata riceverai un link per completare la registrazione."
  - Sul server:
    - limite di 5 richieste per email e 30 per IP ogni 15 minuti; oltre il limite risponde 429 "Troppe
      richieste";
    - se il dominio non è ammesso, o l'account ha già una password, non manda nulla ma risponde
      comunque "ok". In questo modo non si può scoprire quali email esistono;
    - altrimenti crea l'utente (provider `credentials`, attivo, senza password) e un token d'invito
      valido **48 ore**, poi invia l'email di benvenuto con il link `/set-password?token=…`.
  - Il ruolo 0 arriva al primo accesso.

- [ ] ID=AUTH-07, Priority=P1, Complexity=Medium, Estimate=days, Title=Password dimenticata
  - Si chiede l'email e la risposta è sempre "Se l'email è registrata riceverai un link".
  - Limite di 5 richieste per email e 30 per IP ogni 15 minuti.
  - Il link parte solo se l'utente esiste **e ha già una password**. Lo stato e il dominio non
    vengono controllati.
  - Il token di reimpostazione vale **2 ore**. Emetterne uno nuovo non invalida i precedenti.

- [ ] ID=AUTH-08, Priority=P0, Complexity=Medium, Estimate=days, Title=Impostazione password da link (invito o reimpostazione)
  - La pagina controlla subito il token. Se manca mostra "Link non valido"; se è usato o scaduto
    mostra "Link non valido o scaduto. Contatta l'amministratore."
  - Il modulo ha la nuova password e la conferma. Controlli lato client, in quest'ordine: almeno 8
    caratteri, almeno una maiuscola, almeno una cifra, uguale alla conferma.
  - Il server rivalida la regola della password e applica un limite di 8 tentativi per token e 30
    per IP ogni 15 minuti.
  - Il token si consuma in una transazione con lock di riga, quindi due richieste contemporanee non
    possono usarlo entrambe. Esiti possibili:
    - non valido;
    - già usato;
    - sostituito da un invito più recente;
    - scaduto;
    - invito mai consegnato;
    - riuscito.
  - Se riesce, imposta la password e **invalida tutti gli altri token non usati** dell'utente. Poi
    l'utente va a `/login?message=password-set`; **non c'è accesso automatico**.

- [ ] ID=AUTH-09, Priority=P1, Complexity=Medium, Estimate=days, Title=Ciclo di vita degli inviti
  - Ogni invito registra: chi l'ha richiesto, lo stato di consegna (in attesa, inviato, fallito),
    l'istante del tentativo e della consegna, e il codice d'errore.
  - L'invito diventa valido solo quando l'email è stata **effettivamente inviata**. Da quel momento
    gli inviti precedenti non usati vengono marcati come sostituiti.
  - Se l'invio fallisce, i vecchi inviti consegnati restano validi.
  - Codici d'errore registrati: `server_configuration` (manca l'URL base) e
    `email_delivery_failed`.

- [ ] ID=AUTH-10, Priority=P2, Complexity=Low, Estimate=hours, Title=Invito inviato dall'amministratore (solo API)
  - `POST /api/admin/send-invite` con `{userId}` crea un invito per quell'utente e invia l'email.
  - Se l'utente ha già una password risponde "ok" senza inviare nulla.
  - **Nessuna schermata la usa oggi**: vedi [DEC-05](#16-comportamenti-attuali-da-decidere).

- [ ] ID=AUTH-11, Priority=P1, Complexity=Medium, Estimate=hours, Title=Cambio password da autenticati
  - Si trova nella pagina Profilo ed è visibile **solo se la sessione corrente è stata aperta con
    email e password**.
  - Campi: password attuale, nuova (con il suggerimento "Min. 8 caratteri, una maiuscola, un
    numero"), conferma. Controlli lato client uguali ad AUTH-08.
  - Server:
    - richiede la sessione e il provider `credentials`;
    - limite di 8 tentativi per utente e 30 per IP ogni 15 minuti;
    - valida la nuova password e verifica quella attuale con bcrypt.
  - Se riesce, mostra "Password aggiornata, stai per essere disconnesso…" e **dopo 2 secondi esegue
    il logout** verso `/login?message=password-changed`.

- [ ] ID=AUTH-12, Priority=P0, Complexity=Low, Estimate=hours, Title=Logout
  - Si trova nel pannello utente della barra laterale ("Esci") e porta a `/login`.

- [ ] ID=AUTH-13, Priority=P1, Complexity=Medium, Estimate=hours, Title=Email transazionali
  - Due modelli in HTML e testo semplice, **solo in italiano**:
    - **benvenuto/invito**: "Imposta la tua password", con validità di 48 ore;
    - **reimpostazione**: "Reimposta la password", con validità di 2 ore.
  - Invio tramite Resend (predefinito) oppure SMTP. Mittente predefinito `noreply@frontiere.io`.
  - In sviluppo, `EMAIL_DEV_OVERRIDE` dirotta tutte le email a un unico indirizzo.
  - Il link è `{AUTH_URL}/set-password?token=<uuid>`. Su mobile serve un link profondo o un link
    universale che apra l'app.

- [ ] ID=AUTH-14, Priority=P2, Complexity=Low, Estimate=hours, Title=Accesso di prova per sviluppo e test
  - Un provider "test" che accetta solo l'email, senza password, e crea l'utente se non esiste.
  - Attivo solo fuori produzione e con entrambi i flag `AUTH_TEST_CREDENTIALS` e
    `NEXT_PUBLIC_AUTH_TEST_MODE`. **L'app rifiuta di avviarsi in produzione se uno dei due è
    acceso.**
  - Nella pagina di login compare un riquadro "Accesso di test" che si può espandere.

---

## 2. Autorizzazione (RBAC)

- [ ] ID=RBAC-01, Priority=P0, Complexity=Medium, Estimate=days, Title=Ruoli e assegnazione multipla
  - Un utente può avere più ruoli. I ruoli di sistema sono:
    - **0** "Utente registrato": sempre assegnato;
    - **1** "Amministratore": l'unico che dà accesso all'amministrazione;
    - **2** "Super amministratore tenant": nessuna logica dedicata.
  - Tipi di ruolo:

    | Tipo | Rinominabile | Permessi modificabili | Eliminabile |
    |---|---|---|---|
    | SYSTEM | no | no | no |
    | SERVICE (ogni ruolo creato dalla console) | sì | sì | sì |
    | SYNCED | no | sì | sì |

  - Gli id dei nuovi ruoli partono da 100.

- [ ] ID=RBAC-02, Priority=P0, Complexity=Medium, Estimate=days, Title=Permesso sulle voci di menu
  - Concedere a un ruolo una voce di menu che è una funzionalità (`role_functionality`) è ciò che
    rende la voce visibile nella barra laterale e apribile, se è una pagina incorporata.
  - Le categorie non si concedono mai direttamente: compaiono se contengono almeno una funzionalità
    concessa.
  - Una riga presente significa permesso concesso.

- [ ] ID=RBAC-03, Priority=P2, Complexity=Medium, Estimate=days, Title=Permessi operativi
  - Esiste un albero separato di permessi "operazioni": USER_CREATE/READ/UPDATE/DELETE e
    PERMISSION_CREATE/READ/UPDATE/DELETE, raccolti sotto la categoria "Operazioni".
  - Si possono concedere e revocare per ruolo, ma **oggi nessuna parte del codice li controlla**:
    vedi [DEC-06](#16-comportamenti-attuali-da-decidere).

- [ ] ID=RBAC-04, Priority=P0, Complexity=Medium, Estimate=days, Title=Ultimo amministratore attivo protetto
  - Il database rifiuta qualunque modifica di ruoli o di stato che lascerebbe zero utenti attivi con
    il ruolo 1. Le modifiche sono serializzate con un lock consultivo.
  - Messaggi: "Non puoi rimuovere l'ultimo amministratore attivo" e "Non puoi disattivare l'ultimo
    amministratore attivo".
  - In più, l'interfaccia blocca subito l'auto-retrocessione ("Non puoi rimuovere il tuo accesso
    admin") e l'auto-disattivazione ("Non puoi disattivare il tuo account").

- [ ] ID=RBAC-05, Priority=P0, Complexity=Low, Estimate=hours, Title=Controllo amministratore lato server
  - Ogni operazione di amministrazione rilegge dal database stato e ruoli di chi la chiede, invece di
    fidarsi del token.
  - Le API delle griglie oggi si fidano invece del flag nella sessione: vedi
    [DEC-12](#16-comportamenti-attuali-da-decidere).

---

## 3. Gestione utenti

- [ ] ID=USR-01, Priority=P0, Complexity=High, Estimate=days, Title=Griglia utenti
  - Colonne (dettagli dei filtri in [GRID-02](#7-griglie-dati)):

    | Colonna | Ordinabile | Filtro | Note |
    |---|---|---|---|
    | Azioni | no | — | bloccata a sinistra |
    | Utente | sì | testo su nome **o** cognome | mostra "nome cognome", oppure l'email se mancano entrambi; ordina per nome, cognome, email |
    | Email | sì | testo | |
    | Ruoli | no | scelta singola tra tutti i ruoli | nomi separati da virgola, oppure "—" |
    | Stato | sì | Attivo / Disattivato | etichetta colorata |
    | Creato | sì | data | |
    | Aggiornato | sì | data | "—" se vuoto |

  - Ordinamento predefinito: data di creazione, dalla più recente.
  - Nella barra sopra la griglia ci sono "Azzera filtri" e la scelta delle colonne visibili. **Non
    c'è un pulsante per creare utenti.**

- [ ] ID=USR-02, Priority=P0, Complexity=Medium, Estimate=hours, Title=Gestione dei ruoli di un utente
  - Finestra "Gestisci ruoli — {nome o email}".
  - I ruoli scelti compaiono come etichette rimovibili, tranne "Utente registrato".
  - Un campo di ricerca filtra la lista; se non trova nulla mostra "Nessun ruolo trovato".
  - La lista dei ruoli ha caselle di spunta. "Utente registrato (sempre assegnato)" è spuntato e
    disabilitato.
  - Il salvataggio sostituisce l'insieme dei ruoli, aggiungendo sempre lo 0. Valgono le regole di
    RBAC-04.

- [ ] ID=USR-03, Priority=P0, Complexity=Low, Estimate=hours, Title=Attivazione e disattivazione
  - Dal menu di riga, con la conferma "Disattivare {email}?" o "Attivare {email}?".
  - Valgono le regole di RBAC-04. L'effetto è immediato alla richiesta successiva dell'utente.

- [ ] ID=USR-04, Priority=P2, Complexity=Low, Estimate=hours, Title=Cose che la gestione utenti non fa
  - Non crea, non modifica e non elimina utenti, non ne modifica i dati anagrafici e non invia inviti
    dall'interfaccia.
  - Le righe della griglia non si aprono con un clic.
  - Da replicare così com'è, o da completare: vedi [DEC-05](#16-comportamenti-attuali-da-decidere).

---

## 4. Ruoli e permessi

- [ ] ID=ROLE-01, Priority=P0, Complexity=High, Estimate=days, Title=Griglia ruoli
  - Colonne:

    | Colonna | Filtro | Note |
    |---|---|---|
    | Azioni | — | Apri; Rinomina (solo SERVICE); Elimina (non SYSTEM) |
    | ID | numero (uguale o intervallo) | |
    | Nome ruolo | testo | in grassetto |
    | Utenti associati | numero | |
    | Ha permessi | sì / no | |
    | Creato | data | |
    | Aggiornato | data | |

  - Ordinamento predefinito per ID crescente.
  - Nella barra: "Azzera filtri", colonne visibili, "Nuovo ruolo".

- [ ] ID=ROLE-02, Priority=P0, Complexity=Low, Estimate=hours, Title=Creazione, rinomina ed eliminazione di un ruolo
  - **Creazione**: finestra con il solo nome, obbligatorio dopo aver tolto gli spazi. Il ruolo nasce
    di tipo SERVICE e si apre subito il suo dettaglio. Non ci sono controlli di unicità né di
    lunghezza.
  - **Rinomina**: solo per i ruoli SERVICE, dalla griglia o dalla matita nel dettaglio.
  - **Eliminazione**: conferma distruttiva "Eliminare il ruolo «{nome}»?".
    - I ruoli SYSTEM sono vietati.
    - Non si controlla se ci sono utenti associati.
    - Il ruolo viene archiviato in `role_history` e le sue assegnazioni e i suoi permessi vengono
      eliminati a cascata.

- [ ] ID=ROLE-03, Priority=P0, Complexity=High, Estimate=days, Title=Dettaglio ruolo con albero dei permessi
  - **Intestazione**: percorso "Ruoli e permessi / Dettaglio", nome del ruolo (con la matita se
    SERVICE) e "{n} utenti associati".
  - **Sezione "Funzionalità"**: lo stesso albero del menu del costruttore, con un interruttore per
    ogni funzionalità.
  - **Sezione "Operazioni"**: l'albero dei permessi operativi. Le voci deprecate sono nascoste
    insieme ai loro discendenti.
  - **Cartelle**: hanno un controllo a tre stati (spento, acceso, parziale), calcolato su **tutte**
    le funzionalità discendenti a qualunque profondità.
    - Un clic accende tutto, oppure spegne tutto se era tutto acceso.
    - Una cartella senza funzionalità è disabilitata, con l'etichetta "vuota" e il suggerimento
      "Questa sezione non contiene funzionalità da concedere".
  - **Salva** invia solo le differenze (concessioni e revoche). Se una differenza riguarda una
    categoria, **l'intero salvataggio viene rifiutato**. In caso di errore si mostra "Salvataggio
    non riuscito".
  - **Annulla** torna alla lista senza salvare.
  - **Ruoli SYSTEM**: tutto è in sola lettura, con il suggerimento "I ruoli di sistema non sono
    modificabili".

- [ ] ID=ROLE-04, Priority=P1, Complexity=Low, Estimate=hours, Title=Data di ultima modifica del ruolo
  - Ogni salvataggio dei permessi aggiorna `date_mod` del ruolo, che compare nella griglia.

- [ ] ID=ROLE-05, Priority=P2, Complexity=Low, Estimate=hours, Title=Etichette dell'albero
  - Oggi l'albero dei permessi e quello del costruttore mostrano sempre le etichette **inglesi**,
    qualunque sia la lingua dell'interfaccia: vedi [DEC-10](#16-comportamenti-attuali-da-decidere).

---

## 5. Costruttore del menu (Funzionalità)

- [ ] ID=MENU-01, Priority=P0, Complexity=Medium, Estimate=days, Title=Albero del menu
  - Ogni riga mostra, nell'ordine:
    - una maniglia di trascinamento, disabilitata per le voci immutabili;
    - una freccia per espandere o chiudere (le categorie con figli partono aperte);
    - un'icona per tipo: cartella = categoria, codice = incorporata, globo = esterna, link = interna;
    - il nome, in grassetto per le categorie;
    - i pulsanti d'azione.
  - Azioni:
    - **Aggiungi sotto-voce (+)**: solo sulle categorie, **anche se immutabili**. Apre
      `/functionalities/create?parent={id}`;
    - **Modifica (matita)**: solo sulle voci modificabili;
    - **Elimina (cestino)**: solo sulle voci modificabili, con la conferma distruttiva "Eliminare
      «{nome}» e tutti i suoi figli?".
  - Pulsanti in alto: "Filtri" e "Crea nuovo".

- [ ] ID=MENU-02, Priority=P1, Complexity=Low, Estimate=hours, Title=Filtro dell'albero
  - Pannello laterale con un campo "Cerca" e i pulsanti Reimposta e Applica.
  - Cerca nel nome, senza distinguere maiuscole e minuscole, e tiene gli antenati delle voci trovate.
  - Mentre il filtro è attivo, il pulsante "Filtri" mostra il numero "1" e una piccola X per
    azzerarlo, e **il trascinamento è disabilitato**.

- [ ] ID=MENU-03, Priority=P0, Complexity=High, Estimate=weeks, Title=Riordino con trascinamento (mouse, touch, tastiera)
  - Si trascina solo ciò che non è immutabile. Il trascinamento parte dopo 5 px di movimento.
  - **Posizione di rilascio** in base al punto verticale sulla riga sotto il puntatore:
    - su una categoria: prima del 30 % → **prima**; dopo il 70 % → **dopo**; in mezzo → **dentro**,
      come ultimo figlio;
    - su una funzionalità: prima o dopo, con soglia al 50 %;
    - sulla voce stessa o sui suoi discendenti non si può rilasciare.
  - Indicatori: una linea con un punto, rientrata alla profondità giusta, per prima e dopo; un bordo
    evidenziato per dentro. Un'anteprima segue il puntatore.
  - **Tastiera**:
    - Invio o Spazio sollevano la voce;
    - Su e Giù spostano tra gli spazi di inserimento;
    - Destra annida dentro una categoria; Sinistra esce;
    - Invio rilascia, Esc annulla.
  - Annunci per i lettori di schermo:
    - "{nome} sollevato";
    - "verrà posizionato prima/dopo {destinazione}";
    - "verrà annidato in {destinazione}";
    - "spostato" / "annullato".
  - **Regole sul server**:
    - non si può spostare una voce dentro sé stessa o un suo discendente;
    - il nuovo genitore deve essere una categoria;
    - i fratelli di destinazione vengono rinumerati da 0 a n-1;
    - nel genitore di partenza restano buchi nella numerazione;
    - si può rilasciare anche dentro categorie immutabili (per esempio Admin).
  - Tutte le scritture sul menu sono serializzate con un lock consultivo.

- [ ] ID=MENU-04, Priority=P0, Complexity=High, Estimate=days, Title=Modulo di creazione e modifica di una voce
  - **Colonna sinistra, "Informazioni generali"**:
    - **Icona**: vedi MENU-05;
    - **Nome** nella lingua predefinita: obbligatorio, massimo 100 caratteri;
    - **Genitore**: le categorie in alto, poi "Radice", poi le categorie in basso, poi le altre. In
      modifica è escluso il sottoalbero della voce stessa. Il campo è bloccato su "Radice" solo se
      non esiste alcuna categoria;
    - **Descrizione** nella lingua predefinita: obbligatoria, massimo 500 caratteri, con il contatore
      "n/500";
    - **Tag** nella lingua predefinita: si aggiungono con Invio o uscendo dal campo; i duplicati
      vengono ignorati; si tolgono con la X.
  - **Tipo**:

    | Tipo | Effetto |
    |---|---|
    | Categoria | nessun link |
    | Link esterno incorporato | iframe |
    | Link esterno | http o https |
    | Link interno | percorso `/…` |

    - Per i tre tipi di funzionalità il **link** è obbligatorio. Non c'è alcun controllo di formato.
    - Per il link esterno c'è la casella "Apri in una nuova scheda", spuntata per default.
    - In modifica: **una categoria non può diventare funzionalità né il contrario** ("Elimina la voce
      e creane una nuova"). Si può invece passare liberamente tra incorporata, esterna e interna.
    - I tipi 4 (desktop remoto) e 5 (permesso) esistono nel database, ma non si possono creare da
      qui.
  - **Colonna destra, "Gestione traduzioni"**:
    - una sezione apribile per ogni lingua (attive e non attive), con nome, descrizione e tag
      facoltativi;
    - la lingua predefinita condivide i campi della colonna sinistra;
    - all'apertura sono espanse la lingua predefinita e l'inglese.
  - **Regole sul server**:
    - la nuova voce va in fondo ai fratelli;
    - la posizione in alto o in basso nella barra non si assegna mai alle voci create;
    - **nessun ruolo riceve automaticamente il permesso sulla nuova voce**, che resta invisibile
      finché non la si concede in Ruoli e permessi.

- [ ] ID=MENU-05, Priority=P1, Complexity=Medium, Estimate=days, Title=Scelta dell'icona
  - **Libreria**: circa 170 icone Lucide con ricerca, più l'opzione "Nessuna icona". Si salva il
    nome dell'icona (per esempio `Users`).
  - **Caricamento SVG**: clic o trascinamento, solo file `.svg`. Il contenuto viene **sanificato**
    (niente script, niente `foreignObject`, niente attributi `on*`) e salvato come testo SVG.
  - Requisiti suggeriti all'utente: `viewBox="0 0 24 24"`, `currentColor`, `stroke-width="2"`.
  - **Visualizzazione**:
    - un testo che inizia con `<svg` viene sanificato e disegnato;
    - un percorso o un URL di immagine diventa un'immagine;
    - altrimenti si cerca un'icona Lucide con quel nome, e se non esiste si mostra un punto
      interrogativo.

- [ ] ID=MENU-06, Priority=P0, Complexity=Low, Estimate=hours, Title=Voci immutabili
  - Le voci di sistema (Home, Admin e le voci di amministrazione) non si modificano, non si spostano
    e non si eliminano.
  - Non si può eliminare un sottoalbero che contiene una voce immutabile.
  - Le categorie immutabili possono comunque ricevere figli.

- [ ] ID=MENU-07, Priority=P0, Complexity=Low, Estimate=hours, Title=Eliminazione a cascata
  - Eliminare una voce elimina anche i discendenti, i tag e i permessi concessi ai ruoli.

---

## 6. Navigazione e contenitore dell'app

- [ ] ID=NAV-01, Priority=P0, Complexity=Medium, Estimate=days, Title=Costruzione del menu per l'utente
  - Si parte dall'intero menu e si tengono le funzionalità concesse a uno dei ruoli dell'utente,
    più i loro antenati. Un utente disattivato vede un menu vuoto.
  - **Etichetta**: nome nella lingua attiva, poi nella lingua predefinita, poi in inglese, poi il
    nome base.
  - **Destinazione**:
    - categoria: nessuna;
    - incorporata: `/embedded/{id}`;
    - altrimenti il link, con una `/` davanti se non inizia già con `/` o `http`.
  - Il link esterno si apre in una nuova scheda o nella stessa, secondo la voce.
  - **Posizione**: in alto, in mezzo o in basso.
  - I tag **non** sono usati dalla barra laterale.

- [ ] ID=NAV-02, Priority=P0, Complexity=High, Estimate=days, Title=Barra laterale a colonne
  - **Prima colonna**: voci in alto, voci centrali (con scorrimento), voci in basso, e in fondo il
    pulsante account.
  - Ogni categoria aperta apre una **nuova colonna** a destra, **senza limite di profondità**. Ogni
    colonna ha come intestazione il nome del genitore in maiuscolo.
  - Ricliccare una categoria aperta la chiude insieme alle colonne successive; cliccarne un'altra
    sostituisce quel livello.
  - **All'arrivo su una pagina** si aprono automaticamente le colonne che portano alla sua voce.
  - Larghezze:

    | Elemento | Compresso | Esteso |
    |---|---|---|
    | Prima colonna | 64 px | 208 px |
    | Colonne successive e pannello utente | 56 px | 192 px |

    Le transizioni durano 300 ms.
  - Una voce compressa senza icona mostra l'iniziale dell'etichetta.

- [ ] ID=NAV-03, Priority=P1, Complexity=Medium, Estimate=days, Title=Compressione delle colonne e loro memoria
  - Ogni colonna ha due pulsantini sul bordo: **chiudi** (X) e **comprimi/espandi** (freccia).
  - La X della prima colonna attiva la **compressione totale**: resta una striscia di 24 px con un
    pulsante per riaprire, e le colonne aperte vengono ripristinate.
  - **Anteprima al passaggio**: sopra la striscia, dopo 180 ms appaiono tutte le colonne sovrapposte
    al contenuto, senza spostarlo. Spariscono 180 ms dopo l'uscita del puntatore, oppure quando si
    cambia pagina.
  - Lo stato compresso o esteso di ogni colonna (dalla seconda alla nona) e la compressione totale
    sono salvati sul dispositivo. Di default la prima colonna parte compressa.
  - Le colonne aperte e il pannello utente **non** vengono salvati.

- [ ] ID=NAV-04, Priority=P0, Complexity=Medium, Estimate=hours, Title=Evidenziazione della voce attiva
  - **Voce attiva**: il link il cui percorso coincide esattamente con la pagina. Ha sfondo d'accento,
    testo medio, un bordo sottile nel colore principale e l'icona nel colore principale.
  - **Categoria antenata** della voce attiva: stesso stile, "attiva".
  - **Categoria aperta ma non antenata**: solo uno sfondo tenue, senza bordo.
  - **Profilo e Impostazioni** nel pannello utente si evidenziano quando sono la pagina corrente.
    Sulle pagine fuori dal menu nessuna voce è evidenziata.

- [ ] ID=NAV-05, Priority=P0, Complexity=Medium, Estimate=hours, Title=Pulsante account e pannello utente
  - **Pulsante account**: avatar (o un'icona generica). Da esteso mostra la parte dell'email prima
    della @ e l'email completa.
  - **Pannello utente**: intestazione con il nome dell'email in maiuscolo, poi "Profilo",
    "Impostazioni" e, in fondo, "Esci".
  - Lingua e tema **non** sono nel pannello: stanno nelle Impostazioni.
  - Aprire il pannello nasconde le colonne di navigazione.

- [ ] ID=NAV-06, Priority=P0, Complexity=Medium, Estimate=days, Title=Pagine esterne incorporate
  - `/embedded/{id}` funziona solo se la voce esiste, è di tipo incorporato, ha un link **e** è
    concessa all'utente; altrimenti l'utente torna a `/`.
  - **Prima di mostrarla** il server controlla che la pagina si possa incorporare:
    - è rifiutato tutto ciò che non è http(s);
    - sono rifiutati gli host privati, locali e riservati, sia IPv4 sia IPv6, per difesa contro
      SSRF. Si risolve il DNS e si scarta se **un qualsiasi** indirizzo è privato;
    - si fa una richiesta HEAD (con ripiego su GET) verso il primo indirizzo, con un timeout di
      4 secondi e senza seguire i redirect;
    - è rifiutato un redirect, una risposta diversa da 2xx, `X-Frame-Options` DENY o SAMEORIGIN, o
      una CSP con `frame-ancestors` che non ammette `*` né l'origine dell'app.
  - Se si può incorporare: riquadro a tutta pagina (minimo 600 px) con un indicatore di
    caricamento. Altrimenti: "Questo sito non può essere visualizzato incorporato" e il pulsante
    "Apri in una nuova scheda".
  - Il controllo non usa cache: si ripete a ogni apertura.

- [ ] ID=NAV-07, Priority=P0, Complexity=Low, Estimate=hours, Title=Pagina iniziale, errori, caricamento
  - **Pagina iniziale**: solo il logo, centrato. Qualunque percorso protetto senza una pagina propria
    mostra la pagina iniziale: non c'è un "pagina non trovata" nell'area protetta.
  - **Errore**: "Qualcosa è andato storto.", l'eventuale codice d'errore e il pulsante "Riprova".
  - **Caricamento**: un indicatore rotante con "Caricamento…".
  - Struttura: barra laterale a sinistra e contenuto a destra con un margine di 32 px. Non c'è una
    barra superiore.

---

## 7. Griglie dati

Valgono per le quattro griglie (utenti, ruoli, lingue, traduzioni).

- [ ] ID=GRID-01, Priority=P0, Complexity=High, Estimate=days, Title=Caricamento a blocchi dal server
  - Lo scorrimento è continuo: non c'è un paginatore. I blocchi sono da **50 righe**, e in memoria se
    ne tengono al massimo 10. L'altezza della griglia è fissa.
  - Il client chiede la pagina `floor(riga iniziale / 50)` e sa che la lista è finita grazie al
    `total` esatto restituito dal server.
  - Se la richiesta fallisce, il blocco resta vuoto e **non compare alcun messaggio**.
  - Stati: "Caricamento..." e "Nessun risultato".
  - Dopo ogni modifica la pagina si aggiorna e la cache della griglia si svuota.

- [ ] ID=GRID-02, Priority=P0, Complexity=High, Estimate=days, Title=Filtri per colonna
  - **Testo**: "contiene", senza distinguere maiuscole e minuscole. I caratteri `%` e `_` sono
    cercati alla lettera. Si possono combinare **fino a 2 condizioni con E/O**. Pulsanti Applica e
    Reimposta.
  - **Numero**: "uguale" oppure "nell'intervallo".
  - **Data**: "nell'intervallo", "dal" o "fino al". Entrambi gli estremi sono inclusi. L'estremo
    superiore massimo è il `9999-12-30`. Un intervallo invertito è un errore.
  - **Elenco**: una sola scelta, con la voce "Tutti" in cima. Un clic sulla voce già scelta la
    toglie. Ogni clic chiude il menu, senza bisogno di Applica.
  - Tutti i filtri sono applicati sul server. L'unico segnale di un filtro attivo è l'icona a imbuto
    nell'intestazione della colonna.

- [ ] ID=GRID-03, Priority=P0, Complexity=Medium, Estimate=hours, Title=Ordinamento
  - Su una sola colonna alla volta, crescente o decrescente.
  - Ogni griglia ha il suo ordinamento predefinito: utenti per creazione dalla più recente, ruoli
    per ID crescente, lingue per codice, traduzioni per chiave.

- [ ] ID=GRID-04, Priority=P1, Complexity=Medium, Estimate=days, Title=Stato della griglia nell'indirizzo
  - Filtri e ordinamento sono scritti nei parametri dell'URL, così si possono condividere e si
    ritrovano tornando indietro. Ricaricando la pagina vengono ripristinati.
  - I valori non validi nell'URL vengono scartati in silenzio. Un campo di ordinamento sconosciuto
    torna al predefinito.
  - Su mobile l'equivalente è la conservazione dello stato della schermata e i link profondi.

- [ ] ID=GRID-05, Priority=P1, Complexity=Low, Estimate=hours, Title=Azzera filtri
  - Svuota tutti i filtri e i relativi parametri. **L'ordinamento resta.**

- [ ] ID=GRID-06, Priority=P1, Complexity=Low, Estimate=hours, Title=Colonne visibili
  - Un pulsante "Colonne" apre un elenco di caselle, una per colonna.
  - La scelta **non viene salvata** e si azzera uscendo dalla pagina.
  - La colonna azioni non si può nascondere.

- [ ] ID=GRID-07, Priority=P1, Complexity=Low, Estimate=hours, Title=Larghezze delle colonne
  - Tutte le colonne sono ridimensionabili, con una larghezza minima di 112 px (tranne le azioni).
    Le larghezze non vengono salvate.

- [ ] ID=GRID-08, Priority=P0, Complexity=Low, Estimate=hours, Title=Menu d'azione di riga
  - Prima colonna, bloccata a sinistra e larga 56 px, con un pulsante "⋯" che apre un elenco di
    azioni (alcune possono essere disabilitate).
  - Le etichette lunghe vengono troncate con i puntini.

- [ ] ID=GRID-09, Priority=P0, Complexity=Medium, Estimate=hours, Title=Contratto delle API delle griglie
  - `POST` con un corpo JSON validato. La risposta contiene le righe e `total`.
  - Errori: 403 "Non autorizzato.", 400 "Corpo della richiesta non valido.", 500.
  - Dimensione massima della pagina: 100 per utenti e ruoli, 200 per lingue e traduzioni.
  - Lingue e traduzioni leggono pagina e totale nella stessa transazione e aggiungono l'id come
    criterio di ordinamento finale. Utenti e ruoli no: vedi
    [DEC-13](#16-comportamenti-attuali-da-decidere).
  - Dettaglio di ogni corpo di richiesta in [sezione 14](#14-api-esistenti).

---

## 8. Lingue e traduzioni

- [ ] ID=I18N-01, Priority=P0, Complexity=Medium, Estimate=days, Title=Testi dell'interfaccia dal database
  - Ogni testo dell'interfaccia è una chiave nel formato `modulo.sezione.elemento` (minuscole, cifre
    e underscore, almeno due segmenti, massimo 200 caratteri).
  - Il valore è salvato per lingua (massimo 1000 caratteri).
  - Le chiavi iniziali (in italiano e inglese) vengono create dalle migrazioni.

- [ ] ID=I18N-02, Priority=P0, Complexity=Medium, Estimate=hours, Title=Scelta della lingua attiva
  - Ordine di priorità:
    1. scelta della sessione;
    2. preferenza nel profilo;
    3. preferenza salvata sul dispositivo (un anno);
    4. lingua del browser o del sistema, abbinando prima la combinazione lingua-paese esatta e poi
       solo la lingua;
    5. lingua predefinita;
    6. prima lingua attiva;
    7. italiano di riserva se il database non risponde.
  - Si considerano solo le lingue attive.

- [ ] ID=I18N-03, Priority=P0, Complexity=Medium, Estimate=hours, Title=Lingua di riserva e chiavi mancanti
  - Si cerca il testo nella lingua attiva, poi nella lingua predefinita. **Una stringa vuota conta
    come mancante.**
  - Se manca ovunque: in sviluppo si mostra `[missing: chiave]`, in produzione la chiave stessa. Non
    si genera mai un errore.
  - Ogni chiave mancante viene segnalata una sola volta nel log (al massimo 500 chiavi distinte).

- [ ] ID=I18N-04, Priority=P0, Complexity=Low, Estimate=hours, Title=Segnaposto e formattazione
  - **Segnaposto**: `{{ nome }}`, sostituiti in un solo passaggio. Un segnaposto sconosciuto resta
    com'è. I numeri e le date nei segnaposto vengono formattati secondo la lingua.
  - **Formattatori**, che restituiscono "—" su un valore vuoto o non valido:
    - data gg/mm/aaaa;
    - ora;
    - data e ora;
    - numero;
    - percentuale (1 decimale);
    - valuta;
    - tempo relativo;
    - categoria plurale.
  - Non c'è una sintassi per i plurali nei testi: si sceglie la chiave in base alla categoria
    plurale.

- [ ] ID=I18N-05, Priority=P0, Complexity=Medium, Estimate=hours, Title=Cambio lingua
  - Il cambio avviene nella pagina Impostazioni, ed è visibile solo se ci sono almeno 2 lingue
    attive. Ogni lingua compare con il suo nome nativo.
  - Il cambio è **immediato** e conserva lo stato della schermata (finestre aperte, moduli, filtri).
  - La scelta si salva nel profilo, se l'utente è collegato, e sul dispositivo in ogni caso.
  - API: `GET/PUT /api/i18n/preferences/language`.

- [ ] ID=I18N-06, Priority=P0, Complexity=Medium, Estimate=hours, Title=Dizionari versionati e cache
  - Ogni lingua ha un numero di versione, che il database incrementa a ogni modifica di chiavi o
    valori.
  - Il server tiene in memoria il dizionario per lingua e ricontrolla le versioni ogni 15 secondi.
  - `GET /api/i18n/dictionary?code=&namespace=` restituisce il dizionario completo (o di un solo
    namespace), senza cache HTTP. Una lingua sconosciuta o non attiva diventa quella predefinita.
  - Per l'app Flutter: scaricare, salvare in locale con la versione e aggiornare quando la versione
    cambia.

- [ ] ID=I18N-07, Priority=P1, Complexity=High, Estimate=days, Title=Amministrazione delle lingue
  - **Griglia**: azioni, codice, locale, nome, nome nativo, attiva, predefinita, **tradotte**,
    **mancanti**, data di creazione. Tradotte e mancanti si contano sulle chiavi con valore non
    vuoto.
  - **Azioni**:
    - modifica;
    - attiva o disattiva (non sulla predefinita);
    - imposta come predefinita, con conferma (solo se attiva e non già predefinita);
    - elimina, con conferma distruttiva (non la predefinita).
  - **Modulo**:
    - codice di 2–3 lettere minuscole;
    - locale nel formato `ll-CC`;
    - nome e nome nativo obbligatori, massimo 80 caratteri ciascuno;
    - casella "attiva".
  - **Modelli pronti** (solo in creazione): 32 lingue comuni con nome e nome nativo calcolati dal
    sistema. La ricerca ignora maiuscole e accenti. Le lingue già presenti sono marcate "già
    presente" e non si possono scegliere. "Altra lingua…" svuota i campi.
  - **Regole**:
    - una sola lingua predefinita, che deve essere attiva;
    - la predefinita non si disattiva e non si elimina;
    - codice e locale sono unici;
    - eliminando una lingua si eliminano i suoi valori, e gli utenti che l'avevano come preferenza
      la perdono.

- [ ] ID=I18N-08, Priority=P1, Complexity=High, Estimate=days, Title=Griglia delle traduzioni
  - Colonne:
    - azioni;
    - chiave (carattere a spaziatura fissa);
    - descrizione;
    - namespace e modulo (filtri a elenco con i valori esistenti);
    - **una colonna per ogni lingua attiva**, con il valore oppure l'etichetta "mancante";
    - stato (mancante / completa);
    - aggiornato.
  - C'è anche un filtro nascosto "lingua", che limita a quella lingua il calcolo di mancante e
    completa.
  - Ogni colonna di valore ha il suo filtro di testo.
  - Aprire un elemento o crearne uno nuovo conserva i filtri della lista e li ripristina al ritorno.

- [ ] ID=I18N-09, Priority=P1, Complexity=High, Estimate=days, Title=Editor di una chiave di traduzione
  - **Informazioni generali**:
    - chiave: modificabile solo in creazione, poi in sola lettura;
    - namespace: suggerisce i valori esistenti ma accetta testo libero, e si compila da solo dal
      primo segmento della chiave finché non lo si modifica;
    - modulo: facoltativo;
    - descrizione.
  - **Valori**: un'area di testo per lingua attiva (massimo 1000 caratteri), con l'etichetta
    "mancante" quando è vuota.
  - **Pulsanti**:
    - Salva: abilitato solo se il modulo è valido e, in modifica, se qualcosa è cambiato;
    - Scarta modifiche;
    - Annulla.
  - Svuotare un valore **elimina** la traduzione per quella lingua.
  - **Controllo delle modifiche concorrenti**: ogni valore e i dati della chiave hanno un numero di
    versione.
    - Se un altro amministratore ha salvato nel frattempo, **non si salva nulla** e compare il
      pannello "Conflitto di modifica". Per ogni lingua mostra il valore salvato e il proprio, con
      il pulsante "Ricarica".
    - Massimo 200 valori per salvataggio.

- [ ] ID=I18N-10, Priority=P2, Complexity=Low, Estimate=hours, Title=Diario delle modifiche linguistiche
  - Ogni creazione, modifica, attivazione, cambio di predefinita ed eliminazione di lingue e chiavi,
    e ogni salvataggio di valori, scrive una riga di log strutturata con chi l'ha fatto.
  - **Non è un registro di audit garantito**: se il log fallisce, la modifica resta comunque.

---

## 9. Profilo e impostazioni personali

- [ ] ID=PROF-01, Priority=P0, Complexity=Medium, Estimate=hours, Title=Profilo
  - In alto l'avatar (oppure un'icona). Campi:
    - email, in sola lettura;
    - nome;
    - cognome;
    - username;
    - telefono, facoltativo, nel formato internazionale **E.164** (`+391234567890`). Il valore
      viene ripulito dagli spazi prima del controllo e del salvataggio.
  - Un campo vuoto diventa nullo. Non ci sono altri controlli né limiti di lunghezza.
  - **Annulla** riporta ai valori caricati. **Salva** mostra "Profilo salvato." per 3 secondi.
  - Accanto, solo per le sessioni con password, il riquadro "Cambia password" (AUTH-11).

- [ ] ID=SET-01, Priority=P0, Complexity=Medium, Estimate=hours, Title=Impostazioni: lingua e regione
  - Contiene il cambio lingua (I18N-05) e un esempio di formato data e numero nella lingua corrente.

- [ ] ID=SET-02, Priority=P0, Complexity=Medium, Estimate=hours, Title=Impostazioni: tema personale
  - Tre scelte: **Chiaro**, **Automatico** (segue il sistema operativo anche mentre l'app è aperta),
    **Scuro**.
  - Salvato nel profilo (e, sul web, anche in un cookie). Chi non è collegato vede sempre il tema
    chiaro.

- [ ] ID=SET-03, Priority=P0, Complexity=Medium, Estimate=hours, Title=Impostazioni: dimensione del testo
  - Un cursore da 90 % a 130 % a passi di 10. L'anteprima è immediata mentre si trascina; si salva
    al rilascio.
  - Ingrandisce tutta l'interfaccia, non solo il testo.
  - **Salvataggio ottimistico**: il valore si applica subito. Se il salvataggio fallisce, torna
    indietro solo quel campo e compare "Impossibile salvare la preferenza. Riprova."
  - Le risposte arrivate in ritardo vengono ignorate, così una richiesta vecchia non annulla una
    scelta più recente.

---

## 10. Tema globale

- [ ] ID=THEME-01, Priority=P1, Complexity=Medium, Estimate=days, Title=Tema dell'applicazione per tutti gli utenti
  - Una sola configurazione, salvata in una tabella con una sola riga.
  - **Modificabili**:
    - colore principale;
    - colore principale per il tema scuro (facoltativo; se vuoto viene ricavato da quello chiaro);
    - quattro superfici per ciascun tema: sfondo, scheda, accento (passaggio del mouse), barra
      laterale.
  - Testi, bordi e colori di stato sono fissi (vedi la [sezione 15](#15-costanti-e-limiti)).
  - Il tema vale per tutte le pagine, anche quelle pubbliche, e **per tutti gli utenti dalla
    richiesta successiva**.

- [ ] ID=THEME-02, Priority=P1, Complexity=High, Estimate=days, Title=Leggibilità garantita del colore principale
  - **Contrasto** calcolato con la luminanza relativa WCAG 2.1; la soglia è **4,5:1**.
  - **Colore del testo sopra il principale**: bianco oppure `#111827`, quello che contrasta di più.
  - **Variante leggibile**: se il colore scelto non raggiunge la soglia contro sfondo, scheda,
    popover, accento, barra laterale e accento della barra, l'app ne usa una variante:
    - nello spazio colore OKLCH mantiene tinta e saturazione;
    - scurisce (tema chiaro) o schiarisce (tema scuro) a passi di 0,01;
    - se il colore esce dalla gamma, riduce la saturazione.

- [ ] ID=THEME-03, Priority=P1, Complexity=High, Estimate=days, Title=Pagina "Tema e stili"
  - **Anteprima**: due strisce, Chiaro e Scuro, con cinque celle ciascuna (Principale, Passaggio,
    Superficie, Sfondo, Barra laterale) dipinte con i colori reali.
    - Una cella si sceglie con un clic.
    - Un pallino segna le celle personalizzate.
    - All'apertura è selezionato il principale chiaro.
  - **Pannello di scelta** per la cella selezionata: cerchi di colore suggeriti, un cerchio
    "Personalizzato" che apre il selettore di colore, il codice esadecimale e il pulsante "Usa il
    predefinito". Suggerimenti:

    | Cella | Suggerimenti |
    |---|---|
    | Principale chiaro | 5 colori: indaco `#4f46e5` (predefinito), verde `#059669`, rosa `#db2777`, arancio `#ea580c`, azzurro `#0284c7` |
    | Principale scuro | "Automatico" (salvato come vuoto), poi le varianti scure leggibili dei 5 colori |
    | Superficie | Predefinito, Grigio freddo, Grigio caldo, Grigio neutro, Tinta del colore principale. Sono calcolati in modo che non creino problemi di contrasto e siano distinguibili tra loro |

  - **Anteprima dal vivo** su tutta l'applicazione mentre si sceglie. Esce dalla pagina senza
    salvare annulla l'anteprima.
  - **Pulsanti**: "Valori di Default" (riporta tutto al predefinito, senza salvare) e "Salva". Il
    messaggio fisso ricorda di salvare.

- [ ] ID=THEME-04, Priority=P1, Complexity=Medium, Estimate=hours, Title=Avviso di contrasto al salvataggio
  - Prima di salvare si controllano tutte le coppie testo/superficie in entrambi i temi. Se qualcuna
    scende sotto 4,5:1 compare la finestra "Alcuni testi si leggono male", con l'elenco (testo,
    superficie, tema, rapporto troncato a un decimale).
  - "Salva comunque" salva, "Annulla" non salva nulla.

- [ ] ID=THEME-05, Priority=P0, Complexity=Medium, Estimate=days, Title=Vocabolario dei token di stile
  - Tutta l'interfaccia usa solo nomi di token di tipo shadcn: `primary`, `background`, `card`,
    `popover`, `accent`, `sidebar`, `border`, `foreground`, `muted-foreground`, `destructive`,
    `success`, `warning`, e così via.
  - Nel codice dei componenti non ci sono colori scritti a mano; un test controlla che il loro
    numero non cresca.
  - In Flutter l'equivalente è un `ThemeData` con una `ThemeExtension` che usa gli stessi nomi.

---

## 11. Componenti condivisi e accessibilità

- [ ] ID=UI-01, Priority=P0, Complexity=Medium, Estimate=hours, Title=Finestre di dialogo accessibili
  - Il focus resta intrappolato dentro la finestra. Il focus iniziale va su un elemento scelto, o sul
    primo elemento attivabile.
  - Esc e il clic sullo sfondo chiudono la finestra, **tranne quando un'operazione è in corso**.
  - Alla chiusura il focus torna all'elemento di partenza.
  - Le finestre possono essere centrate o laterali (cassetto a destra).

- [ ] ID=UI-02, Priority=P0, Complexity=Low, Estimate=hours, Title=Finestra di conferma
  - Titolo, messaggio, contenuto facoltativo, e i pulsanti Annulla (con il focus iniziale) e
    Conferma.
  - **Variante distruttiva**, rossa, per le quattro eliminazioni: ruoli, voci di menu, lingue,
    traduzioni.
  - Durante l'operazione la finestra è bloccata.

- [ ] ID=UI-03, Priority=P1, Complexity=Medium, Estimate=hours, Title=Campo con suggerimenti e testo libero
  - Suggerisce i valori, ma accetta qualunque testo. Si apre al focus o mentre si scrive, senza
    nessuna voce evidenziata.
  - Invio sceglie solo se una voce è evidenziata. Esc chiude solo l'elenco, non la finestra che lo
    contiene.

- [ ] ID=UI-04, Priority=P1, Complexity=Medium, Estimate=hours, Title=Selettori a elenco accessibili da tastiera
  - Usati per il genitore e il tipo nel modulo del menu, e per il cambio lingua.
  - Tasti: Su e Giù ciclici, Inizio e Fine, Invio o Spazio per scegliere, Esc per chiudere e
    rimettere il focus sul campo. Un clic fuori chiude.

- [ ] ID=UI-05, Priority=P0, Complexity=Low, Estimate=hours, Title=Contenitore di pagina e pulsanti
  - **Pagina**: larghezza massima 88rem, titolo, sottotitolo, azioni a destra e corpo in una scheda.
  - **Pulsanti**:
    - varianti: principale, contorno, trasparente, distruttivo, link;
    - dimensioni: normale, piccola, icona. **Un pulsante a sola icona deve avere un nome
      accessibile**;
    - un pulsante disabilitato è attenuato e non reagisce al passaggio del mouse.

- [ ] ID=UI-06, Priority=P1, Complexity=Low, Estimate=hours, Title=Etichette troncate con suggerimento
  - Le etichette troppo lunghe della barra laterale e dei menu vengono troncate con i puntini e
    mostrano un suggerimento con il testo completo, **solo se sono davvero troncate**.

- [ ] ID=UI-07, Priority=P1, Complexity=Medium, Estimate=days, Title=Accessibilità di base
  - Ruoli ARIA corretti su menu, elenchi, interruttori, caselle a tre stati, finestre e aree di stato
    annunciate.
  - Navigazione completa da tastiera nell'albero del menu e nei selettori.
  - In Flutter l'equivalente è `Semantics`, le scorciatoie e il focus.

---

## 12. Operatività

Gran parte di questa sezione riguarda il backend, che resta. È qui per completezza e perché l'app
Flutter ne dipende.

- [ ] ID=OPS-01, Priority=P0, Complexity=Low, Estimate=hours, Title=Controlli di salute
  - `GET /api/health/live`: risponde sempre 200.
  - `GET /api/health/ready`: esegue `select 1` sul database con un timeout di 1 secondo e risponde
    200 oppure 503. Il 503 non contiene dettagli.

- [ ] ID=OPS-02, Priority=P1, Complexity=Low, Estimate=hours, Title=Log strutturati
  - Log JSON con il campo servizio e il modulo.
  - I campi sensibili vengono oscurati: email, destinatario, password, hash, token.

- [ ] ID=OPS-03, Priority=P1, Complexity=Low, Estimate=hours, Title=Limitazione della frequenza
  - Una finestra fissa di 15 minuti, con un contatore per IP e uno per account.
  - Si salvano solo hash HMAC, mai IP o email in chiaro. Le righe più vecchie di 2 giorni vengono
    eliminate.
  - Il riepilogo dei limiti per ogni flusso è nella [sezione 15](#15-costanti-e-limiti).

- [ ] ID=OPS-04, Priority=P0, Complexity=Medium, Estimate=days, Title=Migrazioni del database
  - File SQL numerati e immutabili, con checksum. Ognuno viene applicato in una propria transazione,
    sotto un lock.
  - Comandi: `apply`, `schema-check`, `boundary-check`, `provision-runtime-role`, e quelli per il
    database di test.

- [ ] ID=OPS-05, Priority=P0, Complexity=Medium, Estimate=hours, Title=Confine dei privilegi del database
  - L'app si collega con un utente che eredita **solo** il ruolo `construct_runtime`: niente DDL e
    niente accesso alla cronologia delle migrazioni.
  - RLS è attiva. Il browser non accede mai al database.
  - Un client mobile non deve mai avere credenziali del database: tutto passa dall'API.

- [ ] ID=OPS-06, Priority=P1, Complexity=Low, Estimate=hours, Title=Contenitore e Kubernetes
  - **Immagine**: Node 22 senza privilegi di root e con filesystem in sola lettura.
  - **Kubernetes**: sonde di prontezza e di vita, NetworkPolicy che limita il traffico in uscita,
    overlay di sviluppo e di produzione (TLS, 2 repliche, PDB, immagine fissata per digest).
  - **Locale**: `compose.yaml` con il solo servizio web, collegato al database Supabase esterno,
    e un controllo di salute sulla sonda di prontezza.

- [ ] ID=OPS-07, Priority=P1, Complexity=Medium, Estimate=days, Title=Controlli di qualità automatici
  - Lint, controllo dei tipi, test unitari, test d'integrazione su un database usa e getta, test E2E
    Playwright/pytest.
  - Test sulle convenzioni:
    - ogni chiave di traduzione usata deve esistere nelle migrazioni;
    - ogni variabile d'ambiente deve essere documentata;
    - niente nomi di token ritirati;
    - il numero di colori scritti a mano non può crescere;
    - controlli su nomi dei file, finestre e pulsanti accessibili.
  - Nell'app Flutter vanno replicate le stesse difese.

- [ ] ID=OPS-08, Priority=P1, Complexity=Low, Estimate=hours, Title=Configurazione per ambiente
  - Database; segreto di autenticazione (usato anche per HMAC); URL base; provider OIDC; posta
    (Resend o SMTP); flag di test solo in sviluppo; livello di log.
  - Le credenziali delle migrazioni non stanno mai nell'ambiente dell'app.

---

## 13. Modello dati

| Tabella | Scopo |
|---|---|
| `users` | account e profilo: email unica, nome, cognome, username, telefono, avatar, hash password, provider, stato, lingua preferita, tema, dimensione testo. Ci sono anche colonne storiche non usate (`sub`, `country`, `branch`, `flow`, …) |
| `user_status` | 1 Disattivato, 2 Attivo |
| `allowed_domains` | domini email ammessi per OIDC e registrazione (iniziale: `frontiere.io`); **nessuna schermata li gestisce** |
| `password_set_tokens` | token di invito e reimpostazione: scadenza, uso, scopo, stato di consegna, sostituzione, chi l'ha chiesto |
| `auth_rate_limit` | contatori del limite di frequenza |
| `role`, `role_type`, `role_history` | ruoli, tipo (SYSTEM, SERVICE, SYNCED), archivio dei ruoli eliminati |
| `user_role` | assegnazione utente ↔ ruolo |
| `menu_entry` | albero del menu: genitore, ordine, posizione (alto o basso), icona, tipo di funzionalità (null = categoria), link, nuova scheda, traduzioni `{LINGUA: {name, description}}`, immutabile |
| `menu_entry_tag` | tag per voce e lingua (massimo 50 caratteri) |
| `functionality_type` | 1 incorporata, 2 link esterno, 3 link interno, 4 desktop remoto, 5 permesso |
| `role_functionality` | permesso ruolo ↔ voce di menu |
| `permission`, `role_permission` | albero dei permessi operativi e concessioni |
| `role_list_view` | vista per la griglia dei ruoli (utenti associati, ha permessi) |
| `app_language` | lingue: codice, locale, nomi, attiva, predefinita (una sola), versione del dizionario |
| `translation_key`, `translation_value` | chiavi e valori di traduzione, con versione per il controllo delle modifiche concorrenti |
| `app_theme` | riga unica del tema globale |
| `user_info` | attributi chiave/valore per utente (non usata dall'interfaccia) |

Funzioni del database con logica di dominio:

| Funzione | Cosa fa |
|---|---|
| `replace_user_roles_guarded` | sostituisce i ruoli di un utente proteggendo l'ultimo amministratore |
| `set_user_status_guarded` | cambia lo stato di un utente proteggendo l'ultimo amministratore |
| `consume_password_set_token` | consuma un token di invito o reimpostazione |
| `check_auth_rate_limit` | conta i tentativi per il limite di frequenza |
| `apply_role_functionality_deltas`, `apply_role_permission_deltas` | applicano concessioni e revoche |
| `replace_menu_entry_tags` | sostituisce i tag di una voce di menu |
| `set_default_language` | cambia la lingua predefinita |

---

## 14. API esistenti

Oggi solo una parte del comportamento è esposta come API HTTP. Il resto passa per 23 server action
di Next.js, che un client Flutter non può chiamare.

| Endpoint | Metodo | Accesso | Note |
|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | pubblico | flussi Auth.js con cookie: non adatti a un'app nativa |
| `/api/auth/register` | POST | pubblico | `{email}` → sempre `{ok:true}` (oppure 429) |
| `/api/auth/forgot-password` | POST | pubblico | `{email}` → sempre `{ok:true}` (400 se manca l'email, 429) |
| `/api/auth/set-password` | POST | pubblico | `{token, password}` → 200, 400, 410, 429, 500 |
| `/api/auth/change-password` | POST | sessione con password | `{currentPassword, newPassword}` → `{ok, requiresReauth}` |
| `/api/admin/send-invite` | POST | amministratore | `{userId}` |
| `/api/rbac/users-grid` | POST | amministratore | `page`, `size` ≤ 100, `nameSearch`, `emailSearch`, `roleIds`, `statuses`, `createdFrom/To`, `updatedFrom/To`, `sort`, `direction` |
| `/api/rbac/roles-grid` | POST | amministratore | `page`, `size` ≤ 100, `search`, `idMin/Max`, `associatedUsersMin/Max`, `hasPermission`, `startDateIns/endDateIns`, `startDateMod/endDateMod`, `sort`, `direction` |
| `/api/i18n/languages-grid` | POST | amministratore | `size` ≤ 200, ricerche su codice, locale, nome, nome nativo; `isActive`, `isDefault`, intervalli su tradotte e mancanti, date di creazione |
| `/api/i18n/translations-grid` | POST | amministratore | `size` ≤ 200, `search` (chiave), `descriptionSearch`, `valueSearches{codice}`, `languageCode`, `namespace`, `module`, `status` (all, missing, complete), `updatedFrom/To` |
| `/api/i18n/languages` | GET | pubblico | lingue attive e codice della predefinita |
| `/api/i18n/dictionary` | GET | pubblico | `code`, `namespace` |
| `/api/i18n/preferences/language` | GET, PUT | sessione | lingua preferita |
| `/api/health/live`, `/api/health/ready` | GET | pubblico | |

Una ricerca di testo è una stringa oppure `{operator: "AND"|"OR", conditions: [1–2 stringhe]}`.

Server action da trasformare in endpoint per Flutter:

| Area | Server action |
|---|---|
| Menu | `createNavigationItem`, `updateNavigationItem`, `moveNavigationItem`, `deleteNavigationItem` |
| Ruoli | `createRole`, `renameRole`, `updateRolePermissions`, `deleteRole` |
| Utenti | `updateUserRoles`, `setUserStatus` |
| Lingue | `createLanguage`, `updateLanguage`, `setLanguageActive`, `setDefaultLanguage`, `deleteLanguage` |
| Traduzioni | `createTranslationKey`, `deleteTranslationKey`, `saveTranslations` |
| Personali | `saveProfile`, `saveAppearance`, `setPreferredLanguage`, `getPreferredLanguage` |
| Tema | `saveAppTheme` |

Servono anche endpoint di lettura per ciò che oggi caricano le pagine server:

- menu dell'utente;
- albero del menu completo ed elenco dei genitori;
- singola voce di menu;
- dettaglio del ruolo con i due alberi dei permessi;
- elenco dei ruoli;
- profilo;
- aspetto;
- tema;
- singola chiave di traduzione;
- namespace e moduli esistenti;
- controllo di incorporabilità di una pagina.

---

## 15. Costanti e limiti

| Cosa | Valore |
|---|---|
| Password | almeno 8 caratteri, una maiuscola, una cifra; nessun massimo (bcrypt considera solo i primi 72 byte); bcrypt costo 12 |
| Token d'invito | 48 ore |
| Token di reimpostazione | 2 ore |
| Limiti di frequenza (finestra di 15 min, IP 30 ovunque) | login 10 per email; registrazione 5 per email; password dimenticata 5 per email; impostazione password 8 per token; cambio password 8 per utente |
| Cache dei domini ammessi | 60 s |
| Ricontrollo delle versioni dei dizionari | 15 s |
| Blocco della griglia | 50 righe, massimo 10 blocchi in memoria |
| Pagina massima delle API griglia | 100 (utenti, ruoli), 200 (lingue, traduzioni) |
| Condizioni di testo per filtro | massimo 2 |
| Estremo superiore delle date | `9999-12-30` |
| Larghezza minima di colonna | 112 px |
| Nome e descrizione di una voce di menu | 100 e 500 caratteri |
| Tag | 50 caratteri |
| Chiave di traduzione | 200 caratteri; namespace e modulo 60; valore 1000; massimo 200 valori per salvataggio |
| Nome di una lingua | 80 caratteri |
| Telefono | E.164 `^\+[1-9]\d{1,14}$` |
| Dimensione del testo | 90, 100, 110, 120, 130 % |
| Contrasto minimo | 4,5:1 |
| Colore principale predefinito | `#4f46e5` |
| Controllo di incorporabilità | timeout 4 s, nessuna cache |
| Barra laterale | 64/208 px (prima colonna), 56/192 px (altre), 24 px (striscia), anteprima dopo 180 ms, punto di rottura 767 px |
| Durata della sessione | 30 giorni (predefinito Auth.js) |

Tavolozza fissa (non modificabile dall'amministratore):

| Token | Chiaro | Scuro |
|---|---|---|
| background | `#f9fafb` | `#030712` |
| card | `#ffffff` | `#1f2937` |
| popover | `#ffffff` | `#111827` |
| accent | `#f3f4f6` | `#1f2937` |
| border | `#e5e7eb` | `#374151` |
| foreground | `#111827` | `#ffffff` |
| foreground-secondary | `#374151` | `#d1d5db` |
| muted-foreground | `#4b5563` | `#9ca3af` |
| foreground-faint | `#666f7d` | `#8b919c` |
| sidebar | `#ffffff` | `#111827` |
| sidebar-foreground | `#4b5563` | `#9ca3af` |
| sidebar-accent | `#f3f4f6` | `#1f2937` |
| sidebar-accent-foreground | `#111827` | `#ffffff` |
| destructive (pieno / tenue) | `#dc2626` / `#fee2e2` | `#ef4444` / `#7f1d1d` |
| success (pieno / tenue) | `#15803d` / `#dcfce7` | `#22c55e` / `#14532d` |
| warning (pieno / tenue) | `#b45309` / `#fef3c7` | `#f59e0b` / `#78350f` |

Raggio degli angoli: 0,5rem.

---

## 16. Comportamenti attuali da decidere

Sono comportamenti presenti oggi che sembrano incompleti o incoerenti. Per ognuno va deciso se
l'app Flutter li replica così come sono o li corregge.

- [ ] ID=DEC-01, Priority=P0, Complexity=High, Estimate=days, Title=Accesso da app nativa, Fix description=Auth.js emette solo cookie per il browser. Per Flutter serve OIDC con PKCE più token d'accesso breve e token di rinnovo revocabile emessi dal backend, mantenendo la ricarica di stato e ruoli a ogni richiesta (AUTH-04).
- [ ] ID=DEC-02, Priority=P1, Complexity=Low, Estimate=hours, Title=Pulsanti dei provider nella pagina di login, Fix description=Oggi il pulsante Google compare sempre, anche se Google non è configurato, e non ci sono pulsanti per Entra ID e Keycloak anche quando sono configurati. Mostrare i pulsanti in base ai provider attivi.
- [ ] ID=DEC-03, Priority=P1, Complexity=Low, Estimate=hours, Title=Ritorno alla pagina richiesta dopo il login, Fix description=Oggi dopo il login si torna sempre a `/`.
- [ ] ID=DEC-04, Priority=P1, Complexity=Medium, Estimate=hours, Title=Email e messaggi del server solo in italiano, Fix description=I modelli email e i messaggi d'errore delle API e delle server action sono testi italiani fissi, non chiavi di traduzione. Le chiavi `validation.*` esistono ma non vengono usate.
- [ ] ID=DEC-05, Priority=P2, Complexity=Medium, Estimate=days, Title=Gestione utenti incompleta, Fix description=Non si possono creare, modificare o eliminare utenti né inviare inviti dall'interfaccia, anche se l'API d'invito esiste. Non c'è nemmeno un'interfaccia per i domini ammessi.
- [ ] ID=DEC-06, Priority=P1, Complexity=Medium, Estimate=days, Title=Permessi operativi mai controllati, Fix description=USER_* e PERMISSION_* si concedono ma non hanno effetto. L'amministrazione dipende solo dal ruolo 1. Decidere se applicarli o eliminarli.
- [ ] ID=DEC-07, Priority=P1, Complexity=Low, Estimate=hours, Title=Nuova voce di menu invisibile a tutti, Fix description=Una voce creata non viene concessa a nessun ruolo, e il ruolo Amministratore (SYSTEM) non è modificabile dall'interfaccia. Valutare la concessione automatica all'amministratore.
- [ ] ID=DEC-08, Priority=P2, Complexity=Low, Estimate=hours, Title=Link delle voci di menu non validati, Fix description=Nessun controllo di formato su URL e percorsi; i tag non hanno un limite lato client (il database ha 50 caratteri).
- [ ] ID=DEC-09, Priority=P2, Complexity=Low, Estimate=hours, Title=Validazione dei ruoli, Fix description=Nessun controllo di unicità o di lunghezza sul nome; l'eliminazione non avvisa se ci sono utenti associati; gli errori di creazione ed eliminazione non vengono mostrati.
- [ ] ID=DEC-10, Priority=P2, Complexity=Low, Estimate=hours, Title=Etichette in inglese negli alberi di amministrazione, Fix description=L'albero del costruttore, l'elenco dei genitori e l'albero dei permessi usano sempre l'inglese, mentre la barra laterale usa la lingua attiva.
- [ ] ID=DEC-11, Priority=P2, Complexity=Low, Estimate=hours, Title=Token in chiaro nel database, Fix description=I token d'invito e di reimpostazione sono salvati in chiaro. Inoltre i vecchi token di reimpostazione non si invalidano quando se ne emette uno nuovo, né quando si cambia la password.
- [ ] ID=DEC-12, Priority=P1, Complexity=Low, Estimate=hours, Title=Controllo amministratore delle API griglia, Fix description=Le API griglia si fidano del flag nella sessione, mentre le server action rileggono il database. Uniformare usando sempre il database.
- [ ] ID=DEC-13, Priority=P2, Complexity=Low, Estimate=hours, Title=Paginazione stabile su utenti e ruoli, Fix description=Manca l'id come criterio di ordinamento finale e pagina e totale non sono letti nella stessa transazione: con valori uguali le righe possono ripetersi o mancare tra un blocco e l'altro. La griglia utenti accetta anche `size` = 0.
- [ ] ID=DEC-14, Priority=P2, Complexity=Low, Estimate=hours, Title=Errori della griglia silenziosi, Fix description=Se il caricamento di un blocco fallisce, l'utente vede solo righe vuote, senza alcun messaggio.
- [ ] ID=DEC-15, Priority=P2, Complexity=Low, Estimate=hours, Title=Preferenze della griglia non salvate, Fix description=Colonne visibili e larghezze si perdono uscendo dalla pagina.
- [ ] ID=DEC-16, Priority=P2, Complexity=Low, Estimate=hours, Title=Cambio password nascosto per chi entra con OIDC, Fix description=Il riquadro dipende dal provider della sessione corrente, non dal fatto che l'utente abbia una password. Il cambio password non chiude le altre sessioni.
- [ ] ID=DEC-17, Priority=P2, Complexity=Low, Estimate=hours, Title=Controllo di incorporabilità diverso su mobile, Fix description=In una WebView nativa `X-Frame-Options` e CSP non bloccano. Decidere se su mobile si applica lo stesso controllo o si apre sempre la WebView.
- [ ] ID=DEC-18, Priority=P2, Complexity=Low, Estimate=hours, Title=Pagina non trovata nell'area protetta, Fix description=Oggi qualunque percorso sconosciuto mostra la pagina iniziale invece di un avviso.

---

## 17. Adattamento a telefono, tablet e desktop

Indicazioni per l'app Flutter. Non sono funzionalità esistenti.

| Elemento | Telefono | Tablet | Desktop o portatile |
|---|---|---|---|
| Barra laterale a colonne (NAV-02) | cassetto laterale con navigazione a livelli (una colonna alla volta, con un pulsante indietro) | prima colonna fissa compressa più una colonna aperta | come oggi: colonne multiple, compressione, anteprima al passaggio |
| Griglie (GRID-*) | elenco di schede con un pannello filtri a tutta altezza; ordinamento da menu | griglia con meno colonne visibili | griglia completa |
| Albero del menu con trascinamento (MENU-03) | pressione prolungata per trascinare, oppure azioni "sposta su/giù/dentro" | trascinamento touch | mouse e tastiera come oggi |
| Anteprima al passaggio, suggerimenti sulle etichette troncate | non applicabile: pressione prolungata | pressione prolungata | passaggio del mouse |
| Pagine incorporate (NAV-06) | WebView | WebView | WebView, o iframe su Flutter web |
| Link esterni | browser di sistema | browser di sistema | browser di sistema |
| Link delle email (`/set-password`) | link universale o App Link verso l'app | come telefono | URL web |
| Stato nell'URL (GRID-04) | stato della schermata più link profondi | come telefono | URL, se Flutter web |
| Tema automatico e dimensione del testo (SET-02, SET-03) | seguire anche le impostazioni di sistema | come telefono | come oggi |

---

> # Parte II — TO-BE
> Sezioni 18–22: funzionalità che **oggi non esistono** e che l'app nuova deve avere. Ogni voce ha
> il titolo che inizia con **[TO-BE]**. Le stime presuppongono che il backend venga esteso insieme
> all'app: quasi tutto il lavoro TO-BE è prima di tutto lavoro di backend e di database.
> Le voci sulla multi-tenancy (TB-DEC-01…05, TB-DEC-09, TB-DEC-10, MT-01…14, WL-02…04) stanno in
> [multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md); qui sotto restano citate con lo stesso ID.

**Cosa c'è già oggi in questa direzione.** Poco, e conviene saperlo per non scambiarlo per una base:

- **Multi-tenancy**: vedi [multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md#cosa-cè-già-oggi).
- **White labeling**: esiste solo il tema globale (THEME-01…04). Una sola riga, un solo colore
  principale e quattro superfici per tema, uguali per tutti. Nessun logo, nome o dominio
  personalizzabile.
- **Permessi sulle funzioni interne**: il modello è già progettato e approvato
  ([2026-09-01](../../superpowers/specs/2026-09-01-rbac-permission-model-design.md) e
  [2026-09-03](../../superpowers/specs/2026-09-03-rbac-functionality-grants-design.md)), ma è
  implementato solo nella Fase 1. Esistono la tabella `permission` con le colonne `code`, `origin`
  e `deprecated_at`, la tabella `role_permission` e la sezione "Operazioni" nel dettaglio ruolo.
  **Mancano**:
  - il catalogo nel sorgente;
  - `requirePermission`;
  - la guardia automatica;
  - l'editor `/permissions`.

  Le voci PERM qui sotto riprendono quel modello e lo estendono.

## 18. [TO-BE] Decisioni d'impianto

Vanno prese **prima** di progettare le sezioni 19–21, perché ne cambiano il modello dati. Per
ognuna c'è una raccomandazione; le alternative sono indicate.

- Le decisioni sui tenant (TB-DEC-01…05, TB-DEC-09, TB-DEC-10) sono state spostate in
  [multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md#1-decisioni-dimpianto). Gli ID restano gli stessi.
- [ ] ID=TB-DEC-06, Priority=P0, Complexity=Medium, Estimate=hours, Title=[TO-BE] App mobile unica o una per cliente, Fix description=Un'app sugli store ha **un solo nome e una sola icona**. Strada A: app unica, il brand del tenant si carica dopo la scelta dell'organizzazione. Strada B: una build per tenant (flavor Flutter con nome, icona, identificativo, schermata iniziale e link universali propri), generata da una pipeline. Raccomandato: A come base, B come opzione per i clienti che la pagano.
- [ ] ID=TB-DEC-07, Priority=P1, Complexity=Low, Estimate=hours, Title=[TO-BE] Dove salvare loghi e immagini, Fix description=Oggi non esiste un archivio di file: le icone SVG stanno come testo nel database. Per i loghi raster serve un object storage (S3 compatibile o Supabase Storage via API del backend, mai dal client) oppure una tabella con i byte e un limite di dimensione. Raccomandato: object storage dietro il backend, URL con versione e cache lunga.
- [ ] ID=TB-DEC-08, Priority=P1, Complexity=Low, Estimate=hours, Title=[TO-BE] Granularità dei permessi, Fix description=La specifica del 2026-09-01 (§4.1) usa la regola «due operazioni meritano due permessi solo se esiste un ruolo plausibile che ha l'una e non l'altra», e così fonde per esempio crea, rinomina ed elimina ruolo in `manage-roles`. La richiesta qui è un **CRUD completo** per area. Raccomandato: il CRUD granulare di PERM-06, con l'interfaccia che offre gruppi già pronti (accendere la cartella "Lingue" concede tutte le sue foglie), così la granularità c'è ma non pesa su chi configura.
- [ ] ID=TB-DEC-11, Priority=P1, Complexity=Medium, Estimate=hours, Title=[TO-BE] Visibilità delle voci di amministrazione, Fix description=Oggi le voci Admin → Utenti, Lingue, … sono normali voci di menu concesse con `role_functionality`, mentre le pagine controllano il ruolo 1: due regole che possono dire cose diverse. Raccomandato: le voci di sistema dichiarano il **codice del permesso di lettura** che richiedono (`read-users`, `read-languages`, …) e sono visibili se e solo se l'utente lo possiede; le voci create dalla console restano governate da `role_functionality`.

## 19. [TO-BE] Multi-tenancy

Le voci MT-01…MT-14 sono state spostate in
[multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md#2-multi-tenancy), insieme alle decisioni d'impianto
sui tenant, perché non dipendono da Flutter. Gli ID restano gli stessi. Lo studio che le
verifica contro il codice è [2026-10-13-multi-tenancy-study.md](../multi-tenancy/2026-10-13-multi-tenancy-study.md).

## 20. [TO-BE] White labeling, anche prima dell'accesso

Ogni tenant presenta l'applicazione **con la propria identità** dal primo istante: ancora prima
dell'accesso, sul proprio sottodominio o dominio.

- [ ] ID=WL-01, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Identità visiva del tenant
  - **Elementi configurabili**:
    - nome dell'applicazione, che sostituisce "Construct" in titoli, pagina di login ed email;
    - **logo** in due versioni, per tema chiaro e scuro, più la variante compatta per la barra
      laterale compressa;
    - favicon e icona;
    - immagine o colore di sfondo della pagina di login;
    - frase sotto il logo (oggi `auth.login.tagline`);
    - testo e link del piè di pagina: privacy, termini, supporto;
    - email e telefono di assistenza mostrati nei messaggi "contatta l'amministratore".
  - **Tema**: il tema attivo del tenant (PERM-07) sostituisce il tema globale di oggi. Il controllo
    del contrasto (THEME-02, THEME-04) resta identico.
  - **Esclusioni**: niente CSS o codice personalizzato, per sicurezza e manutenibilità. Il pulsante
    Google mantiene i colori imposti da Google.
  - **Pagina di modifica**: anteprima dal vivo della pagina di login e della barra laterale con il
    nuovo brand, come fa oggi la pagina Tema.

- Le voci WL-02 (brand applicato prima dell'accesso), WL-03 (sottodominio e dominio dedicato) e
  WL-04 (accesso e sessioni con molti domini) sono state spostate in
  [multi-tenancy-requirements.md](../multi-tenancy/multi-tenancy-requirements.md#3-tenant-host-e-domini), perché servono a riconoscere il
  tenant. Gli ID restano gli stessi.


- [ ] ID=WL-05, Priority=P1, Complexity=Medium, Estimate=days, Title=[TO-BE] Email con il brand del tenant
  - **Mittente**: nome e indirizzo del tenant. Un dominio di invio personalizzato richiede la
    verifica (SPF, DKIM) presso il provider di posta; altrimenti si usa un indirizzo della
    piattaforma con il nome del tenant.
  - **Contenuto**:
    - modelli con logo, colori e piè di pagina del tenant;
    - **nella lingua del destinatario**, con i testi presi dalle traduzioni e non scritti fissi in
      italiano (risolve DEC-04);
    - link sul dominio primario del tenant.
  - Modelli coperti: invito, reimpostazione password, password cambiata (nuovo, utile per
    sicurezza), approvazione dell'appartenenza (MT-02).

- [ ] ID=WL-06, Priority=P1, Complexity=Medium, Estimate=days, Title=[TO-BE] Lingue e testi del tenant
  - Lingua predefinita e lingue attive per tenant (TB-DEC-04).
  - **Sovrascrittura di singoli testi** per tenant, per esempio la frase della pagina di login, i
    nomi delle voci di amministrazione o i messaggi d'aiuto. Si fa dall'editor delle traduzioni
    (I18N-09), filtrando "solo sovrascritti", con l'indicazione del valore globale sotto quello del
    tenant.

- [ ] ID=WL-07, Priority=P1, Complexity=High, Estimate=weeks, Title=[TO-BE] White labeling dell'app mobile
  - **Strada A** (app unica): brand a runtime come in WL-02. Nome e icona sugli store sono della
    piattaforma.
  - **Strada B** (build per tenant): una pipeline genera per ogni tenant che lo richiede un flavor
    Flutter con:
    - nome, icona, schermata iniziale e colori;
    - identificativo dell'app;
    - link universali e App Link sul dominio del tenant;
    - tenant **fisso**, senza schermata di scelta.

    Poi firma e pubblica sugli store, o nella distribuzione aziendale del cliente.
  - Le due strade convivono: B è A con il tenant fissato a build.

- [ ] ID=WL-08, Priority=P1, Complexity=Medium, Estimate=days, Title=[TO-BE] Caricamento degli asset del brand
  - **Formati e limiti**:
    - SVG, sanificato come le icone di oggi (MENU-05);
    - PNG e WebP con limiti di dimensione in pixel e di peso, e ridimensionamento lato server per
      favicon e icone.
  - **Conservazione**: secondo TB-DEC-07, con URL che cambia a ogni versione.
  - **Anteprima**: su sfondo chiaro e scuro, con un avviso se il logo per il tema chiaro è poco
    visibile sul tema scuro.

- [ ] ID=WL-09, Priority=P2, Complexity=Low, Estimate=hours, Title=[TO-BE] Metadati del web per tenant
  - Titolo delle pagine, favicon, manifest PWA (nome, icone, colore del tema) e colore della barra
    del browser presi dal brand del tenant.

## 21. [TO-BE] Funzionalità interne governate dall'RBAC

**Oggi**: le funzioni interne (gestione utenti, ruoli, menu, lingue, traduzioni, tema) sono
accessibili **solo e tutte** a chi ha il ruolo Amministratore. Non si può creare, per esempio, un
ruolo "Traduttore" che modifica i testi senza vedere gli utenti.

**TO-BE**: ogni funzione interna è protetta da un **permesso con codice**, concedibile ai ruoli
dalla sezione "Operazioni" del dettaglio ruolo. Il modello è quello già approvato nelle specifiche
del [2026-09-01](../../superpowers/specs/2026-09-01-rbac-permission-model-design.md) e del
[2026-09-03](../../superpowers/specs/2026-09-03-rbac-functionality-grants-design.md), esteso con il
CRUD sui temi e sulle nuove aree delle sezioni 19–20.

- [ ] ID=PERM-01, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Catalogo dei permessi nel sorgente
  - **Cos'è**: un elenco congelato nel codice; ogni voce ha codice, posizione nell'albero, etichette
    ed eventuale descrizione.
  - **Codici**: piatti e immutabili, verbo davanti, separati da trattini (`read-users`,
    `update-languages`).
  - **Sincronizzazione**: arriva al database con una **migrazione generata** e segue tre regole:
    1. inserisce i codici nuovi;
    2. **non riscrive mai** etichette e posizioni già esistenti, perché le gestisce la console;
    3. **non cancella mai**: un codice sparito riceve `deprecated_at` e scompare dall'albero,
       mentre le concessioni restano.

- [ ] ID=PERM-02, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Controllo unico sul backend
  - **Ogni** endpoint dichiara il permesso che richiede e passa da un unico punto di controllo.
    Dentro quel punto:
    - un account (o un'appartenenza al tenant) disattivato viene sempre rifiutato;
    - l'Amministratore del tenant scavalca il controllo, così un permesso nuovo non resta
      irraggiungibile;
    - per tutti gli altri si verifica che il permesso appartenga all'insieme dei permessi
      dell'utente.
  - **Eccezioni**: si dichiarano esplicitamente (anonimo, qualunque autenticato, servizio
    personale) e non sono mai omissioni.
  - **Guardie automatiche**: un controllo impedisce endpoint senza dichiarazione; un altro verifica
    che ogni codice usato esista nel catalogo e non sia deprecato.
  - **Nessuna cache fra richieste**: la revoca deve avere effetto alla richiesta successiva.

- [ ] ID=PERM-03, Priority=P0, Complexity=Low, Estimate=hours, Title=[TO-BE] Permessi noti all'app
  - `GET /api/me` restituisce identità, tenant corrente e **codici dei permessi** dell'utente.
  - L'app Flutter li usa per mostrare o nascondere voci, pagine, pulsanti e azioni di riga, e per
    disabilitare i campi in sola lettura.
  - È solo una comodità: la difesa resta PERM-02.
  - Dopo ogni cambio di tenant, e al ritorno in primo piano dell'app, i permessi vengono riletti.

- [ ] ID=PERM-04, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Pagine interne governate dai permessi
  - **Accesso alle pagine**:
    - ogni pagina di amministrazione richiede il proprio permesso di lettura;
    - la lista fissa dei percorsi di amministrazione e il controllo "ha il ruolo 1" spariscono
      come difesa;
    - le voci Admin → … del menu seguono TB-DEC-11.
  - **Dentro la pagina**: le azioni sono abilitate secondo i permessi di scrittura. Per esempio:
    - con solo `read-languages` la griglia lingue si vede, ma "Nuova lingua" e le azioni di riga
      sono nascoste;
    - con `update-languages` ma non `delete-languages` manca solo "Elimina".

- [ ] ID=PERM-05, Priority=P0, Complexity=Low, Estimate=hours, Title=[TO-BE] Regole di concessione
  - **Non si concede ciò che non si possiede**: chi ha `grant-role-permissions` può concedere solo
    permessi che ha già. L'Amministratore del tenant li ha tutti.
  - **Dipendenze**: ogni permesso di scrittura richiede quello di lettura della stessa area.
    Concedere `update-languages` concede anche `read-languages`; revocare `read-languages` revoca
    anche le scritture dell'area, con un avviso nell'interfaccia.
  - **Ambito**: i permessi di **piattaforma** (tenant, provider globali, temi modello) non compaiono
    nell'albero dei tenant e non sono concedibili da un tenant.
  - **Rami e permessi nuovi**: una cartella accesa concede le foglie di quel momento; un permesso
    aggiunto dopo non viene concesso in automatico. L'interfaccia segnala i rami "quasi pieni".

- [ ] ID=PERM-06, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Catalogo proposto (CRUD per area)
  - Granularità secondo TB-DEC-08. Le cartelle sono gruppi da accendere in un clic.

    | Area (cartella) | Permessi | Ambito |
    |---|---|---|
    | Utenti | `read-users`, `invite-users`, `create-users`, `update-users` (anagrafica di altri), `set-user-status`, `assign-user-roles`, `approve-memberships`, `delete-users` (toglie dal tenant) | tenant |
    | Ruoli | `read-roles`, `create-roles`, `update-roles` (rinomina), `delete-roles`, `grant-role-permissions` | tenant |
    | Menu | `read-menu`, `create-menu-entries`, `update-menu-entries` (compreso lo spostamento), `delete-menu-entries` | tenant |
    | Lingue | `read-languages`, `create-languages`, `update-languages`, `activate-languages` (attiva/disattiva), `set-default-language`, `delete-languages` | tenant; il catalogo globale è di piattaforma (TB-DEC-04) |
    | Traduzioni | `read-translations`, `edit-translations` (valori), `create-translation-keys`, `update-translation-keys` (namespace, modulo, descrizione), `delete-translation-keys`, `import-translations`, `export-translations` | valori: tenant; chiavi: piattaforma |
    | Temi | `read-themes`, `create-themes`, `update-themes`, `delete-themes`, `apply-theme` | tenant |
    | Brand e domini | `read-branding`, `update-branding`, `read-domains`, `manage-domains` | tenant |
    | Accesso | `read-access-settings`, `manage-allowed-domains`, `manage-identity-providers`, `manage-self-registration` | tenant |
    | Permessi | `read-permissions`, `update-permissions` (etichette e posizione nell'albero) | tenant; il catalogo è di piattaforma |
    | Diario | `read-audit-log`, `export-audit-log` | tenant |
    | Piattaforma | `read-tenants`, `create-tenants`, `update-tenants`, `suspend-tenants`, `delete-tenants`, `support-access-tenants`, `manage-theme-templates`, `manage-global-languages` | piattaforma |

  - **Fuori dal catalogo**, perché self-service o pubblici: profilo, aspetto e lingua personali,
    cambio password, cambio tenant, dizionario delle traduzioni, brand pubblico, controlli di
    salute.

- [ ] ID=PERM-07, Priority=P1, Complexity=High, Estimate=days, Title=[TO-BE] CRUD sui temi
  - **Oggi**: un solo tema globale (THEME-01).
  - **TO-BE**: una **libreria di temi con nome** per tenant (TB-DEC-10), di cui **uno è attivo**.
  - **Griglia dei temi** (regole GRID-*): nome, anteprima (pallino del colore principale e strisce
    chiaro/scuro), attivo sì/no, avvisi di contrasto sì/no, ultima modifica, autore.
  - **Azioni**:

    | Azione | Permesso | Regole |
    |---|---|---|
    | Crea, da zero o **duplicando** un tema esistente o un modello di piattaforma | `create-themes` | nome obbligatorio, unico nel tenant, massimo 60 caratteri |
    | Modifica, con l'editor di oggi (THEME-03) e l'avviso di contrasto (THEME-04) | `update-themes` | modificare il tema **attivo** cambia subito l'aspetto per tutti, quindi va confermato |
    | Applica: diventa il tema attivo del tenant | `apply-theme` | con anteprima e conferma |
    | Elimina | `delete-themes` | vietato per il tema attivo e per l'ultimo tema rimasto |

  - **Concorrenza**: ogni tema ha una versione, come le traduzioni (I18N-09). Due amministratori che
    modificano lo stesso tema ricevono un avviso di conflitto invece di sovrascriversi.

- [ ] ID=PERM-08, Priority=P1, Complexity=Medium, Estimate=days, Title=[TO-BE] CRUD sulle lingue e sulle traduzioni governato dai permessi
  - Le funzioni di I18N-07, I18N-08 e I18N-09 restano le stesse, ma ogni azione richiede il
    proprio permesso (tabella di PERM-06). Esempi di ruoli che diventano possibili:
    - **Traduttore**: `read-translations` + `edit-translations`. Modifica i valori, non crea né
      elimina chiavi e non vede lingue né utenti;
    - **Responsabile lingue**: tutte le voci di Lingue e Traduzioni;
    - **Revisore**: solo i permessi di lettura.
  - **Nuove funzioni**:
    - **importazione ed esportazione** delle traduzioni (CSV o XLIFF, per lingua o per namespace),
      con un'anteprima delle differenze prima di applicare l'importazione;
    - filtro "solo sovrascritte dal tenant" (WL-06).

- [ ] ID=PERM-09, Priority=P1, Complexity=High, Estimate=days, Title=[TO-BE] Editor dell'albero dei permessi
  - Nuova pagina "Permessi" (la Fase 3 della specifica del 2026-09-01):
    - albero del catalogo con il **codice in sola lettura**;
    - etichette tradotte e descrizione modificabili;
    - posizione nell'albero modificabile con il trascinamento (stesse regole di MENU-03);
    - permessi deprecati nascosti dietro un filtro.
  - Per ogni permesso: "Quali ruoli ce l'hanno" e "Quali utenti ce l'hanno", con un collegamento
    al dettaglio del ruolo.

- [ ] ID=PERM-10, Priority=P2, Complexity=Low, Estimate=hours, Title=[TO-BE] Ruoli d'esempio alla creazione del tenant
  - Il modello del tenant (MT-08) può includere ruoli SERVICE già configurati, da usare o eliminare:
    - **Gestore utenti**;
    - **Traduttore**;
    - **Responsabile lingue**;
    - **Gestore del brand** (temi, brand, domini);
    - **Sola lettura amministrativa**.

- [ ] ID=PERM-11, Priority=P0, Complexity=Low, Estimate=hours, Title=[TO-BE] Chiusura dei buchi noti
  - Riprende HOLE-1…HOLE-4 della specifica del 2026-09-01 e DEC-12 e DEC-18 di questo documento:
    - nessun endpoint si fida di un flag nel token;
    - la lista fissa dei percorsi di amministrazione non è più una difesa;
    - la pagina incorporata controlla il **permesso** della voce, non la sua presenza nel menu;
    - un percorso sconosciuto restituisce "pagina non trovata".

- [ ] ID=PERM-12, Priority=P1, Complexity=Medium, Estimate=days, Title=[TO-BE] Diario delle azioni amministrative
  - **Cosa registra**: ogni azione protetta da un permesso di scrittura, con chi, quando, tenant,
    tipo di oggetto, id, valori prima e dopo (senza segreti), esito, indirizzo IP e user agent.
  - **Garanzia**: a differenza del log best-effort di oggi (I18N-10), è una **tabella nel database
    scritta nella stessa transazione dell'azione**. Se il diario non si scrive, l'azione non
    avviene.
  - **Consultazione**: griglia con filtri per persona, area, azione e date, ed esportazione
    (`read-audit-log`, `export-audit-log`). La conservazione si configura per tenant.
  - Gli accessi di assistenza (MT-11) e le azioni di piattaforma finiscono nel diario del tenant
    interessato e in quello della piattaforma.

## 22. [TO-BE] Effetti sulle voci AS-IS

Voci della Parte I che cambiano significato quando si realizza la Parte II.

| Voce AS-IS | Cosa cambia |
|---|---|
| AUTH-02, AUTH-06 | i domini ammessi diventano per tenant (MT-09); la registrazione autonoma diventa configurabile per tenant |
| AUTH-04 | il token porta anche il tenant; si rilegge l'appartenenza oltre a stato e ruoli (MT-06) |
| AUTH-05 | la protezione delle pagine passa ai permessi (PERM-04) e alla risoluzione del tenant (MT-04) |
| AUTH-09, AUTH-10 | gli inviti sono per tenant e portano al dominio del tenant (MT-08, WL-04); l'invito da interfaccia diventa `invite-users` |
| AUTH-13 | email brandizzate e tradotte (WL-05) |
| RBAC-01 | ruoli SERVICE per tenant; il ruolo 2 diventa amministratore di piattaforma (TB-DEC-03) |
| RBAC-03 | i permessi operativi oggi inerti vengono sostituiti dal catalogo di PERM-06 e finalmente controllati |
| RBAC-04 | l'ultimo amministratore attivo è protetto per ogni tenant |
| RBAC-05 | `requireAdmin` sparisce, sostituito da PERM-02 |
| USR-01…USR-04 | la gestione utenti diventa gestione delle appartenenze al tenant, con stati e approvazione (MT-02) e azioni secondo PERM-06 |
| NAV-01, NAV-05 | menu per tenant; selettore del tenant nel pannello utente (MT-05) |
| NAV-06 | la pagina incorporata controlla il permesso della voce (PERM-11) |
| THEME-01…THEME-04 | il tema unico diventa la libreria temi per tenant (PERM-07); l'editor resta |
| I18N-02, I18N-06, I18N-07 | lingue attive e predefinita per tenant; dizionario con sovrascritture e versione per tenant (TB-DEC-04) |
| OPS-05 | il confine dei privilegi comprende RLS per tenant (MT-12) |
| OPS-06 | Ingress e certificati per dominio (WL-03) |
| DEC-01, DEC-02, DEC-04, DEC-05, DEC-06, DEC-12, DEC-18 | risolte rispettivamente da TB-DEC-09, MT-09, WL-05, PERM-06, PERM-06, PERM-11, PERM-11 |
