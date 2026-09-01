# Specifica — Modello dei permessi RBAC: separazione fra permesso e voce di menu (2026-09-01)

Rianalisi da zero di [rbac-permissions.md](../../input-specs/rbac-permissions/rbac-permissions.md),
condotta leggendo il sorgente invece che assumendone il contenuto. Quella specifica resta il punto di
partenza ma **non è legge**: le divergenze sono elencate e motivate in §10, e vanno riportate nel file
d'origine una volta approvata questa.

Ribalta **DEC-4** del [design RBAC del 2026-06-28](2026-06-28-rbac-module-design.md), che risolveva
la granularità con «PERMISSION-type items under `operations`». Quella decisione aveva individuato il
problema giusto e gli aveva dato una soluzione dentro una tabella sola; qui la stessa esigenza
diventa due entità distinte.

## Sommario

`navigation_item` viene **rinominata `permission`** e ripulita dei campi di presentazione, che
migrano in una nuova tabella `menu_entry`. Il rapporto fra le due è una chiave esterna annullabile:
`menu_entry.id_permission → permission.id_permission`. `role_item` diventa `role_permission` e perde
la colonna `authorized`.

I permessi hanno due origini: quelli che proteggono codice nascono da un catalogo nel sorgente e
arrivano al database via migrazione generata; quelli che coprono contenuti creati a runtime restano
creabili dalla console. La distinzione è la colonna `origin`, non la natura del permesso.

Lato server il token porta **solo l'identità**: ruoli, stato dell'account e permessi si risolvono dal
database a ogni richiesta. Un'unica funzione `requirePermission(code)` è il punto di controllo, e una
guardia AST in `guards/` impone che ogni azione server e ogni gestore HTTP la chiami o dichiari
un'esenzione esplicita.

Misure prese sul sorgente il 2026-09-01:

| Cosa | Quantità |
|---|---|
| Chiamate a `requireAdmin()` oggi | 18 azioni server + 1 rotta API + 1 layout |
| Punti che si fidano di `session.user.isAdmin` dal token, senza rilettura | 7 (più il middleware, HOLE-2) |
| Permessi nel catalogo proposto | 15 foglie + 5 categorie |
| Tabelle toccate | 4 (`navigation_item`, `role_item`, `navigation_item_tag`, nuova `menu_entry`) |
| Colonne eliminate | 3 (`authorized`, `no_permission_need_for_navigation`, `config_visibility`) |

## 1. Il problema, misurato

Oggi una riga di `navigation_item` è **contemporaneamente** la voce di menu e l'unità di
autorizzazione, e `role_item` è la concessione. Da questa sovrapposizione discendono cinque
conseguenze osservabili nel codice:

- **Non esiste granularità per verbo.** Il permesso è «questa voce», non «leggere» o «creare» questa
  voce. Il ruolo che legge le funzionalità e le assegna ma non ne crea di nuove è inesprimibile.
- **I permessi senza menu hanno bisogno di un espediente.** Vivono sotto la radice `Operations`
  (id `-1`) o portano il tipo funzionalità `PERMISSION` (id 5), ed entrambi esistono solo per essere
  esclusi dal rendering in [`isRenderable`](../../../sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts).
- **Le categorie richiedono una risalita agli antenati.** Un albero solo per due lavori costringe
  `resolveVisibleIds` a risalire i genitori di ogni foglia autorizzata, con quindici righe di
  commento che spiegano quale sezione spariva senza quella risalita.
- **La presentazione fa da confine di sicurezza.** La pagina incorporata ricostruisce la barra
  laterale e reindirizza se la voce non c'è: usa una decisione di rendering come controllo di accesso.
- **L'autorizzazione effettiva è quasi tutta binaria fra amministratore e non.** `requireAdmin()` non
  consulta `role_item`: verifica il possesso del ruolo `1`, scritto in fisso in `auth-policy.ts`.

## 2. Decisioni

