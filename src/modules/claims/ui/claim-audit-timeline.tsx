import type { ClaimAuditLogRecord } from "@/core/domain/claims/contracts";

type ClaimAuditTimelineProps = {
  logs: (ClaimAuditLogRecord & { formattedCreatedAt: string })[];
  title?: string;
  emptyLabel?: string;
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

  if (actionType === "L2_MARK_PAID") {
    return "Marked as Paid by Finance";
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

  return {
    labelClassName: "text-indigo-700 dark:text-indigo-300",
    dotClassName: "bg-indigo-600 dark:bg-indigo-400",
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

  if (log.assignedToName && log.assignedToEmail) {
    return `${log.assignedToName} (${log.assignedToEmail})`;
  }

  return log.assignedToName ?? log.assignedToEmail ?? "Next assignee";
}

export function ClaimAuditTimeline({
  logs,
  title = "Audit History",
  emptyLabel = "No audit entries are available for this claim.",
}: ClaimAuditTimelineProps) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-700 dark:text-slate-300">
        {title}
      </h3>

      {logs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</p>
      ) : (
        <ol className="mt-4 space-y-4 border-l-2 border-slate-300 pl-4 dark:border-slate-600">
          {logs.map((log) => {
            const assigneeLabel = buildAssigneeLabel(log);
            const actionAccent = actionAccentClasses(log.actionType);

            return (
              <li key={log.id} className="relative">
                <span
                  className={`absolute -left-[22px] top-1.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-900 ${actionAccent.dotClassName}`}
                />
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                  {log.formattedCreatedAt}
                </p>
                <p className={`mt-1 text-sm font-semibold ${actionAccent.labelClassName}`}>
                  {describeAction(log.actionType)}
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  By {buildActorLabel(log)}
                </p>
                {assigneeLabel ? (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                    Assigned to {assigneeLabel}
                  </p>
                ) : null}
                {log.remarks ? (
                  <p className="mt-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    Remarks: {log.remarks}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
