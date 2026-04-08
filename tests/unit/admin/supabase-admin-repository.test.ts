import { SupabaseAdminRepository } from "@/modules/admin/repositories/SupabaseAdminRepository";

const mockGetServiceRoleSupabaseClient = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryChain = {
  data: unknown;
  error: { message: string } | null;
  select: jest.Mock<QueryChain, unknown[]>;
  eq: jest.Mock<QueryChain, unknown[]>;
  in: jest.Mock<QueryChain, unknown[]>;
  ilike: jest.Mock<QueryChain, unknown[]>;
  or: jest.Mock<QueryChain, unknown[]>;
  order: jest.Mock<QueryChain, unknown[]>;
  limit: jest.Mock<QueryChain, unknown[]>;
  not: jest.Mock<QueryChain, unknown[]>;
  gte: jest.Mock<QueryChain, unknown[]>;
  lte: jest.Mock<QueryChain, unknown[]>;
  lt: jest.Mock<QueryChain, unknown[]>;
  update: jest.Mock<QueryChain, unknown[]>;
  insert: jest.Mock<QueryChain, unknown[]>;
  delete: jest.Mock<QueryChain, unknown[]>;
  single: jest.Mock<Promise<QueryResult>, unknown[]>;
  maybeSingle: jest.Mock<Promise<QueryResult>, unknown[]>;
};

function createQueryChain(result: QueryResult) {
  const chain = {} as QueryChain;

  chain.data = result.data;
  chain.error = result.error;
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.ilike = jest.fn(() => chain);
  chain.or = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.not = jest.fn(() => chain);
  chain.gte = jest.fn(() => chain);
  chain.lte = jest.fn(() => chain);
  chain.lt = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.delete = jest.fn(() => chain);
  chain.single = jest.fn(async () => ({ data: result.data, error: result.error }));
  chain.maybeSingle = jest.fn(async () => ({ data: result.data, error: result.error }));

  return chain;
}

