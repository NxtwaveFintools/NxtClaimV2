"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const ADVANCED_DATE_KEYS = [
  "adv_sub_from",
  "adv_sub_to",
  "adv_hod_from",
  "adv_hod_to",
  "adv_fin_from",
  "adv_fin_to",
] as const;

const ADVANCED_AMOUNT_KEYS = ["min_amt", "max_amt"] as const;

function setOrDeleteParam(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    params.set(key, trimmed);
    return;
  }

  params.delete(key);
}

export function AdvancedFiltersSheet() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);

  const [submittedFrom, setSubmittedFrom] = useState(searchParams.get("adv_sub_from") ?? "");
  const [submittedTo, setSubmittedTo] = useState(searchParams.get("adv_sub_to") ?? "");
  const [hodFrom, setHodFrom] = useState(searchParams.get("adv_hod_from") ?? "");
  const [hodTo, setHodTo] = useState(searchParams.get("adv_hod_to") ?? "");
  const [financeFrom, setFinanceFrom] = useState(searchParams.get("adv_fin_from") ?? "");
  const [financeTo, setFinanceTo] = useState(searchParams.get("adv_fin_to") ?? "");
  const [minAmount, setMinAmount] = useState(searchParams.get("min_amt") ?? "");
  const [maxAmount, setMaxAmount] = useState(searchParams.get("max_amt") ?? "");

  function syncStateFromSearchParams(): void {
    setSubmittedFrom(searchParams.get("adv_sub_from") ?? "");
    setSubmittedTo(searchParams.get("adv_sub_to") ?? "");
    setHodFrom(searchParams.get("adv_hod_from") ?? "");
    setHodTo(searchParams.get("adv_hod_to") ?? "");
    setFinanceFrom(searchParams.get("adv_fin_from") ?? "");
    setFinanceTo(searchParams.get("adv_fin_to") ?? "");
    setMinAmount(searchParams.get("min_amt") ?? "");
    setMaxAmount(searchParams.get("max_amt") ?? "");
  }

  const activeCount = useMemo(() => {
    const keys = [...ADVANCED_DATE_KEYS, ...ADVANCED_AMOUNT_KEYS];
    return keys.filter((key) => (searchParams.get(key) ?? "").trim().length > 0).length;
  }, [searchParams]);

  const isApplyDisabled = useMemo(() => {
    return (
      submittedFrom.trim().length === 0 &&
      submittedTo.trim().length === 0 &&
      hodFrom.trim().length === 0 &&
      hodTo.trim().length === 0 &&
      financeFrom.trim().length === 0 &&
      financeTo.trim().length === 0 &&
      minAmount.trim().length === 0 &&
      maxAmount.trim().length === 0
    );
  }, [financeFrom, financeTo, hodFrom, hodTo, maxAmount, minAmount, submittedFrom, submittedTo]);

  function replaceUrl(nextParams: URLSearchParams): void {
    const query = nextParams.toString();
    const href = query ? `${pathname}?${query}` : pathname;
    router.replace(href, { scroll: false });
  }

  function handleApply(): void {
    const nextParams = new URLSearchParams(searchParams.toString());

    setOrDeleteParam(nextParams, "adv_sub_from", submittedFrom);
    setOrDeleteParam(nextParams, "adv_sub_to", submittedTo);
    setOrDeleteParam(nextParams, "adv_hod_from", hodFrom);
    setOrDeleteParam(nextParams, "adv_hod_to", hodTo);
    setOrDeleteParam(nextParams, "adv_fin_from", financeFrom);
    setOrDeleteParam(nextParams, "adv_fin_to", financeTo);
    setOrDeleteParam(nextParams, "min_amt", minAmount);
    setOrDeleteParam(nextParams, "max_amt", maxAmount);

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");

    // Advanced mode uses explicit date keys and should not retain standard date-target keys.
    nextParams.delete("date_target");
    nextParams.delete("from");
    nextParams.delete("to");

    replaceUrl(nextParams);
    setIsOpen(false);
  }

  function handleResetAdvanced(): void {
    const nextParams = new URLSearchParams(searchParams.toString());

    for (const key of ADVANCED_DATE_KEYS) {
      nextParams.delete(key);
    }

    for (const key of ADVANCED_AMOUNT_KEYS) {
      nextParams.delete(key);
    }

    nextParams.delete("cursor");
    nextParams.delete("prevCursor");

    replaceUrl(nextParams);
    setIsOpen(false);
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          syncStateFromSearchParams();
        }
        setIsOpen(nextOpen);
      }}
    >
      <SheetTrigger className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-700/70 dark:bg-sky-900/20 dark:text-sky-200 dark:hover:bg-sky-900/40">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 7h16" />
          <path d="M7 12h10" />
          <path d="M10 17h4" />
        </svg>
        Advanced Filters
        {activeCount > 0 ? (
          <span className="rounded-full bg-sky-700 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-sky-500">
            {activeCount}
          </span>
        ) : null}
      </SheetTrigger>

      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Advanced Filters</SheetTitle>
          <SheetDescription>
            Apply independent date ranges for Submitted, HOD action, and Finance action, plus
            optional amount range.
          </SheetDescription>
        </SheetHeader>

        <div className="nxt-scroll max-h-[calc(100vh-170px)] space-y-5 overflow-y-auto pr-1">
          <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Submitted Date
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                From
                <input
                  type="date"
                  value={submittedFrom}
                  onChange={(event) => {
                    setSubmittedFrom(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                To
                <input
                  type="date"
                  value={submittedTo}
                  onChange={(event) => {
                    setSubmittedTo(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              HOD Action Date
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                From
                <input
                  type="date"
                  value={hodFrom}
                  onChange={(event) => {
                    setHodFrom(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                To
                <input
                  type="date"
                  value={hodTo}
                  onChange={(event) => {
                    setHodTo(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Finance Action Date
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                From
                <input
                  type="date"
                  value={financeFrom}
                  onChange={(event) => {
                    setFinanceFrom(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                To
                <input
                  type="date"
                  value={financeTo}
                  onChange={(event) => {
                    setFinanceTo(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Amount Range
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Min Amount
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={minAmount}
                  onChange={(event) => {
                    setMinAmount(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Max Amount
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={maxAmount}
                  onChange={(event) => {
                    setMaxAmount(event.target.value);
                  }}
                  className="nxt-input h-8 rounded-lg border border-zinc-300 px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </label>
            </div>
          </section>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleResetAdvanced}
            className="inline-flex rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Reset Advanced
          </button>

          <button
            type="button"
            onClick={handleApply}
            disabled={isApplyDisabled}
            className="inline-flex rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Apply
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
