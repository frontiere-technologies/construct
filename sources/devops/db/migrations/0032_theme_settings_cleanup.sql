-- Seconda meta' della specifica del 2026-10-02: la parte distruttiva, applicata dopo il codice che
-- ha smesso di leggere users.theme_config (Task 9) e di chiamare le chiavi qui sotto.
--
-- I temi salvati non si migrano (DEC-3): erano per singolo admin e li vedeva solo chi li aveva
-- salvati. Il colore dell'app vive in app_theme dalla 0031.
alter table public.users drop column theme_config;

-- Le etichette dei 29 colori fini, del vecchio rifiuto per contrasto e dell'interruttore
-- chiaro/scuro della sidebar. La forma `delete from translation_key where key in (...)` e' quella
-- che sources/devops/i18n-key-inventory.test.mjs riconosce, come nella 0012.
do $$
declare
  v_keys_before integer;
  v_keys_after  integer;
begin
  select count(*) into v_keys_before from translation_key;

  delete from translation_key
   where key in (
     'theme.section.global',
     'theme.section.backgrounds',
     'theme.section.border',
     'theme.section.text',
     'theme.section.sidebar',
     'theme.field.primary_color',
     'theme.field.page_background',
     'theme.field.surface',
     'theme.field.surface_overlay',
     'theme.field.surface_hover',
     'theme.field.border',
     'theme.field.border_subtle',
     'theme.field.foreground',
     'theme.field.foreground_secondary',
     'theme.field.foreground_muted',
     'theme.field.foreground_faint',
     'theme.field.sidebar_bg',
     'theme.field.sidebar_text',
     'theme.field.active_item_bg',
     'theme.field.active_item_text',
     'theme.token.light',
     'theme.token.dark',
     'theme.status.contrast_rejected',
     'nav.theme_mode',
     'nav.theme_to_dark',
     'nav.theme_to_light'
   );

  select count(*) into v_keys_after from translation_key;
  raise notice 'removed % obsolete theme translation keys', v_keys_before - v_keys_after;
end $$;
