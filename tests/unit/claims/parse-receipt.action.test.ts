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

function createReceiptFormData(
  categoryNames: string[] = ["Travel Domestic", "Internet Expense"],
): FormData {
  const formData = new FormData();
  formData.append(
    "receiptFile",
    new File(["fake receipt payload"], "receipt.pdf", { type: "application/pdf" }),
  );

  for (const categoryName of categoryNames) {
    formData.append("expenseCategoryNames", categoryName);
  }

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
      category_name: "Travel Domestic",
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
            category_name: "Travel Domestic",
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
            category_name: "Internet Expense",
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
            category_name: null,
            confidenceScore: 95,
            fraudFlags: ["duplicate format"],
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    await parseReceiptAction(createReceiptFormData(["Travel Domestic", "Internet Expense"]));

    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith("test-gemini-key");
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash-lite",
        systemInstruction: expect.stringContaining("Travel Domestic"),
      }),
    );

    const modelConfig = (mockGetGenerativeModel as jest.Mock).mock.calls[0]?.[0] as
      | { systemInstruction?: string }
      | undefined;
    const systemInstruction = modelConfig?.systemInstruction ?? "";
    expect(systemInstruction).toContain("Internet Expense");
    expect(systemInstruction).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("maps legacy expenseCategory field into category_name for compatibility", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "INV-1006",
            transactionDate: "2026-03-18",
            vendorName: "Legacy Format Vendor",
            basicAmount: 200,
            cgstAmount: 18,
            sgstAmount: 18,
            igstAmount: 0,
            totalAmount: 236,
            expenseCategory: "Travel Domestic",
            confidenceScore: 92,
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.category_name).toBe("Travel Domestic");
  });
});
