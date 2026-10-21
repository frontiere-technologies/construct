# Specifica — Multi-tenancy, pezzo 2: tenant e appartenenze (2026-10-20)

Secondo dei sei pezzi della multi-tenancy. Si appoggia su:

- la [specifica del pezzo 1](2026-10-13-multi-tenancy-foundations-design.md): `id_tenant`, RLS
  restrittiva e forzata, `withTenant`/`withGlobal`, ruoli di sistema per chiave (`system_key`);
- il [documento delle cose rimandate](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md),
  voci DEF-2.1, DEF-2.2, DEF-2.3, DEF-2.6;
- i [requisiti TO-BE](../../input-specs/multi-tenancy/multi-tenancy-requirements.md): MT-02, MT-08,
  MT-DB-10.

Le decisioni sono state prese con il proprietario del progetto il 2026-10-20. Le scelte lasciate a
chi scrive la specifica sono segnate "**scelta di progetto**".

## Sommario

**Perché.** Construct è un modello di partenza. Il caso reale che ha mosso il lavoro: installazioni
con più tenant, che possono essere **dipartimenti della stessa azienda**, con persone in comune,
oppure **organizzazioni del tutto separate**. Dopo il pezzo 1 lo schema regge più tenant, ma una
persona non "appartiene" a un tenant: ha solo dei ruoli in esso, e la disattivazione vale per tutta
l'installazione. Non esiste nemmeno un modo per creare un secondo tenant.

**Dopo questo pezzo:**

- una persona appartiene a uno o più tenant, con uno stato per ciascuno (*attiva* o *disattivata*);
- l'amministratore di un tenant vede solo le persone del suo tenant, ne aggiunge una per **email
  esatta** e la disattiva **solo nel suo tenant**;
- l'amministratore della piattaforma crea un tenant con un comando, copiandolo da un **tenant
  modello**, e ne registra il primo amministratore.

**Per chi usa l'app oggi non cambia niente di visibile**, tranne che "Disattiva" nella pagina
Utenti spegne l'appartenenza al tenant invece dell'account. Con un solo tenant visibile il risultato
pratico è lo stesso.

## Decisioni

