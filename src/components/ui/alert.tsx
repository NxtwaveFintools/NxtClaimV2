import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const ALERT_TONE_CLASSES = {
  error: "border-danger/30 bg-danger-muted text-danger",
  warning: "border-warning/30 bg-warning-muted text-warning",
  success: "border-success/30 bg-success-muted text-success",
  info: "border-info/30 bg-info-muted text-info",
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
