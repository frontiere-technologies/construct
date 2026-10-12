-- Una cartella del menu si elimina solo vuota (richiesta del 2026-10-12). Prima la conferma diceva
-- «Eliminare "X" e tutti i suoi figli?» per qualunque voce, anche per una funzionalita' che figli non
-- puo' averne, e cancellare una cartella portava via a cascata le voci interne e le loro concessioni
-- ai ruoli. Ora deleteNavigationItem rifiuta una cartella non vuota e il cestino resta disattivato.
--
-- 1. Due chiavi nuove: il messaggio di conferma senza «e tutti i suoi figli», e il motivo accanto al
--    cestino disattivato. apply_translation_seed non riscrive mai una chiave esistente (on conflict
--    do nothing), quindi il testo nuovo nasce sotto un nome nuovo invece di correggere il vecchio.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"functionalities.tree.confirm_delete_item","namespace":"functionalities","module":"rbac","description":"Delete confirmation for a menu item. {{name}} = item name. Only empty folders and functionalities can be deleted, so nothing else goes with it","it":"Eliminare \"{{name}}\"?","en":"Delete \"{{name}}\"?"},
    {"key":"functionalities.tree.delete_not_empty_hint","namespace":"functionalities","module":"rbac","description":"Tooltip on the disabled delete button of a folder that still holds items","it":"La cartella non è vuota: sposta o elimina prima le voci che contiene","en":"This folder is not empty: move or delete its items first"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- 2. La chiave vecchia non la legge piu' nessuno: si toglie qui, come 0039 ha fatto con le altre
--    chiavi orfane. I valori in tutte le lingue se ne vanno per cascata
--    (translation_value.id_translation_key), e il trigger translation_key_bump_versions incrementa
--    dictionary_version, cosi' i client rileggono il dizionario da soli. Idempotente.
delete from translation_key where key = 'functionalities.tree.confirm_delete';
