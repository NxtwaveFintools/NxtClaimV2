import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FinanceEditClaimForm } from "@/modules/claims/ui/finance-edit-claim-form";

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const departments = [{ id: "dep-1", name: "Operations" }];
const paymentModes = [
  { id: "mode-1", name: "Corporate Card" },
  { id: "mode-2", name: "Reimbursement" },
  { id: "mode-3", name: "Petty Cash Request" },
];
const expenseCategories = [{ id: "cat-1", name: "Travel" }];
const products = [{ id: "prod-1", name: "NxtWave" }];
const locations = [{ id: "loc-1", name: "Hyderabad" }];

function createExpenseClaim(input?: {
  basicAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  totalAmount?: number;
}) {
  const resolvedTotalAmount = input?.totalAmount ?? 118;

  return {
    id: "CLAIM-1",
    employeeName: "Jane Doe",
    employeeEmail: "jane@example.com",
    submissionType: "Self" as const,
    onBehalfEmail: null,
    onBehalfEmployeeCode: null,
    detailType: "expense" as const,
    departmentId: "dep-1",
    paymentModeId: "mode-1",
    expense: {
      id: "expense-1",
      billNo: "BILL-1",
      expenseCategoryId: "cat-1",
      locationId: "loc-1",
      locationType: "Out Station",
      locationDetails: "Chennai branch",
      transactionDate: "2026-04-12",
      isGstApplicable: true,
      gstNumber: "GSTIN-1",
      basicAmount: input?.basicAmount ?? 100,
      cgstAmount: input?.cgstAmount ?? 9,
      sgstAmount: input?.sgstAmount ?? 9,
      igstAmount: input?.igstAmount ?? 0,
      totalAmount: resolvedTotalAmount,
      vendorName: "Vendor",
      purpose: "Client visit",
      productId: "prod-1",
      peopleInvolved: null,
      remarks: null,
    },
    advance: null,
  };
}

function createAdvanceClaim() {
  return {
    id: "CLAIM-2",
    employeeName: "Jane Doe",
    employeeEmail: "jane@example.com",
    submissionType: "Self" as const,
    onBehalfEmail: null,
    onBehalfEmployeeCode: null,
    detailType: "advance" as const,
    departmentId: "dep-1",
    paymentModeId: "mode-3",
    expense: null,
    advance: {
      id: "advance-1",
      purpose: "Conference advance",
      totalAmount: 450,
      expectedUsageDate: "2026-04-16",
      productId: "prod-1",
      locationId: "loc-1",
      remarks: "Need upfront cash",
    },
  };
}

function renderForm(input?: { claim?: ReturnType<typeof createExpenseClaim> }) {
  return render(
    <FinanceEditClaimForm
      editFlow="own"
      claim={input?.claim ?? createExpenseClaim()}
      departments={departments}
      paymentModes={paymentModes}
      expenseCategories={expenseCategories}
      products={products}
      locations={locations}
      isEditMode
      presentation="embedded"
      action={async () => ({ ok: true })}
    />,
  );
}

function renderEmbeddedSheetForm(
  action: () => Promise<{ ok: boolean; error?: string }>,
  input?: { claim?: ReturnType<typeof createExpenseClaim> | ReturnType<typeof createAdvanceClaim> },
) {
  return render(
    <Sheet defaultOpen>
      <SheetContent side="right" hideDefaultCloseButton>
        <FinanceEditClaimForm
          editFlow="finance"
          claim={input?.claim ?? createExpenseClaim()}
          departments={departments}
          paymentModes={paymentModes}
          expenseCategories={expenseCategories}
          products={products}
          locations={locations}
          isEditMode
          presentation="embedded"
          action={action}
        />
      </SheetContent>
    </Sheet>,
  );
}

