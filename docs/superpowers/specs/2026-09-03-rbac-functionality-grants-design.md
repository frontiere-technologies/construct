# Specifica — La voce di menu è il permesso: via la sincronizzazione fra `permission` e `menu_entry` (2026-09-03)

Nasce dai bug segnalati dal proprietario del progetto sulla pagina Ruoli & Permessi — più uno
trovato durante l'analisi e uno ancora da confermare — e da una richiesta sul modello dei dati: **nel
database non si vuole la sincronizzazione fra la tabella delle funzionalità e quella dei
permessi.**

Continua il [design del modello dei permessi del 2026-09-01](2026-09-01-rbac-permission-model-design.md)
e ne **supera due decisioni** (DEC-1 e DEC-14, vedi §7). La numerazione delle decisioni riprende da
DEC-17 per non collidere con quel documento, che le cita per numero.

## Sommario

Oggi `permission` contiene due cose mescolate: i permessi dichiarati dal codice (le 8 righe sotto
`operations`) e **un doppione di ogni voce di menu**, tenuto allineato a mano da tre azioni server.
Quell'allineamento è la causa di BUG-1 e BUG-4: i due alberi divergono perché uno dei due non viene
mai aggiornato. BUG-2 e BUG-3 vengono dall'altra metà della stessa idea — una cartella
rappresentata come riga che nessuno concede mai.

Dopo questo lavoro `permission` tiene **solo** i permessi del codice, e una funzionalità di menu **è**
il proprio permesso: la concessione punta direttamente alla voce, tramite una nuova tabella
`role_functionality`. `menu_entry.id_permission` sparisce, e con lei l'inserimento, la copia e la
cancellazione del permesso gemello.

Misure prese sul database di sviluppo il 2026-09-03:

| Cosa | Quantità |
|---|---|
| Righe in `permission` | 25 |
| di cui permessi veri del codice (`operations` + foglie) | 9 |
| di cui doppioni di contenitori di menu (`Home`, `Admin`, `Link utili`, `Test2`) | 4 |
| di cui orfane, non più cancellabili da nessun percorso (`E2E Outer/Parent/Inner`) | 3 |
| di cui doppioni di funzionalità di menu | 8 (+ `root`) |
| Concessioni in `role_permission` | 22: 8 su permessi del codice, 14 da travasare |
| Voci di menu | 13, di cui 5 contenitori e 8 funzionalità |
| Voci pubbliche (`id_permission` nullo su una funzionalità) | 0 |

## 1. I bug, e la loro causa comune

Le sezioni «Funzionalità» e «Ruoli → modifica» disegnano **due alberi diversi**, costruiti da due
tabelle con due colonne `id_parent` indipendenti. Il primo è la verità corrente del menu; il secondo
è una fotografia scattata dalla migrazione `0017` che nessuna scrittura successiva aggiorna.

