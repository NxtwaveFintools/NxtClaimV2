# Purge Risk Report — NxtClaim V2 Phase 1

> Generated: 2026-06-24  
> Method: Every candidate double-checked via `grep` across **both** `src/` and `tests/` before classification.  
> Phase 1 candidates sourced from `docs/REFACTORING_PHASE1_PURGE.md`.

---

## 0% Risk — Confirmed Dead ✅ (Deleted)

These items have **zero external references** in `src/` or `tests/`. Deleted.

### Dead source files (6)

| File                                                       | Evidence                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/core/domain/claims/utils.ts`                          | grep `core/domain/claims/utils` → 0 hits in `src/`; grep `isBcSubmitted` → 0 hits in `src/` or `tests/`; only self-definition |
| `src/modules/admin/ui/settings/users-management.tsx`       | grep `users-management` → 0 hits in `src/` or `tests/`                                                                        |
| `src/modules/claims/ui/claim-detail-skeleton.tsx`          | grep `claim-detail-skeleton\|ClaimDetailSkeleton` → 0 hits outside own file                                                   |
| `src/modules/claims/ui/claim-full-details-grid.tsx`        | grep `claim-full-details-grid\|ClaimFullDetailsGrid` → 0 hits outside own file                                                |
| `src/modules/claims/ui/claim-semantic-download-button.tsx` | grep `claim-semantic-download-button\|ClaimSemanticDownloadButton` → 0 hits outside own file                                  |
| `src/modules/claims/ui/claims-table-skeleton.tsx`          | grep `claims-table-skeleton\|ClaimsTableSkeleton` → 0 hits outside own file                                                   |

### Create-Next-App starter SVGs (5)

| File                | Evidence                              |
| ------------------- | ------------------------------------- |
| `public/file.svg`   | grep `file\.svg` → 0 hits in `src/`   |
| `public/globe.svg`  | grep `globe\.svg` → 0 hits in `src/`  |
| `public/next.svg`   | grep `next\.svg` → 0 hits in `src/`   |
| `public/vercel.svg` | grep `vercel\.svg` → 0 hits in `src/` |
| `public/window.svg` | grep `window\.svg` → 0 hits in `src/` |

---

## 0.1% – 5% Risk — Monitor 🟡 (DO NOT TOUCH)

These symbols appeared dead in `src/` alone but have **consumers discovered in `tests/`** — deleting them would immediately break unit tests. They may also carry semantic meaning (auth sensitivity, class contracts). Leave for Phase 4 domain cleanup, where the companion test is updated together with the production code.

| Symbol                         | File                                          | Reason for risk                                                                                                                             |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `loginWithGoogleAction`        | `modules/auth/actions.ts:39`                  | Referenced in `tests/unit/auth/actions.test.ts` lines 38, 92, 98. Also auth-sensitive — potential external or dynamic Google OAuth trigger. |
| `getCurrentUserAction`         | `modules/auth/actions.ts:75`                  | Referenced in `tests/unit/auth/actions.test.ts` lines 36, 140, 142. Test asserts its return shape.                                          |
| `getActivePolicyStateAction`   | `modules/policies/actions.ts:96`              | Referenced in `tests/unit/policies/actions.test.ts` lines 47, 128–144. Two full test cases.                                                 |
| `createFinanceApproverAction`  | `modules/admin/actions.ts:382`                | Referenced in `tests/unit/admin/actions.test.ts` lines 101, 345–349. Full test case.                                                        |
| `updateDepartmentActorsAction` | `modules/admin/actions.ts:314`                | Referenced in `tests/unit/admin/actions.test.ts` lines 107, 307–318. Multiple test cases.                                                   |
| `GetMyClaimsService` (class)   | `core/domain/claims/GetMyClaimsService.ts:14` | Referenced in `tests/unit/claims/get-my-claims.service.test.ts` lines 1, 109, 136. Active test suite.                                       |
| `usePersistentState`           | `hooks/use-persistent-state.ts:14`            | Referenced in `tests/unit/hooks/use-persistent-state.test.tsx` lines 2, 5. Dedicated test file.                                             |

**Action:** When a Phase 4 domain touches the owning file, update the action/hook **and** its test in the same PR. Do not purge independently.

---

## >5% Risk — Untouchable 🔴 (DO NOT TOUCH)

| Item                                  | File                                          | Reason                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-error-utils.ts` (entire module) | `src/core/infra/supabase/auth-error-utils.ts` | **Phase 1 scan was incorrect.** grep confirms **6 active production imports**: `supabase-server-auth.repository.ts`, `supabase-auth.repository.ts`, `auth-session-sync.tsx`, `app/auth/callback/route.ts`, `app/api/auth/session/route.ts`, `modules/auth/server/get-request-auth-user.ts`. This is a **live, shared auth utility module.** |
| `src/types/database.ts`               | same                                          | Explicitly preserved per Phase 1 decision: re-integrate as `SupabaseClient<Database>` in Phase 4 data-layer hardening (Blueprint §7).                                                                                                                                                                                                       |

---

## Phase 1 Scan Corrections

Two errors found during this double-check:

1. **`auth-error-utils.ts` was listed as dead** ("no external consumer"). The `src/`-only scan missed the fact that the exported helpers are imported by 6 other `src/` files using named imports. The grep verified live production usage.

2. **All 7 "dead value exports" have test coverage**. The original scan was limited to `src/`; re-running against `tests/` revealed dedicated unit test files for every candidate. These are not safe to delete without a paired test update.

---

## Net Result

- **Deleted:** 11 files (6 source orphans + 5 starter SVGs)
- **Preserved / Monitor:** 7 symbol-level candidates (delete with paired test update in Phase 4)
- **Preserved / Untouchable:** 2 items (`auth-error-utils.ts`, `database.ts`)
- **No dependencies removed** (all 21 runtime deps confirmed in use per Phase 1 §1d)
