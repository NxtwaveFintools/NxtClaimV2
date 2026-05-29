# NxtClaimV2 Project Documentation

Last updated: 2026-05-27

This document describes the application context, feature behavior, workflows, permissions, status transitions, data model relationships, integration points, and developer entry points for NxtClaimV2.

It is written for a developer joining the project who needs to understand how the product works before changing code.

## Project Context

NxtClaimV2 is an internal claims management system for employees, HOD approvers, finance approvers, founders, department viewers, and administrators.

The application supports:

- Employee claim submission.
- Self claims and on-behalf-of claims.
- Expense reimbursement style claims.
- Advance or petty cash request style claims.
- AI-assisted invoice and bank statement extraction.
- HOD approval.
- Finance approval.
- Finance payment completion.
- Rejections with or without resubmission.
- Bulk approval and rejection workflows.
- Claim search, filtering, pagination, and export.
- Dashboard analytics for authorized roles.
- Wallet and petty cash balance visibility.
- Company policy acceptance gate.
- Administrative master data and routing configuration.
- Department viewer read-only access.
- Business Central submission lifecycle through database functions.

The application is built as a Next.js App Router application. Most business logic is organized into feature modules under `src/modules/*` and domain services under `src/core/domain/*`. Supabase provides authentication, database access, storage, row-level security, RPC functions, and server-side session cookies.

## Product Roles

The system behavior depends heavily on the current user's role and relationship to a claim.

### Employee / Submitter

An employee can:

- Sign in with an allowed company email domain.
- Accept the active company policy.
- Submit a new claim.
- Submit a claim for self.
- Submit a claim on behalf of another employee, when the form validation rules pass.
- View their submitted claims.
- View claim details for claims they submitted.
- Edit eligible own claims before HOD approval or after resubmission-allowed rejection.
- Delete eligible own claims.
- Track approval and payment state.

The submitter is the user who creates the claim. A claim may also have a separate beneficiary when it is submitted on behalf of another user.

### Beneficiary

The beneficiary is the employee for whom the claim is raised.

For self claims:

- Submitter and beneficiary are the same user.

For on-behalf claims:

- Submitter is the acting user.
- Beneficiary is the employee represented by the on-behalf email and employee code.

The beneficiary can view claim detail when permissions allow it, but workflow actions depend on assigned approver roles and finance roles.

### HOD / L1 Approver

An HOD or L1 approver can:

- See assigned pending approvals.
- Approve eligible claims assigned to them.
- Reject eligible claims assigned to them.
- Choose whether rejection allows resubmission.
- Use bulk approval or rejection where supported.
- View claim details for assigned claims.

The HOD action only applies while the claim is in:

```text
Submitted - Awaiting HOD approval
```

### Finance / L2 Approver

A finance approver can:

- See finance-stage claims.
- Approve claims after HOD approval.
- Reject claims after HOD approval.
- Mark approved claims as paid.
- Use bulk finance actions.
- View HOD-pending claims in a finance-only observability page.
- Export claims according to finance scope.
- Use analytics if their role scope permits it.

Finance actions apply to two finance-stage statuses:

```text
HOD approved - Awaiting finance approval
Finance Approved - Payment under process
```

### Founder / Approver2

The founder or second-level department approver is used when a claim should not be routed to the normal HOD.

The routing service can assign the founder/approver2 as the L1 approver when:

- The beneficiary is the department's approver1.
- The beneficiary is the department's approver2.
- An on-behalf beneficiary is an approver1 in any department.

This prevents a person from being the practical approver of their own claim.

### Department Viewer

A department viewer can:

- View claims for departments assigned to them.
- Use department-scoped claim list views.
- Open detail pages for claims in those departments.

A department viewer cannot:

- Approve claims.
- Reject claims.
- Edit claims.
- Delete claims.
- Perform finance actions.

Department viewer access is read-only.

### Admin

An admin can:

- Access system settings.
- Manage master data.
- Manage departments and approver routing.
- Manage finance approvers.
- Manage department viewers.
- Manage admin users.
- Publish a new company policy.
- View active and deleted claim views where supported.
- Use claim override tools.
- Soft-delete claims administratively.
- Use analytics with admin scope.

Admin status is checked through the admin domain and repository layer, not through UI-only flags.

## Technology Stack

### Runtime And Framework

- Next.js App Router.
- React.
- TypeScript.
- Server Components.
- Server Actions.
- Route Handlers.
- Supabase SSR session cookies.

### Data And Auth

- Supabase Auth.
- Supabase Postgres.
- Supabase Storage.
- Supabase RPC functions.
- Supabase service-role access for trusted server operations.

### Forms And Validation

- Zod for schema validation.
- React Hook Form for client-side form handling.
- Server-side validation in server actions before domain service calls.

### UI

- Tailwind CSS.
- Shared UI components under `src/components/ui`.
- Sonner toasts.
- Recharts for analytics charting.

### External AI

- Google Gemini is used for invoice and bank statement extraction.
- The configured model in the receipt parser is `gemini-2.5-flash-lite`.

### Export

- CSV and Excel-related export flows exist.
- Excel generation uses workbook support in the route handler.
- Claim export includes evidence links when signed URLs can be generated.

## Important Environment Variables

Client-side environment validation is handled in:

```text
src/core/config/client-env.ts
```

