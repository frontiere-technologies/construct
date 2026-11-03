-- T09: l'esportazione richiede un'estensione distinta dell'assistenza.
-- Il default falso conserva l'ambito di tutti i consensi precedenti e delle copie dal modello.
alter table public.tenant_settings
  add column support_export_allowed boolean not null default false;

do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {
      "key": "tenancy.support.allow_export",
      "namespace": "tenancy",
      "module": "tenancy",
      "description": "Explicit export choice for the next support consent",
      "it": "Consenti anche l’esportazione dei dati",
      "en": "Also allow data export"
    },
    {
      "key": "tenancy.support.allow_export_hint",
      "namespace": "tenancy",
      "module": "tenancy",
      "description": "Scope of explicit export consent",
      "it": "La scelta vale per il prossimo consenso di assistenza. Seleziona una durata per concederlo; ogni rinnovo richiede una nuova scelta.",
      "en": "This choice applies to the next support consent. Select a duration to grant it; each renewal requires a new choice."
    },
    {
      "key": "tenancy.support.export_allowed",
      "namespace": "tenancy",
      "module": "tenancy",
      "description": "Saved support consent includes export",
      "it": "Esportazione consentita durante l’assistenza autorizzata.",
      "en": "Data export allowed during authorized support."
    },
    {
      "key": "tenancy.support.export_not_allowed",
      "namespace": "tenancy",
      "module": "tenancy",
      "description": "Saved support consent excludes export",
      "it": "Esportazione non consentita.",
      "en": "Data export not allowed."
    }
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
