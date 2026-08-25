-- Task 10 of the shadcn Button migration (rbac/ batch) moved five icon-only
-- controls onto the Button primitive. `size="icon"` makes `aria-label`
-- mandatory at the type level, which surfaced that none of these five had a
-- seeded key yet — they had never had an accessible name to translate.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"functionalities.tree.drag_handle","namespace":"functionalities","module":"rbac","description":"Accessible name for the functionalities-tree row drag handle","it":"Trascina per riordinare","en":"Drag to reorder"},
    {"key":"common.tree.toggle_row","namespace":"common","module":"core","description":"Accessible name for a NavigationTree category row's expand/collapse toggle (shared by the functionalities tree and the role-permissions tree)","it":"Espandi/comprimi categoria","en":"Expand/collapse category"},
    {"key":"common.actions.row_actions","namespace":"common","module":"core","description":"Accessible name for the row-actions trigger button shared by every grid (GridRowActionsMenu)","it":"Azioni riga","en":"Row actions"},
    {"key":"functionalities.form.tag_remove_label","namespace":"functionalities","module":"rbac","description":"TagInput remove-tag button aria-label. {{tag}} = tag text","it":"Rimuovi tag {{tag}}","en":"Remove tag {{tag}}"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