Important public variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
```

Server-side environment validation is handled in:

```text
src/core/config/server-env.ts
```

Important server variables:

```text
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
```

Migration and local database scripts may require:

```text
SUPABASE_DB_URL
```

The sample environment file also documents the expected values.

## Source Layout

### App Routes

Application routes live under:

```text
src/app
```

This folder contains:

- Public root route.
- Auth pages and auth API routes.
- Dashboard route group.
- Claim list, detail, and submission routes.
- Export route handler.

### Feature Modules

Feature modules live under:

```text
src/modules
```

Each module generally owns a feature area:

- `auth`
- `claims`
- `dashboard`
- `admin`
- `policies`

Modules typically contain:

- Server actions.
- UI components.
- Feature-specific schemas.
- Feature-specific repository adapters.
- Feature-specific server helpers.

### Domain Layer

Domain services and contracts live under:

```text
src/core/domain
```

This layer contains business rules such as:

- Claim submission preparation.
- Approval decisions.
- Finance decisions.
- Claim edit authorization.
- Claim deletion authorization.
- Analytics access.
- Wallet calculations.
- Policy acceptance behavior.
- Admin operations.

The domain layer should stay independent of UI details.

### Infrastructure Layer

Infrastructure code lives under:

```text
src/core/infra
```

This includes:

- Supabase browser client creation.
- Supabase server client creation.
- Supabase service-role client creation.
- Auth repositories.
- Logging.
- Allowlist checks.

### Shared Configuration

Routes and constants live under:

```text
src/core/config
src/core/constants
```

The route registry is the central source for internal route paths.

### Shared Components

Reusable application components live under:

```text
src/components
```

Reusable hooks live under:

```text
src/hooks
```

Shared utilities live under:

```text
src/lib
```

### Database And Supabase

Supabase configuration, migrations, and seed files live under:

```text
supabase
```

Important contents include:

- Local Supabase configuration.
- SQL migrations.
- Seed data.
- RPC function definitions.
- RLS-related schema behavior.

### Scripts

Project automation scripts live under:

```text
scripts
```

Important scripts include:

- Migration runner.
- Master routing seed script.
- Historical analytics seed script.

## Route Registry

The central route registry is:

```text
src/core/config/route-registry.ts
```

Important routes:

```text
/                                      Root resolver
/auth/login                           Login page
/auth/callback                        OAuth callback route
/api/auth/callback                    Auth callback API route
/api/auth/email-login                 Email login API route
/api/auth/logout                      Logout API route
/api/auth/session                     Session API route
/dashboard                            Main dashboard
/dashboard/analytics                  Analytics dashboard
/claims                               Legacy claim list redirect
/claims/new                           New claim form
/dashboard/claims                     Compatibility redirect
/dashboard/my-claims                  Main claims command center
/dashboard/claims/hod-pending         Finance HOD-pending observability
/dashboard/claims/[id]                Claim detail page
/api/export/claims                    Claim export route
/dashboard/admin/settings             Admin settings
```

When adding or changing routes, update the route registry first and use the registry instead of hard-coded paths where possible.

## Authentication Architecture

Authentication is split across:

- Client actions in `src/modules/auth/actions.ts`.
- Auth repository in the Supabase infrastructure layer.
- Auth route handlers under `src/app/api/auth/*`.
- Auth callback route under `src/app/auth/callback`.
- Session synchronization component in the root layout.

The application supports:

- Email/password login.
- Microsoft/Azure OAuth.
- Google OAuth.
- Session validation through Supabase SSR cookies.
- Server-side allowed-domain checks.
- Logout and cookie cleanup.

## Allowed Email Domain Workflow

The system restricts access to allowed email domains.

Allowed domains are stored in:

```text
allowed_auth_domains
```

Seeded domains include:

```text
nxtwave.co.in
nxtwave.in
nxtwave.tech
```

The check is not only a client-side restriction. The server checks allowed domains during:

- Email login.
- Session creation.
- OAuth callback handling.
- Server-side current-user resolution.

If a user signs in with a disallowed domain:

1. The sign-in attempt may create or return a Supabase auth session.
2. The server validates the email domain.
3. The server clears or rejects the session.
4. The user is redirected back to login or receives an auth error.

This prevents users with valid Supabase credentials but invalid company domains from using the application.

## Email Login Workflow

Email login is used from the login page.

High-level flow:

1. User submits email and password on `/auth/login`.
2. Client action calls the auth service.
3. Browser Supabase client signs in with email/password.
4. The app receives access and refresh tokens.
5. The client posts tokens to `/api/auth/session`.
6. The session route validates tokens.
7. The session route checks allowed email domain.
8. The session route stores Supabase SSR cookies.
9. The user is sent to the dashboard entry path.

Failure scenarios:

- Invalid credentials return an auth error.
- Missing tokens fail session creation.
- Invalid or expired tokens clear any partial session.
- Disallowed domain clears the browser/server session and blocks access.
- Session API failure causes browser cleanup to avoid a split client/server auth state.

## Email Login API Workflow

The route:

```text
src/app/api/auth/email-login/route.ts
```

accepts email/password input and validates it with Zod.

Workflow:

1. Parse request body.
2. Validate required fields.
3. Normalize and inspect email domain.
4. Check `allowed_auth_domains`.
5. Sign in through Supabase server client using public auth credentials.
6. Return tokens when successful.
7. Return safe error information when unsuccessful.

This route is useful where a direct API login flow is needed instead of the client action flow.

## OAuth Login Workflow

OAuth login is initiated from auth actions.

Workflow:

1. User selects Microsoft/Azure or Google login.
2. Client action asks Supabase Auth to start OAuth sign-in.
3. Supabase redirects to the provider.
4. Provider authenticates the user.
5. Provider redirects back to the configured callback.
6. Callback route exchanges the code for a Supabase session.
7. Callback route validates the user's email domain.
8. Invalid domain clears cookies and redirects to login with an error.
9. Valid domain continues to the dashboard.

Important scenario:

- If Supabase successfully creates a session but the app rejects the domain, the callback still has to clean up cookies. Otherwise the browser can appear authenticated while the app rejects the user on server checks.

## Session API Workflow

The session API route supports session creation and current-session reads.

POST workflow:

1. Receive access token and refresh token.
2. Validate both values.
3. Use Supabase SSR helpers to set the session.
4. Fetch current user from Supabase.
5. Check allowed domain.
6. Clear cookies if invalid.
7. Return session status.

GET workflow:

1. Run through authenticated route wrapper.
2. Resolve the current user from server cookies.
3. Return the user/session payload.

This route is a bridge between browser-side Supabase auth and server-rendered App Router behavior.

## Logout Workflow

Logout is handled through auth actions and the logout API route.

Workflow:

1. User triggers logout.
2. Browser Supabase session is signed out.
3. Server route clears Supabase SSR cookies.
4. User is redirected to login.

The app should clear both browser and server sessions because either one alone can create inconsistent auth state.

## Root Route Workflow

The root route `/` resolves where the user should go.

Workflow:

1. Server checks whether a user is authenticated.
2. If unauthenticated, redirect to `/auth/login`.
3. If authenticated, redirect to `/dashboard`.

The root route is not a landing page. It is an authenticated app entry resolver.

## Application Layout Workflow

The root layout wraps the application with:

- Theme provider.
- Auth session synchronization.
- Toast notification container.

Authenticated dashboard routes add policy enforcement through dashboard-specific layout behavior.

## Company Policy Gate

The policy gate ensures authenticated users accept the active company policy before using dashboard workflows.

Important files:

```text
src/core/domain/policies/PolicyService.ts
src/modules/policies/actions.ts
src/modules/policies/components/PolicyGate.tsx
src/app/(dashboard)/layout.tsx
```

## Policy Data Model

Relevant tables:

```text
master_policies
user_policy_acceptances
```

An active policy has:

- Version.
- File URL.
- Active flag.
- Publication metadata.

An acceptance records:

- User.
- Policy.
- Acceptance timestamp.

## Policy Gate Workflow

1. User signs in.
2. User enters a dashboard route.
3. Server resolves active policy state for the current user.
4. If there is no active policy or lookup fails, dashboard access is blocked.
5. If active policy exists and user has accepted it, dashboard content renders.
6. If active policy exists and user has not accepted it, a full-screen policy gate renders.
7. User reviews the policy PDF.
8. User checks the acceptance checkbox.
9. User clicks the accept action.
10. Server records policy acceptance.
11. Dashboard route refreshes.
12. The policy gate disappears.

Important behavior:

- Unauthenticated users do not need a policy gate because they are redirected to login.
- New policy publication creates a new required acceptance because the active policy changes.
- The policy gate is enforced at dashboard layout level, not only individual pages.

## Policy Publishing Workflow

Admin policy publication happens through policy actions.

Workflow:

1. Admin opens system settings.
2. Admin selects a PDF file.
3. Admin enters a version.
4. Server validates that the user is an admin.
5. Server validates version text.
6. Server validates file type as PDF.
7. Server validates max file size.
8. Server uploads file to Supabase Storage bucket `policies`.
9. Server creates a public URL for the policy file.
10. Server publishes the new policy record.
11. Previous active policy is superseded according to service behavior.
12. Settings and policy state are revalidated.

Failure scenario:

- If file upload succeeds but database publication fails, the action attempts to roll back the uploaded storage object.

## Claim Status Model

Claim statuses are centralized in:

```text
src/core/constants/statuses.ts
```

Database statuses:

```text
Submitted - Awaiting HOD approval
HOD approved - Awaiting finance approval
Finance Approved - Payment under process
Payment Done - Closed
Rejected - Resubmission Not Allowed
Rejected - Resubmission Allowed
```

Canonical display categories map internal statuses to broader UI labels:

```text
Submitted  -> Submitted - Awaiting HOD approval
Pending    -> HOD approved - Awaiting finance approval
Approved   -> Finance Approved - Payment under process / Payment Done - Closed
Rejected   -> Rejected statuses
```

The exact database status strings matter. When adding status logic, use the constants instead of retyping strings.

## Claim Lifecycle State Machine

Main successful path:

```text
Submitted - Awaiting HOD approval
  -> HOD approved - Awaiting finance approval
  -> Finance Approved - Payment under process
  -> Payment Done - Closed
```

HOD rejection paths:

```text
Submitted - Awaiting HOD approval
  -> Rejected - Resubmission Allowed

Submitted - Awaiting HOD approval
  -> Rejected - Resubmission Not Allowed
```

Finance rejection paths:

```text
HOD approved - Awaiting finance approval
  -> Rejected - Resubmission Allowed

HOD approved - Awaiting finance approval
  -> Rejected - Resubmission Not Allowed
```

Resubmission behavior:

- A rejected claim with resubmission allowed can be edited by eligible users.
- A rejected claim with resubmission not allowed is terminal for the submitter.

Payment behavior:

- Finance approval does not mean payment is complete.
- The finance-approved status means payment is under process.
- `Payment Done - Closed` is the final paid state.

## Claim Detail Types

Claims have one of two detail types:

```text
expense
advance
```

Expense-style claims include:

- Bill number.
- Transaction date.
- Vendor.
- Expense category.
- Product.
- Location.
- GST fields.
- Basic and tax amounts.
- Currency fields.
- Receipt file.
- Optional bank statement.
- Optional supporting document.
- Purpose and remarks.

Advance-style claims include:

- Total amount.
- Budget month.
- Budget year.
- Expected usage date.
- Purpose.
- Optional product and location.
- Receipt or supporting evidence metadata.

The chosen payment mode determines which detail type is valid.

## Payment Mode To Claim Type Rules

Claim submission does not trust only the client form. The server resolves the selected payment mode and decides whether it belongs to expense or advance behavior.

Expense-like payment modes include:

```text
reimbursement
corporate card
happay
forex
petty cash
```

Advance-like payment modes include:

```text
petty cash request
bulk petty cash request
```

If the form payload detail type does not match the selected payment mode category, submission fails with a detail type mismatch error.

## Claim Submission Entry Points

Primary user route:

```text
/claims/new
```

Important implementation files:

```text
src/app/claims/new/page.tsx
src/modules/claims/actions.ts
src/modules/claims/validators/new-claim-schema.ts
src/core/domain/claims/services/SubmitClaimService.ts
```

The page hydrates the claim form by calling the claim form hydration action. Hydration loads:

- Current user information.
- Dropdown data.
- Expense categories.
- Products.
- Locations.
- Payment modes.
- Department and routing data needed by the form.

## Claim Submission Form Validation

The main schema is:

```text
src/modules/claims/validators/new-claim-schema.ts
```

Base fields include:

- Employee name.
- Employee ID.
- CC emails.
- HOD name.
- HOD email.
- Submission type.
- On-behalf email.
- On-behalf employee code.
- Department ID.
- Payment mode ID.

Expense fields include:

- Bill number.
- Transaction ID.
- Purpose.
- Expense category ID.
- Product ID.
- Location ID.
- Location type.
- Location details.
- GST inclusion flag.
- CGST amount.
- SGST amount.
- IGST amount.
- Basic amount.
- Total amount.
- Transaction date.
- Currency.
- Foreign amount fields.
- Vendor name.
- Receipt file metadata.
- Bank statement metadata.
- Supporting document metadata.
- People involved.
- Remarks.
- AI extraction metadata.

Advance fields include:

- Total amount.
- Budget month.
- Budget year.
- Expected usage date.
- Purpose.
- Receipt or evidence metadata.
- Optional product.
- Optional location.
- Remarks.

## Self Claim Scenario

Workflow:

1. User opens `/claims/new`.
2. Form is hydrated with the authenticated user's profile.
3. User selects `Self`.
4. User fills payment mode and claim details.
5. User attaches required files.
6. Client-side validation catches obvious missing fields.
7. Server action receives form payload.
8. Server validates payload again using Zod.
9. Server resolves current user from server auth.
10. Server resolves selected payment mode.
11. Server validates detail type against payment mode.
12. Server calculates total amounts.
13. Server resolves department routing.
14. Server assigns L1 approver.
15. Server generates claim ID.
16. Server uploads or confirms evidence metadata.
17. Server checks for duplicates where applicable.
18. Server creates claim and detail records.
19. Server revalidates relevant paths.
20. User sees success and can open the created claim.

Important behavior:

- The authenticated user is both submitter and beneficiary.
- On-behalf fields should not be present for self claims.
- If the user is also the normal HOD for the department, routing may bypass to approver2.

## On-Behalf Claim Scenario

Workflow:

1. User opens `/claims/new`.
2. User selects `On Behalf`.
3. User enters beneficiary email.
4. User enters beneficiary employee code.
5. User fills the rest of the claim.
6. Server validates that on-behalf fields are present.
7. Server validates that beneficiary email belongs to the required company email pattern.
8. Server resolves or provisions the beneficiary user record.
9. Server uses the on-behalf employee code when generating the claim ID.
10. Server resolves department routing for the selected department.
11. Server applies HOD bypass rules if the beneficiary is an approver.
12. Server creates the claim with submitter and beneficiary separated.

Important behavior:

- The submitter remains the actor who created the claim.
- The beneficiary is the person for whom reimbursement or advance is requested.
- On-behalf workflow prevents missing beneficiary identity because downstream approvals, reports, and exports depend on it.

## HOD Bypass Scenario

The submission service prevents self-approval patterns by changing assigned L1 approver when needed.

Bypass applies when:

- The beneficiary is the department approver1.
- The beneficiary is the department approver2.
- The on-behalf beneficiary is an approver1 in any department.

Workflow:

1. Submission service resolves department approver1 and approver2.
2. Service compares beneficiary user ID against approver user IDs.
3. If beneficiary would normally be routed to themselves or an unsafe approver route, service assigns approver2.
4. Claim starts in `Submitted - Awaiting HOD approval` with the adjusted L1 assignment.

Developer note:

- If routing changes are required, change the domain service, not only the form.
- The form can display HOD fields, but server routing is authoritative.

## Claim ID Generation

Claim IDs are generated by the submission domain service.

Pattern:

```text
CLAIM-<EMPLOYEE>-YYYYMMDD-XXXX
```

For petty cash request behavior:

```text
EA-<EMPLOYEE>-YYYYMMDD-XXXX
```

For on-behalf claims, the employee segment uses the on-behalf employee code.

The suffix is generated to avoid collisions while keeping the ID readable.

## Expense Amount Calculation

Expense total is calculated from:

```text
basicAmount + cgstAmount + sgstAmount + igstAmount
```

The server normalizes and validates money values. Negative values are rejected.

For non-INR claims:

- Foreign currency fields are required.
- Foreign basic amount must be greater than zero.
- Local INR fields may be handled differently depending on bank statement extraction and payment mode rules.

## Bank Statement Required Scenario

Some categories require a bank statement.

Known required categories include:

```text
Overseas Subscription
Local Subscription
```

Workflow:

1. User selects an expense category.
2. Server identifies whether the selected category requires bank statement evidence.
3. If required and bank statement metadata is missing, submission fails.
4. If present, bank statement file metadata is stored with the claim detail.

This validation is server-side because category IDs and names must be trusted from master data.

## Duplicate Expense Detection

The submission action checks duplicate expenses before creating the claim.

Duplicate composite fields include:

- Bill number.
- Transaction date.
- Total amount.
- Foreign amount details where applicable.

Workflow:

1. Server normalizes expense details.
2. Repository checks whether a matching active expense already exists.
3. If a duplicate exists, submission stops.
4. User receives a message explaining that the same bill number, date, and amount already exist.
5. Database unique constraints also protect against race conditions.

Database unique violation handling includes recognition of:

```text
uq_expense_details_active_bill
23505
```

Important behavior:

- Duplicate detection is not just a UI warning.
- The database still protects against concurrent submissions.

## File Upload Workflow

Claim submission can upload:

- Receipt.
- Bank statement.
- Supporting document.

Workflow:

1. Server validates current user.
2. Server validates form payload.
3. Server validates file metadata.
4. Server uploads files to Supabase Storage.
5. Server records storage paths in claim detail records.
6. If a later validation or create step fails, server attempts to remove uploaded files.

Important behavior:

- Max file size is 25 MB in relevant flows.
- Server Actions body limit is configured to support large uploads.
- Storage cleanup is important because validation can fail after upload.

## AI Invoice Parsing Workflow

AI receipt parsing is implemented in:

```text
src/modules/claims/actions/parse-receipt.ts
```

Supported document types:

```text
invoice
bank_statement
```

Supported file types:

```text
PDF
JPEG
PNG
WEBP
```

Max file size:

```text
25 MB
```

Invoice extraction workflow:

1. User uploads or selects an invoice.
2. Client sends file to the parse receipt server action.
3. Server validates file type and size.
4. Server sends file and prompt to Gemini.
5. Prompt includes allowed expense categories so the model can map category names.
6. Gemini returns structured fields.
7. Server parses the model response.
8. Server normalizes values for the form.
9. High-confidence extracted fields can autofill the form.
10. Low-confidence or partial fields produce warnings and still allow manual entry.

Invoice fields extracted include:

- Bill number.
- Transaction date.
- Vendor name.
- GST number where available.
- Basic amount.
- CGST.
- SGST.
- IGST.
- Total amount.
- Currency.
- Foreign currency data.
- Category name.
- Confidence score.

## AI Bank Statement Parsing Workflow

Bank statement parsing is context-aware.

Workflow:

1. User uploads bank statement.
2. Client includes context from the form, such as vendor, bill date, bill number, amount, currency, and category.
3. Server validates the document.
4. Server prompts Gemini to identify the relevant settled INR debit.
5. Gemini returns the likely bank statement amount and confidence.
6. Server maps the extracted value into the form's amount fields.

Important behavior:

- Bank statement parsing is different from invoice parsing.
- It is used to locate an INR debit, not to extract full invoice tax structure.
- Taxes are returned as zero for bank statement extraction.

## AI Parsing Failure Scenarios

The parser handles several failures:

- Unsupported file type.
- File larger than 25 MB.
- Missing Gemini API key.
- Model returns invalid JSON.
- Model returns low confidence.
- Model cannot identify meaningful fields.
- Gemini service returns 503.
- Gemini quota or rate limit is exceeded.

Retry behavior:

- Service unavailable responses can be retried up to three attempts.
- Quota or rate-limit responses return a friendly retry message.

The form must still allow manual entry because AI parsing is an assistant feature, not the source of truth.

## HOD Approval Workflow

HOD approval is handled by the L1 decision domain service.

Workflow:

1. HOD opens assigned approvals.
2. HOD opens claim detail or uses a list action.
3. Server resolves current user.
4. Server fetches the claim for L1 decision.
5. Service verifies claim exists.
6. Service verifies actor is the assigned L1 approver.
7. Service verifies status is `Submitted - Awaiting HOD approval`.
8. Service approves the claim.
9. If assigned L2 is missing, service resolves primary finance approver.
10. Claim status becomes `HOD approved - Awaiting finance approval`.
11. Audit log records the approval.
12. Lists and detail pages are revalidated.

Failure scenarios:

- Claim does not exist.
- Actor is not assigned L1.
- Claim is already approved, rejected, deleted, or paid.
- No primary finance approver can be resolved.

## HOD Rejection Workflow

Workflow:

1. HOD opens claim action form.
2. HOD enters rejection reason.
3. HOD selects whether resubmission is allowed.
4. Server validates reason length.
5. Server verifies actor is assigned L1.
6. Server verifies claim is still awaiting HOD approval.
7. Service updates status to the selected rejection status.
8. Audit log records rejection and reason.
9. User lists and detail pages update.

Rejection status options:

```text
Rejected - Resubmission Allowed
Rejected - Resubmission Not Allowed
```

Important behavior:

- Reject reason is required and must be meaningful.
- Rejection with resubmission allowed keeps the claim editable for eligible users.
- Rejection without resubmission allowed is terminal for normal submitter workflows.

## Finance Approval Workflow

Finance approval is handled by the L2 decision domain service.

Workflow:

1. Finance user opens finance approvals.
2. Finance user reviews a HOD-approved claim.
3. Server resolves current user.
4. Service resolves active finance approver IDs for the user.
5. Service verifies the claim status is `HOD approved - Awaiting finance approval`.
6. Service approves the claim as finance.
7. Claim status becomes `Finance Approved - Payment under process`.
8. Assigned L2 approver is set to the acting finance approver.
9. Audit log records finance approval.
10. Lists, analytics, and detail pages are revalidated.

Failure scenarios:

- Actor is not an active finance approver.
- Claim is still awaiting HOD approval.
- Claim was already finance-approved.
- Claim was already paid.
- Claim was rejected.

## Finance Rejection Workflow

Workflow:

1. Finance user opens finance rejection action.
2. Finance enters reason.
3. Finance selects whether resubmission is allowed.
4. Server validates reason.
5. Service verifies actor is an active finance approver.
6. Service verifies claim is HOD-approved and awaiting finance.
7. Service updates claim to the selected rejection status.
8. Audit log records finance rejection and reason.
9. Lists and detail pages are revalidated.

Important behavior:

- Finance cannot reject a claim still waiting for HOD approval through the finance rejection workflow.
- Finance rejection with resubmission allowed can return the claim to an editable state.

## Mark Payment Done Workflow

Workflow:

1. Finance user opens a claim in `Finance Approved - Payment under process`.
2. Finance triggers mark-paid action.
3. Server resolves active finance approver identity.
4. Service verifies claim is finance-approved.
5. Service transitions claim to `Payment Done - Closed`.
6. Audit log records payment completion.
7. Lists, wallet views, and analytics become eligible for updated closed-state data.

Important behavior:

- Mark paid is separate from finance approval.
- Mark paid is only valid after finance approval.
- Paid claims are terminal in normal workflows.

## Bulk HOD Actions

Bulk HOD actions are available for eligible L1 approvals.

Supported actions:

- Bulk approve L1.
- Bulk reject L1.

Workflow:

1. User selects claims in the approvals view.
2. UI sends selected claim IDs or global selection criteria.
3. Server resolves current user.
4. Server pages through eligible claim IDs where needed.
5. Server chunks work to avoid oversized operations.
6. Each claim is validated for L1 eligibility.
7. Eligible claims transition.
8. Ineligible claims are skipped or reported according to service result behavior.
9. Paths are revalidated.

Important behavior:

- Bulk actions must still enforce per-claim authorization.
- Global selection must not approve claims outside the user's L1 scope.
- Bulk rejection still requires rejection reason behavior.

## Bulk Finance Actions

Bulk finance actions are handled by a bulk processing service and database RPC behavior.

Supported actions:

- Bulk approve.
- Bulk reject.
- Bulk mark paid.

Workflow:

1. Finance user selects claims or applies a global selection.
2. Server resolves the user as an active finance approver.
3. Server builds the bulk action request.
4. Bulk service validates scope.
5. Database RPC processes eligible claims.
6. Service returns counts and per-claim outcomes where available.
7. UI revalidates affected lists.

Important behavior:

- Bulk finance approval only applies to HOD-approved claims.
- Bulk mark-paid only applies to finance-approved claims.
- Bulk reject requires reason.
- The database function centralizes transition safety for bulk processing.

## Available Claim Actions Logic

Available actions are resolved by:

```text
src/modules/claims/server/get-available-claim-actions.ts
```

Action availability depends on:

- Current user.
- Claim status.
- Assigned L1 approver.
- Active finance approver identity.
- Whether the current user is the beneficiary.
- Whether the user has admin or viewer access.

Important rule:

- A beneficiary should not take an approval decision on their own claim.

The UI should use available action helpers instead of duplicating permission checks.

## Own Claim Edit Workflow

Own claim edits are handled by:

```text
src/core/domain/claims/services/UpdateOwnClaimService.ts
src/modules/claims/validators/own-edit-schema.ts
```

Allowed statuses:

```text
Submitted - Awaiting HOD approval
Rejected - Resubmission Allowed
```

Allowed actors:

- Submitter.
- Assigned L1 approver for pre-HOD edit scenarios where the service allows it.

Workflow:

1. User opens claim detail.
2. UI determines edit eligibility.
3. User opens edit form.
4. User updates allowed fields.
5. Server validates payload.
6. Service fetches current claim.
7. Service verifies actor and status.
8. Service verifies detail type matches existing claim detail.
9. Service normalizes amount fields.
10. Repository updates claim and detail.
11. Audit log records edit where applicable.
12. Paths are revalidated.

Important behavior:

- Own edit does not allow arbitrary status changes.
- Detail type cannot be changed by editing.
- Claim can be corrected before approval or after a resubmission-allowed rejection.

## Finance Claim Edit Workflow

Finance edit is handled by:

```text
src/core/domain/claims/services/UpdateClaimByFinanceService.ts
src/modules/claims/validators/finance-edit-schema.ts
```

Allowed finance-stage status:

```text
HOD approved - Awaiting finance approval
```

Additional pre-HOD behavior:

- In pre-HOD stage, submitter or assigned L1 can use the same edit path according to service authorization.

Workflow:

1. Finance user opens HOD-approved claim.
2. UI exposes finance edit form.
3. Finance updates allowed fields.
4. Finance provides edit reason.
5. Server validates edit reason length.
6. Service verifies actor is an active finance approver.
7. Service verifies claim is in editable finance status.
8. Repository updates claim and detail.
9. Audit log records finance edit reason.
10. Detail page and lists are revalidated.

Important behavior:

- Edit reason is required for finance edits.
- Finance can edit payment mode only in the allowed stage.
- Finance cannot edit paid or terminal rejected claims through this workflow.

## Delete Own Claim Workflow

Own deletion is handled by:

```text
src/core/domain/claims/services/DeleteOwnClaimService.ts
```

Submitter-deletable statuses:

```text
Submitted - Awaiting HOD approval
Rejected - Resubmission Allowed
```

Workflow:

1. Submitter opens a claim list or detail page.
2. UI shows delete action only if status is eligible.
3. Submitter triggers delete.
4. Server resolves current user.
5. Service fetches claim.
6. Service verifies actor is the submitter.
7. Service verifies claim status is deletable.
8. Repository soft-deletes claim.
9. Lists are revalidated.

Important behavior:

- Delete is soft delete, not physical deletion.
- Non-submitters cannot delete via own deletion workflow.
- Paid, finance-approved, HOD-approved, and terminal rejected claims are not submitter-deletable.

## Admin Claim Delete Workflow

Admin soft deletion is separate from submitter deletion.

Workflow:

1. Admin opens claim detail or override area.
2. Server validates admin role.
3. Admin soft-delete service validates target claim.
4. Repository marks claim inactive/deleted.
5. Admin views and active claim views are revalidated.

Important behavior:

- Admin delete exists for governance and correction scenarios.
- It should not be confused with submitter own deletion.

## Claim Detail Page Workflow

Claim detail route:

```text
/dashboard/claims/[id]
```

Important page behavior:

1. Server resolves current user.
2. If unauthenticated, redirect to login.
3. Server fetches claim detail.
4. Server resolves admin state.
5. Server resolves finance approver state.
6. Server resolves department viewer state.
7. Server checks whether user can view the claim.
8. If not authorized, route denies access.
9. Page renders claim identity, status, details, evidence, and audit timeline.
10. Page computes available actions.
11. Page renders edit, delete, approve, reject, mark-paid, or admin panels only when allowed.

Authorized viewers can include:

- Submitter.
- Beneficiary.
- Assigned L1 approver.
- Assigned L2 approver.
- Active finance user.
- Department viewer for the claim department.
- Admin.

Read-only department viewer scenario:

- Department viewer can open the detail page.
- The page displays a read-only notice.
- Approval/edit/delete actions are not available.

## Claim Audit Timeline

The claim detail page includes audit history.

Audit logs can capture:

- Claim creation.
- HOD approval.
- HOD rejection.
- Finance approval.
- Finance rejection.
- Finance payment completion.
- Edits.
- Admin overrides.
- Business Central submission outcomes.

Developer note:

- When adding a new state-changing operation, include audit behavior in the domain or repository layer so the detail page remains trustworthy.

## My Claims Command Center

Main claims command center route:

```text
/dashboard/my-claims
```

Legacy redirects:

```text
/claims
/dashboard/claims
```

The command center is the main list experience for:

- Submitted claims.
- Assigned approvals.
- Finance queue.
- Admin active claims.
- Admin deleted claims.
- Department viewer claims.

## Claim List View Modes

Available view modes depend on role:

- `submissions`
- `approvals`
- `admin active`
- `admin deleted`
- `department`

Default behavior:

- Normal employees usually land on submissions.
- Approvers may default to approvals.
- Finance users see finance-related filters and approval queues.
- Admins can access admin modes.
- Department viewers can access department mode.

## Claim List Filtering

Filters include:

- Payment mode.
- Department.
- Location.
- Product.
- Expense category.
- Submission type.
- Status.
- Date target.
- Date range.
- Advanced date ranges.
- Search field.
- Search text.
- Amount range.

Date target examples:

```text
submitted
hod_action
finance_closed
```

Search field examples:

```text
claim_id
employee_name
employee_id
employee_email
```

The list uses cursor-style pagination and a page size of 10 in the main command center.

## Claim List Permission Scenarios

Normal submitter:

- Sees own submitted claims.
- Can open own claim details.
- Can delete only eligible own claims.

HOD approver:

- Sees assigned HOD-pending claims in approvals view.
- Can take L1 actions on eligible assigned claims.

Finance approver:

- Sees finance-stage claims.
- Can approve, reject, or mark paid according to status.
- Can access HOD-pending observability route.

Admin:

- Can access broader admin views.
- Can open inactive claims where supported.

Department viewer:

- Sees claims in assigned departments.
- Has read-only access.

## HOD Pending Finance Observability Page

Route:

```text
/dashboard/claims/hod-pending
```

Purpose:

- Allows finance users to see claims that are still awaiting HOD approval.
- Helps finance monitor bottlenecks before claims reach finance queue.

Workflow:

1. Finance user opens HOD-pending page.
2. Server verifies finance role.
3. Query is canonicalized to locked HOD-pending status.
4. Page renders claims in read-only mode.
5. Finance cannot approve or reject these claims from this page.

Important behavior:

- This is an observability view, not a finance action queue.
- The status is fixed to `Submitted - Awaiting HOD approval`.

## Claim Export Workflow

Claim export is handled by:

```text
src/core/domain/claims/services/ExportClaimsService.ts
src/app/api/export/claims/route.ts
```

Supported scopes include:

```text
submissions
approvals
finance_hod_pending
admin
department
```

Required date filtering:

- Export requires both start and end date.
- Date format must be valid.
- Start date must not be after end date.
- Maximum export range is 90 days.

Workflow:

1. User chooses export from a supported list view.
2. Client sends current scope and filters.
3. Server resolves current user.
4. Export service validates date range.
5. Export service resolves viewer context.
6. Export service validates scope access.
7. Service batches export rows using cursor pagination.
8. Service generates signed evidence URLs where possible.
9. Route builds file output.
10. User receives export file.

## Export Scope Resolution

Submissions scope:

- Includes claims submitted by the current user.

Approvals scope:

- Finance users get finance approval export behavior.
- HOD users get L1 approval export behavior.
- Users with neither role are denied.

Finance HOD-pending scope:

- Finance-only.
- Used for HOD-pending observability export.

Admin scope:

- Admin-only.

Department scope:

- Department viewers only.
- Includes claims from departments assigned to the viewer.
- If viewer has no assigned departments, export returns no rows.

## Export Columns

Exports include fields such as:

- Claim ID.
- Employee ID.
- Employee email.
- Employee name.
- Submitter identity.
- On-behalf identity.
- Department.
- Payment mode.
- Claim type.
- Status.
- Submitted date.
- HOD action date.
- Finance closed date.
- Amount fields.
- GST fields.
- Vendor.
- Expense category.
- Product.
- Location.
- Purpose.
- Remarks.
- Evidence URLs.
- Petty cash request month and year.
- Petty cash balance related values.

Developer note:

- Export format is a user-facing contract. Changing columns should be treated as a product change, not a refactor.

## Dashboard Route Workflow

Main dashboard route:

```text
/dashboard
```

Workflow:

1. Server resolves current user.
2. If unauthenticated, redirect to login.
3. Policy gate runs for authenticated users.
4. Dashboard resolves user role context.
5. Dashboard resolves wallet summary.
6. Dashboard builds navigation items based on permissions.
7. Dashboard renders operational entry points.

Navigation behavior:

- New Claim is available to authenticated users.
- Claims is available to authenticated users.
- HOD Pending appears for finance users.
- Analytics appears when analytics scope is available.
- System Settings appears for admins.

## Wallet Summary Workflow

Wallet summary is handled by:

```text
src/core/domain/dashboard/services/GetWalletSummaryService.ts
```

Workflow:

1. Dashboard resolves current user.
2. Wallet service loads wallet metrics.
3. Service validates ledger values.
4. Service rounds currency values.
5. Service returns display values.

Calculated values include:

```text
amountReceived = petty cash received + reimbursements
amountSpent = petty cash spent
pettyCashBalance = current balance
```

Invalid scenario:

- Negative ledger metrics are treated as invalid and should not silently render as normal values.

## Analytics Dashboard Workflow

Route:

```text
/dashboard/analytics
```

Important domain service:

```text
src/core/domain/dashboard/services/GetAnalyticsService.ts
```

Analytics is available based on resolved role scope:

- Admin.
- Finance.
- HOD.

Workflow:

1. User opens analytics route.
2. Server verifies authentication.
3. Server resolves analytics scope.
4. Server parses query filters.
5. Service validates date filters.
6. Service validates allowed advanced filters for the user's scope.
7. Service calls analytics repository/RPC.
8. Server renders KPI cards and charts.

## Analytics Date Behavior

The analytics service supports:

- Explicit date range.
- Month-derived range.
- Default last 90 days.

Explicit range behavior:

- Both `from` and `to` must be provided.
- Format must be `YYYY-MM-DD`.
- Start date must be before or equal to end date.
- Service can build a previous period for trend comparison.

Default behavior:

- If no date range is supplied, analytics uses the last 90 days.

## Analytics Filters

Supported filters include:

- Department.
- Expense category.
- Product.
- Finance approver.

Advanced filter authorization:

- Admins can use advanced filters.
- Approver2/founder-like users can use advanced filters according to scope.
- Finance users can use finance-authorized filters.
- Finance approver filter is available only for admin or approver2-style scopes.

Invalid or unauthorized filters are either ignored with warnings or rejected according to service validation behavior.

## Analytics Data Sources

Analytics data comes through database functions and cache tables.

Important database objects include:

```text
claims_analytics_daily_stats
claims_analytics_snapshot
get_dashboard_analytics_payload
apply_claims_analytics_delta
refresh_claim_analytics_snapshot
rebuild_claims_analytics_cache
make_claims_analytics_bucket_key
```

The repository can fall back to legacy view behavior if cache tables are not available for some aggregate paths.

## Analytics UI Components

Analytics UI includes:

- KPI cards.
- Filters.
- Charts.
- Status breakdown.
- Payment mode breakdown.
- Department efficiency.
- Finance turnaround time for admin-visible contexts.
- Trends for explicit date ranges.

Common component locations:

```text
src/modules/dashboard/components
```

## Admin Settings Route

Admin settings route:

```text
/dashboard/admin/settings
```

Workflow:

1. Server resolves current user.
2. Server checks admin role.
3. Non-admin users receive `notFound`.
4. Admin settings page loads required admin data.
5. Page renders grouped settings sections.

Admin settings groups include:

- Master Data.
- Routing.
- Access.
- Governance.

## Admin Master Data Workflow

Master data management is handled by admin services and actions.

Master data includes:

- Expense categories.
- Products.
- Locations.
- Payment modes.

Workflow:

1. Admin opens System Settings.
2. Admin selects a master data section.
3. Admin creates or edits an item.
4. Server validates admin role.
5. Server validates input.
6. Service trims and normalizes names.
7. Repository creates or updates row.
8. Settings page and dependent caches are revalidated.

Important behavior:

- Create requires non-empty name.
- Update requires valid ID.
- Name updates require non-empty names when supplied.

## Admin Department And Routing Workflow

Department routing controls HOD assignment.

Admin can manage:

- Departments.
- Department approver1.
- Department approver2.
- Actor assignment by user ID.
- Actor assignment by email.

Workflow:

1. Admin opens routing settings.
2. Admin creates or updates a department.
3. Server validates admin role.
4. Server validates department name and approver emails/user IDs.
5. Service prevents same user from being both approver1 and approver2.
6. Repository resolves or provisions users as needed.
7. Department routing is saved.
8. Claim form hydration and future submissions use the updated routing.

Important behavior:

- Existing claims keep their assigned approver values unless a separate operation changes them.
- Routing changes affect future claims and any workflow that explicitly reloads routing.

## Admin Finance Approver Workflow

Finance approver settings control who can act as finance.

Admin can:

- Add finance approver by user ID.
- Add finance approver by email.
- Mark finance approver active/inactive.
- Mark primary finance approver.

Workflow:

1. Admin opens finance approver settings.
2. Admin adds or updates finance approver.
3. Server validates admin role.
4. Service resolves user.
5. Repository updates `master_finance_approvers`.
6. Role caches are revalidated.
7. Future finance permission checks use updated data.

Important behavior:

- Primary finance approver is used when HOD approval needs to assign L2 and no L2 is already assigned.
- Inactive finance approvers should not be able to act on finance claims.

## Admin Administrator Workflow

Admin management controls system administrators.

Workflow:

1. Existing admin opens Access settings.
2. Admin adds another admin by email or removes an admin.
3. Server validates current user is admin.
4. Service validates target email/user.
5. Repository updates `admins`.
6. Admin and role caches are revalidated.

Important behavior:

- Admin management must always run through server-side admin checks.
- UI hiding alone is not sufficient.

## Admin Department Viewer Workflow

Department viewer management gives read-only department access.

Workflow:

1. Admin opens department viewer settings.
2. Admin chooses department and viewer email.
3. Server validates admin role.
4. Service resolves or provisions viewer user.
5. Repository inserts viewer assignment.
6. Department viewer caches and settings are revalidated.
7. Viewer can access department claim views.

Remove workflow:

1. Admin removes viewer assignment.
2. Repository deletes or deactivates assignment.
3. Viewer loses department-scoped access.

## Admin Claim Override Workflow

Admin claim override tools support controlled correction.

Supported actions include:

- Force update claim status.
- Force update payment mode.
- Admin soft delete.

Workflow for status override:

1. Admin opens override section.
2. Admin enters claim ID.
3. Admin selects new status.
4. Admin provides reason.
5. Server validates admin role.
6. Server validates claim ID, status, and reason length.
7. Service updates claim status.
8. Audit log records override.
9. Affected pages are revalidated.

Workflow for payment mode override:

1. Admin enters claim ID.
2. Admin selects allowed payment mode.
3. Admin provides edit reason.
4. Server validates admin role.
5. Server validates payment mode is allowed for override.
6. Repository updates payment mode.
7. Audit log records change.

Important behavior:

- Override reasons must be meaningful.
- Overrides should be rare governance tools.
- Do not bypass domain checks casually when adding admin functionality.

## Department Viewer Claim Workflow

Department viewer behavior is implemented through department viewer services and claim repositories.

Workflow:

1. Admin assigns user as viewer for one or more departments.
2. Viewer signs in and accepts policy.
3. Viewer opens claims command center.
4. Department tab is available.
5. Server resolves viewer department IDs.
6. If no departments are assigned, empty result is returned.
7. Repository returns claims for those departments.
8. Viewer can open detail pages for those claims.
9. Detail page renders read-only access.

Important behavior:

- Department viewer cannot act on approvals.
- Department viewer cannot edit claims.
- Department viewer cannot delete claims.
- Department viewer cannot see departments they are not assigned to.

## Business Central Integration Context

Business Central integration is implemented primarily through database tables and service-role-only database functions.

The application code treats Business Central submission state as part of claim detail but does not expose a normal public app route for external BC submission.

External service or Edge Function flow uses Supabase service-role permissions.

Important database objects:

```text
bc_claim_details
get_bc_claim_payload
start_bc_claim_attempt
complete_bc_claim
record_bc_claim_failure
```

## Business Central Submission Workflow

Expected external workflow:

1. External service receives or selects a claim ID.
2. External service calls `get_bc_claim_payload(p_claim_id)`.
3. Database validates the claim exists and is active.
4. Database validates the claim has not already been submitted to BC.
5. Database validates the claim is in `HOD approved - Awaiting finance approval`.
6. Database builds the BC payload from claim, employee, payment, department, product, sub-product, responsible, and evidence data.
7. External service calls `start_bc_claim_attempt`.
8. Database inserts a `bc_claim_details` row with status `submitting`.
9. External service sends payload to Microsoft Dynamics 365 Business Central.
10. If BC succeeds, external service calls `complete_bc_claim`.
11. Database marks BC detail row `success`.
12. Database links `claims.bc_claim_details_id`.
13. Database changes claim status to `Finance Approved - Payment under process`.
14. Database writes a `BC_SUBMITTED` audit log.
15. If BC fails, external service calls `record_bc_claim_failure`.
16. Database marks attempt `failed`.
17. Claim remains retryable because the claim status and FK are left unchanged.
18. Database writes a `BC_SUBMISSION_FAILED` audit log.

Important behavior:

- A partial unique index prevents concurrent active/success attempts for the same claim.
- Failed attempts are immutable history and do not block retry.
- Service-role-only grants protect the functions from normal users.

## Business Central Error Scenarios

Known database error codes include:

```text
P0001 CLAIM_NOT_FOUND
P0002 ALREADY_SUBMITTED
P0003 MISSING_MAPPING
P0005 INVALID_CLAIM_STATE
```

Important scenarios:

- Missing mapping prevents payload creation.
- Already submitted claim cannot start another successful/submitting attempt.
- Claim must be in the required status before payload generation.
- Failed BC submission does not automatically reject the claim.

## Business Central Status Meaning

`bc_claim_details.status` values include:

```text
submitting
success
failed
```

Claim-level BC submitted signal:

- `claims.bc_claim_details_id` being non-null is the canonical application signal.

Important behavior:

- BC success moves claim to finance-approved/payment-under-process.
- App-level `mark paid` still closes the payment workflow later.

## Database Tables

Typed database definitions exist in:

```text
src/types/database.ts
```

Important tables include:

```text
admins
advance_details
allowed_auth_domains
bc_claim_details
claim_audit_logs
claims
claims_analytics_daily_stats
claims_analytics_snapshot
department_viewers
expense_category_bc_mappings
expense_details
master_department_responsible_mappings
master_departments
master_expense_categories
master_expense_location_mappings
master_finance_approvers
master_locations
master_payment_modes
master_policies
master_products
master_program_product_mappings
master_sub_product_mappings
user_policy_acceptances
users
wallets
```

Important views include:

```text
vw_admin_claims_dashboard
vw_enterprise_claims_dashboard
```

Important functions include:

```text
apply_claims_analytics_delta
bulk_process_claims
complete_bc_claim
create_claim_with_detail
get_bc_claim_payload
get_dashboard_analytics_payload
make_claims_analytics_bucket_key
process_l2_mark_paid_transition
rebuild_claims_analytics_cache
record_bc_claim_failure
refresh_claim_analytics_snapshot
start_bc_claim_attempt
update_claim_by_finance
```

## Core Database Relationships

Claim relationships:

- `claims.submitted_by` references the submitter user.
- `claims.beneficiary_user_id` or equivalent beneficiary fields identify the beneficiary.
- `claims.assigned_l1_approver_id` identifies HOD/L1 actor.
- `claims.assigned_l2_approver_id` identifies finance/L2 actor.
- `claims.department_id` references department master data.
- `claims.payment_mode_id` references payment mode master data.
- Expense claims have rows in `expense_details`.
- Advance claims have rows in `advance_details`.
- Claim history is stored in `claim_audit_logs`.
- BC submission success links through `claims.bc_claim_details_id`.

Routing relationships:

- Departments define approver1 and approver2.
- Finance approvers are stored in `master_finance_approvers`.
- Department viewers are stored in `department_viewers`.

Governance relationships:

- Admins are stored in `admins`.
- Policies are stored in `master_policies`.
- User policy acceptance is stored in `user_policy_acceptances`.

## Database Enums

Important enums include:

```text
bc_claim_status
claim_status
foreign_currency_code
local_currency_code
```

`claim_status` values match the status constants used by the application.

`bc_claim_status` values:

```text
submitting
success
failed
```

Foreign currency values include:

```text
INR
USD
EUR
CHF
```

Local currency:

```text
INR
```

## Supabase Storage

Storage is used for:

- Claim receipts.
- Bank statements.
- Supporting documents.
- Policy PDFs.

Policy PDFs are uploaded to the `policies` bucket.

Claim evidence paths are stored in claim detail records and can be converted to signed URLs during export or detail viewing.

Important behavior:

- Evidence URL generation should not fail an entire export if signed URL creation has a recoverable error.
- Policy upload failures or publication failures should be handled carefully to avoid orphaned governance files.

## Seed Data

Seed data lives in:

```text
supabase/seed.sql
```

Seeded data includes:

- Allowed auth domains.
- Example users when auth users exist.
- Tech department.
- Primary finance approver.
- Founder admin.
- Expense categories.
- Products.
- Locations.
- Payment modes.
- Active finance policy.
- Business Central mappings.

Developer note:

- Seed data may depend on auth users existing first.
- Local development should confirm the expected users and IDs before testing role-specific flows.

## Migration Workflow

Migration runner:

```text
scripts/run-migrations.mjs
```

Features:

- Uses `SUPABASE_DB_URL`.
- Supports dry runs.
- Supports starting from a specific migration.
- Tracks applied migrations in `_migration_history`.

Typical usage:

```text
npm run migrate:dry-run
npm run migrate
```

Developer note:

- Use dry run before applying migrations.
- Review SQL migrations carefully because much of the business workflow is enforced in database functions and constraints.

## Master Routing Seed Workflow

Script:

```text
scripts/seed-master-routing.js
```

Default behavior:

- Dry run.

Apply behavior:

```text
--apply
```

Workflow:

1. Script reads department/HOD source data.
2. Script creates or finds auth users as needed.
3. Script seeds master departments.
4. Script seeds HOD/founder/finance routing.
5. Script seeds master data.

Developer note:

- Do not run apply mode casually against shared environments.
- Confirm target Supabase project before seeding.

## Historical Analytics Seed Workflow

Script:

```text
scripts/seed-historical-analytics.mjs
```

Default behavior:

- Dry run.

Apply behavior:

```text
--apply
```

Purpose:

- Seeds historical claim data for analytics testing and cache behavior.

The script can use direct Postgres access or service-role access depending on configuration.

## Testing Commands

Project scripts include:

```text
npm run build
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
```

Unit test configuration:

- Jest.
- Tests under `tests/unit`.
- Tests under `src/**/*.test.ts` and `src/**/*.test.tsx`.
- Integration tests are excluded from unit configuration.

E2E test configuration:

- Playwright.
- Tests under `tests/e2e`.
- Chromium project.
- Base URL `http://127.0.0.1:3000`.
- Web server command `npm run dev`.

