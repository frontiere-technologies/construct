# Multi-tenancy: requisiti TO-BE

Data: 2026-10-07, spostato qui il 2026-10-13.
Origine: Parte II (TO-BE) dell'[inventario delle funzionalità](../flutter/construct-functional-inventory.md),
scritta come base per l'app Flutter. Le decisioni e le voci sulla multi-tenancy non dipendono da Flutter: riguardano il
database, il backend e l'accesso, quindi valgono per qualunque interfaccia e sono state raccolte
qui.
Studio collegato: [2026-10-13-multi-tenancy-study.md](2026-10-13-multi-tenancy-study.md), che
verifica questi requisiti contro il codice e le indicazioni pubbliche, li corregge dove serve
(§8 dello studio) e li traduce in lavori.

> **Come leggere il documento.**
> - **Gli ID sono quelli originali** (`TB-DEC-`, `MT-`, `WL-`), così i riferimenti già scritti
>   altrove restano validi.
> - **Gli ID delle funzionalità di oggi** (`AUTH-`, `RBAC-`, `USR-`, `NAV-`, `GRID-`, `I18N-`,
>   `THEME-`, `OPS-`, `DEC-`) e le voci TO-BE rimaste nell'inventario (`TB-DEC-06…08`, `TB-DEC-11`,
>   `WL-01`, `WL-05…09`, `PERM-`) rimandano all'[inventario](../flutter/construct-functional-inventory.md).
> - **Le stime** indicano quanto impiegherebbe un sistema di vibe coding e presuppongono che il
>   backend venga esteso: quasi tutto questo lavoro è prima di tutto lavoro di backend e di
>   database.

## Cosa c'è già oggi

- **Multi-tenancy**: è stata **esclusa di proposito** (DEC-3 del
  [design RBAC del 2026-06-28](../../superpowers/specs/2026-06-28-rbac-module-design.md)). Ne
  restano solo tracce:
  - il ruolo di sistema 2 "Tenant Super Administrator", che non ha alcuna logica;
  - i campi `tenantValidationPending` e `multiTenancyEnabled` nelle risposte della griglia utenti,
    sempre `false`.

## 1. Decisioni d'impianto

Vanno prese **prima** di progettare le sezioni 2 e 3, perché ne cambiano il modello dati. Per
ognuna c'è una raccomandazione; le alternative sono indicate. Le altre decisioni d'impianto della
Parte II (app mobile per cliente, archivio dei loghi, granularità dei permessi, visibilità delle
voci di amministrazione) restano nell'[inventario](../flutter/construct-functional-inventory.md#18-to-be-decisioni-dimpianto).

