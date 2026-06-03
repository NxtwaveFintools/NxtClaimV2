# NxtClaim Dashboard Design Reference

This document captures the visual, structural, and interaction design patterns used by the current dashboard page. Use it as the reference for future dashboard, claims, analytics, and admin screens so the product stays visually consistent.

Primary reference implementation:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/dashboard/my-claims/page.tsx`
- `src/app/(dashboard)/claims/new/page.tsx`
- `src/app/(dashboard)/dashboard/claims/[id]/page.tsx`
- `src/app/(dashboard)/dashboard/claims/hod-pending/page.tsx`
- `src/app/(dashboard)/dashboard/analytics/page.tsx`
- `src/app/(dashboard)/dashboard/admin/settings/page.tsx`
- `src/app/auth/login/page.tsx`
- `src/components/app-layout.tsx`
- `src/components/sidebar.tsx`
- `src/components/ui/sheet.tsx`
- `src/modules/dashboard/ui/wallet-summary.tsx`
- `src/modules/dashboard/ui/recent-claims.tsx`
- `src/modules/dashboard/ui/analytics-filters.tsx`
- `src/modules/dashboard/ui/analytics-kpi-cards.tsx`
- `src/modules/dashboard/ui/analytics-charts.tsx`
- `src/modules/claims/ui/claims-filter-bar.tsx`
- `src/modules/claims/ui/advanced-filters-sheet.tsx`
- `src/modules/claims/ui/finance-approvals-bulk-table.tsx`
- `src/modules/claims/ui/new-claim-form-client.tsx`
- `src/modules/claims/ui/claim-status-badge.tsx`
- `src/app/globals.css`
- `src/components/ui/sheet.tsx`

Current route map from `src/core/config/route-registry.ts`:

- Home: `/`
- Dashboard: `/dashboard`
- Claims command center: `/dashboard/my-claims`
- Legacy claims list redirect: `/claims`
- Legacy dashboard claims redirect: `/dashboard/claims`
- New claim: `/claims/new`
- Claim detail: `/dashboard/claims/[id]`
- HOD pending claims: `/dashboard/claims/hod-pending`
- Analytics: `/dashboard/analytics`
- System settings: `/dashboard/admin/settings`
- Login: `/auth/login`

## Product Direction

NxtClaim is a finance operations workspace for claim submission, approval tracking, reimbursement visibility, policy access, and administrative oversight. The dashboard should feel quiet, precise, and work-focused. It is not a marketing surface. It should help users scan their claim position, start common workflows, and move into detailed review screens with minimal friction.

The current dashboard design direction is:

- Compact operational UI over decorative presentation.
- Clean neutral surfaces with blue as the primary action and navigation accent.
- Dense but readable finance data, especially currency, claim IDs, statuses, and dates.
- Low visual noise, strong alignment, predictable spacing, and clear hierarchy.
- Light and dark mode parity using CSS variables rather than hardcoded theme-only colors.

## Page Architecture

The dashboard uses a persistent app shell:

- Fixed left sidebar for primary navigation and utility actions.
- Main content area offset by the sidebar width.
- Responsive behavior that collapses or hides the sidebar on mobile.
- Page content wrapped in the dashboard font variables.
- Auth, role, policy, and navigation state resolved server-side before rendering.

The top-level dashboard page is not a traditional header-plus-content layout. The sidebar owns app navigation and user controls. The content area starts directly with a personalized page heading, supporting copy, date metadata, and primary workflow actions.

## Layout System

### Desktop

Desktop uses a two-region layout:

- Sidebar: fixed at the left, full viewport height.
- Main: fills the remaining viewport width and uses `margin-left` equal to sidebar width.

Current sidebar widths:

- Expanded: `240px`
- Collapsed: `56px`

Current main content padding:

- Desktop: `32px`
- Mobile: `16px`

Main content should keep a calm vertical rhythm:

- Page intro section: compact, with `mb-4`.
- Action row: directly below metadata, `mt-3`, wrapping when needed.
- Wallet summary: immediately after intro/error state.
- Recent claims: `mt-6` after wallet summary.

### Mobile

Mobile behavior is controlled at `max-width: 767px`.

- The sidebar starts collapsed.
- When hidden, the sidebar translates off canvas.
- Opening the sidebar creates a full-screen translucent backdrop.
- The main content uses no sidebar margin when the sidebar is hidden.
- Dashboard cards collapse into one column.
- Recent claims switch from a table to stacked claim cards.

Mobile content must prioritize short labels, readable claim IDs, status visibility, and no horizontal overflow except where a desktop table intentionally owns overflow.

## Design Tokens

The primary visual system is defined in `src/app/globals.css`.

### Light Theme

Use these CSS variables instead of raw colors when possible:

```css
--background: #f8fafc;
--background-secondary: #f1f5f9;
--foreground: #0f172a;
--card: #ffffff;
--border: #e2e8f0;
--muted: #d7dee8;
--muted-foreground: #64748b;
--accent: #2563eb;
--accent-hover: #1d4ed8;
--accent-muted: #eff6ff;
--success: #16a34a;
--success-muted: #f0fdf4;
--warning: #d97706;
--warning-muted: #fffbeb;
--pending: #ea580c;
--pending-muted: #fff7ed;
--danger: #dc2626;
--danger-muted: #fef2f2;
--info: #0284c7;
--info-muted: #f0f9ff;
```

### Dark Theme

```css
--background: #0b0f1a;
--background-secondary: #111827;
--foreground: #e2e8f0;
--card: #0f172a;
--border: #1e293b;
--muted: #293041;
--muted-foreground: #94a3b8;
--accent: #3b82f6;
--accent-hover: #2563eb;
--accent-muted: #1e3a5f;
--success: #22c55e;
--success-muted: rgba(34, 197, 94, 0.12);
--warning: #f59e0b;
--warning-muted: rgba(245, 158, 11, 0.12);
--pending: #f97316;
--pending-muted: rgba(249, 115, 22, 0.12);
--danger: #f87171;
--danger-muted: rgba(248, 113, 113, 0.12);
--info: #38bdf8;
--info-muted: rgba(56, 189, 248, 0.12);
```

### Color Usage

Use color semantically:

- `--background`: full app canvas and main surface.
- `--background-secondary`: hover states, table headers, skeleton blocks.
- `--card`: sidebar and card surfaces.
- `--border`: dividers, card borders, nav boundaries.
- `--foreground`: primary text, high-emphasis values.
- `--muted-foreground`: metadata, descriptions, inactive navigation, labels.
- `--accent`: primary buttons, active navigation, links.
- `--accent-muted`: active navigation background and avatar background.

Finance semantic colors (use CSS variable tokens, not raw hex):

- `--accent` / `--accent-muted`: primary interaction (buttons, links, active nav).
- `--success` / `--success-muted`: positive money, received, approved, paid.
- `--warning` / `--warning-muted`: spending, awaiting finance, medium-priority states.
- `--pending` / `--pending-muted`: pending reimbursement, HOD-pending states.
- `--danger` / `--danger-muted`: negative balance, rejected, destructive actions, errors.
- `--info` / `--info-muted`: submitted, awaiting HOD, informational states.

Avoid expanding the palette without purpose. Blue is the interaction color, while green, amber, orange, red, and sky communicate financial or workflow state.

## Typography

Fonts are loaded via `next/font/google` in `src/app/layout.tsx` using `Plus_Jakarta_Sans` with the `--font-plus-jakarta-sans` CSS variable.

- Body: `"Plus Jakarta Sans"`, `"Plus Jakarta Sans Fallback"`, then `ui-sans-serif`, system UI, `-apple-system`, BlinkMacSystemFont, and Segoe UI.
- Display: the same Plus Jakarta Sans stack through `.dashboard-font-display`.
- Tailwind sans token: `--font-sans` points to `--font-plus-jakarta-sans`.
- Mono: Cascadia Mono / Consolas / Courier New via `--font-geist-mono`.

Global body font:

```css
font-family:
  "Plus Jakarta Sans",
  "Plus Jakarta Sans Fallback",
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Display utility:

```css
.dashboard-font-display {
  font-family:
    "Plus Jakarta Sans",
    "Plus Jakarta Sans Fallback",
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}
```

Current dashboard heading scale:

- Page title: `24px`, `600`, foreground.
- Body description: `15px`, regular, muted foreground.
- Metadata/date: `14px`, muted foreground.
- Section eyebrow labels: `11px`, `600`, uppercase, `0.06em` letter spacing.
- Metric value: `22px`, `700`, line height `1.2`.
- Table body: `14px`.
- Table header: `11px`, uppercase, `600`, `0.06em` letter spacing.

Keep operational pages compact. Do not use oversized hero typography inside the dashboard shell.

## Sidebar

The sidebar is the primary app navigation surface.

### Structure

The sidebar has four vertical areas:

1. Logo header.
2. Primary navigation.
3. Utility navigation.
4. User footer.

Logo header:

- Height: `48px`
- Expanded padding: `0 16px`
- Collapsed: centered icon only
- Bottom border: `1px solid var(--border)`
- Brand text: `NxtClaim V2`, `16px`, `600`

Primary navigation:

- Starts at `pt-2`
- Each row is `36px` tall
- Horizontal margin: `1px 8px`
- Border radius: `6px`
- Icon size: `16px`
- Expanded gap: `10px`
- Label size: `14px`

Utility navigation:

- Top border: `1px solid var(--border)`
- Contains Company Policy and theme toggle.

User footer:

- Height: `60px`
- Top border: `1px solid var(--border)`
- Avatar: `32px` circle
- Avatar background: `--accent-muted`
- Avatar text: `--accent`
- User display name: `14px`, `500`
- Email domain: `12px`, muted
- Sign-out button: `28px` square

### Navigation States

Active nav item:

- Background: `--accent-muted`
- Left border: `3px solid var(--accent)`
- Text/icon color: `--accent`
- Font weight: `500`
- Padding adjusted to preserve alignment with the left border.

Inactive nav item:

- Transparent background
- Left border: `3px solid transparent`
- Text/icon color: `--muted-foreground`

Hover for inactive items:

- Background: `--background-secondary`
- Text/icon color: `--foreground`

Collapsed state:

- Width: `56px`
- Text labels hidden.
- Icons centered.
- Tooltips appear to the right on hover.
- Collapse button chevron rotates `180deg`.

Collapse toggle:

- Size: `24px`
- Rounded full
- Positioned at sidebar right edge, vertically centered
- Border: `--border`
- Background: `--card`
- Shadow: `0 1px 3px rgba(0,0,0,0.08)`

## Dashboard Intro Section

The intro section establishes user context and gives direct access to common workflows.

Content order:

1. Greeting: `Good morning/afternoon/evening, {firstName}`
2. Description of the finance workspace
3. Current date with `CalendarDays` icon
4. Action row

Greeting is based on India time using `Asia/Kolkata`.

Primary dashboard description:

```text
Manage submissions, approvals, and payment progress from a single finance workspace with a cleaner, more focused review surface.
```

Action row:

- Uses `flex`, `flex-wrap`, `gap-2`
- Top margin: `12px`
- Button height: `36px`
- Horizontal padding: `16px`
- Border radius: `6px`
- Font size: `14px`
- Font weight: `500`
- Icon size: `14px`

Primary action:

- Label: `New Claim`
- Icon: `CirclePlus`
- Background: `--accent`
- Text: white
- Hover: opacity reduction

Secondary actions:

- Labels: `Claims`, optionally `System Settings`
- Icons: `FileText`, `Settings`
- Transparent background
- Border: `--border`
- Text: `--muted-foreground`
- Hover: `--background-secondary`

## Wallet Summary

The wallet summary is the first data module in the dashboard.

Section label:

- Text: `WALLET SUMMARY`
- Uppercase `11px`, `600`, `0.06em`
- Bottom margin: `12px`

Grid:

- Mobile: one column
- Small screens: two columns
- Large screens: four columns
- Gap: `16px`

Card styling:

- Uses `.nxt-card`
- Dashboard overrides radius to `12px`
- Padding: `16px`
- Layout: vertical flex, `gap-3`

Metric card anatomy:

1. Top row with uppercase label and icon badge.
2. Large metric value.
3. Muted explanatory detail.

Shared metric label:

- `11px`
- `600`
- Uppercase
- Letter spacing: `0.06em`
- Color: `--muted-foreground`

Shared value:

- `22px`
- `700`
- Line height: `1.2`

Shared subtext:

- `12px`
- Line height: `1.6`
- Color: `--muted-foreground`
- Top margin: `2px`

Icon badge:

- Size: `36px`
- Border radius: `10px`
- Centered icon
- Icon size: `16px`

Current wallet cards:

- Petty Cash Balance
  - Icon: `Wallet`
  - Icon background: `--accent-muted`
  - Icon color: `--accent`
  - Value color is dynamic:
    - Negative: `--danger`
    - Positive: `--success`
    - Zero: `--foreground`
- Amount Received
  - Icon: `ArrowDownCircle`
  - Icon background: `--success-muted`
  - Icon/value color: `--success`
  - Detail splits petty cash and reimbursements.
- Amount Spent
  - Icon: `ArrowUpCircle`
  - Icon background: `--warning-muted`
  - Icon/value color: `--warning`
  - Detail includes claim count.
- Pending Reimbursement
  - Icon: `Clock`
  - Icon background: `--pending-muted`
  - Icon color: `--pending`
  - Value color is pending when pending, muted when empty.

Currency formatting:

- Locale: `en-IN`
- Currency: `INR`
- Minimum and maximum fraction digits: `2`
- Negative values should keep the minus sign before the formatted INR value.

## Recent Claims

Recent claims are the second primary data module.

Section label:

- Text: `RECENT CLAIMS`
- Same section label styling as wallet summary.

Container:

- Uses `.nxt-card`
- Border radius overridden to `12px`
- `overflow-hidden`

### Desktop Table

Desktop table is shown at `md` and above.

Table:

- Minimum width: `960px`
- Full width
- Fixed layout
- Text size: `14px`
- Horizontal scrolling wrapper when needed

Column distribution:

- Claim ID: `34%`
- Date: `12%`
- Category: `18%`
- Amount: `12%`
- Status: `16%`
- Action: `8%`

Header:

- Background: `--background-secondary`
- Bottom border: slate/zinc theme border
- Cell padding: `12px 20px`
- Text: uppercase `11px`, `600`, `0.06em`
- Color: `--muted-foreground`

Rows:

- Height: `56px`
- Bottom border
- Hover: `bg-background-secondary`
- Claim ID link uses `--accent`
- Amount is right-aligned and semibold.
- Status is center-aligned.
- Action uses `View` plus `ExternalLink`.

### Mobile Cards

Mobile cards replace the table below `md`.

Each claim card:

- Padding: `16px`
- Divided by `--border`
- Vertical spacing: `8px`

Mobile content order:

1. Claim ID link and status badge.
2. Category and amount.
3. Date and `View details` link.

This layout keeps the claim identity and status visible before secondary metadata.

### Empty, Loading, and Error States

Empty state:

- Centered inside recent claims card.
- Padding: `32px 20px`
- Title: `No recent claims`
- Description: `Submitted claims will appear here.`

Error state:

- Inline message at the top of the recent claims card.
- Border bottom uses `--border`.
- Background: `var(--danger-muted)`
- Text: `var(--danger)`

Loading state:

- Uses `.shimmer-sweep`
- Desktop skeleton mirrors the table shape.
- Mobile skeleton mirrors stacked cards.
- Skeleton row count:
  - Desktop: 5 rows
  - Mobile: 3 cards