## Existing Test Coverage Areas

Tests cover areas such as:

- Auth route behavior.
- Auth service behavior.
- Claim validation schemas.
- Claim submission services.
- Claim action behavior.
- Claim repository behavior.
- Admin services.
- Admin repository behavior.
- Dashboard analytics.
- Wallet calculations.
- Policy service and policy actions.
- Claim form validation.
- Submit claim e2e behavior.
- Claim workflow e2e behavior.
- Delete claim e2e behavior.
- Bulk actions lifecycle.
- Department viewer claim access.
- Claim export.

Developer note:

- When changing workflow logic, add or update service-level tests first where practical.
- For route or UI behavior, add integration or e2e coverage when the regression risk is user-facing.

## Common Developer Workflows

### Add A New Claim Field

Touch points usually include:

- Database migration.
- Database types.
- Claim form schema.
- Claim form UI.
- Submit claim service.
- Repository create/update payloads.
- Detail page rendering.
- Edit schemas.
- Export columns if the field is business-visible.
- Tests.

Workflow:

1. Add database column or detail-table field.
2. Update generated or maintained database types.
3. Add server validation.
4. Add UI field.
5. Add create payload mapping.
6. Add edit mapping if editable.
7. Add display rendering.
8. Add export behavior if required.
9. Add tests for validation and persistence.