- [✅] ID=MT2-DEC-1, Title=Appartenenza esplicita, Requirement=Tabella `tenant_membership (id_tenant, user_id, status)` con stato `active` o `deactivated`. Una persona senza appartenenza attiva in un tenant non vi ha accesso. I ruoli in un tenant (`user_role`) esistono solo se esiste l'appartenenza.
- [✅] ID=MT2-DEC-2, Title=Solo due stati in questo pezzo, Requirement=`active` e `deactivated`. Gli stati `invited` e `pending` (MT-02) arrivano con il pezzo 3, quando servono gli inviti per tenant. **Scelta di progetto.**
- [✅] ID=MT2-DEC-3, Title=Disattivazione per tenant, Requirement=La disattivazione della pagina Utenti agisce sull'appartenenza al tenant corrente. La disattivazione globale dell'account (`users.id_user_status`) resta, riservata alla piattaforma; nessuna pagina dell'app la espone più.
- [✅] ID=MT2-DEC-4, Title=Ultimo amministratore per tenant, Requirement=La regola "non si può disattivare né togliere il ruolo all'ultimo amministratore attivo" si verifica sulle appartenenze attive del tenant, con account globalmente attivo. Risolve il limite noto di `set_user_status_guarded` (specifica del pezzo 1, §2.6).
- [✅] ID=MT2-DEC-5, Title=Tenant separati anche per le persone, Requirement=L'amministratore di un tenant vede solo i membri del suo tenant. Aggiunge una persona solo scrivendone l'email esatta; non può sfogliare né cercare le persone degli altri tenant.
- [✅] ID=MT2-DEC-6, Title=Risposta neutra all'aggiunta, Requirement=Aggiungendo per email, la risposta è la stessa sia che la persona esista sia che no ("persona aggiunta o invitata"), così che non si possa scoprire chi è registrato negli altri tenant. Se la persona non esiste, si usa l'invito di oggi (`prepareInvitation`: crea l'account senza password e manda il link per impostarla). **Scelta di progetto.**
- [✅] ID=MT2-DEC-7, Title=Tenant modello, Requirement=Un tenant segnato come modello contiene la base che ogni nuovo tenant riceve: menu, ruoli, concessioni, tema. La piattaforma lo può modificare. Non ha persone proprie e nessuna richiesta degli utenti lo raggiunge.
- [✅] ID=MT2-DEC-8, Title=Creazione per copia, Requirement=Creare un tenant copia dal modello voci di menu (con le etichette), ruoli (di sistema e non), concessioni di permessi e funzionalità, tema. Non copia persone né appartenenze. La copia è un'istantanea: cambiare il modello dopo non tocca i tenant già creati.
- [✅] ID=MT2-DEC-9, Title=Creazione da comando, Requirement=In questo pezzo la piattaforma crea un tenant con un comando di `db.mjs` (`tenant-create`), non da una pagina. La console di piattaforma (pezzo 5) userà la stessa funzione. **Scelta di progetto.**
- [✅] ID=MT2-DEC-10, Title=Primo amministratore registrato dalla piattaforma, Requirement=Il comando riceve l'email del primo amministratore: se la persona esiste la collega, altrimenti crea l'account. In entrambi i casi le dà l'appartenenza attiva e i ruoli `REGISTERED` e `TENANT_ADMIN` del nuovo tenant. In futuro (pezzo 3) potrà essere invitato via email.
- [✅] ID=MT2-DEC-11, Title=Lingue e traduzioni uguali per tutti, Requirement=Restano globali come nel pezzo 1. La configurazione per tenant di lingue, logo, aspetto e pagina d'ingresso arriverà più avanti (pezzo 6 per domini, logo e pagina d'ingresso).
- [✅] ID=MT2-DEC-12, Title=Ingresso nel tenant predefinito come oggi, Requirement=Finché esiste un solo tenant visibile (fino al pezzo 4), chi si registra o entra con Google diventa membro attivo del **tenant predefinito**, come oggi riceve il ruolo base. Per gli altri tenant serve un'appartenenza creata esplicitamente. L'ingresso automatico nel predefinito vale **solo per chi non è membro di nessun altro tenant**, così le persone di organizzazioni separate non finiscono nel predefinito. Deciso con il proprietario il 2026-10-20.

## 1. Perimetro

### 1.1 Dentro

1. Tabella `tenant_membership`, con le appartenenze di oggi riportate dalla migrazione.
2. Chiave esterna da `user_role` all'appartenenza.
3. Autorizzazione che tiene conto dell'appartenenza (callback `jwt`, `resolveActor`).
4. Disattivazione e riattivazione per tenant, con la regola dell'ultimo amministratore per tenant.
5. Pagina Utenti con i soli membri del tenant e lo stato dell'appartenenza.
6. Aggiunta di una persona per email esatta, con risposta neutra.
7. Tenant modello, creato dalla migrazione.
8. Comando `db.mjs tenant-create` che copia dal modello e registra il primo amministratore.
9. Test: isolamento delle appartenenze, regola dell'ultimo amministratore per tenant, copia dal
   modello, risposta neutra, ingresso nel tenant predefinito.

### 1.2 Fuori

- Stati `invited` e `pending`, inviti per tenant con risposta curata, domini verificati e ingresso
  autonomo per dominio aziendale: pezzo 3.
- Scelta del tenant corrente, cambio di tenant, tenant dall'host: pezzo 4. Fino ad allora il
  modello non si modifica dall'interfaccia (vedi §5.3).
- Console di piattaforma, amministratore di piattaforma come attributo dell'identità, audit,
  disattivazione globale da interfaccia, eliminazione del ruolo 2 "Tenant Super Administrator"
  (DEF-2.7): pezzo 5.
- Lingue e traduzioni per tenant (DEF-2.4), libreria di temi (DEF-2.5): rimandate.
- Domini dedicati, logo e pagina d'ingresso per tenant: pezzo 6.
- Togliere del tutto una persona da un tenant: non richiesto; basta disattivarla. **Scelta di
  progetto.**

### 1.3 Criteri di successo

