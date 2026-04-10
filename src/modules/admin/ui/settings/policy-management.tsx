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
      setErrorMessage("Policy PDF file is required.");
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("versionName", versionName);
      formData.append("policyFile", policyFile);

      const publishResult = await publishNewPolicyAction(formData);

      if (!publishResult.ok) {
        setErrorMessage(publishResult.message ?? "Failed to publish policy.");
        return;
      }

      setMessage("Policy published successfully.");
      setVersionName("");
      setPolicyFile(null);
      router.refresh();
    });
  };

  return (
    <section className="space-y-4 rounded-[26px] border border-zinc-200/80 bg-zinc-50/60 p-5 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Update Company Policy
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Publishing a new policy will force all users to re-accept it upon their next login.
        </p>
      </header>

      <>
        <div className="rounded-xl border border-zinc-200 bg-white/90 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300">
          <p>
            Active Version: <span className="font-semibold">{activeVersionName ?? "None"}</span>
          </p>
          <p className="mt-1">
            Your acceptance timestamp for active policy: {formatAcceptedDate(activeAcceptedAt)}
          </p>
        </div>

        {activeFileUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70">
            <iframe
              src={activeFileUrl}
              title={`Active policy ${activeVersionName ?? "version"}`}
              className="w-full h-[70vh] rounded-lg border-none"
              onError={() => {
                setErrorMessage("Unable to load active policy PDF preview.");
              }}
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <label
            htmlFor="policy-version-name"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
          >
            New Policy Version Name
          </label>
          <input
            id="policy-version-name"
            type="text"
            value={versionName}
            onChange={(event) => setVersionName(event.target.value)}
            placeholder="Example: FIN-POL-002 v1.2"
            className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
        </div>

        <div className="grid gap-2">
          <label
            htmlFor="policy-file"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
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
            className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Upload a PDF file only. Max size 25MB.
          </p>
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

          {message ? (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {message}
            </span>
          ) : null}
        </div>

        {errorMessage ? <Alert tone="error" description={errorMessage} /> : null}
      </>
    </section>
  );
}
