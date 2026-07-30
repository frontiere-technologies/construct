# Task 15 — i18n label inventory (RBAC + theme admin)

String inventory produced by Step 1 of Task 15 (`.superpowers/sdd/task-15-brief.md`). Each
row is `string → key`, ticked once the literal is replaced by a `t()` (or `fmt.date()`) call
and the key is seeded in `sources/devops/db/schema.sql`. Rows marked "(reused)" point at a
key seeded by an earlier task instead of a new one.

## components/rbac/roles/RolesTableClient.tsx

- [x] `ID` → `roles.list.id`
- [x] `Nome ruolo` → `roles.form.name`
- [x] `Utenti associati` → `roles.list.associated_users`
- [x] `Ha permessi` → `roles.list.has_permissions`
- [x] `Data di creazione` → `roles.list.created_at`
- [x] `Ultimo aggiornamento` → `roles.list.updated_at`
- [x] `Apri` → `common.actions.open` (reused)
- [x] `Rinomina` → `common.actions.rename` (reused)
- [x] `Elimina` → `common.actions.delete` (reused)
- [x] `Sì` / `No` → `common.labels.yes` / `common.labels.no` (reused)
- [x] `Nuovo ruolo` → `roles.actions.create`
- [x] `Elimina ruolo` (confirm title) → `roles.confirm.delete_title`
- [x] `Eliminare il ruolo "{{name}}"?` (confirm message) → `roles.confirm.delete_message`
- [x] `it-IT` hardcoded `fmtDate` → replaced with `fmt.date(...)` from `useI18n()` (no key; formatter, not a string)

## components/rbac/roles/CreateRoleModal.tsx

- [x] `Crea nuovo ruolo` → `roles.form.create_title`
- [x] `Per procedere con la creazione di un nuovo ruolo, inserisci il nome del ruolo desiderato` → `roles.form.create_subtitle`
- [x] `Nome ruolo` (placeholder) → `roles.form.name` (reused)
- [x] `Annulla` → `common.actions.cancel` (reused)
- [x] `Salva` → `common.actions.save` (reused)

## components/rbac/roles/RenameRoleModal.tsx

- [x] `Rinomina ruolo` → `roles.rename.title`
- [x] `Nome ruolo` (placeholder) → `roles.form.name` (reused)
- [x] `Annulla` → `common.actions.cancel` (reused)
- [x] `Salva` → `common.actions.save` (reused)

## components/rbac/roles/RoleDetailClient.tsx

- [x] `Ruoli & permessi` (breadcrumb) → `roles.list.title` (reused)
- [x] `Dettagli` → `roles.detail.title`
- [x] `{{count}} Utenti associati` (subtitle) → `roles.list.associated_users` (reused, interpolated manually)
- [x] `Sezioni` → `roles.detail.tab_sections`
- [x] `Operazioni` → `roles.detail.tab_operations`
- [x] `Annulla` → `common.actions.cancel` (reused)
- [x] `Salva` → `common.actions.save` (reused)
- [x] `I ruoli di sistema non sono modificabili` → `roles.detail.system_readonly_hint`

## app/(protected)/roles-permissions/page.tsx

- [x] `Ruoli & permessi` → `roles.list.title`

## components/rbac/users/UsersTableClient.tsx

- [x] `Utente` → `users.list.name`
- [x] `Email` → `users.list.email`
- [x] `Ruoli` → `users.list.roles`
- [x] `Stato` → `users.list.status`
- [x] `Creato` → `users.list.created_at`
- [x] `Aggiornato` → `users.list.updated_at`
- [x] `Gestisci ruoli` → `users.actions.manage_roles`
- [x] `Disattiva` → `users.actions.deactivate`
- [x] `Attiva` → `users.actions.activate`
- [x] `Attivo` → `users.status.active`
- [x] `Disattivato` → `users.status.deactivated`
- [x] `Disattivare {{email}}?` → `users.confirm.deactivate`
- [x] `Attivare {{email}}?` → `users.confirm.activate`
- [x] `Errore` (catch fallback) → `errors.generic` (reused)
- [x] `new Date(...).toLocaleDateString()` (no-arg, browser-locale) → replaced with `fmt.date(...)` (no key; formatter, not a string)

## components/rbac/users/StatusBadge.tsx

- [x] `Attivo` → `users.status.active` (reused)
- [x] `Disattivato` → `users.status.deactivated` (reused)

## components/rbac/users/ManageRolesModal.tsx

- [x] `Gestisci ruoli — {{name}}` (modal title) → `users.actions.manage_roles` (reused, interpolated manually)
- [x] `Ruoli` (field label) → `users.list.roles` (reused)
- [x] `sempre assegnato` → `users.roles.always_assigned`
- [x] `Errore durante il salvataggio` → `users.roles.save_error`
- [x] `Annulla` → `common.actions.cancel` (reused)
- [x] `Salva` → `common.actions.save` (reused)

