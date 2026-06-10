/** @jest-environment node */

const mockGenerateContent = jest.fn();
const mockGoogleGenAI = jest.fn().mockImplementation(() => ({
  models: { generateContent: mockGenerateContent },
}));

class MockApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

jest.mock("@google/genai", () => ({
  GoogleGenAI: mockGoogleGenAI,
  ApiError: MockApiError,
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODEL: "gemini-3.5-flash",
  },
}));

// A "today" far enough after fixture dates. The action uses the real clock; fixture
// dates below are chosen relative to test-run time via dynamic computation.
function isoDaysAgo(days: number): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return utc.toISOString().slice(0, 10);
}

const RECENT_DATE = isoDaysAgo(10);

function extractionPayload(overrides: Record<string, unknown> = {}) {
  return {
    docType: "gst_invoice",
    vendorName: "ACME Supplies",
    billNo: "INV-1001",
    gstNumber: "36ABCDE1234F1Z5",
    dateAsPrinted: "18/05/2026",
    transactionDate: RECENT_DATE,
    currencyCode: "INR",
    subtotalAmount: 1000,
    feesTotal: null,
    discountTotal: null,
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: null,
    otherTaxTotal: null,
    totalAmount: 1180,
    categoryName: "Travel Domestic",
    ...overrides,
  };
}

function mockModelResponse(payload: unknown) {
  mockGenerateContent.mockResolvedValue({ text: JSON.stringify(payload) });
}

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

  afterEach(() => {
    jest.useRealTimers();
  });

  test("full INR invoice extraction computes amounts in code and auto-fills", async () => {
    mockModelResponse(extractionPayload());

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toBeNull();
    expect(result.data).toEqual({
      billNo: "INV-1001",
      transactionDate: RECENT_DATE,
      vendorName: "ACME Supplies",
      gstNumber: "36ABCDE1234F1Z5",
      basicAmount: 1000, // 1180 - 180, computed in code
      cgstAmount: 90,
      sgstAmount: 90,
      igstAmount: 0,
      totalAmount: 1180,
      category_name: "Travel Domestic",
      confidenceScore: 100,
      foreignCurrencyCode: null,
      foreignBasicAmount: 0,
      foreignGstAmount: 0,
      foreignTotalAmount: 0,
    });
  });

  test("requests the configured model with an enforced response schema", async () => {
    mockModelResponse(extractionPayload());

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    await parseReceiptAction(createReceiptFormData());

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const request = mockGenerateContent.mock.calls[0][0];
    expect(request.model).toBe("gemini-3.5-flash");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toMatchObject({ type: "object" });
    expect(request.config.temperature).toBe(0);
    expect(request.config.systemInstruction).toContain("ALLOWED CATEGORIES");
    expect(request.config.systemInstruction).toContain("Travel Domestic");
  });

  test("ambiguous non-ISO date from model becomes null (never a guessed date)", async () => {
    mockModelResponse(extractionPayload({ transactionDate: "18/05/2026" }));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.transactionDate).toBeNull();
    // missing critical field -> partial fill message, but data still offered
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toContain("verify");
  });

  test("future date is rejected to null", async () => {
    mockModelResponse(extractionPayload({ transactionDate: isoDaysAgo(-30) }));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.data?.transactionDate).toBeNull();
  });

  test("inconsistent printed amounts lower confidence below threshold -> partial fill", async () => {
    mockModelResponse(
      extractionPayload({
        subtotalAmount: 100,
        cgstAmount: 10,
        sgstAmount: null,
        totalAmount: 500,
      }),
    );

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.basicAmount).toBe(490);
    expect(result.data?.totalAmount).toBe(500);
    expect(result.data?.confidenceScore).toBe(70);
    expect(result.autoFillAllowed).toBe(true);
    expect(result.message).toContain("verify");
  });

  test("foreign currency invoice (any ISO code) maps to foreign fields and zeroes local", async () => {
    mockModelResponse(
      extractionPayload({
        currencyCode: "AED",
        subtotalAmount: 90,
        cgstAmount: null,
        sgstAmount: null,
        igstAmount: null,
        otherTaxTotal: 10,
        totalAmount: 100,
        gstNumber: null,
      }),
    );

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(true);
    expect(result.data?.foreignCurrencyCode).toBe("AED");
    expect(result.data?.foreignTotalAmount).toBe(100);
    expect(result.data?.foreignGstAmount).toBe(10);
    expect(result.data?.foreignBasicAmount).toBe(90);
    expect(result.data?.basicAmount).toBe(0);
    expect(result.data?.totalAmount).toBe(0);
    expect(result.data?.cgstAmount).toBe(0);
  });

  test("unknown currency string is dropped and deducts confidence", async () => {
    mockModelResponse(extractionPayload({ currencyCode: "ZZZ" }));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.data?.foreignCurrencyCode).toBeNull();
    expect(result.data?.confidenceScore).toBe(80);
  });

  test("bank statement mode maps matched debit to basicAmount", async () => {
    mockModelResponse(
      extractionPayload({
        docType: "bank_statement",
        vendorName: "ADOBE SYSTEMS",
        billNo: null,
        gstNumber: null,
        subtotalAmount: null,
        cgstAmount: null,
        sgstAmount: null,
        igstAmount: null,
        totalAmount: 4250.75,
        categoryName: null,
      }),
    );

    const formData = createReceiptFormData([]);
    formData.append("documentType", "bank_statement");
    formData.append("bankStatementMatchVendorName", "Adobe");

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(formData);

    expect(result.ok).toBe(true);
    expect(result.data?.basicAmount).toBe(4250.75);
    expect(result.data?.totalAmount).toBe(0);
    expect(result.data?.cgstAmount).toBe(0);
    expect(result.data?.vendorName).toBe("ADOBE SYSTEMS");
    expect(result.autoFillAllowed).toBe(true);
  });

  test("invalid JSON from model returns friendly fallback", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not json at all" });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(false);
    expect(result.autoFillAllowed).toBe(false);
    expect(result.message).toContain("fill the details manually");
  });

  test("quota error (429) returns quota fallback with retry hint", async () => {
    mockGenerateContent.mockRejectedValue(new MockApiError("Too Many Requests. Retry in 14s", 429));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const result = await parseReceiptAction(createReceiptFormData());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("usage limits");
    expect(result.message).toContain("14 seconds");
  });

  test("503 retries up to 3 attempts then succeeds", async () => {
    jest.useFakeTimers();
    mockGenerateContent
      .mockRejectedValueOnce(new MockApiError("Service Unavailable", 503))
      .mockRejectedValueOnce(new MockApiError("Service Unavailable", 503))
      .mockResolvedValueOnce({ text: JSON.stringify(extractionPayload()) });

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const pending = parseReceiptAction(createReceiptFormData());
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(true);
  });

  test("503 exhaustion returns busy message", async () => {
    jest.useFakeTimers();
    mockGenerateContent.mockRejectedValue(new MockApiError("Service Unavailable", 503));

    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");
    const pending = parseReceiptAction(createReceiptFormData());
    await jest.runAllTimersAsync();
    const result = await pending;

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("busy");
  });

  test("rejects missing file and oversized/wrong-type files", async () => {
    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");

    const empty = new FormData();
    expect((await parseReceiptAction(empty)).message).toBe("Receipt file is required.");

    const wrongType = new FormData();
    wrongType.append("receiptFile", new File(["x"], "x.gif", { type: "image/gif" }));
    expect((await parseReceiptAction(wrongType)).message).toBe(
      "Receipt file must be PDF, JPG, PNG, or WEBP.",
    );
  });
});
