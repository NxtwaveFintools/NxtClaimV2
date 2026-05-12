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
  not: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  ilike: jest.Mock;
  limit: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
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
    not: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    ilike: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    order: jest.fn(() => builder),
    range: jest.fn(async () => result),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return builder;
}

describe("SupabaseClaimRepository.getMyClaims", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("maps enterprise dashboard rows into flat records", async () => {
    const queryBuilder = createQueryBuilder({
      data: [
        {
          claim_id: "claim-1",
          employee_id: "EMP-100",
          on_behalf_email: null,
          submission_type: "Self",
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-14T10:00:00.000Z",
          detail_type: "expense",
          amount: "118.25",
          department_name: "Finance",
          type_of_claim: "Reimbursement",
        },
        {
          claim_id: "claim-2",
          employee_id: "EMP-200",
          on_behalf_email: "delegate@nxtwave.co.in",
          submission_type: "On Behalf",
          status: "HOD approved - Awaiting finance approval",
          submitted_on: "2026-03-13T10:00:00.000Z",
          detail_type: "advance",
          amount: 500,
          department_name: null,
          type_of_claim: "Petty Cash Request",
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
        advanceRequestedTotalAmount: null,
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
        advanceRequestedTotalAmount: 500,
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

  test("uses partial case-insensitive claim_id search in paginated my claims", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      count: 0,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();

    await repository.getMyClaimsPaginated("user-1", null, 20, {
      searchField: "claim_id",
      searchQuery: "CLAIM",
    });

    expect(queryBuilder.ilike).toHaveBeenCalledWith("claim_id", "%CLAIM%");
  });

  test("uses raw employee identity OR filter in paginated my claims employee_id search", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      count: 0,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();

    await repository.getMyClaimsPaginated("user-1", null, 20, {
      searchField: "employee_id",
      searchQuery: "EMP-050",
    });

    expect(queryBuilder.or).toHaveBeenCalledWith(
      'and(submission_type.eq."Self",claim_employee_id_raw.ilike."%EMP-050%"),and(submission_type.eq."On Behalf",on_behalf_employee_code_raw.ilike."%EMP-050%")',
    );
    expect(queryBuilder.ilike).not.toHaveBeenCalledWith("employee_id", "%EMP-050%");
  });

  test("uses partial case-insensitive claim_id search in L1 approvals", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      count: 0,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();

    await repository.getPendingApprovalsForL1("hod-user", null, 20, {
      searchField: "claim_id",
      searchQuery: "claim",
    });

    expect(queryBuilder.ilike).toHaveBeenCalledWith("claim_id", "%claim%");
  });

  test("applies finance approvals status filter on base status column", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      count: 0,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();

    await repository.getPendingApprovalsForFinance("finance-user", null, 20, {
      status: ["Finance Approved - Payment under process"],
    });

    expect(queryBuilder.in).toHaveBeenCalledWith("status", [
      "Finance Approved - Payment under process",
    ]);
    expect(queryBuilder.in).not.toHaveBeenCalledWith("claims.status", [
      "Finance Approved - Payment under process",
    ]);
  });

  test("returns finance HOD-pending observability rows with fixed submitted status", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      count: 0,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();

    await repository.getPendingApprovalsForFinanceHodPendingObservability(
      "finance-user",
      null,
      20,
      {
        status: ["Submitted - Awaiting HOD approval"],
      },
    );

    expect(queryBuilder.eq).toHaveBeenCalledWith("status", "Submitted - Awaiting HOD approval");
    expect(queryBuilder.not).not.toHaveBeenCalledWith("status", "in", expect.anything());
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

describe("SupabaseClaimRepository.updateClaimDetailsByFinance", () => {
  function createFinanceExpenseEditPayload(overrides?: Record<string, unknown>) {
    return {
      detailType: "expense" as const,
      detailId: "expense-detail-1",
      editReason: "Correcting expense detail data",
      approvedAmount: 118,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("calls update_claim_by_finance RPC with actor id, reason, and payload", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      rpc: mockRpc,
    });

    const repository = new SupabaseClaimRepository();
    const payload = createFinanceExpenseEditPayload();
    const result = await repository.updateClaimDetailsByFinance("claim-1", "actor-1", payload);

    expect(result).toEqual({ errorMessage: null });
    expect(mockRpc).toHaveBeenCalledWith(
      "update_claim_by_finance",
      expect.objectContaining({
        p_claim_id: "claim-1",
        p_actor_id: "actor-1",
        p_edit_reason: "Correcting expense detail data",
        p_payload: payload,
      }),
    );
  });

  test("passes paymentModeId in RPC payload when present", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      rpc: mockRpc,
    });

    const repository = new SupabaseClaimRepository();
    const payload = createFinanceExpenseEditPayload({
      paymentModeId: "22222222-2222-4222-8222-222222222222",
    });
    const result = await repository.updateClaimDetailsByFinance("claim-1", "actor-1", payload);

    expect(result).toEqual({ errorMessage: null });
    expect(mockRpc).toHaveBeenCalledWith(
      "update_claim_by_finance",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          paymentModeId: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );
  });

  test("returns RPC error message when update_claim_by_finance fails", async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "claim update failed" },
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ rpc: mockRpc });

    const repository = new SupabaseClaimRepository();
    const result = await repository.updateClaimDetailsByFinance(
      "claim-1",
      "actor-1",
      createFinanceExpenseEditPayload(),
    );

    expect(result).toEqual({ errorMessage: "claim update failed" });
  });

  test("rethrows duplicate active bill unique violations for expense payloads", async () => {
    const duplicateError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "uq_expense_details_active_bill"',
      details: "Key (bill_no, transaction_date, basic_amount) already exists.",
    };
    const mockRpc = jest.fn().mockResolvedValue({ data: null, error: duplicateError });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ rpc: mockRpc });

    const repository = new SupabaseClaimRepository();

    await expect(
      repository.updateClaimDetailsByFinance(
        "claim-1",
        "actor-1",
        createFinanceExpenseEditPayload(),
      ),
    ).rejects.toEqual(duplicateError);
  });
});

