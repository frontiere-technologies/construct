-- Le due intestazioni di sezione della pagina Ruoli, che ora mostra due alberi invece di uno
-- (DEC-19). Senza seme il titolo renderebbe la chiave grezza -- il difetto che la 0023 e'
-- servita a chiudere sul tooltip della tipologia.
--
-- Additiva, come ogni seme: apply_translation_seed inserisce on conflict do nothing, quindi
-- rieseguirla non cambia niente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.functionalities","namespace":"roles","module":"rbac","description":"Role detail: heading of the menu-functionalities tree, where a functionality is its own permission","it":"Funzionalità","en":"Functionalities"},
    {"key":"roles.detail.operations","namespace":"roles","module":"rbac","description":"Role detail: heading of the code-declared permissions tree","it":"Operazioni","en":"Operations"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
