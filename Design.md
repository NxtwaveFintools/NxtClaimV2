# NxtClaim Dashboard Design Reference

This document captures the visual, structural, and interaction design patterns used by the current dashboard page. Use it as the reference for future dashboard, claims, analytics, and admin screens so the product stays visually consistent.

Reference implementation:

- `src/app/dashboard/page.tsx`
- `src/components/app-layout.tsx`
- `src/components/sidebar.tsx`
- `src/modules/dashboard/ui/wallet-summary.tsx`
- `src/modules/dashboard/ui/recent-claims.tsx`
- `src/app/globals.css`
- `src/lib/fonts.ts`

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
```

### Dark Theme

```css
--background: #0b0f1a;
--background-secondary: #1e293b;
--foreground: #e2e8f0;
--card: #0f172a;
--border: #1e293b;
--muted: #293041;
--muted-foreground: #94a3b8;
--accent: #3b82f6;
--accent-hover: #2563eb;
--accent-muted: #1e3a5f;
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

Finance semantic colors:

- Positive money / received: `#16a34a`
- Negative balance / destructive error: `#dc2626`
- Spending / warning: `#d97706`
- Pending reimbursement: `#ea580c`
- Error surface: background `#fef2f2`, border `#fecaca`, text `#b91c1c`

Avoid expanding the palette without purpose. Blue is the interaction color, while green, red, amber, and orange communicate financial or workflow state.

## Typography

Fonts are loaded in `src/lib/fonts.ts`.

- Body: Inter via `--font-dashboard-inter`
- Display: Plus Jakarta Sans via `--font-dashboard-display`
- Fallback sans: Segoe UI / Helvetica Neue / Helvetica / Arial
- Mono: Cascadia Mono / Consolas / Courier New

Global body font:

```css
font-family: var(--font-dashboard-inter), "Inter Fallback", sans-serif;
```

Display utility:

```css
.dashboard-font-display {
  font-family: var(--font-dashboard-display), var(--font-geist-sans), sans-serif;
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
- Hover: light/dark zinc background

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
  - Icon background: `#eff6ff`
  - Icon color: `#2563eb`
  - Value color is dynamic:
    - Negative: `#dc2626`
    - Positive: `#16a34a`
    - Zero: `--foreground`
- Amount Received
  - Icon: `ArrowDownCircle`
  - Icon background: `#f0fdf4`
  - Icon/value color: `#16a34a`
  - Detail splits petty cash and reimbursements.
- Amount Spent
  - Icon: `ArrowUpCircle`
  - Icon background: `#fffbeb`
  - Icon/value color: `#d97706`
  - Detail includes claim count.
- Pending Reimbursement
  - Icon: `Clock`
  - Icon background: `#fff7ed`
  - Icon color: `#ea580c`
  - Value color is orange when pending, muted when empty.

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
- Hover: light `zinc-50`, dark `zinc-900/40`
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
- Background: `#fef2f2`
- Text: `#b91c1c`

Loading state:

- Uses `.shimmer-sweep`
- Desktop skeleton mirrors the table shape.
- Mobile skeleton mirrors stacked cards.
- Skeleton row count:
  - Desktop: 5 rows
  - Mobile: 3 cards

## Cards and Elevation

The dashboard commonly uses `.nxt-card` from `globals.css`.

Base light card:

```css
border-radius: 24px;
border: 1px solid rgba(228, 228, 231, 0.8);
background: rgba(255, 255, 255, 0.92);
box-shadow:
  0 20px 60px -20px rgba(15, 23, 42, 0.12),
  0 4px 16px -4px rgba(15, 23, 42, 0.04);
backdrop-filter: blur(8px);
```

Base dark card:

```css
border-color: rgba(63, 63, 70, 0.7);
background: rgba(24, 24, 27, 0.92);
box-shadow:
  0 20px 60px -20px rgba(0, 0, 0, 0.35),
  0 4px 16px -4px rgba(0, 0, 0, 0.15);
```

Dashboard data cards currently reduce the radius to `12px`. Continue this for dense operational modules. Reserve larger `24px` radii for broader form or content panels where the surrounding page design already uses that language.

## Buttons and Links

Dashboard inline action buttons use compact custom classes in `page.tsx`, while shared buttons live in `src/components/ui/button.tsx`.

Shared button variants:

- Primary: indigo background, white text.
- Secondary: bordered white/dark surface.
- Danger: rose.
- Success: emerald.
- Ghost: no border, hover background.

Shared button sizes:

- `xs`: `28px` height, `10px` horizontal padding, `12px` text.
- `sm`: `32px` height, `12px` horizontal padding, `12px` text.
- `md`: `36px` height, `16px` horizontal padding, `14px` text.
- `lg`: `44px` height, `20px` horizontal padding, `14px` text.

Shared button radius is currently `12px`. Dashboard intro buttons use `6px` radius to match the sidebar and table density. When designing new dashboard controls, choose the radius based on context:

- Dense navigation/table/tool controls: `6px`.
- Form actions and modal actions: shared button component default.
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
- Font family: `--font-dashboard-display` via `.dashboard-font-display`
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
- Shadow: `shadow-sm` (subtle only)
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
5. Use `.nxt-card` for dashboard data modules, usually with `borderRadius: 12`.
6. Preserve dark mode with variables or explicit dark variants.
7. Keep loading states shape-matched to final content.
8. Keep finance data right-aligned where users compare amounts.
9. Use `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })` for INR.
10. Keep role-based navigation server-controlled.

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
