"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  submitClaimAction,
  type ClaimFormOptions,
  type CurrentUserHydration,
} from "@/modules/claims/actions";
import { parseReceiptAction } from "@/modules/claims/actions/parse-receipt";
import { newClaimSubmitSchema } from "@/modules/claims/validators/new-claim-schema";

type NewClaimFormClientProps = {
  currentUser: CurrentUserHydration;
  options: ClaimFormOptions;
};

type ClaimFormDraftValues = {
  employeeName: string;
  employeeId: string;
  ccEmails?: string;
  hodName: string;
  hodEmail: string;
  submissionType: "Self" | "On Behalf";
  onBehalfEmail: string | null;
  onBehalfEmployeeCode: string | null;
  departmentId: string;
  paymentModeId: string;
  detailType: "expense" | "advance";
  expense: {
    billNo: string;
    purpose: string;
    expenseCategoryId: string;
    productId: string;
    locationId: string;
    isGstApplicable: boolean;
    gstNumber: string | null;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    transactionDate: string;
    basicAmount: number;
    totalAmount: number;
    currencyCode: string;
    vendorName: string | null;
    receiptFileName: string;
    receiptFileType: string;
    receiptFileBase64: string;
    bankStatementFileName: string | null;
    bankStatementFileType: string | null;
    bankStatementFileBase64: string | null;
    peopleInvolved: string | null;
    remarks: string | null;
  };
  advance: {
    requestedAmount: number;
    budgetMonth: number;
    budgetYear: number;
    expectedUsageDate: string | null;
    purpose: string;
    receiptFileName: string | null;
    receiptFileBase64: string | null;
    productId: string | null;
    locationId: string | null;
    remarks: string | null;
  };
};

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function validateUploadFile(file: File, fieldLabel: string): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${fieldLabel} exceeds 25MB.`;
  }

  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
    return `${fieldLabel} must be an image or PDF.`;
  }

  return null;
}

function calculateExpenseTotal(
  basicAmountValue: number,
  cgstAmountValue: number,
  sgstAmountValue: number,
  igstAmountValue: number,
  isGstApplicableValue: boolean,
): number {
  const safeBasicAmount = Number.isFinite(basicAmountValue) ? basicAmountValue : 0;
  const safeCgstAmount =
    isGstApplicableValue && Number.isFinite(cgstAmountValue) ? cgstAmountValue : 0;
  const safeSgstAmount =
    isGstApplicableValue && Number.isFinite(sgstAmountValue) ? sgstAmountValue : 0;
  const safeIgstAmount =
    isGstApplicableValue && Number.isFinite(igstAmountValue) ? igstAmountValue : 0;

  return (
    Math.round((safeBasicAmount + safeCgstAmount + safeSgstAmount + safeIgstAmount) * 100) / 100
  );
}

function appendFormDataValue(
  formData: FormData,
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  if (value === null || value === undefined) {
    formData.append(key, "");
    return;
  }

  formData.append(key, String(value));
}

export function NewClaimFormClient({ currentUser, options }: NewClaimFormClientProps) {
  const router = useRouter();
  const [, startNavTransition] = useTransition();
  const [fileError, setFileError] = useState<string | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [bankStatementFile, setBankStatementFile] = useState<File | null>(null);
  const [advanceSupportingFile, setAdvanceSupportingFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAiParsing, setIsAiParsing] = useState(false);

  const defaultPaymentMode = options.paymentModes[0];

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<ClaimFormDraftValues>({
    resolver: zodResolver(newClaimSubmitSchema as never),
    defaultValues: {
      employeeName: currentUser.name,
      employeeId: "",
      ccEmails: undefined,
      hodName: "",
      hodEmail: "",
      submissionType: "Self",
      onBehalfEmail: null,
      onBehalfEmployeeCode: null,
      departmentId: options.departments[0]?.id ?? "",
      paymentModeId: defaultPaymentMode?.id ?? "",
      detailType: defaultPaymentMode?.detailType ?? "expense",
      expense: {
        billNo: "",
        purpose: "",
        expenseCategoryId: options.expenseCategories[0]?.id ?? "",
        productId: options.products[0]?.id ?? "",
        locationId: options.locations[0]?.id ?? "",
        isGstApplicable: false,
        gstNumber: null,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        transactionDate: "",
        basicAmount: 0,
        totalAmount: 0,
        currencyCode: "INR",
        vendorName: null,
        receiptFileName: "",
        receiptFileType: "",
        receiptFileBase64: "",
        bankStatementFileName: null,
        bankStatementFileType: null,
        bankStatementFileBase64: null,
        peopleInvolved: null,
        remarks: null,
      },
      advance: {
        requestedAmount: 0,
        budgetMonth: new Date().getMonth() + 1,
        budgetYear: new Date().getFullYear(),
        expectedUsageDate: "",
        purpose: "",
        receiptFileName: null,
        receiptFileBase64: null,
        productId: null,
        locationId: null,
        remarks: null,
      },
    },
  });

  const submissionType = useWatch({ control, name: "submissionType" });
  const paymentModeId = useWatch({ control, name: "paymentModeId" });
  const detailType = useWatch({ control, name: "detailType" });
  const departmentId = useWatch({ control, name: "departmentId" });
  const isGstApplicable = useWatch({ control, name: "expense.isGstApplicable" });
  const basicAmount = useWatch({ control, name: "expense.basicAmount" });
  const cgstAmount = useWatch({ control, name: "expense.cgstAmount" });
  const sgstAmount = useWatch({ control, name: "expense.sgstAmount" });
  const igstAmount = useWatch({ control, name: "expense.igstAmount" });

  useEffect(() => {
    const mode = options.paymentModes.find((item) => item.id === paymentModeId);
    if (mode && mode.detailType !== detailType) {
      setValue("detailType", mode.detailType, { shouldValidate: true });
    }
  }, [detailType, options.paymentModes, paymentModeId, setValue]);

  useEffect(() => {
    if (submissionType === "Self") {
      setValue("onBehalfEmail", null, { shouldValidate: true });
      setValue("onBehalfEmployeeCode", null, { shouldValidate: true });
    }
  }, [setValue, submissionType]);

  useEffect(() => {
    if (!isGstApplicable) {
      setValue("expense.gstNumber", null, { shouldValidate: true });
      setValue("expense.cgstAmount", 0, { shouldValidate: true });
      setValue("expense.sgstAmount", 0, { shouldValidate: true });
      setValue("expense.igstAmount", 0, { shouldValidate: true });
    }
  }, [isGstApplicable, setValue]);

  useEffect(() => {
    const calculatedTotal = calculateExpenseTotal(
      basicAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      isGstApplicable,
    );

    setValue("expense.totalAmount", calculatedTotal, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: true,
    });
  }, [basicAmount, cgstAmount, igstAmount, isGstApplicable, setValue, sgstAmount]);

  const calculatedTotalAmount = calculateExpenseTotal(
    basicAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    isGstApplicable,
  );

  const selectedDepartment = useMemo(
    () => options.departmentRouting.find((department) => department.id === departmentId) ?? null,
    [departmentId, options.departmentRouting],
  );

  const resolvedL1Approver = useMemo(() => {
    if (!selectedDepartment) {
      return null;
    }

    if (currentUser.isGlobalHod || currentUser.id === selectedDepartment.hod.id) {
      return selectedDepartment.founder;
    }

    return selectedDepartment.hod;
  }, [currentUser.id, currentUser.isGlobalHod, selectedDepartment]);

  const l1ApproverLabel = currentUser.isGlobalHod
    ? "Approver (Finance/Senior)"
    : "Head of Department";
  const l1ApproverEmailLabel = currentUser.isGlobalHod ? "Approver Email" : "HOD Email";

  useEffect(() => {
    setValue("employeeName", currentUser.name, { shouldValidate: true });
  }, [currentUser.name, setValue]);

  useEffect(() => {
    const hodName = resolvedL1Approver?.fullName ?? resolvedL1Approver?.email ?? "";
    const hodEmail = resolvedL1Approver?.email ?? "";
    setValue("hodName", hodName, { shouldValidate: true });
    setValue("hodEmail", hodEmail, { shouldValidate: true });
  }, [resolvedL1Approver, setValue]);

  const getFirstFormErrorMessage = (
    formErrors: FieldErrors<ClaimFormDraftValues>,
  ): string | null => {
    const findMessage = (value: unknown): string | null => {
      if (!value) {
        return null;
      }

      if (typeof value === "object" && value !== null && "message" in value) {
        const message = (value as { message?: unknown }).message;
        if (typeof message === "string" && message.trim().length > 0) {
          return message;
        }
      }

      if (typeof value === "object" && value !== null) {
        for (const child of Object.values(value as Record<string, unknown>)) {
          const nestedMessage = findMessage(child);
          if (nestedMessage) {
            return nestedMessage;
          }
        }
      }

      return null;
    };

    return findMessage(formErrors);
  };

  const onValidSubmit = async (values: ClaimFormDraftValues) => {
    if (values.detailType === "expense") {
      if (!invoiceFile) {
        setIsSubmitting(false);
        setFileError("Invoice/Bill upload is required.");
        toast.error("Invoice/Bill upload is required.");
        return;
      }

      const invoiceValidationError = validateUploadFile(invoiceFile, "Invoice/Bill file");
      if (invoiceValidationError) {
        setIsSubmitting(false);
        setFileError(invoiceValidationError);
        toast.error(invoiceValidationError);
        return;
      }

      if (bankStatementFile) {
        const bankValidationError = validateUploadFile(bankStatementFile, "Bank statement file");
        if (bankValidationError) {
          setIsSubmitting(false);
          setFileError(bankValidationError);
          toast.error(bankValidationError);
          return;
        }
      }
    } else if (advanceSupportingFile) {
      const advanceValidationError = validateUploadFile(
        advanceSupportingFile,
        "Supporting document",
      );
      if (advanceValidationError) {
        setIsSubmitting(false);
        setFileError(advanceValidationError);
        toast.error(advanceValidationError);
        return;
      }
    }

    const normalizedEmployeeName = currentUser.name;
    const normalizedHodName = resolvedL1Approver?.fullName ?? resolvedL1Approver?.email ?? "";
    const normalizedHodEmail = resolvedL1Approver?.email ?? "";

    const formData = new FormData();
    appendFormDataValue(formData, "employeeName", normalizedEmployeeName);
    appendFormDataValue(formData, "employeeId", values.employeeId);
    appendFormDataValue(formData, "ccEmails", values.ccEmails ?? "");
    appendFormDataValue(formData, "hodName", normalizedHodName);
    appendFormDataValue(formData, "hodEmail", normalizedHodEmail);
    appendFormDataValue(formData, "submissionType", values.submissionType);
    appendFormDataValue(
      formData,
      "onBehalfEmail",
      values.submissionType === "On Behalf" ? values.onBehalfEmail : null,
    );
    appendFormDataValue(
      formData,
      "onBehalfEmployeeCode",
      values.submissionType === "On Behalf" ? values.onBehalfEmployeeCode : null,
    );
    appendFormDataValue(formData, "departmentId", values.departmentId);
    appendFormDataValue(formData, "paymentModeId", values.paymentModeId);
    appendFormDataValue(formData, "detailType", values.detailType);

    if (values.detailType === "expense") {
      appendFormDataValue(formData, "expense.billNo", values.expense.billNo);
      appendFormDataValue(formData, "expense.purpose", values.expense.purpose);
      appendFormDataValue(formData, "expense.expenseCategoryId", values.expense.expenseCategoryId);
      appendFormDataValue(formData, "expense.productId", values.expense.productId);
      appendFormDataValue(formData, "expense.locationId", values.expense.locationId);
      appendFormDataValue(formData, "expense.isGstApplicable", values.expense.isGstApplicable);
      appendFormDataValue(formData, "expense.gstNumber", values.expense.gstNumber);
      appendFormDataValue(formData, "expense.cgstAmount", values.expense.cgstAmount);
      appendFormDataValue(formData, "expense.sgstAmount", values.expense.sgstAmount);
      appendFormDataValue(formData, "expense.igstAmount", values.expense.igstAmount);
      appendFormDataValue(formData, "expense.transactionDate", values.expense.transactionDate);
      appendFormDataValue(formData, "expense.basicAmount", values.expense.basicAmount);
      appendFormDataValue(formData, "expense.currencyCode", values.expense.currencyCode);
      appendFormDataValue(formData, "expense.vendorName", values.expense.vendorName);
      appendFormDataValue(formData, "expense.peopleInvolved", values.expense.peopleInvolved);
      appendFormDataValue(formData, "expense.remarks", values.expense.remarks);
      appendFormDataValue(formData, "expense.receiptFileName", "");
      appendFormDataValue(formData, "expense.receiptFileType", "");
      appendFormDataValue(formData, "expense.receiptFileBase64", "");
      appendFormDataValue(formData, "expense.bankStatementFileName", "");
      appendFormDataValue(formData, "expense.bankStatementFileType", "");
      appendFormDataValue(formData, "expense.bankStatementFileBase64", "");

      if (invoiceFile) {
        formData.append("receiptFile", invoiceFile);
      }

      if (bankStatementFile) {
        formData.append("bankStatementFile", bankStatementFile);
      }
    } else {
      appendFormDataValue(formData, "advance.requestedAmount", values.advance.requestedAmount);
      appendFormDataValue(formData, "advance.budgetMonth", values.advance.budgetMonth);
      appendFormDataValue(formData, "advance.budgetYear", values.advance.budgetYear);
      appendFormDataValue(formData, "advance.expectedUsageDate", values.advance.expectedUsageDate);
      appendFormDataValue(formData, "advance.purpose", values.advance.purpose);
      appendFormDataValue(formData, "advance.receiptFileName", values.advance.receiptFileName);
      appendFormDataValue(formData, "advance.receiptFileBase64", values.advance.receiptFileBase64);
      appendFormDataValue(formData, "advance.productId", values.advance.productId);
      appendFormDataValue(formData, "advance.locationId", values.advance.locationId);
      appendFormDataValue(formData, "advance.remarks", values.advance.remarks);

      if (advanceSupportingFile) {
        formData.append("advanceReceiptFile", advanceSupportingFile);
      }
    }

    try {
      const result = await submitClaimAction(formData);
      if (!result.ok) {
        if (result.errorCode === "DUPLICATE_TRANSACTION") {
          toast.error("A claim with this exact Bill No, Date, and Amount already exists.");
          return;
        }

        toast.error(result.message ?? "Failed to submit claim.");
        return;
      }

      toast.success("Claim submitted successfully!");
      startNavTransition(() => {
        router.push("/dashboard/my-claims", { scroll: false });
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onInvalidSubmit = (formErrors: FieldErrors<ClaimFormDraftValues>) => {
    setIsSubmitting(false);
    const firstError =
      getFirstFormErrorMessage(formErrors) ??
      "Please fix the highlighted fields before submitting.";
    toast.error(firstError);
  };

  const handleFormSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    if (isSubmitting) {
      return;
    }

    setFileError(null);
    setIsSubmitting(true);

    const onSubmit = handleSubmit(
      async (values) => onValidSubmit(values),
      (formErrors) => onInvalidSubmit(formErrors),
    );

    void onSubmit(event);
  };

  const handleAutoFillWithAI = async () => {
    if (!invoiceFile) {
      toast.error("Invoice/Bill upload is required.");
      return;
    }

    const invoiceValidationError = validateUploadFile(invoiceFile, "Invoice/Bill file");
    if (invoiceValidationError) {
      setFileError(invoiceValidationError);
      toast.error(invoiceValidationError);
      return;
    }

    setFileError(null);
    setIsAiParsing(true);

    try {
      const formData = new FormData();
      formData.append("receiptFile", invoiceFile);

      const result = await parseReceiptAction(formData);
      if (!result.ok || !result.data) {
        toast.error(result.message ?? "Could not auto-read receipt. Please fill manually.");
        return;
      }

      const parsed = result.data;

      if (parsed.fraudFlags.length > 0) {
        toast.warning(`Receipt anomalies detected: ${parsed.fraudFlags.join(", ")}`);
      }

      if (parsed.confidenceScore < 90 || !result.autoFillAllowed) {
        toast.warning("Low confidence parse. Please fill manually.");
        return;
      }

      const hasGstAmounts = parsed.cgstAmount > 0 || parsed.sgstAmount > 0 || parsed.igstAmount > 0;

      setValue("expense.billNo", parsed.billNo ?? "", {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.transactionDate", parsed.transactionDate ?? "", {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.basicAmount", parsed.basicAmount, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.isGstApplicable", hasGstAmounts, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.cgstAmount", parsed.cgstAmount, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.sgstAmount", parsed.sgstAmount, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.igstAmount", parsed.igstAmount, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.vendorName", parsed.vendorName, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });

      toast.success("Receipt parsed and form fields auto-filled.");
    } catch {
      toast.error("Could not auto-read receipt. Please fill manually.");
    } finally {
      setIsAiParsing(false);
    }
  };

  return (
    <form
      className="grid gap-5 text-zinc-900 transition-colors dark:text-zinc-100 [&_section]:rounded-xl [&_section]:border [&_section]:border-zinc-200 [&_section]:bg-white [&_section]:p-4 dark:[&_section]:border-zinc-800 dark:[&_section]:bg-zinc-900 [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_label]:text-zinc-700 dark:[&_label]:text-zinc-300 [&_input:not([type='checkbox'])]:border-zinc-300 [&_input:not([type='checkbox'])]:bg-white [&_input:not([type='checkbox'])]:text-zinc-900 dark:[&_input:not([type='checkbox'])]:border-zinc-700 dark:[&_input:not([type='checkbox'])]:bg-zinc-900/70 dark:[&_input:not([type='checkbox'])]:text-zinc-100 [&_select]:border-zinc-300 [&_select]:bg-white [&_select]:text-zinc-900 dark:[&_select]:border-zinc-700 dark:[&_select]:bg-zinc-900/70 dark:[&_select]:text-zinc-100 [&_textarea]:border-zinc-300 [&_textarea]:bg-white [&_textarea]:text-zinc-900 dark:[&_textarea]:border-zinc-700 dark:[&_textarea]:bg-zinc-900/70 dark:[&_textarea]:text-zinc-100 [&_input[type='file']]:file:mr-3 [&_input[type='file']]:file:rounded-md [&_input[type='file']]:file:border-0 [&_input[type='file']]:file:bg-zinc-100 [&_input[type='file']]:file:px-3 [&_input[type='file']]:file:py-1 [&_input[type='file']]:file:text-zinc-700 dark:[&_input[type='file']]:file:bg-zinc-800 dark:[&_input[type='file']]:file:text-zinc-200"
      onSubmit={handleFormSubmit}
    >
      <input type="hidden" {...register("employeeName")} />
      <input type="hidden" {...register("hodName")} />
      <input type="hidden" {...register("hodEmail")} />

      <section className="grid gap-4 rounded-xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Employee Details</h2>

        <div className="grid gap-1 sm:grid-cols-2 sm:gap-4">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-zinc-700">Employee Name</label>
            <input
              value={currentUser.name}
              readOnly
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-zinc-700">Employee Email</label>
            <input
              value={currentUser.email}
              readOnly
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Submission Context</h2>

        <div className="grid gap-1">
          <label htmlFor="submissionType" className="text-sm font-medium text-zinc-700">
            Submission Type <span className="text-rose-600">*</span>
          </label>
          <select
            id="submissionType"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            {...register("submissionType")}
          >
            <option value="Self">Self</option>
            <option value="On Behalf">On Behalf</option>
          </select>
        </div>

        {submissionType === "On Behalf" ? (
          <>
            <div className="grid gap-1">
              <label htmlFor="onBehalfEmail" className="text-sm font-medium text-zinc-700">
                On Behalf Email (Required for On Behalf)
              </label>
              <input
                id="onBehalfEmail"
                type="email"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("onBehalfEmail", {
                  setValueAs: (value) => toNullable(String(value ?? "")),
                })}
              />
              {errors.onBehalfEmail ? (
                <p className="text-xs text-rose-600">{errors.onBehalfEmail.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1">
              <label htmlFor="onBehalfEmployeeCode" className="text-sm font-medium text-zinc-700">
                On Behalf Employee ID (Required for On Behalf)
              </label>
              <input
                id="onBehalfEmployeeCode"
                type="text"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("onBehalfEmployeeCode", {
                  setValueAs: (value) => toNullable(String(value ?? "")),
                })}
              />
              {errors.onBehalfEmployeeCode ? (
                <p className="text-xs text-rose-600">{errors.onBehalfEmployeeCode.message}</p>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="grid gap-1">
          <label htmlFor="departmentId" className="text-sm font-medium text-zinc-700">
            Department <span className="text-rose-600">*</span>
          </label>
          <select
            id="departmentId"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            {...register("departmentId")}
          >
            {options.departments.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {errors.departmentId ? (
            <p className="text-xs text-rose-600">{errors.departmentId.message}</p>
          ) : null}
        </div>

        <div className="grid gap-1 sm:grid-cols-2 sm:gap-4">
          <div className="grid gap-1">
            <label htmlFor="employeeId" className="text-sm font-medium text-zinc-700">
              Employee ID <span className="text-rose-600">*</span>
            </label>
            <input
              id="employeeId"
              type="text"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              {...register("employeeId")}
            />
            {errors.employeeId ? (
              <p className="text-xs text-rose-600">{errors.employeeId.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1">
            <label htmlFor="ccEmails" className="text-sm font-medium text-zinc-700">
              CC Emails (Optional)
            </label>
            <input
              id="ccEmails"
              type="text"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="user1@example.com, user2@example.com"
              {...register("ccEmails", {
                setValueAs: (value) => toOptional(String(value ?? "")),
              })}
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-zinc-700">{l1ApproverLabel}</label>
            <input
              value={resolvedL1Approver?.fullName ?? resolvedL1Approver?.email ?? "Not available"}
              readOnly
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            />
            {errors.hodName ? (
              <p className="text-xs text-rose-600">{errors.hodName.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-zinc-700">{l1ApproverEmailLabel}</label>
            <input
              value={resolvedL1Approver?.email ?? "Not available"}
              readOnly
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            />
            {errors.hodEmail ? (
              <p className="text-xs text-rose-600">{errors.hodEmail.message}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-1">
          <label htmlFor="paymentModeId" className="text-sm font-medium text-zinc-700">
            Payment Mode <span className="text-rose-600">*</span>
          </label>
          <select
            id="paymentModeId"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            {...register("paymentModeId")}
          >
            {options.paymentModes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {errors.paymentModeId ? (
            <p className="text-xs text-rose-600">{errors.paymentModeId.message}</p>
          ) : null}
        </div>
      </section>

      {detailType === "expense" ? (
        <section className="grid gap-4 rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900">Expense Details</h2>
            <button
              type="button"
              onClick={handleAutoFillWithAI}
              disabled={isSubmitting || isAiParsing || !invoiceFile}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 transition-all duration-200 hover:bg-indigo-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
            >
              {isAiParsing ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    fill="none"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      stroke="currentColor"
                      strokeOpacity="0.3"
                      strokeWidth="2"
                    />
                    <path
                      d="M10 3a7 7 0 0 1 7 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Auto-filling...
                </>
              ) : (
                "✨ Auto-fill with AI"
              )}
            </button>
          </div>

          <input type="hidden" {...register("detailType")} value="expense" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="receiptFile" className="text-sm font-medium text-zinc-700">
                Invoice/Bill <span className="text-rose-600">*</span>
              </label>
              <input
                id="receiptFile"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  setInvoiceFile(selectedFile);
                  setValue("expense.receiptFileName", selectedFile ? selectedFile.name : "", {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  });
                }}
              />
              <p className="text-xs text-zinc-500">Allowed: PDF, JPG, PNG, WEBP. Max size: 25MB.</p>
            </div>

            <div className="grid gap-1">
              <label htmlFor="bankStatementFile" className="text-sm font-medium text-zinc-700">
                Bank Statement (Optional)
              </label>
              <input
                id="bankStatementFile"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  setBankStatementFile(selectedFile);
                  setValue(
                    "expense.bankStatementFileName",
                    selectedFile ? selectedFile.name : null,
                    {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    },
                  );
                  setValue(
                    "expense.bankStatementFileType",
                    selectedFile ? selectedFile.type || "application/octet-stream" : null,
                    {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    },
                  );
                }}
              />
              <p className="text-xs text-zinc-500">Allowed: PDF, JPG, PNG, WEBP. Max size: 25MB.</p>
            </div>
          </div>

          <div className="grid gap-1">
            <label htmlFor="billNo" className="text-sm font-medium text-zinc-700">
              Bill No <span className="text-rose-600">*</span>
            </label>
            <input
              id="billNo"
              type="text"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              {...register("expense.billNo")}
            />
            {errors.expense?.billNo ? (
              <p className="text-xs text-rose-600">{errors.expense.billNo.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1">
            <label htmlFor="expensePurpose" className="text-sm font-medium text-zinc-700">
              Purpose <span className="text-rose-600">*</span>
            </label>
            <input
              id="expensePurpose"
              type="text"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              {...register("expense.purpose")}
            />
            {errors.expense?.purpose ? (
              <p className="text-xs text-rose-600">{errors.expense.purpose.message}</p>
            ) : null}
          </div>

          <div className="grid gap-1">
            <label htmlFor="expenseCategoryId" className="text-sm font-medium text-zinc-700">
              Expense Category <span className="text-rose-600">*</span>
            </label>
            <select
              id="expenseCategoryId"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              {...register("expense.expenseCategoryId")}
            >
              {options.expenseCategories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="expenseProductId" className="text-sm font-medium text-zinc-700">
                Product <span className="text-rose-600">*</span>
              </label>
              <select
                id="expenseProductId"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("expense.productId")}
              >
                {options.products.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              {errors.expense?.productId ? (
                <p className="text-xs text-rose-600">{errors.expense.productId.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1">
              <label htmlFor="expenseLocationId" className="text-sm font-medium text-zinc-700">
                Location <span className="text-rose-600">*</span>
              </label>
              <select
                id="expenseLocationId"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("expense.locationId")}
              >
                {options.locations.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input id="isGstApplicable" type="checkbox" {...register("expense.isGstApplicable")} />
            <label htmlFor="isGstApplicable" className="text-sm text-zinc-700">
              GST Applicable
            </label>
          </div>

          {isGstApplicable ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <label htmlFor="gstNumber" className="text-sm font-medium text-zinc-700">
                  GST Number (Optional)
                </label>
                <input
                  id="gstNumber"
                  type="text"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  {...register("expense.gstNumber", {
                    setValueAs: (value) => toNullable(String(value ?? "")),
                  })}
                />
              </div>

              <div className="grid gap-1">
                <label htmlFor="cgstAmount" className="text-sm font-medium text-zinc-700">
                  CGST Amount <span className="text-rose-600">*</span>
                </label>
                <input
                  id="cgstAmount"
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  {...register("expense.cgstAmount", { valueAsNumber: true })}
                />
              </div>

              <div className="grid gap-1">
                <label htmlFor="sgstAmount" className="text-sm font-medium text-zinc-700">
                  SGST Amount <span className="text-rose-600">*</span>
                </label>
                <input
                  id="sgstAmount"
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  {...register("expense.sgstAmount", { valueAsNumber: true })}
                />
              </div>

              <div className="grid gap-1">
                <label htmlFor="igstAmount" className="text-sm font-medium text-zinc-700">
                  IGST Amount <span className="text-rose-600">*</span>
                </label>
                <input
                  id="igstAmount"
                  type="number"
                  step="0.01"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  {...register("expense.igstAmount", { valueAsNumber: true })}
                />
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="transactionDate" className="text-sm font-medium text-zinc-700">
                Transaction Date <span className="text-rose-600">*</span>
              </label>
              <input
                id="transactionDate"
                type="date"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("expense.transactionDate")}
              />
            </div>

            <div className="grid gap-1">
              <label htmlFor="basicAmount" className="text-sm font-medium text-zinc-700">
                Basic Amount <span className="text-rose-600">*</span>
              </label>
              <input
                id="basicAmount"
                type="number"
                step="0.01"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("expense.basicAmount", { valueAsNumber: true })}
              />
              {errors.expense?.basicAmount ? (
                <p className="text-xs text-rose-600">{errors.expense.basicAmount.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1">
            <label htmlFor="totalAmount" className="text-sm font-medium text-zinc-700">
              Total Amount (Auto-calculated)
            </label>
            <input
              id="totalAmount"
              type="number"
              step="0.01"
              readOnly
              disabled
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
              value={calculatedTotalAmount.toFixed(2)}
            />
            {errors.expense?.totalAmount ? (
              <p className="text-xs text-rose-600">{errors.expense.totalAmount.message}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="vendorName" className="text-sm font-medium text-zinc-700">
                Vendor (Optional)
              </label>
              <input
                id="vendorName"
                type="text"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("expense.vendorName", {
                  setValueAs: (value) => toNullable(String(value ?? "")),
                })}
              />
            </div>

            <div className="grid gap-1">
              <label htmlFor="expenseRemarks" className="text-sm font-medium text-zinc-700">
                Remarks (Optional)
              </label>
              <input
                id="expenseRemarks"
                type="text"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("expense.remarks", {
                  setValueAs: (value) => toNullable(String(value ?? "")),
                })}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <label htmlFor="peopleInvolved" className="text-sm font-medium text-zinc-700">
              People Involved (Optional)
            </label>
            <textarea
              id="peopleInvolved"
              rows={2}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              {...register("expense.peopleInvolved", {
                setValueAs: (value) => toNullable(String(value ?? "")),
              })}
            />
          </div>
        </section>
      ) : null}

      {detailType === "advance" ? (
        <section className="grid gap-4 rounded-xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Petty Cash Request Details</h2>

          <input type="hidden" {...register("detailType")} value="advance" />

          <div className="grid gap-1">
            <label htmlFor="advanceReceiptFile" className="text-sm font-medium text-zinc-700">
              Upload File (Optional - attach any supporting document/image)
            </label>
            <label
              htmlFor="advanceReceiptFile"
              className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-600"
            >
              <span>
                {advanceSupportingFile
                  ? advanceSupportingFile.name
                  : "Drop file here or click to upload"}
              </span>
              <span className="text-xs text-zinc-500">
                Allowed: PDF, JPG, PNG, WEBP. Max size: 25MB.
              </span>
            </label>
            <input
              id="advanceReceiptFile"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0] ?? null;
                setAdvanceSupportingFile(selectedFile);
                setValue("advance.receiptFileName", selectedFile ? selectedFile.name : null, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="requestedAmount" className="text-sm font-medium text-zinc-700">
                Requested Amount (₹) <span className="text-rose-600">*</span>
              </label>
              <input
                id="requestedAmount"
                type="number"
                step="0.01"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("advance.requestedAmount", { valueAsNumber: true })}
              />
              {errors.advance?.requestedAmount ? (
                <p className="text-xs text-rose-600">{errors.advance.requestedAmount.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1">
              <label htmlFor="expectedUsageDate" className="text-sm font-medium text-zinc-700">
                Expected Usage Date (Optional)
              </label>
              <input
                id="expectedUsageDate"
                type="date"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("advance.expectedUsageDate", {
                  setValueAs: (value) => toNullable(String(value ?? "")),
                })}
              />
              {errors.advance?.expectedUsageDate ? (
                <p className="text-xs text-rose-600">{errors.advance.expectedUsageDate.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="budgetMonth" className="text-sm font-medium text-zinc-700">
                Budget Request Month <span className="text-rose-600">*</span>
              </label>
              <select
                id="budgetMonth"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("advance.budgetMonth", {
                  setValueAs: (value) => Number(value),
                })}
              >
                {MONTH_OPTIONS.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
              {errors.advance?.budgetMonth ? (
                <p className="text-xs text-rose-600">{errors.advance.budgetMonth.message}</p>
              ) : null}
            </div>

            <div className="grid gap-1">
              <label htmlFor="budgetYear" className="text-sm font-medium text-zinc-700">
                Budget Request Year <span className="text-rose-600">*</span>
              </label>
              <select
                id="budgetYear"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                {...register("advance.budgetYear", {
                  setValueAs: (value) => Number(value),
                })}
              >
                {Array.from({ length: 11 }, (_, index) => {
                  const year = new Date().getFullYear() - 2 + index;
                  return (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  );
                })}
              </select>
              {errors.advance?.budgetYear ? (
                <p className="text-xs text-rose-600">{errors.advance.budgetYear.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1">
            <label htmlFor="purpose" className="text-sm font-medium text-zinc-700">
              Purpose/Reason <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="purpose"
              rows={3}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              {...register("advance.purpose")}
            />
            {errors.advance?.purpose ? (
              <p className="text-xs text-rose-600">{errors.advance.purpose.message}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {fileError ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          {fileError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-zinc-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isSubmitting ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <circle
                cx="10"
                cy="10"
                r="7"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="2"
              />
              <path
                d="M10 3a7 7 0 0 1 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Processing...
          </>
        ) : (
          "Submit Claim"
        )}
      </button>
    </form>
  );
}
