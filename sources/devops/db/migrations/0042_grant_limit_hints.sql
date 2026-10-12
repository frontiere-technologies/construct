-- I motivi accanto a ciò che un ruolo limitato non può concedere o assegnare (DEC-6, DEC-29 del piano
-- 2026-10-12, I3 della revisione finale). Il server rifiutava gia' la concessione e l'assegnazione, ma
-- l'interfaccia offriva la scelta lo stesso e in produzione il messaggio dell'azione non arriva: ora
-- la voce resta visibile, disabilitata, e il `title` dice perche'. Solo additiva.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"users.roles.not_assignable_hint","namespace":"users","module":"rbac","description":"Manage-roles dialog: tooltip on a role the current user cannot assign or remove, because it grants permissions or menu entries the user does not hold","it":"Non puoi assegnare né togliere questo ruolo: concede permessi o voci di menu che non hai","en":"You cannot assign or remove this role: it grants permissions or menu entries you do not have"},
    {"key":"roles.detail.not_grantable_hint","namespace":"roles","module":"rbac","description":"Role detail: tooltip on a disabled switch, because the current user can only grant permissions and menu entries they hold","it":"Puoi concedere solo permessi e voci di menu che hai anche tu","en":"You can grant only permissions and menu entries you have yourself"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
