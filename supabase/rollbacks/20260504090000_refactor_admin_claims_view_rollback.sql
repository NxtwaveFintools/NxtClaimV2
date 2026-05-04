CREATE OR REPLACE VIEW "public"."vw_admin_claims_dashboard" WITH ("security_invoker"='on') AS
 SELECT "c"."id" AS "claim_id",
    COALESCE(NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text"), NULLIF(TRIM(BOTH FROM "split_part"("u"."email", '@'::"text", 1)), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), 'N/A'::"text") AS "employee_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "c"."employee_id"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_employee_code"), ''::"text"), NULLIF(TRIM(BOTH FROM "c"."on_behalf_email"), ''::"text"), NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text"), 'N/A'::"text") AS "employee_id",
    "c"."employee_id" AS "claim_employee_id_raw",
    "c"."on_behalf_employee_code" AS "on_behalf_employee_code_raw",
    NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") AS "submitter_name_raw",
    NULLIF(TRIM(BOTH FROM "beneficiary"."full_name"), ''::"text") AS "beneficiary_name_raw",
    COALESCE(NULLIF(TRIM(BOTH FROM "md"."name"), ''::"text"), 'Unknown Department'::"text") AS "department_name",
    COALESCE(NULLIF(TRIM(BOTH FROM "mpm"."name"), ''::"text"),
        CASE
            WHEN ("c"."detail_type" = 'advance'::"text") THEN 'Advance'::"text"
            WHEN ("c"."detail_type" = 'expense'::"text") THEN 'Expense'::"text"
            ELSE 'Unknown'::"text"
        END) AS "type_of_claim",
    (COALESCE("ed"."total_amount", "ad"."requested_amount", (0)::numeric))::numeric(14,2) AS "amount",
    "c"."status",
    COALESCE("c"."submitted_at", "c"."created_at") AS "submitted_on",
    COALESCE("c"."hod_action_at",
        CASE
            WHEN ("c"."status" = 'HOD approved - Awaiting finance approval'::"public"."claim_status") THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "hod_action_date",
    COALESCE("c"."finance_action_at",
        CASE
            WHEN ("c"."status" = ANY (ARRAY['Finance Approved - Payment under process'::"public"."claim_status", 'Payment Done - Closed'::"public"."claim_status"])) THEN "c"."updated_at"
            WHEN (("c"."status" = ANY (ARRAY['Rejected - Resubmission Not Allowed'::"public"."claim_status", 'Rejected - Resubmission Allowed'::"public"."claim_status"])) AND ("c"."assigned_l2_approver_id" IS NOT NULL)) THEN "c"."updated_at"
            ELSE NULL::timestamp with time zone
        END) AS "finance_action_date",
    COALESCE("ed"."location_id", "ad"."location_id") AS "location_id",
    COALESCE("ed"."product_id", "ad"."product_id") AS "product_id",
    "ed"."expense_category_id",
    "c"."submitted_by",
    "c"."on_behalf_of_id",
    "c"."on_behalf_email",
    "c"."assigned_l1_approver_id",
    "c"."assigned_l2_approver_id",
    "c"."department_id",
    "c"."payment_mode_id",
    "c"."detail_type",
    "c"."submission_type",
    "c"."is_active",
    "c"."created_at",
    "c"."updated_at",
    "c"."deleted_by",
    "c"."deleted_at",
    NULLIF(TRIM(BOTH FROM "deleted_by_user"."full_name"), ''::"text") AS "deleted_by_name",
    "deleted_by_user"."role" AS "deleted_by_role",
    "u"."email" AS "submitter_email",
    "hod"."email" AS "hod_email",
    "finance"."email" AS "finance_email",
        CASE
            WHEN ((NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL)) THEN (((TRIM(BOTH FROM "u"."full_name") || ' ('::"text") || TRIM(BOTH FROM "u"."email")) || ')'::"text")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."full_name"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."full_name")
            WHEN (NULLIF(TRIM(BOTH FROM "u"."email"), ''::"text") IS NOT NULL) THEN TRIM(BOTH FROM "u"."email")
            ELSE "c"."employee_id"
        END AS "submitter_label",
        CASE
            WHEN ("c"."detail_type" = 'expense'::"text") THEN COALESCE(NULLIF(TRIM(BOTH FROM "mec_name"."name"), ''::"text"), 'Uncategorized'::"text")
            ELSE 'Advance'::"text"
        END AS "category_name",
    COALESCE("ed"."purpose", "ad"."purpose") AS "purpose",
    "ed"."receipt_file_path",
    "ed"."bank_statement_file_path",
    "ad"."supporting_document_path"
   FROM (((((((((("public"."claims" "c"
     LEFT JOIN "public"."users" "u" ON (("u"."id" = "c"."submitted_by")))
     LEFT JOIN "public"."users" "beneficiary" ON (("beneficiary"."id" = "c"."on_behalf_of_id")))
     LEFT JOIN "public"."users" "hod" ON (("hod"."id" = "c"."assigned_l1_approver_id")))
     LEFT JOIN "public"."users" "finance" ON (("finance"."id" = "c"."assigned_l2_approver_id")))
     LEFT JOIN "public"."users" "deleted_by_user" ON (("deleted_by_user"."id" = "c"."deleted_by")))
     LEFT JOIN "public"."master_departments" "md" ON (("md"."id" = "c"."department_id")))
     LEFT JOIN "public"."master_payment_modes" "mpm" ON (("mpm"."id" = "c"."payment_mode_id")))
     LEFT JOIN "public"."expense_details" "ed" ON (("ed"."claim_id" = "c"."id")))
     LEFT JOIN "public"."master_expense_categories" "mec_name" ON (("mec_name"."id" = "ed"."expense_category_id")))
     LEFT JOIN "public"."advance_details" "ad" ON (("ad"."claim_id" = "c"."id")));


ALTER VIEW "public"."vw_admin_claims_dashboard" OWNER TO "postgres";