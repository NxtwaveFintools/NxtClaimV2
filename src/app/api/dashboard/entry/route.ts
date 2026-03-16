import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/core/http/with-auth";
import { createSuccessResponse } from "@/types/api";

const dashboardEntryHandler = async (
  _request: NextRequest,
  context: { correlationId: string; userId: string; email: string },
) => {
  return NextResponse.json(
    createSuccessResponse(
      {
        message: "Dashboard access verified",
        user: {
          id: context.userId,
          email: context.email,
        },
      },
      context.correlationId,
    ),
    { status: 200 },
  );
};

export const GET = withAuth(dashboardEntryHandler);
