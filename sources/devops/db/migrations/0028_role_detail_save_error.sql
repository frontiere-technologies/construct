-- Il catch che RoleDetailClient non aveva: un salvataggio rifiutato (per esempio una voce
-- cancellata da un'altra sessione mentre l'albero era aperto, e la scrittura che viola la
-- chiave esterna) falliva chiuso ma in silenzio -- ogni interruttore restava a mostrare
-- "concesso" e nessuno se ne accorgeva. Il messaggio e' generico apposta: updateRolePermissions
-- non avvolge piu' gli errori del database, quindi il messaggio grezzo che arriverebbe e'
-- testo di Postgres, non leggibile da un amministratore.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.save_error","namespace":"roles","module":"rbac","description":"Role detail: generic save failure fallback shown when updateRolePermissions rejects","it":"Salvataggio non riuscito. Riprova.","en":"Save failed. Please try again."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
