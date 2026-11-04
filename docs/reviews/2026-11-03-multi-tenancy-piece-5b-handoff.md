# Multi-tenancy 5b — stato e ripresa del 3 novembre 2026

Aggiornamento del 4 novembre 2026. T01–T12 e la parte locale di T13 sono completati e rivisti. Ultimo codice verificato 9cb49ed, prova locale 0074, sviluppo 0063. Restano T13.6 operativo e la verifica sul collegamento Supavisor di destinazione.

Area da riusare: /Users/mario.stefanutti/.codex/worktrees/multi-tenancy-piece-5b/construct, ramo feature/multi-tenancy-piece-5b. Nessun nuovo worktree necessario; checkout originale, stash e file del proprietario restano fuori dall’esecuzione.

## Punto attuale

Il ramo locale feature/multi-tenancy-piece-5b è pronto per la richiesta di autorizzazione all’invio. I rapporti final-branch-review.md, final-fix-review.md e final-revocation-review.md sono nell’area del piano. I due rilievi importanti sono chiusi. Le correzioni sono 5e97d4c e 9cb49ed. Upgrade 0063→0074 verificato, 1.732 unitari e 242 integrazioni mirate dopo l’ultima correzione, 9 prove browser dei flussi interessati. La completa precedente conta 816 integrazioni. Il browser completo ha avuto 167/168, poi 3/3 dopo correzione dell’attesa sulla pagina incorporata. Server di prova spento. Vedi il registro per prove e decisioni, e la guida docs/runbooks/tenant-data-lifecycle.md per la sequenza operativa. Le sezioni successive documentano passaggi storici.

## Registro storico T07 — concluso, da non riavviare

Codice T07: commit5046512deb8a4ddaeddde840e0b40a17b8ca7451 e correzione0711843082db3e3fca1c409a4c7e888b4d86bf55. Base del task: dcfbabc44ccc264da7d391e9051b1039b8ae7f6b. Il checkpoint dei documenti è nel commit locale69a8ff9; **non usare HEAD~1 per costruire il diff**.

Verifiche:1659 unità in164file, single10/10 e auth-roles21/21, host13/13 e azioni11/11 nei mirati precedenti, lint/tipi verdi, contratto ambiente6/6. Ready single misurato5viaggi/4istruzioni, senza enumerare tenant a ogni richiesta. DDL/schema invariati; snapshotB, RLS e privilegi invariati. Diagnostici intenzionali delle prove di errore dichiarati nel rapporto.

- [✅] ID=MT5B-RESUME-20261103-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Verificare il precedente arresto, Fix description=Limite d’uso confermato, sorgenti e log intatti, stesso esecutore ripreso; Docker locale ripristinato e prove rimaste concluse.
- [✅] ID=MT5B-T07-REVIEW, Severity=Critical, Complexity=High, Priority=P0, Estimate=hours, Title=Completare la revisione indipendente T07, Fix description=Revisore sostituito per preferenza esplicita del proprietario: /root/mt5b_t07_reviewer_61 gpt-6.1-sol high, package review-dcfbabc..5046512.diff nell’area del piano. Attendere rapporto task-7-review.md con conformità e qualità. Se interrotto, riprenderlo con followup_task senza rifare prove o attività concluse; se non recuperabile, nuovo revisore con gli stessi file/range. Non assumere approvazione dall’assenza del rapporto.
- [✅] ID=MT5B-T07-FIX, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Gestire l’esito T07 e aggiornare i documenti, Fix description=Eventuali correzioni allo stesso /root/mt5b_t07_implementer con riesame circoscritto per giro; altrimenti chiudere il gate. Spuntare T07 soltanto dopo verifica e approvazione, aggiornando piano, roadmap e registro e creando commit locali.
- [✅] ID=MT5B-NEXT-T08, Severity=High, Complexity=High, Priority=P1, Estimate=days, Title=Proseguire dal task T08, Fix description=Solo dopo T07 approvato, nuovo esecutore T08 e revisione indipendente. Continuare il piano senza chiedere nuovamente il metodo. I test sul browser usano server separato sulla prova e uv run pytest, mai insieme alle integrazioni.

## Documenti e decisioni

