"use client";

import { useEffect, useRef, useState } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import type { ClaimFormDraftValues } from "@/modules/claims/ui/new-claim-form-client";

// ─── Storage key constants ──────────────────────────────────────────────────

const STORAGE_KEYS = {
  submissionType: "nxtclaim_v2_pref_submissionType",
  employeeId: "nxtclaim_v2_pref_employeeId",
  onBehalfEmail: "nxtclaim_v2_pref_onBehalfEmail",
  onBehalfEmployeeCode: "nxtclaim_v2_pref_onBehalfEmployeeCode",
  departmentId: "nxtclaim_v2_pref_departmentId",
  paymentModeId: "nxtclaim_v2_pref_paymentModeId",
  ccEmails: "nxtclaim_v2_pref_ccEmails",
} as const;

const TRACKED_FIELDS = [
  "submissionType",
  "employeeId",
  "onBehalfEmail",
  "onBehalfEmployeeCode",
  "departmentId",
  "paymentModeId",
  "ccEmails",
] as const satisfies ReadonlyArray<keyof ClaimFormDraftValues>;

// setValue options that restore state without triggering validation on mount.
const RESTORE_FLAGS = {
  shouldDirty: false,
  shouldTouch: false,
  shouldValidate: false,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type AutofillOptions = {
  departments: { id: string }[];
  paymentModes: { id: string }[];
};

export type UseClaimFormAutofillReturn = {
  /** True once the localStorage read on mount has completed. */
  hydrated: boolean;
  /** True if at least one non-empty value was restored from localStorage. */
  wasAutoFilled: boolean;
  /** Removes all tracked localStorage keys and resets the form fields to blank defaults. */
  clearDefaults: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reads a key from localStorage and returns the stored string, or null on any error. */
function readStorageString(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" && parsed.trim().length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Bridges React Hook Form with `localStorage` for the Claim Submission Form's
 * "Submission Context" fields.
 *
 * - **Mount:** reads the 7 tracked fields from `localStorage` and injects them
 *   into the RHF form via `setValue`. UUID-based fields (departmentId,
 *   paymentModeId) are validated against the live options list; invalid UUIDs
 *   silently fall back to the first available option.
 * - **Change → persist:** watches all 7 fields via `useWatch`; debounce-writes
 *   (300 ms) each change back to `localStorage`.
 * - **clearDefaults:** removes all tracked keys from `localStorage` and resets
 *   the form to blank defaults.
 */
export function useClaimFormAutofill(
  form: UseFormReturn<ClaimFormDraftValues>,
  options: AutofillOptions,
): UseClaimFormAutofillReturn {
  const [hydrated, setHydrated] = useState(false);
  const [wasAutoFilled, setWasAutoFilled] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mount: restore values from localStorage ──────────────────────────────
  useEffect(() => {
    const { setValue } = form;
    let anyFilled = false;

    // submissionType — only accept valid enum values
    const submissionType = readStorageString(STORAGE_KEYS.submissionType);
    if (submissionType === "Self" || submissionType === "On Behalf") {
      setValue("submissionType", submissionType, RESTORE_FLAGS);
      anyFilled = true;
    }

    // employeeId
    const employeeId = readStorageString(STORAGE_KEYS.employeeId);
    if (employeeId) {
      setValue("employeeId", employeeId, RESTORE_FLAGS);
      anyFilled = true;
    }

    // onBehalfEmail
    const onBehalfEmail = readStorageString(STORAGE_KEYS.onBehalfEmail);
    if (onBehalfEmail) {
      setValue("onBehalfEmail", onBehalfEmail, RESTORE_FLAGS);
      anyFilled = true;
    }

    // onBehalfEmployeeCode
    const onBehalfEmployeeCode = readStorageString(STORAGE_KEYS.onBehalfEmployeeCode);
    if (onBehalfEmployeeCode) {
      setValue("onBehalfEmployeeCode", onBehalfEmployeeCode, RESTORE_FLAGS);
      anyFilled = true;
    }

    // departmentId — validate against live options, fall back to first if stale/missing
    const storedDepartmentId = readStorageString(STORAGE_KEYS.departmentId);
    const resolvedDepartmentId =
      storedDepartmentId && options.departments.some((d) => d.id === storedDepartmentId)
        ? storedDepartmentId
        : (options.departments[0]?.id ?? "");
    if (resolvedDepartmentId) {
      setValue("departmentId", resolvedDepartmentId, RESTORE_FLAGS);
      if (storedDepartmentId) anyFilled = true;
    }

    // paymentModeId — validate against live options, fall back to first if stale/missing
    const storedPaymentModeId = readStorageString(STORAGE_KEYS.paymentModeId);
    const resolvedPaymentModeId =
      storedPaymentModeId && options.paymentModes.some((p) => p.id === storedPaymentModeId)
        ? storedPaymentModeId
        : (options.paymentModes[0]?.id ?? "");
    if (resolvedPaymentModeId) {
      setValue("paymentModeId", resolvedPaymentModeId, RESTORE_FLAGS);
      if (storedPaymentModeId) anyFilled = true;
    }

    // ccEmails
    const ccEmails = readStorageString(STORAGE_KEYS.ccEmails);
    if (ccEmails) {
      setValue("ccEmails", ccEmails, RESTORE_FLAGS);
      anyFilled = true;
    }

    setWasAutoFilled(anyFilled);
    setHydrated(true);
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Watch all 7 fields and debounce-persist changes ───────────────────────
  const watched = useWatch({ control: form.control, name: TRACKED_FIELDS });

  useEffect(() => {
    if (!hydrated) return;

    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(() => {
      const [
        submissionType,
        employeeId,
        onBehalfEmail,
        onBehalfEmployeeCode,
        departmentId,
        paymentModeId,
        ccEmails,
      ] = watched;

      const entries: [string, string | null | undefined][] = [
        [STORAGE_KEYS.submissionType, submissionType],
        [STORAGE_KEYS.employeeId, employeeId],
        [STORAGE_KEYS.onBehalfEmail, onBehalfEmail],
        [STORAGE_KEYS.onBehalfEmployeeCode, onBehalfEmployeeCode],
        [STORAGE_KEYS.departmentId, departmentId],
        [STORAGE_KEYS.paymentModeId, paymentModeId],
        [STORAGE_KEYS.ccEmails, ccEmails],
      ];

      try {
        for (const [key, value] of entries) {
          if (value !== null && value !== undefined && value !== "") {
            localStorage.setItem(key, JSON.stringify(value));
          } else {
            localStorage.removeItem(key);
          }
        }
      } catch {
        // Storage quota exceeded or security restrictions — silently ignore.
      }
    }, 300);

    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [hydrated, watched]);

  // ── clearDefaults ─────────────────────────────────────────────────────────
  const clearDefaults = () => {
    for (const key of Object.values(STORAGE_KEYS)) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }

    const { setValue } = form;
    setValue("submissionType", "Self", RESTORE_FLAGS);
    setValue("employeeId", "", RESTORE_FLAGS);
    setValue("onBehalfEmail", null, RESTORE_FLAGS);
    setValue("onBehalfEmployeeCode", null, RESTORE_FLAGS);
    setValue("departmentId", options.departments[0]?.id ?? "", RESTORE_FLAGS);
    setValue("paymentModeId", options.paymentModes[0]?.id ?? "", RESTORE_FLAGS);
    setValue("ccEmails", undefined, RESTORE_FLAGS);
    setWasAutoFilled(false);
  };

  return { hydrated, wasAutoFilled, clearDefaults };
}
