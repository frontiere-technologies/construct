# Ciclo di vita dei dati di un tenant

La 0074 completa l'aggiornamento dalla 0063. Prima di aprire le scritture di policy,
sostituire tutte le istanze e verificare l'annullamento dell'export sul collegamento di
destinazione. La piattaforma gestisce quote, ripristini ed eliminazioni. Il tenant
controlla il consenso e i file che decide di condividere.

## Concessioni, quote e assistenza

La console di piattaforma mostra concessioni per area, eccezioni per capacità, conteggi correnti e
limiti. Il salvataggio usa la revisione della policy. Se un altro amministratore ha salvato nel
frattempo, rileggere la policy e ripetere la modifica desiderata. Disabilitare una capacità
sospende l'efficacia delle assegnazioni esistenti. La riattivazione le rende nuovamente efficaci.
Per rimuoverle, aprire l'anteprima di pulizia delle capacità sospese e confermare sulla stessa
revisione. La conferma verifica anche le assegnazioni selezionate. Se cambiano, serve una nuova
anteprima. Entrambe le operazioni si registrano nel tenant e nella piattaforma.

I limiti contano tutte le appartenenze, tutti i ruoli e tutte le voci di menu, comprese le cartelle.
Un valore vuoto corrisponde a `null`, cioè nessuna quota aggiuntiva. Zero blocca nuove unità.
Abbassare un limite sotto il conteggio corrente conserva le righe già presenti. Per rientrare
nel limite si può ridurre l'uso o alzare la quota. Il limite per query, in millisecondi, restringe
il timeout del database se più severo.

Il consenso di assistenza è una capacità essenziale gestita dal tenant. Per concederlo con
esportazione selezionare l'opzione esplicita prima di scegliere la durata. Ogni rinnovo richiede
una nuova scelta. I consensi storici mantengono scadenza e autore con l'esportazione disabilitata.

`CONSTRUCT_TENANCY_MODE` vale `multi` per impostazione predefinita. La modalità `single`
ammette solo il tenant predefinito sull'host canonico dell'origine configurata. Prima di
attivarla, predisporre esplicitamente appartenenze e ruoli tramite i percorsi canonici.
L'accesso usa solo le assegnazioni esistenti e non attribuisce automaticamente `REGISTERED`,
anche a chi ha già un'appartenenza attiva. «Riprova» rivalida la sessione senza scegliere un
tenant o concedere privilegi. In single l'amministratore del tenant predefinito può esportare.
Console e assistenza di piattaforma sono disponibili soltanto in modalità `multi`.

## Scaricare e custodire un archivio

Dalle impostazioni del tenant attivo, l'amministratore può scaricare l'archivio JSON v1. Per un
amministratore di piattaforma servono un ingresso di assistenza attivo e il consenso di quel
tenant esteso all'esportazione. L'app verifica le condizioni prima di preparare il file e di
nuovo prima della consegna. Il modello e i tenant sospesi o archiviati restano fuori dall'export
via app. Una revoca impedisce nuove consegne e lascia al destinatario la responsabilità dei file
già ricevuti.

L'archivio contiene una fotografia coerente, versione del formato, dello schema e del catalogo,
identificativo di origine, istante e conteggi per tabella. Limiti v1 di 50 MiB di JSON non compresso
e 60 secondi complessivi, oltre all'eventuale limite più severo della singola query. Un errore o
il superamento di un limite interrompe la preparazione senza consegnare un file parziale. La
risposta privata disabilita la cache. Il registro documenta `tenant.export.prepare` prima della
consegna, senza attestare il salvataggio sul dispositivo. Chi riceve il file ne controlla accesso,
cifratura, conservazione e distruzione. Usare un archivio protetto e autorizzato per il trasferimento.

| Dati | Trattamento |
|---|---|
| Appartenenze, ruoli, assegnazioni, menu ed etichette, tema, impostazioni, registro del tenant, policy, concessioni e quote | Sezioni distinte con conteggi, validate da un contratto chiuso. I campi di assistenza esportati documentano lo stato all'origine. |
| Identità e cataloghi globali | Solo riferimenti tecnici e campi identificativi ammessi. I profili dei non membri non sono arricchiti con dati globali. I cataloghi sono rappresentati dalle chiavi necessarie alla verifica. |
| Host dedicati | Metadati, da riassegnare esplicitamente dopo il ripristino. |
| Credenziali, token, sessioni, attributi di piattaforma, limiti tentativi di accesso, domini email globali e registro di piattaforma | Esclusi. |
| Nuove tabelle di tenant | La classificazione richiede copertura esplicita in copia, export, restore e cancellazione. Le operazioni si fermano davanti a tabelle prive di una regola. |

## Ripristinare in un nuovo tenant

