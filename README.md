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
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, CSS custom properties |
| Icons | Lucide React |
| Authentication | Auth.js v5 (NextAuth) — OIDC providers |
| Database | PostgreSQL via Supabase (database only, not Supabase Auth) |
| Validation | Zod |
| Testing | Python + Playwright (E2E), via `uv` |
| Deployment | Kubernetes (overlays for dev / staging / prod) |

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
- deploy/
    - db/schema.sql               # Database schema (users + menu_items)
    - k8s/                        # Kubernetes manifests (base + dev/staging/prod overlays)
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
supabase db push --file deploy/db/schema.sql

# Or run the SQL directly in the Supabase dashboard / psql
psql $DATABASE_URL -f deploy/db/schema.sql
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

Kubernetes manifests are in `deploy/k8s/` with base configuration and environment overlays:

```
deploy/k8s/
- base/web/       # Base K8s manifests
- overlays/
    - dev/
    - staging/
    - prod/
```

Apply with:

```bash
kubectl apply -k deploy/k8s/overlays/prod
```

---

## Extending the Template

This template is intentionally minimal outside of its core features. When building your product on top of it:

- **New features** go under `app/(protected)/` — protected by default
- **Shared UI components** go in `components/`
- **Server actions** go in `lib/` — use Supabase service-role client from `lib/supabase-server.ts`
- **New roles** can be added by extending the `users.role` column and updating the middleware RBAC check
- **New providers** can be added in `lib/auth.ts` following the existing pattern
