# Construct

**Construct** is a production-ready application template built with Next.js 15 and React 19. Clone it, configure your providers, and start building your product — authentication, authorization, navigation, user profiles, and theming are already wired up.

Read also the ./CLAUDE.md file.

---

## What's Included

| Feature | Description |
|---|---|
| **Authentication** | OIDC login via Google, Keycloak, Microsoft Entra ID. Test credentials for local development. |
| **Authorization (RBAC)** | Role-based access control. Each user has a role (`admin` or `user`). Routes and menu items are filtered by role automatically. |
| **Dynamic Menu** | Database-driven navigation with support for nested items, icons, role visibility, drag-to-reorder, and collapsible sections. |
| **Menu Builder** | Admin UI to create, edit, reorder, and delete menu items without touching code. |
| **User Profile** | Each user can edit their first/last name, username, and phone number. Avatar and email come from the OIDC provider. |
| **Theming** | Customizable color palette (primary, sidebar, text, active states) stored per-user in the database. Dark mode supported. |
| **Protected Layout** | All routes are automatically protected. Unauthenticated users are redirected to login. |
| **Admin Panel** | Dedicated `/admin` area (role-gated at middleware level) for menu management and theme configuration. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, CSS custom properties |
| Icons | Lucide React |
| Drag & Drop | dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) |
| Authentication | Auth.js v5 (NextAuth) — OIDC providers |
| Password hashing | bcryptjs |
| HTML sanitization | isomorphic-dompurify |
| Database | PostgreSQL via Supabase (database only, not Supabase Auth) |
| Validation | Zod |
| Email | Nodemailer + Resend |
| Logging | Pino |
| Testing | Vitest (unit) + Python/Playwright via `uv` (E2E) |
| Deployment | Kubernetes — self-contained manifest directories per environment |

---

## Architecture

```
construct/
- sources/microservices/web-construct/  # Next.js 15 application
    - app/
        - login/                  # Login page (OIDC + test credentials)
        - api/auth/               # Auth.js route handler
        - (protected)/            # All protected routes
            - page.tsx            # Dashboard (home)
            - profile/            # User profile
            - admin/
                - menu-builder/   # Menu management
                - theme/          # Theme configuration
    - components/                 # React components (Sidebar, Login, ProfileForm, …)
    - context/                    # AuthContext, UIContext (theme + settings)
    - lib/                        # Server actions, services, Supabase client, Auth.js config
    - types/                      # TypeScript types
    - middleware.ts               # Route protection + admin RBAC enforcement
- sources/devops/
    - db/schema.sql               # Database schema (users + menu_items)
    - k8s/dev/                    # Kubernetes manifests — self-contained per environment
- sources/tests/e2e/              # Playwright E2E test suite
```

### Authentication Flow

1. Unauthenticated request → middleware redirects to `/login`
2. User chooses an OIDC provider → redirected to provider login
3. Provider callback hits `/api/auth/callback/[provider]`
4. Auth.js `jwt()` callback:
   - Upserts user in `users` table (email as unique key)
   - Assigns `role: 'user'` on first login
   - Stores `userId` and `role` in the JWT
5. `session()` callback exposes `session.user.id` and `session.user.role`
6. Middleware allows the request; protected layout loads menu filtered by role

### Authorization Model

Authorization is enforced at two levels:

- **Middleware** (`middleware.ts`): blocks `/admin/*` for non-admin users, redirects unauthenticated requests to `/login`
- **Menu visibility**: each menu item has a `roles: string[]` field; the sidebar renders only items where the user's role is included

