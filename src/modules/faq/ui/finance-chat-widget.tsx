"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { ROUTES } from "@/core/config/route-registry";
import { cn } from "@/lib/cn";

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-black/5 px-1 py-0.5 text-[0.85em] dark:bg-white/10">
      {children}
    </code>
  ),
};

const HIDDEN_PATHS = new Set(["/", ROUTES.login, ROUTES.auth.callback]);

const CLAIM_DETAIL_PATH_PATTERN = /^\/dashboard\/claims\/(?!hod-pending$)[^/]+$/;

const SUGGESTED_QUESTIONS = [
  "How do I raise a claim?",
  "Where can I see my claims?",
  "What documents do I need?",
  "What are the petty cash rules?",
];

// Answers to the suggested chips above, taken verbatim from the knowledge base
// in system-prompt.ts. Answered locally (no API call) since these are fixed,
// pre-verified facts — instant for the user and free.
const INSTANT_ANSWERS: Record<string, string> = {
  "How do I raise a claim?":
    "To raise a claim: go to New Claim, select your Department and Payment Mode, choose the Expense Category (for reimbursements), and upload your invoice/bill. You can use Auto-fill with AI to prefill the details, then review and submit. Track it afterward under Dashboard → My Claims.",
  "Where can I see my claims?":
    "You can view all your submitted claims, including their status and history, under Dashboard → My Claims.",
  "What documents do I need?":
    "You'll need the original receipt or invoice, plus payment proof such as a bank record, UPI confirmation, or digital receipt. For overseas subscriptions, you also need a bank statement showing the payment in INR matching the invoice amount.",
  "What are the petty cash rules?":
    "Here are the rules for petty cash:\n- **Submission Timeline:** Petty cash settlements must be submitted within 3 working days from the date of spend.\n- **Processing:** Petty cash claims are processed via Volopay within 4 working days from HOD approval.\n- **Disbursement:** Petty cash is issued strictly via the Volopay digital wallet and will not be transferred to personal bank accounts.\n- **Settlement Requirement:** You must settle all previous petty cash expenses before requesting a new advance.\n- **Required Documentation:** All claims must include original receipts/invoices and explicit proof of payment.\n- **Covered Expenses:** Petty cash can cover food, fuel, travel, and accommodation expenses.\n- **Non-compliance:** Failure to settle petty cash within the deadline may result in salary hold and impact performance appraisals.",
};

function AssistantAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-sky-500",
        className,
      )}
      aria-hidden="true"
    >
      <Sparkles className="h-3.5 w-3.5 text-white" />
    </div>
  );
}

export function FinanceChatWidget() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/finance-assistant" }),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  if (!pathname || HIDDEN_PATHS.has(pathname)) {
    return null;
  }

  const isOverStickyActionBar = CLAIM_DETAIL_PATH_PATTERN.test(pathname);
  const buttonBottom = isOverStickyActionBar ? "bottom-24" : "bottom-6";
  const panelBottom = isOverStickyActionBar ? "bottom-40" : "bottom-24";
  const isBusy = status === "submitted" || status === "streaming";
  const canSubmit = status === "ready" || status === "error";

  function ask(question: string) {
    if (!canSubmit) {
      return;
    }
    setInput("");

    const instantAnswer = INSTANT_ANSWERS[question];
    if (instantAnswer) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: question }] },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text: instantAnswer }],
        },
      ]);
      return;
    }

    sendMessage({ text: question });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || !canSubmit) {
      return;
    }
    ask(input);
  }

  return (
    <>
      {isOpen && (
        <div
          className={`fixed right-6 ${panelBottom} z-50 flex h-[520px] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900`}
          role="dialog"
          aria-label="Finance Assistant chat"
        >
          <header className="flex items-center justify-between bg-gradient-to-br from-indigo-600 to-sky-600 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <AssistantAvatar className="h-8 w-8 ring-2 ring-white/25" />
              <div>
                <p className="text-sm font-semibold text-white">NxtClaim Assistant</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
              className="rounded-full p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div ref={scrollRef} className="nxt-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="chat-message-in space-y-3">
                <div className="flex items-start gap-2">
                  <AssistantAvatar className="mt-0.5 h-7 w-7" />
                  <p className="max-w-[85%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    Hi! I&apos;m your NxtClaim Support Assistant. How can I help you today?
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 pl-9">
                  {SUGGESTED_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => ask(question)}
                      className="rounded-full border border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "chat-message-in flex items-start gap-2",
                  message.role === "user" && "justify-end",
                )}
              >
                {message.role === "assistant" && <AssistantAvatar className="mt-0.5 h-7 w-7" />}
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
                  )}
                >
                  {message.parts.map((part, index) => {
                    if (part.type !== "text") {
                      return null;
                    }
                    return message.role === "assistant" ? (
                      <ReactMarkdown key={index} components={MARKDOWN_COMPONENTS}>
                        {part.text}
                      </ReactMarkdown>
                    ) : (
                      <span key={index}>{part.text}</span>
                    );
                  })}
                </div>
              </div>
            ))}
            {isBusy && (
              <div className="chat-message-in flex items-start gap-2">
                <AssistantAvatar className="mt-0.5 h-7 w-7" />
                <div className="flex items-center gap-1 rounded-2xl bg-zinc-100 px-3.5 py-3 dark:bg-zinc-800">
                  <span
                    className="h-1.5 w-1.5 motion-safe:animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 motion-safe:animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"
                    style={{ animationDelay: "120ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 motion-safe:animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"
                    style={{ animationDelay: "240ms" }}
                  />
                </div>
              </div>
            )}
            {status === "error" && (
              <div className="chat-message-in max-w-[85%] rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                {error?.message || "Something went wrong. Please try again."}
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={!canSubmit}
              placeholder="Ask a question..."
              aria-label="Ask the Finance Assistant a question"
              className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={!canSubmit || !input.trim()}
              aria-label="Send message"
              className="rounded-full bg-indigo-600 p-2.5 text-white transition-colors hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-label={isOpen ? "Close Finance Assistant" : "Open Finance Assistant"}
        className={`group fixed right-6 ${buttonBottom} z-50 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all duration-200 hover:scale-105 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400`}
      >
        {!isOpen && (
          <span
            className="absolute inset-0 -z-10 rounded-full bg-indigo-400/40 animate-ping"
            aria-hidden="true"
          />
        )}
        {isOpen ? (
          <X className="h-4.5 w-4.5" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-4.5 w-4.5" aria-hidden="true" />
        )}
        <span>{isOpen ? "Close" : "Help"}</span>
      </button>
    </>
  );
}