### Add A New Claim Status

Touch points usually include:

- Database enum or constraints.
- `src/core/constants/statuses.ts`.
- Approval services.
- Finance services.
- List filters.
- Export mapping.
- Analytics mapping.
- UI badges.
- Tests.

Workflow:

1. Add database status support.
2. Add constant.
3. Decide which role can transition into and out of the status.
4. Update services.
5. Update available-action logic.
6. Update filters and display labels.
7. Update analytics and export behavior.
8. Add tests around invalid transitions.

Warning:

- Status changes are high blast-radius changes because permissions, filters, exports, analytics, and dashboards depend on exact statuses.

### Add A New Payment Mode

Touch points usually include:

- `master_payment_modes`.
- Seed data or admin settings.
- Payment mode classification logic.
- Claim form behavior.
- Business Central mapping if needed.
- Export behavior if labels change.

Workflow:

1. Add payment mode through admin or seed.
2. Classify it as expense or advance.
3. Update validation if it requires special fields.
4. Update submission service mapping if needed.
5. Add BC mapping if BC submission needs it.
6. Test new claim submission with that payment mode.

### Change Approval Routing

Touch points usually include:

- Department master data.
- `SubmitClaimService`.
- Actor management admin service.
- Claim form hydration.
- Tests around HOD bypass.