describe("SupabaseClaimRepository.getClaimsForFullExport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("maps requested and approved amounts separately for expense and advance rows", async () => {
    const idsBuilder = createQueryBuilder({
      data: [
        { claim_id: "claim-expense", created_at: "2026-03-24T10:00:00.000Z" },
        { claim_id: "claim-advance", created_at: "2026-03-23T10:00:00.000Z" },
      ],
      error: null,
    });
    const claimsBuilder = createQueryBuilder({
      data: [
        {
          id: "claim-expense",
          status: "Submitted - Awaiting HOD approval",
          submission_type: "Self",
          detail_type: "expense",
          submitted_by: "user-1",
          on_behalf_of_id: null,
          employee_id: "EMP-100",
          cc_emails: null,
          on_behalf_email: null,
          on_behalf_employee_code: null,
          department_id: "dept-1",
          payment_mode_id: "pm-1",
          assigned_l1_approver_id: "l1-1",
          assigned_l2_approver_id: "l2-1",
          submitted_at: "2026-03-24T10:00:00.000Z",
          hod_action_at: null,
          finance_action_at: null,
          rejection_reason: null,
          is_resubmission_allowed: false,
          created_at: "2026-03-24T10:00:00.000Z",
          updated_at: "2026-03-24T10:05:00.000Z",
          submitter_user: { full_name: "Employee One", email: "user1@nxtwave.co.in" },
          beneficiary_user: null,
          l1_approver_user: null,
          l2_finance_approver: null,
          master_departments: { id: "dept-1", name: "Finance" },
          master_payment_modes: { id: "pm-1", name: "Reimbursement" },
          expense_details: {
            bill_no: "BILL-1",
            transaction_id: "TXN-1",
            purpose: "Client visit",
            expense_category_id: "cat-1",
            product_id: "prod-1",
            location_id: "loc-1",
            location_type: null,
            location_details: null,
            is_gst_applicable: true,
            gst_number: "GST1234",
            transaction_date: "2026-03-22",
            basic_amount: "100",
            cgst_amount: "9",
            sgst_amount: "9",
            igst_amount: "0",
            requested_total_amount: "118",
            approved_amount: "110",
            currency_code: "INR",
            vendor_name: "Vendor A",
            people_involved: "Alice",
            remarks: "Remark",
            receipt_file_path: null,
            bank_statement_file_path: null,
            master_expense_categories: { id: "cat-1", name: "Travel" },
            master_products: { id: "prod-1", name: "Product X" },
            master_locations: { id: "loc-1", name: "Hyderabad" },
          },
          advance_details: null,
        },
        {
          id: "claim-advance",
          status: "HOD approved - Awaiting finance approval",
          submission_type: "Self",
          detail_type: "advance",
          submitted_by: "user-1",
          on_behalf_of_id: null,
          employee_id: "EMP-200",
          cc_emails: null,
          on_behalf_email: null,
          on_behalf_employee_code: null,
          department_id: "dept-1",
          payment_mode_id: "pm-2",
          assigned_l1_approver_id: "l1-1",
          assigned_l2_approver_id: "l2-1",
          submitted_at: "2026-03-23T10:00:00.000Z",
          hod_action_at: null,
          finance_action_at: null,
          rejection_reason: null,
          is_resubmission_allowed: false,
          created_at: "2026-03-23T10:00:00.000Z",
          updated_at: "2026-03-23T10:05:00.000Z",
          submitter_user: { full_name: "Employee Two", email: "user2@nxtwave.co.in" },
          beneficiary_user: null,
          l1_approver_user: null,
          l2_finance_approver: null,
          master_departments: { id: "dept-1", name: "Finance" },
          master_payment_modes: { id: "pm-2", name: "Petty Cash Request" },
          expense_details: null,
          advance_details: {
            requested_total_amount: "500",
            approved_amount: "450",
            budget_month: 3,
            budget_year: 2026,
            expected_usage_date: "2026-03-29",
            purpose: "Team travel advance",
            product_id: "prod-2",
            location_id: "loc-2",
            remarks: "Advance remark",
            supporting_document_path: null,
            master_products: { id: "prod-2", name: "Product Y" },
            master_locations: { id: "loc-2", name: "Bengaluru" },
          },
        },
      ],
      error: null,
    });
    const walletsBuilder = createQueryBuilder({
      data: [{ user_id: "user-1", petty_cash_balance: "2500" }],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "vw_enterprise_claims_dashboard") {
        return { select: jest.fn(() => idsBuilder) };
      }

      if (table === "claims") {
        return { select: jest.fn(() => claimsBuilder) };
      }

      if (table === "wallets") {
        return { select: jest.fn(() => walletsBuilder) };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.getClaimsForFullExport({
      userId: "user-1",
      fetchScope: "submissions",
      limit: 500,
    });

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      expect.objectContaining({
        claimId: "claim-expense",
        detailType: "expense",
        requestedTotalAmount: 118,
        approvedAmount: 110,
      }),
      expect.objectContaining({
        claimId: "claim-advance",
        detailType: "advance",
        requestedTotalAmount: 500,
        approvedAmount: 450,
      }),
    ]);
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
