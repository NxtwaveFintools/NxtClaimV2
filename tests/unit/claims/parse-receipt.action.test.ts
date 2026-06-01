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

function createBankStatementFormData(): FormData {
  const formData = new FormData();
  formData.append(
    "receiptFile",
    new File(["fake statement payload"], "statement.pdf", { type: "application/pdf" }),
  );
  formData.append("documentType", "bank_statement");
  formData.append("bankStatementMatchVendorName", "Openai Llc");
  formData.append("bankStatementMatchTransactionDate", "2026-05-27");
  formData.append("bankStatementMatchBillNo", "INV-OPENAI-1");
  formData.append("bankStatementMatchForeignCurrencyCode", "USD");
  formData.append("bankStatementMatchForeignTotalAmount", "20");
  formData.append("bankStatementMatchCategoryName", "Overseas Subscription");

  return formData;
}

describe("parseReceiptAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("normalizes snake_case tax fields into client camelCase output", async () => {
    const modelJson = {
      billNo: "INV-1001",
      transactionDate: "2026-03-18",
      vendorName: "ACME Supplies",
      gst_number: "36ABCDE1234F1Z5",
      basicAmount: 100,
      cgst_amount: 9,
      sgst_amount: 9,
      igst_amount: 0,
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
    expect(result.data).toEqual({
      billNo: "INV-1001",
      transactionDate: "2026-03-18",
      vendorName: "ACME Supplies",
      gstNumber: "36ABCDE1234F1Z5",
      basicAmount: 100,
      cgstAmount: 9,
      sgstAmount: 9,
      igstAmount: 0,
      totalAmount: 118,
      category_name: "Travel Domestic",
      confidenceScore: 95,
      foreignCurrencyCode: null,
      foreignBasicAmount: 0,
      foreignGstAmount: 0,
      foreignTotalAmount: 0,
    });
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
    expect(result.data?.cgstAmount).toBe(10);
    expect(result.data?.sgstAmount).toBe(0);
    expect(result.data?.igstAmount).toBe(0);
    expect(result.data?.gstNumber).toBeNull();
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
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("retries 503 failures and succeeds on a later attempt", async () => {
    jest.useFakeTimers();

    mockGenerateContent
      .mockRejectedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        message: "503 Service Unavailable",
      })
      .mockRejectedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        message: "503 Service Unavailable",
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify({
              billNo: "INV-503",
              transactionDate: "2026-03-18",
              vendorName: "Retry Vendor",
              basicAmount: 100,
              cgstAmount: 9,
              sgstAmount: 9,
              igstAmount: 0,
              totalAmount: 118,
              category_name: "Travel Domestic",
              confidenceScore: 95,
            }),
        },
      });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const resultPromise = parseReceiptAction(createReceiptFormData());

    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  test("returns busy fallback after exhausting 503 retries", async () => {
    jest.useFakeTimers();

    mockGenerateContent
      .mockRejectedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        message: "503 Service Unavailable",
      })
      .mockRejectedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        message: "503 Service Unavailable",
      })
      .mockRejectedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        message: "503 Service Unavailable",
      });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const resultPromise = parseReceiptAction(createReceiptFormData());

    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      ok: false,
      data: null,
      autoFillAllowed: false,
      message: "The AI service is currently busy. Please try again or fill the form manually.",
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
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
        model: "gemini-3.5-flash",
        systemInstruction: expect.stringContaining("Travel Domestic"),
      }),
    );

    const modelConfig = (mockGetGenerativeModel as jest.Mock).mock.calls[0]?.[0] as
      | { systemInstruction?: string }
      | undefined;
    const systemInstruction = modelConfig?.systemInstruction ?? "";
    expect(systemInstruction).toContain("Internet Expense");
    expect(systemInstruction).toContain('"gst_number": string | null');
    expect(systemInstruction).toContain('"cgst_amount": number');
    expect(systemInstruction).toContain('"sgst_amount": number');
    expect(systemInstruction).toContain('"igst_amount": number');
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

  test("includes generic ride-platform bill-id-first guidance in the Gemini system instruction", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "UBER-7788",
            transactionDate: null,
            vendorName: "Uber",
            basicAmount: 512,
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 0,
            totalAmount: 512,
            category_name: "Travel Domestic",
            confidenceScore: 90,
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.billNo).toBe("UBER-7788");

    const modelConfig = (mockGetGenerativeModel as jest.Mock).mock.calls[0]?.[0] as
      | { systemInstruction?: string }
      | undefined;
    const systemInstruction = modelConfig?.systemInstruction ?? "";

    expect(systemInstruction).toContain("Ola");
    expect(systemInstruction).toContain("Uber");
    expect(systemInstruction).toContain("Rapido");
    expect(systemInstruction).toContain("Porter");
    expect(systemInstruction).toContain("Bill ID");
    expect(systemInstruction).toContain("Ride ID");
    expect(systemInstruction).toContain(
      "Only fall back to Ride ID when no bill-style identifier is present",
    );
    expect(systemInstruction).toContain("UBER-7788");
  });

  test("preserves invoice GST and foreign currency extraction", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "INV-FOREIGN-1",
            transactionDate: "2026-05-27",
            vendorName: "Openai Llc",
            basicAmount: 0,
            gst_number: "36ABCDE1234F1Z5",
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 180,
            totalAmount: 1180,
            category_name: "Internet Expense",
            confidenceScore: 96,
            foreign_currency_code: "USD",
            foreign_basic_amount: 10,
            foreign_gst_amount: 2,
            foreign_total_amount: 12,
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        gstNumber: "36ABCDE1234F1Z5",
        igstAmount: 180,
        totalAmount: 1180,
        category_name: "Internet Expense",
        foreignCurrencyCode: "USD",
        foreignBasicAmount: 10,
        foreignGstAmount: 2,
        foreignTotalAmount: 12,
      }),
    );
  });

  test("normalizes bank statements as payment evidence with no tax, category, or foreign fields", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "614757120563",
            transactionDate: "2026-05-27",
            vendorName: "Openai Llc",
            basicAmount: 1999,
            gst_number: "36ABCDE1234F1Z5",
            cgst_amount: 90,
            sgst_amount: 90,
            igst_amount: 180,
            totalAmount: 0,
            category_name: "Overseas Subscription",
            confidenceScore: 95,
            foreign_currency_code: "USD",
            foreign_basic_amount: 20,
            foreign_gst_amount: 0,
            foreign_total_amount: 20,
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createBankStatementFormData());

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.data).toEqual({
      billNo: "614757120563",
      transactionDate: "2026-05-27",
      vendorName: "Openai Llc",
      basicAmount: 1999,
      gstNumber: null,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalAmount: 1999,
      category_name: null,
      confidenceScore: 95,
      foreignCurrencyCode: null,
      foreignBasicAmount: 0,
      foreignGstAmount: 0,
      foreignTotalAmount: 0,
    });
  });

  test("instructs bank statement extraction to set totalAmount to settled INR debit and clear invoice-only fields", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            billNo: "614757120563",
            transactionDate: "2026-05-27",
            vendorName: "Openai Llc",
            basicAmount: 1999,
            gst_number: null,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 0,
            totalAmount: 1999,
            category_name: null,
            confidenceScore: 95,
          }),
      },
    });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    await parseReceiptAction(createBankStatementFormData());

    const modelConfig = (mockGetGenerativeModel as jest.Mock).mock.calls[0]?.[0] as
      | { systemInstruction?: string }
      | undefined;
    const systemInstruction = modelConfig?.systemInstruction ?? "";

    expect(systemInstruction).toContain("payment evidence only");
    expect(systemInstruction).toContain("Set totalAmount to the same settled INR debit amount");
    expect(systemInstruction).toContain("GST/tax fields must always be zero/null");
    expect(systemInstruction).toContain(
      "Do not extract or preserve foreign currency invoice fields",
    );
    expect(systemInstruction).toContain("Do not decide category_name");
    expect(systemInstruction).toContain(
      "client-side merge logic preserves invoice-derived foreign expense details",
    );
  });
});
