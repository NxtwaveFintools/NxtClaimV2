import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type FormTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  function FormTextarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "nxt-input min-h-24 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
