-- Un colore principale per il modo scuro (specifica del 2026-10-02, DEC-10).
--
-- Fino a qui il colore principale era uno: quello del modo scuro si ricavava dal chiaro (DEC-8).
-- Dopo aver provato la pagina il proprietario del progetto ha chiesto di poter scegliere anche
-- quello del modo scuro. La colonna ammette null, e null vuol dire «come prima»: la variante scura
-- si ricava dal colore del chiaro. Un colore scelto si rende leggibile allo stesso modo del chiaro,
-- e se non ci si riesce l'azione server avvisa (DEC-9).
--
-- SOLO ADDITIVA. I privilegi della 0031 (select, update) coprono gia' la colonna nuova.

-- 1. Il colore scelto per il modo scuro, sempre in minuscolo come primary_color.
alter table public.app_theme
  add column primary_dark varchar(7) check (primary_dark ~ '^#[0-9a-f]{6}$');

-- 2. Le etichette del pannello di scelta per il colore principale di ciascun modo.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.panel.title_primary","namespace":"theme","module":"rbac","description":"Theme admin: heading of the choice panel while a primary cell is selected. {{mode}} = Light/Dark","it":"Colore principale · {{mode}}","en":"Primary colour · {{mode}}"},
    {"key":"theme.panel.swatches_primary_dark","namespace":"theme","module":"rbac","description":"Theme admin: accessible name of the suggested primary colours of the dark mode","it":"Scegli il colore principale del modo scuro","en":"Choose the primary colour of the dark mode"},
    {"key":"theme.panel.primary_dark_hint","namespace":"theme","module":"rbac","description":"Theme admin: hint of the choice panel while the dark primary cell is selected","it":"Se non lo scegli, il colore del modo scuro si ricava da quello del chiaro e si rende leggibile da solo.","en":"If you do not choose it, the dark mode colour is worked out from the light one and made readable automatically."},
    {"key":"theme.suggestion.auto","namespace":"theme","module":"rbac","description":"Theme admin: suggested dark primary colour worked out from the light one","it":"Automatico","en":"Automatic"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
