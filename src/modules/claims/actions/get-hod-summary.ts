"use server";

import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { getCachedPendingApprovalsViewerContext } from "@/modules/claims/server/get-pending-approvals-viewer-context";

export type HodSummaryEmployeeRow = {
  employee_id: string;
  employee_name: string;
  amount: number;
  claim_count: number;
};

export type HodSummaryLeaderboard = {
  rows: HodSummaryEmployeeRow[];
  others_total: number;
  others_count: number;
  grand_total: number;
};

export type HodSummaryCategoryRow = {
  category_id: string;
  category_name: string;
  amount: number;
};

export type HodSummaryCategoryLeaderboard = {
  rows: HodSummaryCategoryRow[];
  others_total: number;
  others_count: number;
  grand_total: number;
};

export type HodPendingSummaryData = {
  top_expense_employees: HodSummaryLeaderboard;
  top_advance_employees: HodSummaryLeaderboard;
  top_expense_categories: HodSummaryCategoryLeaderboard;
};

export async function getHodPendingSummaryAction(
  targetStatus: string | null,
): Promise<HodPendingSummaryData | null> {
  const { user } = await getCachedCurrentUser();
  if (!user?.id) return null;

  const viewerContext = await getCachedPendingApprovalsViewerContext(user.id);
  if (viewerContext.activeScope !== "l1") return null;

  // Normalize empty/sentinel values to null so the RPC bypasses the status filter
  const normalizedStatus =
    !targetStatus || targetStatus.toLowerCase() === "all" ? null : targetStatus;

  const supabase = getServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("get_hod_pending_summary", {
    p_hod_user_id: user.id,
    p_target_status: normalizedStatus,
  });

  if (error || !data) return null;

  return data as HodPendingSummaryData;
}
