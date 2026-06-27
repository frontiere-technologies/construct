# Code Review — feature/various-small-fixes (email diagnostics)

Date: 2026-06-24
Reviewer: Senior Code Reviewer
Scope: `apps/web/lib/mailer.ts`, `apps/web/app/api/auth/forgot-password/route.ts`, `apps/web/app/api/auth/register/route.ts` (unstaged, `git diff HEAD`)

## Summary

The changes are small, well-targeted diagnostic additions plus a clean DRY refactor of the `from` resolution in `mailer.ts`. The goal — "diagnostics without behavior change" — is met. The `from` extraction is byte-for-byte equivalent to the previous inline expressions for both providers, so there is no risk of breaking email delivery. No secrets (API keys, SMTP passwords, tokens) are logged. The only material concerns are about log noise / observability conventions and the fact that recipient email addresses (PII) are now written to logs at INFO level — acceptable for a debug push but worth a conscious decision before this becomes permanent.

Findings:

- [✅] ID=IMP-1, Severity=Important, Complexity=Low, Priority=P2, Title=Recipient email (PII) logged at INFO in three places, Fix description=Email addresses are now logged unconditionally in mailer.ts and both routes. Confirm this is acceptable under the project's privacy/GDPR posture, or mask the local part (e.g. `m***@frontiere.io`) / gate behind a debug flag. Currently unaddressed.
- [✅] ID=MIN-1, Severity=Minor, Complexity=Low, Priority=P3, Title=Redundant `to` logging between routes and mailer, Fix description=Removed route-level `console.log` from register/route.ts:71 and forgot-password/route.ts:46; recipient is already logged by the mailer.
- [✅] ID=MIN-2, Severity=Minor, Complexity=Medium, Priority=P3, Title=`console.log`/`console.error` instead of structured logging, Fix description=For production observability prefer a leveled/structured logger so these can be filtered or silenced; INFO-level success logs on every email will add steady noise. Currently unaddressed.
- [✅] ID=MIN-3, Severity=Minor, Complexity=Low, Priority=P3, Title=Non-ASCII arrow `→` in log lines, Fix description=Replaced `→` with `->` in both log lines in mailer.ts (smtp and resend paths).

## Strengths

- The `from` extraction is a correct, true DRY improvement. For SMTP the chain `SMTP_FROM ?? RESEND_FROM ?? 'noreply@frontiere.io'` and for Resend `RESEND_FROM ?? 'noreply@frontiere.io'` are preserved exactly from the original inline values — no behavior change.
- Capturing `info.messageId` (SMTP) and `data?.id` (Resend) gives a real, actionable correlation handle for tracing delivery — this is the most valuable part of the change.
- Resend error logging was improved from a silent throw to `console.error` with the serialized error object before throwing, which preserves the existing control flow (the throw still propagates) while surfacing the provider's error detail. Good.
- Logging is placed inside the existing `try/catch` in the routes, so a logging-adjacent failure path is already covered by the route's `catch (emailErr)`.
- `data?.id` correctly uses optional chaining, guarding the success-log path against an undefined `data`.
- New log lines match the existing `[scope] message` convention already used by `console.error` calls in these files — consistent style.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

#### IMP-1 — Recipient email (PII) logged at INFO in three places
`to`/`normalizedEmail`/`user.email` are now written to logs unconditionally:
- `mailer.ts:16` and `mailer.ts:33` (`to=${to}`)
- `register/route.ts:71` (`to=${normalizedEmail}`)
- `forgot-password/route.ts:46` (`to=${user.email}`)

Email addresses are personal data. For a temporary production debug session this is usually fine, but if these logs ship to a long-retention aggregator it becomes a standing PII exposure. Decide consciously: either keep (acceptable for short-lived diagnostics), mask the local part, or gate behind an env flag (e.g. `MAIL_DEBUG === 'true'`). No secrets are leaked — SMTP password, SMTP user, and `RESEND_API_KEY` are never logged — so the risk is limited to PII, not credentials.

### Minor (Nice to Have)

#### MIN-1 — Redundant recipient logging
Each send now logs the recipient twice: once at the route layer (`[register] sending welcome email to=...`) and once at the mailer layer (`[mailer] resend → to=...`). The route log adds a small amount of value (it brackets the send for timing and ties the recipient to the originating flow), but the recipient string itself is duplicated. Acceptable as-is; could be trimmed.

#### MIN-2 — `console.log` vs structured logging
`console.log` for per-email success at INFO level is fine for a debug push but adds steady noise in steady-state production. If this code is meant to stay, route it through a leveled logger so success logs can be downgraded to DEBUG and filtered.

#### MIN-3 — Non-ASCII arrow in log lines
The `→` glyph in the mailer logs is cosmetic and can occasionally render badly in log viewers; `->` is a safer choice. Trivial.

## Recommendations

- If these logs are intended as short-lived production diagnostics, document that intent in the commit message and plan their removal/downgrade once the SMTP delivery issue is resolved.
- If they are meant to stay, address IMP-1 (PII) and MIN-2 (structured logging) together: gate verbose lines behind a `MAIL_DEBUG` flag or move them to a logger at DEBUG level, keeping only the `messageId`/`id` success lines (and the Resend `console.error`) at INFO.
- `JSON.stringify(error)` on the Resend error is reasonable, but be aware that if the Resend SDK ever nests non-serializable fields the output could be partial; the subsequent `error.message` in the thrown `Error` already covers the human-readable case, so this is fine.
- No test changes are needed; this is a logging/refactor change with no contract change to `sendEmail`. The existing E2E auth tests already exercise these routes.

## Assessment

**Ready to merge?** With fixes

**Reasoning:** The refactor is correct and behavior-preserving and no credentials are leaked, so it is technically safe to merge; the only thing to settle first is a conscious decision on IMP-1 (logging recipient email PII) — either accept it as temporary diagnostics with a documented removal plan, or gate it behind a debug flag. The remaining items are minor polish.