## components/rbac/users/RoleMultiSelect.tsx

- [x] `Rimuovi {{name}}` (aria-label) → `users.roles.remove_label`
- [x] `Cerca un ruolo…` (placeholder) → `users.roles.search_placeholder`
- [x] `Nessun ruolo trovato` → `users.roles.no_results`

## app/(protected)/user-management/page.tsx

- [x] `Utenti` → `users.list.title`

## components/rbac/functionalities/FunctionalitiesTreeClient.tsx

- [x] `Funzionalità` → `functionalities.list.title`
- [x] `Filtri` (button text) → `common.labels.filters` (reused)
- [x] `Cerca` (label + placeholder) → `common.actions.search` (reused)
- [x] `Rimuovi filtri` (aria-label) → `functionalities.list.clear_filters_label`
- [x] `Crea nuovo` → `functionalities.actions.create`
- [x] `Aggiungi sotto-elemento` (title) → `functionalities.tree.add_child`
- [x] `Modifica` (title) → `common.actions.edit` (reused)
- [x] `Elimina` (title) → `common.actions.delete` (reused)
- [x] `Eliminare "{{name}}" e tutti i suoi figli?` (native confirm) → `functionalities.tree.confirm_delete`
- [x] `Move failed` (alert fallback) → `functionalities.tree.move_failed`
- [x] `Delete failed` (alert fallback) → `functionalities.tree.delete_failed`

## components/rbac/functionalities/FunctionalityForm.tsx

- [x] `Funzionalità / Crea` / `Funzionalità / Modifica` (title) → `functionalities.list.title` (reused) + `functionalities.form.create_label` / `common.actions.edit` (reused)
- [x] `Informazioni generali` → `functionalities.form.general_info`
- [x] `Nome funzionalità *` (placeholder) → `functionalities.form.name_placeholder`
- [x] `Descrizione *` (placeholder) → `functionalities.form.description_placeholder`
- [x] `Genitore` (placeholder) → `functionalities.form.parent_placeholder`
- [x] `Nessuna categoria disponibile: verrà creato alla radice` (title hint) → `functionalities.form.parent_locked_create_hint`
- [x] `Nessuna categoria disponibile come genitore` (title hint) → `functionalities.form.parent_locked_edit_hint`
- [x] `Tipologia` (heading) → `functionalities.form.type_heading`
- [x] `Tipologia *` (placeholder) → `functionalities.form.type_placeholder`
- [x] `Link *` (placeholder) → `functionalities.form.link_placeholder`
- [x] `Apri in una nuova scheda` → `functionalities.form.open_new_tab`
- [x] `Gestione traduzioni` (heading) → `functionalities.form.translations_heading`
- [x] `Annulla` → `common.actions.cancel` (reused)
- [x] `Salva` → `common.actions.save` (reused)
- [x] `ID funzionalità mancante` → `functionalities.form.missing_id_error`
- [x] `Errore durante il salvataggio. Riprova.` → `functionalities.form.save_error`
- [x] `Category` (item-type option label) → `functionalities.item_type.category`
- [x] `Link esterno embedded (iframe)` (item-type option label) → `functionalities.item_type.embedded`
- [x] `Link esterno (http[s])` (item-type option label) → `functionalities.item_type.external`
- [x] `Link interno (/path)` (item-type option label) → `functionalities.item_type.internal`

Note: `lib/rbac/item-type-options.ts` (`ITEM_TYPES`) keeps its hardcoded `.label` values as
a stable, language-independent `key`-to-default-label fallback; `FunctionalityForm.tsx` maps
each `key` to a translated label via `t()` at render time instead (see report for rationale —
not in the brief's file list, so left untouched rather than threading `t` into a plain `lib`
module).

## components/rbac/functionalities/TranslationsAccordion.tsx

- [x] `Inglese` / `Italiano` / `Tedesco` / `Francese` / `Spagnolo` / `Olandese` / `Portoghese` / `Slovacco` / `Rumeno` (content-language names, `LABELS` map) → `functionalities.locale.en` / `.it` / `.de` / `.fr` / `.es` / `.nl` / `.pt` / `.sk` / `.ro`
- [x] `Nome funzionalità` (placeholder, no asterisk) → `functionalities.form.name_placeholder_optional`
- [x] `Descrizione` (placeholder, no asterisk) → `functionalities.form.description_placeholder_optional`

## components/rbac/functionalities/TagInput.tsx

- [x] `Inserisci un tag e premi invio` (default placeholder) → `functionalities.form.tag_placeholder`

