# SDD ledger — plan: docs/superpowers/plans/2026-10-26-multi-tenancy-piece-5a-platform.md

Branch feature/multi-tenancy-piece-5a from development 187a15a; 1d3b556 docs (spec, plan, roadmap); 9670407 ci push trigger (TS-8, outside the plan).
Spec: docs/superpowers/specs/2026-10-26-multi-tenancy-piece-5a-platform-design.md (binding). Code map: <workspace>/code-map.md.

## Pre-flight scan

| Rows | Produces → consumes / self-check | Finding |
|---|---|---|
| T1→T5,T10 | tenant_audit_event / platform_audit_event, read-tenant-audit | consistent |
| T1→T6 | platform_audit_event written by construct_owner (commands) | consistent (owner full access) |
| T1→T4 | users.is_platform_admin → snapshot | consistent |
| T3→T5,T7,T8,T10 | withPlatform/PlatformTx | consistent; T5 recordPlatformAudit tx type unspecified (see R3) |
| T4→T5,T7…T10 | PlatformActor, requirePlatformAdmin(Page) | consistent |
| T5→T9 | auditActorOf gives 'platform' in support: T5 cannot know support state | T9 extends auditActorOf; ok |
| T4/T10 actor.ts | T4 adds isPlatformAdmin; T10 removes default-tenant rule | sequential, ok |
| T7 layout links vs T10 pages | T7 lists Registro, Lingue, Traduzioni; pages only in T10 | R4 |
| T7 listTenantsForPlatform | counts members/admins across tenants; forced RLS also binds construct_owner | R5 |
| T8→T9 TenantDetail | T9 modifies T8 component | sequential, ok |
| T7/T8/T9/T10 migrations | 0059 then "next free number" | ok, sequential |
| T11 CI | quality.yml must provision construct_platform | ok (T11 owns it) |
| T1 self | tests vs migration, files consistent | ok |
| T2 self | fixture needs test-apply --to 0057 | ok |
| T3 self | env PLATFORM_DATABASE_URL + TEST_PLATFORM_DATABASE_URL; local DB must provision it too | R2 |
| T4…T10 self | ok | — |
| T12 | dev DB only after merge + explicit yes | stop point (non-negotiable) |
| plan header | code map path `.superpowers/sdd/piece-5a/code-map.md` moved | R1 |
| code map §KEY/§4 | suggests SECURITY DEFINER functions | contradicts spec/plan (construct_platform identity): R6 |

## Rulings
- Ruling: R1 code map lives at <workspace>/code-map.md; dispatches give that path — why: plan's path moved into the plan workspace — cost if wrong: none.
- Ruling: R2 integration tests and test-apply run against the local Docker Postgres (`set -a && . sources/devops/db/local-test.env && set +a`, port 55432), not the remote test DB; Task 3 must make local-test-db.sh provision construct_platform and export TEST_PLATFORM_DATABASE_URL in local-test.env, as it does for construct_app — why: TS-1 made local runs 20x faster and is the same shape as CI; the remote DB stays untouched — cost if wrong: a Supabase-only difference surfaces in CI (still runs on real postgres:17) rather than locally.
- Ruling: R3 recordPlatformAudit accepts both the runtime global tx (withGlobal, insert-only for i18n, MT5-DEC-24) and PlatformTx — why: spec has i18n writes on the app role and console writes on the platform identity — cost if wrong: a type widened by one member.
- Ruling: R4 Task 7 sidebar "Piattaforma" shows only Tenant and Amministratori; Task 10 adds Registro, Lingue, Traduzioni with their pages — why: no links to pages that do not exist yet — cost if wrong: none, final state identical.
- Ruling: R5 listTenantsForPlatform may count members/admins per tenant inside one withPlatform transaction by setting and restoring app.tenant_id per tenant (or a security invoker SQL function doing the same); only counts and admin emails leave the tenant (MT5-OK-2 note) — why: forced RLS binds construct_owner too, there is no cross-tenant read — cost if wrong: one extra query per tenant on a small list.
- Ruling: R6 ignore the code map's SECURITY DEFINER suggestions; the spec §2.2 chooses the construct_platform identity — why: spec is binding and piece 1 forbids definer functions — cost if wrong: none.

