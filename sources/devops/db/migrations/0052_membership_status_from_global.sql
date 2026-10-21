-- Multi-tenancy, pezzo 2 (specifica 2026-10-20, §2.2, MT2-OK-1, MT2-DEC-3): gli account disattivati
-- a livello globale prima di questo pezzo diventano disattivati nel tenant predefinito, e il loro
-- stato globale torna attivo. Fino al pezzo 2 esisteva un solo tenant e ogni disattivazione arrivava
-- dalla pagina Utenti: era, nei fatti, una disattivazione nel tenant. La 0048 aveva dato a tutti
-- un'appartenenza attiva, così queste persone comparivano "Attivo" senza poter entrare, e "Riattiva"
-- (che ora cambia l'appartenenza) non le recuperava più. Dopo questa migrazione la pagina Utenti le
-- mostra disattivate e le riattiva come prima. Lo stato globale resta riservato alla piattaforma.
-- Gira come construct_owner, con app.tenant_id vuoto finché la sezione 1 non lo imposta.

-- 1. Il tenant predefinito ----------------------------------------------------------------------
select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true);

-- 2. Dallo stato globale all'appartenenza --------------------------------------------------------
-- Solo chi ha un'appartenenza al predefinito: chi non ce l'ha resta com'è. La regola dell'ultimo
-- amministratore non cambia: chi era fuori per lo stato globale resta fuori per l'appartenenza, e
-- il conteggio degli amministratori attivi deve restare quello di prima. Se scendesse a zero la
-- migrazione si ferma. Un database senza amministratori già prima (vuoto) non è un errore.
do $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_prima bigint := app_private.count_active_admins();
  v_dopo bigint;
begin
  update public.tenant_membership m set status = 'deactivated'
  from public.users u
  where u.id = m.user_id
    and u.id_user_status = 1
    and m.id_tenant = v_tenant
    and m.status <> 'deactivated';

  update public.users u set id_user_status = 2, last_status_ts = pg_catalog.clock_timestamp()
  where u.id_user_status = 1
    and exists (select 1 from public.tenant_membership m where m.id_tenant = v_tenant and m.user_id = u.id);

  v_dopo := app_private.count_active_admins();
  if v_prima > 0 and v_dopo = 0 then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;
