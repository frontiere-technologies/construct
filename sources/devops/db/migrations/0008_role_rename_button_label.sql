-- The role-detail rename control was an icon-only <button> with no accessible
-- name (task-8 of the shadcn Button migration). Moving it onto the Button
-- primitive with size="icon" makes `aria-label` mandatory at the type level,
-- which surfaced that `roles.detail.rename` was never seeded.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.rename","namespace":"roles","module":"rbac","description":"Accessible name for the icon-only rename button on the role-detail page","it":"Rinomina ruolo","en":"Rename role"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
