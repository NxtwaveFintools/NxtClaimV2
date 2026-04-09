"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import {
  submitClaimAction,
  type ClaimFormOptions,
  type CurrentUserHydration,
} from "@/modules/claims/actions";
import { parseReceiptAction } from "@/modules/claims/actions/parse-receipt";
import { newClaimSubmitSchema } from "@/modules/claims/validators/new-claim-schema";
import { useClaimFormAutofill } from "@/hooks/use-claim-form-autofill";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_OPTIONS,
  NIAT_OFFLINE_LEAD_GEN_DEPARTMENT,
} from "@/core/constants/location-types";

type NewClaimFormClientProps = {
  currentUser: CurrentUserHydration;
  options: ClaimFormOptions;
};

export type ClaimFormDraftValues = {
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
    locationType: string | null;
    locationDetails: string | null;
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

function toNumberOrZero(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return 0;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeCategoryName(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveExpenseCategoryIdFromAi(
  categoryName: string | null,
  categories: ClaimFormOptions["expenseCategories"],
): string {
  const normalizedIncomingName = normalizeCategoryName(categoryName);
  if (!normalizedIncomingName) {
    return "";
  }

  const matchedCategory = categories.find(
    (category) => normalizeCategoryName(category.name) === normalizedIncomingName,
  );

  return matchedCategory?.id ?? "";
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
): number {
  const safeBasicAmount = Number.isFinite(basicAmountValue) ? basicAmountValue : 0;
  const safeCgstAmount = Number.isFinite(cgstAmountValue) ? cgstAmountValue : 0;
  const safeSgstAmount = Number.isFinite(sgstAmountValue) ? sgstAmountValue : 0;
  const safeIgstAmount = Number.isFinite(igstAmountValue) ? igstAmountValue : 0;

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

  const form = useForm<ClaimFormDraftValues>({
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
        locationType: null,
        locationDetails: null,
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

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = form;

  const submissionType = useWatch({ control, name: "submissionType" });
  const onBehalfEmail = useWatch({ control, name: "onBehalfEmail" });
  const paymentModeId = useWatch({ control, name: "paymentModeId" });
  const detailType = useWatch({ control, name: "detailType" });
  const departmentId = useWatch({ control, name: "departmentId" });
  const locationType = useWatch({ control, name: "expense.locationType" });
  const basicAmount = useWatch({ control, name: "expense.basicAmount" });
  const cgstAmount = useWatch({ control, name: "expense.cgstAmount" });
  const sgstAmount = useWatch({ control, name: "expense.sgstAmount" });
  const igstAmount = useWatch({ control, name: "expense.igstAmount" });

  const { hydrated, wasAutoFilled, clearDefaults } = useClaimFormAutofill(form, {
    departments: options.departments,
    paymentModes: options.paymentModes,
  });

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
    const calculatedTotal = calculateExpenseTotal(basicAmount, cgstAmount, sgstAmount, igstAmount);

    setValue("expense.totalAmount", calculatedTotal, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: true,
    });
  }, [basicAmount, cgstAmount, igstAmount, setValue, sgstAmount]);

  const calculatedTotalAmount = calculateExpenseTotal(
    basicAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
  );

  const selectedDepartment = useMemo(
    () => options.departmentRouting.find((department) => department.id === departmentId) ?? null,
    [departmentId, options.departmentRouting],
  );

  const founderEmail = selectedDepartment?.founder.email ?? "";
  const actualBeneficiaryEmail =
    submissionType === "On Behalf" ? (onBehalfEmail ?? "") : currentUser.email;

  const normalizedActualBeneficiaryEmail = actualBeneficiaryEmail.trim().toLowerCase();

  const globalHodEmailSet = useMemo(
    () =>
      new Set(
        options.departmentRouting
          .map((department) => department.hod.email.trim().toLowerCase())
          .filter((email) => email.length > 0),
      ),
    [options.departmentRouting],
  );

  const isGlobalHodBeneficiary =
    normalizedActualBeneficiaryEmail.length > 0 &&
    globalHodEmailSet.has(normalizedActualBeneficiaryEmail);

  const isBypassingHod = isGlobalHodBeneficiary && Boolean(founderEmail);

  const isNiatDepartment = selectedDepartment?.name === NIAT_OFFLINE_LEAD_GEN_DEPARTMENT;

  useEffect(() => {
    if (!isNiatDepartment) {
      setValue("expense.locationType", null, { shouldValidate: true });
      setValue("expense.locationDetails", null, { shouldValidate: true });
    }
  }, [isNiatDepartment, setValue]);

  useEffect(() => {
    if (locationType !== LOCATION_TYPES.OUT_STATION) {
      setValue("expense.locationDetails", null, { shouldValidate: true });
    }
  }, [locationType, setValue]);

  const resolvedL1Approver = useMemo(() => {
    if (!selectedDepartment) {
      return null;
    }

    if (currentUser.isGlobalHod || currentUser.id === selectedDepartment.hod.id) {
      return selectedDepartment.founder;
    }

    return selectedDepartment.hod;
  }, [currentUser.id, currentUser.isGlobalHod, selectedDepartment]);

  const displayApprover = isBypassingHod
    ? (selectedDepartment?.founder ?? null)
    : resolvedL1Approver;

  const displayApproverLabel = isBypassingHod
    ? "Level 1 Approver (Bypassing HOD)"
    : currentUser.isGlobalHod
      ? "Approver (Finance/Senior)"
      : "Head of Department";

  const displayApproverEmail = isBypassingHod ? founderEmail : (displayApprover?.email ?? "");

  useEffect(() => {
    setValue("employeeName", currentUser.name, { shouldValidate: true });
  }, [currentUser.name, setValue]);

  useEffect(() => {
    const hodName = displayApprover?.fullName ?? displayApprover?.email ?? "";
    const hodEmail = displayApproverEmail;
    setValue("hodName", hodName, { shouldValidate: true });
    setValue("hodEmail", hodEmail, { shouldValidate: true });
  }, [displayApprover, displayApproverEmail, setValue]);

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
    const normalizedHodName = displayApprover?.fullName ?? displayApprover?.email ?? "";
    const normalizedHodEmail = displayApproverEmail;

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
      if (isNiatDepartment) {
        appendFormDataValue(formData, "expense.locationType", values.expense.locationType);
        if (values.expense.locationType === LOCATION_TYPES.OUT_STATION) {
          appendFormDataValue(formData, "expense.locationDetails", values.expense.locationDetails);
        }
      }
      const derivedIsGstApplicable =
        (values.expense.gstNumber?.trim().length ?? 0) > 0 ||
        values.expense.cgstAmount > 0 ||
        values.expense.sgstAmount > 0 ||
        values.expense.igstAmount > 0;
      appendFormDataValue(formData, "expense.isGstApplicable", derivedIsGstApplicable);
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

  const applyParsedReceiptToForm = (
    parsed: NonNullable<Awaited<ReturnType<typeof parseReceiptAction>>["data"]>,
  ) => {
    const matchedExpenseCategoryId = resolveExpenseCategoryIdFromAi(
      parsed.category_name,
      options.expenseCategories,
    );

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
    setValue("expense.expenseCategoryId", matchedExpenseCategoryId, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.gstNumber", parsed.gstNumber, {
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
  };

  const runReceiptExtraction = async (
    receiptFile: File,
    toastId: string | number,
  ): Promise<void> => {
    setIsAiParsing(true);

    try {
      const formData = new FormData();
      formData.append("receiptFile", receiptFile);
      for (const category of options.expenseCategories) {
        formData.append("expenseCategoryNames", category.name);
      }

      const result = await parseReceiptAction(formData);
      if (!result.ok || !result.data) {
        toast.error(result.message ?? "Failed to fetch AI details.", { id: toastId });
        return;
      }

      if (!result.autoFillAllowed) {
        toast.error(result.message ?? "Failed to fetch AI details.", { id: toastId });
        return;
      }

      applyParsedReceiptToForm(result.data);
      toast.success("Details fetched!", { id: toastId });
    } catch {
      toast.error("Failed to fetch AI details.", { id: toastId });
    } finally {
      setIsAiParsing(false);
    }
  };

  const handleReceiptUploadSuccess = async (selectedFile: File | null): Promise<void> => {
    setInvoiceFile(selectedFile);
    setValue("expense.receiptFileName", selectedFile ? selectedFile.name : "", {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    if (!selectedFile) {
      setFileError(null);
      return;
    }

    const invoiceValidationError = validateUploadFile(selectedFile, "Invoice/Bill file");
    if (invoiceValidationError) {
      setFileError(invoiceValidationError);
      toast.error(invoiceValidationError);
      return;
    }

    if (isAiParsing) {
      return;
    }

    setFileError(null);
    const toastId = toast.loading("Fetching AI details...");
    await runReceiptExtraction(selectedFile, toastId);
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

    if (isAiParsing) {
      return;
    }

    setFileError(null);

    const toastId = toast.loading("Fetching AI details...");
    await runReceiptExtraction(invoiceFile, toastId);
  };

  return (
    <form
      className="grid gap-5 text-zinc-900 transition-colors dark:text-zinc-100 [&_section]:overflow-hidden [&_section]:rounded-2xl [&_section]:border [&_section]:border-zinc-200/80 [&_section]:bg-white/80 [&_section]:p-5 [&_section]:shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] [&_section]:backdrop-blur-sm dark:[&_section]:border-zinc-800 dark:[&_section]:bg-zinc-900/80 dark:[&_section]:shadow-black/10 [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_label]:text-zinc-700 dark:[&_label]:text-zinc-300 [&_input:not([type='checkbox']):not([type='hidden'])]:nxt-input [&_input:not([type='checkbox']):not([type='hidden'])]:w-full [&_input:not([type='checkbox']):not([type='hidden'])]:min-w-0 [&_input:not([type='checkbox']):not([type='hidden'])]:!h-11 [&_input:not([type='checkbox']):not([type='hidden'])]:!text-base [&_input:not([type='checkbox'])]:border-zinc-300 [&_input:not([type='checkbox'])]:bg-white [&_input:not([type='checkbox'])]:text-zinc-900 dark:[&_input:not([type='checkbox'])]:border-zinc-700 dark:[&_input:not([type='checkbox'])]:bg-zinc-900/70 dark:[&_input:not([type='checkbox'])]:text-zinc-100 [&_select]:nxt-input [&_select]:w-full [&_select]:min-w-0 [&_select]:!h-11 [&_select]:!text-base [&_select]:border-zinc-300 [&_select]:bg-white [&_select]:text-zinc-900 dark:[&_select]:border-zinc-700 dark:[&_select]:bg-zinc-900/70 dark:[&_select]:text-zinc-100 [&_textarea]:nxt-input [&_textarea]:w-full [&_textarea]:min-w-0 [&_textarea]:!text-base [&_textarea]:border-zinc-300 [&_textarea]:bg-white [&_textarea]:text-zinc-900 dark:[&_textarea]:border-zinc-700 dark:[&_textarea]:bg-zinc-900/70 dark:[&_textarea]:text-zinc-100"
      onSubmit={handleFormSubmit}
    >
      <input type="hidden" {...register("employeeName")} />
      <input type="hidden" {...register("hodName")} />
      <input type="hidden" {...register("hodEmail")} />

      <div className="grid grid-cols-1 gap-y-12 xl:grid-cols-2 xl:items-start xl:gap-x-12">
        {/* ── Left column: Employee + Submission Context ── */}
        <div className="grid gap-5">
          <section className="grid gap-3 rounded-2xl border border-zinc-200/80 p-4 sm:p-5">
            <h2 className="dashboard-font-display text-sm font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
              Employee Details
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label
                  htmlFor="employeeNameReadOnly"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Employee Name
                </label>
                <input
                  id="employeeNameReadOnly"
                  value={currentUser.name}
                  readOnly
                  className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                />
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="employeeEmailReadOnly"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Employee Email
                </label>
                <input
                  id="employeeEmailReadOnly"
                  value={currentUser.email}
                  readOnly
                  className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                />
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="employeeId"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Employee ID <span className="text-rose-600">*</span>
                </label>
                <input
                  id="employeeId"
                  type="text"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  {...register("employeeId")}
                />
                {errors.employeeId ? (
                  <p className="text-xs text-rose-600">{errors.employeeId.message}</p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="dashboard-font-display text-sm font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
                  Submission Context
                </h2>
                {hydrated && wasAutoFilled ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-700/40 dark:bg-indigo-950/30 dark:text-indigo-300">
                    <Sparkles className="h-3 w-3" />
                    Auto-filled
                  </span>
                ) : null}
              </div>
              {hydrated && wasAutoFilled ? (
                <button
                  type="button"
                  onClick={clearDefaults}
                  className="text-[11px] font-medium text-indigo-600 underline-offset-2 hover:text-indigo-500 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  Clear Defaults
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label
                  htmlFor="submissionType"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Submission Type <span className="text-rose-600">*</span>
                </label>
                <select
                  id="submissionType"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  {...register("submissionType")}
                >
                  <option value="Self">Self</option>
                  <option value="On Behalf">On Behalf</option>
                </select>
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="departmentId"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Department <span className="text-rose-600">*</span>
                </label>
                <select
                  id="departmentId"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
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
            </div>

            {submissionType === "On Behalf" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="onBehalfEmail"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    On Behalf Email <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="onBehalfEmail"
                    type="email"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("onBehalfEmail", {
                      setValueAs: (value) => toNullable(String(value ?? "")),
                    })}
                  />
                  {errors.onBehalfEmail ? (
                    <p className="text-xs text-rose-600">{errors.onBehalfEmail.message}</p>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="onBehalfEmployeeCode"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    On Behalf Employee ID <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="onBehalfEmployeeCode"
                    type="text"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("onBehalfEmployeeCode", {
                      setValueAs: (value) => toNullable(String(value ?? "")),
                    })}
                  />
                  {errors.onBehalfEmployeeCode ? (
                    <p className="text-xs text-rose-600">{errors.onBehalfEmployeeCode.message}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label
                  htmlFor="ccEmails"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  CC Emails (Optional)
                </label>
                <input
                  id="ccEmails"
                  type="text"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  placeholder="user1@example.com, user2@example.com"
                  {...register("ccEmails", {
                    setValueAs: (value) => toOptional(String(value ?? "")),
                  })}
                />
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="l1ApproverNameReadOnly"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  {displayApproverLabel}
                </label>
                <input
                  id="l1ApproverNameReadOnly"
                  value={displayApprover?.fullName ?? displayApprover?.email ?? "Not available"}
                  readOnly
                  className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                />
                {errors.hodName ? (
                  <p className="text-xs text-rose-600">{errors.hodName.message}</p>
                ) : null}
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="l1ApproverEmailReadOnly"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  {displayApproverLabel} Email
                </label>
                <input
                  id="l1ApproverEmailReadOnly"
                  value={displayApproverEmail || "Not available"}
                  readOnly
                  className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                />
                {errors.hodEmail ? (
                  <p className="text-xs text-rose-600">{errors.hodEmail.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="grid gap-1">
                <label
                  htmlFor="paymentModeId"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Payment Mode <span className="text-rose-600">*</span>
                </label>
                <select
                  id="paymentModeId"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
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
            </div>
          </section>
        </div>
        {/* end left column */}

        {/* ── Right column: Expense / Advance Details ── */}
        <div className="grid gap-5">
          {detailType === "expense" ? (
            <section className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="dashboard-font-display text-sm font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
                  Expense Details
                </h2>
                <button
                  type="button"
                  onClick={handleAutoFillWithAI}
                  disabled={isSubmitting || isAiParsing || !invoiceFile}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition-all duration-200 hover:bg-indigo-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="receiptFile"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Invoice/Bill <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="receiptFile"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    aria-label="Invoice or bill file upload"
                    className="hidden"
                    onChange={(event) => {
                      const selectedFile = event.target.files?.[0] ?? null;
                      void handleReceiptUploadSuccess(selectedFile);
                    }}
                  />
                  <label
                    htmlFor="receiptFile"
                    className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 px-4 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Choose Invoice/Bill
                  </label>
                  <p className="text-xs text-zinc-500">
                    <span className="block truncate">
                      {invoiceFile ? invoiceFile.name : "No file selected"}
                    </span>
                  </p>
                  <p className="text-[10px] text-zinc-500">PDF, JPG, PNG, WEBP. Max: 25MB.</p>
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="bankStatementFile"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Bank Statement (Optional)
                  </label>
                  <input
                    id="bankStatementFile"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    aria-label="Bank statement file upload"
                    className="hidden"
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
                  <label
                    htmlFor="bankStatementFile"
                    className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 px-4 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Choose Bank Statement
                  </label>
                  <p className="text-xs text-zinc-500">
                    <span className="block truncate">
                      {bankStatementFile ? bankStatementFile.name : "No file selected"}
                    </span>
                  </p>
                  <p className="text-[10px] text-zinc-500">PDF, JPG, PNG, WEBP. Max: 25MB.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="billNo"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Bill No <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="billNo"
                    type="text"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.billNo")}
                  />
                  {errors.expense?.billNo ? (
                    <p className="text-xs text-rose-600">{errors.expense.billNo.message}</p>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="expensePurpose"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Purpose <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="expensePurpose"
                    type="text"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.purpose")}
                  />
                  {errors.expense?.purpose ? (
                    <p className="text-xs text-rose-600">{errors.expense.purpose.message}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="expenseCategoryId"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Expense Category <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="expenseCategoryId"
                    className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.expenseCategoryId")}
                  >
                    <option value="">Select Expense Category</option>
                    {options.expenseCategories.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="expenseProductId"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Product <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="expenseProductId"
                    className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
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
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="expenseLocationId"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Location <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="expenseLocationId"
                    className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
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

              {isNiatDepartment ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="expenseLocationType"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Location Type <span className="text-rose-600">*</span>
                    </label>
                    <select
                      id="expenseLocationType"
                      className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.locationType")}
                    >
                      <option value="">Select location type</option>
                      {LOCATION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {errors.expense?.locationType ? (
                      <p className="text-xs text-rose-600">{errors.expense.locationType.message}</p>
                    ) : null}
                  </div>
                  {locationType === LOCATION_TYPES.OUT_STATION ? (
                    <div className="grid gap-1">
                      <label
                        htmlFor="expenseLocationDetails"
                        className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                      >
                        Location Details <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id="expenseLocationDetails"
                        type="text"
                        placeholder="Enter out-station location details"
                        className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
                        {...register("expense.locationDetails")}
                      />
                      {errors.expense?.locationDetails ? (
                        <p className="text-xs text-rose-600">
                          {errors.expense.locationDetails.message}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="transactionDate"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Transaction Date <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="transactionDate"
                    type="date"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.transactionDate")}
                  />
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="vendorName"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Vendor (Optional)
                  </label>
                  <input
                    id="vendorName"
                    type="text"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.vendorName", {
                      setValueAs: (value) => toNullable(String(value ?? "")),
                    })}
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-xl border border-zinc-200/80 bg-zinc-100/30 p-3 dark:border-zinc-700 dark:bg-zinc-800/20">
                <p className="text-[11px] font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
                  Tax Details
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="gstNumber"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      GST Number
                    </label>
                    <input
                      id="gstNumber"
                      type="text"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.gstNumber", {
                        setValueAs: (value) => toNullable(String(value ?? "")),
                      })}
                    />
                  </div>

                  <div className="grid gap-1">
                    <label
                      htmlFor="igstAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      IGST Amount
                    </label>
                    <input
                      id="igstAmount"
                      type="number"
                      step="0.01"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.igstAmount", {
                        setValueAs: toNumberOrZero,
                      })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="cgstAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      CGST Amount
                    </label>
                    <input
                      id="cgstAmount"
                      type="number"
                      step="0.01"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.cgstAmount", {
                        setValueAs: toNumberOrZero,
                      })}
                    />
                  </div>

                  <div className="grid gap-1">
                    <label
                      htmlFor="sgstAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      SGST Amount
                    </label>
                    <input
                      id="sgstAmount"
                      type="number"
                      step="0.01"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.sgstAmount", {
                        setValueAs: toNumberOrZero,
                      })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="basicAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Basic Amount <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="basicAmount"
                      type="number"
                      step="0.01"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.basicAmount", {
                        setValueAs: toNumberOrZero,
                      })}
                    />
                    {errors.expense?.basicAmount ? (
                      <p className="text-xs text-rose-600">{errors.expense.basicAmount.message}</p>
                    ) : null}
                  </div>

                  <div className="grid gap-1">
                    <label
                      htmlFor="totalAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Total Amount
                    </label>
                    <input
                      id="totalAmount"
                      type="number"
                      step="0.01"
                      readOnly
                      disabled
                      className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                      value={calculatedTotalAmount.toFixed(2)}
                    />
                    {errors.expense?.totalAmount ? (
                      <p className="text-xs text-rose-600">{errors.expense.totalAmount.message}</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="expenseRemarks"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Remarks (Optional)
                  </label>
                  <input
                    id="expenseRemarks"
                    type="text"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.remarks", {
                      setValueAs: (value) => toNullable(String(value ?? "")),
                    })}
                  />
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="peopleInvolved"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
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
              </div>
            </section>
          ) : null}

          {detailType === "advance" ? (
            <section className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:p-5">
              <h2 className="dashboard-font-display text-sm font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
                Petty Cash Request Details
              </h2>

              <input type="hidden" {...register("detailType")} value="advance" />

              <div className="grid gap-1">
                <label
                  htmlFor="advanceReceiptFile"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Upload File (Optional)
                </label>
                <input
                  id="advanceReceiptFile"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  aria-label="Advance supporting document upload"
                  className="hidden"
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
                <label
                  htmlFor="advanceReceiptFile"
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-zinc-50 px-4 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Choose Supporting Document
                </label>
                <p className="text-xs text-zinc-500">
                  <span className="block truncate">
                    {advanceSupportingFile ? advanceSupportingFile.name : "No file selected"}
                  </span>
                </p>
                <p className="text-[10px] text-zinc-500">PDF, JPG, PNG, WEBP. Max: 25MB.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="requestedAmount"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Requested Amount (₹) <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="requestedAmount"
                    type="number"
                    step="0.01"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("advance.requestedAmount", { valueAsNumber: true })}
                  />
                  {errors.advance?.requestedAmount ? (
                    <p className="text-xs text-rose-600">
                      {errors.advance.requestedAmount.message}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="expectedUsageDate"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Expected Usage Date (Optional)
                  </label>
                  <input
                    id="expectedUsageDate"
                    type="date"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("advance.expectedUsageDate", {
                      setValueAs: (value) => toNullable(String(value ?? "")),
                    })}
                  />
                  {errors.advance?.expectedUsageDate ? (
                    <p className="text-xs text-rose-600">
                      {errors.advance.expectedUsageDate.message}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="budgetMonth"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Budget Request Month <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="budgetMonth"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
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
                  <label
                    htmlFor="budgetYear"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Budget Request Year <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="budgetYear"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
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
                <label
                  htmlFor="purpose"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Purpose/Reason <span className="text-rose-600">*</span>
                </label>
                <textarea
                  id="purpose"
                  rows={2}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  {...register("advance.purpose")}
                />
                {errors.advance?.purpose ? (
                  <p className="text-xs text-rose-600">{errors.advance.purpose.message}</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
        {/* end right column */}
      </div>
      {/* end 2-column grid */}

      {fileError ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          {fileError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-indigo-500/10"
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