- [ ] ID=BUG-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=L'albero dei Ruoli non è l'albero delle Funzionalità, Fix description=Quattro sintomi, una causa. (a) `Le scienze` è stata spostata sotto `Test2` nel menu ma il suo permesso è rimasto sotto `Link utili`: `reparent` in navigation-actions.ts opera «sul menu SOLTANTO», per costruzione. (b) `AAA` non compare affatto: è un contenitore, e un contenitore non genera un permesso (DEC-2). (c) `Home`, `Admin`, `Link utili`, `Test2` compaiono due volte nel modello — una riga `permission` di tipo CATEGORY *e* un contenitore `menu_entry` — senza alcun collegamento fra le due. (d) `E2E Outer/Parent/Inner` compaiono in Ruoli e non esistono più nel menu. Si chiude facendo leggere alla pagina Ruoli l'albero del menu, che è l'unico posto dove quella gerarchia è vera.
- [ ] ID=BUG-2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=L'interruttore di una cartella non cambia mai aspetto, Fix description=`buildAuthTree` assegna `authorization: false` a ogni riga di tipo CATEGORY per costruzione (permission-tree.ts:49), e `applyToggle` non scrive mai il valore della categoria stessa. L'interruttore di una cartella è quindi permanentemente spento, qualunque cosa ci sia sotto. Si chiude calcolando lo stato della cartella come riassunto delle proprie foglie al momento del disegno (DEC-20).
- [ ] ID=BUG-3, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Il clic su una cartella accende e non spegne mai, Fix description=Conseguenza diretta di BUG-2, ma con effetto sui dati e non solo sull'aspetto: `PermissionsTree.tsx` calcola il nuovo stato come `!(map.get(node.id) ?? false)`, e su una cartella sempre spenta quell'espressione vale sempre `true`. Non esiste alcun gesto che revochi un sottoalbero. Si chiude con lo stesso lavoro di BUG-2: se la cartella conosce il proprio stato, il clic sa in che verso andare.
- [ ] ID=BUG-4, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Cancellare un contenitore lascia dietro di sé una categoria-permesso irraggiungibile, Fix description=`deleteNavigationItem` raccoglie e cancella i permessi delle voci con `id_permission` valorizzato — cioè le sole funzionalità. La riga `permission` di tipo CATEGORY nata dalla `0017` non è puntata da nessuna voce, quindi nessun percorso di cancellazione la cita mai: resta per sempre. Sono le tre righe `E2E` sul database di sviluppo. Si chiude togliendo del tutto le righe-categoria da `permission` (§3) — il caso diventa impossibile invece che gestito.
- [✅] ID=BUG-5, Severity=Medium, Complexity=Low, Priority=P0, Estimate=minutes, Title=Da confermare in browser, se la revoca di una singola foglia funzioni, Fix description=verificato in browser il 2026-09-03: la revoca di una singola foglia funziona; il difetto è circoscritto alle cartelle.

## 2. Decisioni