- [ ] ID=MT2-OK-1, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Nessun cambiamento visibile, Fix description=L'E2E e i test di integrazione passano; dove un test verificava la disattivazione globale, ora verifica quella dell'appartenenza con lo stesso comportamento visibile.
- [ ] ID=MT2-OK-2, Severity=Critical, Complexity=Low, Priority=P0, Estimate=hours, Title=Accesso solo con appartenenza attiva, Fix description=Una persona con appartenenza disattivata, o senza appartenenza, in un tenant non vi ha attore né ruoli; nello stesso momento, nei tenant dove è attiva, funziona normalmente.
- [ ] ID=MT2-OK-3, Severity=Critical, Complexity=Low, Priority=P0, Estimate=hours, Title=Tenant separati, Fix description=L'amministratore di A non vede, non aggiunge per ricerca e non disattiva persone di B; la risposta all'aggiunta per email è identica per email esistenti e non.
- [✅] ID=MT2-OK-4, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Tenant creato dal modello, Fix description=`db.mjs tenant-create` produce un tenant con menu, ruoli, concessioni e tema uguali al modello (con id nuovi e riferimenti interni coerenti), il primo amministratore attivo, e nessuna riga condivisa con il modello o con altri tenant. Il primo amministratore risulta amministratore **dentro il nuovo tenant** (attore risolto con `withTenant` sul nuovo tenant); entrarci dal browser arriva con il pezzo 4 (§5.3).

## 2. Database

### 2.1 Tabella `tenant_membership`

Tabella di tenant, protetta con `app_private.protect_tenant_table` (pezzo 1, §2.2):

| Colonna | Tipo | Note |
|---|---|---|
| `id_tenant` | `bigint not null` | dal contesto, chiave esterna verso `tenant(id)` |
| `user_id` | `uuid not null` | chiave esterna verso `users(id)` on delete cascade |
| `status` | `text not null` | `check (status in ('active', 'deactivated'))`, predefinito `active` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | `updated_at` con il trigger `set_updated_at` già esistente |

- Chiave primaria `(id_tenant, user_id)`.
- Indice `(user_id)` per la cascata dalla cancellazione di un utente e per le letture "di quali
  tenant è membro", che serviranno nel pezzo 4. **Scelta di progetto.**
- `user_role`: chiave esterna `(id_tenant, user_id)` → `tenant_membership` on delete cascade. Se
  una persona non è membro, non può avere ruoli nel tenant.

### 2.2 Migrazione dei dati di oggi

Ogni utente esistente riceve un'appartenenza `active` al tenant predefinito, anche se non ha
ancora ruoli (per esempio chi si è registrato e non ha ancora impostato la password): così la
pagina Utenti continua a mostrare le stesse persone di oggi. **Scelta di progetto.** Oggi esiste
un solo tenant, quindi non ci sono appartenenze da creare altrove. Lo stato globale dell'utente
(`users.id_user_status`) resta com'è e continua a contare (§3.1).

### 2.3 Tenant modello

- Colonna `tenant.is_template boolean not null default false`, con un indice unico parziale
  `where is_template` (al massimo un modello).
- La migrazione crea il modello (slug `template`, nome "Modello") copiando dal **tenant
  predefinito, così com'è al momento della migrazione**: voci di menu con etichette, ruoli con
  `system_key` e le loro concessioni, tema. **Scelta di progetto:** su una nuova installazione il
  predefinito contiene solo la base dei semi delle migrazioni; su un database di sviluppo il
  modello eredita anche le voci aggiunte a mano, che si possono togliere via SQL.
- Il modello non ha appartenenze. `resolveRequestTenant()` non lo restituisce mai (oggi restituisce
  solo il predefinito); il pezzo 4 dovrà impedire di sceglierlo, salvo alla piattaforma.

### 2.4 Funzione di copia

Una funzione nello schema `app_private` (es. `app_private.create_tenant_from_template(p_slug text,
p_name text) returns bigint`), eseguita come `construct_owner`, in una transazione:

1. crea la riga di `tenant`;
2. legge dal modello voci di menu, etichette, ruoli, concessioni di permessi e di funzionalità,
   tema;