Workflow:

1. Identify whether change is data-only or code behavior.
2. If data-only, update department routing through admin or seed.
3. If code behavior, update domain service.
4. Add test for normal routing.
5. Add test for self-approval prevention.
6. Add test for on-behalf approver scenario.

### Add A New Admin Setting

Touch points usually include:

- Admin settings page.
- Admin action.
- Domain service.
- Repository method.
- Database table or master table.
- Revalidation paths.
- Tests.

Workflow:

1. Define whether setting is master data, routing, access, or governance.
2. Add server-side admin action.
3. Validate input with Zod.
4. Add domain service method.
5. Add repository persistence.
6. Render UI in the correct settings group.
7. Revalidate settings page and any affected caches.
8. Add service/action tests.

### Change Export Columns

Touch points usually include:

- Export service headers.
- Export row mapping.
- Excel route handler.
- Tests that assert exported data.

Workflow:

1. Confirm the column is required by business users.
2. Add or modify export header.
3. Map row value from repository output.
4. Update signed URL behavior if evidence-related.
5. Update tests.
6. Communicate that export shape changed.

### Change AI Parsing Behavior

Touch points usually include:

- Receipt parsing server action.
- Prompt text.
- Response schema parsing.
- Claim form autofill behavior.
- Tests or manual QA.

