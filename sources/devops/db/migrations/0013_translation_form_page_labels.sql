-- La modifica di una traduzione era un pannello laterale montato dallo stato
-- della griglia, e la creazione una finestra modale separata. Ora sono due
-- pagine vere, /admin/translations/create e /admin/translations/[keyId]/edit,
-- come Funzionalita' e come Ruoli & permessi: in questa applicazione le
-- finestre modali sono riservate alle azioni brevi, non all'editor principale
-- di una pagina.
--
-- Quelle due pagine hanno intestazioni che il catalogo non aveva: il titolo
-- della colonna di sinistra, e il titolo della pagina in creazione. Senza
-- semina, sources/devops/i18n-key-inventory.test.mjs fallisce e a schermo
-- l'amministratore leggerebbe la chiave al posto dell'etichetta.
--
-- Additiva, come ogni semina: apply_translation_seed inserisce on conflict do
-- nothing, quindi rieseguirla non cambia nulla.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"translation.form.general_info","namespace":"translation","module":"i18n","description":"Left-column heading on the translation key form","it":"Informazioni generali","en":"General information"},
    {"key":"translation.form.create_label","namespace":"translation","module":"i18n","description":"Page title suffix when creating a translation key","it":"Nuova chiave","en":"New key"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
