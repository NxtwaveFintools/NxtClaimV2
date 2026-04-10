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
    <div className={cn("grid place-items-center px-4 py-14 text-center", className)}>
      {icon}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{description}</p>
      ) : null}
    </div>
  );
}
