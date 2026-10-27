# Revisione della velocità dei test (2026-10-27)

Analisi del codice di tutti i test (unitari, di integrazione, E2E), fatta prima del pezzo 5a della
multi-tenancy per accorciare i tempi di esecuzione senza perdere copertura. I numeri per singolo
test sono stime: il primo passo (TS-0) è misurarli.

## Sommario

**Tempi misurati** (ultima esecuzione verde, 2026-10-26):

| Serie | In CI (Postgres locale al runner) | In locale (database di prova su Supabase, eu-west-1) |
|---|---|---|
| Unitari (1326 test) | ~10 s | ~10 s |
| Integrazione (325 test, 31 file) | **35 s** | 6–9 min |
| E2E (154 test) | **12 min 36 s** | ~27 min |

**Cosa ne esce:**

1. **La causa principale in locale è il database remoto.** Gli stessi test girano 10–15 volte più
   veloci (integrazione) e 2 volte più veloci (E2E) in CI, dove il database è sulla stessa
   macchina. Far girare i test in locale contro un Postgres sul Mac (TS-1) è il guadagno più
   grande e non tocca la copertura.
2. **Negli E2E si perde molto tempo in attese e preparazioni**, non nelle verifiche:
   - un rallentamento artificiale di 50 ms su ogni azione (`slow_mo=50`);
   - un'attesa "rete ferma" (`networkidle`) dopo ogni navigazione;
   - un caricamento della home prima di quasi ogni test, anche quando il test va altrove;
   - creazioni e cancellazioni fatte cliccando nell'interfaccia;
   - circa 100 lanci di `db.mjs`, ciascuno con una nuova connessione.
3. **Ridondanza vera:**
   - circa 40 test E2E controllano cose già coperte da un altro E2E o da un test unitario (la
     barra laterale da sola passa da 27 a ~13 test senza perdere nulla);
   - circa 17 test di integrazione ripetono la stessa verifica in due file.
4. **I test unitari non vanno ottimizzati**, ma gli 8 fallimenti noti di `Sidebar` su Node 26 si
   sistemano con poche righe (TS-2).
5. **Stima complessiva.** Con le voci delle fasi A e B gli E2E in locale passano da ~27 a ~10–14
   minuti e l'integrazione da 6–9 a ~3–5 minuti. Con un Postgres locale (TS-1) scendono ancora,
   verso i tempi della CI. L'esecuzione in parallelo (fase C) dimezza ancora i tempi, ma richiede
   più lavoro e più cautela.

**Ordine consigliato:** TS-0, poi la fase A (quasi tutte voci da minuti, senza rischio), poi la fase
B per gli E2E e l'integrazione, infine la fase C se serve ancora.

Dettaglio delle analisi (con riferimenti a file e righe): `.superpowers/sdd/test-speed/` (ignorata da
git) e i rapporti dei subagenti di questa revisione.

## Fase 0 — misurare

- [ ] ID=TS-0, Severity=Low, Complexity=Low, Priority=P0, Estimate=minutes, Title=Misurare i tempi per test, Fix description=Eseguire una volta `uv run pytest --durations=0` e l'integrazione con `npx vitest run -c vitest.integration.config.ts --reporter=json --outputFile=…`; aggiungere `--durations=25` alla CI. Serve a confermare l'ordine delle voci sotto. **Parte CI fatta (commit d1cd2e2): `--durations=25` nel passo E2E di `quality.yml`. Restano la misura locale con `--durations=0` e il rapporto JSON dell'integrazione (le misure della fase A usano `--durations=40`).**

## Fase A — guadagni rapidi, senza perdita di copertura

