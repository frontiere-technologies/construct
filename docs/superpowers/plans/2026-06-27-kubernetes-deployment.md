# Kubernetes Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy l'app `web-construct` (Next.js 15) su Kubernetes locale con Docker Desktop, usando Kustomize base/overlays e NGINX Ingress.

**Architecture:** Un singolo Dockerfile multi-stage produce un'immagine standalone ottimizzata. I manifest Kustomize in `base/web/` definiscono la configurazione comune; `overlays/dev/` aggiunge Ingress NGINX e gestione dei secret tramite file `secret.env` gitignored. Supabase rimane esterno al cluster.

**Tech Stack:** Docker multi-stage build, Kubernetes 1.28+, Kustomize (integrato in kubectl), NGINX Ingress Controller, Docker Desktop K8s.

## Global Constraints

- Docker Desktop con Kubernetes abilitato
- `kubectl` versione >= 1.27 (Kustomize integrato)
- Namespace Kubernetes: `construct`
- Hostname locale: `construct.local`
- Immagine locale: `web-construct:local`
- Next.js output mode: `standalone` (richiesto per Dockerfile ottimizzato)
- Nessun valore sensibile nei file committati — solo chiavi, mai valori
- `imagePullPolicy: IfNotPresent` nel base; Docker Desktop K8s condivide il daemon Docker locale

---

## File Map

| File | Azione | Responsabilità |
|---|---|---|
| `sources/microservices/web-construct/next.config.ts` | Modifica | Aggiunge `output: 'standalone'` |
| `sources/microservices/web-construct/Dockerfile` | Crea | Multi-stage build: deps → builder → runner |
| `sources/devops/k8s/base/web/kustomization.yaml` | Crea | Lista risorse base |
| `sources/devops/k8s/base/web/configmap.yaml` | Crea | Variabili non sensibili |
| `sources/devops/k8s/base/web/service.yaml` | Crea | ClusterIP port 80→3000 |
| `sources/devops/k8s/base/web/deployment.yaml` | Crea | Deployment + probes + risorse |
| `sources/devops/k8s/overlays/dev/kustomization.yaml` | Crea | Overlay dev: estende base + ingress |
| `sources/devops/k8s/overlays/dev/ingress.yaml` | Crea | NGINX Ingress per construct.local |
| `sources/devops/k8s/overlays/dev/secret.env.example` | Crea | Template chiavi secret (committato) |
| `sources/devops/k8s/overlays/dev/apply.sh` | Crea | Script deploy locale |
| `sources/devops/k8s/overlays/staging/kustomization.yaml` | Crea | Placeholder staging |
| `sources/devops/k8s/overlays/prod/kustomization.yaml` | Crea | Placeholder prod |
| `.gitignore` | Modifica | Aggiunge pattern `secret.env` |

---

## Task 1: Next.js standalone output + Dockerfile

**Files:**
- Modify: `sources/microservices/web-construct/next.config.ts`
- Create: `sources/microservices/web-construct/Dockerfile`

**Interfaces:**
- Produce: immagine Docker `web-construct:local` usata da Task 2 nel deployment.yaml

- [✅] **Step 1: Abilita output standalone in next.config.ts**

Modifica `sources/microservices/web-construct/next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pino', 'pino-pretty'],
  devIndicators: {
    position: 'bottom-right',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig
```

- [✅] **Step 2: Verifica che la build Next.js funzioni ancora**

```bash
cd sources/microservices/web-construct
npm run build
```

Atteso: build completata, directory `.next/standalone/` presente nell'output.

```bash
ls .next/standalone/
```

Atteso: `server.js` e `node_modules/` presenti.

- [✅] **Step 3: Crea il Dockerfile**

Crea `sources/microservices/web-construct/Dockerfile`:

```dockerfile
# Stage 1: installa le dipendenze
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: build dell'app
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* sono variabili buildtime — devono essere passate al docker build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_AUTH_TEST_MODE=false

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_AUTH_TEST_MODE=$NEXT_PUBLIC_AUTH_TEST_MODE

RUN npm run build

# Stage 3: immagine runtime minimale
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
```

