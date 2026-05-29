"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useCallback,
  type BaseSyntheticEvent,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { FormInput } from "@/components/ui/form-input";
import { FormSelect } from "@/components/ui/form-select";
import { FormTextarea } from "@/components/ui/form-textarea";
import {
  submitClaimAction,
  type ClaimFormOptions,
  type CurrentUserHydration,
} from "@/modules/claims/actions";
import { parseReceiptAction } from "@/modules/claims/actions/parse-receipt";
import {
  newClaimSubmitSchema,
  ON_BEHALF_EMAIL_DOMAIN,
} from "@/modules/claims/validators/new-claim-schema";
import { computeForeignTotal, computeInrTotal } from "@/modules/claims/utils/compute-totals";
import { useClaimFormAutofill } from "@/hooks/use-claim-form-autofill";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_OPTIONS,
  NIAT_OFFLINE_LEAD_GEN_DEPARTMENT,
} from "@/core/constants/location-types";
import { AIDisclaimer } from "@/components/ui/ai-disclaimer";
import { BANK_STATEMENT_REQUIRED_CATEGORIES } from "@/core/constants/bank-statement-categories";

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
    foreignCurrencyCode: "INR" | "USD" | "EUR" | "CHF";
    foreignBasicAmount: number | null;
    foreignGstAmount: number | null;
    foreignTotalAmount: number | null;
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
    totalAmount: number;
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

function toNumber(val: unknown): number {
  if (val === null || val === undefined) {
    return 0;
  }

  if (typeof val === "string") {
    const normalized = val.trim().replace(/,/g, "");
    if (normalized.length === 0) {
      return 0;
    }

    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  }

  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

function toNumberOrZero(value: unknown): number {
  return toNumber(value);
}

function clientToNullableNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return toNullable(value);
}

