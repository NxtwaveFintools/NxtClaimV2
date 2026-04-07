/** @jest-environment node */

import type { NextRequest } from "next/server";

const mockExecute = jest.fn();
const mockLoggerError = jest.fn();
const mockWriteBuffer = jest.fn();
const mockAddWorksheet = jest.fn();
const mockAddRow = jest.fn();
const mockWorkbookCtor = jest.fn();

jest.mock("@/core/http/with-auth", () => ({
  withAuth: (handler: unknown) => handler,
}));

jest.mock("@/modules/claims/repositories/SupabaseClaimRepository", () => ({
  SupabaseClaimRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/core/domain/claims/ExportClaimsService", () => ({
  ExportClaimsService: jest.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
  getExportDateRangeValidationMessage: jest.fn(() => null),
  EXPORT_HEADERS: ["Claim ID"],
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

jest.mock("exceljs", () => ({
  __esModule: true,
  default: {
    Workbook: function Workbook(this: { addWorksheet: unknown; xlsx: unknown }) {
      mockWorkbookCtor();
      this.addWorksheet = (...args: unknown[]) => mockAddWorksheet(...args);
      this.xlsx = {
        writeBuffer: (...args: unknown[]) => mockWriteBuffer(...args),
      };
    },
  },
}));

function createContext() {
  return {
    correlationId: "cid-1",
    userId: "user-1",
    email: "user@nxtwave.co.in",
    accessToken: "token-1",
  };
}

function buildRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url),
  } as NextRequest;
}

function buildExportRow() {
  return {
    claimId: "CLAIM-1",
    employeeId: "EMP-1",
    transactionId: "TXN-1",
    employeeEmail: "user@nxtwave.co.in",
    employeeName: "Alice",
    department: "Engineering",
    pettyCashBalance: "0",
    submitter: "Alice",
    paymentMode: "Reimbursement",
    submissionType: "Self",
    purpose: "Travel",
    claimRaisedDate: "2026-03-01",
    hodApprovedDate: "2026-03-02",
    financeApprovedDate: "2026-03-03",
    billDate: "2026-03-01",
    claimStatus: "Submitted",
    hodStatus: "Approved",
    financeStatus: "Pending",
    billStatus: "Open",
    billNumber: "BILL-1",
    basicAmount: "100",
    cgst: "9",
    sgst: "9",
    igst: "0",
    totalAmount: "118",
    currency: "INR",
    approvedAmount: "118",
    vendorName: "Vendor",
    transactionCategory: "Travel",
    product: "Product",
    expenseLocation: "Hyd",
    locationType: "Office",
    bankStatementUrl: null,
    billUrl: "https://example.com/bill",
    pettyCashPhotoUrl: null,
    pettyCashRequestMonth: "",
    transactionCount: "1",
    claimRemarks: "",
    transactionRemarks: "",
  };
}

describe("GET /api/export/claims", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockWriteBuffer.mockResolvedValue(new ArrayBuffer(8));
    mockAddRow.mockImplementation((values: unknown[]) => {
      const cells = new Map<number, { value: unknown; font?: unknown }>();
      return {
        values,
        font: undefined,
        getCell: (index: number) => {
          if (!cells.has(index)) {
            cells.set(index, { value: null });
          }
          return cells.get(index);
        },
      };
    });
    mockAddWorksheet.mockReturnValue({ addRow: mockAddRow });
  });

  test("returns 400 for invalid export scope", async () => {
    const { GET } = await import("@/app/api/export/claims/route");

    const response = await (
      GET as (req: NextRequest, ctx: ReturnType<typeof createContext>) => Promise<Response>
    )(buildRequest("http://localhost/api/export/claims?scope=invalid"), createContext());

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_EXPORT_SCOPE");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test("returns 500 when export service fails", async () => {
    mockExecute.mockResolvedValue({
      rows: [],
      fileName: "claims.xlsx",
      rowCount: 0,
      errorMessage: "boom",
    });

    const { GET } = await import("@/app/api/export/claims/route");

    const response = await (
      GET as (req: NextRequest, ctx: ReturnType<typeof createContext>) => Promise<Response>
    )(buildRequest("http://localhost/api/export/claims?scope=submissions"), createContext());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("EXPORT_FAILED");
    expect(mockLoggerError).toHaveBeenCalled();
  });

  test("returns xlsx response and forwards normalized filters", async () => {
    mockExecute.mockResolvedValue({
      rows: [buildExportRow()],
      fileName: "claims_export_20260401.xlsx",
      rowCount: 1,
      errorMessage: null,
    });

    const { GET } = await import("@/app/api/export/claims/route");

    const response = await (
      GET as (req: NextRequest, ctx: ReturnType<typeof createContext>) => Promise<Response>
    )(
      buildRequest(
        "http://localhost/api/export/claims?scope=submissions&status=Rejected%20-%20Resubmission%20Not%20Allowed,INVALID&payment_mode_id=pm-1&department_id=dep-1&submission_type=Self&date_target=hod_action&from=2026-03-10&to=bad-date&search_field=employee_name&search_query=%20Alice%20",
      ),
      createContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toContain("claims_export_20260401.xlsx");

    expect(mockExecute).toHaveBeenCalledWith({
      userId: "user-1",
      scope: "submissions",
      filters: {
        paymentModeId: "pm-1",
        departmentId: "dep-1",
        locationId: undefined,
        productId: undefined,
        expenseCategoryId: undefined,
        submissionType: "Self",
        status: ["Rejected - Resubmission Not Allowed"],
        dateTarget: "hod_action",
        dateFrom: "2026-03-10",
        dateTo: undefined,
        searchField: "employee_name",
        searchQuery: "Alice",
      },
    });
    expect(mockWorkbookCtor).toHaveBeenCalledTimes(1);
    expect(mockWriteBuffer).toHaveBeenCalledTimes(1);
  });

  test("splits export into multiple worksheets for very large datasets", async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({
      ...buildExportRow(),
      claimId: `CLAIM-${index + 1}`,
      employeeId: `EMP-${index + 1}`,
    }));

    mockExecute.mockResolvedValue({
      rows,
      fileName: "claims_export_large.xlsx",
      rowCount: rows.length,
      errorMessage: null,
    });

    const { GET } = await import("@/app/api/export/claims/route");

    const response = await (
      GET as (req: NextRequest, ctx: ReturnType<typeof createContext>) => Promise<Response>
    )(buildRequest("http://localhost/api/export/claims?scope=submissions"), createContext());

    expect(response.status).toBe(200);
    expect(mockAddWorksheet).toHaveBeenCalledTimes(2);
    expect(mockAddWorksheet).toHaveBeenNthCalledWith(1, "Claims");
    expect(mockAddWorksheet).toHaveBeenNthCalledWith(2, "Claims 2");
  });
});