- [ ] ID=TB-DEC-01, Priority=P0, Complexity=High, Estimate=hours, Title=[TO-BE] Isolamento dei dati fra tenant, Fix description=Raccomandato: **database condiviso, colonna `id_tenant` su ogni tabella di dominio, Row Level Security di Postgres** con una variabile di transazione (`set_config('app.current_tenant', …, true)`) impostata dal backend a ogni richiesta. RLS e il ruolo `construct_runtime` ci sono già, e il costo operativo resta quello di oggi. Alternative: uno schema per tenant (migrazioni ripetute N volte) o un database per tenant (isolamento massimo, costi e operatività moltiplicati; sensato solo per clienti che lo chiedono per contratto).
- [ ] ID=TB-DEC-02, Priority=P0, Complexity=Medium, Estimate=hours, Title=[TO-BE] Identità globale o per tenant, Fix description=Raccomandato: **identità globale** (una riga `users` per email, una sola password) e **appartenenza per tenant** con stato e ruoli propri. Così una persona che lavora per due clienti ha un account solo. Alternativa: utenti duplicati per tenant (più semplice da isolare, ma due password e due profili per la stessa persona).
- [ ] ID=TB-DEC-03, Priority=P0, Complexity=Low, Estimate=hours, Title=[TO-BE] Livello di piattaforma, Fix description=Serve un ruolo **sopra** i tenant, che crea e sospende i tenant e ne gestisce domini e provider. Raccomandato: ridefinire il ruolo 2 come "Amministratore di piattaforma", globale e non assegnabile dai tenant. Decidere se può **entrare** in un tenant per assistenza (impersonazione registrata, vedi MT-11) o se vede solo i metadati.
- [ ] ID=TB-DEC-04, Priority=P1, Complexity=Medium, Estimate=hours, Title=[TO-BE] Lingue e traduzioni con più tenant, Fix description=Raccomandato: **catalogo di lingue e chiavi globale** (lo mantiene la piattaforma); **ogni tenant attiva le proprie lingue e sceglie la predefinita**; i valori di traduzione si possono **sovrascrivere per tenant** sopra quelli globali. L'ordine di ricerca diventa: tenant nella lingua attiva → globale nella lingua attiva → tenant nella predefinita → globale nella predefinita.
- [ ] ID=TB-DEC-05, Priority=P1, Complexity=Low, Estimate=minutes, Title=[TO-BE] Host sconosciuto, Fix description=Cosa mostra un indirizzo che non corrisponde a nessun tenant: il brand neutro della piattaforma con la scelta dell'organizzazione, oppure una pagina "organizzazione non trovata". Raccomandato il secondo sui sottodomini (non rivela quali tenant esistono) e il primo sul dominio principale.
- [ ] ID=TB-DEC-09, Priority=P0, Complexity=High, Estimate=hours, Title=[TO-BE] Accesso con molti domini, Fix description=Con un dominio per tenant, ogni provider OIDC vorrebbe un indirizzo di ritorno registrato per ogni dominio. Strada A: un **dominio di autenticazione centrale** (es. `auth.<dominio-base>`) che gestisce il login e rimanda al dominio del tenant con un codice monouso. Strada B: registrare ogni dominio presso ogni provider. Raccomandato A, che si sposa con DEC-01 (Keycloak o un servizio di token proprio) e con l'app mobile.
- [ ] ID=TB-DEC-10, Priority=P1, Complexity=Low, Estimate=minutes, Title=[TO-BE] Temi: libreria per tenant o condivisa, Fix description=Raccomandato: ogni tenant ha la **propria libreria** di temi e uno attivo; la piattaforma può pubblicare temi modello che i tenant copiano. Alternativa: libreria unica di piattaforma da cui ogni tenant sceglie.

## 2. Multi-tenancy

Un **tenant** è un'organizzazione cliente che usa la stessa installazione di Construct con dati,
utenti, ruoli, menu, tema e brand propri, invisibili agli altri tenant.

- [ ] ID=MT-01, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Anagrafica e ciclo di vita del tenant
  - **Dati del tenant**:
    - identificativo;
    - **slug** unico (`[a-z0-9-]`, 3–40 caratteri), usato nel sottodominio;
    - nome visualizzato;
    - stato: **attivo**, **sospeso** o **archiviato**;
    - date di creazione e modifica;
    - note interne.
  - **Ciclo di vita**:
    - **crea**;
    - **modifica**;
    - **sospendi**: nessuno accede; le pagine pubbliche mostrano "Accesso sospeso" con il brand del
      tenant;
    - **riattiva**;
    - **archivia**: niente accessi, dati conservati per un periodo stabilito;
    - **elimina definitivamente**: solo dalla piattaforma, con doppia conferma digitando lo slug.

- [ ] ID=MT-02, Priority=P0, Complexity=High, Estimate=days, Title=[TO-BE] Appartenenza degli utenti ai tenant
  - Una persona può appartenere a **più tenant** (TB-DEC-02).
  - **Ogni appartenenza ha uno stato**:
    - **invitato**;
    - **in attesa di approvazione**: è il vecchio `tenantValidationPending`, per chi si registra da
      solo su un tenant che richiede l'approvazione;
    - **attivo**;
    - **disattivato**.
  - **Due livelli di disattivazione**:
    - quella di oggi (USR-03) diventa **per tenant**: si toglie l'accesso a un'organizzazione senza
      toccare le altre;
    - resta una disattivazione **globale** dell'identità, riservata alla piattaforma.
  - **Profilo e dati personali**:
    - nome, telefono, password, lingua preferita e aspetto restano **globali**;
    - si può aggiungere un nome visualizzato per tenant, se serve.