function stripJsonMarkdownFences(response: string): string {
  return response
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseAiPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === "string") {
    try {
      const cleanedPayload = stripJsonMarkdownFences(payload);
      const objectMatch = cleanedPayload.match(/\{[\s\S]*\}/);
      if (!objectMatch) {
        return null;
      }

      const parsed = JSON.parse(objectMatch[0]) as unknown;
      return toRecord(parsed);
    } catch {
      return null;
    }
  }

  return toRecord(payload);
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

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) {
    return `${megabytes.toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function calculateExpenseTotal(
  basicAmountValue: number,
  cgstAmountValue: number,
  sgstAmountValue: number,
  igstAmountValue: number,
): number {
  return computeInrTotal({
    basicAmount: Number.isFinite(basicAmountValue) ? basicAmountValue : 0,
    cgstAmount: Number.isFinite(cgstAmountValue) ? cgstAmountValue : 0,
    sgstAmount: Number.isFinite(sgstAmountValue) ? sgstAmountValue : 0,
    igstAmount: Number.isFinite(igstAmountValue) ? igstAmountValue : 0,
  });
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

type AiEditedFieldEntry = {
  original: string | number | boolean | null;
};

type ClaimExpenseAiMetadataPayload = {
  edited_fields: Record<string, AiEditedFieldEntry>;
};

type AiExpenseSnapshot = {
  bill_no: string | null;
  transaction_date: string | null;
  vendor_name: string | null;
  gst_number: string | null;
  expense_category_id: string | null;
  basic_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
  foreign_currency_code: string | null;
  foreign_basic_amount: number | null;
  foreign_gst_amount: number | null;
  foreign_total_amount: number | null;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function equalsRoundedAmount(left: number, right: number, tolerance = 0.01): boolean {
  return Math.abs(left - right) <= tolerance;
}

function buildExpenseAiMetadata(
  snapshot: AiExpenseSnapshot | null,
  expense: ClaimFormDraftValues["expense"],
): ClaimExpenseAiMetadataPayload | null {
  if (!snapshot) {
    return null;
  }

  const editedFields: Record<string, AiEditedFieldEntry> = {};

  const currentTotalAmount = calculateExpenseTotal(
    expense.basicAmount,
    expense.cgstAmount,
    expense.sgstAmount,
    expense.igstAmount,
  );

  const comparisons: Array<{
    key: keyof AiExpenseSnapshot;
    currentValue: string | number | null;
  }> = [
    { key: "bill_no", currentValue: normalizeOptionalText(expense.billNo) },
    { key: "transaction_date", currentValue: normalizeOptionalText(expense.transactionDate) },
    { key: "vendor_name", currentValue: normalizeOptionalText(expense.vendorName) },
    { key: "gst_number", currentValue: normalizeOptionalText(expense.gstNumber) },
    {
      key: "expense_category_id",
      currentValue: normalizeOptionalText(expense.expenseCategoryId),
    },
    { key: "basic_amount", currentValue: expense.basicAmount },
    { key: "cgst_amount", currentValue: expense.cgstAmount },
    { key: "sgst_amount", currentValue: expense.sgstAmount },
    { key: "igst_amount", currentValue: expense.igstAmount },
    { key: "total_amount", currentValue: currentTotalAmount },
    { key: "foreign_currency_code", currentValue: expense.foreignCurrencyCode },
    { key: "foreign_basic_amount", currentValue: expense.foreignBasicAmount },
    { key: "foreign_gst_amount", currentValue: expense.foreignGstAmount },
    { key: "foreign_total_amount", currentValue: expense.foreignTotalAmount },
  ];

  for (const comparison of comparisons) {
    const originalValue = snapshot[comparison.key];
    const currentValue = comparison.currentValue;

    if (typeof originalValue === "number" && currentValue === null) {
      if (originalValue !== 0) {
        editedFields[comparison.key] = { original: originalValue };
      }
      continue;
    }

    if (typeof originalValue === "number" && typeof currentValue === "number") {
      if (!equalsRoundedAmount(originalValue, currentValue)) {
        editedFields[comparison.key] = { original: originalValue };
      }
      continue;
    }

    if (originalValue === null) {
      continue;
    }

    if (originalValue !== currentValue) {
      editedFields[comparison.key] = {
        original: typeof originalValue === "string" ? normalizeOptionalText(originalValue) : null,
      };
    }
  }

  if (Object.keys(editedFields).length === 0) {
    return null;
  }

  return {
    edited_fields: editedFields,
  };
}

export function NewClaimFormClient({ currentUser, options }: NewClaimFormClientProps) {
  const router = useRouter();
  const [, startNavTransition] = useTransition();
  const [fileError, setFileError] = useState<string | null>(null);
  const [bankStatementError, setBankStatementError] = useState<string | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [bankStatementFile, setBankStatementFile] = useState<File | null>(null);
  const [advanceSupportingFile, setAdvanceSupportingFile] = useState<File | null>(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState<string | null>(null);
  const [bankStatementPreviewUrl, setBankStatementPreviewUrl] = useState<string | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<"invoice" | "bank-statement">("invoice");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAiParsing, setIsAiParsing] = useState(false);
  const originalAiExpenseSnapshotRef = useRef<AiExpenseSnapshot | null>(null);

  const [panelWidth, setPanelWidth] = useState(360);
  const isDraggingRef = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const newWidth = window.innerWidth - e.clientX - 32;
    const clamped = Math.min(Math.max(newWidth, 320), 560);
    setPanelWidth(clamped);
  }, []);

  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

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
        expenseCategoryId: "",
        productId: "",
        locationId: "",
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
        foreignCurrencyCode: "INR",
        foreignBasicAmount: null,
        foreignGstAmount: null,
        foreignTotalAmount: null,
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
        totalAmount: 0,
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
    getValues,
    handleSubmit,
    formState: { errors },
  } = form;

  const submissionType = useWatch({ control, name: "submissionType" });
  const onBehalfEmail = useWatch({ control, name: "onBehalfEmail" });
  const paymentModeId = useWatch({ control, name: "paymentModeId" });
  const detailType = useWatch({ control, name: "detailType" });
  const departmentId = useWatch({ control, name: "departmentId" });
  const locationType = useWatch({ control, name: "expense.locationType" });
  const expenseCategoryId = useWatch({ control, name: "expense.expenseCategoryId" });
  const basicAmount = useWatch({ control, name: "expense.basicAmount" });
  const cgstAmount = useWatch({ control, name: "expense.cgstAmount" });
  const sgstAmount = useWatch({ control, name: "expense.sgstAmount" });
  const igstAmount = useWatch({ control, name: "expense.igstAmount" });
  const watchedForeignBasic = useWatch({ control, name: "expense.foreignBasicAmount" });
  const watchedForeignGst = useWatch({ control, name: "expense.foreignGstAmount" });
  const watchedForeignCode = useWatch({ control, name: "expense.foreignCurrencyCode" });
  const watchedTotalAmount = useWatch({ control, name: "expense.totalAmount" }) as
    | number
    | undefined;
  const watchedForeignTotalAmount = useWatch({ control, name: "expense.foreignTotalAmount" }) as
    | number
    | undefined;

  const selectedExpenseCategory = useMemo(
    () => options.expenseCategories.find((category) => category.id === expenseCategoryId) ?? null,
    [expenseCategoryId, options.expenseCategories],
  );

  const selectedPaymentMode = useMemo(
    () => options.paymentModes.find((mode) => mode.id === paymentModeId) ?? null,
    [options.paymentModes, paymentModeId],
  );

  const isBankStatementRequired = selectedExpenseCategory
    ? BANK_STATEMENT_REQUIRED_CATEGORIES.has(selectedExpenseCategory.name)
    : false;

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
    if (!isBankStatementRequired) {
      setBankStatementError(null);
    }
  }, [isBankStatementRequired]);

  useEffect(() => {
    if (!invoiceFile || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      setInvoicePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(invoiceFile);
    setInvoicePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [invoiceFile]);

  useEffect(() => {
    if (
      !bankStatementFile ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      setBankStatementPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(bankStatementFile);
    setBankStatementPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [bankStatementFile]);

  useEffect(() => {
    if (!bankStatementFile && activePreviewTab === "bank-statement") {
      setActivePreviewTab("invoice");
    }
  }, [bankStatementFile, activePreviewTab]);

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

  useEffect(() => {
    if (!watchedForeignCode || watchedForeignCode === "INR") {
      setValue("expense.foreignTotalAmount", null, { shouldValidate: false });
      return;
    }
    setValue(
      "expense.foreignTotalAmount",
      computeForeignTotal({
        basicAmount: Number(watchedForeignBasic) || 0,
        gstAmount: Number(watchedForeignGst) || 0,
      }),
      { shouldValidate: false },
    );
  }, [watchedForeignCode, watchedForeignBasic, watchedForeignGst, setValue]);

  const calculatedTotalAmount = calculateExpenseTotal(
    basicAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
  );

  const calculatedForeignTotalAmount =
    watchedForeignCode && watchedForeignCode !== "INR"
      ? computeForeignTotal({
          basicAmount: Number(watchedForeignBasic) || 0,
          gstAmount: Number(watchedForeignGst) || 0,
        })
      : null;

  const selectedDepartment = useMemo(
    () => options.departmentRouting.find((department) => department.id === departmentId) ?? null,
    [departmentId, options.departmentRouting],
  );

  const actualBeneficiaryEmail =
    submissionType === "On Behalf" ? (onBehalfEmail ?? "") : currentUser.email;
  const normalizedActualBeneficiaryEmail = actualBeneficiaryEmail.trim().toLowerCase();

  const effectiveBeneficiaryId = useMemo(() => {
    if (submissionType === "Self") {
      return currentUser.id;
    }

    if (!selectedDepartment || normalizedActualBeneficiaryEmail.length === 0) {
      return null;
    }

    const normalizedApprover1Email = selectedDepartment.approver1.email.trim().toLowerCase();
    const normalizedApprover2Email = selectedDepartment.approver2.email.trim().toLowerCase();

    if (normalizedActualBeneficiaryEmail === normalizedApprover1Email) {
      return selectedDepartment.approver1.id;
    }

    if (normalizedActualBeneficiaryEmail === normalizedApprover2Email) {
      return selectedDepartment.approver2.id;
    }

    return null;
  }, [currentUser.id, normalizedActualBeneficiaryEmail, selectedDepartment, submissionType]);

  const isBeneficiaryDepartmentApprover1 =
    selectedDepartment !== null &&
    (effectiveBeneficiaryId
      ? effectiveBeneficiaryId === selectedDepartment.approver1.id
      : normalizedActualBeneficiaryEmail ===
        selectedDepartment.approver1.email.trim().toLowerCase());

  const isBeneficiaryDepartmentApprover2 =
    selectedDepartment !== null &&
    (effectiveBeneficiaryId
      ? effectiveBeneficiaryId === selectedDepartment.approver2.id
      : normalizedActualBeneficiaryEmail ===
        selectedDepartment.approver2.email.trim().toLowerCase());

  // Check if beneficiary is an HOD (approver1) in ANY department (including cross-department)
  const isBeneficiaryApprover1InAnyDept =
    submissionType === "On Behalf" &&
    normalizedActualBeneficiaryEmail.length > 0 &&
    options.departmentRouting.some(
      (dept) => dept.approver1.email.trim().toLowerCase() === normalizedActualBeneficiaryEmail,
    );

  // Route to approver 2 if beneficiary is an HOD in any department OR if beneficiary is approver 2
  const shouldEscalateToApprover2 =
    isBeneficiaryDepartmentApprover1 ||
    isBeneficiaryApprover1InAnyDept ||
    isBeneficiaryDepartmentApprover2;

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

  const displayApprover =
    selectedDepartment === null
      ? null
      : shouldEscalateToApprover2
        ? selectedDepartment.approver2
        : selectedDepartment.approver1;

  const displayApproverLabel = shouldEscalateToApprover2
    ? "Level 1 Approver (Escalated to Approver 2)"
    : "Level 1 Approver";

  const displayApproverEmail = displayApprover?.email ?? "";

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

      if (isBankStatementRequired && !bankStatementFile) {
        setIsSubmitting(false);
        setBankStatementError("Please upload bank statement");
        toast.error("Please upload bank statement");
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
      const aiMetadata = buildExpenseAiMetadata(
        originalAiExpenseSnapshotRef.current,
        values.expense,
      );

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
      appendFormDataValue(
        formData,
        "expense.foreignCurrencyCode",
        values.expense.foreignCurrencyCode,
      );
      appendFormDataValue(
        formData,
        "expense.foreignBasicAmount",
        values.expense.foreignBasicAmount,
      );
      appendFormDataValue(formData, "expense.foreignGstAmount", values.expense.foreignGstAmount);
      appendFormDataValue(
        formData,
        "expense.foreignTotalAmount",
        values.expense.foreignTotalAmount,
      );
      appendFormDataValue(formData, "expense.vendorName", values.expense.vendorName);
      appendFormDataValue(formData, "expense.peopleInvolved", values.expense.peopleInvolved);
      appendFormDataValue(formData, "expense.remarks", values.expense.remarks);
      appendFormDataValue(formData, "expense.receiptFileName", "");
      appendFormDataValue(formData, "expense.receiptFileType", "");
      appendFormDataValue(formData, "expense.receiptFileBase64", "");
      appendFormDataValue(formData, "expense.bankStatementFileName", "");
      appendFormDataValue(formData, "expense.bankStatementFileType", "");
      appendFormDataValue(formData, "expense.bankStatementFileBase64", "");

      if (aiMetadata) {
        appendFormDataValue(formData, "expense.aiMetadata", JSON.stringify(aiMetadata));
      }

      if (invoiceFile) {
        formData.append("receiptFile", invoiceFile);
      }

      if (bankStatementFile) {
        formData.append("bankStatementFile", bankStatementFile);
      }
    } else {
      appendFormDataValue(formData, "advance.totalAmount", values.advance.totalAmount);
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to submit claim.";
      const isHeaderSizeFailure =
        /Request Header Fields Too Large/i.test(errorMessage) ||
        /unexpected response was received from the server/i.test(errorMessage) ||
        /Failed to fetch/i.test(errorMessage);

      if (isHeaderSizeFailure) {
        toast.error(
          "Session cookies may be too large. Please sign out, sign in again, refresh the page, and retry submission.",
        );
      } else {
        toast.error(errorMessage);
      }
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

  const handleFormSubmit = (event: BaseSyntheticEvent) => {
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

  const applyParsedReceiptToForm = (parsed: Record<string, unknown>): void => {
    const parsedCategoryName = toNullableString(parsed.category_name ?? parsed.expenseCategory);
    const billNo = toNullableString(parsed.billNo ?? parsed.bill_no) ?? "";
    const transactionDate =
      toNullableString(parsed.transactionDate ?? parsed.transaction_date) ?? "";
    const gstNumber = toNullableString(parsed.gstNumber ?? parsed.gst_number);
    const vendorName = toNullableString(parsed.vendorName ?? parsed.vendor_name);

    const basicAmount = toNumber(parsed.basicAmount ?? parsed.basic_amount);
    const cgstAmount = toNumber(parsed.cgstAmount ?? parsed.cgst_amount);
    const sgstAmount = toNumber(parsed.sgstAmount ?? parsed.sgst_amount);
    const igstAmount = toNumber(parsed.igstAmount ?? parsed.igst_amount);
    const totalAmount = toNumber(parsed.totalAmount ?? parsed.total_amount);
    const normalizedTotalAmount =
      totalAmount > 0
        ? totalAmount
        : calculateExpenseTotal(basicAmount, cgstAmount, sgstAmount, igstAmount);

    const matchedExpenseCategoryId = resolveExpenseCategoryIdFromAi(
      parsedCategoryName,
      options.expenseCategories,
    );

    const VALID_FOREIGN_CODES = new Set(["INR", "USD", "EUR", "CHF"] as const);
    const rawCode =
      typeof parsed.foreignCurrencyCode === "string"
        ? parsed.foreignCurrencyCode.toUpperCase()
        : null;
    const foreignCurrencyCode =
      rawCode && VALID_FOREIGN_CODES.has(rawCode as "INR" | "USD" | "EUR" | "CHF")
        ? (rawCode as "INR" | "USD" | "EUR" | "CHF")
        : null;
    const foreignBasicAmount =
      parsed.foreignBasicAmount !== null && parsed.foreignBasicAmount !== undefined
        ? toNumber(parsed.foreignBasicAmount)
        : null;
    const foreignGstAmount =
      parsed.foreignGstAmount !== null && parsed.foreignGstAmount !== undefined
        ? toNumber(parsed.foreignGstAmount)
        : null;
    const foreignTotalAmount =
      parsed.foreignTotalAmount !== null && parsed.foreignTotalAmount !== undefined
        ? toNumber(parsed.foreignTotalAmount)
        : null;

    originalAiExpenseSnapshotRef.current = {
      bill_no: normalizeOptionalText(billNo),
      transaction_date: normalizeOptionalText(transactionDate),
      vendor_name: normalizeOptionalText(vendorName),
      gst_number: normalizeOptionalText(gstNumber),
      expense_category_id: normalizeOptionalText(matchedExpenseCategoryId),
      basic_amount: basicAmount,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      total_amount: normalizedTotalAmount,
      foreign_currency_code: foreignCurrencyCode,
      foreign_basic_amount: foreignBasicAmount,
      foreign_gst_amount: foreignGstAmount,
      foreign_total_amount: foreignTotalAmount,
    };

    setValue("expense.billNo", billNo, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.transactionDate", transactionDate, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.basicAmount", basicAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.totalAmount", normalizedTotalAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.expenseCategoryId", matchedExpenseCategoryId, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.gstNumber", gstNumber, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.cgstAmount", cgstAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.sgstAmount", sgstAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.igstAmount", igstAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.vendorName", vendorName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    if (foreignCurrencyCode && foreignCurrencyCode !== "INR") {
      setValue("expense.foreignCurrencyCode", foreignCurrencyCode, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.foreignBasicAmount", foreignBasicAmount ?? null, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setValue("expense.foreignGstAmount", foreignGstAmount ?? null, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      // foreignTotalAmount is derived via useEffect
    }
  };

  const appendBankStatementMatchHints = (formData: FormData): void => {
    const expenseValues = getValues("expense");
    const selectedCategoryName =
      options.expenseCategories.find((category) => category.id === expenseValues.expenseCategoryId)
        ?.name ?? null;

    appendFormDataValue(formData, "bankStatementMatchVendorName", expenseValues.vendorName);
    appendFormDataValue(
      formData,
      "bankStatementMatchTransactionDate",
      expenseValues.transactionDate,
    );
    appendFormDataValue(formData, "bankStatementMatchBillNo", expenseValues.billNo);
    appendFormDataValue(
      formData,
      "bankStatementMatchForeignCurrencyCode",
      expenseValues.foreignCurrencyCode,
    );
    appendFormDataValue(
      formData,
      "bankStatementMatchForeignTotalAmount",
      expenseValues.foreignTotalAmount,
    );
    appendFormDataValue(formData, "bankStatementMatchCategoryName", selectedCategoryName);
  };

  const applyParsedBankStatementToForm = (parsed: Record<string, unknown>): void => {
    const matchedAmount = toNumber(
      parsed.basicAmount ?? parsed.basic_amount ?? parsed.totalAmount ?? parsed.total_amount,
    );
    const matchedDate = toNullableString(parsed.transactionDate ?? parsed.transaction_date);
    const matchedVendorName = toNullableString(parsed.vendorName ?? parsed.vendor_name);
    const expenseValues = getValues("expense");

    setValue("expense.basicAmount", matchedAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    setValue("expense.totalAmount", matchedAmount, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.gstNumber", null, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.cgstAmount", 0, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.sgstAmount", 0, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.igstAmount", 0, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.foreignCurrencyCode", "INR", {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.foreignBasicAmount", null, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.foreignGstAmount", null, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("expense.foreignTotalAmount", null, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    if (!expenseValues.vendorName && matchedVendorName) {
      setValue("expense.vendorName", matchedVendorName, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }

    if (!expenseValues.transactionDate && matchedDate) {
      setValue("expense.transactionDate", matchedDate, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
  };

  const runReceiptExtraction = async (
    receiptFile: File,
    toastId: string | number,
  ): Promise<void> => {
    setIsAiParsing(true);

    try {
      const formData = new FormData();
      formData.append("receiptFile", receiptFile);
      formData.append("documentType", "invoice");
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

      const aiData = parseAiPayload(result.data);
      if (!aiData) {
        toast.error("AI returned invalid JSON. Please fill the fields manually.", { id: toastId });
        return;
      }

      if (toNumber(aiData.confidenceScore) < 70) {
        toast.warning("Receipt quality is low. Please verify all auto-filled fields carefully.");
      }

      applyParsedReceiptToForm(aiData);

      toast.success("Details fetched!", { id: toastId });
    } catch {
      toast.error("Failed to fetch AI details.", { id: toastId });
    } finally {
      setIsAiParsing(false);
    }
  };

  const runBankStatementExtraction = async (
    statementFile: File,
    toastId: string | number,
  ): Promise<void> => {
    setIsAiParsing(true);

    try {
      const formData = new FormData();
      formData.append("receiptFile", statementFile);
      formData.append("documentType", "bank_statement");
      appendBankStatementMatchHints(formData);

      const result = await parseReceiptAction(formData);
      if (!result.ok || !result.data) {
        toast.error(result.message ?? "Failed to match bank statement amount.", { id: toastId });
        return;
      }

      if (!result.autoFillAllowed) {
        toast.error(result.message ?? "Failed to match bank statement amount.", { id: toastId });
        return;
      }

      const aiData = parseAiPayload(result.data);
      if (!aiData) {
        toast.error("AI returned invalid bank statement data. Please fill the amount manually.", {
          id: toastId,
        });
        return;
      }

      if (toNumber(aiData.confidenceScore) < 70) {
        toast.warning(
          "Bank statement match is low confidence. Please verify the selected INR amount carefully.",
        );
      }

      applyParsedBankStatementToForm(aiData);
      toast.success("Matched INR amount from bank statement.", { id: toastId });
    } catch {
      toast.error("Failed to match bank statement amount.", { id: toastId });
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
      originalAiExpenseSnapshotRef.current = null;
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

    originalAiExpenseSnapshotRef.current = null;
    setFileError(null);
    const toastId = toast.loading("Fetching AI details...");
    await runReceiptExtraction(selectedFile, toastId);
  };

  const handleBankStatementUploadSuccess = async (selectedFile: File | null): Promise<void> => {
    setBankStatementFile(selectedFile);
    setBankStatementError(null);
    setValue("expense.bankStatementFileName", selectedFile ? selectedFile.name : null, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue(
      "expense.bankStatementFileType",
      selectedFile ? selectedFile.type || "application/octet-stream" : null,
      {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      },
    );

    if (!selectedFile) {
      return;
    }

    const bankValidationError = validateUploadFile(selectedFile, "Bank statement file");
    if (bankValidationError) {
      setBankStatementError(bankValidationError);
      toast.error(bankValidationError);
      return;
    }

    if (isAiParsing) {
      return;
    }

    const toastId = toast.loading("AI is fetching bank statement details...");
    await runBankStatementExtraction(selectedFile, toastId);
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

    originalAiExpenseSnapshotRef.current = null;
    setFileError(null);

    const toastId = toast.loading("Fetching AI details...");
    await runReceiptExtraction(invoiceFile, toastId);
  };

  return (
    <form
      className="grid gap-5 text-foreground transition-colors [&_section]:rounded-xl [&_section]:border [&_section]:border-border [&_section]:bg-card [&_section]:p-4 sm:[&_section]:p-[18px] [&_h2]:text-foreground [&_label]:text-foreground [&_input:not([type='checkbox']):not([type='hidden'])]:nxt-input [&_input:not([type='checkbox']):not([type='hidden'])]:w-full [&_input:not([type='checkbox']):not([type='hidden'])]:min-w-0 [&_input:not([type='checkbox']):not([type='hidden'])]:!h-[38px] [&_input:not([type='checkbox']):not([type='hidden'])]:!rounded-lg [&_input:not([type='checkbox']):not([type='hidden'])]:!text-sm [&_select]:nxt-input [&_select]:w-full [&_select]:min-w-0 [&_select]:!h-[38px] [&_select]:!rounded-lg [&_select]:!text-sm [&_textarea]:nxt-input [&_textarea]:w-full [&_textarea]:min-w-0 [&_textarea]:!rounded-lg [&_textarea]:!text-sm"
      onSubmit={handleFormSubmit}
    >
      <input type="hidden" {...register("employeeName")} />
      <input type="hidden" {...register("hodName")} />
      <input type="hidden" {...register("hodEmail")} />

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <div className="grid w-full min-w-0 flex-1 gap-4 sm:gap-5 lg:min-w-[620px]">
          {/* ── Left column: Employee + Submission Context ── */}
          <section className="grid gap-3 rounded-xl border border-zinc-200 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="dashboard-font-display text-sm font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
                  Submission Context
                </h2>
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

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Submitting as</span>
              <span>{currentUser.name}</span>
              <span aria-hidden="true">/</span>
              <span>{currentUser.email}</span>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label
                  htmlFor="employeeId"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Employee ID <span className="text-rose-600">*</span>
                </label>
                <FormInput
                  id="employeeId"
                  type="text"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  {...register("employeeId")}
                />
                {errors.employeeId ? (
                  <p className="text-xs text-rose-600">{errors.employeeId.message}</p>
                ) : null}
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="submissionType"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Submission Type <span className="text-rose-600">*</span>
                </label>
                <FormSelect
                  id="submissionType"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  {...register("submissionType")}
                >
                  <option value="Self">Self</option>
                  <option value="On Behalf">On Behalf</option>
                </FormSelect>
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
                  <FormInput
                    id="onBehalfEmail"
                    type="email"
                    placeholder={`e.g., user${ON_BEHALF_EMAIL_DOMAIN}`}
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
                  <FormInput
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

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label
                  htmlFor="departmentId"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Department <span className="text-rose-600">*</span>
                </label>
                <FormSelect
                  id="departmentId"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  {...register("departmentId")}
                >
                  {options.departments.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </FormSelect>
                {errors.departmentId ? (
                  <p className="text-xs text-rose-600">{errors.departmentId.message}</p>
                ) : null}
              </div>

              <div className="grid gap-1">
                <label
                  htmlFor="ccEmails"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  CC Emails (Optional)
                </label>
                <FormInput
                  id="ccEmails"
                  type="text"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  placeholder="user1@example.com, user2@example.com"
                  {...register("ccEmails", {
                    setValueAs: (value) => toOptional(String(value ?? "")),
                  })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <label
                  htmlFor="l1ApproverNameReadOnly"
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  {displayApproverLabel}
                </label>
                <FormInput
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
                <FormInput
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
                  Payment Mode <span className="text-rose-600">*</span>{" "}
                  <span className="text-xs font-normal text-zinc-400">
                    ({detailType === "expense" ? "Expense" : "Advance"})
                  </span>
                </label>
                <FormSelect
                  id="paymentModeId"
                  className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                  {...register("paymentModeId")}
                >
                  {options.paymentModes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </FormSelect>
                {errors.paymentModeId ? (
                  <p className="text-xs text-rose-600">{errors.paymentModeId.message}</p>
                ) : null}
              </div>
            </div>
          </section>
          {detailType === "expense" ? (
            <section className="grid gap-x-4 gap-y-3 rounded-xl border border-zinc-200 p-4 sm:p-[18px] [&_label]:!text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="dashboard-font-display text-sm font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">
                  Expense Details
                </h2>
              </div>

              <input type="hidden" {...register("detailType")} value="expense" />

              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="billNo"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Bill No <span className="text-rose-600">*</span>
                  </label>
                  <FormInput
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
                  <FormInput
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

              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="expenseCategoryId"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Expense Category <span className="text-rose-600">*</span>
                  </label>
                  <FormSelect
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
                  </FormSelect>
                  {isBankStatementRequired ? (
                    <p className="text-xs text-muted-foreground">
                      Bank statement is required for this category.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="expenseProductId"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Product <span className="text-rose-600">*</span>
                  </label>
                  <FormSelect
                    id="expenseProductId"
                    className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.productId")}
                  >
                    <option value="">Select Product type</option>
                    {options.products.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </FormSelect>
                  {errors.expense?.productId ? (
                    <p className="text-xs text-rose-600">{errors.expense.productId.message}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="expenseLocationId"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Location <span className="text-rose-600">*</span>
                  </label>
                  <FormSelect
                    id="expenseLocationId"
                    className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.locationId")}
                  >
                    <option value="">Please Select Location</option>
                    {options.locations.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </FormSelect>
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="vendorName"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Vendor (Optional)
                  </label>
                  <FormInput
                    id="vendorName"
                    type="text"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.vendorName", {
                      setValueAs: (value) => toNullable(String(value ?? "")),
                    })}
                  />
                </div>
              </div>

              {isNiatDepartment ? (
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="expenseLocationType"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Location Type <span className="text-rose-600">*</span>
                    </label>
                    <FormSelect
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
                    </FormSelect>
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
                      <FormInput
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

              <div className="grid grid-cols-1 gap-x-4 gap-y-3">
                <div className="grid gap-1">
                  <label
                    htmlFor="transactionDate"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Transaction Date <span className="text-rose-600">*</span>
                  </label>
                  <DateInput
                    id="transactionDate"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("expense.transactionDate")}
                  />
                </div>
              </div>

              <div className="grid gap-x-4 gap-y-3 rounded-xl border border-zinc-200/80 bg-zinc-100/30 p-3 dark:border-zinc-700 dark:bg-zinc-800/20">
                <p className="text-[11px] font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
                  Tax Details
                </p>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="gstNumber"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      GST Number
                    </label>
                    <FormInput
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
                    <CurrencyInput
                      id="igstAmount"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.igstAmount", {
                        setValueAs: toNumberOrZero,
                      })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="cgstAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      CGST Amount
                    </label>
                    <CurrencyInput
                      id="cgstAmount"
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
                    <CurrencyInput
                      id="sgstAmount"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.sgstAmount", {
                        setValueAs: toNumberOrZero,
                      })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="basicAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Basic Amount <span className="text-rose-600">*</span>
                    </label>
                    <CurrencyInput
                      id="basicAmount"
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
                    <CurrencyInput
                      id="totalAmount"
                      readOnly
                      disabled
                      className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                      value={Number(watchedTotalAmount ?? calculatedTotalAmount).toFixed(2)}
                    />
                    {errors.expense?.totalAmount ? (
                      <p className="text-xs text-rose-600">{errors.expense.totalAmount.message}</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-x-4 gap-y-3 rounded-xl border border-zinc-200/80 bg-zinc-100/30 p-3 dark:border-zinc-700 dark:bg-zinc-800/20">
                <p className="text-[11px] font-medium tracking-wide text-zinc-500 dark:text-zinc-400">
                  Foreign Expense Details
                </p>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="foreignCurrencyCode"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Foreign Currency
                    </label>
                    <FormSelect
                      id="foreignCurrencyCode"
                      className="h-9 w-full rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.foreignCurrencyCode")}
                    >
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="CHF">CHF</option>
                    </FormSelect>
                  </div>

                  <div className="grid gap-1">
                    <label
                      htmlFor="foreignBasicAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Foreign Basic Amount
                    </label>
                    <CurrencyInput
                      id="foreignBasicAmount"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.foreignBasicAmount", {
                        setValueAs: clientToNullableNumber,
                      })}
                    />
                    {errors.expense?.foreignBasicAmount ? (
                      <p className="text-xs text-rose-600">
                        {errors.expense.foreignBasicAmount.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label
                      htmlFor="foreignGstAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Foreign GST Amount
                    </label>
                    <CurrencyInput
                      id="foreignGstAmount"
                      className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                      {...register("expense.foreignGstAmount", {
                        setValueAs: clientToNullableNumber,
                      })}
                    />
                  </div>

                  <div className="grid gap-1">
                    <label
                      htmlFor="foreignTotalAmount"
                      className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      Foreign Total Amount
                    </label>
                    <CurrencyInput
                      id="foreignTotalAmount"
                      readOnly
                      disabled
                      className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
                      value={
                        calculatedForeignTotalAmount !== null
                          ? Number(
                              watchedForeignTotalAmount ?? calculatedForeignTotalAmount,
                            ).toFixed(2)
                          : ""
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label
                    htmlFor="expenseRemarks"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Remarks (Optional)
                  </label>
                  <FormTextarea
                    id="expenseRemarks"
                    rows={2}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
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
                  <FormTextarea
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
                    htmlFor="totalAmount"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Total Amount (₹) <span className="text-rose-600">*</span>
                  </label>
                  <CurrencyInput
                    id="totalAmount"
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-sm"
                    {...register("advance.totalAmount", { valueAsNumber: true })}
                  />
                  {errors.advance?.totalAmount ? (
                    <p className="text-xs text-rose-600">{errors.advance.totalAmount.message}</p>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  <label
                    htmlFor="expectedUsageDate"
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Expected Usage Date (Optional)
                  </label>
                  <DateInput
                    id="expectedUsageDate"
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
                  <FormSelect
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
                  </FormSelect>
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
                  <FormSelect
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
                  </FormSelect>
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
                <FormTextarea
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

        {detailType === "expense" ? (
          <>
            <div
              className="hidden lg:flex w-2 cursor-col-resize flex-col items-center justify-center self-stretch rounded-md transition-colors hover:bg-zinc-100 active:bg-[var(--accent)] group"
              onMouseDown={startResize}
              aria-label="Resize evidence panel — drag to adjust width"
              role="separator"
            >
              <span
                className="flex h-full w-0.5 flex-col items-center justify-center rounded-full bg-zinc-300 group-hover:bg-zinc-400"
                aria-hidden="true"
              >
                <GripVertical className="h-4 w-4 text-zinc-400 group-hover:text-zinc-500" />
              </span>
            </div>

            <aside
              className="grid w-full lg:w-auto gap-4 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto"
              style={{ flexBasis: panelWidth, flexShrink: 0 }}
            >
              <div>
                <h2 className="dashboard-font-display text-base font-semibold text-foreground">
                  Evidence & Review
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Keep evidence visible while you complete the claim.
                </p>
              </div>

              <div className="grid gap-2 rounded-lg border border-border bg-background-secondary p-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="receiptFile" className="text-sm font-medium text-foreground">
                    Invoice/Bill
                  </label>
                  <span className="text-xs font-medium text-rose-600">Required</span>
                </div>
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
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
                >
                  Choose file
                </label>
                <p className="text-xs text-muted-foreground">PDF, JPG, PNG, WEBP · Max 25MB</p>
                <p className="truncate text-xs text-muted-foreground">
                  {invoiceFile
                    ? `${invoiceFile.name} · ${formatFileSize(invoiceFile.size)}`
                    : "No file selected"}
                </p>
                {fileError ? <p className="text-xs text-rose-600">{fileError}</p> : null}
              </div>

              <Button
                onClick={handleAutoFillWithAI}
                disabled={isSubmitting || isAiParsing || !invoiceFile}
                type="button"
                variant="secondary"
                size="md"
                className="h-9 rounded-lg border-accent text-accent hover:bg-accent-muted"
              >
                {isAiParsing ? "Extracting..." : "Extract from invoice"}
              </Button>
              <AIDisclaimer />

              <div className="grid gap-2 rounded-lg border border-border bg-background-secondary p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Bank Statement</h3>
                  {isBankStatementRequired ? (
                    <span className="text-xs font-medium text-rose-600">Required</span>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">Optional</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isBankStatementRequired
                    ? "Bank statement is required for this expense category."
                    : "Upload only if this claim needs bank evidence."}
                </p>
                <input
                  id="bankStatementFile"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  aria-label="Bank statement file upload"
                  className="hidden"
                  onChange={(event) => {
                    const selectedFile = event.target.files?.[0] ?? null;
                    void handleBankStatementUploadSuccess(selectedFile);
                  }}
                />
                <label
                  htmlFor="bankStatementFile"
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
                >
                  Choose file
                </label>
                <p className="text-xs text-muted-foreground">PDF, JPG, PNG, WEBP · Max 25MB</p>
                <p className="truncate text-xs text-muted-foreground">
                  {bankStatementFile
                    ? `${bankStatementFile.name} · ${formatFileSize(bankStatementFile.size)}`
                    : "No file selected"}
                </p>
                {bankStatementError ? (
                  <p className="text-xs text-rose-600">{bankStatementError}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Uploaded evidence</h3>
                  <p className="text-xs text-muted-foreground">
                    Compare uploaded files with the fields you enter.
                  </p>
                </div>

                <div
                  className="flex rounded-lg border border-border p-0.5"
                  role="tablist"
                  aria-label="Evidence preview tabs"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activePreviewTab === "invoice"}
                    onClick={() => setActivePreviewTab("invoice")}
                    disabled={!invoiceFile}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                      activePreviewTab === "invoice"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--background-secondary)] disabled:opacity-40 disabled:pointer-events-none"
                    }`}
                  >
                    Invoice
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activePreviewTab === "bank-statement"}
                    onClick={() => setActivePreviewTab("bank-statement")}
                    disabled={!bankStatementFile}
                    title={!bankStatementFile ? "No bank statement uploaded." : undefined}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                      activePreviewTab === "bank-statement"
                        ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--background-secondary)] disabled:opacity-40 disabled:pointer-events-none"
                    }`}
                  >
                    Bank Statement
                  </button>
                </div>

                <div className="flex min-h-[280px] items-center justify-center overflow-hidden rounded-lg border border-border bg-background-secondary p-3 lg:min-h-[360px]">
                  {activePreviewTab === "invoice" ? (
                    !invoiceFile ? (
                      <p className="text-center text-sm text-muted-foreground">
                        Upload an invoice to preview it here.
                      </p>
                    ) : invoicePreviewUrl && invoiceFile.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={invoicePreviewUrl}
                        alt={`Uploaded invoice preview: ${invoiceFile.name}`}
                        className="max-h-[440px] w-full object-contain"
                      />
                    ) : invoicePreviewUrl && invoiceFile.type === "application/pdf" ? (
                      <iframe
                        src={invoicePreviewUrl}
                        title={`Uploaded invoice preview: ${invoiceFile.name}`}
                        className="h-[360px] w-full rounded border-0"
                      />
                    ) : (
                      <p className="text-center text-sm text-muted-foreground">
                        {invoiceFile.name}
                      </p>
                    )
                  ) : !bankStatementFile ? (
                    <p className="text-center text-sm text-muted-foreground">
                      Upload a bank statement to preview it here.
                    </p>
                  ) : bankStatementPreviewUrl && bankStatementFile.type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={bankStatementPreviewUrl}
                      alt={`Uploaded bank statement preview: ${bankStatementFile.name}`}
                      className="max-h-[440px] w-full object-contain"
                    />
                  ) : bankStatementPreviewUrl && bankStatementFile.type === "application/pdf" ? (
                    <iframe
                      src={bankStatementPreviewUrl}
                      title={`Uploaded bank statement preview: ${bankStatementFile.name}`}
                      className="h-[360px] w-full rounded border-0"
                    />
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">
                      {bankStatementFile.name}
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </>
        ) : null}
      </div>
      {/* end 2-column grid */}

      <div
        className="fixed bottom-0 left-0 right-0 z-20 flex items-center border-t border-border bg-card/95 px-6 backdrop-blur sm:px-6 lg:px-8"
        style={{ height: "60px" }}
      >
        {fileError ? <Alert tone="error" description={fileError} /> : null}
        <div className="flex flex-1 flex-row items-center justify-end gap-2">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-9 rounded-lg bg-[var(--accent)] px-5 text-sm font-medium text-white shadow-none hover:bg-[var(--accent-hover)]"
          >
            {isSubmitting ? (
              <>
                <svg
                  className="mr-2 h-4 w-4 animate-spin"
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
          </Button>
        </div>
      </div>
    </form>
  );
}
