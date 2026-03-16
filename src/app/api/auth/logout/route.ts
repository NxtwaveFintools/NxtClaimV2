import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/core/http/with-auth";
import { createSuccessResponse } from "@/types/api";

const logoutHandler = async (_request: NextRequest, context: { correlationId: string }) => {
  return NextResponse.json(createSuccessResponse({ loggedOut: true }, context.correlationId), {
    status: 200,
  });
};

export const POST = withAuth(logoutHandler);
