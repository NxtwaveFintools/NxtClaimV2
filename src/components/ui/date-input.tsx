import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="date"
      className={cn(
        "nxt-input h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
});
