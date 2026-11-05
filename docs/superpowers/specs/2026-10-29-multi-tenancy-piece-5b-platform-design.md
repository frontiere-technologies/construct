# Multi-tenancy, pezzo 5b: concessioni, limiti e chiusura dei tenant

Data: 2026-10-29. Aggiornato: 2026-10-30. **Specifica rivista e approvata dal proprietario il 2026-10-30.**

## Sommario

Il pezzo 5a è unito a `development` e attivato sul database di sviluppo fino alla migrazione
0063. Il 5b completa la gestione della piattaforma: quali funzioni ogni tenant può usare,
limiti configurabili, modalità per applicazioni con una sola organizzazione, esportazione,
prova di ripristino e cancellazione definitiva di un tenant.

Il proprietario ha confermato concessioni per aree con eccezioni sulle singole funzioni,
sospensione reversibile delle assegnazioni con cancellazione distinta, menu personalizzabili
entro le concessioni, esportazione avviata dal tenant e dalla piattaforma solo con consenso,
e conservazione del solo evento minimo dopo la cancellazione definitiva. Le regole più
dettagliate qui sotto sono proposte progettuali da approvare insieme al documento.

Il risultato atteso è che una concessione abbia lo stesso significato nella console, nel menu,
nei controlli del server e nei vincoli sulle assegnazioni nel database. La disattivazione non
deve distruggere dati o permessi conservati; esportare, ripristinare o eliminare A deve lasciare
intatti B e le identità condivise. Si mantiene l'architettura attuale, senza nuovi servizi.
Su richiesta del proprietario la specifica resta testuale, senza anteprima nel browser.

