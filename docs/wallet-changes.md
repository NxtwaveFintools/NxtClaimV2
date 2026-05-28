# Wallet Summary Calculation Notes

This document explains how the dashboard wallet summary values are fetched, calculated, validated, and displayed.

## Files Involved

- `src/app/dashboard/page.tsx`
  - Calls `GetWalletSummaryService.execute(userId)`.
  - Falls back to `GetWalletSummaryService.empty()` when the service returns no data.
- `src/core/domain/dashboard/contracts.ts`
  - Defines the `WalletSummaryTotals` shape used by the UI.
  - Defines the `DashboardRepository` methods used by the service.
- `src/core/domain/dashboard/GetWalletSummaryService.ts`
  - Combines repository values into the final wallet summary.
  - Preserves the existing wallet calculations for received, spent, and balance.
- `src/modules/dashboard/repositories/SupabaseDashboardRepository.ts`
  - Reads persisted wallet totals from the `wallets` table.
  - Reads pending reimbursement totals from `vw_enterprise_claims_dashboard`.
- `src/modules/dashboard/ui/wallet-summary.tsx`
  - Renders the two-tier wallet summary UI.
  - Formats values as INR currency and renders balance messaging, utilization, and pending state.

## Final Wallet Summary Fields

`WalletSummaryTotals` contains these fields:

| Field                        | Meaning                                                         | Source                                                                    |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `totalPettyCashReceived`     | Petty cash issued to the user                                   | `wallets.total_petty_cash_received`                                       |
| `totalPettyCashSpent`        | Petty cash already utilized                                     | `wallets.total_petty_cash_spent`                                          |
| `totalReimbursements`        | Reimbursements already received by the user                     | `wallets.total_reimbursements_received`                                   |
| `amountReceived`             | Total inflow shown on the dashboard                             | Calculated in `GetWalletSummaryService`                                   |
| `amountSpent`                | Total petty cash utilization shown on the dashboard             | Calculated in `GetWalletSummaryService`                                   |
| `pettyCashBalance`           | Current petty cash balance                                      | `wallets.petty_cash_balance`                                              |
| `amountSpentClaimCount`      | Number of closed petty cash claims that make up the spent total | Calculated in `SupabaseDashboardRepository.getAmountSpentClaimCount`      |
| `pendingReimbursementAmount` | Active claim amount still in approval/payment pipeline          | Calculated in `SupabaseDashboardRepository.getPendingReimbursementTotals` |
| `pendingReimbursementCount`  | Number of active claims in the approval/payment pipeline        | Calculated in `SupabaseDashboardRepository.getPendingReimbursementTotals` |

## Repository Fetches

### 1. Wallet Ledger Totals

`SupabaseDashboardRepository.getWalletTotals(userId)` queries the `wallets` table:

```ts
client
  .from("wallets")
  .select(
    "total_reimbursements_received, total_petty_cash_received, total_petty_cash_spent, petty_cash_balance",
  )
  .eq("user_id", userId)
  .maybeSingle();
```

The returned database columns are mapped as:

```ts
totalPettyCashReceived = toNumber(row.total_petty_cash_received);
totalPettyCashSpent = toNumber(row.total_petty_cash_spent);
totalReimbursements = toNumber(row.total_reimbursements_received);
pettyCashBalance = toNumber(row.petty_cash_balance);
```

If no wallet row exists, the repository returns zeroes:

```ts
{
  totalPettyCashReceived: 0,
  totalPettyCashSpent: 0,
  totalReimbursements: 0,
  pettyCashBalance: 0,
}
```

If the query fails, the repository returns `data: null` with the database error message.

### 2. Amount Spent Claim Count

`SupabaseDashboardRepository.getAmountSpentClaimCount(userId)` queries `vw_enterprise_claims_dashboard`.

It counts active, closed petty cash claims for the current beneficiary:

```ts
is_active = true
on_behalf_of_id = userId
status = "Payment Done - Closed"
type_of_claim ilike "petty cash"
```

