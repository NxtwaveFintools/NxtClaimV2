import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

type QueryResult = {
  data: unknown;
  count?: number | null;
  error: { message: string } | null;
};

type QueryBuilder = {
  select: jest.Mock;
  or: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  ilike: jest.Mock;
  limit: jest.Mock;
  order: jest.Mock;
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

const mockFrom = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

function createQueryBuilder(result: QueryResult): QueryBuilder {
  const builder: QueryBuilder = {
    select: jest.fn(() => builder),
    or: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    ilike: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    order: jest.fn(() => builder),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return builder;
}

describe("SupabaseClaimRepository.getMyClaims", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("normalizes relational join shapes (array/object/null) into flat records", async () => {
    const queryBuilder = createQueryBuilder({
      data: [
        {
          id: "claim-1",
          employee_id: "EMP-100",
          on_behalf_email: null,
          submission_type: "Self",
          status: "Submitted - Awaiting HOD approval",
          submitted_at: "2026-03-14T10:00:00.000Z",
          master_departments: [{ name: "Finance" }],
          master_payment_modes: { name: "Reimbursement" },
          expense_details: { total_amount: "118.25" },
          advance_details: null,
        },
        {
          id: "claim-2",
          employee_id: "EMP-200",
          on_behalf_email: "delegate@nxtwave.co.in",
          submission_type: "On Behalf",
          status: "HOD approved - Awaiting finance approval",
          submitted_at: "2026-03-13T10:00:00.000Z",
          master_departments: null,
          master_payment_modes: [{ name: "Petty Cash Request" }],
          expense_details: null,
          advance_details: [{ requested_amount: 500 }],
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.getMyClaims("user-1");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      {
        id: "claim-1",
        employeeId: "EMP-100",
        onBehalfEmail: null,
        departmentName: "Finance",
        paymentModeName: "Reimbursement",
        submissionType: "Self",
        status: "Submitted - Awaiting HOD approval",
        submittedAt: "2026-03-14T10:00:00.000Z",
        expenseTotalAmount: 118.25,
        advanceRequestedAmount: null,
      },
      {
        id: "claim-2",
        employeeId: "EMP-200",
        onBehalfEmail: "delegate@nxtwave.co.in",
        departmentName: null,
        paymentModeName: "Petty Cash Request",
        submissionType: "On Behalf",
        status: "HOD approved - Awaiting finance approval",
        submittedAt: "2026-03-13T10:00:00.000Z",
        expenseTotalAmount: null,
        advanceRequestedAmount: 500,
      },
    ]);
  });

  test("maps canonical status filters to raw DB statuses", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    await repository.getMyClaims("user-1", {
      status: "Approved",
    });

    expect(queryBuilder.in).toHaveBeenCalledWith("status", [
      "Finance Approved - Payment under process",
      "Payment Done - Closed",
    ]);
  });
});

describe("SupabaseClaimRepository selectable approvals counts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns actionable L1 total count for cross-page selection", async () => {
    const countBuilder = createQueryBuilder({
      data: null,
      count: 9,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => countBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.getL1PendingApprovalsCount("hod-user");

    expect(result).toEqual({ count: 9, errorMessage: null });
    expect(countBuilder.eq).toHaveBeenCalledWith("assigned_l1_approver_id", "hod-user");
    expect(countBuilder.in).toHaveBeenCalledWith("status", ["Submitted - Awaiting HOD approval"]);
  });

  test("returns actionable finance total count for cross-page selection", async () => {
    const financeApproverBuilder = createQueryBuilder({
      data: [{ id: "fin-approver-1" }],
      error: null,
    });
    const financeCountBuilder = createQueryBuilder({
      data: null,
      count: 14,
      error: null,
    });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn(() => financeApproverBuilder),
      })
      .mockReturnValueOnce({
        select: jest.fn(() => financeCountBuilder),
      });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.getFinancePendingApprovalsCount("finance-user");

    expect(result).toEqual({ count: 14, errorMessage: null });
    expect(financeCountBuilder.in).toHaveBeenCalledWith("status", [
      "HOD approved - Awaiting finance approval",
      "Finance Approved - Payment under process",
    ]);
  });
});

type MutationResult = {
  data: unknown;
  error: { message: string } | null;
};

type MutationBuilder = {
  update: jest.Mock;
  eq: jest.Mock;
  select: jest.Mock;
  maybeSingle: jest.Mock;
};

function createMutationBuilder(result: MutationResult): MutationBuilder {
  const builder: MutationBuilder = {
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    select: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
  };

  return builder;
}

