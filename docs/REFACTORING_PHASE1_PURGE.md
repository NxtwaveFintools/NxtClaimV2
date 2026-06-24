# Refactoring — Phase 1: The Purge (Dead Files & Dependencies)

> Status: **Findings only. Nothing deleted.** Awaiting approval to execute.
> Generated: 2026-06-24

Scan totals: `repoFiles: 324, srcFiles: 201, entrypoints: 127, reachable: 292, orphans: 7`.

---

## 1a. Confirmed dead — safe to delete (11 files)

| #   | File                                                       | Verification                                                                                                  |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/domain/claims/utils.ts`                          | Unreachable; grep ⇒ references only in `docs/`                                                                |
| 2   | `src/modules/admin/ui/settings/users-management.tsx`       | Unreachable; 0 refs in `src/`. Settings page imports the other `*-management` panels, not this one (replaced) |
| 3   | `src/modules/claims/ui/claim-detail-skeleton.tsx`          | Unreachable; superseded by co-located `loading.tsx`                                                           |
| 4   | `src/modules/claims/ui/claim-full-details-grid.tsx`        | Unreachable; grep ⇒ refs only in `docs/`. Was live until the 2026-06-10 plan, then replaced                   |
| 5   | `src/modules/claims/ui/claim-semantic-download-button.tsx` | Unreachable; 0 refs in `src/`                                                                                 |
| 6   | `src/modules/claims/ui/claims-table-skeleton.tsx`          | Unreachable; superseded by `components/ui/table-skeleton.tsx`                                                 |
| 7   | `public/file.svg`                                          | grep `(file\|globe\|next\|vercel\|window)\.svg` ⇒ 0 matches                                                   |
| 8   | `public/globe.svg`                                         | same                                                                                                          |
| 9   | `public/next.svg`                                          | same                                                                                                          |
| 10  | `public/vercel.svg`                                        | same                                                                                                          |
| 11  | `public/window.svg`                                        | same                                                                                                          |

`public/*.svg` are untouched `create-next-app` starter assets.

---

## 1b. Decision required — `src/types/database.ts`

Orphaned **today** (0 imports), but it is the hand-maintained Supabase schema-types file.
Root cause: `src/core/infra/supabase/browser-client.ts` and `server-client.ts` use the
**untyped** `SupabaseClient` (not `SupabaseClient<Database>`), so generated DB types were
never wired into query type-safety.

Two paths:

- **(A) Delete** as current dead weight, or
- **(B) Re-integrate** — type clients as `SupabaseClient<Database>` for end-to-end query
  safety. **Recommended**, but it is **Phase 4** work, not a purge.

Recommendation: **keep for now**, decide in the Blueprint. (Deleting is low-risk — types
only — but discards a useful asset.)

---

## 1c. Corrected finding — `src/app/dashboard/*` is NOT dead

An initial glance suspected an abandoned route tree. Reading the files disproved it:

- `src/app/dashboard/page.tsx` — the **live** `/dashboard` home (wallet summary, nav,
  app shell); `resolveRootRoute()` redirects authenticated users here.
- `src/app/dashboard/loading.tsx` — its **live** loading boundary.
- `src/app/dashboard/claims/page.tsx` — an **intentional compat redirect**
  (`/dashboard/claims` → `ROUTES.claims.list`).

The real issue: the dashboard **home** sits _outside_ the `(dashboard)` route group while its
**sub-pages** sit _inside_ it. That is an **architecture inconsistency for Phase 3**, not a
deletion.

---

## 1d. Dependencies — nothing to remove

All **21 runtime dependencies** have ≥1 real import (0 unused). `devDependencies` were
**not** treated as "unused": they are tooling-resolved via config/CLI (eslint, jest,
prettier, husky, playwright, supabase CLI, tailwind, ts-jest, `@types/*`), not bare imports.
A deeper devDep audit is available on request.

---

## 1e. Optional / trivial

`.gitkeep` files in now-non-empty dirs (`src/components`, `src/lib`, `src/types`,
`tests/unit`, `supabase/migrations`) — harmless cruft, low priority.

---

## 7.5 Dead exported symbols (symbol-level scan)

`scratchpad/dead-exports.cjs` checked **511 exported symbols**; **95** have no reference in any
other file. Most are **over-exports** (low-risk): exported types/constants/DS sub-exports used
only within their own file. The actionable subset is **dead _value_ exports in otherwise-live
files**, each **verified by direct grep** to appear only in its defining file:

| Symbol                            | Location                                      | Why it's dead                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loginWithGoogleAction`           | `modules/auth/actions.ts:39`                  | Google login runs via the **client** auth repository (`supabase-auth.repository`), not this action ⚠️ _auth-sensitive — confirm no dynamic trigger_                                                                                  |
| `getCurrentUserAction`            | `modules/auth/actions.ts:75`                  | Superseded by `getCachedCurrentUser()` server helper                                                                                                                                                                                 |
| `getActivePolicyStateAction`      | `modules/policies/actions.ts:96`              | No consumer                                                                                                                                                                                                                          |
| `createFinanceApproverAction`     | `modules/admin/actions.ts:382`                | Superseded by `addFinanceApproverByEmailAction` (the one the panel uses)                                                                                                                                                             |
| `updateDepartmentActorsAction`    | `modules/admin/actions.ts:314`                | No consumer                                                                                                                                                                                                                          |
| `GetMyClaimsService` (class)      | `core/domain/claims/GetMyClaimsService.ts:14` | Superseded by `GetMyClaimsPaginatedService`; file likely retained only for a shared type — collapse                                                                                                                                  |
| `usePersistentState`              | `hooks/use-persistent-state.ts:14`            | Not imported anywhere; overlaps `use-session-storage` / `use-claim-form-autofill`                                                                                                                                                    |
| `auth-error-utils.ts` (5 helpers) | `core/infra/supabase/auth-error-utils.ts`     | `getSupabaseAuthErrorCode/Status`, `isSupabase{Expired,InvalidGrant,InvalidRefreshToken}…` are only cross-called internally; **no external consumer** — likely a fully dead module _(confirm file isn't imported for anything else)_ |

Plus the **Phase-1 orphan files re-confirmed** here (validates the scan): `users-management`,
`claim-detail-skeleton`, `claim-full-details-grid`, `claim-semantic-download-button`,
`claims-table-skeleton`, `core/domain/claims/utils.ts` (`isBcSubmitted`), `types/database.ts`.

**Lower-priority bucket (~80):** over-exported types/constants/DS sub-exports —
`ButtonProps/ButtonVariant/ButtonSize`, `DialogClose/Portal/Trigger/Overlay`, `CardDescription`,
many `contracts.ts` types, `PAYMENT_MODE_{CORPORATE_CARD,FOREX,HAPPAY}`, several `statuses.ts`
constants, validator sub-schemas (`financeExpenseEditSchema`, `ownExpenseEditSchema`, …). These
are candidates to **drop the `export`** (make file-private) rather than delete — do opportunistically
per-domain in Phase 4, not as a sweep.

> Caveat: the scan is name-based. Each value export above was grep-verified, but confirm no
> barrel/dynamic re-export before deletion (especially the auth actions).

---

## Net

Codebase is already fairly lean: **11 safe deletes + 1 decision (`database.ts`)**, no
dependency removals.