Roles are stored in the `users.role` column. The default role on first login is `'user'`. To promote a user to admin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'user@example.com';
```

### Menu System

Menu items are stored in the `menu_items` PostgreSQL table and fetched server-side (with caching). Each item supports:

- **Type**: `link` (navigates to a route) or `container` (collapsible folder)
- **Position**: `top`, `main`, or `bottom` (sidebar sections)
- **Role visibility**: only shown to users whose role is in the `roles` array
- **Tree structure**: items can be nested via `parent_id`
- **Order**: drag-to-reorder (atomic DB update via RPC)
- **System items**: flagged items (admin panel, support) cannot be deleted via the UI

The Admin → Menu Builder page provides a full CRUD interface. No code changes needed.

### Theming

Theme configuration is a set of CSS custom properties (primary color, sidebar backgrounds, text colors, active item colors). The `UIContext` manages theme state client-side, persists to `localStorage`, and syncs to the `users.theme_config` column in the database. Dark mode is toggled by adding the `dark` class to `<html>`.

---

## Internationalization (i18n)

Every UI label in the app is resolved at render time through a database-backed dictionary — there is no i18n framework (`next-intl`, `i18next`, …) and no `[locale]` route segments; every route stays exactly where it is.

### Data model

Three tables in `sources/devops/db/schema.sql`:

| Table | Purpose |
|---|---|
| `app_language` | One row per language: `code` (lowercase BCP-47 primary subtag, e.g. `it`, `en`), `locale` (full BCP-47 tag for `Intl` formatting, e.g. `it-IT`), `name`, `native_name`, `is_active`, `is_default`, `dictionary_version` (bumped by trigger on every translation change). At most one row can have `is_default = true` (partial unique index); the default row can never be inactive. |
| `translation_key` | One row per translation key: `key` (dot-separated, e.g. `common.actions.save`), `namespace`, `module`, `description`, `version` (optimistic-lock counter for metadata edits). |
| `translation_value` | One row per key × language: `value` (plain text, max 1000 chars), `version` (optimistic-lock counter for the value itself). Unique on `(id_translation_key, id_language)`. |

`users.id_language` (FK to `app_language`, nullable) stores each user's saved preference. This is a separate concept from the pre-existing `navigation_item.item_translation` (content translations for menu items, keyed by the **uppercase** locale from `SUPPORTED_LOCALES` in `lib/rbac/types.ts`) — the protected layout bridges the two with `language.code.toUpperCase()`, falling back to `DEFAULT_LOCALE` when a newly added UI language has no matching content translations yet.

### Language resolution order

`lib/i18n/resolve-language.ts#resolveActiveLanguage` picks the active language in this order, skipping any candidate that is missing, deleted, or deactivated:

1. **session** — an explicit in-session switch (`construct_lang_session` cookie)
2. **profile** — the authenticated user's `users.id_language`
3. **cookie** — a persistent, 1-year `construct_lang` cookie (anonymous visitors)
4. **browser** — the `Accept-Language` header, negotiated against active languages
5. **default** — the `app_language` row with `is_default = true`

### Fallback chain

`lib/i18n/translator.ts#createTranslator` looks up each key in the active language's dictionary, then the **default** language's dictionary (so a missing `en` value falls back to `it` when `it` is the default), and finally renders `[missing: key]` in development or the bare key in production — `t()` never throws.

### Cache and invalidation

`lib/i18n/dictionary-service.ts` loads one dictionary per language per version and keeps it in an in-memory `DictionaryStore` (`lib/i18n/dictionary-cache.ts`). `app_language.dictionary_version` is bumped by DB triggers: a `translation_value` insert/update/delete bumps only the affected language; a `translation_key` insert/update/delete bumps **every** language's version (a key change reshapes every dictionary, even if only its description or namespace changed — a deliberately coarse invalidation in exchange for one trigger instead of per-column change detection). The service polls the version table on a short TTL and drops its cache for a language whenever the version it holds is stale; an admin's own edit invalidates synchronously so they see their change immediately.

### Admin pages

- **`/admin/languages`** — create, edit, activate/deactivate, delete, and set the default language.
- **`/admin/translations`** — a paged, filterable grid of every translation key with one column per active language; a drawer-based editor opens per key. Both the key's metadata (namespace/module/description) and each per-language value carry their own version, so editing metadata and editing a value's text are independent optimistic locks — a stale save (someone else edited first) shows a "Conflitto di modifica" banner with the saved value, the attempted value, and a reload action, instead of silently overwriting the concurrent edit.

### Adding a language

Use the **`/admin/languages`** UI — no schema or code change is needed. A newly added language has no translation values yet, so every key falls back to the default language until an admin fills in its values from `/admin/translations`.

### Adding a translation key

- **At seed time** — add a new entry to the relevant `apply_translation_seed(...)` call in `sources/devops/db/schema.sql` and re-run `node sources/devops/db/db.mjs apply`; the seed function is idempotent (existing keys/values are left untouched, only new ones are inserted).
- **At runtime** — use the "Nuova chiave" button on `/admin/translations`, which opens a modal to create the key (namespace, module, description) and then fill in its values from the editor drawer.