## components/rbac/functionalities/IconPicker.tsx

- [x] `Icona selezionata: {{value}}` / `Seleziona icona` (aria-label) → `functionalities.icon.selected_label` / `functionalities.icon.select_label`
- [x] `SVG personalizzato` → `functionalities.icon.custom_svg`
- [x] `Icona` (label under the trigger) → `functionalities.icon.label`
- [x] `Rimuovi icona` (aria-label) → `functionalities.icon.remove_label`
- [x] `Libreria` / `Carica SVG` (tabs) → `functionalities.icon.tab_library` / `functionalities.icon.tab_upload`
- [x] `Cerca icone…` (placeholder) → `icon_picker.search_placeholder` (reused)
- [x] `Nessuna icona` (title on the "none" option) → `icon_picker.no_icon` (reused)
- [x] `Nessun risultato` (empty search results) → `common.states.no_results` (reused)
- [x] `Solo file SVG` (upload error) → `functionalities.icon.svg_only_error`
- [x] `Trascina o` / `scegli il file` (upload hint) → `functionalities.icon.drop_prefix` / `functionalities.icon.choose_file`
- [x] `Formato: SVG` → `functionalities.icon.format_hint`
- [x] `Requisiti SVG` (heading) → `functionalities.icon.requirements_heading`
- [x] `Dimensioni: ` / ` (24×24 px)` → `functionalities.icon.req_dimensions_prefix` / `.req_dimensions_suffix`
- [x] `Colori: usa ` / `, evita valori hardcoded` → `functionalities.icon.req_colors_prefix` / `.req_colors_suffix`
- [x] `Stroke: ` / `, stile outline` → `functionalities.icon.req_stroke_prefix` / `.req_stroke_suffix`
- [x] `Nessun elemento ` / ` o stile esterno` → `functionalities.icon.req_no_script_prefix` / `.req_no_script_suffix`

## components/AdminTheme.tsx

- [x] `Theme & Styles` → `theme.page.title`
- [x] `Customize your application appearance` → `theme.page.subtitle`
- [x] `Global` → `theme.section.global`
- [x] `Primary Color (Active Icons, Buttons)` → `theme.field.primary_color`
- [x] `Sfondi` → `theme.section.backgrounds`
- [x] `Page Background` → `theme.field.page_background`
- [x] `Surface` → `theme.field.surface`
- [x] `Surface Overlay` → `theme.field.surface_overlay`
- [x] `Surface Hover` → `theme.field.surface_hover`
- [x] `Border` (group title) → `theme.section.border`
- [x] `Border` (row label) → `theme.field.border`
- [x] `Border Subtle` → `theme.field.border_subtle`
- [x] `Testo` → `theme.section.text`
- [x] `Foreground` → `theme.field.foreground`
- [x] `Foreground Secondary` → `theme.field.foreground_secondary`
- [x] `Foreground Muted` → `theme.field.foreground_muted`
- [x] `Foreground Faint` → `theme.field.foreground_faint`
- [x] `Sidebar & Active Item` → `theme.section.sidebar`
- [x] `Sidebar Background` → `theme.field.sidebar_bg`
- [x] `Sidebar Text` → `theme.field.sidebar_text`
- [x] `Active Item Background` → `theme.field.active_item_bg`
- [x] `Active Item Text` → `theme.field.active_item_text`
- [x] `Light` → `theme.token.light`
- [x] `Dark` → `theme.token.dark`
- [x] `ℹ️ Ricordati di salvare i valori, altrimenti verranno persi alla chiusura dell'applicazione.` → `theme.banner.unsaved_hint`
- [x] `Theme saved.` → `theme.status.saved`
- [x] `Save failed. Please try again.` → `theme.status.save_failed`
- [x] `Saving…` → `theme.status.saving`
- [x] `Valori di Default` → `theme.actions.reset_defaults`
- [x] `Salva` → `common.actions.save` (reused)

## Not converted (noted, not a translatable string)

- [x] `lib/rbac/genitore-lock.ts` `ROOT_OPTION_LABEL = 'Root'` — spuriously matched by nothing
  (not a grep hit at all; noted here because it's the one remaining hardcoded RBAC-admin
  literal). Left untouched: "Root" is identical in the `it` and `en` seeds everywhere else in
  this task, the string is asserted byte-for-byte as `"Root"` by several `test_functionalities.py`
  cases, `genitore-lock.ts` is a plain (non-component) `lib` module that cannot call `useI18n()`,
  and it is not in the brief's file list. Translating it would require either threading a
  `rootLabel` argument through `buildGenitoreOptions()` (touching a file + its unit test outside
  the brief's stated scope) for zero observable change in either locale. See report for the
  full rationale.
