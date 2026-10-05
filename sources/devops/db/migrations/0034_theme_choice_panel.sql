-- Nuova disposizione della pagina Tema & Stili (specifica del 2026-10-02, §6.1, corretta dopo la
-- prova della pagina il 2026-10-05): l'anteprima in alto, dove ogni cella si seleziona, e sotto un
-- solo pannello di scelta con i colori suggeriti per la cella selezionata.
--
-- SOLO ADDITIVA, piu' un aggiornamento di valore. Nessuna colonna nuova: dati e salvataggio sono
-- quelli della 0033.

-- 1. Le etichette del pannello di scelta e dei cinque colori suggeriti per ogni superficie.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.panel.title_surface","namespace":"theme","module":"rbac","description":"Theme admin: heading of the choice panel while a surface cell is selected. {{surface}} = surface name, {{mode}} = Light/Dark","it":"{{surface}} · {{mode}}","en":"{{surface}} · {{mode}}"},
    {"key":"theme.panel.swatches_surface","namespace":"theme","module":"rbac","description":"Theme admin: accessible name of the suggested colours of a surface. {{surface}} = surface name, {{mode}} = light/dark","it":"Scegli il colore: {{surface}}, {{mode}}","en":"Choose the colour: {{surface}}, {{mode}}"},
    {"key":"theme.panel.surface_hint","namespace":"theme","module":"rbac","description":"Theme admin: hint of the choice panel while a surface cell is selected","it":"I colori suggeriti si leggono bene con i testi. Uno personalizzato può dare un avviso al salvataggio.","en":"The suggested colours read well with the text. A custom one may raise a warning when you save."},
    {"key":"theme.panel.use_default","namespace":"theme","module":"rbac","description":"Theme admin: puts back the fixed default of the selected surface only","it":"Usa il predefinito","en":"Use the default"},
    {"key":"theme.suggestion.default","namespace":"theme","module":"rbac","description":"Theme admin: suggested surface colour, the fixed default","it":"Predefinito","en":"Default"},
    {"key":"theme.suggestion.cool","namespace":"theme","module":"rbac","description":"Theme admin: suggested surface colour, a bluish grey","it":"Grigio freddo","en":"Cool grey"},
    {"key":"theme.suggestion.warm","namespace":"theme","module":"rbac","description":"Theme admin: suggested surface colour, a beige grey","it":"Grigio caldo","en":"Warm grey"},
    {"key":"theme.suggestion.neutral","namespace":"theme","module":"rbac","description":"Theme admin: suggested surface colour, a grey with no hue","it":"Grigio neutro","en":"Neutral grey"},
    {"key":"theme.suggestion.tint","namespace":"theme","module":"rbac","description":"Theme admin: suggested surface colour, a light tint of the primary colour","it":"Tinta del colore principale","en":"Primary colour tint"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- 2. Il suggerimento sotto l'anteprima: ora si seleziona anche la cella del colore principale, non
--    solo uno sfondo. apply_translation_seed non riscrive un valore che esiste gia', quindi serve un
--    aggiornamento, come nella 0030; e solo dove il valore e' ancora quello della 0033, per non
--    sovrascrivere una correzione fatta dal pannello Traduzioni.
update translation_value tv
set value = case l.code
      when 'it' then 'Scegli una cella per cambiarne il colore.'
      else 'Choose a cell to change its colour.'
    end,
    updated_at = now()
from translation_key tk, app_language l
where tk.id_translation_key = tv.id_translation_key
  and l.id_language = tv.id_language
  and tk.key = 'theme.preview.edit_hint'
  and ((l.code = 'it' and tv.value = 'Clicca uno sfondo per cambiarne il colore.')
    or (l.code = 'en' and tv.value = 'Click a surface to change its colour.'));
