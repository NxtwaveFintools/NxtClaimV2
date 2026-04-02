import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const STATUS_SUBMITTED = "Submitted - Awaiting HOD approval";
const STATUS_HOD_APPROVED = "HOD approved - Awaiting finance approval";
const STATUS_FINANCE_APPROVED = "Finance Approved - Payment under process";
const STATUS_PAYMENT_DONE = "Payment Done - Closed";
const STATUS_REJECTED = "Rejected";

const ADVANCE_PAYMENT_MODES = new Set(["petty cash request", "bulk petty cash request"]);

const DEFAULT_TOTAL_CLAIMS = 50;
const DEFAULT_MONTH_WINDOW = 3;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const COUNT_ARG_INDEX = args.indexOf("--count");
const COUNT =
  COUNT_ARG_INDEX !== -1 && args[COUNT_ARG_INDEX + 1]
    ? Math.max(1, Number.parseInt(args[COUNT_ARG_INDEX + 1], 10) || DEFAULT_TOTAL_CLAIMS)
    : DEFAULT_TOTAL_CLAIMS;

function resolveConnectionSettings() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (connectionString) {
    return {
      mode: "pg",
      connectionString,
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey) {
    return {
      mode: "supabase",
      supabaseUrl,
      serviceRoleKey,
    };
  }

  throw new Error(
    "Missing DB connection settings. Provide SUPABASE_DB_URL (or DATABASE_URL), or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
  );
}