- [x] ✅ ID=DEC-1, Title=Catalogo misto per origine — i permessi che proteggono codice nascono dal sorgente e sono sincronizzati; quelli che coprono contenuti creati a runtime restano creabili dalla console. La colonna `origin` (`SOURCE` | `CONSOLE`) rende la distinzione un dato, non una convenzione.
- [x] ✅ ID=DEC-2, Title=Albero esplicito sui permessi — la gerarchia vive in `permission.id_parent`. `menu_entry` ha un proprio albero indipendente, che serve solo a disegnare la barra laterale. I due alberi hanno per forza forme diverse: quello dei permessi ha foglie-verbo, il menu ha una voce sola per pagina.
- [x] ✅ ID=DEC-3, Title=Codice piatto e opaco — `export-files`, `read-users`, verbo davanti, trattini, niente punti. I punti sarebbero una seconda gerarchia implicita accanto a quella vera, e divergerebbero al primo spostamento. Il codice è il patto col sorgente e non cambia mai; l'albero è organizzazione e deve poter cambiare.
- [x] ✅ ID=DEC-4, Title=Solo identità nel token — ruoli, stato dell'account e permessi si risolvono sempre dal database. Revoca e disattivazione hanno effetto immediato. Nessuna cache fra richieste (vedi DEC-11).
- [x] ✅ ID=DEC-5, Title=L'Amministratore (ruolo `1`) scavalca il controllo — unica eccezione, dichiarata dentro `requirePermission` e in nessun altro punto. Motivo: un rilascio che aggiunge un permesso nuovo non lo concede a nessuno, e se anche l'Amministratore ne fosse privo la funzione che serve a concederlo sarebbe irraggiungibile. Ruoli amministrativi limitati restano ruoli normali con concessioni esplicite.
- [x] ✅ ID=DEC-6, Title=Non si concede ciò che non si possiede — `updateRolePermissions` verifica lato server che l'attore possieda già ogni permesso che sta concedendo. Senza questa regola `grant-role-permissions` in mano a un ruolo limitato equivale a dargli tutti i permessi con un giro in più. Il ruolo `1` è esente perché li possiede per definizione.
- [x] ✅ ID=DEC-7, Title=Presenza = concessione — `role_permission` perde `authorized`. Le righe a `false` oggi non sono un divieto: `resolveAuthorizedItemIds` le ignora. Revocare cancella la riga.
- [x] ✅ ID=DEC-8, Title=Proprietà divisa per campo — il sorgente possiede l'esistenza della riga e il `code`; la console possiede `item_translation`, `description` e la posizione nell'albero. La sincronizzazione non riscrive mai un'etichetta tradotta a mano.
- [x] ✅ ID=DEC-9, Title=Sincronizzazione via migrazione generata — il catalogo vive in `lib/rbac/permission-catalog.ts` e un comando genera la migrazione ordinata in `sources/devops/db/migrations/`. Niente sincronizzazione all'avvio: su più istanze è una corsa fra processi e in ambiente serverless non ha un momento affidabile in cui girare.
- [x] ✅ ID=DEC-10, Title=Il «sempre» è meccanizzato, non strutturale — in Next.js nessun punto di intercettazione copre le azioni server. Una guardia AST in `guards/` impone la chiamata a `requirePermission` o un'esenzione dichiarata.
- [x] ✅ ID=DEC-11, Title=Nessuna cache fra richieste — solo deduplica dentro la richiesta con `cache()` di React. Una cache a scadenza romperebbe la revoca immediata promessa da DEC-4, per risparmiare una interrogazione indicizzata che l'applicazione già paga oggi in `requireAdmin`. Si riconsidera su misura, non su sospetto.
- [x] ✅ ID=DEC-12, Title=Profilo e tema restano servizi personali — `saveProfile` e `saveThemeConfig` scrivono sulla riga dell'utente collegato. Nessun permesso: l'unico controllo sensato è «sei autenticato e stai modificando te stesso».

## 3. Modello dati

### 3.1 `permission` (era `navigation_item`)

| Colonna | Tipo | Note |
|---|---|---|
| `id_permission` | bigint PK | è il vecchio `id_item`, invariato |
| `kind` | `CATEGORY` \| `GRANT` | le categorie raggruppano, non si concedono |
| `code` | varchar(80) UNIQUE NULL | obbligatorio se `GRANT`, sempre nullo se `CATEGORY` |
| `origin` | `SOURCE` \| `CONSOLE` | DEC-1 |
| `id_parent` | bigint → `permission` | l'albero |
| `order_position` | integer | |
| `item_translation` | jsonb | etichette tradotte, di proprietà della console |
| `description` | text | |
| `deprecated_at` | timestamptz NULL | mai cancellare, DEC-9 |
| `is_immutable` | smallint | |