3. li inserisce nel nuovo tenant con **id nuovi** (le sequenze `s_id_*` sono globali), rimappando i
   riferimenti interni: genitore di ogni voce, ruolo e voce di ogni concessione, voce di ogni
   etichetta;
4. restituisce l'id del nuovo tenant.

Vincolo da rispettare: la RLS è forzata anche per `construct_owner`, che vede solo il tenant di
`app.tenant_id`. La funzione deve quindi leggere il modello con il tenant del modello impostato e
scrivere con quello nuovo, per esempio passando per una tabella temporanea o variabili, cambiando
`set_config('app.tenant_id', …, true)` fra le due fasi. Il come è lasciato al piano.

### 2.5 Regola dell'ultimo amministratore

`replace_user_roles_guarded` e la funzione che sostituisce `set_user_status_guarded` (es.
`set_membership_status_guarded(p_user_id uuid, p_status text)`):

- lavorano sul tenant corrente, con lo stesso lock per tenant del pezzo 1
  (`pg_advisory_xact_lock(49374202, id_tenant::integer)`);
- contano come amministratori attivi le persone con appartenenza `active`, account globalmente
  attivo e ruolo `TENANT_ADMIN` del tenant;
- `replace_user_roles_guarded` rifiuta di assegnare ruoli a chi non è membro del tenant
  (`not_a_member`);
- gli errori restano quelli di oggi (`last_active_administrator`, `user_not_found`, …), più
  `not_a_member`.

`set_user_status_guarded` (stato globale) non è più chiamata dall'app; resta per la piattaforma.

## 3. Applicazione

### 3.1 Autorizzazione

- L'istruzione unica dell'autorizzazione (`selectAuthorizationSnapshot`, lavoro sulle prestazioni)
  legge anche lo stato dell'appartenenza nel tenant della transazione. `accountActive` diventa:
  account globalmente attivo **e** appartenenza `active`. Il numero di viaggi verso il database non
  cambia (tetti del test `round-trip-budget`).
- **Registrazione e primo accesso** nel tenant predefinito: la registrazione autonoma
  (`app/api/auth/register`) crea subito l'appartenenza `active` al predefinito, così chi è in attesa
  di impostare la password resta visibile nella pagina Utenti; al primo accesso (callback `jwt` con
  `ensureRegisteredRole`), se manca l'appartenenza la si crea, poi il ruolo base come oggi
  (MT2-DEC-12). Un'appartenenza `deactivated` non viene mai riattivata da questi percorsi. Negli
  altri tenant non si crea niente. **Scelta di progetto.**
- **Respinto all'accesso, come oggi.** Chi ha l'appartenenza `deactivated` nel tenant della
  richiesta viene respinto già all'accesso con lo stesso messaggio di un account disattivato: le
  credenziali (`authorize`) e l'accesso con Google (callback `signIn`) controllano anche
  l'appartenenza, oltre allo stato globale. Il controllo costa una lettura in più solo al momento
  dell'accesso, non a ogni richiesta. **Scelta di progetto.**

### 3.2 Pagina Utenti

- L'elenco (`listUsers`, `countUsers`, griglia) parte da `tenant_membership` del tenant corrente.
- La colonna e il filtro "Stato" mostrano lo stato dell'appartenenza; "Disattiva"/"Riattiva" usano
  la nuova funzione per tenant. Messaggi e permessi (`set-user-status`) restano quelli di oggi.
- Nuova azione "Aggiungi persona" con il campo email, protetta dal permesso esistente
  `invite-users`:
  - email esistente: crea l'appartenenza `active` (se già membro, nessun cambiamento) e il ruolo
    `REGISTERED`;
  - email non esistente: `prepareInvitation` (crea account e link), poi appartenenza e ruolo base,
    e invio dell'email come fa oggi "Invia invito";
  - risposta identica nei due casi (MT2-DEC-6).

### 3.3 Comando `db.mjs tenant-create`

`node sources/devops/db/db.mjs tenant-create --slug <slug> --name <nome> --admin <email>`:

