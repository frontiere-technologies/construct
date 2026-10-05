-- L'etichetta accanto al nome di un contenitore vuoto nell'albero di Ruoli & permessi. Il motivo
-- dell'interruttore disabilitato stava solo nel `title` (0026), che si scopre passando sopra con il
-- mouse; in tema scuro l'interruttore spento si distingue poco dagli altri, e il proprietario del
-- progetto non capiva perche' non potesse selezionare la voce (2026-10-05).
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"roles.detail.empty_container_badge","namespace":"roles","module":"rbac","description":"Role detail: small label next to the name of a folder that holds no functionality to grant (its switch is disabled)","it":"vuota","en":"empty"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
