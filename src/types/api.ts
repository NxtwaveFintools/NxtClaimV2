export type ApiError = {
  code: string;
  message: string;
};

export type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
  meta?: {
    correlationId?: string;
  };
};

export function createSuccessResponse<T>(data: T, correlationId?: string): ApiResponse<T> {
  return {
    data,
    error: null,
    meta: correlationId ? { correlationId } : undefined,
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  correlationId?: string,
): ApiResponse<null> {
  return {
    data: null,
    error: { code, message },
    meta: correlationId ? { correlationId } : undefined,
  };
}