Workflow:

1. Identify whether the issue is extraction, normalization, or UI mapping.
2. Adjust prompt or parser minimally.
3. Preserve manual entry fallback.
4. Test supported file types.
5. Test low-confidence behavior.
6. Test quota/service-unavailable behavior if possible.

## Debugging Guide

### User Cannot Sign In

Check:

- Email/password correctness.
- OAuth provider callback configuration.
- `NEXT_PUBLIC_SUPABASE_URL`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Supabase Auth user exists.
- Email domain exists in `allowed_auth_domains`.
- `/api/auth/session` response.
- Whether cookies are being cleared due to domain rejection.

Relevant files:

```text
src/modules/auth/actions.ts
src/app/api/auth/session/route.ts
src/app/api/auth/email-login/route.ts
src/app/auth/callback/route.ts
```

### User Signs In But Dashboard Is Blocked

Check:

- Active policy exists.
- User accepted current active policy.
- Policy file URL is valid.
- Policy gate state action result.
- Server auth current user result.

Relevant files:

```text
src/modules/policies/actions.ts
src/modules/policies/components/PolicyGate.tsx
src/core/domain/policies/PolicyService.ts
```

### Claim Submission Fails

Check:

- Server action validation errors.
- Payment mode active status.
- Payment mode detail type classification.
- Required files.
- Bank statement requirement for selected category.
- Duplicate expense check.
- Department routing availability.
- HOD/founder approver availability.
- Storage upload result.
- Database unique constraints.

