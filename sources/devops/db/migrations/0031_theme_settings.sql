-- Nuova pagina Tema & Stili e pagina Impostazioni personali (specifica del 2026-10-02).
--
-- SOLO ADDITIVA, come la 0024: users.theme_config resta finche' il codice la legge. Il DROP di
-- quella colonna e la cancellazione delle chiavi di traduzione obsolete sono la 0032, da
-- applicare dopo il codice che smette di usarle.

-- 1. Il colore principale dell'app, uno per tutti (DEC-1). Una riga sola: la chiave booleana con
--    `check (id)` ammette soltanto `true`, quindi un secondo insert viola la chiave primaria.
--    In tabella c'e' solo il colore scelto; le varianti chiaro/scuro si ricalcolano a ogni
--    richiesta (DEC-8). Il colore si salva sempre in minuscolo, e il vincolo lo pretende.
create table public.app_theme (
  id            boolean primary key default true check (id),
  primary_color varchar(7) not null check (primary_color ~ '^#[0-9a-f]{6}$'),
  date_mod      timestamptz not null default now()
);
insert into public.app_theme (primary_color) values ('#4f46e5');

-- 2. Privilegi e RLS nella forma della 0024: le privilegi di default della 0002 non coprono una
--    tabella creata da una migrazione successiva. Solo select e update: la riga esiste gia' e
--    non si cancella.
alter table public.app_theme enable row level security;
grant select, update on table public.app_theme to construct_runtime;
create policy construct_runtime_server_access on public.app_theme
  for all to construct_runtime using (true) with check (true);

-- 3. Le preferenze personali (DEC-1, DEC-2). `system` come predefinito: chi non ha mai scelto
--    segue il sistema operativo, che e' l'unica scelta che rispetta una preferenza gia' espressa.
alter table public.users
  add column theme_mode varchar(6) not null default 'system'
    check (theme_mode in ('light', 'dark', 'system')),
  add column text_scale smallint not null default 100
    check (text_scale in (90, 100, 110, 120, 130));

