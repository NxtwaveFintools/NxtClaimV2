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
        "nxt-input h-9 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        className,
      )}
      {...props}
    />
  );
});
