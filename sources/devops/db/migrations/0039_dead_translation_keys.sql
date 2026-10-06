-- Ventiquattro chiavi di traduzione seminate e non lette da nessuno. La guardia
-- sources/devops/i18n-key-inventory.test.mjs le riportava come «seeded but never
-- referenced», che e' un report e non un errore: nessun controllo le avrebbe
-- mai tolte di mezzo. Vanno tolte qui, come 0012 ha fatto per le `home.*`.
--
-- Prima di cancellarle la guardia e' stata corretta: leggeva solo chiavi
-- scritte per intero, e le tre `functionalities.tree.dnd.over_*` che
-- components/rbac/NavigationTree.tsx compone con un template literal
-- comparivano come orfane senza esserlo. Restano, e la guardia ora le vede.
--
-- Lasciate da funzioni rimosse (la storia di git lo conferma):
--   functionalities.locale.*         i nomi delle lingue arrivano da app_language;
--                                    TranslationsAccordion.test.tsx verifica che
--                                    `functionalities.locale.en` non compaia
--   icon_picker.empty,
--   icon_picker.select_placeholder   il vecchio trigger del selettore (8cdb4b8)
--   roles.detail.tab_operations,
--   roles.detail.tab_sections        l'albero delle concessioni rifatto (5709cbd)
--   translation.filter.*_only        etichette di stato semplificate (601fc98);
--                                    translation-status-filter.test.ts verifica
--                                    che non vengano richieste
--   theme.status.unreadable          il tema si salva con un avviso invece di
--                                    essere rifiutato (b823a84)
--
-- Generiche, mai collegate a nulla:
--   common.labels.actions, common.states.no_results, common.states.saved,
--   errors.bad_request, errors.unauthorized,
--   validation.invalid_format, validation.required, validation.too_long
--
-- Resta seminata di proposito `auth.login.error_password_not_set` (I18N-2):
-- mostrarla direbbe a un attaccante che l'indirizzo esiste ed e' un invito in
-- attesa di password. La guardia la porta annotata in ANNOTATED_ORPHANS.
--
-- Fix-forward, non modifica di 0001_baseline.sql ne' delle migrazioni che
-- hanno seminato queste chiavi: una migrazione gia' applicata non si tocca
-- (README, «Migration checksums»).
--
-- La cancellazione si porta dietro i valori in tutte le lingue:
-- translation_value.id_translation_key e' `on delete cascade`. Non serve
-- toccare `dictionary_version`: il trigger di statement
-- translation_key_bump_versions la incrementa per ogni lingua, cosi' i client
-- rileggono il dizionario da soli.
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
     'common.labels.actions',
     'common.states.no_results',
     'common.states.saved',
     'errors.bad_request',
     'errors.unauthorized',
     'functionalities.locale.de',
     'functionalities.locale.en',
     'functionalities.locale.es',
     'functionalities.locale.fr',
     'functionalities.locale.it',
     'functionalities.locale.nl',
     'functionalities.locale.pt',
     'functionalities.locale.ro',
     'functionalities.locale.sk',
     'icon_picker.empty',
     'icon_picker.select_placeholder',
     'roles.detail.tab_operations',
     'roles.detail.tab_sections',
     'theme.status.unreadable',
     'translation.filter.complete_only',
     'translation.filter.missing_only',
     'validation.invalid_format',
     'validation.required',
     'validation.too_long'
   );
  get diagnostics v_deleted = row_count;

  raise notice 'dead translation keys cleanup: % keys deleted (% before, % after)',
    v_deleted, v_keys_before, v_keys_before - v_deleted;
end $$;