describe("FinanceEditClaimForm amount balancing", () => {
  test("shows finance-editable metadata with editable amount components and locked total", () => {
    renderEmbeddedSheetForm(async () => ({ ok: true }));

    expect(screen.getByRole("textbox", { name: /bill no/i })).toHaveValue("BILL-1");
    expect(screen.getByRole("combobox", { name: /expense category/i })).toHaveValue("cat-1");
    expect(screen.getByRole("combobox", { name: /location type/i })).toHaveValue("Out Station");
    expect(screen.getByRole("textbox", { name: /location details/i })).toHaveValue(
      "Chennai branch",
    );
    expect(screen.getByRole("textbox", { name: /purpose/i })).toHaveValue("Client visit");
    // total_amount is computed by a DB BEFORE trigger from basic + cgst + sgst + igst,
    // so the UI keeps it disabled and lets finance edit the component amounts directly.
    expect(screen.getByRole("spinbutton", { name: /^total amount/i })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: /^basic amount/i })).toBeEnabled();
    expect(screen.getByRole("spinbutton", { name: /^cgst amount/i })).toBeEnabled();
    expect(screen.queryByRole("spinbutton", { name: /approved amount/i })).not.toBeInTheDocument();
  });

  test("filters payment mode options to the claim detail type", () => {
    renderEmbeddedSheetForm(async () => ({ ok: true }));

    const paymentModeSelect = screen.getByRole("combobox", { name: /payment mode/i });
    expect(paymentModeSelect).toHaveValue("mode-1");
    expect(screen.getByRole("option", { name: /corporate card/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /reimbursement/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /petty cash request/i })).not.toBeInTheDocument();
  });

  test("shows finance attachment inputs for expense claims", () => {
    renderEmbeddedSheetForm(async () => ({ ok: true }));

    expect(screen.getByLabelText(/replace receipt file/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/replace bank statement file/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/replace supporting document/i)).not.toBeInTheDocument();
  });

  test("shows advance payment mode options and supporting document input", () => {
    renderEmbeddedSheetForm(async () => ({ ok: true }), { claim: createAdvanceClaim() });

    const paymentModeSelect = screen.getByRole("combobox", { name: /payment mode/i });
    expect(paymentModeSelect).toHaveValue("mode-3");
    expect(screen.getByRole("option", { name: /petty cash request/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /corporate card/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/replace supporting document/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/replace bank statement file/i)).not.toBeInTheDocument();
  });

  test("recomputes total amount when basic or GST fields change", () => {
    renderForm();

    const basicAmountInput = screen.getByRole("spinbutton", { name: /^basic amount/i });
    const cgstAmountInput = screen.getByRole("spinbutton", { name: /^cgst amount/i });
    const igstAmountInput = screen.getByRole("spinbutton", { name: /^igst amount/i });
    const totalAmountInput = screen.getByRole("spinbutton", { name: /^total amount/i });

    fireEvent.change(basicAmountInput, { target: { value: "120" } });
    expect(totalAmountInput).toHaveValue(138);

    fireEvent.change(cgstAmountInput, { target: { value: "10" } });
    expect(totalAmountInput).toHaveValue(139);

    fireEvent.change(igstAmountInput, { target: { value: "5" } });
    expect(totalAmountInput).toHaveValue(144);
  });

  // The previous suite contained three tests that drove edits through the total
  // amount input (basic recomputed from total, taxes reset when total dropped
  // below the tax sum, decimal typing into total). They were removed when commit
  // 68173fb made the total amount a DB-computed value: the input is now disabled
  // and the recompute direction reversed (basic + GST → total). The "recomputes
  // total amount when basic or GST fields change" test above covers the new
  // direction and replaces those three.

  test("closes the embedded sheet after a successful save", async () => {
    const action = jest.fn(async () => ({ ok: true }));
    renderEmbeddedSheetForm(action);

    fireEvent.change(screen.getByLabelText(/reason for edit/i), {
      target: { value: "Correcting receipt metadata for audit." },
    });

    fireEvent.click(screen.getByRole("button", { name: /save claim edits/i }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: /save claim edits/i })).not.toBeInTheDocument();
    });
  });
});
