"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishNewPolicyAction } from "@/modules/policies/actions";
import type { PolicyGateState } from "@/modules/policies/server/get-policy-gate-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type PolicyManagementProps = {
  initialState: PolicyGateState;
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

export function PolicyManagement({ initialState }: PolicyManagementProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [versionName, setVersionName] = useState("");
  const [policyFile, setPolicyFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(initialState.errorMessage);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeVersionName = initialState.policy?.versionName ?? null;
  const activeAcceptedAt = initialState.acceptedAt;
  const activeFileUrl = initialState.policy?.fileUrl ?? null;

  const handlePublish = () => {
    setErrorMessage(null);
    setMessage(null);

    if (!policyFile) {
      setErrorMessage("Please upload the company policy as a PDF file.");
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("versionName", versionName);
      formData.append("policyFile", policyFile);

      const publishResult = await publishNewPolicyAction(formData);

      if (!publishResult.ok) {
        setErrorMessage(
          publishResult.message ??
            "We couldn't publish the company policy. Please review the file and try again.",
        );
        return;
      }

      setMessage("Policy published successfully.");
      setVersionName("");
      setPolicyFile(null);
      router.refresh();
    });
  };

  return (
    <section className="space-y-4 rounded-[26px] border border-border/80 bg-background-secondary/60 p-5">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
          Update Company Policy
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Publishing a new policy will force all users to re-accept it upon their next login.
        </p>
      </header>

      <>
        <div className="rounded-xl border border-border bg-card/90 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Active Version: <span className="font-semibold">{activeVersionName ?? "None"}</span>
          </p>
          <p className="mt-1">
            Your acceptance timestamp for active policy: {formatAcceptedDate(activeAcceptedAt)}
          </p>
        </div>

        {activeFileUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-border bg-background-secondary">
            <iframe
              src={activeFileUrl}
              title={`Active policy ${activeVersionName ?? "version"}`}
              className="w-full h-[70vh] rounded-lg border-none"
              onError={() => {
                setErrorMessage(
                  "We couldn't load the company policy document. Please try again later.",
                );
              }}
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <label
            htmlFor="policy-version-name"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            New Policy Version Name
          </label>
          <input
            id="policy-version-name"
            type="text"
            value={versionName}
            onChange={(event) => setVersionName(event.target.value)}
            placeholder="Example: FIN-POL-002 v1.2"
            className="nxt-input rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
          />
        </div>

        <div className="grid gap-2">
          <label
            htmlFor="policy-file"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            Policy PDF File
          </label>
          <input
            id="policy-file"
            type="file"
            accept="application/pdf"
            required
            onChange={(event) => {
              const selectedFile = event.currentTarget.files?.[0] ?? null;
              setPolicyFile(selectedFile);
            }}
            className="nxt-input rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-accent-hover"
          />
          <p className="text-xs text-muted-foreground">Upload a PDF file only. Max size 25MB.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={isPending}
            onClick={handlePublish}
            type="button"
            variant="primary"
            size="md"
          >
            {isPending ? "Publishing..." : "Publish New Policy"}
          </Button>

          {message ? <span className="text-sm font-medium text-success">{message}</span> : null}
        </div>

        {errorMessage ? <Alert tone="error" description={errorMessage} /> : null}
      </>
    </section>
  );
}
