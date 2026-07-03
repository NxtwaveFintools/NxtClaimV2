import { act, renderHook, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useClaimFormAutofill } from "@/hooks/use-claim-form-autofill";
import type { ClaimFormDraftValues } from "@/modules/claims/ui/new-claim-form-client";

const KEYS = {
  submissionType: "nxtclaim_pref_submissionType",
  employeeId: "nxtclaim_pref_employeeId",
  onBehalfEmail: "nxtclaim_pref_onBehalfEmail",
  onBehalfEmployeeCode: "nxtclaim_pref_onBehalfEmployeeCode",
  departmentId: "nxtclaim_pref_departmentId",
  paymentModeId: "nxtclaim_pref_paymentModeId",
  ccEmails: "nxtclaim_pref_ccEmails",
} as const;

function setupAutofillHook() {
  return renderHook(() => {
    const form = useForm<ClaimFormDraftValues>({
      defaultValues: {
        submissionType: "Self",
        employeeId: "",
        onBehalfEmail: null,
        onBehalfEmployeeCode: null,
        departmentId: "",
        paymentModeId: "",
        ccEmails: undefined,
      },
    });

    const hook = useClaimFormAutofill(form, {
      departments: [{ id: "dep-1" }],
      paymentModes: [{ id: "pm-1" }],
    });

    return { form, hook };
  });
}

describe("useClaimFormAutofill", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("hydrates tracked fields from localStorage and falls back for stale option IDs", async () => {
    localStorage.setItem(KEYS.submissionType, JSON.stringify("On Behalf"));
    localStorage.setItem(KEYS.employeeId, JSON.stringify("EMP-22"));
    localStorage.setItem(KEYS.onBehalfEmail, JSON.stringify("proxy@nxtwave.co.in"));
    localStorage.setItem(KEYS.onBehalfEmployeeCode, JSON.stringify("E-22"));
    localStorage.setItem(KEYS.departmentId, JSON.stringify("stale-dept"));
    localStorage.setItem(KEYS.paymentModeId, JSON.stringify("stale-mode"));
    localStorage.setItem(KEYS.ccEmails, JSON.stringify("cc@nxtwave.co.in"));

    const { result } = setupAutofillHook();

    await waitFor(() => {
      expect(result.current.hook.hydrated).toBe(true);
    });

    expect(result.current.hook.wasAutoFilled).toBe(true);

    const values = result.current.form.getValues();
    expect(values.submissionType).toBe("On Behalf");
    expect(values.employeeId).toBe("EMP-22");
    expect(values.onBehalfEmail).toBe("proxy@nxtwave.co.in");
    expect(values.onBehalfEmployeeCode).toBe("E-22");
    expect(values.departmentId).toBe("dep-1");
    expect(values.paymentModeId).toBe("pm-1");
    expect(values.ccEmails).toBe("cc@nxtwave.co.in");
  });

  test("persists watched values to localStorage after debounce", async () => {
    const { result } = setupAutofillHook();

    await waitFor(() => {
      expect(result.current.hook.hydrated).toBe(true);
    });

    act(() => {
      result.current.form.setValue("submissionType", "On Behalf");
      result.current.form.setValue("employeeId", "EMP-100");
      result.current.form.setValue("onBehalfEmail", "proxy@nxtwave.co.in");
      result.current.form.setValue("onBehalfEmployeeCode", "EMP-200");
      result.current.form.setValue("departmentId", "dep-1");
      result.current.form.setValue("paymentModeId", "pm-1");
      result.current.form.setValue("ccEmails", "cc@nxtwave.co.in");
    });

    act(() => {
      jest.advanceTimersByTime(350);
    });

    expect(localStorage.getItem(KEYS.submissionType)).toBe(JSON.stringify("On Behalf"));
    expect(localStorage.getItem(KEYS.employeeId)).toBe(JSON.stringify("EMP-100"));
    expect(localStorage.getItem(KEYS.onBehalfEmail)).toBe(JSON.stringify("proxy@nxtwave.co.in"));
    expect(localStorage.getItem(KEYS.onBehalfEmployeeCode)).toBe(JSON.stringify("EMP-200"));
    expect(localStorage.getItem(KEYS.departmentId)).toBe(JSON.stringify("dep-1"));
    expect(localStorage.getItem(KEYS.paymentModeId)).toBe(JSON.stringify("pm-1"));
    expect(localStorage.getItem(KEYS.ccEmails)).toBe(JSON.stringify("cc@nxtwave.co.in"));
  });

  test("clearDefaults resets form values and removes localStorage keys", async () => {
    localStorage.setItem(KEYS.employeeId, JSON.stringify("EMP-22"));
    localStorage.setItem(KEYS.ccEmails, JSON.stringify("cc@nxtwave.co.in"));

    const { result } = setupAutofillHook();

    await waitFor(() => {
      expect(result.current.hook.hydrated).toBe(true);
    });

    act(() => {
      result.current.hook.clearDefaults();
    });

    for (const key of Object.values(KEYS)) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    const values = result.current.form.getValues();
    expect(values.submissionType).toBe("Self");
    expect(values.employeeId).toBe("");
    expect(values.onBehalfEmail).toBeNull();
    expect(values.onBehalfEmployeeCode).toBeNull();
    expect(values.departmentId).toBe("dep-1");
    expect(values.paymentModeId).toBe("pm-1");
    expect(values.ccEmails).toBeUndefined();
    expect(result.current.hook.wasAutoFilled).toBe(false);
  });
});
