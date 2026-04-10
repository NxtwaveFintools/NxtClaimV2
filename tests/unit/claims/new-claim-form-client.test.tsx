import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewClaimFormClient } from "@/modules/claims/ui/new-claim-form-client";

jest.setTimeout(15000);

const mockSubmitClaimAction = jest.fn();
const mockParseReceiptAction = jest.fn();
const mockPush = jest.fn();
const mockToastLoading = jest.fn();
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("sonner", () => ({
  toast: {
    loading: (...args: unknown[]) => mockToastLoading(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

jest.mock("@/modules/claims/actions", () => ({
  submitClaimAction: (...args: unknown[]) => mockSubmitClaimAction(...args),
}));

jest.mock("@/modules/claims/actions/parse-receipt", () => ({
  parseReceiptAction: (...args: unknown[]) => mockParseReceiptAction(...args),
}));

const mockUpload = jest.fn();

jest.mock("@/core/infra/supabase/browser-client", () => ({
  getBrowserSupabaseClient: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
      }),
    },
  }),
}));

const currentUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "employee@nxtwave.co.in",
  name: "Alice Employee",
  isGlobalHod: false,
};

const options = {
  departments: [{ id: "22222222-2222-4222-8222-222222222222", name: "Finance" }],
  departmentRouting: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Finance",
      hod: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "hod@nxtwave.co.in",
        fullName: "Dept HOD",
      },
      founder: {
        id: "44444444-4444-4444-8444-444444444444",
        email: "founder@nxtwave.co.in",
        fullName: "Founder",
      },
    },
  ],
  paymentModes: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Reimbursement",
      detailType: "expense" as const,
    },
  ],
  expenseCategories: [
    { id: "66666666-6666-4666-8666-666666666666", name: "Travel Domestic" },
    { id: "99999999-9999-4999-8999-999999999999", name: "Internet Expense" },
  ],
  products: [{ id: "77777777-7777-4777-8777-777777777777", name: "NxtWave" }],
  locations: [{ id: "88888888-8888-4888-8888-888888888888", name: "Hyderabad" }],
};

async function fillRequiredExpenseFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/Employee ID/i), "EMP-100");
  await user.type(screen.getByLabelText(/Bill No/i), "BILL-100");
  await user.type(screen.getByLabelText(/Purpose/i), "Client visit");
  await user.clear(screen.getByLabelText(/Basic Amount/i));
  await user.type(screen.getByLabelText(/Basic Amount/i), "100");
  await user.type(screen.getByLabelText(/Transaction Date/i), "2026-03-14");
  await user.upload(
    screen.getByLabelText(/Invoice\/Bill/i),
    new File(["dummy"], "receipt.pdf", { type: "application/pdf" }),
  );
}

