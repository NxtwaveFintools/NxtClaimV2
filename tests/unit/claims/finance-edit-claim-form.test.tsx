import { fireEvent, render, screen } from "@testing-library/react";
import { FinanceEditClaimForm } from "@/modules/claims/ui/finance-edit-claim-form";

const departments = [{ id: "dep-1", name: "Operations" }];
const paymentModes = [{ id: "mode-1", name: "Corporate Card" }];
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
      transactionDate: "2026-04-12",
      isGstApplicable: true,
      gstNumber: "GSTIN-1",
      basicAmount: input?.basicAmount ?? 100,
      cgstAmount: input?.cgstAmount ?? 9,
      sgstAmount: input?.sgstAmount ?? 9,
      igstAmount: input?.igstAmount ?? 0,
      totalAmount: input?.totalAmount ?? 118,
      vendorName: "Vendor",
      purpose: "Client visit",
      productId: "prod-1",
      peopleInvolved: null,
      remarks: null,
    },
    advance: null,
  };
}

function renderForm(input?: {
  claim?: ReturnType<typeof createExpenseClaim>;
  fieldScope?: "full" | "quick-view-core";
}) {
  return render(
    <FinanceEditClaimForm
      claim={input?.claim ?? createExpenseClaim()}
      departments={departments}
      paymentModes={paymentModes}
      expenseCategories={expenseCategories}
      products={products}
      locations={locations}
      isEditMode
      fieldScope={input?.fieldScope}
      presentation="embedded"
      action={async () => ({ ok: true })}
    />,
  );
}

describe("FinanceEditClaimForm amount balancing", () => {
  test("recomputes total amount when basic or GST fields change", () => {
    renderForm();

    const basicAmountInput = screen.getByRole("spinbutton", { name: /basic amount/i });
    const cgstAmountInput = screen.getByRole("spinbutton", { name: /cgst amount/i });
    const igstAmountInput = screen.getByRole("spinbutton", { name: /igst amount/i });
    const totalAmountInput = screen.getByRole("spinbutton", { name: /total amount/i });

    fireEvent.change(basicAmountInput, { target: { value: "120" } });
    expect(totalAmountInput).toHaveValue(138);

    fireEvent.change(cgstAmountInput, { target: { value: "10" } });
    expect(totalAmountInput).toHaveValue(139);

    fireEvent.change(igstAmountInput, { target: { value: "5" } });
    expect(totalAmountInput).toHaveValue(144);
  });

  test("recomputes basic amount when total amount changes and keeps GST values untouched", () => {
    renderForm();

    const basicAmountInput = screen.getByRole("spinbutton", { name: /basic amount/i });
    const cgstAmountInput = screen.getByRole("spinbutton", { name: /cgst amount/i });
    const sgstAmountInput = screen.getByRole("spinbutton", { name: /sgst amount/i });
    const totalAmountInput = screen.getByRole("spinbutton", { name: /total amount/i });

    fireEvent.change(totalAmountInput, { target: { value: "90" } });

    expect(totalAmountInput).toHaveValue(90);
    expect(basicAmountInput).toHaveValue(72);
    expect(cgstAmountInput).toHaveValue(9);
    expect(sgstAmountInput).toHaveValue(9);
  });

  test("resets taxes when typed total drops below existing tax sum", () => {
    renderForm({
      claim: createExpenseClaim({
        basicAmount: 10,
        cgstAmount: 45,
        sgstAmount: 45,
        igstAmount: 0,
        totalAmount: 100,
      }),
    });

    const basicAmountInput = screen.getByRole("spinbutton", { name: /basic amount/i });
    const cgstAmountInput = screen.getByRole("spinbutton", { name: /cgst amount/i });
    const sgstAmountInput = screen.getByRole("spinbutton", { name: /sgst amount/i });
    const totalAmountInput = screen.getByRole("spinbutton", { name: /total amount/i });

    fireEvent.change(totalAmountInput, { target: { value: "50" } });

    expect(totalAmountInput).toHaveValue(50);
    expect(basicAmountInput).toHaveValue(50);
    expect(cgstAmountInput).toHaveValue(0);
    expect(sgstAmountInput).toHaveValue(0);
  });

  test("quick view reverse-calculates hidden basic when total amount changes", () => {
    const { container } = renderForm({ fieldScope: "quick-view-core" });

    const totalAmountInput = screen.getByRole("spinbutton", { name: /total amount/i });
    fireEvent.change(totalAmountInput, { target: { value: "200" } });

    const basicHiddenInput = container.querySelector(
      'input[type="hidden"][name="basicAmount"]',
    ) as HTMLInputElement;
    const totalHiddenInput = container.querySelector(
      'input[type="number"][name="totalAmount"]',
    ) as HTMLInputElement;
    const cgstHiddenInput = container.querySelector(
      'input[type="hidden"][name="cgstAmount"]',
    ) as HTMLInputElement;
    const sgstHiddenInput = container.querySelector(
      'input[type="hidden"][name="sgstAmount"]',
    ) as HTMLInputElement;

    expect(totalHiddenInput.value).toBe("200");
    expect(basicHiddenInput.value).toBe("182");
    expect(cgstHiddenInput.value).toBe("9");
    expect(sgstHiddenInput.value).toBe("9");
  });

  test("allows decimal typing in quick view total amount without clamping", () => {
    const { container } = renderForm({ fieldScope: "quick-view-core" });

    const totalAmountInput = screen.getByRole("spinbutton", { name: /total amount/i });
    fireEvent.change(totalAmountInput, { target: { value: "20.1" } });

    const basicHiddenInput = container.querySelector(
      'input[type="hidden"][name="basicAmount"]',
    ) as HTMLInputElement;

    expect(totalAmountInput).toHaveValue(20.1);
    expect(basicHiddenInput.value).toBe("2.1");
  });
});
