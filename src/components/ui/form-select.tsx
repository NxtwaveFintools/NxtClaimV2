import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type FormSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(function FormSelect(
  { className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "nxt-input h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
});