## Tasks
Task 1: dispatched (BASE 9670407, sonnet)
Task 1: implementer DONE_WITH_CONCERNS 33b327b (5 concerns, see report); review dispatched (opus)
Task 1: review — spec ✅, quality Needs fixes (I1 runtime can write users.is_platform_admin; I2 append-only probes miss column-level and references/trigger grants)
- Ruling: T1-I1 guard users.is_platform_admin with a BEFORE INSERT OR UPDATE trigger (security invoker, search_path '') that refuses setting/changing it unless pg_has_role(current_user,'construct_owner','USAGE'), plus contract/boundary-check probes for the trigger — why: column-level grants would break Drizzle inserts (Drizzle lists every column with DEFAULT), and the attribute unlocks the platform identity (MT5-RISK-1) — cost if wrong: one trigger on users; a write path through the owner identity is needed anyway (Tasks 6, 7).
Task 1: minor (deferred): declare_global_insert_only_table duplicates half of declare_global_table; sequence trim outside the function
Task 1: minor (deferred): append-only list hard-coded in contract test and db.mjs
Task 1: minor (deferred): boundary-check fails on the dev DB until 0057 is applied — Task 12 brief must run it after apply
Task 1: minor (deferred): identity sequence usage grant redundant, comment overstates it
Task 1: minor (deferred): platform_audit_event FK without on delete blocks hard-deleting a tenant with platform audit rows (implicit; relevant to 5b deletion DEF-5.9)
Task 1: minor (deferred): contract does not check index sort order
Task 1: fix round 1 implemented b5a28f0; carry to Task 6: commands setting is_platform_admin must run under set local role construct_owner (trigger)
Task 1: fix round 1/5 (4 addressed, 0 open; commits 33b327b..b5a28f0)
Task 1: minor (deferred): runtime update-refusal assertions check only 42501, not the message; no ON CONFLICT DO UPDATE test; probe indentation in db.mjs/contract
Task 1: out-of-scope: guard keys on current_user — a future SECURITY DEFINER owned by construct_owner writing users would bypass it (none today)
Task 1: complete (commits 9670407..b5a28f0, review clean)
Task 2: dispatched (BASE f270441, sonnet)
Task 2: implementer DONE 132e46b
- Ruling: T2 0058 gives REGISTERED to every holder of role 2 lacking it, not only active members — why: a deactivated member regaining access must not come back roleless; REGISTERED grants nothing while the membership is deactivated — cost if wrong: an extra base-role row for deactivated members.
Task 2: review — spec ✅ (deviation: committed test re-runs the migration text on a migrated DB instead of a test-apply --to 0057 fixture; real 0057→0058 flow checked manually per report), quality Approved
- Ruling: T2 keep the committed test without the --to fixture — why: the real old-DB path was checked by hand and the dev DB (0056) will run 0058 for real in Task 12 with boundary-check; a --to fixture would need a second DB or a destructive rebuild inside the suite — cost if wrong: an old-DB-only bug shows up at the Task 12 rollout, not in tests.
Task 2: minor (deferred): no guard if a tenant lacked REGISTERED (holders would lose their only role silently; impossible today)
Task 2: minor (deferred): test 3 checks restore only from empty app.tenant_id; depends on test 2 state; re-applies migration text (destructive on an unmigrated DB)
Task 2: minor (deferred): live docs under docs/input-specs still list the role
Task 2: complete (commits f270441..132e46b, review clean)
- Ruling: R7 Task 3 also provisions construct_platform in CI (.github/workflows/quality.yml) and exports TEST_PLATFORM_DATABASE_URL there, moved forward from Task 11 — why: Task 3 adds an integration test that needs the identity, CI would be red from Task 3 to Task 11 — cost if wrong: none.
Task 3: dispatched (BASE 681764c, sonnet)
Task 3: implementer DONE_WITH_CONCERNS 149a899
- Ruling: T3 no separate test-provision-platform-role command; CI and local-test-db.sh run provision-platform-role with MIGRATION_DATABASE_URL on the test DB — why: matches the existing runtime-role pattern (no test-provision-runtime-role exists) — cost if wrong: one more command to add later.
- Ruling: T3 client in lib/db/platform-database.ts with lib/platform/db.ts as the door — why: the tenant-boundary guard confines the driver and the app.tenant_id string to lib/db; the platform-boundary guard and ESLint cover both modules — cost if wrong: one extra file to reach the identity, still guarded.
Task 12 note: operator.env.example sets CONSTRUCT_PLATFORM_DB_USER, so boundary-check FAILs on dev if the role is absent — provision construct_platform on dev before boundary-check (after the user's OK).
Task 3: review dispatched (opus, package review-681764c..149a899.diff)
Task 3: review — spec ✅, quality Needs fixes (I1: guard skips root files like proxy.ts; minors 2–8)
- Ruling: T3 fix round 1 covers I1 plus minors 2,3,4,5,6,8 — why: all cheap and on the security door; 7 (boundary-check in CI) is a pre-existing gap — cost if wrong: a slightly larger fix diff.
Task 3: minor (deferred): boundary-check never runs in CI (pre-existing gap) — consider for Task 11 or the final review
Task 3: minor (deferred): README still names the remote Supabase test DB as default; lib/platform/db.integration.test.ts throws there until construct_platform is provisioned on it — document in Task 11 docs
Task 3: fix round 1/5 dispatched (resume implementer, brief task-3-fix-1.md)
Task 3: fix round 1 implementer DONE 6385fb1 (runtime negative CI steps left as-is; post-grant check platform-only, tolerates PG16 creator admin-only membership)
Task 3: re-review dispatched (sonnet, package review-149a899..6385fb1.diff)
Task 3: re-review round 1 — items 1,2,4,5,6,8 ✅; item 3 open (reverse-membership exemption too broad: any member/grantor with inherit=false,set=false passes; ADMIN on the login lets a role grant itself SET and reach construct_owner)
- Ruling: T3 narrow the exemption to member = current_user (the provisioning identity that created the login), admin_option true, inherit false, set false, grantor = bootstrap superuser (oid 10); any other reverse row fails closed — why: only the PG16 automatic creator grant is legitimate, and the creator already holds owner-level power — cost if wrong: provisioning fails on a DB where the login was created by a different identity; fix is to drop and re-provision.
Task 3: minor (deferred): eslint reopen block also unblocks lib/db/**/*.test.ts for @/lib/platform/db (guard still catches); lib/platform .test.tsx not reopened
Task 3: fix round 2/5 dispatched (resume implementer, brief task-3-fix-2.md)
Task 3: fix round 2 implementer DONE 618f697 (grantor oid 10 verified locally; foreign ADMIN, creator set=true, creator without admin each refused by hand)
Task 12 note: re-running provisioning as a non-superuser operator stops at `alter role ... nobypassrls noreplication` ("permission denied to alter role") — pre-existing for the runtime login; check before provisioning construct_platform on the Supabase dev DB.
Task 3: re-review round 2 dispatched (sonnet, package review-6385fb1..618f697.diff)
Task 3: re-review round 2 — item 3 ✅, all findings addressed
Task 3: minor (deferred): foreign reverse-row refusals checked by hand only (CI runs as superuser); fails closed on re-provisioning by a different operator / createrole_self_grant set
Task 3: complete (commits 681764c..618f697, review clean after 2 fix rounds)
Task 4: dispatched (BASE 1330188, sonnet)
- Ruling: T4 requirePlatformAdmin* re-read is_platform_admin through the normal app connection, never withPlatform — why: the guard decides whether the platform door may open; the platform-boundary guard forbids lib/rbac importing it — cost if wrong: none (users is readable by the runtime today).
- Ruling: T4 isPlatformAdmin joins the existing AuthorizationSnapshot statement; the session flag is a display/routing hint only; dedicated host = not admitted (error for actions, notFound for pages) — why: spec §3.1 + round-trip caps — cost if wrong: an extra query on the ready path.
Task 4: implementer DONE_WITH_CONCERNS 30f4465 (+5b4d008 plan tick by implementer)
- Ruling: T4 accept the extra files lib/tenancy/token-tenant.ts (isPlatformAdmin in the token for the proxy) and lib/rbac/platform-admin.ts (guard DB read) — why: the proxy reads the token, and isolating the read keeps auth-guard unit tests connection-free — cost if wrong: two small files to fold back.
- Ruling: T4 the proxy admits /platform to a flagged token on a dedicated host; requirePlatformAdminPage answers 404 there — why: the proxy cannot read the host registry; the page guard is the real gate (spec §3.1) — cost if wrong: a 404 instead of a redirect on a dedicated host.
Task 4: review dispatched (opus, package review-1330188..30f4465.diff)
Task 4: review — spec ❌ (token hint ignores host: platform admin in state none on a dedicated host is forced to /platform → 404, loses /no-tenant and its sign-out; contradicts MT5-DEC-3), quality Needs fixes; no security hole
- Ruling: T4 fix round 1 = the Important (hint false on a dedicated host, computed server-side in the non-ready paths at no extra trip; test) + minors: guard as one statement wrapped in cache(), deleted-user guard case, jwt-side round-trip check — why: all cheap; lateral-join rewrite is cosmetic and skipped — cost if wrong: small extra diff.
Task 4: minor (deferred): snapshot SQL has three users subselects (cosmetic); null/invalid Host counts as main address (app-wide rule, deliberate)
Task 4: note: until Task 7 lands /platform, platform admins in state none hit a 404 — do not ship without Task 7
Task 4: fix round 1/5 dispatched (resume implementer, brief task-4-fix-1.md)
Task 4: fix round 1 implementer DONE_WITH_CONCERNS ba4f779
- Ruling: T4 leave the hint true in state ready on a dedicated host — why: ready is not forced to /platform (home stays the tenant), only a direct visit 404s; ready-path caps stay untouched — cost if wrong: a 404 on a manual URL.
Carry to Task 7: the sidebar/console entry must show only on the main address (hint alone is true in ready on a dedicated host).
Task 4: re-review round 1 dispatched (sonnet, package review-5b4d008..ba4f779.diff)
Task 4: re-review round 1 — items 1-4 ✅, all findings addressed
Task 4: minor (deferred): jwt-side is_platform_admin count assertion never shown red in isolation (cap tripped first)
Task 4: complete (commits 1330188..ba4f779, review clean after 1 fix round; plan ticked in 5b4d008)
Task 5: dispatched (BASE ba4f779, sonnet)
- Ruling: T5 auditActorOf maps Actor→person, PlatformActor→platform; the support case is left to Task 9 at one marked place — why: support state does not exist yet — cost if wrong: Task 9 edits one function.
- Ruling: T5 the implementer ticks MT5-OK-1/RISK-3/RISK-4 in the spec in the feature commit and the plan steps in a separate tick commit — why: plan Step 5 asks for it; AGENTS.md ✅ rule — cost if wrong: ticks to revert if the review fails.
Task 5: INTERRUPTED by the user (had to leave) — implementer stopped at RED stage (helpers + coverage test written, roles-actions partly wired, nothing committed). WIP saved in `git stash` "piece-5a task 5 WIP (interrupted 2026-10-27, RED stage)"; working tree clean at ba4f779.
Task 5 RESUME: re-dispatch Task 5 from BASE ba4f779 with the same dispatch (brief task-5-brief.md, rulings above); tell the implementer the stash exists and it may `git stash pop` it and continue from RED, or drop it and start fresh. Its report file task-5-report.md may be missing or partial.
Task 5: re-dispatched after interruption (BASE ba4f779, sonnet; told about stash@{0}; local Docker DB rebuilt via local-test-db.sh up)
Task 5: implementer DONE_WITH_CONCERNS a88a12d (+b0c22c4 plan tick); stash@{0} popped
- Ruling: T5 accept the guard touches (i18n-key-inventory file list for key-shaped operation codes; docs-contract asserts the new audit contract) and prepareInvitation's optional inTenant parameter — why: forced by removing lib/i18n/audit.ts and by the same-transaction rule — cost if wrong: small reverts.
- Ruling: T5 leftover platform_audit_event rows written by older integration tests are accepted on disposable test DBs — why: the table is insert-only by design (MT5-DEC-15); cleanup would need owner rights in every test — cost if wrong: growing rows in local/CI test DBs, reset by local-test-db.sh reset.
Task 5: review dispatched (opus, package review-ba4f779..a88a12d.diff)
Task 5: review — spec ❌ (sign-in auto-join in the jwt callback creates default-tenant membership + REGISTERED role with no audit row, hidden behind the nextauth exemption), quality Needs fixes
- Ruling: T5 audit the jwt auto-join: member.join (and member.roles when REGISTERED is inserted) in the same tx, actor kind person = the signing-in user — why: MT5-DEC-14 excludes the sign-in event, not membership/role rows it creates; register writes member.join for the same thing — cost if wrong: one extra audit row per first sign-in.
- Ruling: T5 fix round 1 also takes minors 1 (addUserByEmail: prepareInvitation inside the same withTenant), 2 (doc comment on the duplicate member.join race), 3 (assert idTenant null on i18n rows), 4 (auditActorOf by explicit field, not 'email' in actor); minor 5 skipped — why: cheap, and 4 protects Task 9 — cost if wrong: small extra diff.
Task 5: fix round 1/5 dispatched (resume implementer, brief task-5-fix-1.md)
Task 5: fix round 1 implementer DONE b98f594 (member.join detection via created_at = now() in the snapshot statement; new prepareInvitationIn(tx))
Task 5: re-review round 1 dispatched (sonnet, package review-b0c22c4..b98f594.diff)
Task 5: re-review round 1 — items 2-5 ✅; item 1 open: live first sign-in creates the membership in enterTenant's own earlier transaction (token-tenant.ts:98-99), so created_at = now() in the later resolveUserAuthorization tx is false → no member.join; the coverage case bypasses enterTenant
Task 5: fix round 2/5 dispatched (resume implementer, brief task-5-fix-2.md)
Task 5: fix round 2 implementer DONE cf6374d (member.join written by ensureDefaultMembership in the creating statement via snapshot subselect; created_at=now() column removed)
Task 5: re-review round 2 dispatched (sonnet, package review-b98f594..cf6374d.diff)
Task 5: re-review round 2 — item 1 ✅, all findings addressed
Task 5: minor (deferred): concurrent first sign-ins of the same user can write member.join twice (same class as the documented registration race; a created flag from the function would need a migration)
Task 5: minor (deferred): most refusal cases are refused by the guard before the transaction (in-tx refusal only for updateUserRoles + generic rollback test)
Task 5: complete (commits ba4f779..cf6374d, review clean after 2 fix rounds; plan ticked in b0c22c4; spec MT5-OK-1/RISK-3/RISK-4 ticked)
Task 6: dispatched (BASE cf6374d, sonnet)
- Ruling: T6 platform-admin-add/remove are idempotent no-ops (exit 0, no audit row) when nothing changes; remove of the last admin fails under a lock; command audit rows are written by SQL in db.mjs with the same operation codes as lib/audit, no link/token/password in details — why: no change = no row (MT5-DEC-14); db.mjs cannot import TS — cost if wrong: codes duplicated between .mjs and TS (a contract test could pin them later).
- Ruling: T6 implementer runs only test-* command variants against the local Docker DB — why: the non-test commands target the development DB (user's explicit-confirmation rule) — cost if wrong: none.
Task 6: implementer DONE_WITH_CONCERNS e257a0b (+7ca80fb plan tick)
- Ruling: T6 accept: link also for an existing account without password (same rule as register_tenant_admin); last-admin count = other active admins; add refuses a deactivated account; USER/LOGNAME in the env-contract allow-list — why: consistent with tenant-create and safe — cost if wrong: small behavior tweaks.
Task 6: review dispatched (opus, package review-cf6374d..e257a0b.diff)
Task 6: review — spec ❌ (test-tenant-delete now fails on the platform_audit_event.id_tenant FK for tenants made by test-tenant-create/host-add → breaks E2E setup after one run), quality Needs fixes; duplicated token insert matches the original except the clock source
- Ruling: T6 fix round 1 = Important (test-tenant-delete removes the tenant's platform_audit_event rows first + integration case) + minors 1 (DB clock for token timestamps), 3 (recovery note for the admin-unflagging test), 4 (README line on deactivated last admin), 5 (alphabetical order); minor 2 skipped (same pattern as tenant-create) — why: cheap, 1 is a real E2E break — cost if wrong: none.
Task 6: deferred (spec owner / final review): deleting a REAL tenant will hit the same platform_audit_event.id_tenant FK (no ON DELETE); audit rows meant to outlive the tenant suggest dropping the FK or on delete set null — no tenant deletion in piece 5a
Task 6: deferred: sharing the invitation-token insert (app_private.issue_invitation_token) needs a migration — later
Task 6: fix round 1/5 dispatched (resume implementer, brief task-6-fix-1.md)
Task 6: fix round 1 implementer DONE d5baa6b (restore file for unflagged admins in OS temp dir)
Task 6: re-review round 1 dispatched (sonnet, package review-7ca80fb..d5baa6b.diff)
Task 6: re-review round 1 — items 1-5 ✅, all findings addressed
Task 6: minor (deferred): stale restore file could re-flag ids deliberately unflagged since (test DB only); account-existed race as in tenant-create
Task 6: complete (commits cf6374d..d5baa6b, review clean after 1 fix round; plan ticked in 7ca80fb)
Task 7: dispatched (BASE d5baa6b, sonnet)
- Ruling: T7 the "Piattaforma" entry in (protected)/layout shows only for a DB-confirmed platform admin on the main address (server-side, not the session hint); console layout + every page/route/action guard themselves; platform-admin actions mirror the Task 6 command rules and reuse prepareInvitationIn — why: carry from Task 4; layouts don't protect route handlers — cost if wrong: one extra read in the protected layout.
Task 7 note: UI verified by unit tests here; browser check of the console happens with the E2E in Task 11 (memory: verify frontend in the browser).
Task 7: implementer DONE_WITH_CONCERNS bc63783 (+815cb37 plan tick); 0059 = 166 keys + app_private.platform_tenant_counts (security invoker)
- Ruling: T7 accept the extra small files (grid query/schema, admin service, menu, access, datasource, status badge, mainBaseUrl, sendMainAddressInvitationEmail, prepareInvitationIn widened to PlatformTx) — why: existing grid/service patterns — cost if wrong: folding later.
- Ruling: T7 member/admin counts not sortable/filterable; host filter on primary host only — why: counts are per tenant after paging (R5) — cost if wrong: a later enhancement.
Task 7: deferred: a new platform admin whose invite email fails stays admin with invited:false and no resend path (db.mjs add is a no-op for an existing admin) — consider in final review
Task 7: review dispatched (opus, package review-d5baa6b..bc63783.diff); controller runs npm run build
Task 7: npm run build exit 0 (controller)
Task 7: review — spec ✅, quality Approved (runtime cannot execute platform_tenant_counts, checked on local DB)
- Ruling: T7 carry minors 1 (failed platform-admin invite email: distinct result + message; forgot-password does NOT recover an account without password), 2 (last-admin hint visible/aria, not title on a disabled button) and 4 (close/clear the add dialog on success) into the Task 8 dispatch — why: Task 8 touches the console and adds invite-resend; avoids a fix round on an approved task — cost if wrong: Task 8 diff slightly larger.
Task 7: minor (deferred): guard runs twice on a grid request (route + service, defence in depth); "Piattaforma" entry needs token recalculation after promotion (MT5-OK-5) — one line in user docs (Task 12)
Task 7: complete (commits d5baa6b..bc63783, review clean; plan ticked in 815cb37)
Task 8: dispatched (BASE 815cb37, sonnet; carries Task 7 minors 1, 2, 4)
- Ruling: T8 invitation token created inside the action's withPlatform transaction (prepareInvitationIn), email after commit to the tenant host; delivery status must not say 'sent' before sending (new SQL function in 0060 allowed) — why: Task 5 same-transaction rule; plan's "prepareInvitation after commit" would leave an unaudited token write outside the tx — cost if wrong: a slightly different call order from the plan text.
- Ruling: T8 console actions reuse the SQL functions db.mjs uses (copy_tenant, register_tenant_admin, host rules) — why: one implementation of piece-4 rules — cost if wrong: none.
- Ruling: T8 restore from archived needs an explicit confirmation flag in the action input, not only UI — why: MT5-DEC-8 "solo con conferma esplicita" must hold server-side — cost if wrong: one extra parameter.
Task 8: implementer DONE_WITH_CONCERNS 4f28775 (+a957d77 plan tick); 0060 added; build exit 0
- Ruling: T8 accept {ok:false, reason} results for expected refusals (production masks thrown messages), confirmRestore 4th param, and the extra rules (default tenant and template cannot be suspended/archived/given hosts; dedicated host = AUTH_URL host refused; archived→suspended only via restore) — why: protect the shared tenants and the main address — cost if wrong: small relaxations later.
Task 8: review dispatched (opus, package review-815cb37..4f28775.diff)
Task 8: review — spec ✅, quality Approved (0060 grants probed on local DB; reactivation via Riprova accepted as piece-4 behaviour)
- Ruling: T8 a short polish round on the approved task for minors 1 (resend checks active account), 2 (enterTenant takes TenantId; platform-tenant.ts import restricted to lib/platform), 4 (comment), 5 (one refusal reason for the main address), 6 (tenant name cell is a Link), 7 (route-level register test vs suspended tenant), 9 (shadcn Checkbox), and the 0060 comment correction from 3 — why: cheap, 1/2 are defence in depth on the tenant boundary — cost if wrong: one extra review round.
Task 8: deferred: register_tenant_admin and db.mjs tenant-create still have their own logic (fork of enroll_tenant_admin / create_platform_tenant) — unify in a later migration
Task 8: fix round 1/5 dispatched (resume implementer, brief task-8-fix-1.md)
Task 8: fix round 1 implementer DONE 047cf0f (no shadcn Checkbox in components/ui → raw checkbox kept; 0060 not edited because of migration checksums, note above runTenantCreate)
Task 8: re-review round 1 dispatched (sonnet, package review-a957d77..047cf0f.diff)
Task 8: re-review round 1 — items 1-8 ✅, all findings addressed
Task 8: minor (deferred): no shadcn Checkbox in components/ui (raw checkbox in AddHostDialog); getTenantForPlatform does withGlobal existence check then withPlatform (two trips, row re-read inside)
Task 8: complete (commits 815cb37..047cf0f, review clean after 1 polish round; plan ticked in a957d77; MT5-OK-3 ticked for the non-browser part)
Task 9: dispatched (BASE 047cf0f, opus — most security-sensitive task, auth/token/actor judgment)
- Ruling: T9 tenant data during support goes through the normal app connection (withTenant, RLS on the supported tenant), never withPlatform; support actor = TENANT_ADMIN permissions minus consent management, with an explicit support discriminator for auditActorOf (kind platform) — why: keeps one data path and RLS as the boundary — cost if wrong: none expected.
- Ruling: T9 revalidation on every support request in ONE statement (consent valid or template, tenant active, attribute + account active, main host); ready-path caps unchanged; consent durations from the DB clock; tests move the clock in the DB, never sleep — why: MT5-RISK-2 — cost if wrong: one statement per support request.
Task 9: implementer DONE_WITH_CONCERNS 5dfd174 (+195bc77 plan tick); 0061 adds 2 keys; support-path cap 5; build exit 0
- Ruling: T9 accept: support actor keeps manage-tenant-settings with explicit refusal of the consent actions when actor.support is set; no support.exit row on automatic end (expiry/revocation/suspension/attribute loss have their own rows); entering support requires a support.enter row of this person in the last 2 minutes with no exit (server-side proof against a client-driven session update) — why: MT5-DEC-20 + no extra trip per request — cost if wrong: the reviewer must confirm the proof cannot be replayed or forged.
Task 9: review dispatched (opus, package review-047cf0f..5dfd174.diff); interrupted by usage limit, resumed 2026-10-28
Task 9: review — spec ❌ (Important-1: a dormant support token resumes under a LATER grant without a fresh support.enter — the entry is bound to the person's last enter/exit row, not to the current grant), quality Needs fixes; no Critical (client update, forgery, dedicated host, actor, audit attacks all fail)
- Ruling: T9 bind the open entry to the current grant (enter occurred_at >= support_granted_at for non-template tenants) and close it on a later support.revoke or tenant.status row, sharing the closing rule with readSupportInProgress; extending consent therefore ends support and the admin re-enters — why: MT5-RISK-2, one entry per consent, tenant sees the truth — cost if wrong: one extra click after the tenant extends consent.
- Ruling: T9 fix round also takes minors 1 (support actor cannot change membership/roles targeting its own user id — no durable self-access), 3 (SupportDialog shows enter_error when state !== 'support'), 4 (hide tenant switcher in support), 6 (aligned by the shared closing rule); minor 2 (DB trigger reserving support.* operations) and 5 (repeated statement) deferred — why: 1 closes durable access beyond consent cheaply — cost if wrong: support cannot add the admin to the tenant, which it should not.
Task 9: fix round 1/5 dispatched (resume implementer, brief task-9-fix-1.md)
Task 9: fix round 1 implementer DONE 0df6135
- Ruling: T9 accept that a support actor can still invite another email it controls or grant permissions to roles — why: these are TENANT_ADMIN powers the tenant consented to, audited as kind platform and visible to the tenant — cost if wrong: document in the user docs (Task 12) that consent gives full admin power for its duration.
Task 9: re-review round 1 dispatched (opus, package review-195bc77..0df6135.diff)
Task 9: re-review round 1 — items 1-4 ✅, all findings addressed (closing by id, grant-bound, shared ENTRY_STILL_OPEN)
Task 9: minor (deferred): a dormant TEMPLATE support token resumes for the JWT lifetime (no consent needed, other conditions revalidated); DB trigger reserving support.* operations; statement repeated ~3x per support page request
Task 9: complete (commits 047cf0f..0df6135, review clean after 1 fix round; plan ticked in 195bc77; MT5-RISK-2 ticked)
Task 10: dispatched (BASE 0df6135, sonnet)
- Ruling: T10 tenant audit read via withTenant + read-tenant-audit (includes support rows); platform audit page reads only platform_audit_event via withPlatform, template's tenant audit only on the template page; platform readers live under lib/platform (guard); i18n writes need requirePlatformAdmin (replaces the "default tenant only" rule), tenant i18n pages read-only; "Registro" menu entry in 0062 for default, template and every tenant — why: MT5-DEC-16/17/21/24, R4 — cost if wrong: none expected.
Task 10: implementer DONE_WITH_CONCERNS 19b3a91 (+b42612a plan tick); TDD partial (two RED states captured); build exit 0 (26 known theme lines)
- Ruling: T10 accept platform readers in lib/platform/audit-service.ts, tenantName extra on AuditRow, template audit via scope 'template' on the platform audit route, unused key platform.tenant.detail.events — why: guard boundary, small extras — cost if wrong: small cleanups.
Carry to Task 11: sources/tests/e2e/test_i18n.py uses the removed tenant translation create/edit pages and language writes — move to /platform/... with a platform admin.
Task 10: deferred (final review): permissions manage-languages, edit-translations, manage-translation-keys are no longer checked by any door — remove in a later migration or keep as documented dead permissions.
Task 10: review dispatched (opus, package review-0df6135..19b3a91.diff)
Task 10: review — spec ✅ with one open point, quality Needs fixes: Important-1 a platform admin in support can still write the global catalogs (requirePlatformAdmin ignores the support state; so does the whole console)
- Ruling: T10 the console is closed during support: requirePlatformAdmin / requirePlatformAdminPage refuse a session in state support (error / notFound), endSupport uses its own check (platform admin + support session), the "Piattaforma" sidebar entry is hidden in support; to use the console the admin presses Esci first — why: spec says every change during support goes to the tenant audit with kind platform; console writes during support would bypass it; one rule for the whole console instead of a catalog-only guard — cost if wrong: one extra click (Esci) before using the console.
- Ruling: T10 fix round also takes minors 1 (translation href defaults → /platform/translations or required basePath), 2 (generic 500 message in grid-handlers), 3 (tenant-grid test with a real support session); minors 4 (0062 pre-existing-tenant path test) and 6 (array query params) deferred — cost if wrong: none.
Task 10: fix round 1/5 dispatched (resume implementer, brief task-10-fix-1.md)
Task 10: fix round 1 implementer DONE_WITH_CONCERNS 92e15bf (requireSupportExit for endSupport; startSupport switch-from-support branch removed; Esci after expiry shows exit error)
Task 10: re-review round 1 dispatched (sonnet, package review-b42612a..92e15bf.diff)
Task 10: re-review round 1 — items 1-4 ✅, all findings addressed; Esci-after-expiry recommendation: navigate to /platform without error
- Ruling: T10 polish round 2: endSupport, for a DB-confirmed platform admin whose session is no longer in support, returns {state} without throwing or writing (Esci lands on /platform); non-admins still refused; plus test minors (merge duplicate schema import, assert the notFound digest, fix the doc comment) — why: expiry before Esci is a normal case — cost if wrong: none.
Task 10: fix round 2/5 dispatched (resume implementer, brief task-10-fix-2.md)
Task 10: fix round 2 implementer DONE f831267 — controller verified the small diff directly (endSupport outside support returns state, no write; non-admin refused; guards 'closed' vs 'any')
Task 10: minor (deferred): 0062 pre-existing-tenant loop path untested (probe shows 0 anomalies); array query params in parseAuditGridUrlParams
Task 10: complete (commits 0df6135..f831267, review clean after 2 rounds; plan ticked in b42612a; MT5-OK-4 ticked)
Task 11: dispatched (BASE f831267, sonnet; carries test_i18n.py move to /platform)
- Ruling: T11 the implementer starts the web-construct-e2e-local dev server itself (Bash, background, port 3000) and stops it after; E2E and integration only on the local Docker DB, sequentially; PLATFORM_DATABASE_URL may be added to the e2e-local launch config from TEST_PLATFORM_DATABASE_URL, never owner strings — why: the subagent has no preview tools; keeps the E2E env aligned with CI — cost if wrong: an orphan dev server to kill.
Task 11: implementer DONE_WITH_CONCERNS b4c05f4 (+4707c52 plan tick); full integration 615/615 (41 s), full E2E 163 passed in 5:38 on local Docker; PLATFORM_DATABASE_URL added to e2e-local launch config and CI app start; e2e-console.localhost in CI /etc/hosts
- Ruling: T11 the invitation E2E accepts delivery_status sent or failed (depends on the mail provider) as long as the attempt is recorded and the UI agrees — why: CI and local have no real mail provider — cost if wrong: a broken mail send would not fail E2E (integration tests cover delivery status).
Task 11: note: `next dev` appended a nextjs-agent-rules block to sources/microservices/web-construct/AGENTS.md (unstaged); left for the user to decide (the block says it is re-added on every next dev)
Task 11: review dispatched (sonnet, package review-f831267..b4c05f4.diff)
Task 11: review — spec ✅, quality Approved
- Ruling: T11 park minors 1 (assert the specific error, platform-entry-points:757), 2 (every inventory entry under app/platform or app/api/platform must have a platform guard) and 7 (step-level env clearing owner strings for the CI app start) for the final-review fix dispatch; 3-6 deferred as polish — why: one fix dispatch at the end — cost if wrong: none.
Task 11: complete (commits f831267..b4c05f4, review clean; plan ticked in 4707c52; MT5-OK-2, 3, 5 ticked)
Final review: dispatched (opus, whole branch 187a15a..4707c52); Task 12 steps 1-2 after the final fix dispatch; Task 12 step 3 waits for the owner after merge
Final review: report received — Ready to merge: With fixes; no Critical. Important: (1) MT5-DEC-6 platform events on the tenant page missing though ticked; (2) no re-invite path for a platform admin without password (command + console). Minor 3-8.
- Ruling: final fix dispatch covers 1, 2, 3 (deployment runbook + k8s secret example: provision-platform-role, PLATFORM_DATABASE_URL, platform-admin-add), 4 (assert the platform pool is not owner/superuser/bypassrls), 5 (readSupportInProgress requires the actor still active platform admin), 8 (runbook SQL writes a command audit row), plus parked T11 minors 1, 2, 7 — why: small, contained, 1/2 needed before the dev rollout — cost if wrong: none.
- Ruling: final minor 6 (platform admin adding own email as tenant admin) → document in Task 12 user docs, no code; minor 7 (0058 description match) → read-only probe on dev before apply in Task 12 step 3, with the owner's OK — why: allowed by MT5-DEC-1; dev DB rule — cost if wrong: none.
Final fix: dispatched (fresh sonnet implementer, brief final-fix.md)
Final fix: implementer DONE_WITH_CONCERNS 4707c52..9044fa0 (7 commits, 0063 added locally); integration 628/628, unit 1521/1521, E2E test_platform 7/7, build ok
Final fix: incident — a failed RED step popped the user's old stash "On feature/rbac: wip…" (conflict, stash kept intact); leftover untracked docs/input-specs/rbac-improvements/rbac-improvements.md is identical to the stash copy. The implementer's delete was blocked → NOT deleted by the controller (would launder a denied action); left for the user.
Final fix: scoped re-review dispatched (opus, package review-4707c52..9044fa0.diff)
Final fix: re-review — all 9 items ✅, all findings addressed; nits: module-level "checked" flag (tests only), SSO-only platform admins get a re-invite on re-add (docs line), console re-invite expiry from app clock (as every console invitation)
Final review: clean
Task 12: steps 1-2 dispatched (sonnet) — full checks on the local test DB, doc ticks, user-doc notes; step 3 (dev DB) waits for the owner after merge
Task 12: steps 1-2 DONE 9352316 + controller 6916c84 (trailing blank line); unit 1521, integration 628, E2E 163, build 0, schema-check ok, boundary-check 32 ok (local DB)
- Ruling: keep the SDD workspace until Task 12 step 3 (dev DB) is done — why: the ledger holds the dev-rollout notes — cost if wrong: a gitignored folder lives a bit longer.
Finish: owner chose 'keep the branch as-is' (2026-10-29) — not pushed; no PR; dev DB untouched; Task 12 step 3 pending after merge with explicit OK
