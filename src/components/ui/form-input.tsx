import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type FormInputProps = InputHTMLAttributes<HTMLInputElement>;

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(function FormInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "nxt-input h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});
