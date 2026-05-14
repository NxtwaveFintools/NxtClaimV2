import { Sparkles } from "lucide-react";
import type {
  ClaimExpenseAiMetadata,
  ClaimExpenseAiOriginalValue,
} from "@/core/domain/claims/contracts";

type AiAuditCaptionProps = {
  aiMetadata: ClaimExpenseAiMetadata | null | undefined;
  fieldKey: string;
  formatValue?: (value: ClaimExpenseAiOriginalValue) => string;
};

function defaultFormatValue(value: ClaimExpenseAiOriginalValue): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return String(value);
}

export function AiAuditCaption({ aiMetadata, fieldKey, formatValue }: AiAuditCaptionProps) {
  const entry = aiMetadata?.edited_fields?.[fieldKey];
  if (!entry) return null;

  const displayValue = (formatValue ?? defaultFormatValue)(entry.original);

  return (
    <div className="flex items-center gap-1 rounded-md bg-yellow-50 px-2 py-0.5 dark:bg-yellow-900/20">
      <Sparkles
        className="h-3 w-3 shrink-0 text-yellow-600 dark:text-yellow-400"
        aria-hidden="true"
      />
      <span className="text-xs text-yellow-800 dark:text-yellow-400">
        AI extracted: {displayValue}
      </span>
    </div>
  );
}
