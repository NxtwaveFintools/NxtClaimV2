"use client";

import Image from "next/image";
import { useEffect, useMemo, useReducer, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getClaimEvidenceSignedUrlAction } from "@/modules/claims/actions";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

export type ClaimEvidenceViewerItem = {
  label: string;
  path: string;
};

type ClaimEvidenceViewerProps = {
  claimId: string;
  items: ClaimEvidenceViewerItem[];
};

function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

function toTabValue(item: ClaimEvidenceViewerItem, index: number): string {
  return `${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;
}

function EvidencePreviewSkeleton() {
  return (
    <div className="flex-1 min-h-0 bg-background-secondary p-3">
      <Skeleton className="h-full min-h-[340px] w-full rounded-lg" />
    </div>
  );
}

export function ClaimEvidenceViewer({ claimId, items }: ClaimEvidenceViewerProps) {
  const tabs = useMemo(
    () => items.map((item, index) => ({ ...item, value: toTabValue(item, index) })),
    [items],
  );
  const [activeTab, setActiveTab] = useState(() => tabs[0]?.value ?? "");
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [fetchState, dispatchFetch] = useReducer(
    (
      state: { loadingPath: string | null; errorMessage: string | null },
      action: Partial<typeof state>,
    ) => ({ ...state, ...action }),
    { loadingPath: null, errorMessage: null },
  );

  const validActiveTab = tabs.some((t) => t.value === activeTab)
    ? activeTab
    : (tabs[0]?.value ?? "");
  const activeItem = tabs.find((item) => item.value === validActiveTab) ?? tabs[0] ?? null;
  const activeSignedUrl = activeItem ? signedUrls[activeItem.path] : null;

  useEffect(() => {
    if (!activeItem || signedUrls[activeItem.path]) {
      return;
    }

    let isCurrent = true;
    dispatchFetch({ loadingPath: activeItem.path, errorMessage: null });

    getClaimEvidenceSignedUrlAction({ claimId, filePath: activeItem.path })
      .then((result) => {
        if (!isCurrent) {
          return;
        }

        if (!result.ok || !result.signedUrl) {
          dispatchFetch({
            errorMessage: getUserFriendlyErrorMessage(result.message, "claim-detail"),
            loadingPath: null,
          });
          return;
        }

        setSignedUrls((current) => ({ ...current, [activeItem.path]: result.signedUrl! }));
      })
      .catch(() => {
        if (isCurrent) {
          dispatchFetch({
            errorMessage: "We couldn't load this evidence file. Please try again.",
            loadingPath: null,
          });
        }
      })
      .finally(() => {
        if (isCurrent) {
          dispatchFetch({ loadingPath: null });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeItem, claimId, signedUrls]);

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center border-b border-border px-4 py-2">
          <p className="text-sm font-semibold text-foreground">Evidence</p>
        </div>
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No evidence files attached to this claim.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Evidence</p>
          <div
            className="inline-flex h-auto justify-start gap-1 rounded-lg border border-border bg-card p-1"
            role="tablist"
            aria-label="Claim evidence"
          >
            {tabs.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={item.value === activeTab}
                onClick={() => setActiveTab(item.value)}
                className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                  item.value === activeTab
                    ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                    : "text-muted-foreground hover:bg-background-secondary hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {activeSignedUrl ? (
          <a
            href={activeSignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-background-secondary"
          >
            Open in New Tab
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {fetchState.errorMessage ? (
        <div className="px-4 py-4 text-sm text-danger">{fetchState.errorMessage}</div>
      ) : fetchState.loadingPath === activeItem?.path || !activeSignedUrl ? (
        <EvidencePreviewSkeleton />
      ) : isPdf(activeItem.path) ? (
        <div className="flex-1 min-h-0 overflow-auto bg-background-secondary p-2 sm:p-3">
          <iframe
            title={activeItem.label}
            src={activeSignedUrl}
            className="h-full w-full rounded-lg border border-border bg-card"
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-background-secondary p-2 sm:p-3">
          <div className="grid min-h-full place-items-center rounded-lg border border-border bg-card p-2">
            <Image
              src={activeSignedUrl}
              alt={activeItem.label}
              width={1800}
              height={2200}
              unoptimized
              className="max-h-full w-auto max-w-full rounded-md object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
