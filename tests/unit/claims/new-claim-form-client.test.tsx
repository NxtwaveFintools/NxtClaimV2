import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewClaimFormClient } from "@/modules/claims/ui/new-claim-form-client";

const mockSubmitClaimAction = jest.fn();
const mockPush = jest.fn();
const mockToastError = jest.fn();
const mockToastPromise = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    promise: (...args: unknown[]) => mockToastPromise(...args),
  },
}));

jest.mock("@/modules/claims/actions", () => ({
  submitClaimAction: (...args: unknown[]) => mockSubmitClaimAction(...args),
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
  expenseCategories: [{ id: "66666666-6666-4666-8666-666666666666", name: "Travel" }],
  products: [{ id: "77777777-7777-4777-8777-777777777777", name: "NxtWave" }],
  locations: [{ id: "88888888-8888-4888-8888-888888888888", name: "Hyderabad" }],
};

async function fillRequiredExpenseFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/Employee ID/i), "EMP-100");
  await user.type(screen.getByLabelText(/Bill No/i), "BILL-100");
  await user.type(screen.getByLabelText(/Transaction ID/i), "TXN-100");
  await user.type(screen.getByLabelText(/^Purpose \*/i), "Client visit");
  await user.clear(screen.getByLabelText(/Basic Amount/i));
  await user.type(screen.getByLabelText(/Basic Amount/i), "100");
  await user.type(screen.getByLabelText(/Transaction Date/i), "2026-03-14");
  await user.upload(
    screen.getByLabelText(/Invoice\/Bill \(Required\)/i),
    new File(["dummy"], "receipt.pdf", { type: "application/pdf" }),
  );
}

describe("NewClaimFormClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockToastPromise.mockImplementation(async (promise: Promise<unknown>) => promise);
    mockSubmitClaimAction.mockResolvedValue({ ok: true, claimId: "claim-1" });
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

  test("reveals GST fields when GST Applicable is toggled", async () => {
    const user = userEvent.setup();
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    expect(screen.queryByLabelText(/GST Number/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/GST Applicable/i));

    expect(await screen.findByLabelText(/GST Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CGST Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/SGST Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/IGST Amount/i)).toBeInTheDocument();
  });

  test("auto-calculates total amount when basic and GST components are entered", async () => {
    const user = userEvent.setup();
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await user.click(screen.getByLabelText(/GST Applicable/i));

    const basicAmountInput = screen.getByLabelText(/Basic Amount/i);
    const cgstInput = await screen.findByLabelText(/CGST Amount/i);
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
      expect(mockToastPromise).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/dashboard/my-claims");
    });
  });

  test("shows error toast when submission action fails", async () => {
    const user = userEvent.setup();
    mockSubmitClaimAction.mockResolvedValueOnce({ ok: false, message: "Failed to submit claim." });
    render(<NewClaimFormClient currentUser={currentUser} options={options} />);

    await fillRequiredExpenseFields(user);
    await user.click(screen.getByRole("button", { name: /submit claim/i }));

    await waitFor(() => {
      expect(mockToastPromise).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
