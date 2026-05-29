import type { ClaimAuditLogRecord } from "@/core/domain/claims/contracts";

type ClaimAuditTimelineProps = {
  logs: (ClaimAuditLogRecord & { formattedCreatedAt: string })[];
  title?: string;
  emptyLabel?: string;
  visualStyle?: "default" | "minimal";
};

function describeAction(actionType: ClaimAuditLogRecord["actionType"]): string {
  if (actionType === "SUBMITTED") {
    return "Claim submitted";
  }

  if (actionType === "L1_APPROVED") {
    return "Approved at L1";
  }

  if (actionType === "L1_REJECTED") {
    return "Rejected at L1";
  }

  if (actionType === "L2_APPROVED") {
    return "Approved by Finance";
  }

  if (actionType === "FINANCE_EDITED") {
    return "Edited by Finance";
  }

  if (actionType === "UPDATED") {
    return "Claim Updated";
  }

  if (actionType === "L2_MARK_PAID") {
    return "Marked as Paid by Finance";
  }

  if (actionType === "ADMIN_SOFT_DELETED") {
    return "Soft-deleted by Admin";
  }

  if (actionType === "ADMIN_PAYMENT_MODE_OVERRIDDEN") {
    return "Payment mode overridden by Admin";
  }

  return "Rejected by Finance";
}

function actionAccentClasses(actionType: ClaimAuditLogRecord["actionType"]): {
  labelClassName: string;
  dotClassName: string;
} {
  if (actionType === "SUBMITTED") {
    return {
      labelClassName: "text-amber-800 dark:text-amber-200",
      dotClassName: "bg-amber-600 dark:bg-amber-400",
    };
  }

  if (actionType === "L1_REJECTED" || actionType === "L2_REJECTED") {
    return {
      labelClassName: "text-rose-700 dark:text-rose-300",
      dotClassName: "bg-rose-600 dark:bg-rose-400",
    };
  }

  if (actionType === "L2_MARK_PAID") {
    return {
      labelClassName: "text-emerald-700 dark:text-emerald-300",
      dotClassName: "bg-emerald-600 dark:bg-emerald-400",
    };
  }

  if (actionType === "ADMIN_SOFT_DELETED") {
    return {
      labelClassName: "text-rose-700 dark:text-rose-300",
      dotClassName: "bg-rose-600 dark:bg-rose-400",
    };
  }

  if (actionType === "ADMIN_PAYMENT_MODE_OVERRIDDEN") {
    return {
      labelClassName: "text-amber-800 dark:text-amber-200",
      dotClassName: "bg-amber-600 dark:bg-amber-400",
    };
  }

  if (actionType === "FINANCE_EDITED") {
    return {
      labelClassName: "text-amber-800 dark:text-amber-200",
      dotClassName: "bg-amber-600 dark:bg-amber-400",
    };
  }

  if (actionType === "UPDATED") {
    return {
      labelClassName: "text-teal-800 dark:text-teal-200",
      dotClassName: "bg-teal-600 dark:bg-teal-400",
    };
  }

  return {
    labelClassName: "text-accent",
    dotClassName: "bg-accent",
  };
}

function buildActorLabel(log: ClaimAuditLogRecord): string {
  if (log.actorName && log.actorEmail) {
    return `${log.actorName} (${log.actorEmail})`;
  }

  return log.actorName ?? log.actorEmail ?? "Unknown actor";
}

function buildAssigneeLabel(log: ClaimAuditLogRecord): string | null {
  if (!log.assignedToId) {
    return null;
  }

  // L1 approval moves claims into the shared finance queue, so we mask the individual assignee.
  if (log.actionType === "L1_APPROVED") {
    return "Finance Team";
  }

  if (log.assignedToName && log.assignedToEmail) {
    return `${log.assignedToName} (${log.assignedToEmail})`;
  }

  return log.assignedToName ?? log.assignedToEmail ?? "Next assignee";
}

export function ClaimAuditTimeline({
  logs,
  title = "Audit History",
  emptyLabel = "No audit entries are available for this claim.",
  visualStyle = "default",
}: ClaimAuditTimelineProps) {
  const isMinimalVisual = visualStyle === "minimal";
  const containerClassName = isMinimalVisual
    ? "rounded-xl border border-border bg-card p-4"
    : "rounded-2xl border border-border bg-card p-5";
  const itemClassName = isMinimalVisual
    ? "relative border-b border-border py-2.5 pl-4 last:border-b-0"
    : "relative overflow-hidden rounded-xl border border-border bg-background-secondary/60 p-3.5 pl-4";
  const remarksClassName = isMinimalVisual
    ? "mt-1.5 text-xs leading-5 text-muted-foreground"
    : "mt-2 rounded-lg bg-card px-2.5 py-1.5 text-xs leading-5 text-muted-foreground";

  return (
    <section className={containerClassName}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h3>
        <span className="text-xs font-medium text-muted-foreground">
          {logs.length} event{logs.length === 1 ? "" : "s"}
        </span>
      </div>

      {logs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {logs.map((log) => {
            const assigneeLabel = buildAssigneeLabel(log);
            const actionAccent = actionAccentClasses(log.actionType);

            return (
              <li key={log.id} className={itemClassName}>
                <span
                  className={`absolute bottom-3 left-0 top-3 w-0.5 rounded-full ${actionAccent.dotClassName}`}
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {log.formattedCreatedAt}
                </p>
                <p className={`mt-0.5 text-sm font-semibold ${actionAccent.labelClassName}`}>
                  {describeAction(log.actionType)}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  By {buildActorLabel(log)}
                </p>
                {assigneeLabel ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Assigned to {assigneeLabel}
                  </p>
                ) : null}
                {log.remarks ? <p className={remarksClassName}>Remarks: {log.remarks}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