- [x] ✅ ID=DEC-17, Title=Due tabelle di concessione, una per genere di permesso — `role_permission(id_role, id_permission)` resta e ospita **solo** i permessi del codice; nasce `role_functionality(id_role, id_menu_entry)` per le voci di menu. Scartate: un'unica tabella con due colonne annullabili e un vincolo «esattamente una» (metà delle righe avrebbe sempre una colonna vuota, e il vincolo va difeso a mano), e la rifusione di `menu_entry` e `permission` in una tabella sola (riporterebbe l'espediente che la `0017` ha appena tolto: righe che esistono solo per non essere disegnate). Con due tabelle le chiavi esterne sono vere in entrambi i versi e cancellare una voce porta via le sue concessioni per cascata, senza codice che ci pensi.
- [x] ✅ ID=DEC-18, Title=Nessuna voce pubblica — `menu_entry.id_permission` sparisce, e con lei l'unico modo di dire «questa voce la vedono tutti gli autenticati». Una funzionalità si vede solo se un ruolo dell'utente la ha concessa; un contenitore si vede se contiene qualcosa di visibile. Nessuna riga di oggi usa quella capacità (0 voci pubbliche sui dati reali), e la regola diventa una sola frase invece di due. Se domani serve una voce per tutti, si concede al ruolo base. Scartata: una colonna `menu_entry.is_public` — una colonna che nessuna riga usa, più un caso in più da coprire nei test.
- [x] ✅ ID=DEC-19, Title=La pagina Ruoli mostra due alberi affiancati, non uno — «Funzionalità» (l'albero del menu) e «Operazioni» (l'albero di `permission`). Non è una scelta estetica: `id_menu_entry` e `id_permission` sono due sequenze indipendenti con valori sovrapposti — `s_id_permission` è a `976` e `s_id_menu_entry` a `961`, e avanzano ciascuna per conto proprio, quindi il prossimo permesso del catalogo e la prossima voce di menu possono portare lo stesso numero. Oggi la sovrapposizione è perfino totale, perché la `0017` ha seminato gli identificativi delle voci da quelli dei permessi. Fondendoli in un albero solo servirebbero chiavi composite (`"menu:3"`), cioè `UserNavigationTreeDto.id` da numero a stringa, cioè un ritocco a `NavigationTree`, al drag & drop e alla pagina Funzionalità: molto lavoro per peggiorare i tipi. Conseguenza voluta: il nodo radice `All` (permesso `0`) **sparisce**, e con lui il gesto «accendi tutto in un clic», che nessuno aveva chiesto di conservare.
- [x] ✅ ID=DEC-20, Title=Una cartella è un riassunto, mai una riga — lo stato di un contenitore si calcola al momento del disegno dalle foglie del suo sottoalbero, su tre valori: spento (nessuna foglia concessa), parziale (alcune), acceso (tutte). Il clic accende tutte le foglie quando non sono già tutte accese, e le spegne tutte quando lo sono. Nessuna cartella riceve mai una riga in una tabella di concessione — è l'invariante che la `0020` ha ripulito e che `updateRolePermissions` già difende sul server; qui diventa anche impossibile da rappresentare male sul client, perché lo stato della cartella non è più un valore da tenere allineato ma una funzione dei figli. Scartato: due stati soli, dove «spento» direbbe due cose diverse (niente concesso / qualcosa ma non tutto) senza che si distinguano.
- [x] ✅ ID=DEC-21, Title=I codici dei permessi del codice restano al loro posto, per ora — `USER_CREATE`…`PERMISSION_DELETE` conservano `origin = 'CONSOLE'` e `code` nullo, come oggi. Dare loro un `code` è il lavoro del catalogo (Fase 2), e DEC-3 stabilisce che un codice non cambia mai: inventarlo adesso vincolerebbe quella scelta senza averla presa. Conseguenza da sapere: `permission.origin` resta una colonna con un solo valore in uso, e il vincolo `check ((origin = 'SOURCE' and kind = 'GRANT') = (code is not null))` resta intatto e soddisfatto.
- [x] ✅ ID=DEC-22, Title=Il divieto di convertire categoria ↔ funzionalità resta, con un motivo diverso — DEC-16 lo giustificava così: una categoria convertita in funzionalità resterebbe con `id_permission` nullo, cioè una voce pubblica e ingovernabile. Quel motivo **evapora** con DEC-18, perché quella colonna non esiste più. Il divieto però si tiene, con la giustificazione che sopravvive: convertire una funzionalità in categoria butterebbe via le sue concessioni in silenzio. Da rivedere in Fase 3, insieme all'editor dei permessi, non qui.

## 3. Modello dati

### 3.1 Cosa contiene ciascuna tabella, dopo

| Tabella | Contenuto | Chi la concede |
|---|---|---|
| `permission` | **solo** i permessi dichiarati dal codice: `operations` (CATEGORY) e le sue foglie GRANT | `role_permission(id_role, id_permission)`, invariata |
| `menu_entry` | il menu; ogni funzionalità **è** il proprio permesso | `role_functionality(id_role, id_menu_entry)`, nuova |

```sql
create table public.role_functionality (
  id_role       bigint not null references public.role(id_role)            on delete cascade,
  id_menu_entry bigint not null references public.menu_entry(id_menu_entry) on delete cascade,
  primary key (id_role, id_menu_entry)
);
```

Presenza della riga = concessione, come `role_permission` dalla `0021` (DEC-7): nessuna colonna
`authorized`, revocare cancella la riga.

Le due chiavi esterne sono entrambe `on delete cascade`, e non per simmetria: è ciò che sostituisce
il blocco di pulizia manuale in `deleteNavigationItem`. Cancellare una voce, o un ruolo, porta via le
sue concessioni senza che nessun percorso applicativo debba ricordarsene — la classe di dimenticanza
che ha prodotto BUG-4.

Privilegi e RLS seguono la forma della `0017` (`menu_entry`), non le privilegi di default della
`0002`, che si applicano solo alle tabelle create dallo stesso ruolo che le ha dichiarate:

```sql
alter table public.role_functionality enable row level security;
grant select, insert, update, delete on table public.role_functionality to construct_runtime;
create policy construct_runtime_server_access on public.role_functionality
  for all to construct_runtime using (true) with check (true);
```

### 3.2 Colonne e righe che spariscono

| Cosa | Perché | Sostituita da |
|---|---|---|
| `menu_entry.id_permission` + indice `menu_entry_permission_idx` | la voce non punta più a un permesso: è lei il permesso | `role_functionality.id_menu_entry` |
| le 4 righe `permission` di tipo CATEGORY che duplicano un contenitore | doppioni senza collegamento (BUG-1c) | il contenitore `menu_entry` |
| le 3 righe `permission` orfane `E2E …` | irraggiungibili da qualunque percorso (BUG-4) | — |
| le 8 righe `permission` gemelle di una funzionalità | l'oggetto della concessione è la voce | la voce stessa |
| la riga `permission` `root` (id `0`) | era la radice sentinella dell'albero unico | niente: le radici sono le righe con `id_parent` nullo |

`operations` (id `-1`) **resta**: è la radice dell'albero dei permessi del codice, e il catalogo della
Fase 2 vi appenderà le proprie categorie.

## 4. La migrazione dei dati (`0024`)

L'ordine conta, e il punto fermo è che **nessuna concessione viva si perde**: le 14 righe di
`role_permission` che oggi concedono voci di menu si travasano *prima* che la colonna che le mappa
sparisca.

- [ ] ID=MIG-1, Severity=n/a, Complexity=Low, Priority=P0, Estimate=minutes, Title=Crea `role_functionality`, Fix description=Tabella, RLS, privilegi e policy come in §3.1.
- [ ] ID=MIG-2, Severity=n/a, Complexity=Low, Priority=P0, Estimate=minutes, Title=Travasa le concessioni sulle voci di menu, Fix description=`insert into role_functionality select rp.id_role, m.id_menu_entry from role_permission rp join menu_entry m on m.id_permission = rp.id_permission`. Il join è la mappa, ed è disponibile solo finché la colonna esiste: da qui l'ordine.
- [ ] ID=MIG-3, Severity=n/a, Complexity=Low, Priority=P0, Estimate=minutes, Title=Ripulisci `role_permission` delle righe travasate, Fix description=`delete from role_permission where id_permission in (select id_permission from menu_entry where id_permission is not null)`. Restano le 8 concessioni sui permessi del codice.
- [ ] ID=MIG-4, Severity=n/a, Complexity=Low, Priority=P0, Estimate=minutes, Title=Togli `menu_entry.id_permission`, Fix description=La colonna e il suo indice. Va dopo MIG-2 e MIG-3, che la leggono; va prima di MIG-5, perché la sua chiave esterna è `on delete restrict` e bloccherebbe la cancellazione dei permessi gemelli.
- [ ] ID=MIG-5, Severity=n/a, Complexity=Low, Priority=P0, Estimate=minutes, Title=Riduci `permission` ai soli permessi del codice, Fix description=Cancella ogni riga che non sia `operations` né un suo discendente. Il criterio è **strutturale** (risalita di `id_parent` fino alla radice, come fa `buildAuthTree`), non un elenco di identificativi noti: un elenco scritto a mano sarebbe giusto solo sul database di sviluppo. `role_permission.id_permission` è `on delete cascade`, quindi le eventuali concessioni residue su quelle righe se ne vanno con loro — e dopo MIG-3 non ce ne sono.
- [ ] ID=MIG-6, Severity=n/a, Complexity=Low, Priority=P0, Estimate=minutes, Title=`apply_role_functionality_deltas`, Fix description=Gemella di `apply_role_permission_deltas` su `role_functionality`, nella forma **reale** di quella funzione oggi (`security invoker`, `set search_path = ''`, insert con `on conflict do nothing`, e la timbratura di `role.date_mod`). Nota della `0021` da rispettare: due implementatori di questa fase hanno riscritto funzioni sulla forma *ipotizzata* dal proprio brief invece che su quella vera, e una volta è diventato un difetto Critical. Essendo una funzione nuova serve un `grant execute … to construct_runtime` esplicito.
- [ ] ID=MIG-7, Severity=n/a, Complexity=Low, Priority=P1, Estimate=minutes, Title=`role_list_view.has_permissions` guarda entrambe le tabelle, Fix description=`exists(role_permission) or exists(role_functionality)`. Senza questo, un ruolo che concede solo voci di menu risulterebbe «senza permessi» nella griglia e nel filtro omonimo — cioè tutti i ruoli reali di oggi tranne l'Amministratore.

