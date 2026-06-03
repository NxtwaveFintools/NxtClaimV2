import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

function decimalStep(maxFractionDigits: number): string {
  if (maxFractionDigits <= 0) {
    return "1";
  }

  return `0.${"0".repeat(maxFractionDigits - 1)}1`;
}

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode"> & {
  maxFractionDigits?: number;
  onValueChange?: (value: number | null) => void;
};

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    { className, step, maxFractionDigits = 2, onChange, onValueChange, ...props },
    ref,
  ) {
    return (
      <input
        ref={ref}
        type="number"
        inputMode="decimal"
        step={step ?? decimalStep(maxFractionDigits)}
        className={cn(
          "nxt-input h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground",
          className,
        )}
        onChange={(event) => {
          onChange?.(event);

          if (!onValueChange) {
            return;
          }

          const rawValue = event.currentTarget.value.trim();
          if (rawValue.length === 0) {
            onValueChange(null);
            return;
          }

          const parsed = Number(rawValue);
          onValueChange(Number.isFinite(parsed) ? parsed : null);
        }}
        {...props}
      />
    );
  },
);