Vincoli:

```sql
check ((kind = 'GRANT' and code is not null) or (kind = 'CATEGORY' and code is null))
```

Le righe `origin = 'SOURCE'` hanno `code` immutabile e non sono cancellabili dalla console. Il
divieto è verificato sia nell'azione server sia da un trigger, perché è un'invariante del dato e non
solo dell'interfaccia.

### 3.2 `menu_entry` (nuova)

Riceve i campi di presentazione che oggi stanno su `navigation_item`: `icon_path`, `order_position`,
`navbar_position`, `functionality_link`, `open_in_new_tab`, `id_functionality_type`, più un proprio
`id_parent` per l'albero di rendering e le proprie etichette tradotte.

```
menu_entry.id_permission → permission.id_permission   (nullable, on delete restrict)
```

Cardinalità **molti a uno**. I quattro casi che ne discendono sono tutti utili e tutti già presenti
oggi sotto forma di espedienti:

| Caso | Significato | Cosa sostituisce |
|---|---|---|
| Permesso senza voce | protegge codice, invisibile | radice `Operations` (id −1) e tipo funzionalità `PERMISSION` |
| Voce con permesso | il caso normale | la riga che faceva entrambe le cose |
| Voce con `id_permission` nullo | voce pubblica | colonna `no_permission_need_for_navigation` |
| Più voci sullo stesso permesso | stessa pagina da due punti del menu | oggi impossibile senza duplicare il permesso |

`on delete restrict` è deliberato: cancellare un permesso a cui una voce punta deve fallire con un
messaggio, non svuotare silenziosamente il collegamento.

**`navigation_item_tag` segue il menu.** I tag servono a *ritrovare una voce*, non a descrivere un
permesso: la tabella diventa `menu_entry_tag` e la sua chiave esterna punta a `menu_entry`. È il
motivo per cui le tabelle toccate sono quattro e non tre.

### 3.3 `role_permission` (era `role_item`)

`(id_role, id_permission)` chiave primaria, nessun'altra colonna (DEC-7). La presenza della riga è la
concessione.

Concedere una categoria significa concedere le foglie `GRANT` del suo sottoalbero: l'espansione
avviene al momento della scrittura, non della lettura, così `hasPermission` resta una ricerca
nell'insieme.

Conseguenza da tenere presente, perché è controintuitiva: **un permesso nuovo aggiunto sotto una
categoria non arriva ai ruoli che quella categoria l'avevano già accesa.** La concessione è sulle
foglie di allora, non sul ramo. È il comportamento corretto — un rilascio non deve allargare in
silenzio i poteri di un ruolo esistente — ma va detto nell'interfaccia: la pagina Ruoli & Permessi
segnala le foglie non concesse dentro un ramo altrimenti pieno, invece di mostrare il ramo spento.

### 3.4 Colonne che spariscono

| Colonna | Perché | Sostituita da |
|---|---|---|
| `role_item.authorized` | le righe a `false` non sono un divieto, sono peso morto | presenza della riga |
| `no_permission_need_for_navigation` | | `menu_entry.id_permission` nullo |
| `config_visibility` | | assenza di una riga in `menu_entry` |

## 4. Il catalogo dei permessi

### 4.1 La regola di granularità

> **Due operazioni meritano due permessi quando esiste un ruolo plausibile che ha l'uno e non
> l'altro.** Altrimenti sono un permesso solo.

La regola serve a decidere le aggiunte future, non solo il catalogo iniziale. Applicata alle 20
operazioni protette oggi, le porta a 15 permessi. In entrambe le direzioni:

- `createRole` / `renameRole` / `deleteRole` **collassano** in `manage-roles`: un ruolo che crea ma
  non può cancellare non corrisponde a niente di reale.
- `saveTranslations` resta **separato** da `createTranslationKey` / `deleteTranslationKey`: il
  traduttore che riempie i valori senza toccare la struttura delle chiavi è un ruolo vero.

### 4.2 Il catalogo

