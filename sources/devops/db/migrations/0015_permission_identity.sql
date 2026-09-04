-- Le quattro colonne che rendono un permesso identificabile dal sorgente.
-- Nessun codice le legge ancora: servono alla Fase 2, e stanno qui perche' il
-- popolamento dai dati esistenti va fatto una volta sola, adesso che i dati
-- esistenti sono ancora tutti in una tabella.
--
-- origin = 'CONSOLE' per tutto: ogni riga presente oggi e' stata creata dalla
-- console o seminata come se lo fosse. La sincronizzazione del catalogo, in
-- Fase 2, adottera' quelle che le competono ribaltando origin a 'SOURCE'.

alter table public.permission
  add column kind text,
  add column code varchar(80),
  add column origin text not null default 'CONSOLE',
  add column deprecated_at timestamptz;

-- id_item_type: 1 = categoria, 2 = funzionalita'.
update public.permission set kind = case when id_item_type = 1 then 'CATEGORY' else 'GRANT' end;

-- Un code leggibile e stabile dal nome, reso univoco dall'id quando serve.
-- E' provvisorio per definizione: la Fase 2 lo sostituira' con i codici del
-- catalogo per le righe che il catalogo copre. Le altre se lo tengono, ed e'
-- il motivo per cui vale la pena guardarli una volta a mano prima di andare
-- avanti — DEC-3 dice che un code non cambia mai piu'.
update public.permission
set code = regexp_replace(
      lower(coalesce(nullif(trim(name), ''), 'permesso-' || id_permission::text)),
      '[^a-z0-9]+', '-', 'g')
where kind = 'GRANT';

update public.permission p
set code = p.code || '-' || p.id_permission::text
where p.kind = 'GRANT'
  and exists (select 1 from public.permission q
              where q.kind = 'GRANT' and q.code = p.code and q.id_permission <> p.id_permission);

update public.permission set code = trim(both '-' from code) where kind = 'GRANT';

alter table public.permission
  alter column kind set not null,
  add constraint permission_kind_valid check (kind in ('CATEGORY', 'GRANT')),
  add constraint permission_origin_valid check (origin in ('SOURCE', 'CONSOLE')),
  add constraint permission_code_matches_kind
    check ((kind = 'GRANT' and code is not null) or (kind = 'CATEGORY' and code is null));

create unique index permission_code_unique on public.permission (code) where code is not null;