async function loadEnvFiles() {
  const envPaths = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), ".env.local")];

  for (const envPath of envPaths) {
    let raw;
    try {
      raw = await readFile(envPath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (!key || process.env[key]) {
        continue;
      }

      process.env[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

function makeSeededRandom(seed) {
  let state = seed >>> 0;

  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickOne(values, random) {
  return values[Math.floor(random() * values.length)];
}

function toAmount(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dayOffsetDate(daysBack, random) {
  const now = new Date();
  const date = new Date(now);
  date.setUTCDate(now.getUTCDate() - daysBack);
  date.setUTCHours(Math.floor(9 + random() * 8), Math.floor(random() * 60), 0, 0);
  return date;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function toYyyyMmDd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function toEmployeeCode(prefix, sequence) {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

function normalizeRole(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveStatusByIndex(index, total) {
  const ratio = index / total;

  if (ratio < 0.24) {
    return STATUS_SUBMITTED;
  }

  if (ratio < 0.48) {
    return STATUS_HOD_APPROVED;
  }

  if (ratio < 0.72) {
    return STATUS_FINANCE_APPROVED;
  }

  if (ratio < 0.84) {
    return STATUS_PAYMENT_DONE;
  }

  return STATUS_REJECTED;
}

function resolveFinanceApproverId(financeApprovers, preferredUserId) {
  if (financeApprovers.length === 0) {
    return null;
  }

  const matchByUser = financeApprovers.find((approver) => approver.user_id === preferredUserId);
  return (matchByUser ?? financeApprovers[0]).id;
}

function buildClaimId(index, submittedAt) {
  return `CLAIM-ANA-${toYyyyMmDd(submittedAt)}-${String(index + 1).padStart(4, "0")}`;
}

function buildCcEmails(users, random) {
  const financeUser = users.find((user) => normalizeRole(user.role) === "finance");

  if (!financeUser?.email) {
    return null;
  }

  return random() > 0.35 ? financeUser.email : null;
}

function buildPurpose(detailType, random) {
  const expensePurposes = [
    "Client visit operations",
    "Regional hiring drive",
    "Center launch travel",
    "Team enablement workshop",
    "Vendor settlement",
  ];

  const advancePurposes = [
    "Quarterly outreach budget",
    "Event operations float",
    "Field mobilization advance",
    "Center setup advance",
  ];

  return detailType === "advance" ? pickOne(advancePurposes, random) : pickOne(expensePurposes, random);
}

async function fetchReferencesWithPg(client) {
  const [usersResult, departmentsResult, paymentModesResult, financeApproversResult, categoriesResult, productsResult, locationsResult, existingClaimsResult, existingExpenseDetailsResult, existingAdvanceDetailsResult] =
    await Promise.all([
      client.query(`select id, email, full_name, role from public.users where is_active = true order by created_at asc`),
      client.query(
        `select id, name, hod_user_id, founder_user_id from public.master_departments where is_active = true order by name asc`,
      ),
      client.query(
        `select id, name from public.master_payment_modes where is_active = true order by name asc`,
      ),
      client.query(
        `select id, user_id from public.master_finance_approvers where is_active = true order by is_primary desc, created_at asc`,
      ),
      client.query(
        `select id, name from public.master_expense_categories where is_active = true order by name asc`,
      ),
      client.query(`select id, name from public.master_products where is_active = true order by name asc`),
      client.query(`select id, name from public.master_locations where is_active = true order by name asc`),
      client.query(`select id from public.claims where id like 'CLAIM-ANA-%'`),
      client.query(`select claim_id from public.expense_details where claim_id like 'CLAIM-ANA-%'`),
      client.query(`select claim_id from public.advance_details where claim_id like 'CLAIM-ANA-%'`),
    ]);

  const users = usersResult.rows;
  const departments = departmentsResult.rows;
  const paymentModes = paymentModesResult.rows;
  const financeApprovers = financeApproversResult.rows;
  const expenseCategories = categoriesResult.rows;
  const products = productsResult.rows;
  const locations = locationsResult.rows;
  const existingClaimIds = new Set(existingClaimsResult.rows.map((row) => row.id));
  const existingExpenseDetailClaimIds = new Set(
    existingExpenseDetailsResult.rows.map((row) => row.claim_id),
  );
  const existingAdvanceDetailClaimIds = new Set(
    existingAdvanceDetailsResult.rows.map((row) => row.claim_id),
  );

  if (users.length < 2) {
    throw new Error("At least two active users are required to seed historical analytics claims.");
  }

  if (departments.length === 0) {
    throw new Error("No active master_departments rows found.");
  }

  if (paymentModes.length === 0) {
    throw new Error("No active master_payment_modes rows found.");
  }

  if (expenseCategories.length === 0 || products.length === 0 || locations.length === 0) {
    throw new Error(
      "Active master_expense_categories, master_products, and master_locations are required.",
    );
  }

  return {
    users,
    departments,
    paymentModes,
    financeApprovers,
    expenseCategories,
    products,
    locations,
    existingClaimIds,
    existingExpenseDetailClaimIds,
    existingAdvanceDetailClaimIds,
  };
}

function ensureSupabaseResult(result, label) {
  if (result.error) {
    throw new Error(`Failed fetching ${label}: ${result.error.message}`);
  }

  return result.data ?? [];
}

async function fetchReferencesWithSupabase(client) {
  const [usersResult, departmentsResult, paymentModesResult, financeApproversResult, categoriesResult, productsResult, locationsResult, existingClaimsResult, existingExpenseDetailsResult, existingAdvanceDetailsResult] =
    await Promise.all([
      client
        .from("users")
        .select("id, email, full_name, role")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      client
        .from("master_departments")
        .select("id, name, hod_user_id, founder_user_id")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      client
        .from("master_payment_modes")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      client
        .from("master_finance_approvers")
        .select("id, user_id")
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true }),
      client
        .from("master_expense_categories")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      client
        .from("master_products")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      client
        .from("master_locations")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      client.from("claims").select("id").like("id", "CLAIM-ANA-%"),
      client.from("expense_details").select("claim_id").like("claim_id", "CLAIM-ANA-%"),
      client.from("advance_details").select("claim_id").like("claim_id", "CLAIM-ANA-%"),
    ]);

  const users = ensureSupabaseResult(usersResult, "users");
  const departments = ensureSupabaseResult(departmentsResult, "master_departments");
  const paymentModes = ensureSupabaseResult(paymentModesResult, "master_payment_modes");
  const financeApprovers = ensureSupabaseResult(
    financeApproversResult,
    "master_finance_approvers",
  );
  const expenseCategories = ensureSupabaseResult(categoriesResult, "master_expense_categories");
  const products = ensureSupabaseResult(productsResult, "master_products");
  const locations = ensureSupabaseResult(locationsResult, "master_locations");
  const existingClaimRows = ensureSupabaseResult(existingClaimsResult, "claims");
  const existingExpenseDetailRows = ensureSupabaseResult(existingExpenseDetailsResult, "expense_details");
  const existingAdvanceDetailRows = ensureSupabaseResult(existingAdvanceDetailsResult, "advance_details");
  const existingClaimIds = new Set(existingClaimRows.map((row) => row.id));
  const existingExpenseDetailClaimIds = new Set(existingExpenseDetailRows.map((row) => row.claim_id));
  const existingAdvanceDetailClaimIds = new Set(existingAdvanceDetailRows.map((row) => row.claim_id));

  if (users.length < 2) {
    throw new Error("At least two active users are required to seed historical analytics claims.");
  }

  if (departments.length === 0) {
    throw new Error("No active master_departments rows found.");
  }

  if (paymentModes.length === 0) {
    throw new Error("No active master_payment_modes rows found.");
  }

  if (expenseCategories.length === 0 || products.length === 0 || locations.length === 0) {
    throw new Error(
      "Active master_expense_categories, master_products, and master_locations are required.",
    );
  }

  return {
    users,
    departments,
    paymentModes,
    financeApprovers,
    expenseCategories,
    products,
    locations,
    existingClaimIds,
    existingExpenseDetailClaimIds,
    existingAdvanceDetailClaimIds,
  };
}

function chooseSubmitter(users, random) {
  const submitterCandidates = users.filter((user) => {
    const role = normalizeRole(user.role);
    return role === "employee" || role === "hod" || role === "founder";
  });

  return pickOne(submitterCandidates.length > 0 ? submitterCandidates : users, random);
}

function chooseOnBehalfUser(users, submitterId, random) {
  const candidates = users.filter((user) => user.id !== submitterId);
  if (candidates.length === 0) {
    return null;
  }

  return pickOne(candidates, random);
}

function resolveDepartmentForSubmitter(departments, submitter, random) {
  if (submitter.department_id) {
    const byId = departments.find((department) => department.id === submitter.department_id);
    if (byId) {
      return byId;
    }
  }

  const directAssignment = departments.find(
    (department) => department.hod_user_id === submitter.id || department.founder_user_id === submitter.id,
  );

  if (directAssignment) {
    return directAssignment;
  }

  return pickOne(departments, random);
}

function resolveApproverForDepartment(department) {
  return department.hod_user_id ?? department.founder_user_id;
}

function pickPaymentModeByDetail(paymentModes, detailType, random) {
  const candidates = paymentModes.filter((paymentMode) => {
    const isAdvanceMode = ADVANCE_PAYMENT_MODES.has(String(paymentMode.name).toLowerCase());
    return detailType === "advance" ? isAdvanceMode : !isAdvanceMode;
  });

  if (candidates.length === 0) {
    return pickOne(paymentModes, random);
  }

  return pickOne(candidates, random);
}

function buildTimeline(status, submittedAt, random) {
  const hodActionAt = addHours(submittedAt, 24 + Math.floor(random() * 72));
  const financeActionAt = addHours(hodActionAt, 24 + Math.floor(random() * 72));

  if (status === STATUS_SUBMITTED) {
    return {
      submittedAt,
      hodActionAt: null,
      financeActionAt: null,
      rejectionReason: null,
      isResubmissionAllowed: false,
      rejectedAtFinance: false,
    };
  }

  if (status === STATUS_HOD_APPROVED) {
    return {
      submittedAt,
      hodActionAt,
      financeActionAt: null,
      rejectionReason: null,
      isResubmissionAllowed: false,
      rejectedAtFinance: false,
    };
  }

  if (status === STATUS_FINANCE_APPROVED || status === STATUS_PAYMENT_DONE) {
    return {
      submittedAt,
      hodActionAt,
      financeActionAt,
      rejectionReason: null,
      isResubmissionAllowed: false,
      rejectedAtFinance: false,
    };
  }

  const rejectedAtFinance = random() > 0.45;

  return {
    submittedAt,
    hodActionAt,
    financeActionAt: rejectedAtFinance ? financeActionAt : null,
    rejectionReason: rejectedAtFinance
      ? "Finance review rejected due to policy mismatch"
      : "L1 rejected due to insufficient supporting details",
    isResubmissionAllowed: random() > 0.35,
    rejectedAtFinance,
  };
}

function buildClaims({ references, count }) {
  const random = makeSeededRandom(20260401);
  const claims = [];
  const now = new Date();
  const maxDaysBack = DEFAULT_MONTH_WINDOW * 30;

  for (let index = 0; index < count; index += 1) {
    const status = resolveStatusByIndex(index, count);
    const daysBack = Math.floor(random() * maxDaysBack);
    const submittedAt = dayOffsetDate(daysBack, random);
    const claimId = buildClaimId(index, submittedAt);

    const submitter = chooseSubmitter(references.users, random);
    const department = resolveDepartmentForSubmitter(references.departments, submitter, random);
    const assignedL1ApproverId = resolveApproverForDepartment(department);

    if (!assignedL1ApproverId) {
      continue;
    }

    const submissionType = random() > 0.7 ? "On Behalf" : "Self";
    const onBehalfUser =
      submissionType === "On Behalf"
        ? chooseOnBehalfUser(references.users, submitter.id, random)
        : null;

    const onBehalfEmployeeCode = onBehalfUser
      ? toEmployeeCode("EMP", 5000 + index)
      : null;

    const detailType = random() > 0.2 ? "expense" : "advance";
    const paymentMode = pickPaymentModeByDetail(references.paymentModes, detailType, random);

    const timeline = buildTimeline(status, submittedAt, random);
    const preferredFinanceUserId = references.financeApprovers[0]?.user_id ?? null;
    const assignedL2ApproverId =
      status === STATUS_SUBMITTED || (status === STATUS_REJECTED && !timeline.rejectedAtFinance)
        ? null
        : resolveFinanceApproverId(references.financeApprovers, preferredFinanceUserId);

    const employeeId = toEmployeeCode("EMP", 1000 + index);
    const ccEmails = buildCcEmails(references.users, random);

    const billNo = `BILL-ANA-${String(index + 1).padStart(4, "0")}`;
    const transactionId = `TXN-ANA-${String(index + 1).padStart(4, "0")}`;
    const transactionDate = new Date(submittedAt);
    transactionDate.setUTCDate(transactionDate.getUTCDate() - (2 + Math.floor(random() * 4)));

    const basicAmount = toAmount(1500 + random() * 48500);
    const gstApplicable = random() > 0.58;
    const cgstAmount = gstApplicable ? toAmount(basicAmount * 0.09) : 0;
    const sgstAmount = gstApplicable ? toAmount(basicAmount * 0.09) : 0;
    const igstAmount = 0;
    const totalAmount = toAmount(basicAmount + cgstAmount + sgstAmount + igstAmount);

    const requestedAmount = toAmount(3000 + random() * 42000);

    const claimRecord = {
      id: claimId,
      status,
      submission_type: submissionType,
      detail_type: detailType,
      submitted_by: submitter.id,
      on_behalf_email: onBehalfUser?.email ?? null,
      on_behalf_employee_code: onBehalfEmployeeCode,
      on_behalf_of_id: onBehalfUser?.id ?? submitter.id,
      department_id: department.id,
      payment_mode_id: paymentMode.id,
      assigned_l1_approver_id: assignedL1ApproverId,
      assigned_l2_approver_id: assignedL2ApproverId,
      employee_id: employeeId,
      cc_emails: ccEmails,
      rejection_reason: timeline.rejectionReason,
      is_resubmission_allowed: timeline.isResubmissionAllowed,
      submitted_at: timeline.submittedAt,
      hod_action_at: timeline.hodActionAt,
      finance_action_at: timeline.financeActionAt,
      created_at: timeline.submittedAt,
      updated_at:
        timeline.financeActionAt ?? timeline.hodActionAt ?? addHours(timeline.submittedAt, 3),
      expense_detail:
        detailType === "expense"
          ? {
              bill_no: billNo,
              transaction_id: transactionId,
              expense_category_id: pickOne(references.expenseCategories, random).id,
              product_id: pickOne(references.products, random).id,
              location_id: pickOne(references.locations, random).id,
              is_gst_applicable: gstApplicable,
              gst_number: gstApplicable ? `29ABCDE${String(1000 + index)}F1Z5` : null,
              transaction_date: transactionDate,
              basic_amount: basicAmount,
              cgst_amount: cgstAmount,
              sgst_amount: sgstAmount,
              igst_amount: igstAmount,
              total_amount: totalAmount,
              currency_code: "INR",
              vendor_name: `Vendor ${String(index + 1).padStart(2, "0")}`,
              purpose: buildPurpose("expense", random),
              remarks: random() > 0.6 ? "Historical analytics seed" : null,
              receipt_file_path: null,
              bank_statement_file_path: null,
              people_involved: null,
              created_at: timeline.submittedAt,
              updated_at:
                timeline.financeActionAt ?? timeline.hodActionAt ?? addHours(timeline.submittedAt, 3),
            }
          : null,
      advance_detail:
        detailType === "advance"
          ? {
              requested_amount: requestedAmount,
              budget_month: submittedAt.getUTCMonth() + 1,
              budget_year: submittedAt.getUTCFullYear(),
              expected_usage_date: addHours(submittedAt, 24 * (3 + Math.floor(random() * 7))),
              purpose: buildPurpose("advance", random),
              product_id: pickOne(references.products, random).id,
              location_id: pickOne(references.locations, random).id,
              supporting_document_path: null,
              remarks: random() > 0.55 ? "Historical analytics seed" : null,
              created_at: timeline.submittedAt,
              updated_at:
                timeline.financeActionAt ?? timeline.hodActionAt ?? addHours(timeline.submittedAt, 3),
            }
          : null,
    };

    claims.push(claimRecord);
  }

  // Keep generated data strictly historical.
  return claims.filter((claim) => claim.submitted_at <= now);
}

async function insertClaimsWithPg(client, claims, references) {
  let insertedClaims = 0;
  let insertedExpenseDetails = 0;
  let insertedAdvanceDetails = 0;

  const existingClaimIds = new Set(references.existingClaimIds);
  const existingExpenseDetailClaimIds = new Set(references.existingExpenseDetailClaimIds);
  const existingAdvanceDetailClaimIds = new Set(references.existingAdvanceDetailClaimIds);

  for (const claim of claims) {
    if (!existingClaimIds.has(claim.id)) {
      await client.query(
        `
          insert into public.claims (
            id,
            status,
            submission_type,
            detail_type,
            submitted_by,
            on_behalf_email,
            on_behalf_employee_code,
            department_id,
            payment_mode_id,
            assigned_l1_approver_id,
            assigned_l2_approver_id,
            submitted_at,
            is_active,
            created_at,
            updated_at,
            employee_id,
            cc_emails,
            rejection_reason,
            on_behalf_of_id,
            hod_action_at,
            finance_action_at,
            is_resubmission_allowed
          )
          values (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
            true,$13,$14,$15,$16,$17,$18,$19,$20,$21
          )
        `,
        [
          claim.id,
          claim.status,
          claim.submission_type,
          claim.detail_type,
          claim.submitted_by,
          claim.on_behalf_email,
          claim.on_behalf_employee_code,
          claim.department_id,
          claim.payment_mode_id,
          claim.assigned_l1_approver_id,
          claim.assigned_l2_approver_id,
          claim.submitted_at,
          claim.created_at,
          claim.updated_at,
          claim.employee_id,
          claim.cc_emails,
          claim.rejection_reason,
          claim.on_behalf_of_id,
          claim.hod_action_at,
          claim.finance_action_at,
          claim.is_resubmission_allowed,
        ],
      );

      existingClaimIds.add(claim.id);
      insertedClaims += 1;
    }

    if (claim.expense_detail && !existingExpenseDetailClaimIds.has(claim.id)) {
      await client.query(
        `
          insert into public.expense_details (
            claim_id,
            bill_no,
            transaction_id,
            expense_category_id,
            product_id,
            location_id,
            is_gst_applicable,
            gst_number,
            transaction_date,
            basic_amount,
            currency_code,
            vendor_name,
            receipt_file_path,
            remarks,
            is_active,
            created_at,
            updated_at,
            bank_statement_file_path,
            people_involved,
            purpose,
            cgst_amount,
            sgst_amount,
            igst_amount
          )
          values (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
            $13,$14,true,$15,$16,$17,$18,$19,$20,$21,$22
          )
        `,
        [
          claim.id,
          claim.expense_detail.bill_no,
          claim.expense_detail.transaction_id,
          claim.expense_detail.expense_category_id,
          claim.expense_detail.product_id,
          claim.expense_detail.location_id,
          claim.expense_detail.is_gst_applicable,
          claim.expense_detail.gst_number,
          claim.expense_detail.transaction_date,
          claim.expense_detail.basic_amount,
          claim.expense_detail.currency_code,
          claim.expense_detail.vendor_name,
          claim.expense_detail.receipt_file_path,
          claim.expense_detail.remarks,
          claim.expense_detail.created_at,
          claim.expense_detail.updated_at,
          claim.expense_detail.bank_statement_file_path,
          claim.expense_detail.people_involved,
          claim.expense_detail.purpose,
          claim.expense_detail.cgst_amount,
          claim.expense_detail.sgst_amount,
          claim.expense_detail.igst_amount,
        ],
      );

      existingExpenseDetailClaimIds.add(claim.id);
      insertedExpenseDetails += 1;
    }

    if (claim.advance_detail && !existingAdvanceDetailClaimIds.has(claim.id)) {
      await client.query(
        `
          insert into public.advance_details (
            claim_id,
            requested_amount,
            budget_month,
            budget_year,
            expected_usage_date,
            purpose,
            product_id,
            location_id,
            supporting_document_path,
            remarks,
            is_active,
            created_at,
            updated_at
          )
          values (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12
          )
        `,
        [
          claim.id,
          claim.advance_detail.requested_amount,
          claim.advance_detail.budget_month,
          claim.advance_detail.budget_year,
          claim.advance_detail.expected_usage_date,
          claim.advance_detail.purpose,
          claim.advance_detail.product_id,
          claim.advance_detail.location_id,
          claim.advance_detail.supporting_document_path,
          claim.advance_detail.remarks,
          claim.advance_detail.created_at,
          claim.advance_detail.updated_at,
        ],
      );

      existingAdvanceDetailClaimIds.add(claim.id);
      insertedAdvanceDetails += 1;
    }
  }

  return {
    insertedClaims,
    insertedExpenseDetails,
    insertedAdvanceDetails,
  };
}

function toIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

async function insertClaimsWithSupabase(client, claims, references) {
  let insertedClaims = 0;
  let insertedExpenseDetails = 0;
  let insertedAdvanceDetails = 0;

  const existingClaimIds = new Set(references.existingClaimIds);
  const existingExpenseDetailClaimIds = new Set(references.existingExpenseDetailClaimIds);
  const existingAdvanceDetailClaimIds = new Set(references.existingAdvanceDetailClaimIds);

  for (const claim of claims) {
    const { expense_detail: expenseDetail, advance_detail: advanceDetail, ...claimPayload } = claim;

    if (!existingClaimIds.has(claim.id)) {
      const claimInsertPayload = {
        ...claimPayload,
        is_active: true,
        submitted_at: toIsoTimestamp(claimPayload.submitted_at),
        hod_action_at: toIsoTimestamp(claimPayload.hod_action_at),
        finance_action_at: toIsoTimestamp(claimPayload.finance_action_at),
        created_at: toIsoTimestamp(claimPayload.created_at),
        updated_at: toIsoTimestamp(claimPayload.updated_at),
      };

      const claimInsertResult = await client.from("claims").insert(claimInsertPayload);
      if (claimInsertResult.error) {
        throw new Error(`Failed inserting claim ${claim.id}: ${claimInsertResult.error.message}`);
      }

      existingClaimIds.add(claim.id);
      insertedClaims += 1;
    }

    if (expenseDetail && !existingExpenseDetailClaimIds.has(claim.id)) {
      const { total_amount: _ignoredTotalAmount, ...expenseDetailPayload } = expenseDetail;
      void _ignoredTotalAmount;

      const expenseInsertPayload = {
        ...expenseDetailPayload,
        claim_id: claim.id,
        is_active: true,
        transaction_date: toIsoDate(expenseDetail.transaction_date),
        created_at: toIsoTimestamp(expenseDetail.created_at),
        updated_at: toIsoTimestamp(expenseDetail.updated_at),
      };

      const expenseInsertResult = await client.from("expense_details").insert(expenseInsertPayload);
      if (expenseInsertResult.error) {
        throw new Error(
          `Failed inserting expense detail for ${claim.id}: ${expenseInsertResult.error.message}`,
        );
      }

      existingExpenseDetailClaimIds.add(claim.id);
      insertedExpenseDetails += 1;
    }

    if (advanceDetail && !existingAdvanceDetailClaimIds.has(claim.id)) {
      const advanceInsertPayload = {
        ...advanceDetail,
        claim_id: claim.id,
        is_active: true,
        expected_usage_date: toIsoDate(advanceDetail.expected_usage_date),
        created_at: toIsoTimestamp(advanceDetail.created_at),
        updated_at: toIsoTimestamp(advanceDetail.updated_at),
      };

      const advanceInsertResult = await client.from("advance_details").insert(advanceInsertPayload);
      if (advanceInsertResult.error) {
        throw new Error(
          `Failed inserting advance detail for ${claim.id}: ${advanceInsertResult.error.message}`,
        );
      }

      existingAdvanceDetailClaimIds.add(claim.id);
      insertedAdvanceDetails += 1;
    }
  }

  return {
    insertedClaims,
    insertedExpenseDetails,
    insertedAdvanceDetails,
  };
}

function summarize(claims) {
  const byStatus = new Map();
  const byPaymentType = {
    expense: 0,
    advance: 0,
  };

  for (const claim of claims) {
    byStatus.set(claim.status, (byStatus.get(claim.status) ?? 0) + 1);
    byPaymentType[claim.detail_type] += 1;
  }

  return {
    byStatus,
    byPaymentType,
  };
}

async function main() {
  await loadEnvFiles();
  const connectionSettings = resolveConnectionSettings();

  console.log(`[seed-historical-analytics] Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(`[seed-historical-analytics] Target claims: ${COUNT}`);

  if (connectionSettings.mode === "pg") {
    console.log("[seed-historical-analytics] Connection mode: postgres");
  } else {
    console.log("[seed-historical-analytics] Connection mode: supabase-service-role");
  }

  const pgClient =
    connectionSettings.mode === "pg"
      ? new pg.Client({
          connectionString: connectionSettings.connectionString,
          ssl: { rejectUnauthorized: false },
        })
      : null;

  const supabaseClient =
    connectionSettings.mode === "supabase"
      ? createClient(connectionSettings.supabaseUrl, connectionSettings.serviceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        })
      : null;

  if (pgClient) {
    await pgClient.connect();
  }

  try {
    const references = pgClient
      ? await fetchReferencesWithPg(pgClient)
      : await fetchReferencesWithSupabase(supabaseClient);

    const claims = buildClaims({ references, count: COUNT });
    const { byStatus, byPaymentType } = summarize(claims);

    console.log(`[seed-historical-analytics] Prepared claims: ${claims.length}`);
    console.log(
      `[seed-historical-analytics] Detail split: expense=${byPaymentType.expense}, advance=${byPaymentType.advance}`,
    );

    for (const [status, count] of byStatus.entries()) {
      console.log(`[seed-historical-analytics] Status ${status}: ${count}`);
    }

    if (!APPLY) {
      console.log(
        "[seed-historical-analytics] Dry-run complete. Re-run with --apply to insert records.",
      );
      return;
    }

    if (claims.length === 0) {
      console.log("[seed-historical-analytics] No new claim IDs to insert. Exiting.");
      return;
    }

    const result = pgClient
      ? await (async () => {
          await pgClient.query("begin");
          const inserted = await insertClaimsWithPg(pgClient, claims, references);
          await pgClient.query("commit");
          return inserted;
        })()
      : await insertClaimsWithSupabase(supabaseClient, claims, references);

    console.log(`[seed-historical-analytics] Inserted claims: ${result.insertedClaims}`);
    console.log(
      `[seed-historical-analytics] Inserted expense details: ${result.insertedExpenseDetails}`,
    );
    console.log(
      `[seed-historical-analytics] Inserted advance details: ${result.insertedAdvanceDetails}`,
    );
  } catch (error) {
    if (pgClient) {
      try {
        await pgClient.query("rollback");
      } catch {
        // no-op
      }
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[seed-historical-analytics] Failed: ${message}`);
    process.exitCode = 1;
  } finally {
    if (pgClient) {
      await pgClient.end();
    }
  }
}

await main();
