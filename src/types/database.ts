export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string;
          id: string;
          provisional_email: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          provisional_email?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          provisional_email?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      advance_details: {
        Row: {
          budget_month: number;
          budget_year: number;
          claim_id: string;
          created_at: string;
          expected_usage_date: string | null;
          id: string;
          is_active: boolean;
          location_id: string | null;
          product_id: string | null;
          purpose: string;
          remarks: string | null;
          supporting_document_path: string | null;
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          budget_month: number;
          budget_year: number;
          claim_id: string;
          created_at?: string;
          expected_usage_date?: string | null;
          id?: string;
          is_active?: boolean;
          location_id?: string | null;
          product_id?: string | null;
          purpose: string;
          remarks?: string | null;
          supporting_document_path?: string | null;
          total_amount: number;
          updated_at?: string;
        };
        Update: {
          budget_month?: number;
          budget_year?: number;
          claim_id?: string;
          created_at?: string;
          expected_usage_date?: string | null;
          id?: string;
          is_active?: boolean;
          location_id?: string | null;
          product_id?: string | null;
          purpose?: string;
          remarks?: string | null;
          supporting_document_path?: string | null;
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "advance_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "advance_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "vw_admin_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "advance_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "vw_enterprise_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "advance_details_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "master_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "advance_details_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "master_products";
            referencedColumns: ["id"];
          },
        ];
      };
      allowed_auth_domains: {
        Row: {
          created_at: string;
          domain: string;
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          domain: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          domain?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      bc_claim_details: {
        Row: {
          bc_payload_json: Json | null;
          bc_response_json: Json | null;
          bc_status: Database["public"]["Enums"]["bc_claim_status"];
          claim_id: string;
          created_at: string;
          id: string;
          is_vendor_payment: boolean;
          updated_at: string;
        };
        Insert: {
          bc_payload_json?: Json | null;
          bc_response_json?: Json | null;
          bc_status?: Database["public"]["Enums"]["bc_claim_status"];
          claim_id: string;
          created_at?: string;
          id?: string;
          is_vendor_payment?: boolean;
          updated_at?: string;
        };
        Update: {
          bc_payload_json?: Json | null;
          bc_response_json?: Json | null;
          bc_status?: Database["public"]["Enums"]["bc_claim_status"];
          claim_id?: string;
          created_at?: string;
          id?: string;
          is_vendor_payment?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bc_claim_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bc_claim_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "vw_admin_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "bc_claim_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "vw_enterprise_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
        ];
      };
      claim_audit_logs: {
        Row: {
          action_type: string;
          actor_id: string;
          assigned_to_id: string | null;
          claim_id: string;
          created_at: string;
          id: string;
          remarks: string | null;
        };
        Insert: {
          action_type: string;
          actor_id: string;
          assigned_to_id?: string | null;
          claim_id: string;
          created_at?: string;
          id?: string;
          remarks?: string | null;
        };
        Update: {
          action_type?: string;
          actor_id?: string;
          assigned_to_id?: string | null;
          claim_id?: string;
          created_at?: string;
          id?: string;
          remarks?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "claim_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claim_audit_logs_assigned_to_id_fkey";
            columns: ["assigned_to_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claim_audit_logs_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claim_audit_logs_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "vw_admin_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "claim_audit_logs_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "vw_enterprise_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
        ];
      };
      claims: {
        Row: {
          assigned_l1_approver_id: string;
          assigned_l2_approver_id: string | null;
          bc_claim_details_id: string | null;
          cc_emails: string | null;
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
          department_id: string;
          detail_type: string;
          employee_id: string;
          finance_action_at: string | null;
          hod_action_at: string | null;
          id: string;
          is_active: boolean;
          is_resubmission_allowed: boolean;
          on_behalf_email: string | null;
          on_behalf_employee_code: string | null;
          on_behalf_of_id: string;
          payment_mode_id: string;
          rejection_reason: string | null;
          status: Database["public"]["Enums"]["claim_status"];
          submission_type: string;
          submitted_at: string;
          submitted_by: string;
          updated_at: string;
        };
        Insert: {
          assigned_l1_approver_id: string;
          assigned_l2_approver_id?: string | null;
          bc_claim_details_id?: string | null;
          cc_emails?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          department_id: string;
          detail_type: string;
          employee_id?: string;
          finance_action_at?: string | null;
          hod_action_at?: string | null;
          id: string;
          is_active?: boolean;
          is_resubmission_allowed?: boolean;
          on_behalf_email?: string | null;
          on_behalf_employee_code?: string | null;
          on_behalf_of_id: string;
          payment_mode_id: string;
          rejection_reason?: string | null;
          status?: Database["public"]["Enums"]["claim_status"];
          submission_type: string;
          submitted_at?: string;
          submitted_by: string;
          updated_at?: string;
        };
        Update: {
          assigned_l1_approver_id?: string;
          assigned_l2_approver_id?: string | null;
          bc_claim_details_id?: string | null;
          cc_emails?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          department_id?: string;
          detail_type?: string;
          employee_id?: string;
          finance_action_at?: string | null;
          hod_action_at?: string | null;
          id?: string;
          is_active?: boolean;
          is_resubmission_allowed?: boolean;
          on_behalf_email?: string | null;
          on_behalf_employee_code?: string | null;
          on_behalf_of_id?: string;
          payment_mode_id?: string;
          rejection_reason?: string | null;
          status?: Database["public"]["Enums"]["claim_status"];
          submission_type?: string;
          submitted_at?: string;
          submitted_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claims_assigned_l1_approver_id_fkey";
            columns: ["assigned_l1_approver_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_assigned_l2_approver_id_fkey";
            columns: ["assigned_l2_approver_id"];
            isOneToOne: false;
            referencedRelation: "master_finance_approvers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_bc_claim_details_id_fkey";
            columns: ["bc_claim_details_id"];
            isOneToOne: false;
            referencedRelation: "bc_claim_details";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_on_behalf_of_id_fkey";
            columns: ["on_behalf_of_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_payment_mode_id_fkey";
            columns: ["payment_mode_id"];
            isOneToOne: false;
            referencedRelation: "master_payment_modes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      claims_analytics_daily_stats: {
        Row: {
          assigned_l2_approver_id: string | null;
          bucket_key: string;
          claim_count: number;
          created_at: string;
          date_key: string;
          department_id: string | null;
          expense_category_id: string | null;
          finance_approval_hours: number;
          finance_approval_samples: number;
          hod_approval_hours_sum: number;
          hod_approval_sample_count: number;
          payment_mode_id: string | null;
          product_id: string | null;
          status: Database["public"]["Enums"]["claim_status"];
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          assigned_l2_approver_id?: string | null;
          bucket_key: string;
          claim_count?: number;
          created_at?: string;
          date_key: string;
          department_id?: string | null;
          expense_category_id?: string | null;
          finance_approval_hours?: number;
          finance_approval_samples?: number;
          hod_approval_hours_sum?: number;
          hod_approval_sample_count?: number;
          payment_mode_id?: string | null;
          product_id?: string | null;
          status: Database["public"]["Enums"]["claim_status"];
          total_amount?: number;
          updated_at?: string;
        };
        Update: {
          assigned_l2_approver_id?: string | null;
          bucket_key?: string;
          claim_count?: number;
          created_at?: string;
          date_key?: string;
          department_id?: string | null;
          expense_category_id?: string | null;
          finance_approval_hours?: number;
          finance_approval_samples?: number;
          hod_approval_hours_sum?: number;
          hod_approval_sample_count?: number;
          payment_mode_id?: string | null;
          product_id?: string | null;
          status?: Database["public"]["Enums"]["claim_status"];
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claims_analytics_daily_stats_assigned_l2_approver_id_fkey";
            columns: ["assigned_l2_approver_id"];
            isOneToOne: false;
            referencedRelation: "master_finance_approvers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_daily_stats_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_daily_stats_expense_category_id_fkey";
            columns: ["expense_category_id"];
            isOneToOne: false;
            referencedRelation: "master_expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_daily_stats_payment_mode_id_fkey";
            columns: ["payment_mode_id"];
            isOneToOne: false;
            referencedRelation: "master_payment_modes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_daily_stats_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "master_products";
            referencedColumns: ["id"];
          },
        ];
      };
      claims_analytics_snapshot: {
        Row: {
          assigned_l2_approver_id: string | null;
          claim_count: number;
          claim_id: string;
          created_at: string;
          date_key: string;
          department_id: string;
          expense_category_id: string | null;
          finance_approval_hours: number;
          finance_approval_samples: number;
          hod_approval_hours_sum: number;
          hod_approval_sample_count: number;
          payment_mode_id: string;
          product_id: string | null;
          status: Database["public"]["Enums"]["claim_status"];
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          assigned_l2_approver_id?: string | null;
          claim_count?: number;
          claim_id: string;
          created_at?: string;
          date_key: string;
          department_id: string;
          expense_category_id?: string | null;
          finance_approval_hours?: number;
          finance_approval_samples?: number;
          hod_approval_hours_sum?: number;
          hod_approval_sample_count?: number;
          payment_mode_id: string;
          product_id?: string | null;
          status: Database["public"]["Enums"]["claim_status"];
          total_amount?: number;
          updated_at?: string;
        };
        Update: {
          assigned_l2_approver_id?: string | null;
          claim_count?: number;
          claim_id?: string;
          created_at?: string;
          date_key?: string;
          department_id?: string;
          expense_category_id?: string | null;
          finance_approval_hours?: number;
          finance_approval_samples?: number;
          hod_approval_hours_sum?: number;
          hod_approval_sample_count?: number;
          payment_mode_id?: string;
          product_id?: string | null;
          status?: Database["public"]["Enums"]["claim_status"];
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claims_analytics_snapshot_assigned_l2_approver_id_fkey";
            columns: ["assigned_l2_approver_id"];
            isOneToOne: false;
            referencedRelation: "master_finance_approvers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "vw_admin_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "vw_enterprise_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_expense_category_id_fkey";
            columns: ["expense_category_id"];
            isOneToOne: false;
            referencedRelation: "master_expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_payment_mode_id_fkey";
            columns: ["payment_mode_id"];
            isOneToOne: false;
            referencedRelation: "master_payment_modes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_analytics_snapshot_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "master_products";
            referencedColumns: ["id"];
          },
        ];
      };
      department_viewers: {
        Row: {
          created_at: string;
          department_id: string;
          id: string;
          is_active: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          department_id: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          department_id?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "department_viewers_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "department_viewers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_category_bc_mappings: {
        Row: {
          bc_code: string | null;
          created_at: string;
          expense_category_id: string;
          id: string;
          is_active: boolean;
        };
        Insert: {
          bc_code?: string | null;
          created_at?: string;
          expense_category_id: string;
          id?: string;
          is_active?: boolean;
        };
        Update: {
          bc_code?: string | null;
          created_at?: string;
          expense_category_id?: string;
          id?: string;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "expense_category_bc_mappings_expense_category_id_fkey";
            columns: ["expense_category_id"];
            isOneToOne: true;
            referencedRelation: "master_expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_details: {
        Row: {
          ai_metadata: Json | null;
          bank_statement_file_path: string | null;
          basic_amount: number;
          bill_no: string;
          cgst_amount: number;
          claim_id: string;
          created_at: string;
          currency_code: Database["public"]["Enums"]["local_currency_code"];
          expense_category_id: string;
          foreign_basic_amount: number;
          foreign_currency_code: Database["public"]["Enums"]["foreign_currency_code"];
          foreign_gst_amount: number;
          foreign_total_amount: number | null;
          gst_number: string | null;
          id: string;
          igst_amount: number;
          is_active: boolean;
          is_gst_applicable: boolean;
          location_details: string | null;
          location_id: string;
          location_type: string | null;
          people_involved: string | null;
          product_id: string | null;
          purpose: string;
          receipt_file_path: string | null;
          remarks: string | null;
          sgst_amount: number;
          total_amount: number;
          transaction_date: string;
          transaction_id: string | null;
          updated_at: string;
          vendor_name: string | null;
        };
        Insert: {
          ai_metadata?: Json | null;
          bank_statement_file_path?: string | null;
          basic_amount: number;
          bill_no: string;
          cgst_amount?: number;
          claim_id: string;
          created_at?: string;
          currency_code?: Database["public"]["Enums"]["local_currency_code"];
          expense_category_id: string;
          foreign_basic_amount?: number;
          foreign_currency_code?: Database["public"]["Enums"]["foreign_currency_code"];
          foreign_gst_amount?: number;
          foreign_total_amount?: number | null;
          gst_number?: string | null;
          id?: string;
          igst_amount?: number;
          is_active?: boolean;
          is_gst_applicable?: boolean;
          location_details?: string | null;
          location_id: string;
          location_type?: string | null;
          people_involved?: string | null;
          product_id?: string | null;
          purpose?: string;
          receipt_file_path?: string | null;
          remarks?: string | null;
          sgst_amount?: number;
          total_amount: number;
          transaction_date: string;
          transaction_id?: string | null;
          updated_at?: string;
          vendor_name?: string | null;
        };
        Update: {
          ai_metadata?: Json | null;
          bank_statement_file_path?: string | null;
          basic_amount?: number;
          bill_no?: string;
          cgst_amount?: number;
          claim_id?: string;
          created_at?: string;
          currency_code?: Database["public"]["Enums"]["local_currency_code"];
          expense_category_id?: string;
          foreign_basic_amount?: number;
          foreign_currency_code?: Database["public"]["Enums"]["foreign_currency_code"];
          foreign_gst_amount?: number;
          foreign_total_amount?: number | null;
          gst_number?: string | null;
          id?: string;
          igst_amount?: number;
          is_active?: boolean;
          is_gst_applicable?: boolean;
          location_details?: string | null;
          location_id?: string;
          location_type?: string | null;
          people_involved?: string | null;
          product_id?: string | null;
          purpose?: string;
          receipt_file_path?: string | null;
          remarks?: string | null;
          sgst_amount?: number;
          total_amount?: number;
          transaction_date?: string;
          transaction_id?: string | null;
          updated_at?: string;
          vendor_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "vw_admin_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "expense_details_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: true;
            referencedRelation: "vw_enterprise_claims_dashboard";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "expense_details_expense_category_id_fkey";
            columns: ["expense_category_id"];
            isOneToOne: false;
            referencedRelation: "master_expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_details_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "master_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_details_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "master_products";
            referencedColumns: ["id"];
          },
        ];
      };
      master_department_responsible_mappings: {
        Row: {
          beneficiary_department_code: string;
          created_at: string;
          department_id: string;
          id: string;
          is_active: boolean;
          responsible_department_code: string;
        };
        Insert: {
          beneficiary_department_code: string;
          created_at?: string;
          department_id: string;
          id?: string;
          is_active?: boolean;
          responsible_department_code: string;
        };
        Update: {
          beneficiary_department_code?: string;
          created_at?: string;
          department_id?: string;
          id?: string;
          is_active?: boolean;
          responsible_department_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "master_department_responsible_mappings_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
        ];
      };
      master_departments: {
        Row: {
          approver1_id: string | null;
          approver1_provisional_email: string | null;
          approver2_id: string | null;
          approver2_provisional_email: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          approver1_id?: string | null;
          approver1_provisional_email?: string | null;
          approver2_id?: string | null;
          approver2_provisional_email?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          approver1_id?: string | null;
          approver1_provisional_email?: string | null;
          approver2_id?: string | null;
          approver2_provisional_email?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "master_departments_approver1_id_fkey";
            columns: ["approver1_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "master_departments_approver2_id_fkey";
            columns: ["approver2_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      master_expense_categories: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      master_expense_location_mappings: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          location_id: string;
          region_code: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          location_id: string;
          region_code: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          location_id?: string;
          region_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "master_expense_location_mappings_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "master_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      master_finance_approvers: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          is_primary: boolean;
          provisional_email: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          provisional_email?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          provisional_email?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "master_finance_approvers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      master_locations: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      master_payment_modes: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      master_policies: {
        Row: {
          created_at: string;
          file_url: string;
          id: string;
          is_active: boolean;
          version_name: string;
        };
        Insert: {
          created_at?: string;
          file_url: string;
          id?: string;
          is_active?: boolean;
          version_name: string;
        };
        Update: {
          created_at?: string;
          file_url?: string;
          id?: string;
          is_active?: boolean;
          version_name?: string;
        };
        Relationships: [];
      };
      master_products: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      master_program_product_mappings: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          product_id: string;
          program_code: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          product_id: string;
          program_code: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          product_id?: string;
          program_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "master_program_product_mappings_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "master_products";
            referencedColumns: ["id"];
          },
        ];
      };
      master_sub_product_mappings: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          product_id: string;
          sub_product_code: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          product_id: string;
          sub_product_code: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          product_id?: string;
          sub_product_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "master_sub_product_mappings_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "master_products";
            referencedColumns: ["id"];
          },
        ];
      };
      user_policy_acceptances: {
        Row: {
          accepted_at: string;
          id: string;
          policy_id: string;
          user_id: string;
        };
        Insert: {
          accepted_at?: string;
          id?: string;
          policy_id: string;
          user_id: string;
        };
        Update: {
          accepted_at?: string;
          id?: string;
          policy_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_policy_acceptances_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "master_policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_policy_acceptances_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          created_at: string;
          id: string;
          petty_cash_balance: number;
          total_petty_cash_received: number;
          total_petty_cash_spent: number;
          total_reimbursements_received: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          petty_cash_balance?: number;
          total_petty_cash_received?: number;
          total_petty_cash_spent?: number;
          total_reimbursements_received?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          petty_cash_balance?: number;
          total_petty_cash_received?: number;
          total_petty_cash_spent?: number;
          total_reimbursements_received?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      vw_admin_claims_dashboard: {
        Row: {
          amount: number | null;
          assigned_l1_approver_id: string | null;
          assigned_l2_approver_id: string | null;
          bank_statement_file_path: string | null;
          bc_claim_details_id: string | null;
          beneficiary_name_raw: string | null;
          category_name: string | null;
          claim_employee_id_raw: string | null;
          claim_id: string | null;
          created_at: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          deleted_by_name: string | null;
          deleted_by_role: string | null;
          department_id: string | null;
          department_name: string | null;
          detail_type: string | null;
          employee_id: string | null;
          employee_name: string | null;
          expense_category_id: string | null;
          finance_action_date: string | null;
          finance_email: string | null;
          hod_action_date: string | null;
          hod_email: string | null;
          is_active: boolean | null;
          is_vendor_payment: boolean | null;
          location_id: string | null;
          on_behalf_email: string | null;
          on_behalf_employee_code_raw: string | null;
          on_behalf_of_id: string | null;
          payment_mode_id: string | null;
          product_id: string | null;
          purpose: string | null;
          receipt_file_path: string | null;
          status: Database["public"]["Enums"]["claim_status"] | null;
          submission_type: string | null;
          submitted_by: string | null;
          submitted_on: string | null;
          submitter_email: string | null;
          submitter_label: string | null;
          submitter_name_raw: string | null;
          supporting_document_path: string | null;
          type_of_claim: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "claims_assigned_l1_approver_id_fkey";
            columns: ["assigned_l1_approver_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_assigned_l2_approver_id_fkey";
            columns: ["assigned_l2_approver_id"];
            isOneToOne: false;
            referencedRelation: "master_finance_approvers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_bc_claim_details_id_fkey";
            columns: ["bc_claim_details_id"];
            isOneToOne: false;
            referencedRelation: "bc_claim_details";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_on_behalf_of_id_fkey";
            columns: ["on_behalf_of_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_payment_mode_id_fkey";
            columns: ["payment_mode_id"];
            isOneToOne: false;
            referencedRelation: "master_payment_modes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_details_expense_category_id_fkey";
            columns: ["expense_category_id"];
            isOneToOne: false;
            referencedRelation: "master_expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      vw_enterprise_claims_dashboard: {
        Row: {
          amount: number | null;
          assigned_l1_approver_id: string | null;
          assigned_l2_approver_id: string | null;
          bank_statement_file_path: string | null;
          bc_claim_details_id: string | null;
          beneficiary_name_raw: string | null;
          category_name: string | null;
          claim_employee_id_raw: string | null;
          claim_id: string | null;
          created_at: string | null;
          department_id: string | null;
          department_name: string | null;
          detail_type: string | null;
          employee_id: string | null;
          employee_name: string | null;
          expense_category_id: string | null;
          finance_action_date: string | null;
          finance_email: string | null;
          hod_action_date: string | null;
          hod_email: string | null;
          is_active: boolean | null;
          is_vendor_payment: boolean | null;
          location_id: string | null;
          on_behalf_email: string | null;
          on_behalf_employee_code_raw: string | null;
          on_behalf_of_id: string | null;
          payment_mode_id: string | null;
          product_id: string | null;
          purpose: string | null;
          receipt_file_path: string | null;
          status: Database["public"]["Enums"]["claim_status"] | null;
          submission_type: string | null;
          submitted_by: string | null;
          submitted_on: string | null;
          submitter_email: string | null;
          submitter_label: string | null;
          submitter_name_raw: string | null;
          supporting_document_path: string | null;
          type_of_claim: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "claims_assigned_l1_approver_id_fkey";
            columns: ["assigned_l1_approver_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_assigned_l2_approver_id_fkey";
            columns: ["assigned_l2_approver_id"];
            isOneToOne: false;
            referencedRelation: "master_finance_approvers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_bc_claim_details_id_fkey";
            columns: ["bc_claim_details_id"];
            isOneToOne: false;
            referencedRelation: "bc_claim_details";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "master_departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_on_behalf_of_id_fkey";
            columns: ["on_behalf_of_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_payment_mode_id_fkey";
            columns: ["payment_mode_id"];
            isOneToOne: false;
            referencedRelation: "master_payment_modes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claims_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_details_expense_category_id_fkey";
            columns: ["expense_category_id"];
            isOneToOne: false;
            referencedRelation: "master_expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      apply_claims_analytics_delta:
        | {
            Args: {
              p_assigned_l2_approver_id: string;
              p_claim_count_delta: number;
              p_date_key: string;
              p_department_id: string;
              p_expense_category_id: string;
              p_hod_approval_hours_delta: number;
              p_hod_approval_sample_delta: number;
              p_payment_mode_id: string;
              p_product_id: string;
              p_status: Database["public"]["Enums"]["claim_status"];
              p_total_amount_delta: number;
            };
            Returns: undefined;
          }
        | {
            Args: {
              p_assigned_l2_approver_id: string;
              p_claim_count_delta: number;
              p_date_key: string;
              p_department_id: string;
              p_expense_category_id: string;
              p_finance_approval_hours_delta: number;
              p_finance_approval_sample_delta: number;
              p_hod_approval_hours_delta: number;
              p_hod_approval_sample_delta: number;
              p_payment_mode_id: string;
              p_product_id: string;
              p_status: Database["public"]["Enums"]["claim_status"];
              p_total_amount_delta: number;
            };
            Returns: undefined;
          };
      bulk_process_claims: {
        Args: {
          p_action: string;
          p_actor_id: string;
          p_allow_resubmission?: boolean;
          p_claim_ids: string[];
          p_reason?: string;
        };
        Returns: number;
      };
      complete_bc_claim: {
        Args: {
          p_actor_user_id: string;
          p_bc_details_id: string;
          p_response_json: Json;
        };
        Returns: undefined;
      };
      create_claim_with_detail: { Args: { p_payload: Json }; Returns: string };
      get_bc_claim_payload: { Args: { p_claim_id: string }; Returns: Json };
      get_dashboard_analytics_payload: {
        Args: {
          p_approved_statuses?: Database["public"]["Enums"]["claim_status"][];
          p_date_from?: string;
          p_date_to?: string;
          p_department_id?: string;
          p_expense_category_id?: string;
          p_finance_approver_id?: string;
          p_finance_approver_ids?: string[];
          p_finance_pipeline_statuses?: Database["public"]["Enums"]["claim_status"][];
          p_hod_department_ids?: string[];
          p_hod_pending_status?: Database["public"]["Enums"]["claim_status"];
          p_pending_statuses?: Database["public"]["Enums"]["claim_status"][];
          p_product_id?: string;
          p_rejected_statuses?: Database["public"]["Enums"]["claim_status"][];
          p_scope: string;
        };
        Returns: Json;
      };
      make_claims_analytics_bucket_key: {
        Args: {
          p_assigned_l2_approver_id: string;
          p_date_key: string;
          p_department_id: string;
          p_expense_category_id: string;
          p_payment_mode_id: string;
          p_product_id: string;
          p_status: Database["public"]["Enums"]["claim_status"];
        };
        Returns: string;
      };
      process_l2_mark_paid_transition: {
        Args: { p_actor_id: string; p_claim_id: string };
        Returns: undefined;
      };
      rebuild_claims_analytics_cache: { Args: never; Returns: undefined };
      record_bc_claim_failure: {
        Args: {
          p_actor_user_id: string;
          p_bc_details_id: string;
          p_response_json: Json;
        };
        Returns: undefined;
      };
      refresh_claim_analytics_snapshot: {
        Args: { p_claim_id: string };
        Returns: undefined;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      start_bc_claim_attempt: {
        Args: {
          p_claim_id: string;
          p_is_vendor_payment: boolean;
          p_payload_json: Json;
        };
        Returns: string;
      };
      update_claim_by_finance:
        | {
            Args: {
              p_actor_id: string;
              p_claim_id: string;
              p_edit_reason: string;
              p_payload: Json;
            };
            Returns: undefined;
          }
        | { Args: { p_claim_id: string; p_payload: Json }; Returns: undefined };
    };
    Enums: {
      bc_claim_status: "submitting" | "success" | "failed";
      claim_status:
        | "Submitted - Awaiting HOD approval"
        | "HOD approved - Awaiting finance approval"
        | "Finance Approved - Payment under process"
        | "Payment Done - Closed"
        | "Rejected - Resubmission Not Allowed"
        | "Rejected - Resubmission Allowed";
      foreign_currency_code: "INR" | "USD" | "EUR" | "CHF";
      local_currency_code: "INR";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      bc_claim_status: ["submitting", "success", "failed"],
      claim_status: [
        "Submitted - Awaiting HOD approval",
        "HOD approved - Awaiting finance approval",
        "Finance Approved - Payment under process",
        "Payment Done - Closed",
        "Rejected - Resubmission Not Allowed",
        "Rejected - Resubmission Allowed",
      ],
      foreign_currency_code: ["INR", "USD", "EUR", "CHF"],
      local_currency_code: ["INR"],
    },
  },
} as const;
