import { NextResponse } from "next/server";
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  RetryError,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createGoogle } from "@ai-sdk/google";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { buildSystemPrompt } from "@/modules/faq/data/system-prompt";

export const maxDuration = 30;

const google = createGoogle({ apiKey: serverEnv.GEMINI_API_KEY });

// Hardcoded rather than sourced from GEMINI_MODEL — that env var is shared
// with other Gemini use cases (e.g. receipt parsing) which need to stay on
// a different model independently of this chatbot.
const CHAT_MODEL = "gemini-2.5-flash";

// Keep only the most recent turns sent to the model — most Q&A here is
// self-contained, and this caps worst-case token growth in long sessions.
const MAX_HISTORY_MESSAGES = 12;

// The system prompt (~5k tokens) is reused verbatim on every call, so it's a
// strong candidate for Gemini's automatic prefix caching. Logged here (not
// exposed to the client) to confirm cacheReadTokens > 0 in practice.
function logUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
}): void {
  logger.info("finance_assistant.usage", {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
  });
}

// Basic per-instance sliding-window rate limit, keyed by user id. Not
// distributed (resets per server instance), but stops accidental loops/spam
// from burning through API quota without affecting normal usage.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 15;
const requestTimestampsByUser = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestTimestampsByUser.get(userId) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimestampsByUser.set(userId, timestamps);
    return true;
  }

  timestamps.push(now);
  requestTimestampsByUser.set(userId, timestamps);
  return false;
}

function unwrapCause(error: unknown): unknown {
  return RetryError.isInstance(error) ? error.lastError : error;
}

function isRateLimitError(error: unknown): boolean {
  const cause = unwrapCause(error);
  return (
    (APICallError.isInstance(cause) && cause.statusCode === 429) ||
    (cause instanceof Error && /quota|rate.?limit/i.test(cause.message))
  );
}

function isModelOverloadedError(error: unknown): boolean {
  const cause = unwrapCause(error);
  return (
    (APICallError.isInstance(cause) && cause.statusCode === 503) ||
    (cause instanceof Error && /high demand|overloaded|unavailable/i.test(cause.message))
  );
}

function toErrorMessage(error: unknown): string {
  if (isRateLimitError(error)) {
    return "The assistant has reached its usage limit for now. Please try again later.";
  }
  if (isModelOverloadedError(error)) {
    return "The assistant is temporarily overloaded on Google's side. Please try again in a moment.";
  }
  return "Something went wrong. Please try again.";
}

export async function POST(request: Request) {
  const currentUserResult = await getCachedCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isRateLimited(currentUserResult.user.id)) {
    return NextResponse.json(
      { error: "You're sending messages too quickly. Please wait a moment and try again." },
      { status: 429 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await request.json();
  const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);

  const result = streamText({
    model: google(CHAT_MODEL),
    instructions: buildSystemPrompt(),
    messages: await convertToModelMessages(recentMessages),
    maxOutputTokens: 500,
    // This is a simple KB-lookup/instruction-following task, not a reasoning
    // task — disable Gemini's extended thinking so its token budget isn't
    // silently consumed by internal reasoning before the model can respond.
    providerOptions: {
      google: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    onEnd: ({ usage }) => logUsage(usage),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: toErrorMessage,
    }),
  });
}
