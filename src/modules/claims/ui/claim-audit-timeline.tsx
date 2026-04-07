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
}: ClaimAuditTimelineProps) {
  return (
    <section className="rounded-3xl border border-zinc-200/80 bg-white/80 p-5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.22)] dark:border-zinc-800/80 dark:bg-zinc-950/60 dark:shadow-black/25">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
          {title}
        </h3>
        <span className="inline-flex rounded-full border border-zinc-200/80 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {logs.length} event{logs.length === 1 ? "" : "s"}
        </span>
      </div>

      {logs.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {logs.map((log) => {
            const assigneeLabel = buildAssigneeLabel(log);
            const actionAccent = actionAccentClasses(log.actionType);

            return (
              <li
                key={log.id}
                className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-4 pl-5 dark:border-zinc-800/80 dark:bg-zinc-900/80"
              >
                <span
                  className={`absolute bottom-4 left-0 top-4 w-1 rounded-full ${actionAccent.dotClassName}`}
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
                  {log.formattedCreatedAt}
                </p>
                <p className={`mt-1 text-sm font-semibold ${actionAccent.labelClassName}`}>
                  {describeAction(log.actionType)}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                  By {buildActorLabel(log)}
                </p>
                {assigneeLabel ? (
                  <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    Assigned to {assigneeLabel}
                  </p>
                ) : null}
                {log.remarks ? (
                  <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-zinc-700 shadow-sm dark:bg-zinc-950 dark:text-zinc-300">
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
