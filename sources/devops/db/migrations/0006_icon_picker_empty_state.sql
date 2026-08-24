-- FEAT-1: the icon library is a curated subset of ~157 Lucide names, and a
-- search that matches nothing used to say only "Nessun risultato". The user had
-- no way to learn either that the list is curated or that an SVG can be
-- uploaded instead, so an icon that exists in Lucide but not in the subset read
-- as an icon that does not exist at all.
--
-- Two keys for the new empty state. Additive, like every other seed:
-- apply_translation_seed inserts on conflict do nothing, so re-running it
-- changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"icon_picker.curated_hint",  "namespace":"icon_picker","module":"core","description":"Explains that the icon library is a curated subset","it":"La libreria contiene una selezione di icone per menu e amministrazione.","en":"The library holds a curated set of icons for navigation and admin."},
    {"key":"icon_picker.upload_instead","namespace":"icon_picker","module":"core","description":"Link from the empty search result to the SVG upload tab","it":"Carica un SVG","en":"Upload an SVG"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
