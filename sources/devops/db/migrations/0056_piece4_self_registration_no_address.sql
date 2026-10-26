-- Multi-tenancy, pezzo 4 (specifica 2026-10-21, §3.2, MT4-DEC-9, MT4-DEC-10): la riga che la pagina
-- Impostazioni del tenant mostra al posto dell'interruttore delle registrazioni autonome quando il
-- tenant non ha un indirizzo dedicato e non è il predefinito: dall'indirizzo principale chi si
-- registra entra nel predefinito, quindi lì l'interruttore non avrebbe effetto. Solo additiva:
-- apply_translation_seed non riscrive mai una chiave esistente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"tenancy.settings.self_registration_no_address","namespace":"tenancy","module":"rbac","description":"Tenant settings page: shown instead of the self-registration switch when the tenant has no dedicated address and is not the default tenant","it":"Questo tenant non ha un indirizzo dedicato: chi si registra dall'indirizzo principale entra nel tenant predefinito, quindi qui le registrazioni autonome non hanno effetto.","en":"This tenant has no dedicated address: people who sign up on the main address join the default tenant, so self-registration has no effect here."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
