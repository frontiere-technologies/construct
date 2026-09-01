-- La pagina di atterraggio (`/` e, tramite `[...slug]`, ogni rotta protetta
-- senza pagina propria) ora mostra solo il marchio Construct centrato. Le
-- schede statistiche fittizie («12,450 utenti totali», «$45,678 di ricavi») e i
-- due paragrafi segnaposto non ci sono piu': erano numeri inventati presentati
-- come dati veri, e indicazioni d'uso rivolte a chi installava il template.
--
-- Quelle sette chiavi le leggeva soltanto components/Home.tsx. Rimosso quel
-- testo, restano seminate e non lette da nessuno: la guardia
-- sources/devops/i18n-key-inventory.test.mjs le classifica «seeded but never
-- referenced», che e' un report e non un errore, quindi nessun controllo le
-- avrebbe mai tolte di mezzo. Vanno tolte qui.
--
-- Fix-forward, non modifica di 0001_baseline.sql: una migrazione gia' applicata
-- non si tocca (README, «Migration checksums»), e riscriverla romperebbe il
-- checksum su ogni database che l'ha gia' eseguita.
--
-- La cancellazione si porta dietro i valori in tutte le lingue:
-- translation_value.id_translation_key e' `on delete cascade`. Se un
-- amministratore aveva ritradotto una di queste voci da Admin -> Traduzioni,
-- quella traduzione sparisce con la chiave: e' l'effetto voluto, la voce non ha
-- piu' un posto in cui comparire. Non serve toccare `dictionary_version`: il
-- trigger di statement translation_key_bump_versions la incrementa per ogni
-- lingua, cosi' i client rileggono il dizionario da soli.
--
-- Idempotente: rieseguirla su un database gia' ripulito cancella zero righe.
do $$
declare
  v_keys_before bigint;
  v_deleted     bigint;
begin
  select count(*) into v_keys_before from translation_key;

  delete from translation_key
   where key in (
     'home.dashboard',
     'home.total_users',
     'home.active_sessions',
     'home.revenue',
     'home.content_area',
     'home.placeholder_body',
     'home.placeholder_admin_hint'
   );
  get diagnostics v_deleted = row_count;

  raise notice 'home placeholder cleanup: % keys deleted (% before, % after)',
    v_deleted, v_keys_before, v_keys_before - v_deleted;
end $$;
