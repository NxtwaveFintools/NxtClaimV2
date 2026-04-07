/** @jest-environment node */

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
}));
const mockGoogleGenerativeAI = jest.fn().mockImplementation(() => ({
  getGenerativeModel: mockGetGenerativeModel,
}));

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: mockGoogleGenerativeAI,
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    GEMINI_API_KEY: "test-gemini-key",
  },
}));

function createReceiptFormData(): FormData {
  const formData = new FormData();
  formData.append(
    "receiptFile",
    new File(["fake receipt payload"], "receipt.pdf", { type: "application/pdf" }),
  );
  return formData;
}

describe("parseReceiptAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("allows autofill when confidence is >= 90 and math is valid", async () => {
    const modelJson = {
      billNo: "INV-1001",
      transactionDate: "2026-03-18",
      vendorName: "ACME Supplies",
      basicAmount: 100,
      cgstAmount: 9,
      sgstAmount: 9,
      igstAmount: 0,
      totalAmount: 118,
      expenseCategory: "Travel",
      confidenceScore: 95,
    };

    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify(modelJson),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toBeNull();
    expect(result.data).toEqual(modelJson);
  });

  test("allows autofill when all critical fields are present even with inconsistent totals", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "INV-1002",
            transactionDate: "2026-03-18",
            vendorName: "Mismatch Store",
            basicAmount: 100,
            cgstAmount: 10,
            sgstAmount: 0,
            igstAmount: 0,
            totalAmount: 500,
            expenseCategory: "Meals",
            confidenceScore: 99,
            fraudFlags: [],
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toBeNull();
    expect(result.data?.confidenceScore).toBe(99);
  });

  test("allows autofill when confidence is above threshold (80)", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "INV-1003",
            transactionDate: "2026-03-18",
            vendorName: "Low Confidence Vendor",
            basicAmount: 200,
            cgstAmount: 18,
            sgstAmount: 18,
            igstAmount: 0,
            totalAmount: 236,
            expenseCategory: "Office",
            confidenceScore: 85,
            fraudFlags: [],
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toBeNull();
    expect(result.data?.confidenceScore).toBe(85);
  });

  test("returns fallback when Gemini returns invalid JSON", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => "{ invalid-json-payload",
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result).toEqual({
      ok: false,
      data: null,
      autoFillAllowed: false,
      message:
        "AI could not read the text formatting in this document. Please fill the details manually.",
    });
  });

  test("returns quota fallback when Gemini responds with 429", async () => {
    mockGenerateContent.mockRejectedValue({
      status: 429,
      statusText: "Too Many Requests",
      message:
        "[GoogleGenerativeAI Error]: [429 Too Many Requests] Quota exceeded. Please retry in 32.983228239s.",
      errorDetails: [
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "32s",
        },
      ],
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result).toEqual({
      ok: false,
      data: null,
      autoFillAllowed: false,
      message:
        "AI auto-parse is temporarily unavailable due to usage limits. Please retry in about 32 seconds. You can still fill the details manually.",
    });
  });

  test("uses mocked Gemini SDK without real network calls", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "INV-1005",
            transactionDate: "2026-03-18",
            vendorName: "Network Guard",
            basicAmount: 100,
            cgstAmount: 9,
            sgstAmount: 9,
            igstAmount: 0,
            totalAmount: 118,
            expenseCategory: null,
            confidenceScore: 95,
            fraudFlags: ["duplicate format"],
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    await parseReceiptAction(createReceiptFormData());

    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith("test-gemini-key");
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash-lite",
      }),
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