Poi `node sources/devops/db/db.mjs schema-write` per rigenerare `schema.sql`, e `schema-check` in CI.

### 4.1 Prima di applicare a un database diverso da quello di sviluppo

MIG-2 travasa quello che trova. Su un database dove esistono **voci pubbliche** (una funzionalità con
`id_permission` nullo) DEC-18 le rende invisibili invece che visibili a tutti: è un restringimento
silenzioso dei permessi, non un allargamento, ma va saputo prima. Verifica in sola lettura:

```sql
select id_menu_entry, name
from public.menu_entry
where id_functionality_type is not null and id_permission is null;
```

Nessuna riga → si applica. Qualche riga → quelle voci vanno concesse esplicitamente ai ruoli che
devono continuare a vederle, **nella stessa migrazione**, prima di MIG-4.

## 5. Interfaccia e codice

### 5.1 La pagina Ruoli

```
Funzionalità                         ← l'albero di /functionalities, letto da menu_entry
  Home                    [ ●─ ]       contenitore: spento / parziale / acceso
    Test2                 [ ●─ ]
      Le scienze          [ ─● ]       ← nel posto giusto (BUG-1a)
      AAA                 [ ●─ ]       ← presente (BUG-1b)
  Admin                   [ ●─ ]
    Users … Translations
  Link utili              [ ●─ ]
    Repubblica

Operazioni                           ← l'albero di permission
  USER_CREATE … PERMISSION_DELETE
```

Il primo albero **è** la lettura del menu: non può divergere, perché non esiste una seconda copia da
tenere allineata. I doppioni e le orfane non compaiono perché non esistono più.

### 5.2 I file

| File | Cosa cambia |
|---|---|
| `lib/rbac/permission-tree.ts` | `buildAuthTree` costruisce dalle voci di menu; nasce lo stato a tre valori (DEC-20); `applyToggle` propaga in giù nel sottoalbero e non tocca le cartelle; `computeDeltas` invariata, applicata due volte |
| `lib/rbac/roles-service.ts` | `getRoleAuthorizationTree` legge `menu_entry` + `role_functionality` e `permission` + `role_permission`, e torna i due alberi |
| `lib/rbac/roles-actions.ts` | `updateRolePermissions` accetta le due liste di delta, chiama le due funzioni, e rifiuta un delta su una cartella in entrambi i versi (`kind = 'CATEGORY'` per i permessi, `id_functionality_type is null` per le voci) — la guardia severa di oggi, resa simmetrica |
| `lib/rbac/sidebar-adapter.ts` | `isEntryVisible` cerca `id_menu_entry` fra le concessioni; via il ramo «`id_permission` nullo = voce pubblica» (DEC-18) |
| `lib/rbac/navigation-service.ts` | `getSidebarMenu` legge `role_functionality` invece di `role_permission` |
| `lib/rbac/navigation-actions.ts` | via l'inserimento del permesso in `createNavigationItem`, la copia di nome/descrizione/traduzioni in `updateNavigationItem`, e l'intero blocco di cancellazione in `deleteNavigationItem` |
| `lib/rbac/types.ts`, `lib/db/schema.ts`, `lib/rbac/nav-row-mapper.ts` | via `id_permission` da `MenuEntryRow`; nasce `roleFunctionality` |
| `components/rbac/PermissionsTree.tsx` | interruttore a tre stati sulle cartelle |
| `components/rbac/roles/RoleDetailClient.tsx` | due alberi, due mappe, due liste di delta |
| `app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx` | passa i due alberi |

