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
        "nxt-input h-9 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        className,
      )}
      {...props}
    />
  );
});
