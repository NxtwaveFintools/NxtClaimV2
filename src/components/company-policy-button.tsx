"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type CompanyPolicyState = {
  policy: {
    id: string;
    versionName: string;
    fileUrl: string;
    createdAt: string;
  } | null;
  accepted: boolean;
  acceptedAt: string | null;
  message: string | null;
};

type CompanyPolicyButtonProps = {
  initialState: CompanyPolicyState | null;
  children?: React.ReactNode;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  onMouseEnter?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLButtonElement>;
};

function formatAcceptedDate(value: string | null): string {
  if (!value) {
    return "Not accepted yet";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function CompanyPolicyButton({
  initialState,
  children,
  triggerClassName,
  triggerStyle,
  onMouseEnter,
  onMouseLeave,
}: CompanyPolicyButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);

  const state = initialState;
  const message = runtimeMessage ?? initialState?.message ?? null;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        className={
          triggerClassName ??
          "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }
        style={
          triggerStyle ??
          (triggerClassName
            ? undefined
            : {
                backgroundColor: "transparent",
                borderColor: "var(--border)",
                color: "var(--muted-foreground)",
              })
        }
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-label="Open company policy"
      >
        {children ?? (
          <>
            <FileText className="h-4 w-4" aria-hidden="true" />
            Company Policy
          </>
        )}
      </SheetTrigger>

      <SheetContent className="!max-w-4xl p-0">
        <div className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>Company Policy</SheetTitle>
            <SheetDescription>
              Review the currently active policy version and your acceptance timestamp.
            </SheetDescription>
          </SheetHeader>

          <div className="nxt-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {state?.policy ? (
              <article className="space-y-4">
                <header className="rounded-xl border border-border bg-background-secondary px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                    {state.policy.versionName}
                  </p>
                </header>
                <div className="relative overflow-hidden rounded-xl border border-border bg-background-secondary">
                  <iframe
                    src={state.policy.fileUrl}
                    title={`Company policy ${state.policy.versionName}`}
                    className="w-full h-[70vh] rounded-lg border-none"
                    onError={() => {
                      setRuntimeMessage("Unable to load policy PDF. Please try again.");
                    }}
                  />
                </div>
              </article>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                {message ?? "No active company policy was found."}
              </p>
            )}
          </div>

          <footer className="border-t border-border bg-background-secondary px-5 py-3 text-sm text-muted-foreground">
            You accepted this policy on {formatAcceptedDate(state?.acceptedAt ?? null)}.
          </footer>
        </div>
      </SheetContent>
    </Sheet>
  );
}
