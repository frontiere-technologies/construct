-- Multi-tenancy, pezzo 5a (specifica 2026-10-26, §3.3, §3.4, MT5-DEC-3, MT5-DEC-4, MT5-DEC-2,
-- MT5-OK-2): tutte le parole dell'interfaccia del pezzo (console, elenco dei tenant, amministratori
-- di piattaforma, scheda del tenant, assistenza, fascia, registro, messaggio del tenant sospeso),
-- e la funzione che conta le persone e gli amministratori di ogni tenant per l'elenco della
-- console. Le parole dei Task 8, 9 e 10 stanno qui perché una migrazione sola le semina tutte:
-- chi le usa dopo le trova già, e una chiave nuova che serva davvero va in una migrazione propria.
-- Gira come construct_owner, con app.tenant_id vuoto: la funzione della sezione 2 lo cambia solo
-- mentre gira e lo rimette com'era prima di uscire.

-- 1. Le chiavi di traduzione ---------------------------------------------------------------------
-- Solo additiva: apply_translation_seed non riscrive mai una chiave esistente. I segnaposto sono
-- {{nome}}, la forma di lib/i18n/interpolate. «Esci» e «Riprova» altrove riusano chiavi esistenti.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key": "platform.nav.section", "namespace": "platform", "module": "rbac", "description": "Sidebar: the platform console section, and the entry that leads to it from a tenant", "it": "Piattaforma", "en": "Platform"},
    {"key": "platform.nav.tenants", "namespace": "platform", "module": "rbac", "description": "Console sidebar: the tenant list", "it": "Tenant", "en": "Tenants"},
    {"key": "platform.nav.admins", "namespace": "platform", "module": "rbac", "description": "Console sidebar: the platform administrators page", "it": "Amministratori", "en": "Administrators"},
    {"key": "platform.nav.audit", "namespace": "platform", "module": "rbac", "description": "Console sidebar: the platform audit log", "it": "Registro", "en": "Audit log"},
    {"key": "platform.nav.languages", "namespace": "platform", "module": "rbac", "description": "Console sidebar: the languages catalog", "it": "Lingue", "en": "Languages"},
    {"key": "platform.nav.translations", "namespace": "platform", "module": "rbac", "description": "Console sidebar: the translations catalog", "it": "Traduzioni", "en": "Translations"},
    {"key": "platform.nav.back_to_tenant", "namespace": "platform", "module": "rbac", "description": "Console sidebar: link back to the tenant the person belongs to on this address", "it": "Torna al tenant", "en": "Back to the tenant"},
    {"key": "platform.tenants.title", "namespace": "platform", "module": "rbac", "description": "Console tenant list: page title", "it": "Tenant", "en": "Tenants"},
    {"key": "platform.tenants.subtitle", "namespace": "platform", "module": "rbac", "description": "Console tenant list: page subtitle", "it": "Tutti i tenant della piattaforma. Gli archiviati si vedono solo con il filtro Stato.", "en": "Every tenant on the platform. Archived ones show only with the Status filter."},
    {"key": "platform.tenants.name", "namespace": "platform", "module": "rbac", "description": "Console tenant list: name column", "it": "Nome", "en": "Name"},
    {"key": "platform.tenants.slug", "namespace": "platform", "module": "rbac", "description": "Console tenant list: slug column", "it": "Slug", "en": "Slug"},
    {"key": "platform.tenants.host", "namespace": "platform", "module": "rbac", "description": "Console tenant list: primary host column", "it": "Indirizzo principale", "en": "Primary address"},
    {"key": "platform.tenants.status", "namespace": "platform", "module": "rbac", "description": "Console tenant list: status column", "it": "Stato", "en": "Status"},
    {"key": "platform.tenants.members", "namespace": "platform", "module": "rbac", "description": "Console tenant list: number of active members column", "it": "Persone attive", "en": "Active people"},
    {"key": "platform.tenants.admins", "namespace": "platform", "module": "rbac", "description": "Console tenant list: tenant administrators column (their emails)", "it": "Amministratori", "en": "Administrators"},
    {"key": "platform.tenants.created_at", "namespace": "platform", "module": "rbac", "description": "Console tenant list: creation date column", "it": "Creato", "en": "Created"},
    {"key": "platform.tenants.template_badge", "namespace": "platform", "module": "rbac", "description": "Console tenant list: badge that marks the template tenant", "it": "Modello", "en": "Template"},
    {"key": "platform.tenants.status.active", "namespace": "platform", "module": "rbac", "description": "Tenant status badge and filter option: active", "it": "Attivo", "en": "Active"},
    {"key": "platform.tenants.status.suspended", "namespace": "platform", "module": "rbac", "description": "Tenant status badge and filter option: suspended", "it": "Sospeso", "en": "Suspended"},
    {"key": "platform.tenants.status.archived", "namespace": "platform", "module": "rbac", "description": "Tenant status badge and filter option: archived", "it": "Archiviato", "en": "Archived"},
    {"key": "platform.tenants.new", "namespace": "platform", "module": "rbac", "description": "Console tenant list: button that opens the new-tenant dialog", "it": "Nuovo tenant", "en": "New tenant"},
    {"key": "platform.admins.title", "namespace": "platform", "module": "rbac", "description": "Platform administrators page: title", "it": "Amministratori di piattaforma", "en": "Platform administrators"},
    {"key": "platform.admins.subtitle", "namespace": "platform", "module": "rbac", "description": "Platform administrators page: subtitle", "it": "Chi può usare la console. Non è un ruolo di tenant e non dà accesso ai dati dei tenant.", "en": "Who can use the console. It is not a tenant role and gives no access to tenant data."},
    {"key": "platform.admins.email", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: email column", "it": "Email", "en": "Email"},
    {"key": "platform.admins.name", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: name column", "it": "Nome", "en": "Name"},
    {"key": "platform.admins.status", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: account status column", "it": "Stato", "en": "Status"},
    {"key": "platform.admins.you", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: marks the row of the signed-in person", "it": "Tu", "en": "You"},
    {"key": "platform.admins.empty", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: empty state", "it": "Nessun amministratore di piattaforma.", "en": "No platform administrators."},
    {"key": "platform.admins.add.open", "namespace": "platform", "module": "rbac", "description": "Platform administrators page: button that opens the add dialog", "it": "Aggiungi amministratore", "en": "Add administrator"},
    {"key": "platform.admins.add.title", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: title", "it": "Aggiungi un amministratore di piattaforma", "en": "Add a platform administrator"},
    {"key": "platform.admins.add.email_label", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: label of the email field", "it": "Email", "en": "Email"},
    {"key": "platform.admins.add.submit", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: button that adds the administrator", "it": "Aggiungi", "en": "Add"},
    {"key": "platform.admins.add.done", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: outcome after a successful add for an account that can already sign in", "it": "Amministratore aggiunto.", "en": "Administrator added."},
    {"key": "platform.admins.add.done_invited", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: outcome after a successful add for a new account, which gets an invitation email", "it": "Amministratore aggiunto. Riceverà un'email per impostare la password.", "en": "Administrator added. They will receive an email to set their password."},
    {"key": "platform.admins.add.invalid_email", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: shown when the text is not a valid email address", "it": "Scrivi un indirizzo email valido.", "en": "Enter a valid email address."},
    {"key": "platform.admins.add.error", "namespace": "platform", "module": "rbac", "description": "Add-administrator dialog: generic failure. The server message is never shown", "it": "Non è stato possibile aggiungere l'amministratore.", "en": "The administrator could not be added."},
    {"key": "platform.admins.remove.action", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: row button that removes the administrator attribute", "it": "Togli", "en": "Remove"},
    {"key": "platform.admins.remove.title", "namespace": "platform", "module": "rbac", "description": "Remove-administrator confirmation: title", "it": "Togliere l'amministratore?", "en": "Remove the administrator?"},
    {"key": "platform.admins.remove.message", "namespace": "platform", "module": "rbac", "description": "Remove-administrator confirmation: message. {{email}} is the account email", "it": "{{email}} non potrà più usare la console della piattaforma.", "en": "{{email}} will no longer be able to use the platform console."},
    {"key": "platform.admins.remove.confirm", "namespace": "platform", "module": "rbac", "description": "Remove-administrator confirmation: confirm button", "it": "Togli", "en": "Remove"},
    {"key": "platform.admins.remove.error", "namespace": "platform", "module": "rbac", "description": "Remove-administrator confirmation: generic failure. The server message is never shown", "it": "Non è stato possibile togliere l'amministratore. Non si può togliere l'ultimo amministratore attivo.", "en": "The administrator could not be removed. The last active administrator cannot be removed."},
    {"key": "platform.admins.remove.last_hint", "namespace": "platform", "module": "rbac", "description": "Platform administrators grid: tooltip on the disabled remove button of the last active administrator", "it": "Non si può togliere l'ultimo amministratore attivo.", "en": "The last active administrator cannot be removed."},
    {"key": "platform.tenant.new.title", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: title", "it": "Nuovo tenant", "en": "New tenant"},
    {"key": "platform.tenant.new.name", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: label of the name field", "it": "Nome", "en": "Name"},
    {"key": "platform.tenant.new.slug", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: label of the slug field", "it": "Slug", "en": "Slug"},
    {"key": "platform.tenant.new.slug_hint", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: hint under the slug field", "it": "Lettere minuscole, cifre e trattini. Si propone dal nome.", "en": "Lowercase letters, digits and hyphens. Suggested from the name."},
    {"key": "platform.tenant.new.host", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: label of the optional dedicated host field", "it": "Indirizzo dedicato (facoltativo)", "en": "Dedicated address (optional)"},
    {"key": "platform.tenant.new.host_hint", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: hint under the host field", "it": "Senza indirizzo il tenant risponde sull'indirizzo principale.", "en": "Without an address the tenant answers on the main address."},
    {"key": "platform.tenant.new.admin_email", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: label of the first administrator email field", "it": "Email del primo amministratore", "en": "First administrator email"},
    {"key": "platform.tenant.new.submit", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: button that creates the tenant", "it": "Crea tenant", "en": "Create tenant"},
    {"key": "platform.tenant.new.done_invited", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: outcome when the first administrator is a new account", "it": "Tenant creato. Il primo amministratore riceve l'email d'invito.", "en": "Tenant created. The first administrator receives the invitation email."},
    {"key": "platform.tenant.new.done_existing", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: outcome when the first administrator already has a password (no email)", "it": "Tenant creato. L'account esiste già con una password: può entrare subito.", "en": "Tenant created. The account already has a password: they can sign in right away."},
    {"key": "platform.tenant.new.error", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: generic failure. The server message is never shown", "it": "Non è stato possibile creare il tenant.", "en": "The tenant could not be created."},
    {"key": "platform.tenant.new.error_taken", "namespace": "platform", "module": "rbac", "description": "New-tenant dialog: the slug or the dedicated address belongs to another tenant", "it": "Slug o indirizzo già in uso.", "en": "Slug or address already in use."},
    {"key": "platform.tenant.detail.data", "namespace": "platform", "module": "rbac", "description": "Tenant page: section with name, slug and status", "it": "Dati", "en": "Details"},
    {"key": "platform.tenant.detail.hosts", "namespace": "platform", "module": "rbac", "description": "Tenant page: section with the dedicated addresses", "it": "Indirizzi", "en": "Addresses"},
    {"key": "platform.tenant.detail.admins", "namespace": "platform", "module": "rbac", "description": "Tenant page: section with the tenant administrators", "it": "Amministratori", "en": "Administrators"},
    {"key": "platform.tenant.detail.support", "namespace": "platform", "module": "rbac", "description": "Tenant page: section with the support consent and the button that enters the tenant", "it": "Assistenza", "en": "Support"},
    {"key": "platform.tenant.detail.events", "namespace": "platform", "module": "rbac", "description": "Tenant page: section with the platform audit rows about this tenant", "it": "Eventi della piattaforma", "en": "Platform events"},
    {"key": "platform.tenant.detail.events_empty", "namespace": "platform", "module": "rbac", "description": "Tenant page: empty list of platform events", "it": "Nessun evento.", "en": "No events."},
    {"key": "platform.tenant.detail.inactive_hint", "namespace": "platform", "module": "rbac", "description": "Tenant page: why the administrator actions are disabled", "it": "Il tenant è sospeso o archiviato: non si aggiungono amministratori né si rimandano inviti.", "en": "The tenant is suspended or archived: administrators cannot be added and invitations cannot be resent."},
    {"key": "platform.tenant.host.add", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that adds a dedicated address", "it": "Aggiungi indirizzo", "en": "Add address"},
    {"key": "platform.tenant.host.label", "namespace": "platform", "module": "rbac", "description": "Tenant page: label of the address field", "it": "Indirizzo", "en": "Address"},
    {"key": "platform.tenant.host.primary", "namespace": "platform", "module": "rbac", "description": "Tenant page: badge on the primary address", "it": "Principale", "en": "Primary"},
    {"key": "platform.tenant.host.make_primary", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that makes an address the primary one", "it": "Rendi principale", "en": "Make primary"},
    {"key": "platform.tenant.host.remove", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that removes an address", "it": "Togli", "en": "Remove"},
    {"key": "platform.tenant.host.empty", "namespace": "platform", "module": "rbac", "description": "Tenant page: empty list of addresses", "it": "Nessun indirizzo dedicato: il tenant risponde sull'indirizzo principale.", "en": "No dedicated address: the tenant answers on the main address."},
    {"key": "platform.tenant.admin.add", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that adds a tenant administrator by email", "it": "Aggiungi amministratore", "en": "Add administrator"},
    {"key": "platform.tenant.admin.resend", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that resends the invitation email to an administrator", "it": "Rimanda l'invito", "en": "Resend invitation"},
    {"key": "platform.tenant.admin.done", "namespace": "platform", "module": "rbac", "description": "Tenant page: neutral confirmation after an administrator action", "it": "Fatto.", "en": "Done."},
    {"key": "platform.tenant.admin.error", "namespace": "platform", "module": "rbac", "description": "Tenant page: generic failure of an administrator action", "it": "Non è stato possibile completare l'operazione.", "en": "The operation could not be completed."},
    {"key": "platform.tenant.status.suspend", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that suspends the tenant", "it": "Sospendi", "en": "Suspend"},
    {"key": "platform.tenant.status.reactivate", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that reactivates a suspended tenant", "it": "Riattiva", "en": "Reactivate"},
    {"key": "platform.tenant.status.archive", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that archives the tenant", "it": "Archivia", "en": "Archive"},
    {"key": "platform.tenant.status.restore", "namespace": "platform", "module": "rbac", "description": "Tenant page: button that restores an archived tenant", "it": "Ripristina", "en": "Restore"},
    {"key": "platform.tenant.status.suspend_title", "namespace": "platform", "module": "rbac", "description": "Suspend confirmation: title", "it": "Sospendere il tenant?", "en": "Suspend the tenant?"},
    {"key": "platform.tenant.status.suspend_message", "namespace": "platform", "module": "rbac", "description": "Suspend confirmation: message. {{name}} is the tenant name", "it": "Chi lavora in {{name}} ne esce alla richiesta successiva. I dati restano intatti.", "en": "People working in {{name}} are signed out of it at their next request. The data stays intact."},
    {"key": "platform.tenant.status.reactivate_title", "namespace": "platform", "module": "rbac", "description": "Reactivate confirmation: title", "it": "Riattivare il tenant?", "en": "Reactivate the tenant?"},
    {"key": "platform.tenant.status.reactivate_message", "namespace": "platform", "module": "rbac", "description": "Reactivate confirmation: message. {{name}} is the tenant name", "it": "{{name}} torna disponibile per le sue persone.", "en": "{{name}} becomes available to its people again."},
    {"key": "platform.tenant.status.archive_title", "namespace": "platform", "module": "rbac", "description": "Archive confirmation: title", "it": "Archiviare il tenant?", "en": "Archive the tenant?"},
    {"key": "platform.tenant.status.archive_message", "namespace": "platform", "module": "rbac", "description": "Archive confirmation: message. {{name}} is the tenant name", "it": "{{name}} sparisce dall'elenco principale e per le persone vale quanto vale per un tenant sospeso. Scrivi il motivo: finisce nel registro.", "en": "{{name}} leaves the main list, and for its people it behaves like a suspended tenant. Write the reason: it goes in the audit log."},
    {"key": "platform.tenant.status.restore_title", "namespace": "platform", "module": "rbac", "description": "Restore confirmation: title", "it": "Ripristinare il tenant?", "en": "Restore the tenant?"},
    {"key": "platform.tenant.status.restore_message", "namespace": "platform", "module": "rbac", "description": "Restore confirmation: message. {{name}} is the tenant name", "it": "{{name}} esce dall'archivio e torna attivo.", "en": "{{name}} leaves the archive and becomes active again."},
    {"key": "platform.tenant.status.reason", "namespace": "platform", "module": "rbac", "description": "Archive and support-entry dialogs: label of the reason field", "it": "Motivo", "en": "Reason"},
    {"key": "platform.tenant.status.reason_required", "namespace": "platform", "module": "rbac", "description": "Archive and support-entry dialogs: shown when the reason is empty", "it": "Il motivo è obbligatorio.", "en": "The reason is required."},
    {"key": "platform.tenant.status.error", "namespace": "platform", "module": "rbac", "description": "Tenant page: generic failure of a status change", "it": "Non è stato possibile cambiare lo stato.", "en": "The status could not be changed."},
    {"key": "platform.support.none", "namespace": "platform", "module": "rbac", "description": "Tenant page, support section: the tenant has not granted support access", "it": "Nessun permesso di assistenza.", "en": "No support consent."},
    {"key": "platform.support.until", "namespace": "platform", "module": "rbac", "description": "Tenant page, support section: the tenant granted support access. {{time}} is the expiry", "it": "Permesso valido fino alle {{time}}.", "en": "Consent valid until {{time}}."},
    {"key": "platform.support.template", "namespace": "platform", "module": "rbac", "description": "Tenant page, support section: note on the template tenant", "it": "Il modello si apre sempre, senza permesso.", "en": "The template can always be entered, without consent."},
    {"key": "platform.support.enter", "namespace": "platform", "module": "rbac", "description": "Tenant page, support section: button that starts support access", "it": "Entra come piattaforma", "en": "Enter as platform"},
    {"key": "platform.support.enter_title", "namespace": "platform", "module": "rbac", "description": "Support-entry dialog: title", "it": "Entra come piattaforma", "en": "Enter as platform"},
    {"key": "platform.support.enter_submit", "namespace": "platform", "module": "rbac", "description": "Support-entry dialog: button that starts support access", "it": "Entra", "en": "Enter"},
    {"key": "platform.support.enter_error", "namespace": "platform", "module": "rbac", "description": "Support-entry dialog: generic failure", "it": "Non è stato possibile entrare.", "en": "Support access could not be started."},
    {"key": "platform.support.disabled_hint", "namespace": "platform", "module": "rbac", "description": "Tenant page, support section: why the enter button is disabled", "it": "Serve il permesso del tenant, e il tenant deve essere attivo.", "en": "The tenant must grant consent, and the tenant must be active."},
    {"key": "platform.support.banner", "namespace": "platform", "module": "rbac", "description": "Support banner: always visible during support access. {{tenant}} is the tenant name, {{time}} the expiry", "it": "Stai lavorando come piattaforma in {{tenant}}, fino alle {{time}}.", "en": "You are working as the platform in {{tenant}}, until {{time}}."},
    {"key": "platform.support.banner_no_end", "namespace": "platform", "module": "rbac", "description": "Support banner for the template tenant, which has no expiry. {{tenant}} is the tenant name", "it": "Stai lavorando come piattaforma in {{tenant}}.", "en": "You are working as the platform in {{tenant}}."},
    {"key": "platform.support.exit", "namespace": "platform", "module": "rbac", "description": "Support banner: button that ends support access and returns to the console", "it": "Esci", "en": "Exit"},
    {"key": "tenancy.suspended.message", "namespace": "tenancy", "module": "rbac", "description": "Page shown to a person whose only tenant on the address is suspended or archived", "it": "Questo spazio è sospeso. Contatta il tuo amministratore.", "en": "This space is suspended. Contact your administrator."},
    {"key": "tenancy.support.title", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: title of the support section", "it": "Assistenza alla piattaforma", "en": "Platform support"},
    {"key": "tenancy.support.grant", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: label of the support consent control", "it": "Consenti assistenza alla piattaforma", "en": "Allow platform support"},
    {"key": "tenancy.support.grant_hint", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: explanation under the support consent control", "it": "Per il tempo scelto, la piattaforma può entrare nel tenant con i permessi di un amministratore. Ogni modifica finisce nel registro.", "en": "For the chosen time, the platform can enter the tenant with an administrator's permissions. Every change goes in the audit log."},
    {"key": "tenancy.support.duration", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: label of the consent duration choice", "it": "Durata", "en": "Duration"},
    {"key": "tenancy.support.duration.1h", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: consent duration option", "it": "1 ora", "en": "1 hour"},
    {"key": "tenancy.support.duration.1d", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: consent duration option", "it": "1 giorno", "en": "1 day"},
    {"key": "tenancy.support.duration.1w", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: consent duration option", "it": "1 settimana", "en": "1 week"},
    {"key": "tenancy.support.granted_until", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: the consent is valid. {{time}} is the expiry", "it": "Assistenza consentita fino alle {{time}}.", "en": "Support allowed until {{time}}."},
    {"key": "tenancy.support.not_granted", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: no valid consent", "it": "L'assistenza non è consentita.", "en": "Support is not allowed."},
    {"key": "tenancy.support.revoke", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: button that revokes the support consent", "it": "Revoca", "en": "Revoke"},
    {"key": "tenancy.support.in_progress", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: the platform is working in the tenant right now", "it": "C'è un'assistenza in corso.", "en": "A support session is in progress."},
    {"key": "tenancy.support.error", "namespace": "tenancy", "module": "rbac", "description": "Tenant settings page: generic failure of a consent change", "it": "Non è stato possibile salvare il permesso.", "en": "The consent could not be saved."},
    {"key": "audit.title", "namespace": "audit", "module": "rbac", "description": "Tenant audit page: title", "it": "Registro", "en": "Audit log"},
    {"key": "audit.subtitle", "namespace": "audit", "module": "rbac", "description": "Tenant audit page: subtitle", "it": "Le modifiche fatte in questo tenant, comprese quelle della piattaforma in assistenza.", "en": "The changes made in this tenant, including the platform's during support."},
    {"key": "platform.audit.title", "namespace": "platform", "module": "rbac", "description": "Console audit page: title", "it": "Registro della piattaforma", "en": "Platform audit log"},
    {"key": "platform.audit.subtitle", "namespace": "platform", "module": "rbac", "description": "Console audit page: subtitle", "it": "Gli eventi della piattaforma. Non mostra cosa fanno le persone dentro i tenant.", "en": "Platform events. It does not show what people do inside tenants."},
    {"key": "audit.col.time", "namespace": "audit", "module": "rbac", "description": "Audit grid: time column", "it": "Quando", "en": "When"},
    {"key": "audit.col.actor", "namespace": "audit", "module": "rbac", "description": "Audit grid: actor column", "it": "Chi", "en": "Who"},
    {"key": "audit.col.kind", "namespace": "audit", "module": "rbac", "description": "Audit grid: capacity column (person, platform, command)", "it": "Veste", "en": "Capacity"},
    {"key": "audit.col.operation", "namespace": "audit", "module": "rbac", "description": "Audit grid: operation column", "it": "Operazione", "en": "Operation"},
    {"key": "audit.col.object", "namespace": "audit", "module": "rbac", "description": "Audit grid: object column", "it": "Oggetto", "en": "Object"},
    {"key": "audit.col.details", "namespace": "audit", "module": "rbac", "description": "Audit grid: details column", "it": "Dettagli", "en": "Details"},
    {"key": "audit.col.tenant", "namespace": "audit", "module": "rbac", "description": "Platform audit grid: tenant column", "it": "Tenant", "en": "Tenant"},
    {"key": "audit.kind.person", "namespace": "audit", "module": "rbac", "description": "Audit grid: capacity of a person of the tenant", "it": "Persona", "en": "Person"},
    {"key": "audit.kind.platform", "namespace": "audit", "module": "rbac", "description": "Audit grid: capacity of the platform (console or support access)", "it": "Piattaforma", "en": "Platform"},
    {"key": "audit.kind.command", "namespace": "audit", "module": "rbac", "description": "Audit grid: capacity of a database command", "it": "Comando", "en": "Command"},
    {"key": "audit.filter.from", "namespace": "audit", "module": "rbac", "description": "Audit page: start of the period filter", "it": "Dal", "en": "From"},
    {"key": "audit.filter.to", "namespace": "audit", "module": "rbac", "description": "Audit page: end of the period filter", "it": "Al", "en": "To"},
    {"key": "audit.filter.actor", "namespace": "audit", "module": "rbac", "description": "Audit page: filter by the person who acted", "it": "Persona", "en": "Person"},
    {"key": "audit.filter.operation", "namespace": "audit", "module": "rbac", "description": "Audit page: filter by operation", "it": "Operazione", "en": "Operation"},
    {"key": "audit.empty", "namespace": "audit", "module": "rbac", "description": "Audit grid: empty state", "it": "Nessuna voce.", "en": "No entries."},
    {"key": "audit.operation.role.create", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code role.create", "it": "Ruolo creato", "en": "Role created"},
    {"key": "audit.operation.role.rename", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code role.rename", "it": "Ruolo rinominato", "en": "Role renamed"},
    {"key": "audit.operation.role.permissions", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code role.permissions", "it": "Permessi del ruolo modificati", "en": "Role permissions changed"},
    {"key": "audit.operation.role.functionalities", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code role.functionalities", "it": "Funzionalità del ruolo modificate", "en": "Role functionalities changed"},
    {"key": "audit.operation.role.delete", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code role.delete", "it": "Ruolo eliminato", "en": "Role deleted"},
    {"key": "audit.operation.menu.create", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code menu.create", "it": "Voce di menu creata", "en": "Menu entry created"},
    {"key": "audit.operation.menu.update", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code menu.update", "it": "Voce di menu modificata", "en": "Menu entry changed"},
    {"key": "audit.operation.menu.move", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code menu.move", "it": "Voce di menu spostata", "en": "Menu entry moved"},
    {"key": "audit.operation.menu.delete", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code menu.delete", "it": "Voce di menu eliminata", "en": "Menu entry deleted"},
    {"key": "audit.operation.member.add", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code member.add", "it": "Persona aggiunta", "en": "Person added"},
    {"key": "audit.operation.member.roles", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code member.roles", "it": "Ruoli della persona modificati", "en": "Person roles changed"},
    {"key": "audit.operation.member.status", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code member.status", "it": "Stato della persona modificato", "en": "Person status changed"},
    {"key": "audit.operation.member.invite", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code member.invite", "it": "Invito inviato", "en": "Invitation sent"},
    {"key": "audit.operation.member.join", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code member.join", "it": "Persona entrata nel tenant", "en": "Person joined the tenant"},
    {"key": "audit.operation.theme.save", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code theme.save", "it": "Tema salvato", "en": "Theme saved"},
    {"key": "audit.operation.settings.self_registration", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code settings.self_registration", "it": "Registrazioni autonome modificate", "en": "Self-registration changed"},
    {"key": "audit.operation.support.grant", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code support.grant", "it": "Assistenza consentita", "en": "Support allowed"},
    {"key": "audit.operation.support.revoke", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code support.revoke", "it": "Assistenza revocata", "en": "Support revoked"},
    {"key": "audit.operation.support.enter", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code support.enter", "it": "Piattaforma entrata in assistenza", "en": "Platform entered for support"},
    {"key": "audit.operation.support.exit", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code support.exit", "it": "Piattaforma uscita dall'assistenza", "en": "Platform left support"},
    {"key": "audit.operation.tenant.create", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.create", "it": "Tenant creato", "en": "Tenant created"},
    {"key": "audit.operation.tenant.status", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.status", "it": "Stato del tenant modificato", "en": "Tenant status changed"},
    {"key": "audit.operation.tenant.host.add", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.host.add", "it": "Indirizzo aggiunto", "en": "Address added"},
    {"key": "audit.operation.tenant.host.remove", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.host.remove", "it": "Indirizzo tolto", "en": "Address removed"},
    {"key": "audit.operation.tenant.host.primary", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.host.primary", "it": "Indirizzo principale cambiato", "en": "Primary address changed"},
    {"key": "audit.operation.tenant.admin.add", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.admin.add", "it": "Amministratore del tenant aggiunto", "en": "Tenant administrator added"},
    {"key": "audit.operation.tenant.invite.resend", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code tenant.invite.resend", "it": "Invito rimandato", "en": "Invitation resent"},
    {"key": "audit.operation.platform.admin.add", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code platform.admin.add", "it": "Amministratore di piattaforma aggiunto", "en": "Platform administrator added"},
    {"key": "audit.operation.platform.admin.remove", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code platform.admin.remove", "it": "Amministratore di piattaforma tolto", "en": "Platform administrator removed"},
    {"key": "audit.operation.language.create", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code language.create", "it": "Lingua creata", "en": "Language created"},
    {"key": "audit.operation.language.update", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code language.update", "it": "Lingua modificata", "en": "Language changed"},
    {"key": "audit.operation.language.active", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code language.active", "it": "Lingua attivata o disattivata", "en": "Language activated or deactivated"},
    {"key": "audit.operation.language.default", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code language.default", "it": "Lingua predefinita cambiata", "en": "Default language changed"},
    {"key": "audit.operation.language.delete", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code language.delete", "it": "Lingua eliminata", "en": "Language deleted"},
    {"key": "audit.operation.translation.key.create", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code translation.key.create", "it": "Chiave di traduzione creata", "en": "Translation key created"},
    {"key": "audit.operation.translation.key.delete", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code translation.key.delete", "it": "Chiave di traduzione eliminata", "en": "Translation key deleted"},
    {"key": "audit.operation.translation.save", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code translation.save", "it": "Traduzioni salvate", "en": "Translations saved"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

-- 2. I numeri di ogni tenant per l'elenco della console (MT5-DEC-4, MT5-OK-2) -----------------------
-- Persone attive (appartenenza attiva, account attivo) ed email degli amministratori (ruolo
-- TENANT_ADMIN, stessi requisiti di app_private.count_active_admins, 0048) dei tenant indicati.
-- Solo numeri e email degli amministratori: nessun'altra riga di tenant esce da qui. Le
-- appartenenze sono tabelle di tenant, e la RLS forzata vale anche per il proprietario: come
-- available_tenants (0054) la funzione visita i tenant uno per uno cambiando app.tenant_id e lo
-- rimette com'era prima di ogni uscita. Un errore a metà annulla la transazione, e con lei
-- l'impostazione. Non è security definer: gira coi privilegi di chi la chiama, quindi solo
-- l'identità di piattaforma (construct_owner) può chiamarla; al ruolo dell'app non è concessa.
create function app_private.platform_tenant_counts(p_tenant_ids bigint[])
returns table (id_tenant bigint, active_members bigint, admin_emails text[])
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_origine text := pg_catalog.current_setting('app.tenant_id', true);
  v_tenant bigint;
begin
  for v_tenant in
    select t.id from public.tenant t where t.id = any (p_tenant_ids) order by t.id
  loop
    perform pg_catalog.set_config('app.tenant_id', v_tenant::text, true);
    return query
      select v_tenant,
        (select count(*)
           from public.tenant_membership m
           join public.users u on u.id = m.user_id
          where m.id_tenant = v_tenant and m.status = 'active' and u.id_user_status = 2),
        coalesce((select array_agg(a.email order by a.email)
           from (select distinct u.email
                   from public.tenant_membership m
                   join public.users u on u.id = m.user_id
                   join public.user_role ur on ur.id_tenant = m.id_tenant and ur.user_id = m.user_id
                   join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
                  where m.id_tenant = v_tenant and m.status = 'active' and u.id_user_status = 2
                    and r.system_key = 'TENANT_ADMIN' and u.email is not null) a),
          '{}'::text[]);
  end loop;
  perform pg_catalog.set_config('app.tenant_id', coalesce(v_origine, ''), true);
  return;
end;
$$;
revoke all on function app_private.platform_tenant_counts(bigint[]) from public;
