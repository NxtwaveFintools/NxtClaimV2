"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getBrowserSupabaseClient } from "@/core/infra/supabase/browser-client";
import { cn } from "@/lib/cn";

// ─── Types ─────────────────────────────────────────────────────────────────

type Vendor = { no: string; name: string };
type ReferenceOption = { code: string; description: string };
type ReferenceType = "currencies" | "gstGroupCodes" | "hsnSacCodes";

type ReferenceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; options: ReferenceOption[] }
  | { status: "error"; message: string };

type PaymentType = "non_vendor" | "vendor";

// idle ─ submitting ─ success ─ recoverable_error ─ catastrophic.
// catastrophic blocks retry permanently; user must close and contact admin.
type Lifecycle =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "recoverable_error"; message: string }
  | { phase: "catastrophic"; bcClaimDetailsId: string; message: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  onSuccess: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────

export function BcClaimModal({ open, onOpenChange, claimId, onSuccess }: Props) {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);

  // Vendor toggle + search.
  const [paymentType, setPaymentType] = useState<PaymentType | null>(null);
  const [vendorQuery, setVendorQuery] = useState("");
  const debouncedQuery = useDebouncedValue(vendorQuery, 300);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [searching, setSearching] = useState(false);
  const [vendorSearchError, setVendorSearchError] = useState<string | null>(null);

  // Three reference dropdowns, each with its own micro-lifecycle.
  const [currencies, setCurrencies] = useState<ReferenceState>({ status: "idle" });
  const [gstGroups, setGstGroups] = useState<ReferenceState>({ status: "idle" });
  const [hsnSacs, setHsnSacs] = useState<ReferenceState>({ status: "idle" });

  // Selected reference values.
  const [currencyCode, setCurrencyCode] = useState("");
  const [gstGroupCode, setGstGroupCode] = useState("");
  const [hsnSacCode, setHsnSacCode] = useState("");

  // Overall submission lifecycle.
  const [lifecycle, setLifecycle] = useState<Lifecycle>({ phase: "idle" });

  const submitting = lifecycle.phase === "submitting";
  const catastrophic = lifecycle.phase === "catastrophic";

  // ─── Reference fetcher ──────────────────────────────────────────────────
  // The Supabase JS `functions.invoke()` helper doesn't expose a query-param
  // surface for GET-style edge functions, so we call the function URL directly
  // and attach the user's bearer token. This is the same approach the rest of
  // the codebase uses for GET-style edge calls.

  const fetchReference = useCallback(
    async (type: ReferenceType, setter: (s: ReferenceState) => void) => {
      setter({ status: "loading" });
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const url = `${supabaseUrl}/functions/v1/bc-reference?type=${type}`;
        const res = await fetch(url, {
          method: "GET",
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as Record<string, unknown>);
          const message =
            typeof (body as { error?: unknown }).error === "string"
              ? (body as { error: string }).error
              : `Failed to load (HTTP ${res.status})`;
          setter({ status: "error", message });
          return;
        }
        const parsed = (await res.json()) as { value: ReferenceOption[] };
        setter({ status: "loaded", options: parsed.value ?? [] });
      } catch (err) {
        setter({
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    },
    [supabase],
  );

  // Lazy-load reference data the first time Vendor is toggled on.
  useEffect(() => {
    if (paymentType !== "vendor") return;
    if (currencies.status === "idle") void fetchReference("currencies", setCurrencies);
    if (gstGroups.status === "idle") void fetchReference("gstGroupCodes", setGstGroups);
    if (hsnSacs.status === "idle") void fetchReference("hsnSacCodes", setHsnSacs);
  }, [paymentType, currencies.status, gstGroups.status, hsnSacs.status, fetchReference]);

  // ─── Vendor search ─────────────────────────────────────────────────────

  const shouldSearch =
    paymentType === "vendor" && !selectedVendor && debouncedQuery.trim().length > 0;
  const visibleVendors = shouldSearch ? vendors : [];

  useEffect(() => {
    if (!shouldSearch) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    supabase.functions
      .invoke("bc-vendor-search", { body: { query: debouncedQuery } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setVendors([]);
          setVendorSearchError(error.message);
          return;
        }
        setVendors((data?.vendors ?? []) as Vendor[]);
        setVendorSearchError(null);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, shouldSearch, supabase]);

  // ─── Reset state on close ─────────────────────────────────────────────

  function resetState() {
    setPaymentType(null);
    setVendorQuery("");
    setVendors([]);
    setSelectedVendor(null);
    setSearching(false);
    setVendorSearchError(null);
    setCurrencies({ status: "idle" });
    setGstGroups({ status: "idle" });
    setHsnSacs({ status: "idle" });
    setCurrencyCode("");
    setGstGroupCode("");
    setHsnSacCode("");
    setLifecycle({ phase: "idle" });
  }

  function handleDialogChange(next: boolean) {
    if (submitting) return; // can't close mid-flight
    if (!next) resetState();
    onOpenChange(next);
  }

  function clearSelectedVendor() {
    setSelectedVendor(null);
    setVendorQuery("");
  }

  // ─── Submit ────────────────────────────────────────────────────────────

  const vendorComplete =
    paymentType === "vendor"
      ? Boolean(selectedVendor) && currencyCode && gstGroupCode && hsnSacCode
      : true;

  const canSubmit = !submitting && !catastrophic && paymentType !== null && vendorComplete;

  async function handleSubmit() {
    setLifecycle({ phase: "submitting" });
    const body =
      paymentType === "vendor"
        ? {
            claimId,
            isVendorPayment: true,
            bcVendorCode: selectedVendor!.no,
            bcVendorName: selectedVendor!.name,
            currencyCode,
            gstGroupCode,
            hsnSacCode,
          }
        : { claimId, isVendorPayment: false };

    const { data, error } = await supabase.functions.invoke("bc-claim", { body });

    if (error && !data) {
      setLifecycle({
        phase: "recoverable_error",
        message: error.message || "Network error contacting BC.",
      });
      return;
    }

    const result = data as
      | { success: true; bcClaimDetailsId: string }
      | { success: false; error: BcClaimErrorPayload };

    if (result?.success === true) {
      toast.success("Submitted to Business Central. Claim is now Finance Approved.");
      onSuccess();
      handleDialogChange(false);
      return;
    }

    if (result?.error?.code === "RPC_FAILED_AFTER_BC_SUCCESS") {
      setLifecycle({
        phase: "catastrophic",
        bcClaimDetailsId: result.error.bcClaimDetailsId,
        message:
          "BC accepted this submission but the local sync failed. Do NOT retry. Contact admin so they can reconcile manually.",
      });
      return;
    }

    setLifecycle({ phase: "recoverable_error", message: formatError(result?.error) });
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="space-y-2 border-b border-zinc-100 pb-5 dark:border-zinc-800">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400">
            Business Central · Finance Approval
          </p>
          <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Send to Business Central
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Choose how this claim should be paid. On submit, the claim transitions to{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              Finance Approved &mdash; Payment under process
            </span>{" "}
            and cannot be re-submitted.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 space-y-7">
          <Section number="01" label="Payment Type">
            <fieldset disabled={submitting || catastrophic}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </Section>

          {paymentType === "vendor" && (
            <>
              <Section number="02" label="Vendor">
                <VendorPicker
                  selectedVendor={selectedVendor}
                  vendorQuery={vendorQuery}
                  onQueryChange={setVendorQuery}
                  visibleVendors={visibleVendors}
                  shouldSearch={shouldSearch}
                  searching={searching}
                  onSelect={(v) => {
                    setSelectedVendor(v);
                    setVendorQuery("");
                    setVendors([]);
                  }}
                  onClear={clearSelectedVendor}
                  debouncedQuery={debouncedQuery}
                  error={vendorSearchError}
                  disabled={submitting || catastrophic}
                />
              </Section>

              <Section number="03" label="Reference Codes">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <ReferenceField
                    label="Currency"
                    state={currencies}
                    value={currencyCode}
                    onChange={setCurrencyCode}
                    onRetry={() => fetchReference("currencies", setCurrencies)}
                    disabled={submitting || catastrophic}
                  />
                  <ReferenceField
                    label="GST Group"
                    state={gstGroups}
                    value={gstGroupCode}
                    onChange={setGstGroupCode}
                    onRetry={() => fetchReference("gstGroupCodes", setGstGroups)}
                    disabled={submitting || catastrophic}
                  />
                  <ReferenceField
                    label="HSN / SAC"
                    state={hsnSacs}
                    value={hsnSacCode}
                    onChange={setHsnSacCode}
                    onRetry={() => fetchReference("hsnSacCodes", setHsnSacs)}
                    disabled={submitting || catastrophic}
                  />
                </div>
              </Section>
            </>
          )}

          {lifecycle.phase === "recoverable_error" && (
            <ErrorBanner tone="rose" icon={<AlertTriangle className="h-4 w-4" />}>
              {lifecycle.message}
            </ErrorBanner>
          )}

          {lifecycle.phase === "catastrophic" && (
            <ErrorBanner tone="amber" icon={<ShieldAlert className="h-4 w-4" />}>
              <div className="space-y-1">
                <p className="font-semibold">Submission accepted by BC but local sync failed</p>
                <p>{lifecycle.message}</p>
                <p className="font-mono text-xs">
                  bc_claim_details_id: {lifecycle.bcClaimDetailsId}
                </p>
              </div>
            </ErrorBanner>
          )}
        </div>

        <DialogFooter className="mt-7 gap-2 border-t border-zinc-100 pt-5 sm:gap-3 dark:border-zinc-800">
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleDialogChange(false)}
            disabled={submitting}
          >
            {catastrophic ? "Close" : "Cancel"}
          </Button>
          {!catastrophic && (
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={submitting}
              loadingText="Submitting to BC…"
            >
              Submit to BC
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Section({
  number,
  label,
  children,
}: {
  number: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] font-medium tracking-widest text-indigo-500 dark:text-indigo-400">
          {number}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-700 dark:text-zinc-200">
          {label}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-zinc-200 via-zinc-200 to-transparent dark:from-zinc-800 dark:via-zinc-800" />
      </div>
      {children}
    </section>
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

function VendorPicker({
  selectedVendor,
  vendorQuery,
  onQueryChange,
  visibleVendors,
  shouldSearch,
  searching,
  onSelect,
  onClear,
  debouncedQuery,
  error,
  disabled,
}: {
  selectedVendor: Vendor | null;
  vendorQuery: string;
  onQueryChange: (v: string) => void;
  visibleVendors: Vendor[];
  shouldSearch: boolean;
  searching: boolean;
  onSelect: (v: Vendor) => void;
  onClear: () => void;
  debouncedQuery: string;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      {selectedVendor ? (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              <Check className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium leading-tight">{selectedVendor.name}</span>
              <span className="font-mono text-[11px] leading-tight text-emerald-700/80 dark:text-emerald-300/70">
                {selectedVendor.no}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="ml-3 rounded-md p-1.5 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            aria-label="Clear selected vendor"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
          <FormInput
            id="bc-vendor-search"
            type="text"
            placeholder="Search vendor by name or number…"
            value={vendorQuery}
            onChange={(e) => onQueryChange(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            className="h-10 pl-10 text-sm"
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
              onClick={() => onSelect(v)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none dark:hover:bg-indigo-950/40 dark:focus:bg-indigo-950/40",
                i !== visibleVendors.length - 1 && "border-b border-zinc-100 dark:border-zinc-800",
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

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">Vendor search failed: {error}</p>
      )}
    </div>
  );
}

function ReferenceField({
  label,
  state,
  value,
  onChange,
  onRetry,
  disabled,
}: {
  label: string;
  state: ReferenceState;
  value: string;
  onChange: (v: string) => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</label>

      {state.status === "loading" && (
        <div className="flex h-10 w-full items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50/50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Loading {label.toLowerCase()}…
        </div>
      )}

      {state.status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
          title={state.message}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}

      {state.status === "loaded" && (
        <SearchableCombobox
          options={state.options}
          value={value}
          onChange={onChange}
          placeholder={state.options.length === 0 ? "No options" : `Select ${label.toLowerCase()}…`}
          disabled={disabled}
        />
      )}

      {state.status === "idle" && (
        <div className="flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
          Not loaded
        </div>
      )}
    </div>
  );
}

function ErrorBanner({
  tone,
  icon,
  children,
}: {
  tone: "rose" | "amber";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-xl border px-3 py-2 text-sm",
        tone === "rose" &&
          "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200",
        tone === "amber" &&
          "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ─── Error mapping ─────────────────────────────────────────────────────────

type BcClaimErrorPayload =
  | { code: "UNAUTHENTICATED" }
  | { code: "INVALID_BODY"; details: string[] }
  | { code: "CLAIM_NOT_FOUND"; claimId: string }
  | { code: "ALREADY_SUBMITTED"; bcClaimDetailsId: string | null }
  | { code: "ALREADY_IN_FLIGHT" }
  | { code: "MISSING_MAPPING"; detail?: string }
  | { code: "BC_FETCH_FAILED"; status: number; body: unknown }
  | { code: "RPC_FAILED_AFTER_BC_SUCCESS"; bcClaimDetailsId: string; detail: string };

function formatError(err: BcClaimErrorPayload | undefined): string {
  if (!err) return "Something went wrong. Please try again.";
  switch (err.code) {
    case "UNAUTHENTICATED":
      return "Your session expired. Sign in again and retry.";
    case "INVALID_BODY":
      return `Invalid input: ${err.details.join(", ")}`;
    case "CLAIM_NOT_FOUND":
      return `Claim ${err.claimId} no longer exists.`;
    case "ALREADY_SUBMITTED":
      return "This claim was already submitted to Business Central.";
    case "ALREADY_IN_FLIGHT":
      return "Another submission for this claim is already in flight. Try again in a moment.";
    case "MISSING_MAPPING":
      return `Mapping missing — ${err.detail ?? "contact admin"}.`;
    case "BC_FETCH_FAILED":
      return `Business Central rejected the request (HTTP ${err.status}). Contact admin.`;
    case "RPC_FAILED_AFTER_BC_SUCCESS":
      // Handled separately via catastrophic phase.
      return "Local sync failed after BC accepted.";
    default:
      return "Something went wrong. Please try again.";
  }
}