```
Amministrazione                    (categoria)
├── Utenti                         (categoria)
│   ├── read-users                 griglia utenti + pagina Gestione utenti
│   ├── invite-users               POST /api/admin/send-invite
│   ├── set-user-status            attiva / disattiva
│   └── assign-user-roles          updateUserRoles
├── Ruoli e permessi               (categoria)
│   ├── read-roles                 griglia ruoli + dettaglio
│   ├── manage-roles               crea, rinomina, elimina
│   └── grant-role-permissions     updateRolePermissions — soggetto a DEC-6
├── Menu e permessi                (categoria)
│   ├── read-menu
│   ├── manage-menu                crea, modifica, sposta, elimina voci
│   └── manage-permissions         permessi di origine CONSOLE
└── Internazionalizzazione         (categoria)
    ├── read-languages
    ├── manage-languages           crea, modifica, attiva, predefinita, elimina
    ├── read-translations
    ├── edit-translations          saveTranslations
    └── manage-translation-keys    crea / elimina chiavi
```

Fuori dal catalogo di proposito: profilo e tema (DEC-12), registrazione e recupero password
(anonimi), dizionario delle traduzioni (qualsiasi autenticato), sonde di salute (pubbliche).

## 5. Sincronizzazione

Il catalogo vive in `lib/rbac/permission-catalog.ts` come lista congelata di
`{ code, parentPath, labels, description }`. Un comando `npm run permissions:migration` genera la
migrazione ordinata successiva dal confronto fra catalogo e migrazioni già presenti — il README del
progetto è esplicito sul fatto che le aggiunte di seme vanno in una migrazione numerata, mai dentro
`schema.sql` generato.

Tre regole, e la seconda è quella che `rbac-permissions.md` sbaglia:

1. **Inserisce** i codici mancanti, con etichette predefinite e posizione iniziale nell'albero.
2. **Non aggiorna mai** etichette, descrizioni o posizione di righe esistenti (DEC-8). La specifica
   d'origine prescrive di aggiornare descrizione e categoria a ogni versione: così ogni rilascio
   cancellerebbe il lavoro dei traduttori.
3. **Non cancella mai.** Un codice sparito dal sorgente riceve `deprecated_at`: esce dall'albero
   nella console, le concessioni restano sul database, e se un domani quel codice torna nessuno si
   accorge di nulla.

**Adozione.** Se un permesso creato dalla console ha già quel `code`, la sincronizzazione ne ribalta
`origin` a `SOURCE` e conserva le concessioni, invece di fallire per chiave duplicata.

## 6. Enforcement

### 6.1 Il risolutore

```
resolveActor(userId) → { accountActive, roleIds, isAdmin, permissions: Set<string> }
```

Una interrogazione: `users → user_role → role_permission → permission`, avvolta in `cache()` di React
— l'idioma che il progetto usa già in `navigation-service.ts` e `roles-service.ts`. Deduplica dentro
la richiesta, non fra richieste (DEC-11).

### 6.2 Il punto di controllo

```
requirePermission(code) → Actor | lancia
```

Dentro, e **solo** dentro, tre cose: account disattivato negato comunque; ruolo `1` scavalca (DEC-5);
tutto il resto è appartenenza all'insieme. `requireAdmin()` sparisce, sostituita ovunque. Il costo
della sostituzione è basso: oggi ogni azione ha già `await requireAdmin()` come prima riga.

### 6.3 La guardia che impone il «sempre»

In Next.js nessun punto di intercettazione copre le azioni server — il middleware non le vede, e
nessuna annotazione è applicata dal linguaggio. La guardia in `guards/permission-declared.test.ts`,
stile AST come `handler-naming.test.ts`, impone:

> ogni funzione esportata da un file `'use server'`, e ogni gestore HTTP esportato da
> `app/api/**/route.ts`, deve avere come prima istruzione `requirePermission(...)` **oppure** una
> dichiarazione esplicita di esenzione.

Le esenzioni sono chiamate vere, non omissioni: `allowSelfService()`, `allowAnonymous()`,
`allowAnyAuthenticated()`. Un'esenzione dichiarata si legge in revisione e si trova con grep; una
dimenticanza no.

Una seconda guardia, `guards/permission-catalog.test.ts`, controlla il catalogo nelle due direzioni:
ogni `requirePermission('x')` nel sorgente ha `x` nel catalogo e non deprecato; ogni codice del
catalogo compare in una migrazione. La prima direzione chiude il buco silenzioso in cui il codice
protegge una stringa che sul database non esiste; la seconda il caso opposto.

