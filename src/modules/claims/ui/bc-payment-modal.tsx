"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Check, Loader2, Search, User, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getBrowserSupabaseClient } from "@/core/infra/supabase/browser-client";
import { cn } from "@/lib/cn";

type Vendor = { no: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  onSuccess: () => void;
};

type PaymentType = "non_vendor" | "vendor";

export function BcPaymentModal({ open, onOpenChange, claimId, onSuccess }: Props) {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [paymentType, setPaymentType] = useState<PaymentType | null>(null);
  const [vendorQuery, setVendorQuery] = useState("");
  const debouncedQuery = useDebouncedValue(vendorQuery, 300);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldSearch =
    paymentType === "vendor" && !selectedVendor && debouncedQuery.trim().length > 0;
  const visibleVendors = shouldSearch ? vendors : [];

  useEffect(() => {
    if (!shouldSearch) {
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    supabase.functions
      .invoke("bc-vendor-search", { body: { query: debouncedQuery } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setVendors([]);
          setError(error.message);
          return;
        }
        setVendors((data?.vendors ?? []) as Vendor[]);
        setError(null);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, shouldSearch, supabase]);

  const canConfirm =
    !submitting &&
    paymentType !== null &&
    (paymentType === "non_vendor" || selectedVendor !== null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("bc-payment", {
      body: {
        claimId,
        isVendorPayment: paymentType === "vendor",
        bcVendorId: selectedVendor?.no,
        bcVendorName: selectedVendor?.name,
      },
    });
    setSubmitting(false);
    if (error || (data && data.ok === false)) {
      setError(formatError(error, data));
      return;
    }
    toast.success("Sent to Business Central. Claim is now Finance Approved.");
    onSuccess();
    onOpenChange(false);
  }

  function clearSelectedVendor() {
    setSelectedVendor(null);
    setVendorQuery("");
  }

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Send to Business Central
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400">
            Choose how this Reimbursement claim should be paid. Confirm submits the line items to
            Business Central &mdash; this cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-5">
          <fieldset className="space-y-2" disabled={submitting}>
            <legend className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Payment Type
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <PaymentTypeCard
                icon={<User className="h-4 w-4" />}
                label="Non-Vendor Payment"
                description="Reimburse the employee directly"
                selected={paymentType === "non_vendor"}
                onSelect={() => {
                  setPaymentType("non_vendor");
                  clearSelectedVendor();
                }}
              />
              <PaymentTypeCard
                icon={<Building2 className="h-4 w-4" />}
                label="Vendor Payment"
                description="Pay a third-party vendor"
                selected={paymentType === "vendor"}
                onSelect={() => setPaymentType("vendor")}
              />
            </div>
          </fieldset>

          {paymentType === "vendor" && (
            <div className="space-y-2">
              <label
                htmlFor="bc-vendor-search"
                className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
              >
                Vendor
              </label>

              {selectedVendor ? (
                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
                  <span className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-medium">{selectedVendor.name}</span>
                    <span className="text-emerald-700/80 dark:text-emerald-300/70">
                      ({selectedVendor.no})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={clearSelectedVendor}
                    disabled={submitting}
                    className="rounded-md p-1 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                    aria-label="Clear selected vendor"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                  <FormInput
                    id="bc-vendor-search"
                    type="text"
                    placeholder="Search vendor by name or ID"
                    value={vendorQuery}
                    onChange={(e) => setVendorQuery(e.target.value)}
                    disabled={submitting}
                    autoComplete="off"
                    className="pl-9"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400 dark:text-zinc-500" />
                  )}
                </div>
              )}

              {!selectedVendor && shouldSearch && (
                <div className="max-h-56 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  {visibleVendors.length === 0 && !searching && (
                    <p className="px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      No vendors match &ldquo;{debouncedQuery}&rdquo;.
                    </p>
                  )}
                  {visibleVendors.map((v, i) => (
                    <button
                      key={v.no}
                      type="button"
                      onClick={() => {
                        setSelectedVendor(v);
                        setVendorQuery("");
                        setVendors([]);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none dark:hover:bg-indigo-950/40 dark:focus:bg-indigo-950/40",
                        i !== visibleVendors.length - 1 &&
                          "border-b border-zinc-100 dark:border-zinc-800",
                      )}
                    >
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {v.name}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {v.no}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            loading={submitting}
            loadingText="Sending to BC…"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentTypeCard({
  icon,
  label,
  description,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition-all",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
        selected
          ? "border-indigo-500 bg-indigo-50 shadow-sm shadow-indigo-500/10 dark:border-indigo-400/70 dark:bg-indigo-950/40"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
          selected
            ? "bg-indigo-600 text-white"
            : "bg-zinc-100 text-zinc-600 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:group-hover:bg-zinc-700",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-sm font-semibold",
          selected ? "text-indigo-900 dark:text-indigo-100" : "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-xs",
          selected
            ? "text-indigo-700/80 dark:text-indigo-200/80"
            : "text-zinc-500 dark:text-zinc-400",
        )}
      >
        {description}
      </span>
    </button>
  );
}

function formatError(error: unknown, data: unknown): string {
  const e = (data as { error?: { code?: string } } | undefined)?.error;
  if (e?.code === "ALREADY_SENT") return "This claim has already been sent to Business Central.";
  if (e?.code === "MISSING_MAPPING")
    return `Missing mapping: ${(data as { error: { field: string } }).error.field}. Contact admin.`;
  if (e?.code === "MISSING_BC_CODE") return "Expense category has no BC account code configured.";
  if (e?.code === "DB_UPDATE_FAILED")
    return "Payment was sent to Business Central but our records could not be updated. Please contact admin.";
  if (e?.code === "BC_API_ERROR")
    return "Business Central rejected the request. Please contact admin.";
  return (error as Error | undefined)?.message ?? "Something went wrong. Please try again.";
}
