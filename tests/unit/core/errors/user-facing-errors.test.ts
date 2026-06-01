import {
  getUserFriendlyErrorMessage,
  mapErrorCodeToMessage,
} from "@/core/errors/user-facing-errors";
import { z } from "zod";

describe("getUserFriendlyErrorMessage", () => {
  it("should return the fallback message for unknown errors", () => {
    expect(getUserFriendlyErrorMessage(null)).toBe("Something went wrong. Please try again later.");
  });

  it("should return a context-specific fallback message", () => {
    expect(getUserFriendlyErrorMessage(null, "claim-submission")).toBe(
      "We couldn't submit this claim. Please review the details and try again.",
    );
  });

  it("should map Supabase unique violation code", () => {
    const error = { code: "23505", message: "duplicate key value..." };
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "A claim with the same bill number, date, and amount already exists.",
    );
  });

  it("maps required Business Central and RPC error codes to safe messages", () => {
    expect(mapErrorCodeToMessage("P0001", "claim-detail")).toBe("This claim could not be found.");
    expect(mapErrorCodeToMessage("P0002")).toBe("This claim has already been submitted.");
    expect(mapErrorCodeToMessage("P0003")).toBe(
      "Required system mapping is missing. Please contact an administrator.",
    );
    expect(mapErrorCodeToMessage("P0005", "claim-action")).toBe(
      "This claim is not in the right status for this action.",
    );
    expect(mapErrorCodeToMessage("CLAIM_NOT_FOUND")).toBe("This claim could not be found.");
    expect(mapErrorCodeToMessage("ALREADY_SUBMITTED")).toBe(
      "This claim has already been submitted.",
    );
    expect(mapErrorCodeToMessage("MISSING_MAPPING")).toBe(
      "Required system mapping is missing. Please contact an administrator.",
    );
    expect(mapErrorCodeToMessage("INVALID_CLAIM_STATE")).toBe(
      "This claim is not in the right status for this action.",
    );
  });

  it("should map technical messages containing database constraints", () => {
    const error = "insert or update on table violates uq_expense_details_active_bill constraint";
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "A claim with the same bill number, date, and amount already exists.",
    );
  });

  it("should map short duplicate key database text in settings context", () => {
    expect(getUserFriendlyErrorMessage("duplicate key value", "settings")).toBe(
      "An item with this name already exists.",
    );
  });

  it("should map Zod errors to a friendly message", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});
    if (!result.success) {
      expect(getUserFriendlyErrorMessage(result.error)).toBe(
        "Please review the form. Some required details are missing or invalid.",
      );
    }
  });

  it("should map auth specific errors", () => {
    const error = "Invalid login credentials";
    expect(getUserFriendlyErrorMessage(error, "auth")).toBe(
      "Invalid email or password. Please check your credentials and try again.",
    );
  });

  it("should map AI extraction quota errors", () => {
    const error = "quota exceeded for this project";
    expect(getUserFriendlyErrorMessage(error, "ai-extraction")).toBe(
      "AI extraction is busy right now. Please try again later or enter the details manually.",
    );
  });

  it("should map file size errors", () => {
    const error = "File size exceeds 25MB";
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "The uploaded file is too large. Please upload a file under 25 MB.",
    );
  });

  it("should hide technical jargon like Supabase or PGRST", () => {
    const error = "PGRST116: Unexpected row count";
    expect(getUserFriendlyErrorMessage(error)).toBe(
      "Something went wrong. Please try again later.",
    );
  });

  it("maps PGRST116 by context", () => {
    expect(getUserFriendlyErrorMessage({ code: "PGRST116" }, "claim-detail")).toBe(
      "This claim could not be found.",
    );
    expect(getUserFriendlyErrorMessage({ code: "PGRST116" }, "settings")).toBe(
      "We couldn't find the requested record.",
    );
  });

  it("does not pass through short technical exception messages", () => {
    expect(getUserFriendlyErrorMessage("Cannot read properties of undefined")).toBe(
      "Something went wrong. Please try again later.",
    );
    expect(getUserFriendlyErrorMessage("Unexpected token < in JSON")).toBe(
      "Something went wrong. Please try again later.",
    );
    expect(getUserFriendlyErrorMessage("database timeout", "claim-edit")).toBe(
      "We couldn't save your changes. Please review the details and try again.",
    );
    expect(getUserFriendlyErrorMessage("Error: null value in column user_id")).toBe(
      "Some required information is missing. Please review and try again.",
    );
  });

  it("maps AI service and file validation failures to action-oriented messages", () => {
    expect(getUserFriendlyErrorMessage({ status: 503 }, "ai-extraction")).toBe(
      "AI extraction is temporarily unavailable. Please try again in a few minutes or enter the details manually.",
    );
    expect(
      getUserFriendlyErrorMessage("Receipt file must be PDF, JPG, PNG, or WEBP.", "ai-extraction"),
    ).toBe(
      "This file type is not supported for extraction. Please upload a PDF, JPG, PNG, or WEBP file.",
    );
    expect(getUserFriendlyErrorMessage("Receipt file is required.", "ai-extraction")).toBe(
      "Please upload a file before extracting details.",
    );
  });

  it("should pass through simple non-technical messages", () => {
    const error = "Please select a department.";
    expect(getUserFriendlyErrorMessage(error)).toBe("Please select a department.");
  });
});