- [✅] ID=TS-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Postgres locale per i test in locale, Fix description=Un Postgres sul Mac (Docker o Postgres.app) preparato come in CI: `test-apply`, ruolo dell'app con `provision-runtime-role`, semi degli utenti E2E di `quality.yml`. `.env.test.local` e la configurazione `web-construct-e2e` puntano lì; il database su Supabase resta per chi vuole provare contro l'ambiente remoto. Atteso: integrazione da minuti a decine di secondi, E2E −25/50 %. **Fatto (commit 781711e): integrazione 325/325 in 26 s (da 6–9 min), E2E 154/154 in 7 min 26 s (da ~27 min).**
- [✅] ID=TS-2, Severity=Medium, Complexity=Low, Priority=P0, Estimate=minutes, Title=Test di Sidebar verdi su Node 26, Fix description=Spostare in un file di preparazione comune (`setupFiles` di `vitest.config.ts`) il piccolo `localStorage` finto che `Sidebar.tenant-switcher.test.tsx` usa già; vale solo quando il `localStorage` di Node non è utilizzabile. Toglie gli 8 fallimenti noti. **Fatto (commit 2ad6ee9): `vitest.setup.ts` mette un archivio in memoria solo nei file jsdom e solo se quello dell'ambiente non funziona; `npm run test` 1326/1326 su Node 26 (prima 8 fallimenti).**
- [✅] ID=TS-3, Severity=Medium, Complexity=Low, Priority=P0, Estimate=minutes, Title=Togliere `slow_mo=50` negli E2E, Fix description=`conftest.py:98` aggiunge 50 ms a ogni azione; tenerlo solo con il browser visibile (`HEADLESS=false`). Atteso 1,5–3 min. Far girare la serie 3 volte per scoprire eventuali attese nascoste. **Fatto (commit b0aa3ff, insieme a TS-4): `slow_mo` resta solo con `HEADLESS=false`; tre esecuzioni complete verdi di fila, nessuna attesa nascosta emersa.**
- [✅] ID=TS-4, Severity=Medium, Complexity=Low, Priority=P0, Estimate=minutes, Title=Le pagine con accesso non caricano più la home, Fix description=`logged_in_page` e `non_admin_page` (`conftest.py:140,151`) fanno `nav("/")` anche quando il test va subito altrove (~85 test). Le fixture si fermano su una pagina vuota; un fixture `home_page` per i test che partono davvero da `/` (barra laterale, profilo, impostazioni, accesso). Atteso 2–3,5 min. **Fatto (commit b0aa3ff): fixture `home_page` per la barra laterale e i due collegamenti del pannello dell'account; con TS-3 e il resto della fase A la serie E2E passa da 7 min 26 s a 5 min 04–08 s sul Postgres locale.**
- [✅] ID=TS-5, Severity=Medium, Complexity=Low, Priority=P0, Estimate=minutes, Title=Svuotare la preparazione dei test "embedded", Fix description=La fixture di `test_embedded.py` crea un ruolo, concede la voce, assegna il ruolo all'amministratore e rifà l'accesso: inutile, perché l'amministratore vede già tutte le voci e i ruoli si leggono dal database a ogni richiesta. Basta creare la voce una volta per modulo. Atteso ~1 min. **Fatto (commit eb66b2e): una voce per indirizzo di destinazione e per modulo, concessa al ruolo Amministratore con una istruzione SQL (la concessione serve: la barra mostra solo le voci concesse, anche all'amministratore); il file passa da ~43 s a ~13 s.**
- [✅] ID=TS-6, Severity=Low, Complexity=Low, Priority=P1, Estimate=minutes, Title=Attesa a vuoto di 5 secondi nei ruoli, Fix description=`_safe_delete_functionality` aspetta 5 s una riga già cancellata (`test_roles.py:131,531`); `_delete_role` cerca due volte (`test_roles.py:48`). Atteso ~30 s. **Fatto (commit bf4bee7): `test_deleted_functionality_disappears_from_roles` da 13,4 s a 6,2 s; la seconda ricerca resta solo in `test_create_rename_delete_role`.**
- [✅] ID=TS-7, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Meno lanci di `db.mjs` negli E2E, Fix description=`test_permissions.py` lancia 7–9 `test-query` per test (~68 per esecuzione): unirli in una sola istruzione multipla per preparazione e pulizia, con il ruolo di sola lettura condiviso per modulo; la pulizia dei tenant in `test_tenants.py` in un solo comando. Atteso 40–70 s in locale. **Fatto (commit fcd4582): `test_permissions.py` da ~68 lanci di `db.mjs` a 8; `test-tenant-delete` accetta più `--slug`, la pulizia dei tenant da 7 a 3 lanci (×2) e l'inizio sessione da 3 a 1.**
- [ ] ID=TS-8, Severity=Low, Complexity=Low, Priority=P1, Estimate=minutes, Title=Cache del browser di Playwright in CI, Fix description=Mettere in cache `~/.cache/ms-playwright` nel job `database-and-e2e`. Atteso 30–60 s di job (non di test). **Fatto nel commit d1cd2e2 (cache con chiave sulla versione di Playwright di `uv.lock`, `install --with-deps` invariato); da confermare alla prima esecuzione in CI, qui non verificabile.**

