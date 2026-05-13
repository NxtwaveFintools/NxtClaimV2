export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4";
  };
  public: {
    Tables: {
      bc_claim_vendors: {
        Row: {
          bc_vendor_id: string;
          bc_vendor_name: string;
          claim_id: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          bc_vendor_id: string;
          bc_vendor_name: string;
          claim_id: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          bc_vendor_id?: string;
          bc_vendor_name?: string;
          claim_id?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bc_claim_vendors_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claims";
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
      departments: {
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
      users: {
        Row: {
          created_at: string;
          department_id: string | null;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          l1_approver_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          department_id?: string | null;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          l1_approver_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          department_id?: string | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          l1_approver_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "users_l1_approver_id_fkey";
            columns: ["l1_approver_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
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

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
