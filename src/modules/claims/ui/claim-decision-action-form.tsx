"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClaimDecisionSubmitButton } from "@/modules/claims/ui/claim-decision-submit-button";

type ClaimDecisionActionFormProps = {
  action: (formData: FormData) => Promise<void>;
  decision: "approve" | "mark-paid";
  compact?: boolean;
  loadingMessage: string;
  successMessage: string;
  errorMessage: string;
  redirectToHref?: string;
};

export function ClaimDecisionActionForm({
  action,
  decision,
  compact = false,
  loadingMessage,
  successMessage,
  errorMessage,
  redirectToHref,
}: ClaimDecisionActionFormProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
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

  return (
    <form onSubmit={handleSubmit}>
      <ClaimDecisionSubmitButton decision={decision} compact={compact} pending={isSubmitting} />
    </form>
  );
}