Usare un login operatore con `MIGRATION_DATABASE_URL` e la stessa origine pubblica
`AUTH_URL` o `NEXTAUTH_URL` dell'installazione di destinazione. Predisporre gli account
operativi con i normali percorsi d'accesso e un file JSON che associ ogni identificativo
operativo dell'archivio all'UUID di un account già verificato. Le identità solo storiche non
richiedono una corrispondenza. Uno stesso account di destinazione non può rappresentare
più identità operative. Proteggere anche il file della corrispondenza.

```bash
node sources/devops/db/db.mjs tenant-restore \
  --file /percorso/tenant.json --slug tenant-recuperato --name "Tenant recuperato" \
  --user-map /percorso/identita.json
```

La verifica preventiva è in sola lettura. Esaminare conteggi, quote, concessioni effettive,
compatibilità dei codici e destinazioni menu, host ignorati e amministratore attivo. Correggere le
incongruenze prima di ripetere il controllo. Per applicare, ripetere lo stesso comando aggiungendo
`--apply --accept-policy --actor <uuid-account-tecnico-esistente>`. L'applicazione
verifica di nuovo gli input e scrive in una transazione `READ COMMITTED`. Le scritture di
appartenenze, ruoli e voci di menu soggette alle quote richiedono questo livello di isolamento
anche per `construct_owner`, comprese copia e ripristino. Il ripristino crea un tenant sospeso
con slug nuovo, rimappa ruoli e voci e non riattiva host, inviti, sessioni o consensi. Verificare
accessi e policy sulla destinazione, quindi configurare l'indirizzo e riattivare dalla console
con autorizzazione.

Il registro di piattaforma annota `tenant.restore` sul tenant di destinazione. La provenienza
tecnica va nella colonna separata `source_tenant_id`. Nel nuovo tenant l'evento live è
`tenant.create`, con provenienza tecnica, mentre gli eventi importati sono marcati `restored`.
Gli eventi importati documentano lo storico e non aprono assistenza.

## Cancellazione, backup e registri

Un amministratore di piattaforma può eliminare definitivamente un tenant archiviato digitandone
lo slug. La sospensione e l'archiviazione restano azioni distinte e reversibili. Il predefinito e
il modello sono protetti. Se serve un archivio logico, prepararlo con autorizzazione mentre il
tenant è attivo. L'eliminazione non ne produce uno.

L'eliminazione rimuove appartenenze, assegnazioni, configurazioni, host, dati e registri del tenant
in una transazione. Rimuove gli eventi di piattaforma associati alla destinazione cancellata e
azzera la provenienza tecnica nelle voci di ripristino di altri tenant. Conserva gli account
globali e le appartenenze altrove, azzera il riferimento all'ultimo tenant e revoca i token
specifici del tenant. Alla richiesta successiva le sessioni perdono l'accesso. Rimane un solo
`tenant.delete` con data, UUID tecnico dell'attore e identificativo tecnico originale del tenant.
Il campo relazionale è nullo e i dettagli sono vuoti.

| Operazione | Registro |
|---|---|
| `tenant.policy.save` e `tenant.grants.purge` | Tenant e piattaforma, nella transazione della modifica. |
| `tenant.export.prepare` | Tenant per ogni preparazione. Anche piattaforma quando chi prepara è in assistenza. |
| `tenant.restore` | Piattaforma con destinazione e provenienza separate. Il tenant di destinazione registra `tenant.create`. |
| `tenant.delete` | Solo traccia minima in piattaforma. |

Chi opera i backup custodisce separatamente gli identificativi tecnici e gli istanti minimi
delle cancellazioni avvenute dopo ciascuna copia, con accesso e conservazione controllati. Prima
di riaprire un ripristino integrale, confrontare questa traccia con lo snapshot ripristinato e
riapplicare le cancellazioni necessarie con l'operatore autorizzato. Se manca l'archivio logico,
ripristinare la copia integrale in un ambiente isolato, riapplicare lì le cancellazioni e
preparare l'export autorizzato dal tenant recuperabile. File distribuiti, backup del gestore
e log operativi seguono le rispettive politiche di accesso e scadenza.

## Rilasciare da 0063

