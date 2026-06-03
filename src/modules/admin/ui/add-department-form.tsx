"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addDepartmentAction } from "@/modules/admin/actions/add-department";

export function AddDepartmentForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [approver1Email, setApprover1Email] = useState("");
  const [approver2Email, setApprover2Email] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await addDepartmentAction({
        name,
        approver1Email,
        approver2Email,
      });

      if (!result.ok) {
        const message =
          result.message ?? "We couldn't save these settings. Please review and try again.";
        setError(message);
        toast.error(message);
        return;
      }

      setName("");
      setApprover1Email("");
      setApprover2Email("");
      toast.success("Department created successfully.");
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-border/80 bg-background-secondary/60 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
        Add Department
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter a department and approver emails. Missing users are auto-created with default
        credentials and linked immediately.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Department name"
          className="nxt-input w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
        />

        <input
          type="email"
          value={approver1Email}
          onChange={(event) => setApprover1Email(event.target.value)}
          placeholder="Approver 1 email"
          className="nxt-input w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
        />

        <input
          type="email"
          value={approver2Email}
          onChange={(event) => setApprover2Email(event.target.value)}
          placeholder="Approver 2 email"
          className="nxt-input w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
        />

        <div className="md:col-span-3 flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isPending || !name.trim() || !approver1Email.trim() || !approver2Email.trim()}
          >
            {isPending ? "Creating..." : "Create Department"}
          </Button>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
      </form>
    </div>
  );
}
