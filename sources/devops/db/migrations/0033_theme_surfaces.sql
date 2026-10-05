-- Quattro sfondi personalizzabili nella pagina Tema & Stili (specifica del 2026-10-02, DEC-9).
--
-- La DEC-3 aveva tolto i colori fini: sfondi, bordi, testi e sidebar erano diventati fissi. Dopo
-- aver provato la pagina il proprietario del progetto ha chiesto di poter cambiare almeno gli
-- sfondi, e la DEC-3 si riapre per quattro superfici soltanto, separate per chiaro e scuro:
-- sfondo (--background), superficie (--card e --popover), passaggio (--accent e
-- --sidebar-accent) e sidebar (--sidebar). Testi e bordi restano fissi.
--
-- SOLO ADDITIVA: otto colonne che ammettono null, dove null vuol dire «il valore fisso di
-- globals.css». Il controllo del contrasto non e' un vincolo del database: l'azione server avvisa
-- e l'admin puo' salvare lo stesso. I privilegi della 0031 (select, update) coprono gia' le
-- colonne nuove.

-- 1. Gli sfondi, sempre in minuscolo come primary_color.
alter table public.app_theme
  add column background_light varchar(7) check (background_light ~ '^#[0-9a-f]{6}$'),
  add column card_light       varchar(7) check (card_light ~ '^#[0-9a-f]{6}$'),
  add column accent_light     varchar(7) check (accent_light ~ '^#[0-9a-f]{6}$'),
  add column sidebar_light    varchar(7) check (sidebar_light ~ '^#[0-9a-f]{6}$'),
  add column background_dark  varchar(7) check (background_dark ~ '^#[0-9a-f]{6}$'),
  add column card_dark        varchar(7) check (card_dark ~ '^#[0-9a-f]{6}$'),
  add column accent_dark      varchar(7) check (accent_dark ~ '^#[0-9a-f]{6}$'),
  add column sidebar_dark     varchar(7) check (sidebar_dark ~ '^#[0-9a-f]{6}$');

-- 2. Le etichette dell'anteprima modificabile e dell'avviso di contrasto.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.preview.edit_hint","namespace":"theme","module":"rbac","description":"Theme admin: hint under the preview, the surface cells open a colour picker","it":"Clicca uno sfondo per cambiarne il colore.","en":"Click a surface to change its colour."},
    {"key":"theme.preview.customised","namespace":"theme","module":"rbac","description":"Theme admin: tooltip of the marker on a surface the admin changed","it":"Personalizzato","en":"Customised"},
    {"key":"theme.preview.cell_label","namespace":"theme","module":"rbac","description":"Theme admin: accessible name of a preview surface cell. {{surface}} = surface name, {{mode}} = light/dark, {{color}} = hex","it":"{{surface}}, {{mode}}: {{color}}, modifica","en":"{{surface}}, {{mode}}: {{color}}, edit"},
    {"key":"theme.preview.cell_label_customised","namespace":"theme","module":"rbac","description":"Theme admin: accessible name of a preview surface cell the admin changed. {{surface}} = surface name, {{mode}} = light/dark, {{color}} = hex","it":"{{surface}}, {{mode}}: {{color}} — personalizzato, modifica","en":"{{surface}}, {{mode}}: {{color}} — customised, edit"},
    {"key":"theme.mode.light","namespace":"theme","module":"rbac","description":"Theme admin: light mode, lower case, inside a sentence","it":"chiaro","en":"light"},
    {"key":"theme.mode.dark","namespace":"theme","module":"rbac","description":"Theme admin: dark mode, lower case, inside a sentence","it":"scuro","en":"dark"},
    {"key":"theme.text.foreground","namespace":"theme","module":"rbac","description":"Theme admin: main text colour, in a contrast warning","it":"Testo principale","en":"Main text"},
    {"key":"theme.text.foreground_secondary","namespace":"theme","module":"rbac","description":"Theme admin: secondary text colour, in a contrast warning","it":"Testo secondario","en":"Secondary text"},
    {"key":"theme.text.muted_foreground","namespace":"theme","module":"rbac","description":"Theme admin: muted text colour, in a contrast warning","it":"Testo tenue","en":"Muted text"},
    {"key":"theme.text.foreground_faint","namespace":"theme","module":"rbac","description":"Theme admin: faint text colour, in a contrast warning","it":"Testo debole","en":"Faint text"},
    {"key":"theme.text.sidebar_foreground","namespace":"theme","module":"rbac","description":"Theme admin: sidebar text colour, in a contrast warning","it":"Testo della sidebar","en":"Sidebar text"},
    {"key":"theme.text.sidebar_accent_foreground","namespace":"theme","module":"rbac","description":"Theme admin: text of the active sidebar item, in a contrast warning","it":"Testo della voce attiva","en":"Active item text"},
    {"key":"theme.warning.title","namespace":"theme","module":"rbac","description":"Theme admin: title of the dialog listing contrast problems before saving","it":"Alcuni testi si leggono male","en":"Some text is hard to read"},
    {"key":"theme.warning.message","namespace":"theme","module":"rbac","description":"Theme admin: body of the contrast warning dialog","it":"Con questi colori il contrasto scende sotto il minimo di 4,5:1. Puoi tornare indietro e cambiarli, oppure salvare comunque.","en":"With these colours the contrast drops below the 4.5:1 minimum. You can go back and change them, or save anyway."},
    {"key":"theme.warning.confirm","namespace":"theme","module":"rbac","description":"Theme admin: confirm button of the contrast warning dialog","it":"Salva comunque","en":"Save anyway"},
    {"key":"theme.warning.item","namespace":"theme","module":"rbac","description":"Theme admin: one contrast problem. {{text}} = text colour, {{surface}} = surface name, {{mode}} = light/dark, {{ratio}} = contrast ratio","it":"{{text}} su {{surface}} ({{mode}}): contrasto {{ratio}}:1","en":"{{text}} on {{surface}} ({{mode}}): contrast {{ratio}}:1"},
    {"key":"theme.warning.primary","namespace":"theme","module":"rbac","description":"Theme admin: no variant of the primary colour is readable on every surface of a mode. {{text}} = primary colour label, {{mode}} = light/dark","it":"{{text}} ({{mode}}): nessuna variante si legge su tutti gli sfondi","en":"{{text}} ({{mode}}): no variant is readable on every surface"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