-- 4. Le etichette delle due pagine e del link nel pannello utente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.section.primary_color","namespace":"theme","module":"rbac","description":"Theme admin: primary colour section title","it":"Colore principale","en":"Primary colour"},
    {"key":"theme.field.primary_color_hint","namespace":"theme","module":"rbac","description":"Theme admin: what the primary colour is used for","it":"Pulsanti, icone attive e bordo di selezione. Le varianti per chiaro e scuro sono calcolate in automatico.","en":"Buttons, active icons and the focus ring. The light and dark variants are worked out automatically."},
    {"key":"theme.field.swatches","namespace":"theme","module":"rbac","description":"Theme admin: accessible name of the colour swatch group","it":"Scegli il colore principale","en":"Choose the primary colour"},
    {"key":"theme.preset.indigo","namespace":"theme","module":"rbac","description":"Theme admin: indigo preset swatch","it":"Indaco","en":"Indigo"},
    {"key":"theme.preset.green","namespace":"theme","module":"rbac","description":"Theme admin: green preset swatch","it":"Verde","en":"Green"},
    {"key":"theme.preset.pink","namespace":"theme","module":"rbac","description":"Theme admin: pink preset swatch","it":"Rosa","en":"Pink"},
    {"key":"theme.preset.orange","namespace":"theme","module":"rbac","description":"Theme admin: orange preset swatch","it":"Arancio","en":"Orange"},
    {"key":"theme.preset.sky","namespace":"theme","module":"rbac","description":"Theme admin: sky blue preset swatch","it":"Azzurro","en":"Sky blue"},
    {"key":"theme.preset.custom","namespace":"theme","module":"rbac","description":"Theme admin: custom colour swatch that opens the colour picker","it":"Personalizzato","en":"Custom"},
    {"key":"theme.preview.title","namespace":"theme","module":"rbac","description":"Theme admin: palette preview section title","it":"Anteprima","en":"Preview"},
    {"key":"theme.preview.light","namespace":"theme","module":"rbac","description":"Theme admin: light-mode preview strip label","it":"Chiaro","en":"Light"},
    {"key":"theme.preview.dark","namespace":"theme","module":"rbac","description":"Theme admin: dark-mode preview strip label","it":"Scuro","en":"Dark"},
    {"key":"theme.preview.swatch.primary","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the primary colour","it":"Principale","en":"Primary"},
    {"key":"theme.preview.swatch.hover","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the hover surface","it":"Passaggio","en":"Hover"},
    {"key":"theme.preview.swatch.surface","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the card surface","it":"Superficie","en":"Surface"},
    {"key":"theme.preview.swatch.background","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the page background","it":"Sfondo","en":"Background"},
    {"key":"theme.preview.swatch.sidebar","namespace":"theme","module":"rbac","description":"Theme admin: preview cell for the sidebar","it":"Sidebar","en":"Sidebar"},
    {"key":"theme.status.unreadable","namespace":"theme","module":"rbac","description":"Theme admin: save refused because no readable variant of the colour exists","it":"Questo colore non si può rendere leggibile né in chiaro né in scuro e non è stato salvato.","en":"This colour cannot be made readable in light or dark mode and was not saved."},
    {"key":"settings.page.title","namespace":"settings","module":"core","description":"Personal settings page title","it":"Impostazioni","en":"Settings"},
    {"key":"settings.page.subtitle","namespace":"settings","module":"core","description":"Personal settings page subtitle","it":"Lingua e aspetto dell'applicazione, solo per te","en":"Language and appearance of the application, just for you"},
    {"key":"settings.section.language_region","namespace":"settings","module":"core","description":"Settings: language and region section title","it":"Lingua e regione","en":"Language and region"},
    {"key":"settings.field.language","namespace":"settings","module":"core","description":"Settings: language row label","it":"Lingua","en":"Language"},
    {"key":"settings.field.language_hint","namespace":"settings","module":"core","description":"Settings: language row hint","it":"Interfaccia, date e numeri si aggiornano subito","en":"Interface, dates and numbers update right away"},
    {"key":"settings.field.date_format","namespace":"settings","module":"core","description":"Settings: read-only date and number format example","it":"Formato data","en":"Date format"},
    {"key":"settings.section.appearance","namespace":"settings","module":"core","description":"Settings: appearance section title","it":"Aspetto","en":"Appearance"},
    {"key":"settings.field.theme","namespace":"settings","module":"core","description":"Settings: theme mode row label","it":"Tema","en":"Theme"},
    {"key":"settings.field.theme_hint","namespace":"settings","module":"core","description":"Settings: theme mode row hint","it":"Segue il sistema operativo oppure scegli tu","en":"Follow the operating system, or choose yourself"},
    {"key":"settings.theme.light","namespace":"settings","module":"core","description":"Settings: light theme option","it":"Chiaro","en":"Light"},
    {"key":"settings.theme.system","namespace":"settings","module":"core","description":"Settings: automatic theme option that follows the operating system","it":"Automatico","en":"Automatic"},
    {"key":"settings.theme.dark","namespace":"settings","module":"core","description":"Settings: dark theme option","it":"Scuro","en":"Dark"},
    {"key":"settings.field.text_size","namespace":"settings","module":"core","description":"Settings: text size row label","it":"Dimensione testo","en":"Text size"},
    {"key":"settings.field.text_size_hint","namespace":"settings","module":"core","description":"Settings: text size row hint","it":"Ingrandisce o riduce tutta l'interfaccia","en":"Makes the whole interface larger or smaller"},
    {"key":"settings.status.save_failed","namespace":"settings","module":"core","description":"Settings: a preference could not be saved and was reverted","it":"Impossibile salvare la preferenza. Riprova.","en":"Could not save the preference. Please try again."},
    {"key":"nav.settings","namespace":"nav","module":"core","description":"Sidebar user panel: link to the personal settings page","it":"Impostazioni","en":"Settings"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
