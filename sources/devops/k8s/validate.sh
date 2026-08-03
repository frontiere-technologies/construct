#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

kubectl kustomize "$SCRIPT_DIR/overlays/dev" > "$TMP_DIR/dev.yaml"
kubectl kustomize "$SCRIPT_DIR/overlays/production-example" > "$TMP_DIR/production.yaml"

require_pattern() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if ! grep -Eq "$pattern" "$file"; then
    echo "ERROR: $message" >&2
    exit 1
  fi
}

reject_pattern() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if grep -Eq "$pattern" "$file"; then
    echo "ERROR: $message" >&2
    exit 1
  fi
}

for rendered in "$TMP_DIR/dev.yaml" "$TMP_DIR/production.yaml"; do
  require_pattern "$rendered" 'path: /api/health/live' 'liveness endpoint is missing'
  require_pattern "$rendered" 'path: /api/health/ready' 'readiness endpoint is missing'
  require_pattern "$rendered" 'runAsNonRoot: true' 'non-root security context is missing'
  require_pattern "$rendered" 'readOnlyRootFilesystem: true' 'read-only root filesystem is missing'
  require_pattern "$rendered" 'allowPrivilegeEscalation: false' 'privilege escalation is not disabled'
  require_pattern "$rendered" 'type: RuntimeDefault' 'RuntimeDefault seccomp is missing'
  require_pattern "$rendered" 'drop:' 'capability drop list is missing'
  reject_pattern "$rendered" 'MIGRATION_DATABASE_URL' 'migration credentials leaked into the runtime deployment'
done

require_pattern "$TMP_DIR/dev.yaml" 'replicas: 1' 'development overlay must use one replica'
require_pattern "$TMP_DIR/dev.yaml" 'AUTH_URL: http://construct.local' 'development AUTH_URL must remain HTTP-compatible'
require_pattern "$TMP_DIR/production.yaml" 'kind: PodDisruptionBudget' 'production PodDisruptionBudget is missing'
require_pattern "$TMP_DIR/production.yaml" 'replicas: 2' 'production example must use at least two replicas'
require_pattern "$TMP_DIR/production.yaml" 'AUTH_URL: https://construct.example.com' 'production AUTH_URL must use HTTPS'
require_pattern "$TMP_DIR/production.yaml" 'secretName: construct-example-tls' 'production TLS configuration is missing'
require_pattern "$TMP_DIR/production.yaml" 'image: ghcr.io/example/construct@sha256:[a-f0-9]{64}' 'production image must use an immutable digest placeholder'

echo 'Kubernetes overlays validated'