### 6.4 I buchi che il modello chiude

- [ ] ID=HOLE-1, Severity=High, Complexity=Low, Priority=P1, Estimate=hours, Title=Sette punti si fidano del token senza rileggere il database, Fix description=`roles-grid`, `users-grid`, `translations-grid`, `languages-grid` e le tre pagine `/admin/*` leggono `session.user.isAdmin`. Togliere ruoli a qualcuno non chiude quelle sette porte fino al rinnovo del token. Con l'identità sola nel token (DEC-4) il problema diventa impossibile da riprodurre: non resta niente di autorizzativo di cui fidarsi.
- [ ] ID=HOLE-2, Severity=Medium, Complexity=Low, Priority=P2, Estimate=minutes, Title=Il middleware ha una lista di percorsi scritta a mano, Fix description=`ADMIN_PATHS` in `auth.config.ts`: una pagina amministrativa nuova che nessuno aggiunge non è protetta lì. Resta utile per reindirizzare presto, ma smette di essere una difesa — la difesa è la pagina che dichiara il proprio permesso.
- [ ] ID=HOLE-3, Severity=High, Complexity=Low, Priority=P1, Estimate=minutes, Title=La pagina incorporata usa la presenza nel menu come controllo di sicurezza, Fix description=`embedded/[itemId]/page.tsx` ricostruisce la barra laterale e reindirizza se la voce non c'è: una decisione di presentazione usata come confine di autorizzazione. Deve leggere il permesso della voce e chiamare `requirePermission`.
- [ ] ID=HOLE-4, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Il catch-all rende Home per qualunque rotta sconosciuta, Fix description=`[...slug]/page.tsx` mostra la home invece di 404. Una funzionalità interna che punta a una rotta inesistente non dà errore; con i permessi attivi sembrerà un rifiuto di accesso. Portare a `notFound()`.

## 7. Interfaccia

**`/functionalities` → `/menu`.** Resta l'editor del menu — è già quello che è visivamente, e il
lavoro fatto con dnd-kit non si butta. Guadagna un campo *Permesso richiesto*, con ricerca
sull'albero dei permessi e l'opzione esplicita **«Nessuno — voce pubblica»**.

**`/permissions`, nuova.** Editor dell'albero dei permessi. Stessa forma ad albero, comportamento
diverso per origine: le righe `SOURCE` mostrano il `code` in sola lettura e non si cancellano (solo
etichette e posizione sono modificabili); le righe `CONSOLE` si creano, rinominano ed eliminano. Le
deprecate stanno dietro un filtro, spente.

**`/roles-permissions` si semplifica.** Un solo albero: niente più due radici, niente più `Operations`
con id −1, niente più foglie di tipo `PERMISSION` nascoste al menu. Accendere una categoria concede
le foglie sotto — che è ciò che l'interfaccia già fa, ma senza le eccezioni che le servivano per non
rompere la barra laterale.

**`use-auth` smette di esporre `isAdmin`** e passa a esporre l'insieme dei permessi, così un pulsante
si nasconde con lo stesso vocabolario con cui l'azione dietro si protegge. Resta inteso che
nascondere il pulsante non protegge niente: protegge `requirePermission` sull'azione.

## 8. Migrazione dei dati

L'ordine conta, e il punto di forza è che **nessuna concessione esistente si perde**: la chiave
esterna delle concessioni non si muove, perché la tabella che le riceve è la stessa riga rinominata.

