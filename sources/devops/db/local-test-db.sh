#!/usr/bin/env bash
# The disposable Postgres on this Mac for integration and E2E runs, prepared like the
# database-and-e2e job in .github/workflows/quality.yml. Opt-in: the remote test database stays
# the default. See the README section "Test in locale con Postgres in Docker".
#
#   local-test-db.sh up      start the container if needed and prepare the database (idempotent)
#   local-test-db.sh reset   destroy the container and its data, then `up`
#   local-test-db.sh down    destroy the container and its data
#   local-test-db.sh status  container state and what the database contains
#
# Credentials come from local-test.env next to this file; the two E2E accounts from the
# environment or, failing that, from sources/tests/e2e/.env.test (the same lookup conftest.py does).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"
compose_file="$here/local-test.compose.yaml"
env_file="$here/local-test.env"
e2e_env_file="$repo_root/sources/tests/e2e/.env.test"

compose() { docker compose -f "$compose_file" "$@"; }
log() { printf '[local-test-db] %s\n' "$*"; }
die() { printf '[local-test-db] ERROR: %s\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null || die "docker not found: install or start Docker Desktop"
  docker info >/dev/null 2>&1 || die "the Docker daemon is not running: open -a Docker, then retry"
}

load_env() {
  set -a
  # shellcheck source=/dev/null
  . "$env_file"
  set +a
}

# psql inside the container, as the superuser: used only for the read-only probes of `status`
# and of the "already prepared?" check, never for the preparation itself (that goes through
# db.mjs, as in CI).
psql_super() { compose exec -T postgres psql -U postgres -d construct_test -v ON_ERROR_STOP=1 -tAc "$1"; }

# The value of a variable from the environment, else from tests/e2e/.env.test. Never printed.
e2e_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" && -f "$e2e_env_file" ]]; then
    value="$(sed -n "s/^[[:space:]]*${name}[[:space:]]*=[[:space:]]*//p" "$e2e_env_file" | tail -n 1)"
    value="${value%%[[:space:]]#*}"
    value="${value%"${value##*[![:space:]]}"}"
  fi
  printf '%s' "$value"
}

valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }

# db.mjs as the owner: in CI the preparation steps run with the job's TEST_DATABASE_URL, which is
# the superuser, and only the integration step switches to the runtime login.
db_owner() { TEST_DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" node "$repo_root/sources/devops/db/db.mjs" "$@"; }

prepare() {
  load_env
  local started=$SECONDS

  if [[ "$(psql_super "select to_regclass('public.construct_schema_migration') is not null")" != "t" ]]; then
    log "fresh database: legacy role migration fixture (as in CI)"
    db_owner test-query "create table users (
      id uuid primary key default gen_random_uuid(), name text, email text unique, avatar text,
      first_name text, last_name text, username text, phone text, theme_config jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now(), role text
      );
      insert into users(email, role) values
      ('legacy-admin@example.com','admin'), ('legacy-user@example.com','user');" >/dev/null
  fi

  log "test-apply"
  # The migrations' NOTICE lines (translation seeds and the like) would bury the summary.
  node "$repo_root/sources/devops/db/db.mjs" test-apply | { grep -v '^NOTICE: ' || true; }

  # Must follow the migrations: 0002 creates the construct_runtime group this login joins.
  [[ "$TEST_DATABASE_URL" =~ ^postgresql://([^:@/]+):([^@]+)@ ]] \
    || die "TEST_DATABASE_URL in $env_file must carry user and password"
  log "provision-runtime-role (${BASH_REMATCH[1]})"
  MIGRATION_DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" \
    CONSTRUCT_RUNTIME_DB_USER="${BASH_REMATCH[1]}" \
    CONSTRUCT_RUNTIME_DB_PASSWORD="${BASH_REMATCH[2]}" \
    node "$repo_root/sources/devops/db/db.mjs" provision-runtime-role

  local admin user
  admin="$(e2e_value TEST_EMAIL)"
  user="$(e2e_value TEST_EMAIL_USER)"
  if [[ -z "$admin" ]]; then
    admin="admin-e2e@example.com"
    log "TEST_EMAIL not set and not in tests/e2e/.env.test: using the CI account"
  fi
  if [[ -z "$user" ]]; then
    user="user-e2e@example.com"
    log "TEST_EMAIL_USER not set and not in tests/e2e/.env.test: using the CI account"
  fi
  valid_email "$admin" || die "TEST_EMAIL is not a plain e-mail address"
  valid_email "$user" || die "TEST_EMAIL_USER is not a plain e-mail address"

  # The same seed as the "Seed isolated E2E users" step of quality.yml, with the local accounts.
  log "seed of the two E2E accounts (TEST_EMAIL, TEST_EMAIL_USER)"
  db_owner test-query "insert into users(email, auth_provider) values ('$admin','test'), ('$user','test') on conflict(email) do nothing;
    insert into tenant_membership(user_id, status) select id, 'active' from users where email in ('$admin','$user') on conflict do nothing;
    insert into user_role(user_id,id_role) select u.id, r.id_role from users u join role r on r.id_tenant = app_private.current_tenant_id() and r.system_key = 'REGISTERED' where u.email in ('$admin','$user') on conflict do nothing;
    insert into user_role(user_id,id_role) select u.id, r.id_role from users u join role r on r.id_tenant = app_private.current_tenant_id() and r.system_key = 'TENANT_ADMIN' where u.email = '$admin' on conflict do nothing;" >/dev/null

  log "ready in $((SECONDS - started)) s: postgresql://127.0.0.1:55432/construct_test"
}

up() {
  require_docker
  log "starting postgres:17 on 127.0.0.1:55432"
  compose up -d --wait
  prepare
}

down() {
  require_docker
  compose down --volumes --remove-orphans
}

status() {
  require_docker
  compose ps
  if [[ -z "$(compose ps -q --status running postgres)" ]]; then
    log "not running"
    return 0
  fi
  if [[ "$(psql_super "select to_regclass('public.construct_schema_migration') is not null")" != "t" ]]; then
    log "running, not prepared: run local-test-db.sh up"
    return 0
  fi
  log "migrations applied: $(psql_super "select count(*) from construct_schema_migration where completed_at is not null")"
  log "runtime login construct_app: $(psql_super "select case when exists (select 1 from pg_roles where rolname = 'construct_app') then 'present' else 'missing' end")"
  log "users: $(psql_super "select count(*) from users")"
}

case "${1:-}" in
  up) up ;;
  reset) down; up ;;
  down) down ;;
  status) status ;;
  *) echo "usage: $(basename "$0") up|reset|down|status" >&2; exit 2 ;;
esac
