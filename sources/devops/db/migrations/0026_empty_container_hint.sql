-- Il `title` di cortesia sull'interruttore di un contenitore senza foglie: disabilitato, quindi
-- ha bisogno di dire perche' (stessa regola della 0023 sul tooltip della tipologia).
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.empty_container_hint","namespace":"roles","module":"rbac","description":"Role detail: disabled folder switch tooltip — the container holds no functionality to grant","it":"Questa sezione non contiene funzionalità da concedere","en":"This section holds no functionality to grant"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