- [ ] ID=MT-03, Priority=P0, Complexity=High, Estimate=days, Title=[TO-BE] Ruoli e concessioni per tenant
  - `user_role` riceve il tenant: un utente ha ruoli diversi in tenant diversi.
  - **Ruoli SERVICE**: appartengono a un tenant e sono visibili solo lì.
  - **Ruoli SYSTEM** (Utente registrato, Amministratore del tenant): valgono in ogni tenant.
  - Concessioni di voci di menu e permessi: **per tenant**.
  - La protezione "ultimo amministratore attivo" (RBAC-04) vale **per ogni tenant**: nessun tenant
    può restare senza un amministratore attivo.

- [ ] ID=MT-04, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Risoluzione del tenant
  - **Web, prima dell'accesso**: il tenant si ricava dall'**host** della richiesta. Può essere un
    sottodominio `{slug}.<dominio-base>` oppure un dominio personalizzato registrato in WL-03.
  - **Web, dominio principale**: dopo l'accesso, se l'utente appartiene a un solo tenant ci entra
    subito; se ne ha più di uno sceglie da un elenco. L'ultimo tenant usato viene ricordato.
  - **App mobile**, con più modi possibili insieme:
    1. "Indirizzo dell'organizzazione" (slug o dominio) inserito al primo avvio;
    2. ricavato dal dominio dell'email, se un tenant l'ha dichiarato come proprio;
    3. scelto da un elenco dopo l'accesso;
    4. portato da un link universale (inviti, reimpostazione password).

    L'app ricorda il tenant fino al logout o a un cambio esplicito.
  - Un utente che arriva su un tenant a cui non appartiene vede "Non hai accesso a questa
    organizzazione". Il messaggio non deve rivelare se l'account esiste.

- [ ] ID=MT-05, Priority=P1, Complexity=Medium, Estimate=days, Title=[TO-BE] Cambio di tenant
  - Il selettore sta nel pannello utente (NAV-05) e compare solo con più di un tenant.
  - Cambiare tenant **non richiede un nuovo accesso**: il backend emette un nuovo token per l'altro
    tenant, e l'app ricarica menu, tema, brand e lingue.
  - Sul web, se i tenant hanno domini diversi, il cambio porta al dominio dell'altro tenant passando
    per il dominio di autenticazione centrale (TB-DEC-09).

- [ ] ID=MT-06, Priority=P0, Complexity=High, Estimate=days, Title=[TO-BE] Contesto del tenant in ogni richiesta
  - Il token porta l'identità **e il tenant corrente**.
  - A ogni richiesta il backend:
    - verifica che l'appartenenza sia attiva, rileggendola come oggi stato e ruoli (AUTH-04), così
      la revoca resta immediata;
    - imposta il tenant nella transazione per RLS;
    - risolve ruoli e permessi **di quel tenant**.
  - Nessun endpoint accetta il tenant dal corpo della richiesta: viene solo dal token o, prima
    dell'accesso, dall'host.

- [ ] ID=MT-07, Priority=P0, Complexity=High, Estimate=weeks, Title=[TO-BE] Dati per tenant e dati globali
  - Si aggiunge `id_tenant`, con RLS, alla **maggior parte** delle tabelle di dominio:

    | Tabella | Diventa | Note |
    |---|---|---|
    | `menu_entry`, `menu_entry_tag`, `role_functionality` | per tenant | ogni tenant ha il proprio menu |
    | `role` (SERVICE), `user_role`, `role_permission` | per tenant | i ruoli SYSTEM restano globali |
    | `app_theme` | per tenant | diventa la libreria temi di PERM-07 |
    | `allowed_domains` | per tenant | domini che entrano in quel tenant |
    | `password_set_tokens` | per tenant | l'invito porta al tenant che lo ha emesso |
    | lingue attive e predefinita | per tenant | vedi TB-DEC-04 |
    | `translation_value` | globale + sovrascritture per tenant | vedi TB-DEC-04 |
    | `auth_rate_limit` | globale per IP, per tenant per account | |
    | `users` (identità) | globale | vedi TB-DEC-02 |

  - **Restano globali**:
    - il catalogo dei permessi;
    - il catalogo delle lingue e le chiavi di traduzione;
    - le tabelle di tipo (`functionality_type`, `user_status`, `role_type`).
  - La versione del dizionario (I18N-06) diventa per **coppia tenant-lingua**.

