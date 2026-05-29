import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type TableEmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
};

export function TableEmptyState({ title, description, icon, className }: TableEmptyStateProps) {
  return (
    <div className={cn("grid place-items-center px-4 py-10 text-center", className)}>
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}
