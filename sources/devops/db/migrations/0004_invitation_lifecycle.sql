alter table public.password_set_tokens
  add column if not exists purpose text not null default 'reset',
  add column if not exists delivery_status text not null default 'sent',
  add column if not exists delivery_attempted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error_code varchar(64),
  add column if not exists superseded_at timestamptz,
  add column if not exists requested_by uuid references public.users(id) on delete set null;

do $$ begin
  alter table public.password_set_tokens add constraint password_set_tokens_purpose_check
    check (purpose in ('reset', 'invitation'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.password_set_tokens add constraint password_set_tokens_delivery_status_check
    check (delivery_status in ('pending', 'sent', 'failed'));
exception when duplicate_object then null; end $$;

create index if not exists password_set_tokens_invitation_state_idx
  on public.password_set_tokens (user_id, purpose, delivery_status, created_at desc)
  where used_at is null and superseded_at is null;

create or replace function public.consume_password_set_token(
  p_token text,
  p_password_hash text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token_row public.password_set_tokens%rowtype;
begin
  select * into token_row
  from public.password_set_tokens
  where token = p_token
  for update;

  if not found then return 'invalid'; end if;
  if token_row.used_at is not null then return 'used'; end if;
  if token_row.superseded_at is not null then return 'superseded'; end if;
  if token_row.expires_at < now() then return 'expired'; end if;
  if token_row.purpose = 'invitation' and token_row.delivery_status <> 'sent' then
    return 'undelivered';
  end if;

  update public.users set password_hash = p_password_hash where id = token_row.user_id;
  if not found then raise exception 'password token references a missing user'; end if;

  update public.password_set_tokens
  set used_at = now()
  where user_id = token_row.user_id and used_at is null;
  return 'ok';
end;
$$;

revoke all on function public.consume_password_set_token(text, text) from public;
grant execute on function public.consume_password_set_token(text, text) to construct_runtime;