---

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (or local Supabase via CLI)
- At least one OIDC provider configured (or test credentials enabled for local dev)

### 1. Clone and install

```bash
git clone <repo-url> my-app
cd my-app
npm run install:all
```

### 2. Set up the database

Apply the schema to your database:

```bash
# Using Supabase CLI (local)
supabase db push --file sources/devops/db/schema.sql

# Or run the SQL directly in the Supabase dashboard / psql
psql $DATABASE_URL -f sources/devops/db/schema.sql
```

### 3. Configure environment variables

```bash
cp sources/microservices/web-construct/.env.template sources/microservices/web-construct/.env.local
```

Edit `.env.local`:

```env
# Database
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Auth.js
AUTH_SECRET=generate-with-openssl-rand-base64-32

# OIDC Providers (configure at least one, or enable test credentials)
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=

AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

AUTH_KEYCLOAK_ID=
AUTH_KEYCLOAK_SECRET=
AUTH_KEYCLOAK_ISSUER=

# Local development only
NEXT_PUBLIC_AUTH_TEST_MODE=true
AUTH_TEST_CREDENTIALS=true
```

### 4. Run

```bash
cd sources/microservices/web-construct
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login`.

---

## E2E Tests

Tests use Python + Playwright via `uv`:

```bash
# Run all tests
uv run pytest

# Run a specific suite
uv run pytest sources/tests/e2e/test_sidebar.py

# Coverage includes:
# - Authentication flow (redirect, provider buttons, test login)
# - RBAC (admin routes blocked for non-admin)
# - Sidebar navigation and active state highlighting
# - Profile form save
# - Menu Builder CRUD
```

---

## Adding New Pages

1. Create a new file under `sources/microservices/web-construct/app/(protected)/your-page/page.tsx` — it is automatically protected by the middleware.
2. Add a corresponding menu item via the Admin → Menu Builder UI (or directly in the DB).
3. Optionally restrict it to `admin` role by setting `roles: ['admin']` in the menu item.

No changes to middleware, layout, or navigation code required.

---

## Deployment

Kubernetes manifests are in `sources/devops/k8s/`. Each environment has its own self-contained directory with all the manifests it needs (Deployment, Service, ConfigMap, Ingress).

```
sources/devops/k8s/
└── dev/
    ├── deployment.yaml
    ├── service.yaml
    ├── configmap.yaml
    ├── ingress.yaml
    ├── secret.env.example   # copy to secret.env and fill in real values (gitignored)
    └── apply.sh             # creates namespace + secret + applies all manifests
```

Deploy to local Docker Desktop K8s:

```bash
cd sources/devops/k8s/dev
cp secret.env.example secret.env   # fill in real values
bash apply.sh
```

To add staging or prod, create `sources/devops/k8s/staging/` or `sources/devops/k8s/prod/` with their own set of files.

---

## Extending the Template

This template is intentionally minimal outside of its core features. When building your product on top of it:

- **New features** go under `app/(protected)/` — protected by default
- **Shared UI components** go in `components/`
- **Server actions** go in `lib/` — use Supabase service-role client from `lib/supabase-server.ts`
- **New roles** are managed in the Admin area (`/roles-permissions`): create a SERVICE role and grant it navigation permissions (the legacy single `users.role` string column has been replaced by the N:N `role` / `user_role` / `role_item` model)
- **New providers** can be added in `lib/auth.ts` following the existing pattern

---

## RBAC rollout note (CARRY-5)

The session JWT carries `roleIds` and `isAdmin`, populated at login. **Users who were logged in before the RBAC deploy hold a token without these claims** and fail closed — empty sidebar and no admin access — until their token refreshes or they log back in. This is safe (no privilege leak) but visible to active users during a rollout.

Mitigation when deploying RBAC to an environment with live sessions:

- **Preferred:** force re-authentication — set a short NextAuth session `maxAge` for the release window (so stale tokens expire quickly), or invalidate existing sessions, then restore the normal `maxAge`.
- **Minimum:** include a release note telling users to log out and back in once after the deploy.