describe("SupabaseClaimRepository.updateClaimDetailsByFinance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("updates claims and expense_details with GST and bank statement fields", async () => {
    const claimsBuilder = createMutationBuilder({
      data: { id: "claim-1" },
      error: null,
    });
    const expenseBuilder = createMutationBuilder({
      data: { id: "expense-1" },
      error: null,
    });

    mockFrom.mockReturnValueOnce(claimsBuilder).mockReturnValueOnce(expenseBuilder);

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.updateClaimDetailsByFinance("claim-1", {
      detailType: "expense",
      detailId: "expense-detail-1",
      billNo: "BILL-1",
      expenseCategoryId: "cat-1",
      locationId: "loc-1",
      transactionDate: "2026-03-22",
      isGstApplicable: true,
      gstNumber: "GSTIN-123",
      vendorName: "Vendor A",
      basicAmount: 100,
      cgstAmount: 9,
      sgstAmount: 9,
      igstAmount: 0,
      totalAmount: 118,
      purpose: "Travel",
      productId: "prod-1",
      peopleInvolved: "Alice",
      remarks: "updated",
      receiptFilePath: "expenses/new_receipt.pdf",
      bankStatementFilePath: "expenses/new_bank_statement.pdf",
    });

    expect(result).toEqual({ errorMessage: null });
    expect(mockFrom).toHaveBeenNthCalledWith(1, "claims");
    expect(mockFrom).toHaveBeenNthCalledWith(2, "expense_details");

    const claimUpdatePayload = claimsBuilder.update.mock.calls[0]?.[0];
    expect(claimUpdatePayload).toEqual(
      expect.objectContaining({
        updated_at: expect.any(String),
      }),
    );
    expect(claimUpdatePayload).not.toHaveProperty("department_id");
    expect(claimUpdatePayload).not.toHaveProperty("payment_mode_id");

    expect(expenseBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_gst_applicable: true,
        gst_number: "GSTIN-123",
        cgst_amount: 9,
        sgst_amount: 9,
        igst_amount: 0,
        bank_statement_file_path: "expenses/new_bank_statement.pdf",
        receipt_file_path: "expenses/new_receipt.pdf",
      }),
    );
    expect(expenseBuilder.eq).toHaveBeenCalledWith("id", "expense-detail-1");
    expect(expenseBuilder.eq).toHaveBeenCalledWith("claim_id", "claim-1");
    expect(expenseBuilder.eq).toHaveBeenCalledWith("is_active", true);
  });

  test("returns claim update error without running expense update", async () => {
    const claimsBuilder = createMutationBuilder({
      data: null,
      error: { message: "claim update failed" },
    });

    mockFrom.mockReturnValueOnce(claimsBuilder);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseClaimRepository();
    const result = await repository.updateClaimDetailsByFinance("claim-1", {
      detailType: "expense",
      detailId: "expense-detail-1",
      billNo: "BILL-1",
      expenseCategoryId: "cat-1",
      locationId: "loc-1",
      transactionDate: "2026-03-22",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      basicAmount: 100,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalAmount: 100,
      purpose: "Travel",
      productId: null,
      peopleInvolved: null,
      remarks: null,
      receiptFilePath: null,
      bankStatementFilePath: null,
    });

    expect(result).toEqual({ errorMessage: "claim update failed" });
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  test("returns expense detail missing error when claim exists but expense row is absent", async () => {
    const claimsBuilder = createMutationBuilder({
      data: { id: "claim-1" },
      error: null,
    });
    const expenseBuilder = createMutationBuilder({
      data: null,
      error: null,
    });

    mockFrom.mockReturnValueOnce(claimsBuilder).mockReturnValueOnce(expenseBuilder);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseClaimRepository();
    const result = await repository.updateClaimDetailsByFinance("claim-1", {
      detailType: "expense",
      detailId: "expense-detail-1",
      billNo: "BILL-1",
      expenseCategoryId: "cat-1",
      locationId: "loc-1",
      transactionDate: "2026-03-22",
      isGstApplicable: false,
      gstNumber: null,
      vendorName: null,
      basicAmount: 100,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      totalAmount: 100,
      purpose: "Travel",
      productId: null,
      peopleInvolved: null,
      remarks: null,
      receiptFilePath: null,
      bankStatementFilePath: null,
    });

    expect(result).toEqual({ errorMessage: "Active expense detail not found for claim." });
  });
});

describe("SupabaseClaimRepository.getClaimAuditLogs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses claim assigned_l1 approver details for SUBMITTED assignee label", async () => {
    const queryBuilder = createQueryBuilder({
      data: [
        {
          id: "audit-1",
          claim_id: "claim-1",
          actor_id: "submitter-1",
          action_type: "SUBMITTED",
          assigned_to_id: "hod-1",
          remarks: null,
          created_at: "2026-04-07T10:00:00.000Z",
          actor: { full_name: "Employee One", email: "user@nxtwave.co.in" },
          assigned_to: { full_name: "Department Head", email: "hod@nxtwave.co.in" },
          claim: {
            assigned_l1_approver_id: "founder-1",
            l1_approver_user: { full_name: "Founder", email: "founder@nxtwave.co.in" },
          },
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.getClaimAuditLogs("claim-1");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      expect.objectContaining({
        actionType: "SUBMITTED",
        assignedToId: "founder-1",
        assignedToName: "Founder",
        assignedToEmail: "founder@nxtwave.co.in",
      }),
    ]);
  });
});
