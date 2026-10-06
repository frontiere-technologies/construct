-- Le etichette del selettore "Lingua" in Admin -> Lingue -> Nuova lingua. Definire una lingua a mano
-- (codice, locale, nome, nome nativo) era troppo complicato: il selettore propone le lingue
-- principali e riempie i quattro campi, che restano modificabili (2026-10-05). I nomi delle lingue
-- non sono chiavi di traduzione: li calcola Intl.DisplayNames nella lingua dell'interfaccia
-- (lib/i18n/language-presets.ts). Solo additiva.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"language.form.preset","namespace":"language","module":"i18n","description":"New-language modal: label of the searchable picker that fills code, locale, name and native name","it":"Lingua","en":"Language"},
    {"key":"language.form.preset_placeholder","namespace":"language","module":"i18n","description":"New-language modal: placeholder of the language picker search field","it":"Cerca una lingua…","en":"Search a language…"},
    {"key":"language.form.preset_other","namespace":"language","module":"i18n","description":"New-language modal: last picker entry, leaves the fields empty for a language not in the list","it":"Altra lingua…","en":"Other language…"},
    {"key":"language.form.preset_already_added","namespace":"language","module":"i18n","description":"New-language modal: tag next to a picker entry whose code already exists (it cannot be chosen)","it":"già presente","en":"already added"},
    {"key":"language.form.preset_no_results","namespace":"language","module":"i18n","description":"New-language modal: shown in the picker when no language matches the search","it":"Nessuna lingua trovata","en":"No language found"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
