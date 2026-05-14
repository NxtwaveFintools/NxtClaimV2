"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClaimDecisionSubmitButton } from "@/modules/claims/ui/claim-decision-submit-button";
import { BcPaymentModal } from "@/modules/claims/ui/bc-payment-modal";
import { isExpensePaymentModeName } from "@/core/constants/payment-modes";

type ClaimDecisionActionFormProps = {
  action: (formData: FormData) => Promise<void>;
  decision: "approve" | "mark-paid";
  isSubmitter?: boolean;
  compact?: boolean;
  loadingMessage: string;
  successMessage: string;
  errorMessage: string;
  redirectToHref?: string;
  claimId?: string;
  paymentModeName?: string | null;
};

export function ClaimDecisionActionForm({
  action,
  decision,
  isSubmitter = false,
  compact = false,
  loadingMessage,
  successMessage,
  errorMessage,
  redirectToHref,
  claimId,
  paymentModeName,
}: ClaimDecisionActionFormProps) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bcModalOpen, setBcModalOpen] = useState(false);
  const isPending = isSubmitting || isNavigating;

  const isExpenseModeApprove =
    decision === "approve" && claimId !== undefined && isExpensePaymentModeName(paymentModeName);

  if (isSubmitter) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isPending) {
      return;
    }

    if (isExpenseModeApprove) {
      setBcModalOpen(true);
      return;
    }

    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);

    try {
      await toast.promise(action(formData), {
        loading: loadingMessage,
        success: successMessage,
        error: (error) => (error instanceof Error ? error.message : errorMessage),
      });

      if (redirectToHref) {
        startTransition(() => {
          router.push(redirectToHref, { scroll: false });
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBcSuccess = () => {
    if (redirectToHref) {
      startTransition(() => {
        router.push(redirectToHref, { scroll: false });
      });
      return;
    }
    router.refresh();
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <ClaimDecisionSubmitButton decision={decision} compact={compact} pending={isPending} />
      </form>
      {isExpenseModeApprove && claimId ? (
        <BcPaymentModal
          open={bcModalOpen}
          onOpenChange={setBcModalOpen}
          claimId={claimId}
          onSuccess={handleBcSuccess}
        />
      ) : null}
    </>
  );
}
