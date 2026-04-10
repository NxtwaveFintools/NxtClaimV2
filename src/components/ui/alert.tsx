import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const ALERT_TONE_CLASSES = {
  error:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-200",
} as const;

export type AlertTone = keyof typeof ALERT_TONE_CLASSES;

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: AlertTone;
  title?: string;
  description?: string;
};

export function Alert({
  className,
  tone = "info",
  title,
  description,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cn("rounded-xl border px-4 py-3 text-sm", ALERT_TONE_CLASSES[tone], className)}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {description ? <p className={cn(title ? "mt-1" : undefined)}>{description}</p> : null}
      {children}
    </div>
  );
}
