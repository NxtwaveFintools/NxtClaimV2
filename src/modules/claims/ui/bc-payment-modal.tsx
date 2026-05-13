"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getBrowserSupabaseClient } from "@/core/infra/supabase/browser-client";

type Vendor = { no: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  onSuccess: () => void;
};

export function BcPaymentModal({ open, onOpenChange, claimId, onSuccess }: Props) {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [paymentType, setPaymentType] = useState<"non_vendor" | "vendor" | null>(null);
  const [vendorQuery, setVendorQuery] = useState("");
  const debouncedQuery = useDebouncedValue(vendorQuery, 300);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shouldSearch = paymentType === "vendor" && debouncedQuery.trim().length > 0;
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
    onSuccess();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to Business Central</DialogTitle>
          <DialogDescription>
            Choose how this Reimbursement claim should be paid. Confirm submits the line items to
            Business Central; this cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Payment Type</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bc-payment-type"
                checked={paymentType === "non_vendor"}
                onChange={() => {
                  setPaymentType("non_vendor");
                  setSelectedVendor(null);
                }}
              />
              Non-Vendor Payment
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="bc-payment-type"
                checked={paymentType === "vendor"}
                onChange={() => setPaymentType("vendor")}
              />
              Vendor Payment
            </label>
          </fieldset>

          {paymentType === "vendor" && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search vendor by name or ID"
                value={vendorQuery}
                onChange={(e) => {
                  setVendorQuery(e.target.value);
                  setSelectedVendor(null);
                }}
                className="w-full border rounded px-3 py-2"
              />
              {searching && <p className="text-xs text-zinc-500">Searching…</p>}
              {visibleVendors.length > 0 && (
                <ul className="max-h-48 overflow-auto border rounded">
                  {visibleVendors.map((v) => (
                    <li key={v.no}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedVendor(v);
                          setVendorQuery(`${v.name} (${v.no})`);
                          setVendors([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-zinc-100"
                      >
                        {v.name} ({v.no})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedVendor && (
                <p className="text-xs text-emerald-700">
                  Selected: {selectedVendor.name} ({selectedVendor.no})
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="px-4 py-2 border rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 bg-zinc-900 text-white rounded disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Confirm"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
