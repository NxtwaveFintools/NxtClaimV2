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
  const [hodEmail, setHodEmail] = useState("");
  const [founderEmail, setFounderEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await addDepartmentAction({
        name,
        hod_email: hodEmail,
        founder_email: founderEmail,
      });

      if (!result.ok) {
        const message = result.message ?? "Failed to create department.";
        setError(message);
        toast.error(message);
        return;
      }

      setName("");
      setHodEmail("");
      setFounderEmail("");
      toast.success("Department created successfully.");
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-zinc-200/80 bg-zinc-50/60 p-5 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
        Add Department
      </h3>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Enter a department and actor emails. Missing users are auto-created with default credentials
        and linked immediately.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Department name"
          className="nxt-input w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />

        <input
          type="email"
          value={hodEmail}
          onChange={(event) => setHodEmail(event.target.value)}
          placeholder="HOD email"
          className="nxt-input w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />

        <input
          type="email"
          value={founderEmail}
          onChange={(event) => setFounderEmail(event.target.value)}
          placeholder="Founder email"
          className="nxt-input w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />

        <div className="md:col-span-3 flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isPending || !name.trim() || !hodEmail.trim() || !founderEmail.trim()}
          >
            {isPending ? "Creating..." : "Create Department"}
          </Button>
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        </div>
      </form>
    </div>
  );
}