- [✅] **Step 4: Leggi le variabili NEXT_PUBLIC dal .env.local e builda l.immagine**

```bash
cd sources/microservices/web-construct

# Estrai i valori da .env.local
export NEXT_PUBLIC_SUPABASE_URL=$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2-)
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep ^NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2-)

docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -t web-construct:local .
```

Atteso: `Successfully built ...` e `Successfully tagged web-construct:local`.

- [✅] **Step 5: Verifica che il container si avvii**

```bash
docker run --rm -p 3001:3000 \
  --env-file sources/microservices/web-construct/.env.local \
  web-construct:local
```

Apri http://localhost:3001 in un browser. Atteso: pagina di login dell'app visibile. Interrompi con `Ctrl+C`.

- [✅] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/next.config.ts \
        sources/microservices/web-construct/Dockerfile
git commit -m "feat(deploy): add Dockerfile multi-stage build and enable Next.js standalone output"
```

---

## Task 2: Manifest K8s base

**Files:**
- Create: `sources/devops/k8s/base/web/kustomization.yaml`
- Create: `sources/devops/k8s/base/web/configmap.yaml`
- Create: `sources/devops/k8s/base/web/service.yaml`
- Create: `sources/devops/k8s/base/web/deployment.yaml`
- Delete: `sources/devops/k8s/base/web/.gitkeep`

**Interfaces:**
- Consumes: immagine `web-construct:local` (da Task 1)
- Produce: risorse K8s `web-construct-config` (ConfigMap), `web-construct` (Service + Deployment) nel namespace `construct`; usate da Task 3 nell'overlay dev

- [✅] **Step 1: Rimuovi il placeholder**

```bash
rm sources/devops/k8s/base/web/.gitkeep
```

- [✅] **Step 2: Crea configmap.yaml**

Crea `sources/devops/k8s/base/web/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-construct-config
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  MAIL_PROVIDER: "resend"
  AUTH_URL: "http://construct.local"
  RESEND_FROM: "noreply@frontiere.io"
  NEXT_PUBLIC_AUTH_TEST_MODE: "false"
```

- [✅] **Step 3: Crea service.yaml**

Crea `sources/devops/k8s/base/web/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-construct
spec:
  selector:
    app: web-construct
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

- [✅] **Step 4: Crea deployment.yaml**

Crea `sources/devops/k8s/base/web/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-construct
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-construct
  template:
    metadata:
      labels:
        app: web-construct
    spec:
      containers:
        - name: web-construct
          image: web-construct:local
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: web-construct-config
            - secretRef:
                name: web-construct-secret
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
```

- [✅] **Step 5: Crea kustomization.yaml**

Crea `sources/devops/k8s/base/web/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: construct

resources:
  - configmap.yaml
  - service.yaml
  - deployment.yaml
```

- [✅] **Step 6: Valida i manifest con dry-run**

```bash
kubectl apply -k sources/devops/k8s/base/web --dry-run=client
```

Atteso (il Secret non esiste ancora, ma il dry-run valida la sintassi):
```
configmap/web-construct-config configured (dry run)
service/web-construct configured (dry run)
deployment.apps/web-construct configured (dry run)
```

- [✅] **Step 7: Commit**

```bash
git add sources/devops/k8s/base/web/
git commit -m "feat(deploy): add K8s base manifests (Deployment, Service, ConfigMap)"
```

---

## Task 3: Overlay dev + gestione secret

**Files:**
- Create: `sources/devops/k8s/overlays/dev/kustomization.yaml`
- Create: `sources/devops/k8s/overlays/dev/ingress.yaml`
- Create: `sources/devops/k8s/overlays/dev/secret.env.example`
- Create: `sources/devops/k8s/overlays/dev/apply.sh`
- Delete: `sources/devops/k8s/overlays/dev/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: risorse base di Task 2 (`../../base/web`)
- Produce: stack completo deployabile con `bash apply.sh`

- [✅] **Step 1: Rimuovi il placeholder**

```bash
rm sources/devops/k8s/overlays/dev/.gitkeep
```

- [✅] **Step 2: Crea kustomization.yaml dell'overlay dev**

Crea `sources/devops/k8s/overlays/dev/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: construct