Relevant files:

```text
src/modules/claims/actions.ts
src/modules/claims/validators/new-claim-schema.ts
src/core/domain/claims/services/SubmitClaimService.ts
```

### HOD Cannot Approve

Check:

- Claim status is `Submitted - Awaiting HOD approval`.
- Current user ID equals assigned L1 approver ID.
- Current user is not blocked by beneficiary/self-decision rules.
- Claim is active.
- Primary finance approver exists if assigned L2 is missing.

Relevant files:

```text
src/core/domain/claims/services/ProcessL1ClaimDecisionService.ts
src/modules/claims/server/get-available-claim-actions.ts
```

### Finance Cannot Approve

Check:

- Claim status is `HOD approved - Awaiting finance approval`.
- Current user is an active finance approver.
- Claim is active.
- Available actions resolver includes finance approve.

Relevant files:

```text
src/core/domain/claims/services/ProcessL2ClaimDecisionService.ts
src/modules/claims/server/get-available-claim-actions.ts
```

### Finance Cannot Mark Paid

Check:

- Claim status is `Finance Approved - Payment under process`.
- Current user is active finance approver.
- Claim has not already been closed.
- Database transition function succeeds.

Relevant files:

```text
src/core/domain/claims/services/ProcessL2ClaimDecisionService.ts
supabase/migrations
```

### Claim Does Not Appear In List

Check:

- Current view mode.
- Role context.
- Status filter.
- Date target and date range.
- Cursor pagination.
- Active/deleted mode.
- Department viewer assignment.
- Finance vs HOD pending scope.

Relevant route:

```text
/dashboard/my-claims
```

### Export Fails

Check:

- Both start and end date are supplied.
- Date range is not greater than 90 days.
- User has access to selected export scope.
- Department viewer has assigned departments.
- Signed URL generation errors.
- Route handler logs.

Relevant files:

```text
src/core/domain/claims/services/ExportClaimsService.ts
src/app/api/export/claims/route.ts
```

### Analytics Is Missing

Check:

- User is admin, finance, or HOD.
- Analytics scope resolver returns non-null.
- Query filters are authorized for the scope.
- Analytics RPC exists in database.
- Cache tables exist or fallback path works.

Relevant route:

```text
/dashboard/analytics
```

### Admin Settings Not Accessible

Check:

- User is authenticated.
- User exists in `admins`.
- Admin cache has been revalidated after changes.
- Route returns `notFound` for non-admin users.

Relevant route:

```text
/dashboard/admin/settings
```

### Business Central Payload Fails

Check:

- Claim exists and is active.
- Claim is `HOD approved - Awaiting finance approval`.
- Claim has not already been submitted.
- Required mappings exist.
- External service is using service-role permissions.
- Error code from database function.

Relevant database functions:

```text
get_bc_claim_payload
start_bc_claim_attempt
complete_bc_claim
record_bc_claim_failure
```

## Permission Rules By Workflow

### View Claim Detail

Allowed when user is one of:

- Submitter.
- Beneficiary.
- Assigned L1 approver.
- Assigned L2 approver.
- Active finance approver.
- Department viewer for claim department.
- Admin.

### Approve As HOD

Allowed when:

- User is assigned L1 approver.
- Claim status is `Submitted - Awaiting HOD approval`.
- Claim is active.
- User is not violating self-decision restrictions.

### Approve As Finance

