-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, §2.4–2.5, MTF-7): il confine si accende.
-- Rilasciare solo dopo che il codice del Task 8 è in produzione (§5.1).
-- Ritorno indietro: una migrazione di correzione rimette sulle tabelle coinvolte la policy
-- permissiva `using (true)` di 0002 al posto delle due di tenant (§5.3).

select app_private.protect_tenant_table(t::regclass)
from unnest(array[
  'public.role', 'public.user_role', 'public.role_permission', 'public.menu_entry',
  'public.menu_entry_tag', 'public.role_functionality', 'public.app_theme'
]) as t;

select app_private.declare_global_table('public.tenant', false, 'registro dei tenant; lo scrive la piattaforma (pezzo 5)');
select app_private.declare_global_table('public.role_type', false, 'tabella di tipo');
select app_private.declare_global_table('public.functionality_type', false, 'tabella di tipo');
select app_private.declare_global_table('public.user_status', false, 'tabella di tipo');
select app_private.declare_global_table('public.permission', false, 'catalogo dei codici dichiarati nel sorgente (0041)');
select app_private.declare_global_table('public.users', true, 'identità globale (TB-DEC-02)');
select app_private.declare_global_table('public.auth_rate_limit', true, 'limiti per IP e per account');
select app_private.declare_global_table('public.password_set_tokens', true, 'provvisoria: inviti per tenant nel pezzo 3');
select app_private.declare_global_table('public.allowed_domains', true, 'provvisoria: diventa tenant_domain nel pezzo 3');
select app_private.declare_global_table('public.app_language', true, 'provvisoria: lingue attive per tenant nel pezzo 2');
select app_private.declare_global_table('public.translation_key', true, 'provvisoria: chiavi di piattaforma dal pezzo 2');
select app_private.declare_global_table('public.translation_value', true, 'provvisoria: sovrascritture per tenant nel pezzo 2');
