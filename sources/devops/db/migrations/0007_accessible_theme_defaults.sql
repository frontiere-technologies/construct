-- Lift saved per-user themes off the colour values that cannot meet the 4.5:1
-- contrast floor.
--
-- The theme is stored per user in users.theme_config, and mergeThemeConfig()
-- lets a saved value win over the default. Changing defaultThemeConfig therefore
-- reaches only users who never opened Admin -> Theme: everyone who ever saved
-- keeps a frozen copy, including the values measured below the floor.
--
--   foregroundMutedLight  #6b7280  4.39:1 on #f3f4f6 (surfaceHover, activeItemBg)
--   foregroundFaintLight  #9ca3af  2.31:1 on the same surface
--   foregroundFaintDark   #6b7280  3.04:1 on #1f2937
--   primaryColor          #6366f1  4.47:1 with white, its best possible label
--
-- Each key is rewritten only when it still holds the exact previous default, so
-- a colour somebody deliberately picked is left alone. The one case this cannot
-- distinguish is a user who chose a value identical to the old default — and for
-- these four values that choice was inaccessible either way, so moving it is the
-- right outcome. Any of them can be set again from Admin -> Theme.
--
-- Re-runnable: after the first pass no row still matches the old values.
do $$
declare
  v_rows bigint;
begin
  with replacements(key, old_value, new_value) as (
    values
      ('primaryColor',         '#6366f1', '#4f46e5'),
      ('foregroundMutedLight', '#6b7280', '#4b5563'),
      ('foregroundFaintLight', '#9ca3af', '#666f7d'),
      ('foregroundFaintDark',  '#6b7280', '#8b919c')
  ),
  updated as (
    update users u
    set theme_config = (
      select jsonb_object_agg(
        entry.key,
        coalesce(
          (select to_jsonb(r.new_value) from replacements r
            where r.key = entry.key and to_jsonb(r.old_value) = entry.value),
          entry.value
        )
      )
      from jsonb_each(u.theme_config) entry
    )
    where u.theme_config is not null
      and exists (
        select 1 from replacements r
        where u.theme_config -> r.key = to_jsonb(r.old_value)
      )
    returning 1
  )
  select count(*) into v_rows from updated;
  raise notice 'theme_config rows lifted to the accessible palette: %', v_rows;
end $$;