describe("NewClaimFormClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockToastLoading.mockReturnValue("receipt-ai-loading-toast");
    mockSubmitClaimAction.mockResolvedValue({ ok: true, claimId: "claim-1" });
    mockParseReceiptAction.mockResolvedValue({
      ok: false,
      data: null,
      autoFillAllowed: false,
      message: "Could not auto-read receipt. Please fill manually.",
    });
    mockUpload.mockResolvedValue({ data: { path: "expenses/u/receipt.pdf" }, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  test("shows Employee ID validation error when mandatory field is blank", async () => {
    const user = userEvent.setup();
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    expect(await screen.findByText("Employee ID is required")).toBeInTheDocument();
  });

  test("shows Tax Details fields by default without GST toggle", async () => {
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    expect(screen.queryByLabelText(/GST Applicable/i)).not.toBeInTheDocument();
    expect(screen.getByText("Tax Details")).toBeInTheDocument();
    expect(screen.getByLabelText(/GST Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CGST Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/SGST Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/IGST Amount/i)).toBeInTheDocument();
  });

  test("auto-calculates total amount when basic and GST components are entered", async () => {
    const user = userEvent.setup();
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    const basicAmountInput = screen.getByLabelText(/Basic Amount/i);
    const cgstInput = screen.getByLabelText(/CGST Amount/i);
    const sgstInput = screen.getByLabelText(/SGST Amount/i);
    const igstInput = screen.getByLabelText(/IGST Amount/i);

    await user.clear(basicAmountInput);
    await user.type(basicAmountInput, "100");
    await user.clear(cgstInput);
    await user.type(cgstInput, "9");
    await user.clear(sgstInput);
    await user.type(sgstInput, "9");
    await user.clear(igstInput);
    await user.type(igstInput, "0");

    await waitFor(() => {
      const totalAmountInput = screen.getByLabelText(/Total Amount/i) as HTMLInputElement;
      expect(totalAmountInput.value).toBe("118.00");
    });
  });

  test("shows success toast and redirects to claims list after successful submission", async () => {
    const user = userEvent.setup();
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await fillRequiredExpenseFields(user);
    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Claim submitted successfully!");
      expect(mockPush).toHaveBeenCalledWith("/dashboard/my-claims", { scroll: false });
    });
  });

  test("shows error toast when submission action fails", async () => {
    const user = userEvent.setup();
    mockSubmitClaimAction.mockResolvedValueOnce({ ok: false, message: "Failed to submit claim." });
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await fillRequiredExpenseFields(user);
    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Failed to submit claim.");
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  test("maps AI category_name to local category UUID with trimmed case-insensitive matching", async () => {
    const user = userEvent.setup();
    mockParseReceiptAction.mockResolvedValueOnce({
      ok: true,
      autoFillAllowed: true,
      message: null,
      data: {
        billNo: "AI-BILL-1001",
        transactionDate: "2026-03-18",
        vendorName: "AI Vendor",
        gstNumber: "36ABCDE1234F1Z5",
        basicAmount: 100,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        totalAmount: 100,
        category_name: "  internet expense ",
        confidenceScore: 95,
      },
    });

    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await user.upload(
      screen.getByLabelText(/Invoice\/Bill/i),
      new File(["dummy"], "receipt.pdf", { type: "application/pdf" }),
    );

    expect(mockToastLoading).toHaveBeenCalledWith("Fetching AI details...");

    await waitFor(() => {
      expect(mockParseReceiptAction).toHaveBeenCalledTimes(1);
    });

    const requestFormData = mockParseReceiptAction.mock.calls[0]?.[0] as FormData;
    expect(requestFormData.getAll("expenseCategoryNames")).toEqual([
      "Travel Domestic",
      "Internet Expense",
    ]);

    await waitFor(() => {
      const categorySelect = screen.getByLabelText(/Expense Category/i) as HTMLSelectElement;
      expect(categorySelect.value).toBe("99999999-9999-4999-8999-999999999999");
    });

    await waitFor(() => {
      const gstNumberInput = screen.getByLabelText(/GST Number/i) as HTMLInputElement;
      expect(gstNumberInput.value).toBe("36ABCDE1234F1Z5");
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Details fetched!", {
      id: "receipt-ai-loading-toast",
    });
  });

  test("keeps category unselected when AI returns null or unknown category_name", async () => {
    const user = userEvent.setup();
    mockParseReceiptAction.mockResolvedValueOnce({
      ok: true,
      autoFillAllowed: true,
      message: null,
      data: {
        billNo: "AI-BILL-1002",
        transactionDate: "2026-03-19",
        vendorName: "Unknown Category Vendor",
        gstNumber: null,
        basicAmount: 250,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        totalAmount: 250,
        category_name: "Non Existent Category",
        confidenceScore: 91,
      },
    });

    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    const categorySelect = screen.getByLabelText(/Expense Category/i) as HTMLSelectElement;
    expect(categorySelect.value).toBe("66666666-6666-4666-8666-666666666666");

    await user.upload(
      screen.getByLabelText(/Invoice\/Bill/i),
      new File(["dummy"], "receipt.pdf", { type: "application/pdf" }),
    );

    await waitFor(() => {
      expect(categorySelect.value).toBe("");
    });
  });

  test("shows loading toast on upload and still allows manual retry via Auto-fill button", async () => {
    const user = userEvent.setup();
    const firstToastId = "receipt-ai-loading-toast-1";
    const secondToastId = "receipt-ai-loading-toast-2";

    mockToastLoading.mockReturnValueOnce(firstToastId).mockReturnValueOnce(secondToastId);

    type FirstParseFailureResult = {
      ok: false;
      data: null;
      autoFillAllowed: false;
      message: string;
    };

    let resolveFirstParse!: (value: FirstParseFailureResult) => void;
    const firstParsePromise = new Promise<FirstParseFailureResult>((resolve) => {
      resolveFirstParse = resolve;
    });

    mockParseReceiptAction.mockReturnValueOnce(firstParsePromise).mockResolvedValueOnce({
      ok: true,
      autoFillAllowed: true,
      message: null,
      data: {
        billNo: "AI-BILL-1003",
        transactionDate: "2026-03-20",
        vendorName: "Retry Vendor",
        gstNumber: null,
        basicAmount: 300,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        totalAmount: 300,
        category_name: "Travel Domestic",
        confidenceScore: 93,
      },
    });

    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await user.upload(
      screen.getByLabelText(/Invoice\/Bill/i),
      new File(["dummy"], "receipt.pdf", { type: "application/pdf" }),
    );

    expect(mockToastLoading).toHaveBeenCalledWith("Fetching AI details...");
    expect(mockParseReceiptAction).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalled();

    resolveFirstParse({
      ok: false,
      data: null,
      autoFillAllowed: false,
      message: "Failed to fetch AI details.",
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Failed to fetch AI details.", {
        id: firstToastId,
      });
    });

    await user.click(screen.getByRole("button", { name: /auto-fill with ai/i }));

    await waitFor(() => {
      expect(mockParseReceiptAction).toHaveBeenCalledTimes(2);
    });

    expect(mockToastSuccess).toHaveBeenCalledWith("Details fetched!", { id: secondToastId });
  });
});