describe("SupabaseAdminRepository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });
  });

  test("getAllClaims maps rows and applies cursor pagination", async () => {
    const claimsChain = createQueryChain({
      data: [
        {
          claim_id: "claim-2",
          employee_name: "Bob",
          employee_id: "EMP-2",
          department_name: "Engineering",
          type_of_claim: "Expense",
          amount: "100.25",
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-20T10:00:00.000Z",
          hod_action_date: null,
          finance_action_date: null,
          detail_type: "expense",
          submission_type: "Self",
          is_active: true,
          department_id: "dep-1",
        },
        {
          claim_id: "claim-1",
          employee_name: "Alice",
          employee_id: "EMP-1",
          department_name: "Engineering",
          type_of_claim: "Expense",
          amount: 90,
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-19T10:00:00.000Z",
          hod_action_date: null,
          finance_action_date: null,
          detail_type: "expense",
          submission_type: "On Behalf",
          is_active: true,
          department_id: "dep-1",
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "vw_enterprise_claims_dashboard") {
        return claimsChain;
      }
      return createQueryChain({ data: null, error: null });
    });

    const repository = new SupabaseAdminRepository();
    const result = await repository.getAllClaims({}, { cursor: null, limit: 1 });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.hasNextPage).toBe(true);
    expect(result.data?.nextCursor).toBe("2026-03-20T10:00:00.000Z");
    expect(result.data?.data).toEqual([
      {
        claimId: "claim-2",
        employeeName: "Bob",
        employeeId: "EMP-2",
        departmentName: "Engineering",
        typeOfClaim: "Expense",
        amount: 100.25,
        status: "Submitted - Awaiting HOD approval",
        submittedOn: "2026-03-20T10:00:00.000Z",
        hodActionDate: null,
        financeActionDate: null,
        detailType: "expense",
        submissionType: "Self",
        isActive: true,
        departmentId: "dep-1",
      },
    ]);
  });

  test("getAllClaims uses advanced date keys instead of standard date target branch", async () => {
    const claimsChain = createQueryChain({
      data: [
        {
          claim_id: "claim-1",
          employee_name: "Alice",
          employee_id: "EMP-1",
          department_name: "Engineering",
          type_of_claim: "Expense",
          amount: 90,
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-19T10:00:00.000Z",
          hod_action_date: null,
          finance_action_date: null,
          detail_type: "expense",
          submission_type: "On Behalf",
          is_active: true,
          department_id: "dep-1",
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "vw_enterprise_claims_dashboard") {
        return claimsChain;
      }
      return createQueryChain({ data: null, error: null });
    });

    const repository = new SupabaseAdminRepository();
    await repository.getAllClaims(
      {
        dateTarget: "hod_action",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        submittedFrom: "2026-03-10",
        financeActionTo: "2026-03-21",
      },
      { cursor: null, limit: 10 },
    );

    expect(claimsChain.gte).toHaveBeenCalledWith("submitted_on", "2026-03-10T00:00:00.000Z");
    expect(claimsChain.lte).toHaveBeenCalledWith("finance_action_date", "2026-03-21T23:59:59.999Z");

    expect(claimsChain.gte).not.toHaveBeenCalledWith("hod_action_date", "2026-01-01T00:00:00.000Z");
    expect(claimsChain.lte).not.toHaveBeenCalledWith("hod_action_date", "2026-01-31T23:59:59.999Z");
  });

  test("getAllClaims applies amount range filters", async () => {
    const claimsChain = createQueryChain({
      data: [
        {
          claim_id: "claim-1",
          employee_name: "Alice",
          employee_id: "EMP-1",
          department_name: "Engineering",
          type_of_claim: "Expense",
          amount: 250,
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-19T10:00:00.000Z",
          hod_action_date: null,
          finance_action_date: null,
          detail_type: "expense",
          submission_type: "Self",
          is_active: true,
          department_id: "dep-1",
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "vw_enterprise_claims_dashboard") {
        return claimsChain;
      }
      return createQueryChain({ data: null, error: null });
    });

    const repository = new SupabaseAdminRepository();
    await repository.getAllClaims(
      {
        minAmount: 100,
        maxAmount: 500,
      },
      { cursor: null, limit: 10 },
    );

    expect(claimsChain.gte).toHaveBeenCalledWith("amount", 100);
    expect(claimsChain.lte).toHaveBeenCalledWith("amount", 500);
  });

  test("softDeleteClaim is idempotent when claim is already inactive", async () => {
    const fetchChain = createQueryChain({ data: { is_active: false }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "claims") {
        return fetchChain;
      }
      return createQueryChain({ data: null, error: null });
    });

    const repository = new SupabaseAdminRepository();
    const result = await repository.softDeleteClaim("claim-1", "admin-1");

    expect(result).toEqual({ success: true, errorMessage: null });
    expect(fetchChain.single).toHaveBeenCalledTimes(1);
  });

  test("softDeleteClaim returns success with warning when audit log write fails", async () => {
    const fetchChain = createQueryChain({ data: { is_active: true }, error: null });
    const updateClaimChain = createQueryChain({ data: null, error: null });
    const updateExpenseDetailsChain = createQueryChain({ data: null, error: null });
    const updateAdvanceDetailsChain = createQueryChain({ data: null, error: null });
    const auditChain = createQueryChain({ data: null, error: { message: "audit failed" } });

    mockFrom
      .mockImplementationOnce(() => fetchChain)
      .mockImplementationOnce(() => updateClaimChain)
      .mockImplementationOnce(() => updateExpenseDetailsChain)
      .mockImplementationOnce(() => updateAdvanceDetailsChain)
      .mockImplementationOnce(() => auditChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.softDeleteClaim("claim-1", "admin-1");

    expect(result.success).toBe(true);
    expect(result.errorMessage).toContain("audit log failed");
  });

  test("getClaimOverrideSummary returns mapped claim summary", async () => {
    const claimChain = createQueryChain({
      data: {
        id: "CLAIM-EMP1-20260408-0001",
        status: "Submitted - Awaiting HOD approval",
        is_active: true,
        assigned_l2_approver_id: null,
        hod_action_at: null,
        finance_action_at: null,
        rejection_reason: null,
        is_resubmission_allowed: false,
        submitter_user: { full_name: "Alex", email: "alex@nxtwave.co.in" },
        master_departments: { name: "Engineering" },
        expense_details: { total_amount: "245.60", is_active: true },
        advance_details: null,
      },
      error: null,
    });

    mockFrom.mockReturnValue(claimChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.getClaimOverrideSummary("CLAIM-EMP1-20260408-0001");

    expect(result).toEqual({
      data: {
        claimId: "CLAIM-EMP1-20260408-0001",
        submitterName: "Alex",
        submitterEmail: "alex@nxtwave.co.in",
        status: "Submitted - Awaiting HOD approval",
        amount: 245.6,
        departmentName: "Engineering",
        isActive: true,
      },
      errorMessage: null,
    });
  });

  test("forceUpdateClaimStatus updates status and writes audit log", async () => {
    const fetchChain = createQueryChain({
      data: {
        id: "claim-1",
        status: "HOD approved - Awaiting finance approval",
        assigned_l2_approver_id: "fin-1",
        hod_action_at: "2026-04-08T09:00:00.000Z",
        finance_action_at: null,
        rejection_reason: null,
        is_resubmission_allowed: false,
      },
      error: null,
    });
    const updateChain = createQueryChain({ data: null, error: null });
    const auditChain = createQueryChain({ data: null, error: null });

    mockFrom
      .mockImplementationOnce(() => fetchChain)
      .mockImplementationOnce(() => updateChain)
      .mockImplementationOnce(() => auditChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.forceUpdateClaimStatus({
      claimId: "claim-1",
      actorId: "admin-1",
      newStatus: "Payment Done - Closed",
      reason: "Manual correction",
    });

    expect(result).toEqual({ success: true, errorMessage: null });
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "Payment Done - Closed",
        rejection_reason: null,
        is_resubmission_allowed: false,
      }),
    );
    expect(auditChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        claim_id: "claim-1",
        actor_id: "admin-1",
        action_type: "L2_MARK_PAID",
      }),
    );
  });

  test("forceUpdateClaimStatus rolls back when audit insert fails", async () => {
    const fetchChain = createQueryChain({
      data: {
        id: "claim-1",
        status: "Submitted - Awaiting HOD approval",
        assigned_l2_approver_id: null,
        hod_action_at: null,
        finance_action_at: null,
        rejection_reason: null,
        is_resubmission_allowed: false,
      },
      error: null,
    });
    const updateChain = createQueryChain({ data: null, error: null });
    const auditChain = createQueryChain({ data: null, error: { message: "audit failed" } });
    const rollbackChain = createQueryChain({ data: null, error: null });

    mockFrom
      .mockImplementationOnce(() => fetchChain)
      .mockImplementationOnce(() => updateChain)
      .mockImplementationOnce(() => auditChain)
      .mockImplementationOnce(() => rollbackChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.forceUpdateClaimStatus({
      claimId: "claim-1",
      actorId: "admin-1",
      newStatus: "HOD approved - Awaiting finance approval",
      reason: "Need workflow restart",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("Status update was reverted");
    expect(rollbackChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Submitted - Awaiting HOD approval" }),
    );
  });

  test("updateDepartmentActors blocks same user for HOD and Founder", async () => {
    const repository = new SupabaseAdminRepository();

    const result = await repository.updateDepartmentActors("dep-1", "user-1", "user-1");

    expect(result).toEqual({
      success: false,
      errorMessage: "HOD and Founder cannot be the same person.",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("updateDepartmentActorsByEmail stores provisional emails when users do not exist", async () => {
    const userLookupChain = createQueryChain({ data: null, error: null });
    const updateChain = createQueryChain({ data: null, error: null });

    mockFrom
      .mockImplementationOnce(() => userLookupChain)
      .mockImplementationOnce(() => userLookupChain)
      .mockImplementationOnce(() => updateChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.updateDepartmentActorsByEmail(
      "dep-1",
      "hod@nxtwave.co.in",
      "founder@nxtwave.co.in",
    );

    expect(result).toEqual({ success: true, errorMessage: null });
    expect(updateChain.update).toHaveBeenCalledWith({
      hod_user_id: null,
      hod_provisional_email: "hod@nxtwave.co.in",
      founder_user_id: null,
      founder_provisional_email: "founder@nxtwave.co.in",
    });
  });

  test("addFinanceApproverByEmail prevents duplicate approvers", async () => {
    const usersChain = createQueryChain({ data: null, error: null });
    const approverChain = createQueryChain({ data: { id: "fa-1" }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersChain;
      }
      return approverChain;
    });

    const repository = new SupabaseAdminRepository();
    const result = await repository.addFinanceApproverByEmail("finance@nxtwave.co.in");

    expect(result).toEqual({
      data: null,
      errorMessage: "This email is already registered as a finance approver.",
    });
  });

  test("addFinanceApproverByEmail creates provisional approver when user does not exist", async () => {
    const usersChain = createQueryChain({ data: null, error: null });
    const duplicateCheckChain = createQueryChain({ data: null, error: null });
    const insertChain = createQueryChain({
      data: {
        id: "fa-2",
        user_id: null,
        is_active: true,
        is_primary: false,
        provisional_email: "newfinance@nxtwave.co.in",
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => usersChain)
      .mockImplementationOnce(() => duplicateCheckChain)
      .mockImplementationOnce(() => insertChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.addFinanceApproverByEmail("NewFinance@Nxtwave.co.in");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      id: "fa-2",
      userId: null,
      email: "newfinance@nxtwave.co.in",
      fullName: null,
      isActive: true,
      isPrimary: false,
      provisionalEmail: "newfinance@nxtwave.co.in",
    });
  });

  test("getAllUsers maps rows and paginates", async () => {
    const usersChain = createQueryChain({
      data: [
        {
          id: "u2",
          email: "u2@nxtwave.co.in",
          full_name: "User Two",
          role: "employee",
          is_active: true,
          created_at: "2026-03-20T10:00:00.000Z",
        },
        {
          id: "u1",
          email: "u1@nxtwave.co.in",
          full_name: "User One",
          role: "hod",
          is_active: true,
          created_at: "2026-03-19T10:00:00.000Z",
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue(usersChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.getAllUsers({ cursor: null, limit: 1 });

    expect(result.errorMessage).toBeNull();
    expect(result.data?.hasNextPage).toBe(true);
    expect(result.data?.nextCursor).toBe("2026-03-20T10:00:00.000Z");
    expect(result.data?.data[0].email).toBe("u2@nxtwave.co.in");
  });

  test("addAdminByEmail prevents duplicates", async () => {
    const usersChain = createQueryChain({ data: { id: "user-1" }, error: null });
    const adminsChain = createQueryChain({ data: { id: "admin-1" }, error: null });

    mockFrom.mockImplementationOnce(() => usersChain).mockImplementationOnce(() => adminsChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.addAdminByEmail("admin@nxtwave.co.in");

    expect(result).toEqual({
      data: null,
      errorMessage: "This email is already registered as an admin.",
    });
  });

  test("addAdminByEmail creates provisional admin when user does not exist", async () => {
    const usersChain = createQueryChain({ data: null, error: null });
    const duplicateCheckChain = createQueryChain({ data: null, error: null });
    const insertChain = createQueryChain({
      data: {
        id: "admin-2",
        user_id: null,
        provisional_email: "newadmin@nxtwave.co.in",
        created_at: "2026-03-21T10:00:00.000Z",
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => usersChain)
      .mockImplementationOnce(() => duplicateCheckChain)
      .mockImplementationOnce(() => insertChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.addAdminByEmail("newadmin@nxtwave.co.in");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      id: "admin-2",
      userId: null,
      email: "newadmin@nxtwave.co.in",
      fullName: null,
      createdAt: "2026-03-21T10:00:00.000Z",
      provisionalEmail: "newadmin@nxtwave.co.in",
    });
  });

  test("addDepartmentViewerByEmail returns validation error when user does not exist", async () => {
    const usersChain = createQueryChain({ data: null, error: null });
    mockFrom.mockReturnValue(usersChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.addDepartmentViewerByEmail("dep-1", "viewer@nxtwave.co.in");

    expect(result.data).toBeNull();
    expect(result.errorMessage).toContain("must sign in at least once");
  });

  test("addDepartmentViewerByEmail reactivates existing inactive assignment", async () => {
    const usersChain = createQueryChain({ data: { id: "user-1" }, error: null });
    const existingChain = createQueryChain({
      data: { id: "viewer-1", is_active: false },
      error: null,
    });
    const reactivateChain = createQueryChain({ data: null, error: null });
    const refetchChain = createQueryChain({
      data: {
        id: "viewer-1",
        user_id: "user-1",
        department_id: "dep-1",
        is_active: true,
        created_at: "2026-03-21T10:00:00.000Z",
        user: { full_name: "Viewer User", email: "viewer@nxtwave.co.in" },
        department: { name: "Engineering" },
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => usersChain)
      .mockImplementationOnce(() => existingChain)
      .mockImplementationOnce(() => reactivateChain)
      .mockImplementationOnce(() => refetchChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.addDepartmentViewerByEmail("dep-1", "viewer@nxtwave.co.in");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      id: "viewer-1",
      userId: "user-1",
      email: "viewer@nxtwave.co.in",
      fullName: "Viewer User",
      departmentId: "dep-1",
      departmentName: "Engineering",
      isActive: true,
      createdAt: "2026-03-21T10:00:00.000Z",
    });
  });

  test("removeDepartmentViewer performs soft delete", async () => {
    const removeChain = createQueryChain({ data: null, error: null });
    mockFrom.mockReturnValue(removeChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.removeDepartmentViewer("viewer-1");

    expect(result).toEqual({ success: true, errorMessage: null });
    expect(removeChain.update).toHaveBeenCalledWith({ is_active: false });
  });

  test("getMasterDataItems maps records and error path", async () => {
    const errorChain = createQueryChain({ data: null, error: { message: "read failed" } });
    mockFrom.mockReturnValue(errorChain);

    const repository = new SupabaseAdminRepository();
    const failed = await repository.getMasterDataItems("master_products");
    expect(failed).toEqual({ data: [], errorMessage: "read failed" });

    const successChain = createQueryChain({
      data: [{ id: "m1", name: "Laptop", is_active: true }],
      error: null,
    });
    mockFrom.mockReturnValue(successChain);

    const result = await repository.getMasterDataItems("master_products");
    expect(result).toEqual({
      data: [{ id: "m1", name: "Laptop", isActive: true }],
      errorMessage: null,
    });
  });

  test("createMasterDataItem and updateMasterDataItem trim names and map responses", async () => {
    const createChain = createQueryChain({
      data: { id: "m1", name: "Laptop", is_active: true },
      error: null,
    });
    const updateChain = createQueryChain({
      data: { id: "m1", name: "Tablet", is_active: false },
      error: null,
    });

    mockFrom.mockImplementationOnce(() => createChain).mockImplementationOnce(() => updateChain);

    const repository = new SupabaseAdminRepository();

    const created = await repository.createMasterDataItem("master_products", "  Laptop  ");
    expect(createChain.insert).toHaveBeenCalledWith({ name: "Laptop" });
    expect(created).toEqual({
      data: { id: "m1", name: "Laptop", isActive: true },
      errorMessage: null,
    });

    const updated = await repository.updateMasterDataItem("master_products", "m1", {
      name: "  Tablet  ",
      isActive: false,
    });
    expect(updateChain.update).toHaveBeenCalledWith({ name: "Tablet", is_active: false });
    expect(updated).toEqual({
      data: { id: "m1", name: "Tablet", isActive: false },
      errorMessage: null,
    });
  });

  test("getDepartmentsWithActors maps joined user relations", async () => {
    const chain = createQueryChain({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          hod_user_id: "hod-1",
          founder_user_id: "founder-1",
          hod_provisional_email: null,
          founder_provisional_email: null,
          hod: [{ full_name: "Hod One", email: "hod@nxtwave.co.in" }],
          founder: { full_name: "Founder One", email: "founder@nxtwave.co.in" },
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.getDepartmentsWithActors();

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      {
        id: "dep-1",
        name: "Engineering",
        isActive: true,
        hodUserId: "hod-1",
        hodUserName: "Hod One",
        hodUserEmail: "hod@nxtwave.co.in",
        hodProvisionalEmail: null,
        founderUserId: "founder-1",
        founderUserName: "Founder One",
        founderUserEmail: "founder@nxtwave.co.in",
        founderProvisionalEmail: null,
      },
    ]);
  });

  test("updateDepartmentActorsByEmail blocks same resolved user id", async () => {
    const hodLookupChain = createQueryChain({ data: { id: "same-user" }, error: null });
    const founderLookupChain = createQueryChain({ data: { id: "same-user" }, error: null });

    mockFrom
      .mockImplementationOnce(() => hodLookupChain)
      .mockImplementationOnce(() => founderLookupChain);

    const repository = new SupabaseAdminRepository();
    const result = await repository.updateDepartmentActorsByEmail(
      "dep-1",
      "same@nxtwave.co.in",
      "same@nxtwave.co.in",
    );

    expect(result).toEqual({
      success: false,
      errorMessage: "HOD and Founder cannot be the same person.",
    });
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  test("getFinanceApprovers, createFinanceApprover and updateFinanceApprover map records", async () => {
    const listChain = createQueryChain({
      data: [
        {
          id: "fa-1",
          user_id: "u-1",
          is_active: true,
          is_primary: true,
          provisional_email: null,
          user: [{ full_name: "Fin One", email: "finance@nxtwave.co.in" }],
        },
      ],
      error: null,
    });
    const createChain = createQueryChain({
      data: {
        id: "fa-2",
        user_id: "u-2",
        is_active: true,
        is_primary: false,
        provisional_email: null,
        user: { full_name: "Fin Two", email: "finance2@nxtwave.co.in" },
      },
      error: null,
    });
    const updateChain = createQueryChain({
      data: {
        id: "fa-2",
        user_id: "u-2",
        is_active: false,
        is_primary: true,
        provisional_email: null,
        user: { full_name: "Fin Two", email: "finance2@nxtwave.co.in" },
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => listChain)
      .mockImplementationOnce(() => createChain)
      .mockImplementationOnce(() => updateChain);

    const repository = new SupabaseAdminRepository();

    const listed = await repository.getFinanceApprovers();
    expect(listed.data[0]).toEqual({
      id: "fa-1",
      userId: "u-1",
      email: "finance@nxtwave.co.in",
      fullName: "Fin One",
      isActive: true,
      isPrimary: true,
      provisionalEmail: null,
    });

    const created = await repository.createFinanceApprover("u-2");
    expect(created.data?.email).toBe("finance2@nxtwave.co.in");

    const updated = await repository.updateFinanceApprover("fa-2", {
      isActive: false,
      isPrimary: true,
    });
    expect(updateChain.update).toHaveBeenCalledWith({ is_active: false, is_primary: true });
    expect(updated.data?.isPrimary).toBe(true);
  });

  test("addFinanceApproverByEmail links to existing user and creates full entry", async () => {
    const usersChain = createQueryChain({ data: { id: "user-1" }, error: null });
    const provisionalCheckChain = createQueryChain({ data: null, error: null });
    const duplicateCheckChain = createQueryChain({ data: null, error: null });
    const createChain = createQueryChain({
      data: {
        id: "fa-3",
        user_id: "user-1",
        is_active: true,
        is_primary: false,
        provisional_email: null,
        user: { full_name: "Finance User", email: "finance@nxtwave.co.in" },
      },
      error: null,
    });

    let financeQueryCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersChain;
      }

      if (table === "master_finance_approvers") {
        financeQueryCount += 1;
        if (financeQueryCount === 1) return provisionalCheckChain;
        if (financeQueryCount === 2) return duplicateCheckChain;
        return createChain;
      }

      return createChain;
    });

    const repository = new SupabaseAdminRepository();
    const result = await repository.addFinanceApproverByEmail("finance@nxtwave.co.in");

    expect(result.errorMessage).toBeNull();
    expect(result.data?.userId).toBe("user-1");
    expect(result.data?.email).toBe("finance@nxtwave.co.in");
  });

  test("updateUserRole and removeAdmin return error and success states", async () => {
    const updateErrorChain = createQueryChain({ data: null, error: { message: "role failed" } });
    const removeSuccessChain = createQueryChain({ data: null, error: null });

    mockFrom
      .mockImplementationOnce(() => updateErrorChain)
      .mockImplementationOnce(() => removeSuccessChain);

    const repository = new SupabaseAdminRepository();
    const updated = await repository.updateUserRole("user-1", "finance");
    const removed = await repository.removeAdmin("admin-1");

    expect(updated).toEqual({ success: false, errorMessage: "role failed" });
    expect(removed).toEqual({ success: true, errorMessage: null });
  });

  test("getAdmins and addAdminByEmail map linked-user records", async () => {
    const listChain = createQueryChain({
      data: [
        {
          id: "admin-1",
          user_id: "user-1",
          provisional_email: null,
          created_at: "2026-03-01T10:00:00.000Z",
          user: [{ full_name: "Admin User", email: "admin@nxtwave.co.in" }],
        },
      ],
      error: null,
    });
    const usersChain = createQueryChain({ data: { id: "user-2" }, error: null });
    const duplicateChain = createQueryChain({ data: null, error: null });
    const insertChain = createQueryChain({
      data: {
        id: "admin-2",
        user_id: "user-2",
        provisional_email: null,
        created_at: "2026-03-02T10:00:00.000Z",
        user: { full_name: "Second Admin", email: "admin2@nxtwave.co.in" },
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => listChain)
      .mockImplementationOnce(() => usersChain)
      .mockImplementationOnce(() => duplicateChain)
      .mockImplementationOnce(() => insertChain);

    const repository = new SupabaseAdminRepository();

    const listed = await repository.getAdmins();
    expect(listed.data[0]).toEqual({
      id: "admin-1",
      userId: "user-1",
      email: "admin@nxtwave.co.in",
      fullName: "Admin User",
      createdAt: "2026-03-01T10:00:00.000Z",
      provisionalEmail: null,
    });

    const created = await repository.addAdminByEmail("admin2@nxtwave.co.in");
    expect(created.data).toEqual({
      id: "admin-2",
      userId: "user-2",
      email: "admin2@nxtwave.co.in",
      fullName: "Second Admin",
      createdAt: "2026-03-02T10:00:00.000Z",
      provisionalEmail: null,
    });
  });

  test("getDepartmentViewers and addDepartmentViewerByEmail cover duplicate and insert paths", async () => {
    const listChain = createQueryChain({
      data: [
        {
          id: "viewer-1",
          user_id: "user-1",
          department_id: "dep-1",
          is_active: true,
          created_at: "2026-03-01T10:00:00.000Z",
          user: [{ full_name: "Viewer User", email: "viewer@nxtwave.co.in" }],
          department: [{ name: "Engineering" }],
        },
      ],
      error: null,
    });
    const usersChain = createQueryChain({ data: { id: "user-2" }, error: null });
    const duplicateActiveChain = createQueryChain({
      data: { id: "viewer-2", is_active: true },
      error: null,
    });
    const usersChain2 = createQueryChain({ data: { id: "user-3" }, error: null });
    const noExistingChain = createQueryChain({ data: null, error: null });
    const insertChain = createQueryChain({
      data: {
        id: "viewer-3",
        user_id: "user-3",
        department_id: "dep-2",
        is_active: true,
        created_at: "2026-03-03T10:00:00.000Z",
        user: { full_name: "New Viewer", email: "newviewer@nxtwave.co.in" },
        department: { name: "Marketing" },
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => listChain)
      .mockImplementationOnce(() => usersChain)
      .mockImplementationOnce(() => duplicateActiveChain)
      .mockImplementationOnce(() => usersChain2)
      .mockImplementationOnce(() => noExistingChain)
      .mockImplementationOnce(() => insertChain);

    const repository = new SupabaseAdminRepository();

    const listed = await repository.getDepartmentViewers();
    expect(listed.data[0].departmentName).toBe("Engineering");

    const duplicate = await repository.addDepartmentViewerByEmail("dep-1", "viewer@nxtwave.co.in");
    expect(duplicate.errorMessage).toBe(
      "This user is already assigned as a viewer for this department.",
    );

    const created = await repository.addDepartmentViewerByEmail("dep-2", "newviewer@nxtwave.co.in");
    expect(created.data).toEqual({
      id: "viewer-3",
      userId: "user-3",
      email: "newviewer@nxtwave.co.in",
      fullName: "New Viewer",
      departmentId: "dep-2",
      departmentName: "Marketing",
      isActive: true,
      createdAt: "2026-03-03T10:00:00.000Z",
    });
  });
});