`FunctionalityForm.tsx` e `lib/rbac/item-type-options.ts` portano commenti che citano `id_permission`
come motivo di un vincolo: il vincolo resta (DEC-22) ma il motivo cambia, e i commenti vanno con lui.

## 6. Verifiche

- **Prima di tutto**: BUG-5 in browser, su un ruolo non di sistema.
- **Unità**: lo stato a tre valori di una cartella (vuota, parziale, piena, annidata); il clic che
  spegne un sottoalbero pieno; `applyToggle` che non scrive mai una cartella; `mapMenuToSidebar` con
  una voce non concessa e con un contenitore che resta vuoto.
- **Integrazione** (`I18N_INTEGRATION_DB=1`): il travaso della `0024` conserva le 14 concessioni;
  `role_list_view.has_permissions` vede le voci di menu; cancellare una voce porta via le sue
  concessioni; `updateRolePermissions` rifiuta un delta su un contenitore.
- **E2E** (pytest): sposta una voce in Funzionalità → **compare spostata** in Ruoli (è BUG-1, e
  nessun test lo copriva); spegni una cartella → tutto il sottoalbero si spegne e il salvataggio
  regge un ricarico; una funzionalità nuova compare in Ruoli sotto il proprio contenitore.
- **Da riallineare**: `permission-tree.test.ts`, `sidebar-adapter.test.ts`, `nav-tree-builder.test.ts`,
  `permission-schema.integration.test.ts`, `navigation-actions.integration.test.ts`,
  `roles-actions.integration.test.ts`, `roles-service.test.ts`,
  `schema-contract.integration.test.ts`, `test_roles.py`, `test_functionalities.py`,
  `test_sidebar.py`.

## 7. Rapporto con il design del 2026-09-01

| Decisione | Stato | Perché |
|---|---|---|
| DEC-1 (catalogo misto per origine: `SOURCE` \| `CONSOLE`) | **superata** | i permessi che coprono contenuti creati a runtime ora *sono* le voci di menu, non righe di `permission`. `origin` resta sulla tabella con un solo valore in uso (DEC-21) |
| DEC-14 (`code` solo sui permessi `SOURCE`) | **senza oggetto** | non nascono più permessi dalla console: ogni riga futura di `permission` viene dal catalogo |
| DEC-15 (un permesso della console nasce alla radice) | **superata, ed era il sintomo** | era la deviazione dichiarata che produce BUG-1: una funzionalità creata sotto «Link utili» compariva in Ruoli come nodo di primo livello. Con la voce che è il permesso, compare dov'è |
| DEC-16 (la tipologia non si converte) | **confermata, motivo nuovo** | vedi DEC-22 |
| DEC-2 (due alberi indipendenti) | **confermata, e chiarita** | restano due alberi, ma non hanno più nodi in comune da tenere allineati: uno è il menu, l'altro il catalogo del codice |
| DEC-7 (presenza = concessione) | **estesa** | vale identica su `role_functionality` |
| DEC-13 (una categoria vuota non si mostra) | **confermata** | è la regola che DEC-18 rende l'unica |
| §3.2, «più voci sullo stesso permesso» | **rinunciata** | due voci per la stessa pagina sono ora due permessi. Caso mai usato, elencato là come guadagno del modello: si perde, e va detto |

## 8. Fuori perimetro

`requirePermission` e la guardia AST (§6 di quel design), il catalogo in
`lib/rbac/permission-catalog.ts`, l'editor `/permissions`, i buchi HOLE-1…HOLE-4, la rinomina di
`/functionalities` in `/menu`. Restano Fase 2 e Fase 3. Questo lavoro non li prepara e non si
contorce per farlo: l'unica cosa che ne facilita l'arrivo è che `permission` contenga finalmente
soltanto ciò che il catalogo possiede.