Allowed when:

- User is active finance approver.
- Claim status is `HOD approved - Awaiting finance approval`.
- Claim is active.

### Mark Paid

Allowed when:

- User is active finance approver.
- Claim status is `Finance Approved - Payment under process`.
- Claim is active.

### Edit Own Claim

Allowed when:

- User is submitter or permitted pre-HOD actor.
- Claim status is `Submitted - Awaiting HOD approval` or `Rejected - Resubmission Allowed`.
- Claim is active.

### Delete Own Claim

Allowed when:

- User is submitter.
- Claim status is `Submitted - Awaiting HOD approval` or `Rejected - Resubmission Allowed`.
- Claim is active.

### Admin Override

Allowed when:

- User is admin.
- Input is valid.
- Reason is supplied where required.

### Department View

Allowed when:

- User has department viewer assignment for the claim department.

Not allowed:

- Mutating claim workflow.

## Important Implementation Principles In This Codebase

### Server Is Authoritative

Client UI can guide the user, but server actions and domain services enforce:

- Auth.
- Role.
- Claim status.
- Payment mode rules.
- Duplicate checks.
- File requirements.
- Routing.
- Edit permissions.
- Delete permissions.

Do not add security-critical behavior only in UI components.

### Domain Services Hold Workflow Rules

Workflow decisions should live in domain services.

Examples:

- Submit claim routing belongs in `SubmitClaimService`.
- HOD decisions belong in L1 decision service.
- Finance decisions belong in L2 decision service.
- Own delete belongs in delete service.
- Admin settings belong in admin services.

This keeps route handlers and pages from becoming the source of business rules.

### Repositories Own Persistence Details

Repository classes should own:

- Supabase query shape.
- RPC calls.
- Database row mapping.
- Storage URL behavior where appropriate.

Domain services should request operations through repository contracts rather than manually constructing database behavior when a contract already exists.

### Status Constants Should Be Reused

Use centralized status constants. Exact strings are database values and appear in filters, exports, analytics, and action checks.

### Audit Logs Matter

Any state-changing workflow should record audit information where the domain expects it. The claim detail timeline is only reliable if every transition records history.

### Role Caches Need Revalidation

Admin changes to roles, finance approvers, department viewers, and policy state may require cache revalidation. Check existing admin actions before adding new role mutations.

## Local Development Flow

Install dependencies:

```text
npm install
```

Start development server:

```text
npm run dev
```

Run type checks:

```text
npm run typecheck
```

Run lint:

```text
npm run lint
```

Run unit tests:

```text
npm run test:unit
```

Run integration tests:

```text
npm run test:integration
```

Run e2e tests:

```text
npm run test:e2e
```

Build:

```text
npm run build
```

## Developer Entry Points By Feature

Authentication:

```text
src/modules/auth
src/app/api/auth
src/app/auth
src/core/infra/auth
```

Policy gate:

```text
src/modules/policies
src/core/domain/policies
src/app/(dashboard)/layout.tsx
```

Claim submission:

```text
src/app/claims/new
src/modules/claims/actions.ts
src/modules/claims/validators/new-claim-schema.ts
src/core/domain/claims/services/SubmitClaimService.ts
```

Claim approval:

```text
src/core/domain/claims/services/ProcessL1ClaimDecisionService.ts
src/core/domain/claims/services/ProcessL2ClaimDecisionService.ts
src/modules/claims/actions.ts
```

Claim list and detail:

```text
src/app/(dashboard)/dashboard/my-claims
src/app/(dashboard)/dashboard/claims/[id]
src/modules/claims
```

Claim export:

```text
src/core/domain/claims/services/ExportClaimsService.ts
src/app/api/export/claims
```

Dashboard and wallet:

```text
src/app/(dashboard)/dashboard
src/core/domain/dashboard
src/modules/dashboard
```

Analytics:

```text
src/app/(dashboard)/dashboard/analytics
src/core/domain/dashboard/services/GetAnalyticsService.ts
src/modules/dashboard
```

Admin settings:

```text
src/app/(dashboard)/dashboard/admin/settings
src/modules/admin
src/core/domain/admin
```

Business Central:

```text
supabase/migrations
src/types/database.ts
bc.md
```

## Change Risk Guide

Low-risk changes usually include:

- Text-only UI copy.
- Adding non-functional documentation.
- Small display-only changes.
- Adding tests without production behavior changes.

Medium-risk changes include:

- Form validation changes.
- List filtering changes.
- Export column changes.
- Dashboard display changes.
- Admin settings UI changes.

High-risk changes include:

- Claim status changes.
- Approval workflow changes.
- Payment mode classification changes.
- Auth/session changes.
- Role/permission changes.
- Database functions.
- Business Central lifecycle.
- Migration changes that affect existing data.

For high-risk changes, verify with tests around both allowed and denied scenarios.

## End-To-End Workflow Examples

### Normal Self Expense Claim To Payment

1. Employee signs in with allowed company email.
2. Employee accepts active policy if needed.
3. Employee opens `/claims/new`.
4. Employee selects self submission.
5. Employee selects expense payment mode.
6. Employee fills invoice details.
7. Employee optionally uses AI parsing.
8. Employee uploads receipt and any required bank statement.
9. Server validates payload and files.
10. Server checks duplicates.
11. Server assigns HOD.
12. Claim is created as `Submitted - Awaiting HOD approval`.
13. HOD reviews claim.
14. HOD approves.
15. Claim becomes `HOD approved - Awaiting finance approval`.
16. Finance reviews claim.
17. Finance approves.
18. Claim becomes `Finance Approved - Payment under process`.
19. Finance completes payment.
20. Claim becomes `Payment Done - Closed`.
21. Export and analytics reflect the completed claim according to date filters and cache behavior.

### Normal On-Behalf Expense Claim

1. Submitter signs in.
2. Submitter accepts active policy.
3. Submitter opens new claim form.
4. Submitter selects on-behalf submission.
5. Submitter enters beneficiary email and employee code.
6. Server validates beneficiary email domain.
7. Server resolves or provisions beneficiary user.
8. Server generates claim ID using beneficiary employee code.
9. Server assigns HOD based on department and bypass rules.
10. Claim enters normal approval lifecycle.
11. Submitter and beneficiary can view claim according to permissions.

### HOD Rejects With Resubmission Allowed

1. Claim is submitted and awaiting HOD approval.
2. Assigned HOD opens claim.
3. HOD rejects with reason.
4. HOD selects resubmission allowed.
5. Claim becomes `Rejected - Resubmission Allowed`.
6. Submitter opens claim.
7. Submitter edits eligible fields.
8. Submitter saves corrected claim.
9. Claim remains or returns to workflow according to edit service behavior.
10. HOD can review again when the claim is eligible.

### HOD Rejects Without Resubmission

1. Claim is submitted and awaiting HOD approval.
2. Assigned HOD rejects with reason.
3. HOD selects resubmission not allowed.
4. Claim becomes `Rejected - Resubmission Not Allowed`.
5. Submitter can view rejection reason.
6. Submitter cannot edit or delete through normal own-claim workflow.

### Finance Rejects With Resubmission Allowed

1. HOD approves claim.
2. Claim enters finance queue.
3. Finance reviews claim.
4. Finance rejects with reason and resubmission allowed.
5. Claim becomes `Rejected - Resubmission Allowed`.
6. Submitter can correct the claim where own-edit rules permit.

### Finance Approves But Payment Is Not Done

1. HOD approves claim.
2. Finance approves claim.
3. Claim becomes `Finance Approved - Payment under process`.
4. Claim is not closed yet.
5. Finance later marks payment done.
6. Claim becomes `Payment Done - Closed`.

### Department Viewer Opens Claim

1. Admin assigns viewer to a department.
2. Viewer signs in.
3. Viewer opens claim command center.
4. Viewer opens department tab.
5. Viewer sees claims for assigned department.
6. Viewer opens claim detail.
7. Page renders read-only detail.
8. Viewer cannot approve, reject, edit, or delete.

### Admin Publishes New Policy

1. Admin opens System Settings.
2. Admin opens Governance policy section.
3. Admin uploads PDF and version.
4. Server validates file and admin role.
5. File is uploaded to policy storage.
6. New active policy is published.
7. Users who have not accepted this active policy are blocked by policy gate.
8. Users accept policy before continuing dashboard workflows.

### Business Central Successful Submission

1. Claim reaches `HOD approved - Awaiting finance approval`.
2. External BC service calls `get_bc_claim_payload`.
3. Database returns payload if mappings and state are valid.
4. External service calls `start_bc_claim_attempt`.
5. External service submits to BC.
6. BC returns success.
7. External service calls `complete_bc_claim`.
8. Database marks BC attempt success.
9. Claim links to BC detail.
10. Claim becomes `Finance Approved - Payment under process`.
11. Finance later marks payment done in the app.

### Business Central Failed Submission

1. Claim reaches BC-eligible status.
2. External service starts BC attempt.
3. BC API fails.
4. External service calls `record_bc_claim_failure`.
5. BC attempt row becomes failed.
6. Claim remains without BC detail link.
7. Claim can be retried after issue is fixed.
