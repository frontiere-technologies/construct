# Design: Kubernetes Deployment

**Data:** 2026-06-27  
**Stato:** Approvato

---

## Obiettivo

Creare tutti i file necessari per deployare l'applicazione `web-construct` (Next.js 15) su un cluster Kubernetes — locale con Docker Desktop K8s inizialmente, portabile su qualsiasi cloud K8s in futuro.

---

## Vincoli e scelte

| Decisione | Scelta |
|---|---|
| Database | Supabase esterno (non nel cluster) |
| Tool locale | Docker Desktop Kubernetes |
| Networking | Ingress + NGINX Ingress Controller |
| Secret management | Secret K8s manuali + `secret.env` ignorato da git |
| Struttura manifests | Kustomize base/overlays (già scaffoldata) |

---

## Approccio: Pure Kubernetes YAML + Kustomize

Kustomize è integrato in `kubectl` (zero dipendenze extra). Il pattern `base/overlays` si trasferisce identico su qualsiasi cloud K8s.

---

## Struttura dei file

```
sources/
├── microservices/
│   └── web-construct/
│       └── Dockerfile                        # NEW — multi-stage build
└── devops/
    └── k8s/
        ├── base/
        │   └── web/
        │       ├── kustomization.yaml         # NEW
        │       ├── deployment.yaml            # NEW
        │       ├── service.yaml               # NEW
        │       └── configmap.yaml             # NEW
        └── overlays/
            ├── dev/
            │   ├── kustomization.yaml         # NEW
            │   ├── ingress.yaml               # NEW
            │   ├── secret.env.example         # NEW (committato)
            │   └── secret.env                 # NEW (gitignored — valori reali)
            ├── staging/
            │   └── kustomization.yaml         # NEW (placeholder)
            └── prod/
                └── kustomization.yaml         # NEW (placeholder)
```

---

## Sezione 1: Dockerfile

File: `sources/microservices/web-construct/Dockerfile`

**Multi-stage build** in 3 fasi:

1. **`deps`** — installa le dipendenze npm (prod + dev) su `node:22-alpine`
2. **`builder`** — copia i sorgenti, esegue `next build`. Richiede `output: 'standalone'` in `next.config.ts`
3. **`runner`** — immagine finale `node:22-alpine`, copia solo:
   - `.next/standalone/` (server Node.js + deps minime)
   - `.next/static/` (asset statici)
   - `public/` (file pubblici)

L'immagine finale non include sorgenti TypeScript né devDependencies. Dimensione stimata: ~120MB.

Il container espone la porta **3000** e avvia il server con `node server.js`.

---

## Sezione 2: Manifest base

Directory: `sources/devops/k8s/base/web/`

### `kustomization.yaml`
- `namespace: construct`
- Risorse: `deployment.yaml`, `service.yaml`, `configmap.yaml`

### `deployment.yaml`
- `kind: Deployment`, namespace `construct`
- 1 replica di default (sovrascrivibile negli overlay)
- Container `web-construct`, immagine `web-construct:local`
- Porta `3000`
- **Env vars non sensibili** da ConfigMap `web-construct-config`
- **Env vars sensibili** da Secret `web-construct-secret`
- **Resources:**
  - requests: `cpu: 100m`, `memory: 256Mi`
  - limits: `cpu: 500m`, `memory: 512Mi`
- **Probes:**
  - `readinessProbe`: HTTP GET `/` porta 3000, initialDelaySeconds 10
  - `livenessProbe`: HTTP GET `/` porta 3000, initialDelaySeconds 30

### `service.yaml`
- `kind: Service`, tipo `ClusterIP`
- Porta 80 → targetPort 3000

### `configmap.yaml`
Variabili non sensibili (valori di default per dev, sovrascrivibili negli overlay):

| Variabile | Valore default |
|---|---|
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `MAIL_PROVIDER` | `resend` |
| `AUTH_URL` | `http://construct.local` |
| `RESEND_FROM` | `noreply@frontiere.io` |
| `NEXT_PUBLIC_SUPABASE_URL` | *(vuoto — da overlay/secret)* |
| `NEXT_PUBLIC_AUTH_TEST_MODE` | `false` |

> **Nota:** `NEXT_PUBLIC_*` sono variabili buildtime in Next.js. In K8s runtime non vengono reinjettate nell'HTML già buildato. Per il deploy locale con immagine `web-construct:local`, l'URL Supabase è già baked nell'immagine al momento del build.

---

## Sezione 3: Overlay dev

Directory: `sources/devops/k8s/overlays/dev/`

### `kustomization.yaml`
- Estende `../../base/web`
- Namespace `construct`
- Image override: `web-construct:local`
- Risorse aggiuntive: `ingress.yaml`

### `ingress.yaml`
- `kind: Ingress`, `ingressClassName: nginx`
- Host: `construct.local`
- Path `/` → service `web-construct`, port 80

Richiede una riga in `/etc/hosts` del Mac:
```
127.0.0.1  construct.local
```

### Secret management

**`secret.env.example`** (committato):
```
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

**`secret.env`** (gitignored — copia locale con valori reali).

### Script di deploy

Comando da eseguire dalla directory `overlays/dev/`:

```bash
# 1. Crea/aggiorna il namespace
kubectl create namespace construct --dry-run=client -o yaml | kubectl apply -f -

# 2. Applica i secret
kubectl create secret generic web-construct-secret \
  --from-env-file=secret.env \
  --namespace=construct \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Applica i manifest
kubectl apply -k .
```

---

## Sezione 4: Overlay staging e prod (placeholder)

`overlays/staging/kustomization.yaml` e `overlays/prod/kustomization.yaml` contengono solo il riferimento alla base. Saranno estesi con:
- Numero di repliche (2+)
- Image tag versionato (es. `web-construct:v1.2.3`)
- TLS via cert-manager
- ConfigMap con valori produzione

---

## Prerequisiti per il deploy locale

1. Docker Desktop con Kubernetes abilitato
2. NGINX Ingress Controller installato:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.3/deploy/static/provider/cloud/deploy.yaml
   ```
3. Build dell'immagine locale:
   ```bash
   cd sources/microservices/web-construct
   docker build -t web-construct:local .
   ```
4. Riga in `/etc/hosts`:
   ```
   127.0.0.1  construct.local
   ```
5. File `secret.env` compilato (copia da `secret.env.example`)

---

## `.gitignore` da aggiornare

Aggiungere al `.gitignore` del progetto:
```
sources/devops/k8s/overlays/*/secret.env
```

---

## `next.config.ts` — modifica richiesta

Abilitare l'output standalone per ridurre la dimensione dell'immagine Docker:
```ts
output: 'standalone',
```

---

## Flusso completo (primo deploy locale)

```
1. Abilita K8s in Docker Desktop
2. Installa nginx ingress controller
3. docker build -t web-construct:local .
4. Copia secret.env.example → secret.env, compila i valori
5. Aggiungi construct.local a /etc/hosts
6. cd sources/devops/k8s/overlays/dev && bash apply.sh
7. Apri http://construct.local
```