## Fase B — E2E: attese e ridondanze

- [ ] ID=TS-9, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Niente `networkidle` dopo ogni navigazione, Fix description=`helpers.nav` aspetta "rete ferma" (almeno 500 ms ogni volta, ~400 volte per esecuzione) e poi l'idratazione, che è già il segnale giusto. Usare `domcontentloaded` + idratazione; dove dopo una navigazione si contano righe di una griglia, aspettare la prima riga. Togliere le ~46 attese esplicite superflue. Atteso 3–6 min. Rischio medio: 3–5 esecuzioni verdi prima di considerarlo fatto.
- [ ] ID=TS-10, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Pulizia via SQL invece che dall'interfaccia, Fix description=Ripristino del tema, cancellazione dei ruoli e ripristino delle traduzioni fatti oggi cliccando; farli con una sola istruzione SQL, tenendo almeno un test che cancella dall'interfaccia per ogni tipo di oggetto. Le voci di menu restano cancellate dall'interfaccia finché non c'è un aiuto SQL che rispetta le cascate. Atteso 1,5–2,5 min.
- [ ] ID=TS-11, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Barra laterale: da 27 a ~13 test, Fix description=Unire i test che ripetono la stessa preparazione o verifica: visibilità e pulsanti, apertura del secondo livello, comprimi/riapri, anteprima al passaggio del mouse (quattro test in uno), viewport 767 e 768. La logica è già coperta da `sidebar-presentation.test.ts`, `Sidebar.collapse-persistence.test.tsx`, `sidebar-highlight.test.ts`.
- [ ] ID=TS-12, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Funzionalità e ruoli: scenari uniti, Fix description=Funzionalità: i 5 test sulla pagina di creazione in uno; i due sull'elenco "Genitore" in uno; i tre sullo spostamento di genitore in uno; una sola prova del trascinamento da tastiera; via il test sull'elemento immutabile già coperto. Ruoli: i tre test sull'albero dei permessi in uno scenario; un ruolo condiviso per modulo invece di uno per test.
- [ ] ID=TS-13, Severity=Low, Complexity=Low, Priority=P1, Estimate=hours, Title=Accesso, permessi, profilo, registrazione: verifiche doppie, Fix description=Via `test_test_login_redirects_to_home` e `test_admin_not_locked_out` (coperti dalle fixture); un solo test che prova tutti i rinvii per chi non ha accesso o non ha permesso; via `test_administrator_still_sees_edit_controls`; profilo da 8 a 5 (un solo salvataggio); registrazione da 7 a 4; via il test del dominio non ammesso (coperto da `register/route.test.ts`).
- [ ] ID=TS-14, Severity=Low, Complexity=Low, Priority=P2, Estimate=hours, Title=Griglie, tema, lingue: verifiche già coperte, Fix description=Utenti e ruoli: una sola prova dell'intestazione della colonna azioni e del menu delle colonne (sono componenti condivisi); via la ricerca utenti che non può fallire e il filtro per data degli utenti. Tema: unire salvataggio e "il colore arriva a tutti"; i 6 test di solo comportamento del client sono coperti da `AdminTheme.test.ts` e simili. Lingue: via il test dell'autocompletamento e quello della modifica concorrente (coperti da test unitari e d'integrazione).
- [ ] ID=TS-15, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Tenant: meno accessi completi, Fix description=Unire `test_login_stays_on_subdomain` con `test_subdomains_are_separate` e provare "Riprova" senza tenant nella stessa sessione. Atteso 2 accessi in meno.

## Fase B — integrazione: preparazioni e ridondanze

- [ ] ID=TS-16, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Cancellare un tenant di prova con una sola istruzione, Fix description=`deleteTenantForTest` fa 12 istruzioni in sequenza per ogni tenant (~24 tenant per esecuzione): un solo blocco SQL che scorre le tabelle di tenant impostando il contesto. Atteso 30–40 s sul database remoto.
- [ ] ID=TS-17, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Preparazioni in blocco, Fix description=Utenti, appartenenze e ruoli creati uno alla volta (15 utenti in `auth-roles`, 5 in `host-tenants`, …): inserimenti multipli in una sola transazione. Atteso 30–50 s.
- [ ] ID=TS-18, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=hours, Title=Tenant di prova condivisi per esecuzione, Fix description=Un "mondo" creato una volta (`globalSetup`): tenant con indirizzo, sospeso e semplici, usati in sola lettura da `host-tenants`, `tenant-actions`, `tenant-base-url` e `auth-roles`; pulizia di `zzz-%` all'inizio e alla fine. Toglie ~12 copie dal modello. Atteso 60–90 s.
- [ ] ID=TS-19, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=hours, Title=Test in parallelo dentro un file, Fix description=`it.concurrent` per i test che leggono soltanto: contratto di schema, catalogo dei permessi, comandi `tenant-create`, letture di `tenant-hosts-schema` e `host-tenants`. Atteso 60–100 s sul database remoto.
- [ ] ID=TS-20, Severity=Low, Complexity=Low, Priority=P1, Estimate=hours, Title=Via ~17 test d'integrazione doppi, Fix description=Ultimo amministratore (tenere `tenant-membership` e il test di concorrenza, togliere `users-actions :61` e `tenant-isolation :191,:205`); non membri e appartenenze di B (tenere `tenant-membership`); primo accesso (tenere `tenant-membership` + `auth-roles :297`); attore disattivato (tenere `auth-roles`); ruoli di sistema (unire `tenant-schema :14` e `system-roles :35`); ~10 test di `permission-schema` già coperti dal contratto di schema. I 3 test di validazione dell'input passano ai test unitari.
- [ ] ID=TS-21, Severity=Low, Complexity=Low, Priority=P2, Estimate=hours, Title=Rifiniture minori dell'integrazione, Fix description=Impronta di B portata da un caso al successivo in `cross-tenant-entry-points`; test di concorrenza più leggero in locale (pieno in CI); attese fisse sostituite da attese sui lock; i 4 controlli dell'inventario senza database spostati fra i `guards`.

## Fase C — esecuzione in parallelo e build di produzione

- [ ] ID=TS-22, Severity=Medium, Complexity=High, Priority=P2, Estimate=days, Title=E2E in parallelo con pytest-xdist, Fix description=Preparazione e pulizia solo nel processo principale; utenti E2E diversi per ogni processo; un'identità dedicata per i test dei tenant; gruppi che restano in serie (tema, lingue, albero del menu); i 3 controlli basati su "conteggio prima/dopo" riscritti su righe note. 2 processi in CI, 3–4 in locale. Atteso: tempi divisi per 2–3 dopo le fasi A e B.
- [ ] ID=TS-23, Severity=Medium, Complexity=High, Priority=P2, Estimate=days, Title=Integrazione in parallelo, Fix description=Due corsie: in serie i file che toccano stato condiviso (amministratori del tenant predefinito, permessi globali, lingue e traduzioni, menu del predefinito, impronta del modello); in parallelo i file che lavorano solo su tenant propri, con meno connessioni per processo. In alternativa un database per processo clonato da uno già migrato.
- [ ] ID=TS-24, Severity=Low, Complexity=High, Priority=P3, Estimate=days, Title=E2E contro una build di produzione in CI, Fix description=Toglie la compilazione al primo accesso di ogni pagina e rende le risposte 1,5–3 volte più veloci, ma l'accesso di prova è disattivato in produzione per sicurezza: servirebbero password vere per gli utenti E2E e l'accesso con email e password. Costa una build in più per ogni esecuzione.

## Difetti notati di passaggio

- [ ] ID=TS-25, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Funzione definita due volte e test senza pulizia garantita, Fix description=`_create_category` è definita due volte in `test_functionalities.py` (righe 331 e 629, vale la seconda); i test `test_tipologia_in_edit_*` non hanno `try/finally` e, se falliscono, lasciano voci nel menu condiviso.
