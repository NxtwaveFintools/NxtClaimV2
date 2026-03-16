# NXTCLAIM V2 - DEVELOPMENT GUIDELINES (NON-NEGOTIABLE)

Applies to all AI-generated and human-written code.
These are mandatory engineering standards for this repository. Violation of any rule is considered a bug. This project prioritizes correctness, data integrity, strict financial auditing, and long-term maintainability over short-term speed.

## Scope And Precedence

This file is the authoritative engineering instruction source for this repository.
If implementation choices, legacy docs, or existing code conflict with this file, this file takes precedence.

## 1. Locked Technology Stack (No Exceptions)

- Frontend: Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS · React Hook Form + Zod.
- Backend: Next.js API Routes · PostgreSQL via Supabase · Supabase Auth (Microsoft AD and Google Workspace).
- Infra: Vercel · Supabase (Auth + DB + Storage) · Structured JSON logging.
- DX: ESLint · Prettier · Husky + lint-staged · MCP servers (Supabase, Next.js, Filesystem).

Do not introduce alternative frameworks, ORMs, auth systems, or build tools without explicit approval.

## 2. MCP Server Usage - Mandatory

Critical rule: MCP servers must be used for every feature, bug fix, refactor, or investigation. No assumptions. No blind coding. No "it should work."

- Use Supabase MCP to inspect DB state, validate schemas, check RLS policies, and verify data before writing any DB-related code.
- Use Filesystem MCP to understand project structure before creating or moving files.
- Use Next.js MCP for route inspection, build analysis, and framework-specific guidance.
- **Local Migrations First:** You MUST write all SQL migrations locally to the `supabase/migrations/` folder using the Filesystem MCP first. Do not apply them blindly to the hosted database.
- **Explicit Permission Required:** You MUST pause execution and ask for explicit user permission before applying any migration to the hosted or local database. Do not execute the Supabase MCP apply command until the user explicitly replies with "Approved".
  Never write raw API requests or SQL queries without first verifying capabilities via the MCP tool. If MCP was not used, the change is invalid.

## 3. Core Architecture Principles (NxtClaim Specific)

- Strictly 1 Claim = 1 Transaction: We do not allow arrays of transactions in a single submission. If a user has 5 receipts, they submit 5 distinct claims. This applies to all claim types.
- Proxy Pattern (not middleware): Protect routes using HOFs like withAuth() from src/core/http/with-auth.ts. Global Next.js middleware is forbidden for route protection.
- Modular Service Layer: Repository -> Domain Service -> Presenter. Each layer has a single responsibility.
- Type-Safe Config: All config lives in src/core/config/. Environment variables validated at build time (for example, via Zod). No string-based config keys.
- Thin API Routes: Routes only validate input (via Zod), call a service, and return a response. Business logic belongs in domain services.
- Strict L1/L2 Approval State Machine: All claims must follow a rigid, sequential workflow. A claim cannot reach L2 (Finance) until L1 (HOD/Founder) has explicitly approved it. The L1 approver is dynamically permanently assigned at the exact moment of submission (`assigned_l1_approver_id`). Bypassing L1 or inventing intermediate statuses is a P0 compliance bug. All state transitions must be executed exclusively within Domain Services, never via direct UI-to-DB updates.
- Server-First Architecture (RSC by Default): React Server Components are the default. All data fetching, permission checks, and business logic MUST happen on the server. Use `"use client"` ONLY at the lowest possible leaf nodes in your component tree for UI interactivity (e.g., forms, modals, `useState`).
- Secure Data Mutations: All data mutations (creates, updates, deletes) must be executed exclusively via Next.js Server Actions or protected API routes. The client-side UI is strictly a "dumb" trigger layer.

## 4. Configuration And Constants (Zero Hardcoding)

All routes, roles, statuses, limits, and magic numbers must be defined in centralized files:

- src/core/constants/statuses.ts - raw database Enums (for example, hod pending, finance approved). Do not translate statuses in the UI.
- src/core/config/route-registry.ts - all API routes.

No magic strings. No magic numbers. No hardcoded master data.

- Database-Driven Dropdowns: Every UI dropdown (Departments, Categories, Locations, Payment Modes, etc.) MUST be powered by its own dedicated database table storing key-value pairs (e.g., `id` as the primary key, `name` as the display value, and an `is_active` boolean).
- Never hardcode dropdown options in frontend arrays or backend constants.
- Future-Proofing: If a dropdown item is retired (e.g., a department is closed), it must be soft-deleted (`is_active = false`) in the DB. This ensures new users cannot select it, but historical claims linked to that ID remain perfectly intact.

## 5. Authentication And Security

- Supabase Auth (Microsoft SSO, Google Workspace SSO, and Email/Password) are the only supported auth methods.
- All protected routes use the withAuth() HOF - never rely on client-side checks alone.
- Secrets live in server-side environment variables only. Never expose to the client.
- Sanitize all inputs. Validate with Zod on every API route and Server Action. Return structured errors, never raw stack traces.

## 6. Domain Layer Purity

- Domain services must contain zero infrastructure imports (no direct Supabase SDK calls, no HTTP calls).
- Infrastructure concerns (DB queries, Storage uploads) are injected via interfaces (Repositories).
- Presenters format responses - domain objects are never returned raw.
- No Monolithic Backend Files (Use Cases): Backend logic must be decoupled into focused, single-responsibility domain services. Do not create massive claim.service.ts files that handle creation, L1 approval, L2 approval, and wallet math all at once. Break them down into discrete, isolated use-case files (e.g., SubmitClaimService.ts, ProcessL1ApprovalService.ts, CalculateWalletBalanceService.ts).

## 7. API And Server Action Standards