## Cards and Elevation

The dashboard uses flat operational surfaces. `.nxt-card` from `globals.css` is now the baseline for cards, panels, tables, and compact data modules.

Current `.nxt-card`:

```css
border-radius: 12px;
border: 1px solid var(--border);
background: var(--card);
box-shadow: none;
transition:
  border-color 200ms ease,
  box-shadow 200ms ease,
  background-color 200ms ease;
```

Dark mode keeps the same structure:

```css
border-color: var(--border);
background: var(--card);
box-shadow: none;
```

Card rules:

- Use `12px` radius for dashboard cards, filters, tables, detail panels, analytics cards, settings panels, and form sections.
- Use `border: 1px solid var(--border)` and `background: var(--card)` for standard panels.
- Avoid glassmorphism, translucent cards, large shadows, and blur-heavy surfaces inside the app shell.
- Use `bg-background-secondary` inside a card for grouped sub-panels, upload drop zones, read-only input backgrounds, and table headers.
- Prefer spacing and borders over elevation to create hierarchy.
- If a shadow is needed for an overlay or popover, keep it subtle and local. Do not reintroduce global premium card shadows.

## Buttons and Links

Dashboard inline action buttons use compact custom classes in `page.tsx`, while shared buttons live in `src/components/ui/button.tsx`.

Shared button variants from `src/components/ui/button.tsx`:

- Primary: `bg-accent`, white text, hover `bg-accent-hover`, no shadow.
- Secondary: `border-border`, `bg-card`, foreground text, hover `bg-background-secondary`, no shadow.
- Danger: `border-danger/30`, `bg-danger-muted`, `text-danger`, hover `bg-danger/10`.
- Success: `border-success/30`, `bg-success`, white text, hover `bg-success/90`.
- Ghost: no border, foreground text, hover `bg-background-secondary`.

Shared button sizes:

- `xs`: `28px` height, `10px` horizontal padding, `12px` text.
- `sm`: `32px` height, `12px` horizontal padding, `12px` text.
- `md`: `36px` height, `16px` horizontal padding, `14px` text.
- `lg`: `44px` height, `20px` horizontal padding, `14px` text.

Shared button radius is currently Tailwind `rounded-lg` (`8px`). Dashboard intro buttons and dense table controls often use `6px` radius to match the sidebar and table density. When designing new dashboard controls, choose the radius based on context:

- Dense navigation/table/tool controls: `6px`.
- Form actions and modal actions: shared button component default, usually `8px`.
- Metric cards: `12px`.

Links:

- Use `--accent` for important navigational links.
- Add underline only on hover for table and card links.
- Include icons for external/detail actions where space allows.

## Icons

Icons come from `lucide-react`.

Current dashboard icon usage:

- Dashboard navigation: `LayoutDashboard`
- New Claim: `CirclePlus`
- Claims: `FileText`
- HOD Pending: `CalendarDays`
- Analytics: `BarChart3`
- System Settings: `Settings`
- Sidebar collapse: `ChevronLeft`
- Sign out: `LogOut`
- Theme: `Moon`, `Sun`
- Wallet cards: `Wallet`, `ArrowDownCircle`, `ArrowUpCircle`, `Clock`
- Recent claims actions: `ExternalLink`, `ArrowUpRight`

Use `aria-hidden="true"` for decorative icons and meaningful `aria-label` on icon-only buttons.

Icon sizing:

- Sidebar nav icons: `16px`
- Intro action icons: `14px`
- Wallet card icons: `16px` inside `36px` badges
- Small metadata icons: `14px`
- Mobile detail link icons: `12px`

## Motion and Interaction

Motion is functional and restrained.

Current transitions:

- Theme body background/color: `180ms ease`
- Sidebar width/transform: `200ms ease`
- Main margin-left: `200ms ease`
- Sidebar chevron rotation: `200ms ease`
- Nav and button color transitions via Tailwind `transition-colors`
- Skeleton shimmer: `1.8s linear infinite`

Avoid large page animations in the dashboard shell. Motion should clarify state changes, hover affordance, loading progress, or navigation context.

## Loading Skeletons

Skeletons are designed to preserve layout and reduce content shift.

Global shimmer:

- Class: `.shimmer-sweep`
- Uses an animated pseudo-element.
- Light theme shimmer has a stronger white highlight.
- Dark theme shimmer has a subtler highlight.

Dashboard full-page skeleton mirrors:

- Fixed sidebar with logo, nav rows, and user footer.
- Main intro title/description/date placeholders.
- Action button placeholders.
- Wallet summary card placeholders.

Widget skeletons should match the final component shape as closely as possible.

## Role-Aware Navigation

Navigation is assembled server-side from user capabilities.

Always visible:

- Dashboard
- New Claim
- Claims

Visible for finance pending approvals viewers:

- HOD Pending

Visible for analytics viewers:

- Analytics

Visible for admins:

- System Settings

The active state is passed as part of each nav item. New dashboard routes should set exactly one active item when possible.

## Accessibility

Current accessibility patterns:

- Sidebar primary nav uses `aria-label="Dashboard navigation"`.
- Icon-only collapse button has `aria-label`.
- Theme toggle has `aria-label`.
- Sign-out icon button has `aria-label`.
- Wallet metric grid has `aria-label="Wallet summary metrics"`.
- Decorative icons use `aria-hidden="true"`.
- Collapsed sidebar still exposes labels through hover tooltips, but keyboard-visible labels are limited in collapsed mode.

Future improvements should preserve:

- Keyboard focus visibility for all links and buttons.
- Sufficient contrast across light and dark themes.
- Semantic table markup for tabular claim data.
- Non-color text labels for important statuses via `ClaimStatusBadge`.

## Responsive Rules

Use these responsive expectations for new dashboard modules:

- Primary dashboard modules should fit one column on mobile.
- Metric grids can expand to two columns at `sm` and four columns at `lg`.
- Wide data tables should either provide a card mobile layout or an intentional horizontal scroll container.
- Avoid hiding critical workflow state on mobile.
- Use wrapping action rows for buttons.
- Keep minimum touch targets near or above `36px`.

## Content Voice

Dashboard copy should be direct and operational.

Good:

- `New Claim`
- `Claims`
- `System Settings`
- `No recent claims`
- `Submitted claims will appear here.`
- `Awaiting HOD or finance action`

Avoid:

- Marketing language.
- Long explanations inside dashboard cards.
- Decorative headings that do not map to a task or data group.
- Instructions that repeat what the controls already communicate.

## Current Screen Library

The current application is broader than the dashboard home page. Future UI work should treat the following route-level screens as the design source for each workflow family.

### Dashboard Home

Route: `/dashboard`

Reference files:

- `src/app/(dashboard)/dashboard/page.tsx`
- `src/modules/dashboard/ui/wallet-summary.tsx`
- `src/modules/dashboard/ui/recent-claims.tsx`

Use this page as the reference for landing-page density inside the authenticated app shell:

- Intro copy is compact and personalized.
- Primary action is `New Claim`.
- Secondary actions are `Claims` and, for admins, `System Settings`.
- Data appears immediately below actions, with wallet summary first and recent claims second.
- The page does not use a top app bar. Navigation stays in the sidebar.
- Cards use flat `12px` panels with borders, not elevated marketing cards.

### Claims Command Center

Route: `/dashboard/my-claims`

Reference files:

- `src/app/(dashboard)/dashboard/my-claims/page.tsx`
- `src/modules/claims/ui/claims-filter-bar.tsx`
- `src/modules/claims/ui/advanced-filters-sheet.tsx`
- `src/modules/claims/ui/finance-approvals-bulk-table.tsx`
- `src/modules/admin/ui/admin-claims-section.tsx`
- `src/modules/claims/ui/department-claims-section.tsx`
- `src/modules/claims/ui/claims-approvals-section.tsx`

