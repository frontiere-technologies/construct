# Local Docker Compose with Supabase — Design

## Summary

Add a root-level `compose.yaml` that runs only the existing Next.js application image. PostgreSQL remains hosted by Supabase and is reached through the Supavisor transaction pooler; Docker Compose does not start a database or any other supporting service.

The README will become the operational source of truth for this workflow. Historical Kubernetes planning documents are not part of the supported Docker Compose instructions.

## Scope

- [ ] ID=DOC-1, Title=Compose definition, Fix description=Add a root-level `compose.yaml` with one `web` service built from the existing web application Dockerfile.
- [ ] ID=DOC-2, Title=Runtime environment, Fix description=Load runtime settings from an untracked `sources/microservices/web-construct/.env.docker.local` file created from `.env.template`.
- [ ] ID=DOC-3, Title=Supabase database, Fix description=Document that `DATABASE_URL` points to a limited runtime login through the Supavisor transaction pooler and that owner-level migrations continue to run from the host.
- [ ] ID=DOC-4, Title=Local lifecycle, Fix description=Document build, start, readiness verification, log inspection, stop, and rebuild commands in the README.
- [ ] ID=DOC-5, Title=Secret safety, Fix description=Ignore `.env.docker.local` and never commit real database, authentication, OIDC, or mail credentials.

## Compose topology

`compose.yaml` contains a single service named `web`:

- build context: `sources/microservices/web-construct`;
- Dockerfile: the existing multi-stage `Dockerfile` in that context;
- image: a stable local image name;
- published port: host `3000` to container `3000`;
- environment: `sources/microservices/web-construct/.env.docker.local`;
- health check: the database-aware `/api/health/ready` endpoint;
- restart behavior: no automatic production-style restart policy for the interactive local workflow.

No Compose volume is required because the container is a production standalone build rather than a hot-reload development server. Source changes require `docker compose up --build`.

## Configuration and data flow

The operator copies `.env.template` to `.env.docker.local`, then sets at minimum:

- `DATABASE_URL` to the Supabase Supavisor transaction-pooler connection string using the limited runtime role;
- `AUTH_SECRET` to a generated secret;
- `AUTH_URL` to `http://localhost:3000`;
- at least one OIDC provider, with callbacks configured for the localhost origin;
- mail settings when invitation or password-reset delivery is needed.

The browser connects only to the local Next.js container. Server-side application code connects from that container to Supabase over the public pooler endpoint. Supabase Auth and PostgREST are not used.

Schema migrations and runtime-role provisioning remain operator actions on the host. `MIGRATION_DATABASE_URL` is not passed to the long-running web container.

## Failure handling

`docker compose ps` reports the service as healthy only after `/api/health/ready` can reach the database. A failed health check does not expose migration credentials or mutate the database. Troubleshooting instructions direct the operator to `docker compose logs web` and to validate the Supabase connection string, network reachability, and application secrets.

## Verification

- [ ] ID=VER-1, Title=Compose parse, Fix description=Run `docker compose config` with a temporary non-secret environment file and confirm that the model is valid.
- [ ] ID=VER-2, Title=Documentation contract, Fix description=Run the repository documentation contract tests.
- [ ] ID=VER-3, Title=Secret exclusion, Fix description=Confirm Git ignores the real `.env.docker.local` path while keeping `.env.template` tracked.

Building and starting the image against a real Supabase project is an optional manual integration check because it requires user-owned external credentials and network access.