- All mutating endpoints must be idempotent where applicable.
- Pagination is required on all list endpoints - cursor-based pagination only. Offset-based pagination is forbidden for large datasets.
- Consistent response shape for APIs: { data, error, meta }.

## 8. Module Boundaries And File Structure

- Feature-based structure only. No type-based dumping (utils.js, helpers.js).
- Atomic UI & Reusability: Break complex interfaces into small, reusable, atomic components. Never write massive, monolithic React files.
- Shared UI Component Library: Global UI elements (Buttons, Modals, Tables, Form Inputs) must live in a centralized `src/components/ui/` or `src/core/ui/` directory.
- Anti-Monolith Backend: Backend domains must be broken into discrete, single-purpose files. Do not build god-classes or massive service files.
- Feature Isolation: Each feature (for example, claims, wallet) owns its specific UI components, API routes, domain service, repository, validators, and types. Feature-specific components stay inside `src/modules/[feature]/ui/`.
- Shared utilities live in src/lib/ (pure, stateless) and src/core/ (framework-level).
- Cross-feature direct imports are forbidden. Communicate through shared interfaces.
- Allowed dependency direction: UI -> Feature Logic -> Repository -> Database. Reverse direction is an architectural bug.

## 9. Database Discipline

- No In-Memory Filtering: All dashboard filtering (Status, Date Ranges) must happen at the database level.
- Strict Payload Fetching: Fetch only required fields. Avoid SELECT \*. Do not query the 25MB invoice_url for the high-level list view; fetch it only on the detail page.
- Absolute Row-Level Isolation: Standard users only query rows where submitter_id matches their auth ID. L1/HODs only query rows where assigned_l1_approver_id matches their auth ID.
- Mandatory Soft Deletes: Soft deletes (is_active = false) are mandatory for all Master Data. Hard deletes for claims, expense_details, or advance_details are strictly forbidden under any circumstances to preserve financial auditability.
- Point-in-Time Integrity: Capture current_hod_id as assigned_l1_approver_id at the exact moment of submission to protect historical records from org-chart changes.

## 10. Observability And Logging

- Structured JSON logging only. Use the shared logger from src/core/infra/logging/logger.ts.
- Log levels: DEBUG in dev, WARN+ in prod.
- Every request must carry a correlationId (trace from request -> logs -> errors).
- Never log PII, tokens, or financial transaction amounts in plain text logs.

## 11. Testing

- Unit test coverage >80% for domain services, repositories, and wallet math utilities.
- Integration tests required for approval routing flows (hod pending -> finance pending).
- PRs without tests are invalid unless explicitly justified.
- Mock external dependencies (Supabase, Auth) - never call real services in unit tests.
- **Test-Driven Development (Jest):** After creating database schemas or domain logic, you MUST write Jest unit tests for the corresponding Domain Services and endpoints. You may only consider a feature or step complete if the Jest tests run and pass successfully. If they fail, you must fix the code or the test before moving forward.

## 12. Edge Case Discipline

Every implementation must handle empty states, large 25MB receipt uploads, expired sessions mid-request, wallet aggregate failures, invalid or malicious input, and DB connection failures. Happy-path-only code is not acceptable.

## 13. Forbidden Patterns

- Global middleware for auth (use withAuth() HOF).
- Arrays of expenses inside a single claim (violates 1-to-1 rule).
- Hardcoded strings, master data, or UI-translated statuses.
- Business logic inside API routes or UI components.
- Direct DB calls from UI or presentation layer.
- Returning raw errors or stack traces to clients.
- Tests that call real external services.
- Breaking DB changes without a migration + rollback plan.
- Slapping `"use client"` at the top of a page.tsx or layout.tsx file (forces the whole route to render client-side).
- Client-side data fetching (e.g., using `useEffect` to fetch from Supabase). All fetching must be server-side.

## 14. File Location Quick Index

| Task                    | Location                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| Add API / Server Action | src/app/api/[feature]/route.ts or src/modules/[feature]/actions.ts |
| Protect route           | withAuth from src/core/http/with-auth.ts                           |
| Add domain logic        | src/core/domain/[feature]/                                         |
| Add constants/enums     | src/core/constants/                                                |
| Add shared config       | src/core/config/                                                   |
| Add pure utility        | src/lib/                                                           |
| Add feature UI          | src/modules/[feature]/ui/                                          |
| Add logger              | logger from src/core/infra/logging/logger.ts                       |

## 15. Final Rule

If something is unclear, inspect using MCP - never assume.
This repository values correctness over speed, structure over shortcuts, and long-term maintainability over hacks. If the code disagrees with this file, the code is wrong.

## Enforcement Checklist

Before opening or approving any PR, verify all items below:

- MCP tools were used and evidence is present for schema/route/file-structure validation.
- 1 Claim = 1 Transaction is enforced across all claim types.
- API routes and Server Actions validate with Zod and remain thin.
- Domain services have no direct infrastructure imports.
- Route protection uses withAuth() HOF; no global middleware auth.
- No hardcoded routes, statuses, enums, limits, or master data.
- DB access fetches only required fields; no SELECT \* and no in-memory filtering for dashboard filters.
- Row-level isolation rules are enforced for submitter and approver scopes.
- Soft delete rules are preserved; no forbidden hard deletes.
- Response shape follows { data, error, meta } where applicable.
- Structured logging is used with correlationId, with no PII, tokens, or plain-text financial amounts.
- Tests are present (unit + integration where required) and external services are mocked.
- Migrations include rollback planning for breaking-risk changes.

- The Server-First rule is respected: Pages are Server Components, data is fetched on the server, and `"use client"` is restricted to interactive leaf components.
- Migrations were written locally to `supabase/migrations/` first, and explicit user approval was granted before applying them.
- Jest unit tests were written for the new Domain Services/Endpoints, and all tests are currently passing.