The claims command center is the main operational workbench for submissions, approvals, admin claim oversight, and department read-only review.

Shell:

- Max width: `1600px`.
- Bottom padding: `pb-16`.
- Vertical rhythm: `space-y-3`.
- Page title: `Claims`, `24px`, `600`, `dashboard-font-display`.
- Description: `Command center for submissions and approvals`, `14px`, muted.
- Primary CTA: `New Claim`, `36px` tall, `rounded-md`, `--accent`, white text, `CirclePlus` icon.

Role-aware view tabs:

- Container is inline, wrapped, `rounded-lg`, `border-border`, `bg-card`, `p-1`.
- Use `role="tablist"` and `aria-label="Claim views"`.
- Each item uses `role="tab"` and `aria-selected`.
- Active tab: `border-accent`, `bg-accent`, white text.
- Inactive tab: `border-border`, `bg-card`, muted text, hover `bg-background-secondary` and foreground text.
- Height: `34px`.
- Labels currently used:
  - `My Submissions`
  - `Finance Queue` when the viewer has a finance approval scope
  - `Approvals` when the viewer has approval visibility without a finance scope
  - `Admin Active`
  - `Admin Deleted`
  - `Department Claims`

Default view behavior:

- Non-admin users with approval visibility are routed into approvals by default.
- Finance users can receive a default status filter for their queue.
- Admin and department views are only rendered when the current user has the corresponding capability.
- Preserve the current query string when moving between views unless a view-specific default needs to be applied.

### Claims Filter Bar

Reference file: `src/modules/claims/ui/claims-filter-bar.tsx`

The claims filter bar is used by submissions, approvals, admin, and department views.

Container:

- `rounded-xl`
- `border border-border`
- `bg-card`
- `p-3`
- Relative positioning so the pending overlay can cover the whole filter panel.

Pending overlay:

- Covers the filter panel with `bg-card/90`.
- Shows a small spinner and text `Updating results...`.
- Keeps the layout underneath stable while server data refreshes.

Primary grid:

- Mobile: one column.
- Small screens: two columns.
- Medium: three columns.
- Extra large: `1fr 1.5fr 1fr 145px 145px`.
- Gap: `8px`.

Primary fields:

- `Search Category`
- `Search`
- `Status`
- `From`
- `To`

Search category options:

- Claim ID
- Employee name
- Employee ID
- Employee email

Search behavior:

- Search input is debounced before URL sync.
- Search placeholder changes based on selected search category.
- Search category defaults to `claim_id`.
- URL params are the source of truth when present.
- If the URL has no active filters, saved session storage values can restore filter state.
- Cursor, previous cursor, and legacy page params are cleared whenever filters change.

Filter persistence:

- Filter state is stored in `sessionStorage` using a scope-specific key prefix.
- Storage scopes are based on `storageScope`, `exportScope`, or `submissions` fallback.
- Persisted fields include search input, search field, submission type, payment mode, department, location, product, expense category, status, from date, and to date.
- Back and forward browser navigation should resync local state from the URL.

Date behavior:

- Standard `from` and `to` fields are normalized to ISO date-only values.
- When standard dates are used with a status, the filter can infer a `date_target`.
- Advanced filters intentionally remove standard `from`, `to`, and `date_target` params when applied.

Status behavior:

- Status filter can be visible, hidden, or disabled.
- Locked status views force the local status value to the locked status.
- Disabled status select uses `cursor-not-allowed` and reduced opacity.
- Hidden status mode removes the field from the primary grid.

Action row:

- Uses `mt-2`, flex wrap, `gap-2`.
- Buttons are `36px` tall, `rounded-md`, and use compact `14px` text.
- `More Filters` toggles the expanded panel and owns `aria-expanded` plus `aria-controls="claims-filter-panel"`.
- `Export Excel` appears when an export scope is supplied.
- `Clear All` resets filter state while preserving the active view and locked status.
- A `Filters applied` pill appears when active filter params exist.

More filters panel:

- Controlled by the `filters` query param: `open` or `closed`.
- Uses a grid transition with `duration-300`.
- Fields: `Submission Type`, `Payment Mode`, `Department`, `Location`, `Product`, `Expense Category`.
- Grid: one column on mobile, two at `sm`, three at `md`, four at `xl`.
- Advanced filters sheet appears only for admin-capable finance views where `isAdmin` is true.

Export behavior:

- Export downloads an `.xlsx` file from `/api/export/claims`.
- Export requires both `from` and `to` dates.
- Export rejects invalid ranges where the end date is before the start date.
- Error text uses toast messaging and user-friendly error mapping.
- Cursor, previous cursor, and page params are removed before export.
- The export scope is passed as `scope` and can represent submissions, approvals, admin, or department context.

### Advanced Filters Sheet

Reference file: `src/modules/claims/ui/advanced-filters-sheet.tsx`

The advanced filter sheet is a right-side panel for admin-level claim analysis.

Trigger:

- Label: `Advanced Filters`.
- Height: `36px`.
- Visual tone: `border-info/40`, `bg-info-muted`, `text-info`.
- Shows an active-count pill when any advanced filter is set.
- Uses a small inline filter icon.

Panel structure:

- Side: right.
- Width: full viewport on narrow screens, max width `md` from the shared sheet component.
- Title: `Advanced Filters`.
- Description: `Apply independent date ranges for Submitted, HOD action, and Finance action, plus optional amount range.`
- Scroll body: `max-h-[calc(100vh-170px)]`, `.nxt-scroll`, vertical spacing `20px`.

Filter groups:

- Submitted Date: From, To.
- HOD Action Date: From, To.
- Finance Action Date: From, To.
- Amount Range: Min Amount, Max Amount.

Field style:

- Section cards use `rounded-xl`, border, `p-3`.
- Group headings are `12px`, uppercase, semibold, wide tracking.
- Inputs are `32px` tall, `rounded-lg`, `12px` text.

Footer actions:

- `Reset Advanced`: bordered neutral button.
- `Apply`: accent button.
- Apply is disabled when no advanced fields are populated.
- Applying advanced filters deletes standard `from`, `to`, and `date_target` query params.
- Reset deletes all `adv_*` date params and amount params.

### Claims Tables

The app uses two table strategies depending on the audience and density.

Card-mobile tables:

- Used by recent claims and the user's own submissions.
- Desktop uses a table at `md` and above.
- Mobile uses stacked claim cards.
- Claim ID and status must be visible first.
- Amount and type appear before secondary metadata.
- Actions remain visible at the bottom of each card.

Horizontal-scroll operational tables:

- Used by finance approvals, admin active/deleted claims, and department claims.
- Use `.nxt-scroll` and `overflow-x-auto`.
- Keep one dense table rather than replacing with cards.
- Intended for power users who compare many columns and work across queues.
- Use `table-fixed` with explicit column widths.

Common table shell:

- Outer section: `rounded-xl`, `border-border`, `bg-card`, `overflow-hidden` when appropriate.
- Header row: `bg-background-secondary`, uppercase `11px`, `0.06em`, muted.
- Body: `bg-card`, `13px`, foreground.
- Row borders: `divide-y divide-border`.
- Row hover: `hover:bg-background-secondary`.
- Claim ID links use accent color and should expose the full ID in `title` when truncated.
- Amounts are right-aligned and semibold.
- Status cells are centered or full-width depending on table density.
- Actions are right-aligned and compact.

Common operational columns:

- Claim
- Submitter / Beneficiary
- Dept
- Type or Payment Mode
- Amount
- Status
- Submitted, with HOD and Finance action dates below when available
- Actions

My Submissions table specifics:

- Section header label: `My Submissions`.
- Summary text: `Showing {rows.length} of {totalCount} claims`.
- Desktop columns: Claim, Submitter, Department, Type, Amount, Status, Submitted, Actions.
- Mobile claim cards include claim ID, status, amount, type, submitted date, department, submitter/beneficiary, and actions.
- Empty state title: `No claims found`.
- Empty state description: `Try changing filters or clearing the current search.`
- Empty state includes a `New Claim` action.

Pagination:

- Inline pagination appears in table headers when data exists.
- The summary remains visible in the footer.
- Cursor params are removed when filters change.
- Pagination controls should not compete visually with primary page actions.

Empty states:

- Use `TableEmptyState` for dense table views.
- Keep title direct, for example `No claims found`.
- Provide one short sentence for recovery, for example `Adjust filters or check back later.`

Error states:

- Use `border-danger/30 bg-danger-muted text-danger` for error surfaces.
- Keep error copy user-friendly through the error mapping utilities.
- Do not expose raw service or database messages in the UI.

### Bulk Approval Pattern

Reference file: `src/modules/claims/ui/finance-approvals-bulk-table.tsx`

Bulk actions are available only on non-read-only approval queues.

Selection:

- Master checkbox has `aria-label="Select all claims on this page"`.
- Row checkbox label includes the claim ID.
- Non-actionable rows reserve checkbox space with an empty placeholder so columns remain aligned.
- A selected-count bar appears only when selected count is greater than zero.

Selected-count action bar:

- Container: `m-3`, `rounded-lg`, `border-border`, `bg-accent-muted/40`, compact padding.
- Left side: `{selectedCount} selected`.
- Right side: action buttons.
- Buttons are `32px` tall, `12px` text, semibold.

Bulk actions:

- `Bulk Approve`: `border-success/40`, `bg-success-muted`, `text-success`, hover `bg-success/10`.
- `Bulk Reject`: `border-danger/40`, `bg-danger-muted`, `text-danger`, hover `bg-danger/10`.
- `Bulk Mark Paid`: neutral bordered button with accent text, finance queue only.
- Buttons use disabled states and `title` messages when the selected statuses are not valid for that action.
- Submitting buttons show compact spinner and `Processing...` text.

Global selection affordance:

- When all actionable claims on the current page are selected and there are more matching claims, show `Select all {totalSelectableCount} claims`.
- When global selection is active, show a `border-success/30 bg-success-muted text-success` confirmation bar.
- Provide `Keep page-only selection` to return to page-only selection.

Bulk reject dialog:

- Full-screen fixed overlay.
- Backdrop button has `aria-label="Close bulk reject dialog"`.
- Dialog width: `92vw`, max `lg`.
- Card: `rounded-xl`, border, `bg-card`, no shadow.
- Title: `Bulk Reject Claims`.
- Description explains that one reason applies to all selected claims.
- Textarea requires at least 5 characters.
- Optional checkbox: `Allow resubmission for all selected claims`.
- Actions: `Cancel`, `Confirm Bulk Rejection`.

### Status Badges

Reference file: `src/modules/claims/ui/claim-status-badge.tsx`

Status badges use `ClaimStatusBadge` for all claim status labels.

Variants:

- Default compact mode maps long statuses to shorter labels and exposes the full status in `title`.
- `fullStatus` shows the database/workflow status text exactly.
- `fullWidth` expands the badge for table cells and centers multiline text.
- `className` can be used for local spacing, not semantic color overrides.

Compact label mapping:

- `Finance Approved - Payment under process` becomes `Payment Processing`.
- `Payment Done - Closed` becomes `Paid`.
- `HOD approved - Awaiting finance approval` becomes `Awaiting Finance`.
- `Submitted - Awaiting HOD approval` becomes `Awaiting HOD`.
- Rejection statuses become `Rejected`.

Status tones (via `ClaimStatusBadge` CSS-variable classes):

- Rejected: `border-danger/40 bg-danger-muted text-danger`.
- Submitted, Pending, Awaiting HOD: `border-info/40 bg-info-muted text-info`.
- Awaiting Finance: `border-warning/40 bg-warning-muted text-warning`.
- Approved and payment processing: `border-success/40 bg-success-muted text-success`.
- Paid: `border-success/40 bg-success-muted text-success`.
- Unknown or fallback: `border-border bg-background-secondary text-muted-foreground`.

Usage rules:

- Use compact mode in dense recent-claim tables where horizontal space is limited.
- Use `fullStatus` on claim detail, mobile claim cards, and operational queues where the precise workflow state matters.
- Use `fullWidth fullStatus` in dense queue tables so statuses align and wrap safely.
- Never rely on color alone. The status text must always be visible.

### New Claim Page

Route: `/claims/new`

Reference files:

- `src/app/(dashboard)/claims/new/page.tsx`
- `src/modules/claims/ui/new-claim-form-client.tsx`
- `src/modules/claims/ui/new-claim-form-skeleton.tsx`
- `src/components/ui/ai-disclaimer.tsx`
- `src/components/ui/ai-audit-caption.tsx`

Page shell:

- Max width: `1440px`.
- Bottom padding: `pb-20` because the submit bar is fixed.
- Header is a bordered `rounded-xl` card with `bg-card`.
- Header title: `New Claim`, `18px` on mobile, `20px` on larger screens.
- Header copy: `Submit one claim for one transaction. Review all details before submission.`

Form layout:

- Form uses a two-column desktop layout with `lg:flex-row`.
- Mobile and tablet stack vertically.
- Left column: claim context and financial form fields.
- Right column for expenses: sticky evidence and review panel.
- Desktop evidence panel is `lg:sticky`, `top-6`, with max height `calc(100vh - 48px)` and vertical scroll.
- When the detail type is `advance` (Petty Cash Request), the form section uses `lg:flex-1` to fill the remaining space instead of the default `lg:w-1/2`.
- Sections use `rounded-xl`, `border-border`, `bg-card`, `p-4` to `18px`.

Global form field styling:

- Inputs and selects are `38px` tall.
- Inputs, selects, and textareas use `.nxt-input` focus behavior.
- Radius: `8px`.
- Text size: `14px` for fields.
- Labels are usually `12px` to `13px`, medium, `text-muted-foreground`.
- Required markers use `text-danger`.
- Validation errors use `text-xs text-danger`.

Submission Context section:

- Shows a compact `Submitting as` strip with current user name and email.
- Fields include Employee ID, Submission Type, Department, CC Emails, approver name/email, and Payment Mode.
- Submission Type supports `Self` and `On Behalf`.
- On Behalf reveals required email and employee ID fields.
- Approver fields are read-only and use a muted background.
- `Clear Defaults` appears only when defaults were auto-filled and hydration is complete.

Expense Details section:

- Used when detail type is `expense`.
- Fields include Bill No, Purpose, Expense Category, Product, Location, Vendor, Transaction Date, Remarks, and People Involved.
- NIAT-specific location type fields can appear conditionally.
- Bank statement requirement messaging appears below Expense Category when relevant.

Tax Details sub-panel:

- Uses a nested rounded card with `border-border bg-background-secondary`.
- Heading: `Tax Details`, `11px`, medium, tracking wide.
- Fields include GST Number, IGST, CGST, SGST, Basic Amount, and read-only Total Amount.
- Total Amount is disabled/read-only and visually muted.

Foreign Expense Details sub-panel:

- Same nested panel pattern as Tax Details.
- Fields include Foreign Currency, Foreign Basic Amount, Foreign GST Amount, and read-only Foreign Total Amount.
- Current currency options include INR, USD, EUR, and CHF.

Petty Cash Request Details section:

- Used when detail type is `advance`.
- Upload supporting document is optional.
- Fields include Total Amount, Expected Usage Date, Budget Request Month, Budget Request Year, and Purpose/Reason.
- Upload accepts PDF, JPG, PNG, and WEBP with max size 25MB.

Evidence and Review panel:

- Heading: `Evidence & Review`.
- Description: `Keep evidence visible while you complete the claim.`
- Invoice/Bill upload is required for expense claims.
- Bank Statement upload is required only for configured categories, otherwise optional.
- Upload rows use bordered cards on `bg-background-secondary`.
- Choose-file labels are styled as `36px` compact buttons.
- File metadata shows filename and formatted size when present.
- Empty file state: `No file selected`.

AI extraction behavior:

- Uploading an invoice can start AI receipt extraction.
- Manual trigger label: `Extract from invoice`.
- Loading label: `Extracting...`.
- Upload toast: `Fetching AI details...`.
- Success toast: `Details fetched!`.
- Low confidence receipt warning: `Receipt quality is low. Please verify all auto-filled fields carefully.`
- Bank statement upload can run bank-statement matching.
- Bank statement loading toast: `AI is fetching bank statement details...`.
- Bank statement success toast: `Matched INR amount from bank statement.`
- Low confidence bank warning: `Bank statement match is low confidence. Please verify the selected INR amount carefully.`
- Failed or unclear extraction tells the user to enter details manually.
- Always include the AI disclaimer near AI-triggering controls.

Evidence preview tabs:

- Role: `tablist`, label `Evidence preview tabs`.
- Tabs: `Invoice`, `Bank Statement`.
- Disabled tabs have reduced opacity and no pointer events.
- Active tab uses `--accent-muted` background and `--accent` text.
- Preview panel minimum height: `280px`, `360px` on large screens.
- Image previews use `object-contain` and include descriptive alt text.
- PDF previews use `iframe` with descriptive title.
- Empty previews use short centered muted text.

Submit bar:

- Fixed to the bottom of the viewport.
- Height: `60px`.
- Background: `bg-card/95` with backdrop blur.
- Border top: `border-border`.
- Submit button: `Submit Claim`, `36px` tall, rounded-lg, accent background.
- Submitting state: spinner plus `Processing...`.
- The page bottom padding must leave room for this fixed bar.

### Claim Detail Page

Route: `/dashboard/claims/[id]`

Reference files:

- `src/app/(dashboard)/dashboard/claims/[id]/page.tsx`
- `src/modules/claims/ui/finance-edit-claim-form.tsx`
- `src/modules/claims/ui/claim-decision-action-form.tsx`
- `src/modules/claims/ui/claim-reject-with-reason-form.tsx`
- `src/modules/claims/ui/claim-evidence-viewer.tsx`
- `src/modules/claims/ui/claim-audit-timeline.tsx`
- `src/modules/claims/ui/copyable-data-card.tsx`

Page shell:

- Max width: `1600px`.
- Bottom padding: `pb-16`.
- Detail content is rendered inside Suspense with a shape-matched skeleton.

Sticky review header:

- Sticks to top of the main content area.
- Uses `bg-background` and a bottom border so it stays distinct while scrolling.
- Negative horizontal margins align it to the app shell padding.
- Contains Back button, eyebrow `Audit & Review`, claim ID, status badge, and role-appropriate actions.
- Back button uses a compact bordered card style and respects `returnTo` fallback.

Header actions:

- Status always appears through `ClaimStatusBadge fullStatus`.
- Edit action appears when the current user can edit the claim.
- Finance execution can show `mark-paid` action.
- Finance authorization can show approve and reject actions.
- L1/HOD decision can show approve and reject actions.
- Delete action appears only when the claim status allows submitter/admin deletion.
- Submitter/beneficiary constraints can disable or hide decision actions.

Hero summary card:

- Top summary card uses `rounded-xl`, `border-border`, `bg-card`, `p-3`.
- Grid: one column on mobile, two at `sm`, five at `xl`.
- Values: Total Amount, Claim For, Category, Department, Purpose.
- Total amount uses `26px`, bold, tight line height.
- Labels use uppercase `11px`, semibold, `0.06em`, muted.

Admin and read-only banners:

- Admins can see `AdminSoftDeletePanel` for active/deleted state control.
- Department viewers get a compact read-only access banner.
- Read-only banner states why the user can view the claim and avoids implying action access.

Main layout:

- Two-column layout at `lg`.
- Left column: accordions, rejection reason, audit timeline.
- Right column: evidence gallery.
- Evidence gallery appears first on mobile and sticky on desktop.
- Desktop evidence area height: `calc(100vh - 92px)`, sticky top `76px`.
- Mobile evidence area height: `460px`; `520px` at `sm`.

Rejection reason:

- Appears only for rejected statuses with a reason.
- Uses `border-danger/30 bg-danger-muted text-danger`.
- Heading: uppercase, `12px`, wide tracking.
- Reason body: `14px`, `text-danger`.

Accordion detail panels:

- Use `Accordion` with multiple sections open by default.
- Default open sections include detail-specific details, General Info, Routing Context, and Financials.
- Each accordion item is a `rounded-xl` bordered `bg-card` panel with compact padding.
- Triggers use uppercase `11px`, semibold, muted text.
- Content uses micro grids of data cards.

Detail sections:

- Expense Details or Petty Cash details.
- General Info.
- Routing Context.
- Financials.
- Audit history is rendered below accordions.

Data card rules:

- Use concise labels and raw values where audit clarity matters.
- Wide facts can span multiple grid columns.
- Optional/missing values render as `N/A`.
- Dates and currency must use shared formatting helpers.
- AI audit captions can appear below AI-derived fields.

Financials:

- Expense financials include Basic Amount, CGST, SGST, IGST, GST Number, Total Amount.
- Foreign financials appear only when foreign currency exists and is not INR.
- Advance financials focus on Total Amount and Expected Usage Date.
- Amount values should be visually comparable and consistently formatted.

Evidence gallery:

- Lives in a bordered `bg-card` aside.
- Must support multiple evidence files and preserve claim review context.
- Use skeleton fallback while evidence loads.
- On detail pages, evidence remains visible on desktop while the user reviews accordions.

Audit timeline:

- Rendered below detail accordions.
- Use a skeleton fallback while loading.
- Timeline must preserve workflow events, admin overrides, and decision actions.

Edit claim side flow:

- Finance or owner edit uses a side-panel pattern.
- Keep editing scoped to allowed fields.
- Do not navigate away from the review context unless the action completes and redirects intentionally.

### HOD Pending Claims

Route: `/dashboard/claims/hod-pending`

Reference file: `src/app/(dashboard)/dashboard/claims/hod-pending/page.tsx`

This route is a focused finance visibility route for claims stuck at HOD/L1 approval.

Behavior:

- Finance-only visibility.
- Uses the approval section infrastructure in read-only mode.
- Locks status to the HOD-pending workflow state.
- Defaults filters to expanded so finance users can narrow the queue immediately.
- Does not show row selection or bulk decision controls.
- Header uses the same dashboard heading scale as the claims command center.

Design intent:

- Make HOD-blocked work visible without implying finance can approve it directly.
- Keep table density and filters identical to approval queues so users do not learn a separate pattern.
- Use clear read-only affordances rather than disabled action clutter.

### Analytics Page

Route: `/dashboard/analytics`

Reference files:

- `src/app/(dashboard)/dashboard/analytics/page.tsx`
- `src/modules/dashboard/ui/analytics-filters.tsx`
- `src/modules/dashboard/ui/analytics-kpi-cards.tsx`
- `src/modules/dashboard/ui/analytics-charts.tsx`

Page header:

- Title: `Analytics`, `24px`, `600`, display class, slight negative tracking.
- Description: `Claim intelligence, trends, and approval efficiency.`
- Section spacing: `space-y-4`.

Filter toolbar:

- Container: `rounded-xl`, `border-border`, `bg-card`, `p-3`.
- Pending overlay covers the toolbar with `Applying filters...`.
- Labels are uppercase `11px`, semibold, `0.1em` tracking.
- Fields are compact and aligned to a responsive grid.
- Actions sit in a right-aligned flex wrap row.

Filter fields:

- Quick Presets.
- From date.
- To date.
- Department, when scope filters are allowed.
- Expense Category, when scope filters are allowed.
- Product, when scope filters are allowed.
- Finance Approver, when finance approver filtering is allowed.

Filter actions:

- `Reset`: bordered neutral, uppercase, `36px` tall.
- `Apply Filters`: accent, uppercase, `36px` tall.
- Disabled state uses reduced opacity and `cursor-not-allowed`.
- Reset removes month, from, to, department, category, product, expense category, product ID, and finance approver params.

KPI cards:

- Grid: `md:grid-cols-3`, `xl:grid-cols-5`.
- Card min height: `104px`.
- Card style: `rounded-xl`, border, `bg-card`, `p-4`.
- Label: uppercase `11px`, semibold, muted.
- Value: display class, `24px`, bold, line height `1.1`.
- Icon size: `16px`.
- Trend pill: `10px`, uppercase, semibold, positive/negative/zero tones.

KPI set:

- Total Amount: neutral value, `text-info` icon.
- Approved Amount: `text-success` value and icon.
- Pending Amount: `text-warning` value and icon.
- Pending At HOD: `text-pending` value and icon, visible for finance/admin scopes.
- Rejected Amount: `text-danger` value and icon.
- Overall Finance Team TAT: `text-info` value, admin only when data exists.

Charts and summaries:

- Chart cards use `rounded-xl`, border, `bg-card`, `p-4`, min height `320px`.
- Payment Mode Distribution uses a donut-style pie chart and adjacent table legend.
- Claims By Status uses a vertical bar chart.
- Chart animations are disabled for a stable operational feel.
- Empty chart states use centered muted text.
- Status Summary uses a dense bordered table with status, claims, and amount.
- Admin users also see efficiency tables for department approval TAT and finance approver TAT.

Chart palette:

- Payment pie: `#0EA5E9`, `#14B8A6`, `#F97316`, `#E11D48`, `#6366F1`, `#64748B`.
- Status bars: `#0EA5E9`, `#14B8A6`, `#F59E0B`, `#6366F1`, `#E11D48`, `#64748B`.
- Keep this chart palette local to analytics unless a global chart token layer is introduced.

Analytics table rules:

- Table headers use uppercase `11px`, semibold, muted.
- Amount and count columns are right-aligned.
- Use `formatCurrency` for INR amounts.
- Average day values display two decimals.
- Empty efficiency tables say `No records in this period.`

### System Settings

Route: `/dashboard/admin/settings`

Reference files:

- `src/app/(dashboard)/dashboard/admin/settings/page.tsx`
- `src/modules/admin/ui/settings/master-data-table.tsx`
- `src/modules/admin/ui/settings/departments-management.tsx`
- `src/modules/admin/ui/settings/finance-approvers-management.tsx`
- `src/modules/admin/ui/settings/department-viewers-management.tsx`
- `src/modules/admin/ui/settings/admins-management.tsx`
- `src/modules/admin/ui/settings/policy-management.tsx`
- `src/modules/admin/ui/settings/admin-claim-override.tsx`
- `src/modules/admin/ui/settings/admin-payment-mode-override.tsx`

Access:

- Admin-only route.
- Non-admin users receive `notFound()` rather than an in-page unauthorized state.

Page shell:

- Main wrapper: centered with horizontal padding, vertical padding `24px`.
- Header card: `rounded-xl`, `border-border`, `bg-card`, overflow hidden.
- Header includes Back button, `Admin Control Center` pill, active group eyebrow, `System Settings` title, group pill, and item pill.

Settings layout:

- Desktop at `xl`: `280px` left settings nav plus flexible content panel.
- Gap: `24px`.
- Settings nav is sticky at `top-24` on desktop.
- Mobile stacks nav above content.

Settings navigation:

- Outer card: `rounded-xl`, border, `bg-card`, overflow hidden.
- Header label: `Workspace Sections`.
- Nav has `aria-label="Settings navigation"`.
- Groups are separated by spacing and uppercase group labels.
- Active item: `border-accent`, `bg-accent-muted`, `text-accent`.
- Inactive item: transparent border, muted text, hover border/background/foreground.
- Item icon sits in a `36px` square rounded bordered badge.
- Active item arrow stays accent; inactive arrow nudges right on hover.

Settings groups:

- Master Data: Expense Categories, Products, Locations, Payment Modes.
- Routing: Departments & Actors, Finance Approvers, Department Viewers.
- Access: Administrators.
- Governance: Company Policy, Claim Override.

Content panel:

- Outer panel: `rounded-xl`, border, `bg-card`, overflow hidden.
- Header includes active eyebrow, icon badge, and active item label.
- Body padding: `16px` mobile, `24px` larger screens.
- Each panel owns its own loading skeleton and error state.

Master data management:

- Used for expense categories, products, locations, and payment modes.
- Treat master-data edits as operational data maintenance, not decorative settings.
- Preserve historical claim readability when names change or items are retired.
- Prefer active/inactive behavior over destructive deletion where applicable.

Routing management:

- Departments & Actors configures department ownership and permanent L1 approver assignments.
- Finance Approvers configures finance approval roster and primary approver selection.
- Department Viewers grants read-only oversight for assigned departments.

Access management:

- Administrators panel controls who can manage system settings and privileged workflows.
- Keep admin UI explicit and compact because it changes production governance.

Governance:

- Company Policy publishes revisions and can force re-acceptance before dashboard access.
- Claim Override supports exceptional status changes with audit accountability.
- Payment Mode Override appears inside claim override governance when allowed payment modes are available.

Settings errors:

- Use `border-danger/30 bg-danger-muted text-danger`.
- Pass messages through user-friendly error mapping with `settings` context.
- Avoid raw service errors in admin-facing copy.

### Shared Sheet Pattern

Reference file: `src/components/ui/sheet.tsx`

Use the shared sheet for side panels such as advanced filters and claim editing.

Behavior:

- Supports controlled and uncontrolled open state.
- Renders through a portal into `document.body`.
- Locks body scroll while open.
- Closes on Escape.
- Closes when the backdrop button is clicked.
- Provides `SheetTrigger`, `SheetContent`, `SheetClose`, `SheetHeader`, `SheetTitle`, and `SheetDescription`.

Accessibility:

- Content has `role="dialog"`.
- Content has `aria-modal="true"`.
- Title and description IDs are generated and connected through `aria-labelledby` and `aria-describedby`.
- Backdrop button has `aria-label="Close panel"`.
- Default close button has `aria-label="Close panel"`.

Visual style:

- Overlay z-index: `120`.
- Backdrop: `bg-black/50`.
- Content width: full width up to `max-w-md`.
- Content surface: `--card`.
- Border on the side connected to the page.
- Padding: `20px`.
- Shadow: none.

Usage rules:

- Use right-side sheets for filters, edit forms, and secondary workflows that should preserve the current table/detail context.
- Keep sheet titles short and task-specific.
- Put destructive or high-impact actions in the footer, not the header.
- Avoid nesting sheets inside sheets.

### AI Disclosure and Audit Captions

Reference files:

- `src/components/ui/ai-disclaimer.tsx`
- `src/components/ui/ai-audit-caption.tsx`

AI-assisted fields must be visibly identified.

Rules:

- Place `AIDisclaimer` near any AI extraction trigger.
- Use audit captions on claim detail fields that came from AI extraction metadata.
- Low-confidence extraction must prompt manual verification.
- AI should assist data entry, not silently replace user review.
- Never hide the ability to manually edit extracted form values when the workflow allows editing.

## Login Page

The login page at `/auth/login` is the authentication entry point for NxtClaim V2.

Reference implementation:

- `src/app/auth/login/page.tsx`
- `src/modules/auth/ui/login-page-content.tsx`
- `src/modules/auth/ui/email-login-form.tsx`
- `src/modules/auth/ui/oauth-buttons.tsx`