resources:
  - ../../base/web
  - ingress.yaml

images:
  - name: web-construct
    newName: web-construct
    newTag: local
```

- [✅] **Step 3: Crea ingress.yaml**

Crea `sources/devops/k8s/overlays/dev/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-construct
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
spec:
  ingressClassName: nginx
  rules:
    - host: construct.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-construct
                port:
                  number: 80
```

- [✅] **Step 4: Crea secret.env.example**

Crea `sources/devops/k8s/overlays/dev/secret.env.example`:

```
# Copia questo file in secret.env e compila i valori reali.
# secret.env è gitignored — non committare mai valori sensibili.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
AUTH_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_KEYCLOAK_ID=
AUTH_KEYCLOAK_SECRET=
AUTH_KEYCLOAK_ISSUER=
AUTH_TEST_CREDENTIALS=
RESEND_API_KEY=
EMAIL_DEV_OVERRIDE=
```

- [✅] **Step 5: Crea apply.sh**

Crea `sources/devops/k8s/overlays/dev/apply.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/secret.env" ]; then
  echo "ERROR: secret.env non trovato."
  echo "Copia secret.env.example in secret.env e compila i valori reali."
  exit 1
fi

echo "→ Creazione namespace construct..."
kubectl create namespace construct --dry-run=client -o yaml | kubectl apply -f -

echo "→ Applicazione secret..."
kubectl create secret generic web-construct-secret \
  --from-env-file="$SCRIPT_DIR/secret.env" \
  --namespace=construct \
  --dry-run=client -o yaml | kubectl apply -f -

echo "→ Applicazione manifest..."
kubectl apply -k "$SCRIPT_DIR"

