# Specifica — Multi-tenancy, pezzo 4: tenant corrente (2026-10-21)

Quarto dei sei pezzi della multi-tenancy. Si appoggia su:

- la [specifica del pezzo 1](2026-10-13-multi-tenancy-foundations-design.md): `id_tenant`, RLS
  restrittiva e forzata, `withTenant`/`withGlobal`, ruoli di sistema per chiave;
- la [specifica del pezzo 2](2026-10-20-multi-tenancy-piece-2-memberships-design.md): appartenenze
  (`tenant_membership`), tenant modello, `db.mjs tenant-create`;
- il [documento delle cose rimandate](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md),
  voci DEF-4.1…DEF-4.4 (DEF-4.5 resta fuori, §1.2);
- i [requisiti TO-BE](../../input-specs/multi-tenancy/multi-tenancy-requirements.md): MT-04, MT-05,
  MT-06, MT-APP-1, MT-APP-2, MT-APP-4, MT-TEST-5, TB-DEC-05.

Le decisioni sono state prese con il proprietario del progetto il 2026-10-21. Le scelte lasciate a
chi scrive la specifica sono segnate "**scelta di progetto**".

## Sommario

**Perché.** Dopo il pezzo 2 una persona può appartenere a più tenant e la piattaforma può crearne di
nuovi, ma ogni richiesta è ancora servita dal tenant predefinito: i tenant nuovi non si usano dal
browser. Il caso reale è quello dei **dipartimenti**: a volte condividono lo stesso indirizzo e la
stessa persona lavora in più di uno; a volte hanno un indirizzo tutto loro e devono restare separati.

**Dopo questo pezzo:**

- il tenant in cui si lavora dipende dall'**indirizzo** da cui si entra e, se su quell'indirizzo la
  persona ha più tenant, dalla sua **scelta**;
- al primo accesso con più tenant sullo stesso indirizzo compare una **pagina di scelta a schede**;
  dalla volta dopo si entra nell'**ultimo tenant usato**;
- il nome del tenant corrente sta **in cima alla barra laterale**; da lì si passa a un altro tenant
  dello stesso indirizzo;
- ogni tenant decide se **accetta le registrazioni autonome**; chi si registra da un indirizzo entra
  nel tenant di quell'indirizzo;
- un test verifica che, da una persona del tenant A, **nessun ingresso** (pagina, azione, rotta) dia
  accesso ai dati del tenant B.

## Decisioni