### Layout Direction

The login page uses a single centered layout — no split screen, no marketing panel, no illustration area.

```
┌────────────────────────────────────────────┐
│ Top-right theme toggle                     │
│                                            │
│              NxtClaim V2                   │
│      Claims, approvals, and finance ops    │
│                                            │
│        ┌──────────────────────────┐        │
│        │ Microsoft sign-in         │        │
│        │ Divider                   │        │
│        │ Work Email                │        │
│        │ Password                  │        │
│        │ Sign in with Email        │        │
│        └──────────────────────────┘        │
│                                            │
│        Use your approved company email…    │
└────────────────────────────────────────────┘
```

The layout is:

- Centered horizontally and vertically in the viewport.
- One focused authentication card — no second column, no decorative side panel.
- Enterprise-grade — quiet, secure, operational.

### Design Rules

- Use only the existing dashboard CSS variables. No new color palette.
- The primary email sign-in button must use `--accent` (dashboard blue, not purple/indigo).
- The page background is `--background` with a very subtle `--accent-muted` radial wash at very low opacity.
- No decorative circles, outlined blobs, floating shapes, dot grids, or gradient orbs.
- No glassmorphism or blur-heavy card surfaces.
- No marketing language, testimonials, feature lists, or fake dashboard previews.

### Background

The login page background is kept nearly flat:

- Canvas: `--background`
- Optional wash: two extremely subtle `--accent-muted` blurred blobs at 6% opacity (light) / 8% opacity (dark)
- No visible outlined circles or strong decorative shapes

### Brand Area

Placed above the login card, centered:

- Product name: `NxtClaim V2`
- Font size: `28px`
- Font weight: `700`
- Font family: current Plus Jakarta Sans display stack via `.dashboard-font-display`
- Color: `--foreground`
- Subtitle: `Claims, approvals, and finance operations`
- Subtitle size: `14px`, color: `--muted-foreground`

### Login Card

Single authentication card:

- Max width: `420px`
- Background: `--card`
- Border: `1px solid var(--border)`
- Border radius: `12px`
- Padding: `24px`
- Shadow: none
- No backdrop blur, no glassmorphism

### Microsoft Sign-In Button

Styled as a secondary/outline button:

- Full width, `40px` height
- Background: `--card`
- Border: `1px solid var(--border)`
- Border radius: `8px`
- Text: `--foreground`, `14px`, `500`
- Icon size: `18px`
- Hover: `--background-secondary`
- Text: `Sign in with Microsoft`

### Divider

Separator between OAuth and email form:

- Text: `OR CONTINUE WITH EMAIL`
- Uppercase, `11px`, `600`, `0.06em` letter spacing
- Color: `--muted-foreground`
- Thin divider lines using `--border`
- Vertical margin: `20px`

### Form Fields

Compact dashboard-style inputs:

- Labels: `Work Email`, `Password`
- Label size: `13px`, `500`, color: `--foreground`
- Input height: `40px`
- Input background: `--card`
- Input border: `1px solid var(--border)`, radius: `8px`
- Input text: `14px`, color: `--foreground`
- Placeholder: `--muted-foreground`
- Focus: `--accent` border with `2px` ring at `20%` opacity

Placeholders:

- Work Email: `name@nxtwave.co.in`
- Password: `Enter your password`

### Password Visibility Toggle

- Icon: `Eye` / `EyeOff` from `lucide-react`, `16px`
- Color: `--muted-foreground`, hover: `--foreground`
- Vertically centered inside the password input
- Accessible `aria-label`: `Show password` / `Hide password`

### Primary Submit Button

- Text: `Sign in with Email`
- Full width, `40px` height
- Background: `--accent`, hover: `--accent-hover`
- Text: white, `14px`, `600`
- Border radius: `8px`
- Disabled state: reduced opacity, `cursor: not-allowed`
- No purple gradient, no oversized shadow

### Helper Text

Below the login card:

- Text: `Use your approved company email to continue.`
- Font size: `12px`–`13px`
- Color: `--muted-foreground`
- Center aligned

### Theme Toggle

- Placement: top-right, fixed/absolute
- Size: `36px`
- Background: `--card`
- Border: `1px solid var(--border)`, radius: `8px`
- Icon size: `16px`
- Hover: `--background-secondary`

### Typography Scale

| Element       | Size   | Weight    | Color                  |
| ------------- | ------ | --------- | ---------------------- |
| Product title | `28px` | `700`     | `--foreground`         |
| Subtitle      | `14px` | `400`     | `--muted-foreground`   |
| Form labels   | `13px` | `500`     | `--foreground`         |
| Input text    | `14px` | `400`     | `--foreground`         |
| Buttons       | `14px` | `500–600` | white / `--foreground` |
| Divider       | `11px` | `600`     | `--muted-foreground`   |

### Responsive Behavior

- Desktop: centered in viewport, card max-width `420px`
- Tablet: same centered layout
- Mobile: `16px` page padding, card width `100%`, card padding `20px`, title `24px–26px`
- Theme toggle must not overlap the form on mobile

### Dark Mode

All colors use existing dark theme tokens. No hardcoded light-only colors. Inputs, borders, and text remain visible and readable.

### What the Login Page Is Not

The login page should never be:

- A split-screen or two-column layout
- A marketing landing page with testimonials or feature lists
- A generic AI SaaS template with floating blobs and neon gradients
- A glassmorphism-heavy auth surface
- A decorative illustration panel with a separate form card

## Implementation Guidelines

When adding or changing dashboard UI:

1. Prefer existing CSS variables over new hardcoded colors.
2. Match the compact dashboard density before introducing larger marketing-style sections.
3. Use `lucide-react` icons for actions and navigation.
4. Keep table and mobile-card experiences equivalent.
5. Use `.nxt-card` or the same flat `rounded-xl border border-border bg-card` pattern for dashboard data modules.
6. Preserve dark mode with variables or explicit dark variants.
7. Keep loading states shape-matched to final content.
8. Keep finance data right-aligned where users compare amounts.
9. Use `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })` or shared `formatCurrency` helpers for INR.
10. Keep role-based navigation and role-based view availability server-controlled.
11. Keep claims filter state URL-addressable so filtered views can be shared, refreshed, and exported.
12. Clear cursor and pagination params when filters change.
13. Use the shared sheet pattern for side-panel workflows that should preserve page context.
14. Use `ClaimStatusBadge` for workflow status text instead of hand-rolled badges.
15. Use advanced filters only when the current workflow needs independent submitted/HOD/finance date ranges.
16. Keep AI extraction visibly disclosed and keep user review in the workflow.
17. Prefer horizontal-scroll tables for dense admin/approval queues and mobile cards for submitter-facing claim lists.
18. Keep admin settings grouped by Master Data, Routing, Access, and Governance.

## Design Checklist

Before shipping a new dashboard-facing screen, verify:

- The page works in light and dark mode.
- Sidebar expanded and collapsed states remain usable.
- Mobile layout has no accidental horizontal overflow.
- Primary actions are visible without scrolling on normal desktop.
- Empty, loading, and error states are present.
- Currency, date, and status values are formatted consistently.
- Interactive elements have accessible names.
- The page uses the dashboard font classes.
- Card radius, border, and shadow match nearby dashboard modules.
- New colors have a semantic reason and do not weaken the existing visual system.
- Tables either provide a mobile-card layout or intentional `.nxt-scroll` horizontal scrolling.
- Claim filters preserve URL state and do not leave stale cursors behind.
- Export actions validate date ranges before starting downloads.
- Bulk actions expose disabled reasons through button titles or nearby text.
- Side panels expose title and description through dialog ARIA attributes.
- AI-assisted values have a visible disclaimer or audit caption where applicable.
- Admin-only pages fail closed for non-admins.
- Read-only routes avoid showing misleading disabled action clutter.