Piano: docs/superpowers/plans/2026-10-30-multi-tenancy-piece-5b-platform.md. Specifica: docs/superpowers/specs/2026-10-29-multi-tenancy-piece-5b-platform-design.md. Registro completo e costi delle decisioni1–19: docs/reviews/2026-10-30-multi-tenancy-piece-5b-platform-ledger.md. Le decisioni e la rettifica del Ruling15 sono vincolanti; non ricostruirle dalla sola memoria.

Ruling17: single non crea membership né REGISTERED automaticamente, neppure per un membro esistente. Ruling18: refreshTenant è ricalcolo essenziale senza scelta o lastTenantId, quindi «Riprova» resta disponibile solo verso default/host canonico con diritti già presenti. Ruling19: ready single rivalida tutto nello snapshot accorpato, senza nuovo lookup o scansione per richiesta. Multi conserva il proprio percorso. Le prove coprono tokenB/assistenza e richiesta successiva senza tenant.

Rapporto T07 conservato in Git: docs/reviews/2026-11-03-multi-tenancy-piece-5b-task-7-report.md. Originale, brief, contesto, pacchetto e log in .superpowers/sdd/2026-10-30-multi-tenancy-piece-5b-platform/. progress.md è la mappa di ripresa; T01–T06 non si riavviano. Se l’area ignorata sparisse, rigenerare solo brief e diff dai documenti/commit; non ripetere suite per ricreare log persi.

## Ambiente e limiti

Prova locale ripreparata il3novembre con up autorizzato: solo127.0.0.1:55432/construct_test,0001–0067, ruoli runtime/piattaforma e seed pronti. File esistente sources/devops/db/local-test.env; valori mai mostrati o riscritti. .env.local/operator.env nel worktree verificati assenti senza lettura. Nessuna integrazione o browser attivo dopo la consegna T07; revisore in sola lettura.

**Sviluppo fermo alla0063: ogni suo accesso richiede un nuovo sì esplicito.** Nessun invio, richiesta di unione o unione5b autorizzati; OK separati, sviluppo solo dopo unione. Nessuna credenziale, stash o commit di docs/input-specs/rbac-improvements/. Conservare modifiche originali operator.env.example. Integrazione/E2E mai insieme; E2E solo uv run pytest e server prova distinto dalla3000 dello sviluppo.

Resta aperto nel piano il controllo trasversale MT5B-XLOCK-1 di T13: verificare con barriera reale possibile interazione fra revoche SQL, guardia UPDATE role0067 e lock del purge. È rischio da verificare, non difetto già riprodotto; non scartarlo dalla revisione finale. Eventuale correzione in avanti, senza cambiare migrazioni approvate. Ruling16 richiede READ COMMITTED anche owner per risorse contate, da portare a ripristino/guida. Vecchie immagini che aprono il valore originale del menu richiedono rilascio coordinato; nessuna compatibilità o attivazione completa ancora attestata.

Il segreto Auth.js di prova è stato inserito dal proprietario e la presenza non vuota verificata. File privato sources/tests/e2e/.env.test escluso daGit; valore mai mostrato o generato dall’assistente. Server3001/E2E autorizzati dopo integrazioni concluse, senza altre conferme. Tutti i revisori/riesaminatori/finale usano GPT-6.1 con ragionamento alto.

Stato T08 finale:1689unità,84integrazioni più20finali,2E2E e62mirati del fix verdi; modello peer e riesame GPT-6.1/high.0068approvata e applicata solo alla prova, server3001fermato. Rapporto task-8-report.md, review task-8-review.md e task-8-r1-review.md nell’area del piano. Per ripresa usare il task9 del piano, non le azioni storiche T07 sopra.

T09 completato: nuova estensione di consenso defaultfalse e guardie fresche approvate; rapporto task-9-report.md/review task-9-review.md. Per la ripresa continuare lo stesso esecutore T10, BASE81297a7, con task-10-brief.md e task-10-context.md. Non avviare un secondo esecutore né rifare T01–T09. Ruling21 nel registro definisce l'esecutore DB export isolato e annullabile, da provare prima del servizio; il semplice end della connessione non è prova sufficiente. Le prime prove del formato sono parziali, non un'approvazione T10. Dopo implementazione serve revisione indipendente GPT-6.1/high.

Aggiornamento T10 delle15:38: prova preliminare annullamento/rollback/riuso/coda2/2 superata, log letto; servizio ora in sviluppo.0070 applicata solo alla prova dopo trial con rollback verificato. Nessuna modifica a0001–0069. Le verifiche complessive T10 e la revisione restano aperte.
