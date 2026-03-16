"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ClaimDecisionSubmitButton } from "@/modules/claims/ui/claim-decision-submit-button";

type ClaimDecisionActionFormProps = {
  action: (formData: FormData) => Promise<void>;
  decision: "approve" | "mark-paid";
  compact?: boolean;
  loadingMessage: string;
  successMessage: string;
  errorMessage: string;
};

export function ClaimDecisionActionForm({
  action,
  decision,
  compact = false,
  loadingMessage,
  successMessage,
  errorMessage,
}: ClaimDecisionActionFormProps) {
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
