"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { acceptPolicyAction } from "@/modules/policies/actions";
import type { PolicyGateState } from "@/modules/policies/server/get-policy-gate-state";

type PolicyGateProps = {
  initialState: PolicyGateState;
  children: React.ReactNode;
};

function formatAcceptedDate(value: string | null): string {
  if (!value) {
    return "Not accepted yet";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function PolicyGate({ initialState, children }: PolicyGateProps) {
  const router = useRouter();
  const [acceptanceOverride, setAcceptanceOverride] = useState<{
    policyId: string | null;
    accepted: boolean;
    acceptedAt: string | null;
  } | null>(null);
  const [localMessage, setLocalMessage] = useState<{
    policyId: string | null;
    value: string | null;
  } | null>(null);
  const [confirmationState, setConfirmationState] = useState<{
    policyId: string | null;
    checked: boolean;
  }>(() => ({
    policyId: initialState.policy?.id ?? null,
    checked: false,
  }));
  const [isAccepting, startAcceptTransition] = useTransition();

  const policy = initialState.policy;
  const policyId = policy?.id ?? null;

  const hasAcceptanceOverride = acceptanceOverride?.policyId === policyId;
  const accepted = hasAcceptanceOverride ? acceptanceOverride.accepted : initialState.accepted;
  const acceptedAt = hasAcceptanceOverride
    ? acceptanceOverride.acceptedAt
    : initialState.acceptedAt;

  const hasMessageOverride = localMessage?.policyId === policyId;
  const message = hasMessageOverride ? localMessage.value : initialState.errorMessage;

  const hasConfirmedAcceptance =
    confirmationState.policyId === policyId ? confirmationState.checked : false;

  const shouldBlock = initialState.shouldGate && !accepted;
  const showOverlay = shouldBlock;

  useEffect(() => {
    if (!showOverlay) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showOverlay]);

  const handleAccept = () => {
    if (!policy?.id || isAccepting) {
      return;
    }

    const currentPolicyId = policy.id;

    startAcceptTransition(async () => {
      const result = await acceptPolicyAction(currentPolicyId);

      if (!result.ok) {
        setLocalMessage({
          policyId: currentPolicyId,
          value: result.message ?? "Unable to record policy acceptance.",
        });
        return;
      }

      const nextAcceptedAt = result.acceptedAt ?? new Date().toISOString();
      setAcceptanceOverride({
        policyId: currentPolicyId,
        accepted: true,
        acceptedAt: nextAcceptedAt,
      });
      setLocalMessage({ policyId: currentPolicyId, value: null });
      setConfirmationState({ policyId: currentPolicyId, checked: false });
      router.refresh();
    });
  };

  return (
    <>
      {children}

      {showOverlay ? (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-zinc-950/65 backdrop-blur-sm">
          <div className="mx-4 flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl sm:h-[90vh] dark:border-zinc-800 dark:bg-zinc-950">
            <header className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-800/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
                  Mandatory Acceptance Required
                </p>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Company Policy Gate
                </h2>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-5">
              {policy ? (
                <article className="flex h-full min-h-0 flex-col gap-4">
                  <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <iframe
                      src={policy.fileUrl}
                      title={`Company policy ${policy.versionName}`}
                      className="h-[48vh] w-full rounded-lg border-none sm:h-[56vh] md:h-[60vh]"
                      onError={() => {
                        setLocalMessage({
                          policyId,
                          value: "Unable to load policy PDF. Please try again.",
                        });
                      }}
                    />
                  </div>
                  {acceptedAt ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Last accepted: {formatAcceptedDate(acceptedAt)}
                    </p>
                  ) : null}
                </article>
              ) : (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                  {message ?? "No active company policy is available. Please contact admin."}
                </p>
              )}

              {message ? (
                <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
                  {message}
                </p>
              ) : null}
            </div>

            <footer className="border-t border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="ml-auto flex w-fit flex-col items-end gap-3">
                <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={hasConfirmedAcceptance}
                    onChange={(event) => {
                      setConfirmationState({
                        policyId,
                        checked: event.currentTarget.checked,
                      });
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                  />
                  <span>I have read and agree to this company policy.</span>
                </label>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={!policy || isAccepting || !hasConfirmedAcceptance}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAccepting ? "Recording acceptance..." : "I Accept"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