- [✅] ID=MT4-DEC-1, Title=Tenant legati agli indirizzi, Requirement=Un tenant può avere uno o più indirizzi dedicati (dominio o sottodominio, per esempio `a.localhost`); un indirizzo appartiene a un solo tenant. I tenant senza indirizzo dedicato rispondono sull'**indirizzo principale**, cioè su ogni indirizzo non registrato come dedicato (compresi `localhost` e l'indirizzo di sviluppo di oggi). **Scelta di progetto** per gli indirizzi non registrati (TB-DEC-05: nel pezzo 6, con i domini veri, si valuterà la pagina "organizzazione non trovata" sui sottodomini sconosciuti).
- [✅] ID=MT4-DEC-2, Title=Si cambia tenant solo sullo stesso indirizzo, Requirement=Una persona vede e può scegliere solo i tenant di cui è membro attivo e che rispondono sull'indirizzo da cui è entrata. Un tenant su un altro indirizzo non compare e non è raggiungibile da qui.
- [✅] ID=MT4-DEC-3, Title=Nessun tenant sull'indirizzo, Requirement=Se la persona non ha nessun tenant su quell'indirizzo, non entra in nessun tenant e vede il messaggio "Non sei configurato su questo indirizzo". Non viene mandata in automatico su un altro indirizzo.
- [✅] ID=MT4-DEC-4, Title=Ingresso con più tenant, Requirement=Un solo tenant sull'indirizzo: si entra direttamente. Più tenant, prima volta: pagina di scelta a sé, a schede (nome del tenant e ruolo della persona), con scorrimento quando i tenant sono molti (almeno dieci senza difficoltà). Dalla seconda volta: si entra direttamente nell'ultimo tenant usato, se è ancora fra quelli disponibili sull'indirizzo; altrimenti di nuovo la pagina di scelta.
- [✅] ID=MT4-DEC-5, Title=Cambio dalla barra laterale, Requirement=Il nome del tenant corrente sta sempre in cima alla barra laterale. Se la persona ha più di un tenant sull'indirizzo, cliccandolo si apre l'elenco (con scorrimento) e si passa all'altro tenant senza uscire. Dopo il cambio si torna alla home del nuovo tenant, perché menu e permessi possono essere diversi (**scelta di progetto**). Il cambio aggiorna l'ultimo tenant usato.
- [✅] ID=MT4-DEC-6, Title=Ultimo tenant usato nel database, Requirement=L'ultimo tenant usato si salva nel database, legato alla persona, così vale anche da un altro computer o browser. **Scelta di progetto.**
- [✅] ID=MT4-DEC-7, Title=Rivalidazione a ogni richiesta, Requirement=Il tenant corrente viaggia nel token di sessione, ma a ogni richiesta si ricontrolla che: risponda sull'indirizzo della richiesta, la persona vi sia membro attivo con account attivo, il tenant sia `active` e non sia il modello. Se un controllo fallisce, la persona va alla pagina di scelta (se ha altri tenant sull'indirizzo) o al messaggio di MT4-DEC-3. Nessun ingresso accetta il tenant dal client: né parametro, né campo di modulo, né intestazione. **Scelta di progetto** per i tenant `suspended`/`archived`, trattati come non disponibili.
- [✅] ID=MT4-DEC-8, Title=Il modello resta fuori, Requirement=Il tenant modello non compare mai nella scelta né nel cambio. Fino al pezzo 5 si modifica solo via SQL.
- [✅] ID=MT4-DEC-9, Title=Registrazione nel tenant dell'indirizzo, Requirement=Chi si registra da un indirizzo dedicato entra nel tenant di quell'indirizzo; dall'indirizzo principale entra nel tenant predefinito, come oggi. L'elenco dei domini email consentiti continua a valere. La registrazione crea l'appartenenza **solo per chi non è ancora membro di nessun tenant** (un account nuovo, o uno rimasto in attesa senza essere mai entrato da nessuna parte), come la regola del pezzo 2 (MT2-DEC-12). Chi ha già un account in un altro tenant non entra in A da solo: lo aggiunge l'amministratore di A con "Aggiungi persona" (deciso con il proprietario il 2026-10-21); la risposta della registrazione resta comunque la stessa, neutra.
- [✅] ID=MT4-DEC-10, Title=Ogni tenant decide sulle registrazioni autonome, Requirement=Ogni tenant ha un interruttore "accetta registrazioni autonome". Se è spento, chi prova a registrarsi da quell'indirizzo riceve la stessa risposta neutra di oggi e non entra. Lo accende o lo spegne l'**amministratore del tenant**, dalle impostazioni. Valori di partenza: acceso per il tenant predefinito (comportamento di oggi), spento per il modello e quindi per ogni tenant nuovo (**scelta di progetto**). Lo stesso interruttore vale per l'ingresso automatico al primo accesso nel tenant predefinito (pezzo 2, MT2-DEC-12): se il predefinito non accetta registrazioni autonome, nessuno vi entra da solo (**scelta di progetto**).
- [✅] ID=MT4-DEC-11, Title=Pagine prima dell'accesso dal tenant dell'indirizzo, Requirement=Accesso, registrazione, recupero e impostazione della password usano il tenant dell'indirizzo (tema e interruttore delle registrazioni); sull'indirizzo principale vale il tenant predefinito. Lingue e traduzioni restano globali (pezzo 2, MT2-DEC-11); logo e pagina d'ingresso per tenant restano al pezzo 6. **Scelta di progetto.**
- [✅] ID=MT4-DEC-12, Title=Link nelle email dall'indirizzo del tenant, Requirement=I link nelle email (invito, impostazione e recupero della password) puntano all'indirizzo dedicato del tenant da cui partono; per i tenant senza indirizzo dedicato, all'indirizzo configurato oggi (`AUTH_URL`). L'indirizzo si prende dal registro degli indirizzi, mai dall'intestazione `Host` della richiesta così com'è (requisiti, MT-APP-2: evita l'iniezione di link). **Scelta di progetto.**
- [✅] ID=MT4-DEC-13, Title=Indirizzi assegnati dalla piattaforma da comando, Requirement=La piattaforma assegna gli indirizzi dedicati con `db.mjs`: un'opzione `--host` in `tenant-create` e un comando per aggiungerne uno a un tenant esistente. La console arriva con il pezzo 5. **Scelta di progetto.**
- [✅] ID=MT4-DEC-15, Title=Appartenenza disattivata all'accesso, Requirement=All'accesso si guardano i tenant disponibili sull'indirizzo. Se ce n'è almeno uno, si entra (scelta o ingresso diretto) anche se in un altro tenant dello stesso indirizzo l'appartenenza è disattivata. Se non ce n'è nessuno e la persona ha un'appartenenza disattivata in un tenant dell'indirizzo, è respinta con il messaggio di oggi per l'account disattivato (così con un solo tenant non cambia niente, MT4-OK-1); se non ha nessuna appartenenza sull'indirizzo, entra e vede "Non sei configurato su questo indirizzo". **Scelta di progetto.**
- [✅] ID=MT4-DEC-16, Title=Cosa conta come ultimo tenant usato, Requirement=L'ultimo tenant usato cambia solo con una scelta esplicita: la pagina di scelta o il selettore della barra laterale. Entrare direttamente in un indirizzo con un solo tenant non lo cambia, così chi passa da `a.localhost` non perde la scelta fatta sull'indirizzo principale. **Scelta di progetto.**
- [✅] ID=MT4-DEC-17, Title=Predefinito e modello senza indirizzi dedicati, Requirement=Il tenant predefinito resta il tenant dell'indirizzo principale e il modello non risponde su nessun indirizzo: i comandi di `db.mjs` rifiutano di assegnare loro un indirizzo dedicato. **Scelta di progetto.**
- [✅] ID=MT4-DEC-14, Title=Prova con sottodomini di localhost, Requirement=Il comportamento con indirizzi dedicati si prova in locale con `a.localhost` e `b.localhost` (i browser li mandano al computer locale), anche negli E2E. Su questi indirizzi l'accesso si prova con email e password: l'accesso con Google resta sull'indirizzo principale finché il pezzo 6 non porta un accesso unico per tutti i domini.

## 1. Perimetro

### 1.1 Dentro

1. Registro degli indirizzi dedicati dei tenant e regola "indirizzo principale" (MT4-DEC-1).
2. Tenant corrente nel token, rivalidato a ogni richiesta (MT4-DEC-7, DEF-4.1); `resolveRequestTenant()`
   lo restituisce al posto del tenant predefinito fisso.
3. Elenco dei tenant disponibili per la persona sull'indirizzo (MT4-DEC-2).
4. Pagina di scelta a schede e messaggio "Non sei configurato su questo indirizzo" (MT4-DEC-3, 4).
5. Selettore in cima alla barra laterale e azione di cambio (MT4-DEC-5, DEF-4.2).
6. Ultimo tenant usato (MT4-DEC-6).
7. Pagine e rotte prima dell'accesso dal tenant dell'indirizzo (MT4-DEC-11, DEF-4.3).
8. Interruttore delle registrazioni autonome per tenant, con la sua pagina di impostazioni e un
   permesso nuovo (MT4-DEC-10).
9. Link nelle email dall'indirizzo del tenant (MT4-DEC-12).
10. Comandi `db.mjs` per gli indirizzi (MT4-DEC-13).
11. Test fra tenant su ogni ingresso (DEF-4.4) ed E2E con `a.localhost` e `b.localhost` (MT4-DEC-14).

### 1.2 Fuori

- Inviti per tenant con stati `invited`/`pending`, identità per provider, domini email verificati:
  pezzo 3.
- Amministratore di piattaforma, ingresso della piattaforma nel modello o in qualunque tenant,
  console: pezzo 5.
- Domini veri con certificati, accesso unico su più domini (Google compreso), logo e pagina
  d'ingresso per tenant, pagina "organizzazione non trovata" sui sottodomini sconosciuti: pezzo 6.
- Invalidazione della cache delle pagine per singolo tenant (DEF-4.5): oggi un cambio svuota la
  cache di tutti, che costa un po' ma è sicuro. **Scelta di progetto.**
- Lingue e traduzioni per tenant (DEF-2.4).

### 1.3 Criteri di successo

- [ ] ID=MT4-OK-1, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Nessun cambiamento con un solo tenant, Fix description=Chi ha un solo tenant sull'indirizzo principale (oggi: tutti) entra e lavora come prima, senza pagine nuove; l'E2E esistente passa invariato salvo la nuova riga del tenant in cima alla barra laterale.
- [ ] ID=MT4-OK-2, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Due tenant sullo stesso indirizzo, Fix description=Una persona membro di due tenant sull'indirizzo principale vede la pagina di scelta al primo accesso, entra nell'ultimo usato dal secondo, passa all'altro dalla barra laterale e vede menu, utenti e ruoli del tenant scelto.
- [ ] ID=MT4-OK-3, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Indirizzi separati, Fix description=Su `a.localhost` una persona membro di A e di B vede solo A, e il selettore non mostra B; su `b.localhost` il contrario; una persona membro solo di B su `a.localhost` vede "Non sei configurato su questo indirizzo".
- [ ] ID=MT4-OK-4, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Nessun ingresso attraversa i tenant, Fix description=Per ogni pagina protetta, azione del server e rotta (`app/api/**`), una persona del tenant A che usa id del tenant B ottiene 404 o 403 e nessun dato di B; un token con il tenant B presentato su un indirizzo dove B non risponde non dà accesso a B.
- [ ] ID=MT4-OK-5, Severity=High, Complexity=Low, Priority=P1, Estimate=hours, Title=Registrazione per tenant, Fix description=Da `a.localhost`, con l'interruttore di A acceso, la registrazione crea l'appartenenza in A e il link dell'email punta a `a.localhost`; con l'interruttore spento la risposta è la stessa e non si crea nulla.

## 2. Database

### 2.1 Registro degli indirizzi

Tabella globale `tenant_host`, in sola lettura per l'app e scritta dalla piattaforma
(`construct_owner`), come `tenant`:

| Colonna | Tipo | Note |
|---|---|---|
| `host` | `text` | chiave primaria; minuscolo, senza schema né percorso; la porta fa parte dell'indirizzo (`a.localhost:3000`) oppure no: **lasciato al piano**, purché la regola sia una e documentata |
| `id_tenant` | `bigint not null` | chiave esterna verso `tenant(id)` |
| `is_primary` | `boolean not null default false` | al più uno per tenant: l'indirizzo usato nei link delle email (MT4-DEC-12) |
| `created_at` | `timestamptz not null default now()` | |

Il modello non può avere indirizzi. Un indirizzo non presente in tabella è l'indirizzo principale.

### 2.2 Impostazioni del tenant

L'interruttore delle registrazioni autonome è dato **di tenant** e lo scrive l'amministratore del
tenant, mentre `tenant` è globale in sola lettura per l'app: va quindi in una tabella di tenant
nuova, protetta con `protect_tenant_table` (per esempio `tenant_settings (id_tenant, self_registration
boolean not null)`, una riga per tenant). La migrazione crea la riga del predefinito (acceso) e del
modello (spento). La funzione di copia del pezzo 2 rifiuta le tabelle di tenant che non conosce: va
aggiornata (`create or replace`) perché copi anche questa, e ogni tenant nuovo nasce con
l'interruttore spento come il modello.

Permesso nuovo per modificarlo (per esempio `manage-tenant-settings`), seminato come gli altri e
concesso al ruolo amministratore.

### 2.3 Ultimo tenant usato

Colonna globale su `users` (per esempio `last_tenant_id bigint references tenant(id) on delete set
null`). Basta un valore per persona: se l'ultimo usato non è disponibile sull'indirizzo, si torna
alla regola di MT4-DEC-4.

### 2.4 Elenco dei tenant della persona sull'indirizzo

Le appartenenze sono tabelle di tenant: con la RLS forzata non si leggono "tutte insieme". Serve una
funzione SQL `security invoker`, come `is_member_elsewhere` del pezzo 2, che riceve la persona e
l'indirizzo, scorre i tenant che rispondono su quell'indirizzo (non modello, `active`), legge
l'appartenenza e il ruolo in ciascuno cambiando `app.tenant_id`, e **rimette il tenant di partenza
prima di ogni uscita**. Restituisce id, nome del tenant e un'indicazione del ruolo della persona
(per la scheda: per esempio "Amministratore" se ha `TENANT_ADMIN`, altrimenti "Utente"). La forma
esatta è lasciata al piano.

## 3. Applicazione

### 3.1 Tenant nel token

- Il token di sessione porta il tenant corrente. Il callback `jwt` lo sceglie all'accesso (MT4-DEC-4)
  e lo ricontrolla a ogni richiesta (MT4-DEC-7), dentro la transazione che già oggi rilegge
  l'autorizzazione.
- `resolveRequestTenant()` restituisce il tenant del token rivalidato; prima dell'accesso, il tenant
  dell'indirizzo (MT4-DEC-11). Tutti i suoi chiamanti di oggi restano invariati.
- Stati possibili dopo l'accesso: tenant scelto; scelta da fare (pagina di scelta); nessun tenant
  sull'indirizzo (messaggio). Il proxy (`proxy.ts`) e `authorized` mandano alla pagina giusta senza
  leggere il database, solo dal token.
- Il cambio di tenant è un'azione del server che verifica che il tenant sia fra quelli disponibili
  sull'indirizzo (§2.4), aggiorna l'ultimo usato e il token (Auth.js `unstable_update` o equivalente)
  e porta alla home.
- **Indirizzo della richiesta.** Serve un unico punto (in `lib/tenancy`) che ricava l'indirizzo
  della richiesta e lo confronta con il registro. Auth.js oggi usa `AUTH_URL` fisso: per servire più
  indirizzi deve fidarsi dell'indirizzo della richiesta (`trustHost`). L'indirizzo ricavato decide
  solo **quali tenant** sono possibili, confrontato con il registro; non entra mai nei link
  (MT4-DEC-12).
- I viaggi verso il database per richiesta non salgono oltre i tetti del test `round-trip-budget`:
  il controllo del tenant entra nell'istruzione unica dell'autorizzazione dove possibile. Se un tetto
  deve salire, il piano lo motiva e lo aggiorna esplicitamente.

### 3.2 Interfaccia

- **Pagina di scelta** (percorso lasciato al piano, per esempio `/select-tenant`): saluto, nota
  "Potrai cambiare in qualunque momento dalla barra laterale", una scheda per tenant con nome e
  ruolo, griglia che va a capo e pagina che scorre; con molti tenant resta usabile (almeno dieci).
  Accessibile solo a chi ha fatto l'accesso e deve scegliere.
- **Messaggio "Non sei configurato su questo indirizzo"**, con il comando per uscire.
- **Selettore in cima alla barra laterale**: nome del tenant sempre visibile; elenco a comparsa con
  scorrimento solo se i tenant sull'indirizzo sono più di uno; anche con la barra compressa resta
  raggiungibile (forma lasciata al piano, coerente con la barra di oggi).
- **Impostazioni del tenant**: pagina nell'area di amministrazione con l'interruttore "Accetta
  registrazioni autonome", protetta dal permesso nuovo.
- Testi in italiano e inglese, seminati come le altre chiavi.

### 3.3 Prima dell'accesso

- Layout radice (tema), registrazione, recupero e impostazione della password, dizionario e lingue
  ricavano il tenant dall'indirizzo (MT4-DEC-11).
- Registrazione: tenant dell'indirizzo, solo se il suo interruttore è acceso (MT4-DEC-9, 10),
  stessa risposta neutra in ogni caso. Il primo accesso con Google nel predefinito segue lo stesso
  interruttore.

### 3.4 Link nelle email

Invito ("Aggiungi persona", rotta di invio invito), registrazione, recupero della password e
`tenant-create` costruiscono i link con l'indirizzo principale del tenant (§2.1, `is_primary`) o,
se non ne ha, con `AUTH_URL`.

### 3.5 Comandi

- `tenant-create --slug … --name … --admin … [--host …]`: con `--host` registra l'indirizzo come
  principale del tenant nuovo, nella stessa transazione.
- Un comando per aggiungere un indirizzo a un tenant esistente (e per sceglierne il principale);
  variante `test-*` sul database di prova con la stessa regola di sicurezza.
- Lo sviluppo locale deve accettare `a.localhost` e `b.localhost` (configurazione di Next.js).

## 4. Test

- **Indirizzi:** regola dell'indirizzo principale; un indirizzo dedicato porta solo al suo tenant;
  indirizzi in maiuscolo o con la porta trattati in modo coerente.
- **Elenco dei tenant della persona:** solo tenant dell'indirizzo, attivi, non modello, con
  appartenenza attiva; il contesto del tenant torna quello di partenza.
- **Token:** scelta all'accesso (uno, più, nessuno, ultimo usato); rivalidazione con appartenenza
  disattivata, tenant sospeso, indirizzo cambiato; nessun tenant accettato dal client.
- **Cambio:** verso un tenant disponibile funziona; verso uno non disponibile (altro indirizzo,
  disattivato, modello, inesistente) è rifiutato senza cambiare niente.
- **Registrazione:** tenant dell'indirizzo, interruttore acceso e spento, risposta identica; chi è
  già membro di un altro tenant non entra da solo in quello dell'indirizzo.
- **Fra tenant su ogni ingresso (DEF-4.4, MT4-OK-4):** l'inventario degli ingressi si ricava come fa
  `guards/permission-declared.test.ts` (azioni, rotte, pagine protette), così un ingresso nuovo
  senza test fa fallire la verifica. **Scelta di progetto** sulla forma: test di integrazione sul
  database di prova, che chiamano rotte, azioni e caricatori delle pagine nello stesso processo con
  la sessione di una persona del tenant A e id del tenant B; gli ingressi che non ricevono id (salute,
  dizionario, preferenze personali) stanno in un elenco di esenzioni esplicito e motivato. In più,
  pochi E2E veri via HTTP: il token del tenant B presentato su un indirizzo dove B non risponde.
- **E2E:** MT4-OK-2 e MT4-OK-3 con l'indirizzo principale, `a.localhost` e `b.localhost`;
  l'E2E di oggi invariato (MT4-OK-1).
- **Tetti dei viaggi** invariati o aggiornati con motivazione (§3.1).

## 5. Rilascio e rischi

### 5.1 Rilascio

Migrazioni nuove (dalla 0053) e il codice che le usa. Sul database di sviluppo si applicano con
conferma del proprietario, dopo il merge, come per il pezzo 2. Le sessioni aperte prima del rilascio
non hanno il tenant nel token: al primo controllo vengono trattate come un accesso nuovo (scelta o
ingresso diretto), senza costringere a rifare il login. **Scelta di progetto.**

### 5.2 Rischi

- [ ] ID=MT4-RISK-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Auth.js su più indirizzi, Fix description=Con `AUTH_URL` fisso Auth.js riporta le pagine di accesso all'indirizzo configurato; servono `trustHost` e una verifica che accesso, uscita e ritorno restino sull'indirizzo della richiesta (credenziali e prova; Google solo sull'indirizzo principale).
- [ ] ID=MT4-RISK-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Indirizzo della richiesta nel proxy e nel callback, Fix description=Il callback `jwt` gira sia nel proxy sia nelle pagine e nelle rotte: l'indirizzo della richiesta deve essere disponibile e uguale in tutti questi punti. Va provato presto nel piano.
- [ ] ID=MT4-RISK-3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Viaggi in più per richiesta, Fix description=La rivalidazione del tenant non deve aggiungere viaggi; se servono, vanno motivati e misurati.
- [ ] ID=MT4-RISK-4, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Inventario degli ingressi che invecchia, Fix description=Il test fra tenant deve fallire se compare un ingresso nuovo senza caso di prova, altrimenti DEF-4.4 vale solo il giorno in cui è scritto.

### 5.3 Limiti noti

- Su `a.localhost` e `b.localhost` non si entra con Google fino al pezzo 6.
- Il modello si modifica solo via SQL fino al pezzo 5.
- La cache delle pagine si svuota per tutti a ogni modifica (DEF-4.5).
