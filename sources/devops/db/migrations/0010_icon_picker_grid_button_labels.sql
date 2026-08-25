-- Final whole-branch review of the shadcn Button migration (finding H-2):
-- IconPicker.tsx:190 and :200 escaped the size="icon" aria-label type
-- constraint by using size="default" with a padding override (`className="p-2"`),
-- so they shipped icon-only with no accessible name — both were title-only
-- before this branch too. :190 already has a translated title
-- (icon_picker.no_icon, reused below as its aria-label). :200's title is the
-- raw, untranslated Lucide icon name, so it needs a new interpolated key.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"icon_picker.select_icon","namespace":"icon_picker","module":"core","description":"Accessible name for an icon-library grid button. {{name}} = the Lucide icon name","it":"Seleziona icona {{name}}","en":"Select icon {{name}}"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
