-- T08: etichette delle concessioni, limiti, assegnazioni sospese e aree menu.
-- Solo aggiunte per le lingue base; nessun grant o dato tenant modificato.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
  {
    "key": "platform.policy.title",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.title",
    "it": "Concessioni e limiti",
    "en": "Features and limits"
  },
  {
    "key": "platform.policy.suspended_preserved",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.suspended_preserved",
    "it": "La sospensione conserva dati e assegnazioni dei ruoli. La riattivazione li rende nuovamente disponibili; la pulizia è una cancellazione separata e definitiva.",
    "en": "Suspension preserves data and role assignments. Restoring access makes them available again; cleanup is a separate permanent deletion."
  },
  {
    "key": "platform.policy.area_enabled",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area_enabled",
    "it": "Area concessa",
    "en": "Area allowed"
  },
  {
    "key": "platform.policy.inherit",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.inherit",
    "it": "Eredita",
    "en": "Inherit"
  },
  {
    "key": "platform.policy.allow",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.allow",
    "it": "Consenti",
    "en": "Allow"
  },
  {
    "key": "platform.policy.deny",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.deny",
    "it": "Nega",
    "en": "Deny"
  },
  {
    "key": "platform.policy.effective.allowed",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.effective.allowed",
    "it": "Consentito",
    "en": "Allowed"
  },
  {
    "key": "platform.policy.effective.denied",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.effective.denied",
    "it": "Sospeso",
    "en": "Suspended"
  },
  {
    "key": "platform.policy.source.area",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.source.area",
    "it": "Valore ereditato dall’area",
    "en": "Value inherited from area"
  },
  {
    "key": "platform.policy.source.override",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.source.override",
    "it": "Eccezione esplicita",
    "en": "Explicit override"
  },
  {
    "key": "platform.policy.limits",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.limits",
    "it": "Limiti del tenant",
    "en": "Tenant limits"
  },
  {
    "key": "platform.policy.limit_inherit",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.limit_inherit",
    "it": "Lascia vuoto per ereditare. Zero impedisce nuove risorse. Il timeout deve essere positivo e resta entro il limite della connessione.",
    "en": "Leave blank to inherit. Zero prevents new resources. The timeout must be positive and remains within the connection limit."
  },
  {
    "key": "platform.policy.limit.max_members",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.limit.maxMembers",
    "it": "Massimo appartenenze",
    "en": "Maximum memberships"
  },
  {
    "key": "platform.policy.limit.max_roles",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.limit.maxRoles",
    "it": "Massimo ruoli (inclusi quelli di sistema)",
    "en": "Maximum roles (including system roles)"
  },
  {
    "key": "platform.policy.limit.max_menu_entries",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.limit.maxMenuEntries",
    "it": "Massimo voci menu (incluse categorie)",
    "en": "Maximum menu entries (including categories)"
  },
  {
    "key": "platform.policy.limit.query_timeout_ms",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.limit.queryTimeoutMs",
    "it": "Timeout query in millisecondi",
    "en": "Query timeout in milliseconds"
  },
  {
    "key": "platform.policy.usage",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.usage",
    "it": "Uso corrente: {{count}}",
    "en": "Current usage: {{count}}"
  },
  {
    "key": "platform.policy.quota_below_usage",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.quota_below_usage",
    "it": "Il limite è inferiore all’uso corrente: i dati restano, ma non si possono aggiungere altre risorse.",
    "en": "The limit is below current usage: data is preserved, but no more resources can be added."
  },
  {
    "key": "platform.policy.dependencies",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.dependencies",
    "it": "Dipendenze mancanti: {{features}}. Consenti le letture richieste oppure sospendi le funzioni dipendenti.",
    "en": "Missing dependencies: {{features}}. Allow the required reads or suspend the dependent features."
  },
  {
    "key": "platform.policy.saved",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.saved",
    "it": "Concessioni e limiti salvati. Nessuna assegnazione eliminata.",
    "en": "Features and limits saved. No assignments deleted."
  },
  {
    "key": "platform.policy.conflict",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.conflict",
    "it": "La revisione è cambiata. Ricarica i dati prima di confermare nuovamente.",
    "en": "The revision has changed. Reload the data before confirming again."
  },
  {
    "key": "platform.policy.invalid",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.invalid",
    "it": "Controlla le concessioni, le dipendenze e i limiti inseriti.",
    "en": "Check the selected features, dependencies and limits."
  },
  {
    "key": "platform.policy.disabled",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.disabled",
    "it": "Le modifiche alle concessioni sono temporaneamente disabilitate.",
    "en": "Feature policy changes are temporarily disabled."
  },
  {
    "key": "platform.policy.error",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.error",
    "it": "Impossibile completare la modifica. Ricarica e riprova.",
    "en": "The change could not be completed. Reload and try again."
  },
  {
    "key": "platform.policy.reload",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.reload",
    "it": "Ricarica dati",
    "en": "Reload data"
  },
  {
    "key": "platform.policy.purge.selection",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.selection",
    "it": "Pulizia delle assegnazioni sospese",
    "en": "Clean up suspended assignments"
  },
  {
    "key": "platform.policy.purge.preview",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.preview",
    "it": "Calcola anteprima pulizia",
    "en": "Preview cleanup"
  },
  {
    "key": "platform.policy.purge.open",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.open",
    "it": "Rivedi cancellazione assegnazioni",
    "en": "Review assignment deletion"
  },
  {
    "key": "platform.policy.purge.title",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.title",
    "it": "Conferma cancellazione delle assegnazioni",
    "en": "Confirm assignment deletion"
  },
  {
    "key": "platform.policy.purge.warning",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.warning",
    "it": "La cancellazione elimina soltanto le assegnazioni delle funzioni sospese selezionate. Riattivare le funzioni non le ricrea. I ruoli e i dati restano.",
    "en": "Deletion removes only assignments for the selected suspended features. Restoring features will not recreate them. Roles and data are preserved."
  },
  {
    "key": "platform.policy.purge.counts",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.counts",
    "it": "Ruoli coinvolti: {{roles}}. Assegnazioni permessi: {{permissions}}. Assegnazioni menu: {{menus}}.",
    "en": "Affected roles: {{roles}}. Permission assignments: {{permissions}}. Menu assignments: {{menus}}."
  },
  {
    "key": "platform.policy.purge.confirm",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.confirm",
    "it": "Elimina le assegnazioni indicate",
    "en": "Delete the listed assignments"
  },
  {
    "key": "platform.policy.purge.refresh",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.refresh",
    "it": "Aggiorna anteprima",
    "en": "Refresh preview"
  },
  {
    "key": "platform.policy.purge.refresh_error",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.refresh_error",
    "it": "Anteprima non disponibile. Ricarica la policy e seleziona nuovamente le funzioni sospese.",
    "en": "Preview unavailable. Reload the policy and select the suspended features again."
  },
  {
    "key": "platform.policy.purge.done",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.purge.done",
    "it": "Assegnazioni eliminate. Ricarica i dati per continuare.",
    "en": "Assignments deleted. Reload the data to continue."
  },
  {
    "key": "roles.detail.suspended_badge",
    "namespace": "roles",
    "module": "platform",
    "description": "Tenant policy UI: roles.detail.suspended_badge",
    "it": "Sospesa dalla piattaforma",
    "en": "Suspended by platform"
  },
  {
    "key": "roles.detail.suspended_hint",
    "namespace": "roles",
    "module": "platform",
    "description": "Tenant policy UI: roles.detail.suspended_hint",
    "it": "Assegnazione conservata ma non efficace. Puoi revocarla; non puoi creare una nuova concessione finché la funzione è sospesa.",
    "en": "Assignment preserved but inactive. You can revoke it; new grants are unavailable while the feature is suspended."
  },
  {
    "key": "functionalities.form.area",
    "namespace": "functionalities",
    "module": "platform",
    "description": "Tenant policy UI: functionalities.form.area",
    "it": "Area di presentazione",
    "en": "Presentation area"
  },
  {
    "key": "functionalities.form.area_automatic",
    "namespace": "functionalities",
    "module": "platform",
    "description": "Tenant policy UI: functionalities.form.area_automatic",
    "it": "Automatica / nessuna",
    "en": "Automatic / none"
  },
  {
    "key": "functionalities.form.area_unavailable",
    "namespace": "functionalities",
    "module": "platform",
    "description": "Tenant policy UI: functionalities.form.area_unavailable",
    "it": "Area attuale non disponibile",
    "en": "Current area unavailable"
  },
  {
    "key": "functionalities.form.area_hint",
    "namespace": "functionalities",
    "module": "platform",
    "description": "Tenant policy UI: functionalities.form.area_hint",
    "it": "Le aree disponibili sono calcolate dal server. Per una pagina interna l’area dipende dalla destinazione; usa Automatica. Un’area storica non disponibile resta visibile e non viene sostituita automaticamente.",
    "en": "Available areas are calculated by the server. For an internal page, the destination determines the area; use Automatic. An unavailable historical area remains visible and is never silently replaced."
  },
  {
    "key": "platform.policy.area.people",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area.people",
    "it": "Persone",
    "en": "People"
  },
  {
    "key": "platform.policy.area.roles",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area.roles",
    "it": "Ruoli",
    "en": "Roles"
  },
  {
    "key": "platform.policy.area.navigation",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area.navigation",
    "it": "Menu",
    "en": "Navigation"
  },
  {
    "key": "platform.policy.area.appearance",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area.appearance",
    "it": "Aspetto",
    "en": "Appearance"
  },
  {
    "key": "platform.policy.area.catalogs",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area.catalogs",
    "it": "Cataloghi",
    "en": "Catalogs"
  },
  {
    "key": "platform.policy.area.tenant_settings",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.area.tenant-settings",
    "it": "Impostazioni tenant",
    "en": "Tenant settings"
  },
  {
    "key": "platform.policy.feature.read_users",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.read-users",
    "it": "Leggere le persone",
    "en": "Read people"
  },
  {
    "key": "platform.policy.feature.invite_users",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.invite-users",
    "it": "Invitare persone",
    "en": "Invite people"
  },
  {
    "key": "platform.policy.feature.set_user_status",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.set-user-status",
    "it": "Cambiare stato delle persone",
    "en": "Change people status"
  },
  {
    "key": "platform.policy.feature.assign_user_roles",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.assign-user-roles",
    "it": "Assegnare ruoli alle persone",
    "en": "Assign roles to people"
  },
  {
    "key": "platform.policy.feature.read_roles",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.read-roles",
    "it": "Leggere i ruoli",
    "en": "Read roles"
  },
  {
    "key": "platform.policy.feature.manage_roles",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.manage-roles",
    "it": "Gestire i ruoli",
    "en": "Manage roles"
  },
  {
    "key": "platform.policy.feature.grant_role_permissions",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.grant-role-permissions",
    "it": "Concedere permessi ai ruoli",
    "en": "Grant role permissions"
  },
  {
    "key": "platform.policy.feature.read_menu",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.read-menu",
    "it": "Leggere il menu",
    "en": "Read navigation"
  },
  {
    "key": "platform.policy.feature.manage_menu",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.manage-menu",
    "it": "Gestire il menu",
    "en": "Manage navigation"
  },
  {
    "key": "platform.policy.feature.use_custom_content",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.use-custom-content",
    "it": "Usare contenuti propri",
    "en": "Use custom content"
  },
  {
    "key": "platform.policy.feature.manage_tenant_theme",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.manage-tenant-theme",
    "it": "Gestire il tema del tenant",
    "en": "Manage tenant theme"
  },
  {
    "key": "platform.policy.feature.read_languages",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.read-languages",
    "it": "Leggere le lingue",
    "en": "Read languages"
  },
  {
    "key": "platform.policy.feature.read_translations",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.read-translations",
    "it": "Leggere le traduzioni",
    "en": "Read translations"
  },
  {
    "key": "platform.policy.feature.manage_tenant_settings",
    "namespace": "platform",
    "module": "platform",
    "description": "Tenant policy UI: platform.policy.feature.manage-tenant-settings",
    "it": "Gestire le impostazioni del tenant",
    "en": "Manage tenant settings"
  },
  {
    "key": "audit.operation.tenant.policy.save",
    "namespace": "audit",
    "module": "rbac",
    "description": "Audit operation: tenant feature policy and limits saved",
    "it": "Concessioni e limiti del tenant salvati",
    "en": "Tenant feature policy and limits saved"
  },
  {
    "key": "audit.operation.tenant.grants.purge",
    "namespace": "audit",
    "module": "rbac",
    "description": "Audit operation: suspended tenant role assignments permanently deleted",
    "it": "Assegnazioni sospese del tenant eliminate",
    "en": "Suspended tenant assignments deleted"
  }
]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