echo ""
echo "✓ Deploy completato. Attendi che il pod sia Ready:"
echo "  kubectl get pods -n construct -w"
echo ""
echo "  Poi apri: http://construct.local"
```

```bash
chmod +x sources/devops/k8s/overlays/dev/apply.sh
```

- [✅] **Step 6: Aggiorna .gitignore**

Aggiungi in fondo al file `.gitignore` della root:

```
# Kubernetes secrets (valori reali — mai committare)
sources/devops/k8s/overlays/*/secret.env
```

- [✅] **Step 7: Valida i manifest dell'overlay dev con dry-run**

```bash
kubectl apply -k sources/devops/k8s/overlays/dev --dry-run=client
```

Atteso:
```
configmap/web-construct-config configured (dry run)
service/web-construct configured (dry run)
deployment.apps/web-construct configured (dry run)
ingress.networking.k8s.io/web-construct configured (dry run)
```

- [✅] **Step 8: Commit**

```bash
git add sources/devops/k8s/overlays/dev/ .gitignore
git commit -m "feat(deploy): add dev overlay with NGINX Ingress, secret template and apply script"
```

---

## Task 4: Overlay staging e prod (placeholder)

**Files:**
- Create: `sources/devops/k8s/overlays/staging/kustomization.yaml`
- Create: `sources/devops/k8s/overlays/prod/kustomization.yaml`
- Delete: `sources/devops/k8s/overlays/staging/.gitkeep`
- Delete: `sources/devops/k8s/overlays/prod/.gitkeep`

**Interfaces:**
- Consumes: risorse base di Task 2 (`../../base/web`)
- Produce: overlay validabili con dry-run, pronti per future personalizzazioni (repliche, TLS, immagini versionate)

- [✅] **Step 1: Rimuovi i placeholder**

```bash
rm sources/devops/k8s/overlays/staging/.gitkeep
rm sources/devops/k8s/overlays/prod/.gitkeep
```

- [✅] **Step 2: Crea kustomization.yaml staging**

Crea `sources/devops/k8s/overlays/staging/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

# Overlay staging — estende la base.
# Personalizzazioni future: image tag versionato, repliche, TLS, ConfigMap staging.
namespace: construct

resources:
  - ../../base/web
```

- [✅] **Step 3: Crea kustomization.yaml prod**

Crea `sources/devops/k8s/overlays/prod/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

# Overlay prod — estende la base.
# Personalizzazioni future: image tag versionato, repliche 2+, TLS con cert-manager, HPA.
namespace: construct

resources:
  - ../../base/web
```

- [✅] **Step 4: Valida entrambi gli overlay**

```bash
kubectl apply -k sources/devops/k8s/overlays/staging --dry-run=client
kubectl apply -k sources/devops/k8s/overlays/prod --dry-run=client
```

Atteso per entrambi:
```
configmap/web-construct-config configured (dry run)
service/web-construct configured (dry run)
deployment.apps/web-construct configured (dry run)
```

- [✅] **Step 5: Commit**

```bash
git add sources/devops/k8s/overlays/staging/ sources/devops/k8s/overlays/prod/
git commit -m "feat(deploy): add staging and prod overlay placeholders"
```

---

## Task 5: Deploy end-to-end su Docker Desktop K8s

**Prerequisiti:** Task 1–4 completati, Docker Desktop installato.

**Files:**
- Nessun nuovo file — verifica operativa del deploy completo.

- [✅] **Step 1: Abilita Kubernetes in Docker Desktop**

Apri Docker Desktop → Settings → Kubernetes → Enable Kubernetes → Apply & Restart.

Verifica:
```bash
kubectl config current-context
```
Atteso: `docker-desktop`

```bash
kubectl cluster-info
```
Atteso: `Kubernetes control plane is running at https://127.0.0.1:...`

- [✅] **Step 2: Installa NGINX Ingress Controller**

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.3/deploy/static/provider/cloud/deploy.yaml
```

Attendi che il controller sia pronto:
```bash
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

Atteso: `pod/ingress-nginx-controller-... condition met`

- [✅] **Step 3: Aggiungi construct.local a /etc/hosts**

```bash
echo "127.0.0.1  construct.local" | sudo tee -a /etc/hosts
```

Verifica:
```bash
grep construct.local /etc/hosts
```
Atteso: `127.0.0.1  construct.local`

- [✅] **Step 4: Builda l'immagine Docker con le variabili NEXT_PUBLIC**

```bash
cd sources/microservices/web-construct

export NEXT_PUBLIC_SUPABASE_URL=$(grep ^NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2-)
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep ^NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2-)

docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -t web-construct:local .
```

Verifica:
```bash
docker images web-construct:local
```
Atteso: riga con `web-construct` e tag `local`.

- [✅] **Step 5: Prepara il file secret.env**

```bash
cd sources/devops/k8s/overlays/dev
cp secret.env.example secret.env
```

Apri `secret.env` con un editor e compila i valori copiandoli da `sources/microservices/web-construct/.env.local`. I campi minimi richiesti sono:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AUTH_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- Almeno un provider OIDC oppure `AUTH_TEST_CREDENTIALS` e `NEXT_PUBLIC_AUTH_TEST_MODE=true`

- [✅] **Step 6: Esegui il deploy**

```bash
cd sources/devops/k8s/overlays/dev
bash apply.sh
```

Atteso:
```
→ Creazione namespace construct...
namespace/construct configured
→ Applicazione secret...
secret/web-construct-secret configured
→ Applicazione manifest...
configmap/web-construct-config configured
service/web-construct configured
deployment.apps/web-construct configured
ingress.networking.k8s.io/web-construct configured
✓ Deploy completato. ...
```

- [✅] **Step 7: Attendi che il pod sia Ready**

```bash
kubectl get pods -n construct -w
```

Atteso entro ~60 secondi: `web-construct-<hash>   1/1   Running   0   ...`

Premi `Ctrl+C` per uscire dal watch.

- [✅] **Step 8: Verifica l'app in un browser**

Apri http://construct.local

Atteso: pagina di login dell'app visibile e funzionante. Prova il login con un provider configurato.

- [✅] **Step 9: Commit finale**

```bash
cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct
git add docs/superpowers/plans/2026-06-27-kubernetes-deployment.md
git commit -m "feat(deploy): complete K8s local deployment — all manifests and Dockerfile ready"
```