- [ ] ID=MT-08, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Creazione di un tenant da modello
  - Creando un tenant si copia un modello che contiene:
    - le voci di menu di sistema (Home, Admin e le voci di amministrazione, immutabili);
    - i ruoli di sistema;
    - il tema predefinito;
    - le lingue attive predefinite.
  - Poi parte l'invito al **primo amministratore del tenant**, con la stessa logica degli inviti di
    oggi (AUTH-09).
  - Un tenant senza amministratore attivo non può esistere oltre la fase di creazione.

- [ ] ID=MT-09, Priority=P1, Complexity=High, Estimate=days, Title=[TO-BE] Provider di accesso e domini per tenant
  - Ogni tenant configura i **propri** provider OIDC (per esempio il proprio tenant Entra ID o il
    proprio realm Keycloak) e i domini email che vi entrano automaticamente.
  - I segreti dei provider sono **cifrati** e mai restituiti dall'API dopo il salvataggio.
  - La pagina di login mostra **solo** i provider del tenant risolto, ed email e password solo se il
    tenant li abilita. Questo risolve anche DEC-02.
  - **Registrazione autonoma** per tenant: disattivata, aperta ai domini ammessi, oppure aperta con
    approvazione dell'amministratore (stato "in attesa" di MT-02).

- [ ] ID=MT-10, Priority=P1, Complexity=High, Estimate=days, Title=[TO-BE] Console di piattaforma
  - Area separata, visibile solo agli amministratori di piattaforma (TB-DEC-03).
  - **Griglia dei tenant** (con le regole di GRID-*):
    - nome;
    - slug;
    - stato;
    - dominio primario;
    - numero di utenti attivi;
    - data di creazione;
    - ultima attività.
  - **Dettaglio del tenant**:
    - dati anagrafici;
    - stato e ciclo di vita (MT-01);
    - domini (WL-03);
    - provider (MT-09);
    - amministratori del tenant, con la possibilità di reinviare l'invito.
  - Gestione dei temi modello e del catalogo globale di lingue e chiavi (TB-DEC-04).

- [ ] ID=MT-11, Priority=P2, Complexity=Medium, Estimate=days, Title=[TO-BE] Accesso di assistenza a un tenant
  - Se TB-DEC-03 lo ammette, l'amministratore di piattaforma può entrare in un tenant per
    assistenza:
    - con un motivo obbligatorio;
    - per un tempo limitato;
    - con una fascia ben visibile "Stai operando come assistenza in {tenant}";
    - con ogni azione registrata nel diario del tenant (PERM-12).
  - Il tenant può vedere quando è avvenuto un accesso di assistenza.

- [ ] ID=MT-12, Priority=P0, Complexity=Medium, Estimate=days, Title=[TO-BE] Isolamento dimostrato da test
  - **Test automatici di isolamento**: per **ogni** endpoint, un utente del tenant A tenta di
    leggere e modificare dati del tenant B usando id validi di B. Deve ricevere sempre
    "non trovato" o "vietato", mai i dati.
  - **Controllo automatico dello schema**: ogni nuova tabella di dominio deve avere `id_tenant` e
    una policy RLS, oppure essere dichiarata globale in un elenco esplicito.
  - Il controllo di confine dei privilegi (`boundary-check`, OPS-05) si estende a RLS: l'utente
    dell'app non deve poter aggirare la policy.

- [ ] ID=MT-13, Priority=P3, Complexity=Medium, Estimate=days, Title=[TO-BE] Limiti per tenant (facoltativo)
  - Limiti configurabili dalla piattaforma: numero massimo di utenti attivi, di ruoli, di voci di
    menu, di lingue attive, e lo spazio per gli asset del brand.
  - Superato un limite, l'azione viene rifiutata con un messaggio chiaro e la console mostra l'uso
    rispetto al limite.