The count is calculated as:

```ts
amountSpentClaimCount = rows.length;
```

This count is displayed under the Amount Spent card as:

```text
X claims
```

For one claim, the UI displays:

```text
1 claim
```

### 3. Pending Reimbursement Totals

`SupabaseDashboardRepository.getPendingReimbursementTotals(userId)` queries `vw_enterprise_claims_dashboard`.

It only includes rows where:

```ts
is_active = true;
on_behalf_of_id = userId;
status in
  [
    "Submitted - Awaiting HOD approval",
    "HOD approved - Awaiting finance approval",
    "Finance Approved - Payment under process",
  ];
```

The query selects only `amount`:

```ts
client
  .from("vw_enterprise_claims_dashboard")
  .select("amount")
  .eq("is_active", true)
  .eq("on_behalf_of_id", userId)
  .in("status", PENDING_REIMBURSEMENT_STATUSES);
```

The pending amount and count are calculated as:

```ts
pendingReimbursementAmount = roundCurrency(sum(toNumber(row.amount)));
pendingReimbursementCount = rows.length;
```

If the query returns no rows:

```ts
pendingReimbursementAmount = 0;
pendingReimbursementCount = 0;
```

If the query fails, the repository returns `data: null` with the database error message.

## Service Calculation Flow

`GetWalletSummaryService.execute(userId)` runs the repository calls in parallel:

```ts
const [result, pendingResult, spentCountResult] = await Promise.all([
  repository.getWalletTotals(userId),
  repository.getPendingReimbursementTotals(userId),
  repository.getAmountSpentClaimCount(userId),
]);
```

The service returns an error if any fetch fails.

### Ledger Integrity Validation

The service validates that these ledger inputs are never negative:

```ts
totalPettyCashReceived >= 0;
totalPettyCashSpent >= 0;
totalReimbursements >= 0;
```

If any of those values are negative, the service returns `data: null` and logs:

```ts
dashboard.wallet_summary.integrity_failed;
```

Important: `pettyCashBalance` is allowed to be negative. A negative balance means petty cash spent exceeds petty cash received.

### Currency Rounding

The service rounds currency values to two decimals using:

```ts
Math.round((value + Number.EPSILON) * 100) / 100;
```

This is applied to:

```ts
totalPettyCashReceived;
totalPettyCashSpent;
totalReimbursements;
amountReceived;
pettyCashBalance;
pendingReimbursementAmount;
```

`pendingReimbursementCount` is not rounded because it is a count.

### Existing Calculations

The existing three wallet calculations remain:

```ts
amountReceived = roundCurrency(totalPettyCashReceived + totalReimbursements);
amountSpent = totalPettyCashSpent;
pettyCashBalance = roundCurrency(wallets.petty_cash_balance);
amountSpentClaimCount = getAmountSpentClaimCount(userId);
```

The service does not recalculate `pettyCashBalance` from received and spent values. It uses the persisted `wallets.petty_cash_balance` value.

## Display Calculations

### INR Formatting

The UI formats all amounts using:

```ts
new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
```

Negative values are formatted with the minus sign before the currency string:

```ts
-INR amount
```

In the browser this appears with the INR currency symbol.

### Hero Card: Petty Cash Balance

The hero card displays:

```ts
summary.pettyCashBalance;
```

Color rules:

| Balance  | Color         | Meaning                    |
| -------- | ------------- | -------------------------- |
| Negative | danger red    | Company is owed money      |
| Zero     | foreground    | Balance is settled         |
| Positive | success green | User has petty cash credit |

Message rules:

```ts
if balance < 0:
  "Company is owed [absolute balance] - petty cash spent exceeds amount received"

if balance === 0:
  "Balance is settled"

if balance > 0:
  "You have [balance] in petty cash credit"
```

### Utilization Bar

The utilization bar compares:

```ts
received = summary.amountReceived;
spent = summary.amountSpent;
```

The fill width is calculated as:

