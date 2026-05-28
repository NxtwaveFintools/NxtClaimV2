import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { getCachedRequestAuthUser } from "@/modules/auth/server/get-request-auth-user";

const SIGNED_URL_EXPIRY_SECONDS = 60;
const EVIDENCE_BUCKET = "claims";

type EvidenceType = "bill" | "bank_statement";
type RouteContext = {
  params: Promise<{ id: string }>;
};

function isEvidenceType(value: string | null): value is EvidenceType {
  return value === "bill" || value === "bank_statement";
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await getCachedRequestAuthUser();
  if (auth.errorMessage) {
    return NextResponse.json({ error: auth.errorMessage }, { status: 500 });
  }
  if (!auth.user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const evidenceType =
    request.nextUrl?.searchParams.get("type") ?? new URL(request.url).searchParams.get("type");
  if (!isEvidenceType(evidenceType)) {
    return NextResponse.json({ error: "Invalid evidence type" }, { status: 400 });
  }

  const { id: claimId } = await context.params;
  const supabase = getServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("expense_details")
    .select("receipt_file_path, bank_statement_file_path")
    .eq("claim_id", claimId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }

  const row = data as { receipt_file_path: string | null; bank_statement_file_path: string | null };
  const path = evidenceType === "bill" ? row.receipt_file_path : row.bank_statement_file_path;
  if (!path) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return NextResponse.json({ error: "Unable to open evidence" }, { status: 500 });
  }

  return NextResponse.redirect(signedUrlData.signedUrl);
}
