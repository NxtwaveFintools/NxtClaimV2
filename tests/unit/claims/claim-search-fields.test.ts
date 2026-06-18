import { isValidClaimSearchField } from "@/lib/claim-search-fields";

describe("isValidClaimSearchField", () => {
  it.each(["claim_id", "employee_name", "employee_id", "employee_email", "bill_no"])(
    "accepts valid field %s",
    (field) => {
      expect(isValidClaimSearchField(field)).toBe(true);
    },
  );

  it.each([undefined, "", "bill_number", "email", "name", "BILL_NO"])(
    "rejects invalid value %s",
    (value) => {
      expect(isValidClaimSearchField(value)).toBe(false);
    },
  );
});
