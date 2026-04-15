"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { forceUpdatePaymentMode } from "@/modules/admin/actions";

type PaymentModeOption = {
  id: string;
  name: string;
};

type AdminPaymentModeOverrideProps = {
  paymentModes: PaymentModeOption[];
};

export function AdminPaymentModeOverride({ paymentModes }: AdminPaymentModeOverrideProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [claimId, setClaimId] = useState("");
  const [selectedPaymentModeId, setSelectedPaymentModeId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasPaymentModes = paymentModes.length > 0;
  const paymentModesById = useMemo(
    () => new Map(paymentModes.map((paymentMode) => [paymentMode.id, paymentMode.name])),
    [paymentModes],
  );
  const effectiveSelectedPaymentModeId =
    selectedPaymentModeId && paymentModesById.has(selectedPaymentModeId)
      ? selectedPaymentModeId
      : (paymentModes[0]?.id ?? "");

  function clearFeedback() {
    setMessage(null);
    setErrorMessage(null);
  }

  function handleForceUpdate() {
    const normalizedClaimId = claimId.trim();

    clearFeedback();

    if (!normalizedClaimId) {
      setErrorMessage("Claim ID is required.");
      return;
    }

    if (!effectiveSelectedPaymentModeId) {
      setErrorMessage("Select a payment mode.");
      return;
    }

    startTransition(async () => {
      const result = await forceUpdatePaymentMode(
        normalizedClaimId,
        effectiveSelectedPaymentModeId,
      );

      if (!result.ok) {
        setErrorMessage(result.message ?? "Failed to force-update payment mode.");
        return;
      }

      const selectedLabel = paymentModesById.get(effectiveSelectedPaymentModeId) ?? "selected mode";
      setMessage(`Payment mode updated to ${selectedLabel}.`);
      setClaimId("");
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-[26px] border border-zinc-200/80 bg-zinc-50/60 p-5 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Admin Payment Mode Override
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Production hotfix control for claims in Finance Approved - Payment under process. Closed
          claims are blocked and every override is audited.
        </p>
      </header>

      {!hasPaymentModes ? (
        <Alert
          tone="warning"
          description="No eligible payment modes are currently active. Activate Reimbursement or Petty Cash in Master Data."
        />
      ) : null}

      {message ? <Alert tone="success" description={message} /> : null}
      {errorMessage ? <Alert tone="error" description={errorMessage} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            Claim ID
          </span>
          <input
            type="text"
            value={claimId}
            onChange={(event) => setClaimId(event.target.value)}
            placeholder="CLAIM-EMP123-20260408-0001"
            disabled={isPending}
            className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
            New Payment Mode
          </span>
          <select
            value={effectiveSelectedPaymentModeId}
            onChange={(event) => setSelectedPaymentModeId(event.target.value)}
            disabled={isPending || !hasPaymentModes}
            className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {paymentModes.map((paymentMode) => (
              <option key={paymentMode.id} value={paymentMode.id}>
                {paymentMode.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={isPending || !hasPaymentModes}
          onClick={handleForceUpdate}
        >
          {isPending ? "Updating..." : "Force Update"}
        </Button>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Allowed targets are restricted to Reimbursement and Petty Cash.
      </p>
    </section>
  );
}