- usa l'identità delle migrazioni e lavora come `construct_owner`, in una transazione;
- chiama la funzione di copia (§2.4), poi registra il primo amministratore (MT2-DEC-10): crea
  l'account se manca, l'appartenenza `active` e i ruoli `REGISTERED` e `TENANT_ADMIN` del nuovo
  tenant;
- se l'account è nuovo (senza password), stampa il link per impostare la password, valido 48 ore
  come quelli dell'invito di oggi. **Scelta di progetto:** l'invio per email dal comando arriverà
  con la console (pezzo 5);
- `--slug` rispetta il controllo di `tenant.slug` (`^[a-z0-9-]{3,40}$`) ed è unico; un errore lascia
  il database com'era;
- variante di prova `test-tenant-create` sul database usa e getta, con la stessa regola di
  sicurezza degli altri comandi `test-*`.

## 4. Test

- **Isolamento delle appartenenze:** `tenant_membership` è nel registro come tabella di tenant e
  passa il contratto di schema e `boundary-check`; con il contesto di A le appartenenze di B sono
  invisibili e non modificabili.
- **Accesso:** una persona attiva in A e disattivata in B ha attore in A e nessun attore in B;
  senza appartenenza in B, nessun attore in B.
- **Ultimo amministratore per tenant:** in A non si può disattivare l'ultimo amministratore attivo
  anche se B ne ha; disattivare in A non tocca B.
- **Ruoli solo ai membri:** `replace_user_roles_guarded` rifiuta un non membro con `not_a_member`.
- **Aggiunta per email:** stessa risposta per email esistente e non; l'appartenenza e il ruolo base
  esistono dopo; nessuna informazione su altri tenant nella risposta.
- **Copia dal modello:** il nuovo tenant ha lo stesso numero di voci, etichette, ruoli e
  concessioni del modello; ogni riferimento interno punta a righe del nuovo tenant; il modello e il
  predefinito restano invariati; il primo amministratore ha i due ruoli di sistema e, risolto dentro
  il nuovo tenant, è un attore amministratore.
- **Ingresso nel tenant predefinito:** il primo accesso crea appartenenza e ruolo base nel
  predefinito e in nessun altro tenant; per chi è già membro di un altro tenant (per esempio il
  primo amministratore di un tenant nuovo) non crea niente nel predefinito.
- **Invariato:** E2E completo, test di integrazione esistenti, tetti dei viaggi.

## 5. Rilascio e rischi

### 5.1 Rilascio

Una migrazione nuova (dalla 0048) e il codice che la usa. Non esiste una produzione in uso: sul
database di sviluppo la migrazione si applica con conferma del proprietario, subito prima o dopo il
merge, come per il pezzo 1.

### 5.2 Rischi

- [✅] ID=MT2-RISK-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Copia dal modello sotto RLS forzata, Fix description=La funzione di copia deve leggere un tenant e scriverne un altro con la RLS forzata anche per il proprietario. Va coperta da un test che confronta modello e copia riga per riga, e da uno che verifica che nessuna riga del modello sia cambiata.
- [ ] ID=MT2-RISK-2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Utenti oggi senza ruoli, Fix description=Anche chi esiste senza ruoli riceve l'appartenenza dalla migrazione (§2.2), così la pagina Utenti resta uguale. Verificare sul database di sviluppo, prima e dopo la migrazione, che il numero di utenti e quello delle appartenenze al predefinito coincidano.
- [✅] ID=MT2-RISK-3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Viaggi in più per l'appartenenza, Fix description=Lo stato dell'appartenenza entra nell'istruzione unica dell'autorizzazione; i tetti del test dei viaggi non devono salire.

### 5.3 Limiti noti

- **I tenant creati nel pezzo 2 si usano dal pezzo 4.** Fino ad allora ogni richiesta è servita dal
  tenant predefinito (`resolveRequestTenant()`): il primo amministratore di un tenant nuovo può
  impostare la password, ma non ha ancora un modo per entrare nel suo tenant dal browser. Il tenant
  si può già creare e preparare (via SQL o con le funzioni del pezzo). Deciso con il proprietario il
  2026-10-20.
- **Il modello si modifica solo via SQL** fino al pezzo 4, che dovrà permettere alla piattaforma, e
  solo a lei, di sceglierlo come tenant corrente.
