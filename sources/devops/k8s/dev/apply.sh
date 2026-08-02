#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/secret.env" ]; then
  echo "ERROR: secret.env non trovato."
  echo "Copia secret.env.example in secret.env e compila i valori reali."
  exit 1
fi

echo "→ Creazione namespace construct..."
kubectl apply -f "$SCRIPT_DIR/../base/namespace.yaml"

echo "→ Applicazione secret..."
kubectl create secret generic web-construct-runtime-secret \
  --from-env-file="$SCRIPT_DIR/secret.env" \
  --namespace=construct \
  --dry-run=client -o yaml | kubectl apply -f -

echo "→ Applicazione base + overlay di sviluppo..."
kubectl apply -k "$SCRIPT_DIR/../overlays/dev"

echo ""
echo "✓ Deploy completato. Attendi che il pod sia Ready:"
echo "  kubectl get pods -n construct -w"
echo ""
echo "  Poi apri: http://construct.local"