- [ ] ID=TDL-1, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Preparare pacchetto e finestra per ogni successivo ambiente, Fix description=Checklist da eseguire per ogni successivo ambiente di distribuzione: verificare snapshot e identità, configurare la stessa origine pubblica nel job delle migrazioni e nei comandi che copiano o ripristinano menu con link assoluti, preparare il pacchetto CLI con migrazioni, sonde, schema JSON dell'archivio, menu-target-backfill.mjs e menu-target-url.generated.mjs. Coordinare il blocco dei writer e il ricambio dei renderer prima di riaprire traffico. L’attivazione locale da sorgenti è conclusa in TDL-2…4, con origine http://localhost:3000 e rinuncia al backup autorizzata dal proprietario; questa voce resta aperta per i successivi ambienti di distribuzione.
- [✅] ID=TDL-2, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Applicare 0064–0074 e sostituire tutte le istanze, Fix description=Sul solo sviluppo localhost il 5 novembre 2026 sono concluse le migrazioni 0064–0074 tramite CLI canonica e la verifica del confine 33/33. L’app nuova è attiva su localhost:3000 con PGSSL=verify-full e CA pubblica tramite NODE_EXTRA_CA_CERTS, dopo le verifiche precedenti all’attivazione. Runtime e piattaforma verificati in READ ONLY con lo stesso profilo. Readiness e /login HTTP 200 confermati. Per gli altri ambienti resta la sequenza nuove istanze con CONSTRUCT_PLATFORM_POLICY_WRITES=0, conferma del ricambio e successiva attivazione.
- [✅] ID=TDL-3, Severity=High, Complexity=Medium, Priority=P1, Estimate=hours, Title=Provare l'annullamento sul percorso di destinazione, Fix description=Verifica operativa autorizzata superata il 5 novembre 2026 sullo stesso endpoint Supavisor in modalità transazione, con l’adattatore reale dello scope di export e query sintetiche READ ONLY. Annullamento della propria query attiva tramite CancelRequest, chiusura della transazione e richiesta successiva con contesto sintetico B e timeout corretti verificati. TLS con catena e nome server/SNI verificati su avvio e CancelRequest usando sslmode=verify-full solo in memoria e CA pubblica tramite NODE_EXTRA_CA_CERTS. Il processo di sviluppo attivo usa ora PGSSL=verify-full e la stessa CA; il file .env.local da solo continua a non configurare TLS. L’esecutore annullato viene ritirato e la verifica riguarda il contesto della richiesta successiva. Nessuna scrittura di righe né export reale o audit.
- [✅] ID=TDL-4, Severity=High, Complexity=Medium, Priority=P1, Estimate=minutes, Title=Abilitare le scritture di policy, Fix description=Dopo il sì esplicito del proprietario e le verifiche è stato avviato lo sviluppo localhost con CONSTRUCT_PLATFORM_POLICY_WRITES=1 il 5 novembre 2026. Il flag vale nell’ambiente del processo e va ripetuto a ogni avvio. Nessuna policy o riga di tenant modificata durante l’attivazione. Dopo l'introduzione di concessioni restrittive correggere in avanti o tenere chiusi gli accessi fino alla correzione.

Dalla 0065 `canonical_link` determina la destinazione autorizzata. Il backfill conserva la
gerarchia e il valore originale per l'editor. Una vecchia immagine può ancora leggere il valore
originale, ma può aprire una destinazione diversa da quella canonica. Senza origine non può
scrivere link assoluti. Bloccare le scritture del menu e impedire il rendering con immagini
vecchie nella finestra tra migrazione e sostituzione. Il controllo della generazione del modulo
canonico è in CI. La 0073 acquisisce il blocco di policy prima dei grant in entrambi i delta SQL.
La pulizia segue lo stesso ordine e la revoca arrivata per prima invalida la vecchia anteprima.
La 0074 rifiuta nuovi grant e cambi di chiave in `REPEATABLE READ` e `SERIALIZABLE`.
Le cancellazioni e gli aggiornamenti a chiave invariata restano disponibili. La console
e le pagine di amministrazione del tenant mostrano il limite che ha bloccato una creazione.

La prova PostgreSQL locale verifica annullamento e isolamento sul collegamento diretto.
Le prove TLS sintetiche coprono SNI, fallback e chiusura. La verifica operativa Supavisor
è conclusa nel profilo sicuro indicato in TDL-3. Il processo di sviluppo attivo usa ora
lo stesso profilo di verifica TLS; le attestazioni di attivazione si riferiscono a localhost.

### Avvio locale di sviluppo verificato

Le credenziali di sviluppo già esistenti vanno caricate nel solo ambiente del processo web dal file originale .env.local, senza importare le variabili dell’operatore o della prova. Dalla directory sources/microservices/web-construct, con tale ambiente già disponibile, l’avvio verificato richiede queste opzioni.

```bash
PGSSL=verify-full \
NODE_EXTRA_CA_CERTS=/Users/mario.stefanutti/Downloads/prod-ca-2021.crt \
CONSTRUCT_PLATFORM_POLICY_WRITES=1 \
AUTH_TEST_CREDENTIALS=false \
NEXT_PUBLIC_AUTH_TEST_MODE=false \
npm run dev
```

Il certificato indicato è la CA pubblica fornita dal proprietario. Il file originale .env.local da solo non configura TLS e non è stato modificato. Il profilo sicuro e il flag di attivazione appartengono all’ambiente del processo attuale e devono essere ripetuti a ogni nuovo avvio.
