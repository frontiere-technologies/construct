Roles
- R-01 - [✅] Nella sezione Roles, c'è un bug sulla finestrella che si apre sui tre puntini. Vedi docs/input-specs/rbac-fixes-and-improvements/images/azioni-tre-puntini-non-si-vedono.png e docs/input-specs/rbac-fixes-and-improvements/images//azioni-tre-puntini-si-vedono.png
- R-02 - [✅] L'ordinamento deve essere possibile anche per la colonna "Ha permessi"
- R-03 - [✅] Roles filtri
  - R-03.01 - [✅] Date specificando in un widget calendario le date iniziali e finali
  - R-03.02 - [✅] Numero di utenti associati da min a max
- R-04 - [✅] L'id del ruolo è visibile in modifica ruolo (vedi ./significato-sezioni-e-operationi.png). Non credo serva
- R-05 - [⏰] Voglio che l'api per i ruoli sia paginata. role?page=1&size=10&sort=associatedUsers&direction=DESC&search=Ad&hasPermissions=true. Risposta: In realtà forse è meglio prenderli tutti

Functionalities
- F-01 - [✅] Aggiungi il + di crea nuovo anche negli elementi in modo da aggiungere direttamente un sotto-elemento
- F-02 - [✅] drag-n-drop non funzionante non permette di spostarlo dopo l'ultimo elemento
- F-03 - [✅] drag-n-drop poco visibile, migliorarlo come nell'originale, anche meglio (vedi ./drag-and-drop-visible.png)
- F-04 - [✅] Prima del rifacimento completo del codice delle funzionalità e ruoli si poteva impostare un icona usando una libreria di icone carine. Metti quella come possibilità base. Il top sarebbe avere entrambe le possibilità e poter caricare una propria icona
- F-05 - [✅] Nel menù a tendina che elenca la tipologia delle funzionalità vanno fatte queste modifiche: togliere "Tipologia *" e "Desktop remoto"; cambiare "Funzionalità interna" in "Link interno"; Cambiare "Pagina incorporata" in "Link esterno embedded"; 
- F-06 - [✅] Unifica "Categoria" e "Funzionalità" con la seguente selezione: "Category", "Link esterno embedded (iframe)", "Link esterno (http[s])", "Link interno (/path)"

Varie
- V-01 - [✅] Analizzare il codice di tutti i test E2E per vedere se ci sono ridondanze e se si possono snellire
- V-02 - [✅] Per la home voglio il logo Constract rimpicciolito
- V-03 - [✅] Users, Functionalities and "Roles and Permissions" are all under Admin. RBAC does not exist
- V-04 - [✅] Cambiare tutte le rotte interne in kebab-case. Esempio: da /userManagement a: /user-management
- V-05 - [✅] Per un istante prima del caricamento delle icone, tutte appaiono come "?". Succede solo per un istante quindi non sono neanche sicuro sia un "?"