- [ ] ID=MT-14, Priority=P2, Complexity=Medium, Estimate=days, Title=[TO-BE] Esportazione ed eliminazione dei dati di un tenant
  - Esportazione completa dei dati di un tenant (utenti, ruoli, menu, temi, traduzioni
    sovrascritte, diario) in un formato documentato, per portabilità e per la chiusura del
    contratto.
  - L'eliminazione definitiva (MT-01) rimuove i dati del tenant e lascia solo una traccia minima
    nel diario della piattaforma.

## 3. Tenant, host e domini

Le voci del white labeling che servono a **riconoscere il tenant** e a farlo accedere dal proprio
dominio. Il resto del white labeling (identità visiva, email, testi, app mobile, asset, metadati)
resta nell'[inventario](../flutter/construct-functional-inventory.md#20-to-be-white-labeling-anche-prima-dellaccesso).

- [ ] ID=WL-02, Priority=P0, Complexity=High, Estimate=days, Title=[TO-BE] Brand applicato prima dell'accesso
  - **Pagine coinvolte**: login, registrazione, password dimenticata, imposta password, pagine
    d'errore e pagina "accesso sospeso". Tutte usano brand, tema, lingue e provider del tenant
    risolto dall'host (MT-04), **prima** di qualunque autenticazione.
  - **Endpoint pubblico** `GET /api/public/branding`:
    - ricava il tenant **solo dall'host** della richiesta e non accetta un id o uno slug come
      parametro, così non si possono elencare i tenant;
    - restituisce nome, URL degli asset, tema, lingue attive e predefinita, provider di accesso
      abilitati e testi del piè di pagina;
    - la risposta si può tenere in cache e porta una versione, che cambia a ogni modifica del
      brand.
  - **Sul web, nessun bagliore del brand sbagliato**: brand e tema arrivano già nella prima
    risposta HTML, come oggi il tema globale arriva nel layout radice.
  - **App mobile, strada A** di TB-DEC-06: la schermata iniziale è neutra; scelto il tenant, l'app
    scarica il brand, lo tiene in memoria e da quel momento parte già brandizzata.
  - Host sconosciuto: vedi TB-DEC-05.

- [ ] ID=WL-03, Priority=P0, Complexity=High, Estimate=days, Title=[TO-BE] Sottodominio e dominio dedicato
  - **Sottodominio**: ogni tenant ha automaticamente `{slug}.<dominio-base>`, coperto da un
    certificato wildcard.
  - **Dominio personalizzato**, gestito dalla console del tenant o della piattaforma:
    1. inserimento del dominio (es. `app.cliente.it`);
    2. **verifica della proprietà** con un record DNS TXT generato;
    3. istruzioni per il record CNAME verso la piattaforma;
    4. **emissione automatica del certificato** (ACME, per esempio cert-manager su Kubernetes);
    5. stato visibile: in attesa di verifica, verificato, certificato attivo, errore (con il
       motivo).
  - Un dominio è **primario**: è quello usato nei link delle email e nei redirect. Gli altri
    domini del tenant reindirizzano al primario.
  - Rimuovere un dominio richiede conferma e non è permesso se è l'unico.
  - **Kubernetes**: Ingress e certificati dinamici per dominio. Oggi l'overlay di produzione ha un
    solo host e un solo segreto TLS.

- [ ] ID=WL-04, Priority=P0, Complexity=High, Estimate=days, Title=[TO-BE] Accesso e sessioni con molti domini
  - **Ritorno dal provider**: si passa per il dominio di autenticazione centrale (TB-DEC-09), che
    rimanda al dominio del tenant con un codice monouso di breve durata.
  - **URL base**: `AUTH_URL` non è più unico. L'URL base di link, cookie e redirect si ricava dal
    dominio primario del tenant, mai dall'intestazione Host non verificata, per evitare l'iniezione
    di host nei link delle email.
  - **Cookie**: legati all'host del tenant e mai condivisi fra tenant. Le difese CSRF valgono per
    host.