```ts
if spent <= 0:
  width = "0%"

else if received <= 0:
  width = "100%"

else:
  width = min((spent / received) * 100, 100) + "%"
```

Examples:

| Received | Spent | Fill Width |
| -------- | ----- | ---------- |
| 100      | 25    | 25%        |
| 100      | 150   | 100%       |
| 0        | 50    | 100%       |
| 100      | 0     | 0%         |

The bar is capped at 100%, so overspending does not overflow the UI.

When spending exceeds received amount, the UI also renders a small received threshold marker on the bar.

The marker position uses the spent amount as the visual scale:

```ts
receivedMarkerLeft = (received / spent) * 100;
```

Example:

```ts
received = 22
spent = 123
receivedMarkerLeft = 17.9%
```

The fill remains 100% because spent exceeds received, but the marker shows where the received amount sits relative to the larger spent amount.

### Amount Received Card

The Amount Received card displays:

```ts
summary.amountReceived;
```

Breakdown rows:

```ts
Petty Cash = summary.totalPettyCashReceived
Reimbursements = summary.totalReimbursements
```

Formula relationship:

```ts
amountReceived = totalPettyCashReceived + totalReimbursements;
```

### Amount Spent Card

The Amount Spent card displays:

```ts
summary.amountSpent;
```

Formula:

```ts
amountSpent = totalPettyCashSpent;
```

The supporting text is static:

```text
Total petty cash utilized across submitted claims
```

The second supporting line displays:

```text
amountSpentClaimCount claims
```

### Pending Reimbursement Card

The Pending Reimbursement card displays:

```ts
summary.pendingReimbursementAmount;
summary.pendingReimbursementCount;
```

The card is informational. It is not treated as positive or negative wallet health.

If either pending amount or count is non-zero:

```text
[count] claims in approval pipeline
Awaiting HOD or finance action
```

If both pending amount and count are zero:

```text
No claims currently in pipeline
```

The value is dimmed when both are zero.

## Error Behavior

If wallet totals fail to load:

```ts
data = null
errorMessage = repository error or "Unable to compute wallet summary."
```

If pending reimbursement totals fail to load:

```ts
data = null
errorMessage = repository error or "Unable to compute pending reimbursement."
```

The dashboard page handles service failure by rendering an error alert and then passing `GetWalletSummaryService.empty()` to the UI.

## Empty State

`GetWalletSummaryService.empty()` returns:

```ts
{
  totalPettyCashReceived: 0,
  totalPettyCashSpent: 0,
  totalReimbursements: 0,
  amountReceived: 0,
  amountSpent: 0,
  pettyCashBalance: 0,
  amountSpentClaimCount: 0,
  pendingReimbursementAmount: 0,
  pendingReimbursementCount: 0,
}
```

This produces:

- Balance: zero
- Hero message: `Balance is settled`
- Utilization bar: empty
- Pending reimbursement: zero, dimmed, with `No claims currently in pipeline`

## Worked Example

Input from `wallets`:

```ts
total_petty_cash_received = 1000;
total_petty_cash_spent = 1200;
total_reimbursements_received = 300;
petty_cash_balance = -200;
```

Input from pending claims query:

```ts
amount rows = [100.50, 25.00, 0]
row count = 3
```

Service output:

```ts
totalPettyCashReceived = 1000;
totalPettyCashSpent = 1200;
totalReimbursements = 300;
amountReceived = 1300;
amountSpent = 1200;
pettyCashBalance = -200;
pendingReimbursementAmount = 125.5;
pendingReimbursementCount = 3;
amountSpentClaimCount = 2;
```

UI output:

- Petty Cash Balance: negative, red
- Message: company is owed 200.00 because spending exceeds received amount
- Utilization bar: `1200 / 1300 = 92.31%`
- Amount Received: 1300.00
- Received breakdown:
  - Petty Cash: 1000.00
  - Reimbursements: 300.00
- Amount Spent: 1200.00
- Amount Spent claim count: 2 claims
- Pending Reimbursement: 125.50 across 3 claims
