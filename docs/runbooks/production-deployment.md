# Production Deployment Runbook

## Findings and recommendations summary

Construct supplies a hardened, reusable Kubernetes baseline and a production example. A derived application must replace the example domain, image digest, resource requests, replica target, TLS secret, mail provider, database endpoints, and recovery objectives before deployment. Runtime pods receive only the least-privilege `DATABASE_URL`; the administrative `MIGRATION_DATABASE_URL` is scoped to the migration operator or one-shot job.

## Environment-specific inputs

- [ ] ID=PROD-1, Title=Immutable image, Action=Build and publish the derived application image and record its immutable registry digest.
- [ ] ID=PROD-2, Title=External URL, Action=Replace `construct.example.com`, configure DNS and TLS, and set the identical HTTPS origin in `AUTH_URL`.
- [ ] ID=PROD-3, Title=Capacity, Action=Set replicas, disruption policy, and CPU/memory requests from the derived application's measured load and availability target.
- [ ] ID=PROD-4, Title=Runtime database identity, Action=Provision a dedicated LOGIN role that inherits only `construct_runtime` and create the runtime `DATABASE_URL` from it.
- [ ] ID=PROD-5, Title=Migration identity, Action=Store `MIGRATION_DATABASE_URL` separately from runtime secrets and expose it only to the migration operation.
- [ ] ID=PROD-6, Title=Observability, Action=Route stdout/stderr to the chosen log platform and configure retention, access controls, alerts, and redaction checks.

## Pre-deployment

- [ ] ID=PROD-7, Title=Quality gate, Action=Run unit tests, integration tests against a disposable database, lint, production build, dependency audit, schema check, and Kubernetes validation.
- [ ] ID=PROD-8, Title=Database backup, Action=Create a provider snapshot or a consistent `pg_dump` with the migration identity and record its identifier and completion time.
- [ ] ID=PROD-9, Title=Restore readiness, Action=Confirm the backup can be selected for restore and identify who is authorized to approve a restore.
- [ ] ID=PROD-10, Title=Migration preview, Action=Review the ordered migration list and confirm no completed migration checksum has changed.

Example commands (environment variables must come from the operator's secret store):

```bash
pg_dump --format=custom --file=construct-before-deploy.dump "$MIGRATION_DATABASE_URL"
node sources/devops/db/db.mjs schema-check
node sources/devops/db/db.mjs apply
CONSTRUCT_RUNTIME_DB_USER=construct_app \
CONSTRUCT_RUNTIME_DB_PASSWORD='<secret-store-value-at-least-24-characters>' \
  node sources/devops/db/db.mjs provision-runtime-role
bash sources/devops/k8s/validate.sh
kubectl kustomize sources/devops/k8s/overlays/production-example
```

## Deployment

- [ ] ID=PROD-11, Title=Apply migrations, Action=Run the migration command once with the administrative secret and retain its migration/version output.
- [ ] ID=PROD-11A, Title=Migration job isolation, Action=If using `sources/devops/k8s/migrations/job.example.yaml`, copy it into the derived overlay, bind its operator-only secret, run it as a one-shot Job, inspect completion/logs, and delete the Job; never add that secret to the Deployment.
- [ ] ID=PROD-12, Title=Create runtime secret, Action=Create `web-construct-runtime-secret` with only runtime configuration and the limited `DATABASE_URL`; never include `MIGRATION_DATABASE_URL`.
- [ ] ID=PROD-13, Title=Apply overlay, Action=Apply the reviewed derived production overlay and wait for its rolling rollout.

```bash
kubectl -n construct create secret generic web-construct-runtime-secret \
  --from-env-file=runtime.env \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k sources/devops/k8s/overlays/production-example
kubectl rollout status deployment/web-construct -n construct --timeout=5m
```

## Post-deployment verification

- [ ] ID=PROD-14, Title=Liveness, Action=Verify `/api/health/live` returns HTTP 200 from the external route.
- [ ] ID=PROD-15, Title=Readiness, Action=Verify `/api/health/ready` returns HTTP 200 and every desired pod is Ready.
- [ ] ID=PROD-16, Title=Authentication, Action=Verify one configured provider, account deactivation, and administrator demotion behavior.
- [ ] ID=PROD-17, Title=Core flows, Action=Verify menu loading, role-based visibility, language switching, and one non-destructive administrative read.
- [ ] ID=PROD-18, Title=Telemetry, Action=Confirm application, readiness, authentication, and database logs arrive without secrets or raw tokens.

## Rollback and restore decision

- [ ] ID=PROD-19, Title=Application-only failure, Action=If migrations remain backward compatible, roll back the Deployment to the previous immutable image and repeat health/core-flow checks.
- [ ] ID=PROD-20, Title=Migration failure, Action=Stop rollout, preserve logs and the incomplete migration-history row, fix forward in a new migration, and never edit an applied migration.
- [ ] ID=PROD-21, Title=Destructive incompatibility, Action=If a verified migration caused unrecoverable data/schema damage, stop writers and obtain explicit restore approval before restoring the recorded backup.

```bash
kubectl rollout undo deployment/web-construct -n construct
kubectl rollout status deployment/web-construct -n construct --timeout=5m
```

Database restore is intentionally provider-specific. Document the exact Supabase/project restore procedure, expected recovery time, acceptable data-loss window, and approver in the derived application's runbook.

## Credential rotation

- [ ] ID=PROD-22, Title=Runtime rotation, Action=Create a new limited login/password, update the runtime secret, roll pods, verify readiness, then revoke the old login.
- [ ] ID=PROD-23, Title=Migration rotation, Action=Rotate the administrative database password in its operator-only secret store and verify migration connectivity without copying it into runtime configuration.
- [ ] ID=PROD-24, Title=Application secrets, Action=Rotate `AUTH_SECRET`, OIDC, mail, and TLS credentials according to provider-specific session and overlap requirements.