1. `alter table navigation_item rename to permission`, `id_item` → `id_permission`.
2. Aggiunta di `kind`, `code`, `origin`, `deprecated_at`. Popolamento: `id_item_type = 1` → `kind = 'CATEGORY'`; tutto il resto → `kind = 'GRANT'`, `origin = 'CONSOLE'`, `code` generato dal nome e reso univoco.
3. Creazione di `menu_entry` e travaso delle righe che oggi compaiono nel menu. Le foglie generano una voce con `id_permission` che punta alla riga d'origine; le categorie generano una voce contenitore con `id_permission` nullo, che ricostruisce l'albero di rendering. Le righe sotto `Operations` e quelle di tipo `PERMISSION` non generano voci: erano già invisibili. Le voci con `no_permission_need_for_navigation = 1` nascono con `id_permission` nullo.
4. `navigation_item_tag` → `menu_entry_tag`, con la chiave esterna ripuntata sulle voci create al passo 3.
5. `alter table role_item rename to role_permission`, eliminazione delle righe con `authorized = false`, poi `drop column authorized`.
6. Migrazione generata dal catalogo (§5): inserisce le 15 foglie e le 5 categorie, adottando eventuali codici già presenti.
7. Riscrittura di `apply_role_permission_deltas`, `replace_item_tags` e `role_list_view` sui nomi nuovi — i corpi delle funzioni sono testo, non riferimenti per OID, quindi un rename le rompe in silenzio fino alla prima chiamata. `replace_user_roles_guarded` non è coinvolta: tocca solo `user_role`, che non cambia nome.
8. Eliminazione di `no_permission_need_for_navigation` e `config_visibility` dopo che il passo 3 ne ha assorbito il significato.

Il ramo `Operations` (id −1) e la radice (id 0) restano come categorie dell'albero dei permessi:
smettono di essere espedienti di rendering e diventano nodi normali.

## 9. Verifiche

- **Unità**: `resolveActor` con account disattivato, ruoli multipli, categorie annidate; `requirePermission` con e senza scorciatoia amministratore; la regola DEC-6 con attore che concede più di quanto possiede.
- **Guardie**: le due di §6.3, più l'estensione di `schema-contract` ai nomi nuovi.
- **Integrazione** (`I18N_INTEGRATION_DB=1`): sincronizzazione idempotente ripetuta due volte; adozione di un codice `CONSOLE` preesistente; deprecazione che conserva le concessioni.
- **E2E** (pytest): un ruolo limitato che vede solo la propria voce di menu e riceve 403 sull'azione che non gli compete; revoca di un permesso che ha effetto **senza** ri-autenticazione — è la verifica che DEC-4 e DEC-11 stiano insieme.

## 10. Divergenze da `rbac-permissions.md`

| Punto | La specifica d'origine | Qui | Perché |
|---|---|---|---|
| Codice del permesso | `users.create`, con punti e gerarchia implicita | piatto, `read-users` | DEC-3: i punti sarebbero una seconda gerarchia che diverge dalla vera |
| Tipi APPLICATION / MENU | due tipi di permesso | nessun tipo; la distinzione è `origin`, e la visibilità è `menu_entry` | il tipo confondeva «chi possiede la definizione» con «a cosa serve» |
| Permesso di menu | creato automaticamente per ogni voce | la voce **punta** a un permesso esistente, o a nessuno | evita un permesso per voce e permette più voci sullo stesso permesso |
| Sincronizzazione | aggiorna descrizione e categoria | non aggiorna mai (DEC-8) | riscriverebbe le traduzioni fatte a mano a ogni rilascio |
| JWT | contiene i ruoli | contiene solo l'identità (DEC-4) | se i ruoli si rileggono comunque, tenerli nel token è ridondanza che invecchia |
| Annotazione + interceptor | `@RequirePermission` e un filtro | chiamata esplicita + guardia AST (DEC-10) | in Next.js nessun punto di intercettazione copre le azioni server |
| Cache dei permessi | prevista dall'architettura | esclusa per ora (DEC-11) | romperebbe la revoca immediata per un risparmio non misurato |
| Campi `type`, `enabled`, `category` su `permissions` | tre colonne | `kind`, `deprecated_at`, `id_parent` | `category` come stringa è una gerarchia piatta: l'albero la sostituisce |

Concordano invece, e restano: tabella dei permessi con codice univoco, tabella di relazione
ruolo→permesso, servizio di autorizzazione centralizzato, permessi mai inseriti nel token, catalogo
sincronizzato a ogni versione senza cancellazioni automatiche, separazione netta fra autenticazione e
autorizzazione.

## 11. Fuori perimetro

Jolly (`documents.*`), permessi gerarchici a runtime, multi-tenant, ABAC, sicurezza a livello di
singolo record. `rbac-permissions.md` li elenca come estensioni future e tali restano: il modello non
li implementa e non si contorce per prepararli. L'unica cosa che ne facilita l'arrivo è che
`hasPermission` sia un punto solo — e lo è.