Riferimenti: [roadmap](../../input-specs/multi-tenancy/multi-tenancy-roadmap.md),
[lavori rimandati](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md),
[studio, §4.8](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-study.md#48-piattaforma-funzionalità-concesse-assistenza-audit),
[requisiti](../../input-specs/multi-tenancy/multi-tenancy-requirements.md),
[specifica 5a](2026-10-26-multi-tenancy-piece-5a-platform-design.md),
[chiusura del 5a](../../reviews/2026-10-29-multi-tenancy-piece-5a-handoff.md).

## 1. Decisioni confermate dal proprietario

**MT5B-DEC-1 — Concessioni miste.** La piattaforma può abilitare intere aree e introdurre
eccezioni sulle singole funzioni. L'area è il percorso ordinario, il dettaglio serve alle
eccezioni. Scelta: «vai con la 3».

**MT5B-DEC-2 — Sospensione con ripristino e cancellazione distinta.** Disabilitare conserva
le assegnazioni ai ruoli e ne sospende l'effetto. Riabilitare le ripristina automaticamente.
Deve esistere anche un'operazione distinta per cancellarle definitivamente: quelle cancellate
non ricompaiono alla riattivazione. Queste operazioni non eliminano i dati del tenant.
Scelta: «Sospensione con ripristino, con la possibilità di cancellare definitivamente le
assegnazioni ai ruoli».

**MT5B-DEC-3 — Menu personalizzabile entro le concessioni.** L'amministratore del tenant può
creare e organizzare voci proprie entro le aree concesse dalla piattaforma. Le voci proprie
non riabilitano funzioni sospese e non allargano le concessioni.

**MT5B-DEC-4 — Esportazione.** Può avviarla l'amministratore del tenant; la piattaforma
soltanto con il consenso del tenant. Scelta confermata il 2026-10-30.

**MT5B-DEC-5 — Traccia della cancellazione definitiva.** Nel registro della piattaforma resta
soltanto l'evento di cancellazione con data, amministratore e identificativo tecnico del tenant.
Scelta confermata il 2026-10-30. Non si conservano vecchi eventi o dati del tenant nel registro.

### Registro delle decisioni e della progettazione

- [✅] ID=MT5B-DEC-3, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Libertà sul menu del tenant, Fix description=Decisione confermata: voci proprie organizzabili entro le aree concesse. Decisione completata, implementazione ancora da fare.
- [✅] ID=MT5B-DEC-4, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Accesso all'esportazione, Fix description=Decisione confermata il 2026-10-30: amministratore del tenant e piattaforma solo con consenso. La modalità concreta del consenso è proposta nel §7, non una decisione già approvata.
- [✅] ID=MT5B-DEC-5, Severity=High, Complexity=Medium, Priority=P0, Estimate=minutes, Title=Traccia della cancellazione, Fix description=Decisione confermata il 2026-10-30: solo evento di cancellazione, data, amministratore e identificativo tecnico del tenant. Conservare gli account condivisi deriva dall'isolamento già richiesto; il trattamento degli account rimasti senza appartenenze è proposto nel §9.
- [✅] ID=MT5B-DES-1, Severity=High, Complexity=High, Priority=P0, Estimate=hours, Title=Completare la specifica verificabile, Fix description=Documento completato e riletto da un revisore indipendente il 2026-10-30. Chiarita l'esportazione del modello; verifica conclusa con «nothing important left». Non comprende l'approvazione né l'implementazione.
- [✅] ID=MT5B-APP-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Approvazione della specifica completa, Fix description=Il proprietario ha approvato il documento e le proposte progettuali rispondendo «procedi» il 2026-10-30 alla richiesta di approvazione completa. Prossimo passo: piano operativo; nessuna autorizzazione implicita al database di sviluppo o al remoto.

## 2. Ambito, vincoli e confini

Il 5b comprende DEF-5.4 (concessioni rispettate), DEF-5.7 (modalità singola), DEF-5.8 (limiti)
e DEF-5.9 (esportazione, ripristino, eliminazione). DEF-5.2 e MT-DEC-04 sono decisioni chiuse,
con implementazione ancora aperta. La cancellazione risolve DEF-A del passaggio di consegne 5a.

Restano la RLS forzata, le chiavi esterne composte, il contesto di tenant limitato alla
transazione, le funzioni `security invoker`, l'identità separata della piattaforma e il
registro scritto nella stessa transazione della modifica. Nessun privilegio di piattaforma
entra nella connessione ordinaria dell'app. Il database continua a identificare il server,
non ogni singola persona: i controlli dell'attore restano nel server; il database impone anche
il limite sulle nuove assegnazioni e le quote. Non si introduce una seconda autorizzazione
per persona nelle policy RLS.

Identità per provider, nuovi stati degli inviti, domini email verificati e provider per tenant
restano nel pezzo 3. Domini reali, accesso fra domini e personalizzazione completa prima
dell'accesso restano nel pezzo 6. Lingue personalizzate, librerie di temi, ripristino automatico
in produzione e cancellazione dell'identità globale non appartengono a questo pezzo.

Il proprietario non ha autorizzato nuovi interventi sul database di sviluppo per il 5b.
Ogni intervento, inclusi comandi non di test e verifiche in lettura, richiede un sì esplicito
separato. I test che modificano dati usano soltanto il database di prova; integrazione e prove
sul browser non girano insieme, e le seconde si lanciano con `uv run pytest`.
Invio del ramo, richiesta di unione e unione richiedono l'OK del proprietario.
Le credenziali non si scrivono nei documenti o nei comandi. Restano intatti lo stash,
`docs/input-specs/rbac-improvements/` e le modifiche del proprietario a
`sources/devops/db/operator.env.example`.

## 3. Catalogo delle funzioni e significato delle concessioni

Le regole da qui in avanti sono **scelte di chi prepara la specifica**, proposte per
l'approvazione completa, salvo i vincoli e le decisioni esplicitamente richiamati.
Il catalogo è versionato nel codice e nelle migrazioni. Ogni area e funzione ha una chiave
stabile, distinta dal nome tradotto e dall'identificativo numerico del menu. Una funzione
rappresenta una capacità dell'app, per esempio leggere utenti o invitarli. La voce di menu
ne è una presentazione e non costituisce da sola un'autorizzazione.

La prima versione copre tutte le porte esistenti, comprese quelle che oggi chiedono soltanto
di essere amministratore. Questo inventario fissa il contenuto; il piano può scegliere i
nomi tecnici delle nuove chiavi senza cambiare i confini.

| Area | Funzioni da concedere separatamente | Collegamenti esistenti |
|---|---|---|
| Persone | Leggere, invitare/aggiungere, disattivare/riattivare, assegnare ruoli | `read-users`, `invite-users`, `set-user-status`, `assign-user-roles` |
| Ruoli | Leggere, creare/modificare/eliminare ruoli, concedere permessi | `read-roles`, `manage-roles`, `grant-role-permissions` |
| Navigazione | Leggere il catalogo del menu, modificarlo, usare contenuti propri | `read-menu`, `manage-menu`, funzione nuova per collegamenti esterni/pagine incorporate |
| Aspetto | Modificare il tema del tenant | `/admin/theme` e azioni oggi riservate all'amministratore |
| Cataloghi consultabili | Consultare lingue, consultare traduzioni | `read-languages`, `read-translations` |
| Configurazione del tenant | Modificare registrazione autonoma e impostazioni amministrative ordinarie | `manage-tenant-settings`, separato dal consenso di assistenza essenziale |

Accesso, uscita, profilo e preferenze personali, pagina iniziale, scelta del tenant, gestione
del consenso di assistenza, consultazione del proprio registro e nuova esportazione del tenant
costituiscono il nucleo essenziale. La piattaforma non può spegnerli con le concessioni;
rimangono i normali controlli di appartenenza, ruolo e stato. Registro e consenso conservano
i permessi attuali; l'esportazione richiede l'amministratore del tenant. Essenziale non
significa accessibile a tutti, né utilizzabile in un tenant sospeso. Le operazioni globali
della piattaforma, incluse scritture su lingue e traduzioni, sono esterne al catalogo.
I codici inutilizzati (`manage-permissions` e le vecchie scritture sui cataloghi) si documentano
come tali: una concessione non li trasforma in funzioni utilizzabili.
Consultare i cataloghi da una pagina amministrativa è distinto dal leggere i dizionari e
scegliere la lingua nell'uso ordinario: questi ultimi restano disponibili. La nuova capacità
di usare contenuti propri si combina con le assegnazioni alle voci già esistenti, senza
richiedere un nuovo permesso individuale a tutti gli utenti che oggi le possono aprire.

### Precedenza e valori iniziali

Una funzione ordinaria può «Ereditare dall'area», essere «Consentita» o «Negata».
L'eccezione esplicita prevale: consente anche con area spenta, nega anche con area accesa.
Non assegna mai un ruolo alla persona, stabilisce solo il massimo distribuibile.
Una capacità di scrittura richiede le capacità di lettura necessarie alla propria pagina:
la console mostra le dipendenze e rifiuta combinazioni incoerenti, senza concedere nulla
automaticamente. Il piano deve elencare queste dipendenze nel catalogo e provarle.

| Area | Eccezione della funzione | Funzione concessa |
|---|---|---|
| Accesa | Eredita / Consenti | Sì |
| Accesa | Nega | No |
| Spenta | Eredita / Nega | No |
| Spenta | Consenti | Sì, se le dipendenze sono anch'esse concesse |

Per i tenant già presenti si conserva l'accesso attuale: aree iniziali accese, nessuna
eccezione e nessuna nuova quota. Un nuovo tenant riceve una copia della configurazione del
modello; cambiarlo non modifica i tenant esistenti. Una funzione aggiunta in futuro eredita
l'area dichiarata; un'area nuova parte spenta nei tenant esistenti finché la piattaforma o
una migrazione la abilita esplicitamente. Chiavi sconosciute vengono rifiutate; funzioni
sconosciute o non mappate non si rendono disponibili per difetto.

### Menu propri e assegnazioni conservate

Le eccezioni della piattaforma riguardano le funzioni del catalogo, comprese quelle presentate
dal menu modello. Non trasformano ogni collegamento scritto dal tenant in una funzione globale.
Una voce propria verso una pagina dell'app resta legata alla capacità di quella pagina;
duplicarla, spostarla, cambiarne etichetta o usare un URL equivalente non cambia il controllo.

Collegamenti esterni e pagine incorporate usano «contenuti propri» dell'area Navigazione,
oltre agli attuali controlli su URL e contenuti. Possono essere organizzati nelle aree
concesse: ogni voce/categoria ha un'associazione logica ad area; cambiare padre non la
riscrive implicitamente. Un cambio esplicito di area richiede che la destinazione sia
concessa e compatibile con la capacità effettiva del collegamento. L'URL di una pagina interna
si risolve nella sua funzione reale, senza poterlo dichiarare esterno per riabilitarlo.
Le categorie organizzano, non sono permessi; senza figli visibili non compaiono.
Le voci di sistema immutabili restano protette.
I contenitori comuni, per esempio la radice Amministrazione, possono essere neutri e avere
figli di aree diverse: la loro posizione non diventa una concessione. La migrazione riconosce
le capacità delle pagine interne dai percorsi canonici, non dalle etichette; classifica i
contenuti propri esistenti nell'area Navigazione senza spostare o rinominare le voci.

La sospensione filtra autorizzazione e navigazione senza cancellare `role_permission` o
`role_functionality`. L'amministratore vede le assegnazioni sospese con motivo e può revocarle,
ma non aggiungerne di nuove. La riattivazione restituisce effetto alle righe rimaste.
Questo vale anche per l'amministratore implicito e per l'attore di assistenza.

«Cancella assegnazioni» è un comando distinto della piattaforma, con riepilogo del numero
di ruoli e assegnazioni e conferma esplicita. Per un'area il riepilogo elenca le funzioni
selezionate, rispettando le eccezioni: non include di nascosto funzioni ancora concesse.
Elimina solo righe di assegnazione di quelle funzioni e dei relativi collegamenti, inclusi
gli alias, mai ruoli, persone, menu o dati applicativi. L'amministratore conserva il proprio
accesso implicito alle funzioni concesse: cancellare assegnazioni esplicite non revoca il
ruolo di amministratore.

## 4. Autorizzazione, dati e operazioni simultanee

L'autorizzazione effettiva è l'intersezione tra concessioni del tenant e permessi dell'attore.
Si applica prima delle scorciatoie da amministratore in `actor.ts`, nelle guardie di concessione,
sulle pagine e azioni del solo amministratore, nel menu e nell'assistenza. Le modifiche valgono
dalla richiesta successiva; nessuna concessione vive soltanto nel token o in una memoria
fra richieste. Si estende la lettura dell'autorizzazione già accorpata, conservando i controlli
sui viaggi verso il database.

Concessioni e limiti sono separati dalle impostazioni modificabili dal tenant. Il ruolo
ordinario li legge nel proprio contesto ma non li scrive: modifica solo la piattaforma con
la propria connessione. Le nuove tabelle di tenant hanno RLS forzata, chiavi composte e
indici con `id_tenant` iniziale. Nessuna configurazione arriva fidata dal browser.

Nel database vincoli o trigger impediscono nuove righe di `role_permission` e
`role_functionality` per capacità non concesse, anche attraverso le funzioni SQL esistenti.
Aggiornamenti estranei alla capacità e cancellazioni restano possibili sulle righe conservate.
Una chiave esterna che obblighi tutte le righe storiche a essere abilitate non va bene:
renderebbe impossibile la sospensione reversibile.
La copia dal modello e il ripristino possono ricostruire assegnazioni storiche già sospese,
senza abilitarle: è un percorso riservato all'operatore/piattaforma durante la creazione,
con origine e copertura validate. Non è un modo di concedere nuovi privilegi a un tenant
esistente, né un interruttore aggirabile dal ruolo ordinario dell'app. Il piano distingue
questo caricamento storico dalle nuove assegnazioni e ne prova il confine nel database.

Aggiornare concessioni, cancellare assegnazioni e concedere permessi usa la stessa
serializzazione per tenant. Una modifica concorrente non inserisce nuovi privilegi dopo
la conferma della sospensione. L'ordine dei blocchi è uniforme con menu, ruoli e ultimo
amministratore; non si bloccano tenant diversi fra loro. Una lettura già avviata può terminare
con la fotografia iniziale; una modifica rivalida le concessioni nella transazione che scrive.
Il controllo dei diritti individuali resta del server, la RLS garantisce il confine del tenant.

## 5. Limiti e modalità con una sola organizzazione

### Quote

Quote facoltative, impostate dalla piattaforma e visibili al tenant. `null` significa nessuna
quota aggiuntiva; zero significa nessuna nuova risorsa del tipo. Il conteggio include elementi
sospesi o non utilizzabili per evitare elusioni.

| Risorsa | Conteggio | Effetto del superamento |
|---|---|---|
| Persone | Tutte le appartenenze, attive e disattivate; in futuro anche quelle invitate | Blocca una nuova appartenenza; riattivare quella esistente non consuma un posto |
| Ruoli | Tutti i ruoli, compresi quelli di sistema | Blocca la creazione; i due ruoli di sistema necessari non sono eliminabili |
| Voci di menu | Tutte le voci, categorie comprese, anche immutabili o sospese | Blocca creazione e copia; modifiche e spostamenti senza aumento restano possibili |

Abbassare una quota sotto l'uso è consentito con avviso esplicito e non cancella dati.
Si impediscono gli incrementi finché il conteggio rientra. Ogni strada, inclusi inviti,
registrazione autonoma, copia del modello e comandi, rispetta le quote. Una quota copiata dal
modello insufficiente per i dati iniziali fa fallire l'intera creazione con errore leggibile.
Le operazioni necessarie a ridurre l'uso restano possibili. Conteggio e inserimento sono nella
stessa transazione, serializzata per tenant anche nel database: due richieste sull'ultimo
posto non possono riuscire entrambe.

### Tempo delle query

La piattaforma può impostare un tempo massimo positivo in millisecondi oppure lasciare il
limite ereditato dalla connessione. Il valore effettivo non allenta un limite più severo
imposto all'utente del database. Zero non spegne un limite preesistente. L'impostazione è
locale alla transazione dentro `withTenant`, senza residui sulla connessione del pool.
Vale per query applicative, assistenza ed esportazione via app. I comandi di ripristino hanno
limiti operativi espliciti propri, non disattivano di nascosto quelli dell'app.
Il tempo scaduto annulla l'operazione con messaggio comprensibile, senza risposte parziali.
Il piano evita una query di configurazione per ogni query dei servizi e misura l'eventuale
costo fisso per transazione rispetto ai tetti attuali.

### Applicazione con una sola organizzazione

Configurazione di installazione non modificabile dal browser, inizialmente multi-tenant.
La modalità singola usa sempre `default`, nasconde console e selettore e disabilita anche
le relative pagine, azioni e ingressi diretti. Gli indirizzi dedicati degli altri tenant non
selezionano un tenant alternativo; la verifica dell'indirizzo canonico dell'installazione
rimane. Non si modificano o cancellano gli altri tenant.

JWT vecchi con un altro tenant o assistenza non aggirano la modalità: vengono rivalidati
per `default` o richiedono un nuovo accesso. Nessuna appartenenza o privilegio automatico.
Un account senza appartenenza valida a `default` non accede. `id_tenant`, connessioni limitate,
concessioni e RLS restano identici; i comandi operativi restano disponibili con le normali
autorizzazioni. Tornare alla modalità multipla ripristina l'interfaccia senza ricostruire dati.

## 6. Schermate e operazioni visibili

Nella scheda di piattaforma si aggiungono «Funzioni e limiti» e una zona distinta per
esportazione e cancellazione. Le aree mostrano l'interruttore; il dettaglio presenta le tre
opzioni per funzione e il risultato effettivo con provenienza. Prima del salvataggio si
vedono dipendenze mancanti e assegnazioni che saranno sospese. Salvataggio atomico con
rilevazione delle modifiche concorrenti, senza sovrascrivere la configurazione appena salvata
da un altro amministratore. «Salva» non cancella assegnazioni automaticamente.

Quote e uso corrente sono affiancati con avviso di superamento. Nel tenant l'editor dei
ruoli distingue «non concesso dalla piattaforma» da «non assegnato al ruolo»; il menu propone
solo aree e capacità disponibili. Limiti o revoche sopraggiunti danno un errore chiaro e
ricaricano i dati. Si seguono internazionalizzazione e componenti/token shadcn del progetto.

L'amministratore trova «Esporta dati» nelle impostazioni essenziali. La piattaforma vede lo
stato del consenso ma scarica entrando nell'assistenza autorizzata, senza percorsi alternativi.
L'eliminazione è nella console, separata da sospensione e archiviazione, con nome del tenant
e conferma digitando lo slug.

## 7. Esportazione

Si propone di riusare il consenso di assistenza 5a, rendendo esplicito nel testo che include
l'esportazione completa. La piattaforma deve avere un ingresso di assistenza aperto, motivo
e scadenza validi; identità, tenant attivo e consenso si ricontrollano all'avvio e prima della
consegna. L'eccezione del modello senza consenso non autorizza l'esportazione: anche qui serve
consenso esplicito. Poiché il modello non ha un amministratore proprio che possa darlo,
la sua esportazione dall'app non è disponibile nel 5b. Restano la copia del modello per creare
tenant e le copie di sicurezza operative dell'installazione; la piattaforma non si autorizza
da sola. L'amministratore di un tenant ordinario esporta senza concedere assistenza.
La scelta di includere l'esportazione è esplicita e registrata insieme al consenso, inizialmente
spenta: i consensi di assistenza anteriori al 5b continuano a valere per l'assistenza ma non
autorizzano l'esportazione. Solo il tenant può concedere questa estensione o revocarla.
Una revoca non ritira file già scaricati; impedisce nuova esportazione e consegna pendente.
Il controllo prima della consegna legge uno stato aggiornato, fuori dalla fotografia dei
dati esportati: una transazione con fotografia stabile non deve nascondere una revoca già
confermata. Si ricontrollano anche account e ruolo dell'amministratore che ha chiesto il file.
Per un tenant sospeso o archiviato non si esporta dall'app: occorre farlo prima dell'archiviazione
oppure dopo una riattivazione deliberata.

Formato JSON con versione del formato, schema/catalogo, istante, metadati, riferimenti alle
identità e sezioni con conteggi. Contiene tutte le righe di proprietà del tenant: appartenenze,
ruoli, assegnazioni, menu ed etichette, tema, impostazioni e registro,
comprese nuove concessioni e quote. Gli indirizzi dedicati sono metadati, non autorizzazioni
da riattivare. Registro della piattaforma e cataloghi globali sono esclusi; dei secondi si
registrano chiavi/versioni necessarie a verificare la compatibilità.
Precisazione ricavata dal codice durante il piano: `allowed_domains` è ancora un elenco
globale, come `auth_rate_limit` e `password_set_tokens`; non è esportabile o cancellabile
come proprietà del singolo tenant. I domini email per tenant restano nel pezzo 3, senza
anticiparne la migrazione nel 5b.

Mai password, hash, token di invito/reimpostazione, segreti, sessioni, limiti dei tentativi
d'accesso o attributi di amministratore di piattaforma. Delle identità globali entrano solo
riferimenti tecnici e campi identificativi già visibili all'amministratore del tenant.
I dettagli del registro si filtrano con uno schema ammesso, evitando che vecchi eventi
reintroducano campi esclusi o dati di altri tenant. Il file non è una copia delle credenziali.

Fotografia coerente in una transazione appropriata; l'evento «esportazione preparata» è
registrato prima della consegna, senza pretendere di provare il salvataggio sul computer.
Il file non contiene se stesso nel proprio registro. Nessuna copia persistente sul server,
link pubblico, email o servizio nuovo. Risposta autenticata con cache disabilitata e limiti
espliciti: per la prima versione massimo 50 MiB di JSON non compresso e 60 secondi totali,
oltre al tempo per query se più severo. Superarli restituisce errore senza file parziale;
il piano verifica memoria e interruzione prima dell'invio. Non si troncano tabelle per rientrare.

Esportazione, copia del modello, ripristino e cancellazione hanno registri espliciti delle
tabelle gestite. Una tabella di tenant nuova senza regola fa fallire copertura e operazione,
invece di produrre una copia incompleta. Esclusioni tecniche nominate e motivate, non
ricavate scartando genericamente le tabelle con `id_tenant`.

## 8. Ripristino e prova di isolamento

Comando operativo canonico in `db.mjs`, con verifica preventiva senza scritture e applicazione
esplicita; nessuna schermata di importazione per gli utenti. Non accetta SQL dal file.
Versione, campi, chiavi, conteggi, riferimenti e quote si validano prima di scrivere.
Il ripristino richiede un nuovo slug e crea un tenant inizialmente sospeso, senza sovrascrivere
un tenant o ricreare privilegi speciali di `default` e modello. Collisioni e incompatibilità
si fermano con indicazioni precise.

Ruoli e menu ricevono identificativi nuovi con rimappaggio dei riferimenti. Codici dei permessi
e funzioni devono essere riconosciuti dal catalogo di destinazione: nessuna importazione
parziale di codici sconosciuti. Concessioni e quote sono dati di piattaforma: il comando le
applica come scelta esplicita dell'operatore, mostrata nella verifica preventiva, non come
istruzioni privilegiate fidate. Il file non crea, unisce per email, modifica o promuove
account globali.

L'operatore fornisce una corrispondenza verificata completa fra riferimenti alle persone nel
file e account già presenti. Sulla stessa installazione può confermare gli stessi id;
su un'altra prepara gli account con percorsi canonici e conferma la corrispondenza.
Una corrispondenza mancante/ambigua impedisce il ripristino. Si ricreano solo appartenenze
e ruoli del nuovo tenant, non credenziali o altre appartenenze. Le identità storiche del
registro restano riferimenti storici e non creano account o autorizzazioni.

Consensi, sessioni, inviti e indirizzi dedicati non si riattivano. Prima di attivare si
verificano almeno un amministratore attivo, concessioni/quote coerenti e configurazione
d'accesso. Inserimento atomico, con origine registrata; eventi storici distinguibili da quelli
della nuova installazione. Un fallimento non lascia un tenant parzialmente ripristinato.

Prova obbligatoria solo sul database di test: esportare A con B presente, ripristinare A come
A2 e verificare dati/autorizzazioni rimappati, B e account globali invariati. Include assegnazioni
sospese, identità condivise, storico, dati non banali e fallimento iniettato per dimostrare
l'annullamento completo. La guida spiega anche come partire da una copia dell'intero database
ripristinata altrove se l'esportazione logica non è disponibile; niente prove sullo sviluppo
senza un nuovo sì.

## 9. Cancellazione definitiva e registri

Riservata alla piattaforma come MT-01, senza richiedere assistenza per leggere dati.
Si propone di ammetterla solo per un tenant già archiviato, digitando lo slug attuale.
`default` e modello non sono eliminabili. La conferma avvisa che spariscono anche assegnazioni
e registri e che un file già esportato resta a chi lo ha scaricato. Esportare non è un
prerequisito obbligatorio e non avviene implicitamente.

Una sola transazione con identità di piattaforma e contesto del tenant elimina tutte le
righe di sua proprietà, indirizzi, configurazioni e appartenenze. Rimuove il registro del
tenant e tutti gli eventi precedenti della piattaforma associati a esso. È l'eccezione stretta
all'immutabilità: nessuna funzione generica di modifica/pulizia, nessun nuovo privilegio
al ruolo dell'app. Non si espone il comando di pulizia dei test. Le nuove migrazioni risolvono
le chiavi esterne del 5a; il solo `ON DELETE SET NULL` non eliminerebbe lo storico scelto.

Nella stessa transazione rimane l'unico evento `tenant.delete`, con istante, identificativo
tecnico dell'amministratore reale e identificativo tecnico originario del tenant. Il campo
relazionale del tenant resta nullo, l'id storico va nel campo oggetto senza chiave esterna
obbligatoria verso `tenant`. Niente slug, nome, indirizzi, email del tenant, conteggi, motivo
libero o vecchi dettagli. L'amministratore è identificato dall'id senza duplicarne l'email.
Se il registro non si può scrivere, anche la cancellazione si annulla.

L'associazione degli eventi ai tenant è strutturata ed esaustiva. Si inventariano e provano
anche le scritture già presenti: niente ricerca di stringhe o copie del tenant dimenticate
in eventi globali. Per eventi con più oggetti si separa la porzione di tenant da quella
globale senza distruggere gli eventi degli altri. La copertura intercetta nuovi tipi di
evento che potrebbero sfuggire alla cancellazione.

`users` resta globale: appartenenze e assegnazioni del tenant spariscono, le altre rimangono.
Anche un account senza più appartenenze resta senza accesso al tenant cancellato; eliminare
l'identità è un'altra procedura, fuori dal 5b. I riferimenti all'ultimo tenant si azzerano.
Non si cancellano token globali per email: quelli specifici del tenant si revocano, i reset
globali non danno appartenenza e non ricreano il tenant. Le sessioni aperte perdono accesso
alla richiesta successiva. Il blocco per tenant impedisce scritture durante l'eliminazione.

Questa promessa riguarda dati attivi dell'app e suoi registri. File già esportati, copie di
sicurezza del gestore del database e log operativi seguono le proprie procedure: il pulsante
non può riscriverli. Ripristinare una copia integrale antecedente alla cancellazione richiede
riapplicare le cancellazioni successive usando la traccia tecnica.

## 10. Registro delle operazioni, compatibilità e rilascio

Concessioni, quote e cancellazione delle assegnazioni producono eventi nei registri della
piattaforma e del tenant nella stessa transazione, con attore reale, oggetto e differenze
strutturate. Esportazione del tenant nel suo registro; quella della piattaforma anche nel
registro globale, con consenso. Il ripristino registra origine tecnica e nuovo tenant.
La cancellazione conserva soltanto l'evento del §9. Nessun evento include file o credenziali.

Migrazioni successive alla 0063, senza modificare quelle applicate o lo schema generato a mano.
Il piano distingue aggiunta di catalogo/configurazione compatibile, aggiornamento delle porte
e attivazione operativa delle restrizioni. Non si modificano concessioni con vecchie istanze
dell'app ancora attive: il rilascio lo impedisce finché tutte usano i nuovi controlli.
Un vecchio eseguibile non conosce le concessioni nuove. Dopo l'attivazione non si torna a una
versione che le ignora: si corregge in avanti o si ferma l'accesso durante il recupero,
senza aprire le policy RLS.

Si provano database nuovo e aggiornamento dalla 0063. `copy_tenant`, creazione da console/comando
e registrazione iniziale conoscono catalogo, quote e tabelle nuove; unificare in generale i
vecchi helper resta distinto. Contratto di schema e `boundary-check` avanzano insieme;
in CI quest'ultimo gira sul database usa e getta dopo il provisioning.

La guida descrive modalità singola, concessioni, limiti, esportazione, verifica/ripristino,
cancellazione e rilascio a tappe. Solo dopo unione e nuovi sì espliciti si applica allo sviluppo.
Approvare la specifica non autorizza questi comandi, invio del ramo, richiesta di unione o unione.

## 11. Criteri da verificare nell'implementazione

- [✅] ID=MT5B-OK-1, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Concessioni rispettate ovunque, Fix description=Provare precedenza, dipendenze, vecchi/nuovi tenant, amministratore e assistenza; richieste dirette, pagine amministrative, URL equivalenti e menu propri non aggirano il limite. Nuove assegnazioni vietate anche via SQL e funzioni esistenti; lettura accorpata e tetti dei viaggi al database conservati.
- [✅] ID=MT5B-OK-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Sospensione e ripristino verificati, Fix description=Conservare assegnazioni, impedirne uso/incremento, consentire revoca e recuperare solo quelle rimaste. Provare comando distinto di cancellazione, alias e modifiche concorrenti senza perdita di altri dati.
- [✅] ID=MT5B-OK-3, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Limiti rispettati anche con operazioni simultanee, Fix description=Provare conteggi, quota nulla/zero, riduzione sotto l'uso, ultimo posto concorrente, invito/registrazione/copia e creazione da modello. Timeout e annullamento senza residui sulla connessione riusata da un altro tenant nelle modalità del pool supportate. Implementazione e prove PostgreSQL dirette superate fino alla 0074. Verifica operativa Supavisor superata il 5 novembre 2026 con sslmode=verify-full in memoria e CA pubblica tramite NODE_EXTRA_CA_CERTS, inclusa richiesta successiva con contesto sintetico B e timeout distinti. L’esecutore annullato viene ritirato e la richiesta successiva usa correttamente il proprio contesto e timeout. Il processo di sviluppo localhost attivo usa ora PGSSL=verify-full e la stessa CA, con runtime e piattaforma verificati in READ ONLY. Il profilo va ripetuto a ogni avvio; il file originale .env.local da solo non configura TLS.
- [✅] ID=MT5B-OK-4, Severity=Critical, Complexity=High, Priority=P1, Estimate=days, Title=Esportazione ripristino e cancellazione isolati, Fix description=Con A e B esportare A, ripristinare A2 con rimappaggio, eliminare A. B e identità globali immutati; segreti assenti; versioni/corrispondenze/quote incompatibili falliscono senza residui; solo evento minimo dopo cancellazione, inclusi vecchi dettagli del registro. Fallimenti del registro e scritture concorrenti provati.
- [✅] ID=MT5B-OK-5, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Modalità con una sola organizzazione, Fix description=Provare interfaccia/ingressi diretti, indirizzi, vecchi JWT/assistenza, account senza appartenenza e ritorno alla modalità multipla. RLS e privilegi identici, nessuna appartenenza automatica.
- [✅] ID=MT5B-OK-6, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Consenso e copertura completi, Fix description=Provare consenso presente/assente/scaduto/revocato durante preparazione e modello; solo amministratore o assistenza autorizzata esportano. Inventario di porte, tabelle, funzioni, campi del file ed eventi: un elemento nuovo non coperto fa fallire il controllo. Limiti del file, cache e assenza di risposta parziale provati.
- [✅] ID=MT5B-OK-7, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Interfaccia e migrazioni verificate, Fix description=Provare console, errori, accessibilità, traduzioni e conflitti; database nuovo e dalla 0063, copie dal modello, contratto di schema e confine. Lint, tipi, unità, integrazione, build e browser secondo il progetto; integrazione/browser in sequenza sul database di test.
- [✅] ID=MT5B-OK-8, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Guida operativa e attivazione separata, Fix description=Verificare comandi sulla prova, documentare compatibilità e recupero; ottenere separatamente OK per invio/richiesta/unione e ogni intervento sullo sviluppo. Spuntare voci originarie solo per lavoro realizzato e verificato. Guida e comandi verificati in locale, PR #90 unita e migrazioni di sviluppo 0064–0074 applicate con autorizzazione del proprietario. Attivazione dello sviluppo localhost autorizzata separatamente ed eseguita con profilo TLS verificato e CONSTRUCT_PLATFORM_POLICY_WRITES=1 nell’ambiente del processo. Riavvio documentato nel runbook, voci MT-5.9 e DEF-5.8 aggiornate sulla stessa evidenza. La chiusura operativa riguarda lo sviluppo locale.

## 12. Scelte lasciate a chi scrive il piano

Il piano decide nomi/suddivisione dei moduli, schema concreto di catalogo e configurazione,
tecnica di serializzazione coerente con l'esistente, nomi di funzioni SQL e comandi, dettagli
del validatore e disposizione dei componenti. Mantiene i contratti descritti, esplicita
dipendenze e fasi di rilascio e divide il lavoro in cambiamenti verificabili.
Non cambia consenso, ripristino delle assegnazioni, traccia residua o confine delle identità
senza tornare al proprietario.

### Stato della revisione

Revisione indipendente completata il 2026-10-30. L'unica domanda riguardava chi potesse
autorizzare l'esportazione del modello senza amministratori: si è scelto di non esporla
nell'app, mantenendo consenso esplicito e divieto di auto-autorizzazione della piattaforma.
Il revisore ha riletto il chiarimento e concluso «nothing important left».
Approvazione completa ottenuta il 2026-10-30 con «procedi», dopo la presentazione del documento
e delle proposte. Nessun codice applicativo o migrazione del 5b è stato scritto in questa fase.
