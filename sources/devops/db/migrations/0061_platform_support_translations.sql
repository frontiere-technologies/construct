-- Multi-tenancy, pezzo 5a, Task 9 (specifica 2026-10-26, MT5-DEC-10, MT5-DEC-12): le due parole
-- dell'assistenza che la 0059 non aveva riservato. L'errore dell'uscita dalla fascia (se l'uscita
-- non riesce si resta nel tenant, e chi guarda deve saperlo) e la riga delle impostazioni del tenant
-- che spiega alla piattaforma in assistenza perché il permesso non si cambia da qui.
-- Solo additiva (apply_translation_seed non riscrive mai una chiave esistente).
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key": "platform.support.exit_error", "namespace": "platform", "module": "rbac", "description": "Support banner: the exit failed; the person is still working in the tenant", "it": "Non è stato possibile uscire dall'assistenza. Riprova.", "en": "Support access could not be ended. Try again."},
    {"key": "tenancy.support.locked", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page, during support: the platform sees the consent but cannot change it", "it": "Durante l'assistenza il permesso lo cambia solo un amministratore del tenant.", "en": "During support only a tenant administrator can change the consent."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
