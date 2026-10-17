// 생성물 — 손으로 고치지 말 것 (pnpm db:types).
// 정본은 supabase/migrations 다. 마이그레이션을 PGlite 에 적용해 public 스키마에서 만든다(scripts/db-types-gen.mjs).
// 모양은 `supabase gen types typescript` 출력과 같다. 코드에서는 SupabaseClient<Database> 로 쓴다.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          kind: string
          new_role: string | null
          old_role: string | null
          org_id: string
          target_name: string | null
          target_user_id: string | null
          task_title: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind: string
          new_role?: string | null
          old_role?: string | null
          org_id: string
          target_name?: string | null
          target_user_id?: string | null
          task_title?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          new_role?: string | null
          old_role?: string | null
          org_id?: string
          target_name?: string | null
          target_user_id?: string | null
          task_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          id: string
          is_demo: boolean
          kind: string | null
          name: string
          org_id: string
          parent_id: string | null
          source_count: number | null
          target_count: number | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string | null
          name: string
          org_id: string
          parent_id?: string | null
          source_count?: number | null
          target_count?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          kind?: string | null
          name?: string
          org_id?: string
          parent_id?: string | null
          source_count?: number | null
          target_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_org_fkey"
            columns: ["parent_id", "org_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          org_role: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          org_role?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          org_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_titles: {
        Row: {
          code: string
          created_at: string
          id: string
          label: string
          org_id: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          label: string
          org_id: string
          sort_order: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          label?: string
          org_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_titles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          org_id: string
          org_role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          org_role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          org_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          name: string
          personal_owner_id: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          personal_owner_id?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          personal_owner_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_personal_owner_id_fkey"
            columns: ["personal_owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          declared_department_id: string | null
          declared_job_title_id: string | null
          display_name: string | null
          email: string | null
          id: string
          is_admin: boolean
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          declared_department_id?: string | null
          declared_job_title_id?: string | null
          display_name?: string | null
          email?: string | null
          id: string
          is_admin?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          declared_department_id?: string | null
          declared_job_title_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_admin?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_declared_department_id_fkey"
            columns: ["declared_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_declared_job_title_id_fkey"
            columns: ["declared_job_title_id"]
            isOneToOne: false
            referencedRelation: "job_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          org_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          org_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          org_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_fkey"
            columns: ["org_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_member_scoring: {
        Row: {
          availability: Json
          created_at: string
          grade: string | null
          member_id: string
          org_id: string
          role: string
          skills: Json
        }
        Insert: {
          availability?: Json
          created_at?: string
          grade?: string | null
          member_id: string
          org_id: string
          role: string
          skills?: Json
        }
        Update: {
          availability?: Json
          created_at?: string
          grade?: string | null
          member_id?: string
          org_id?: string
          role?: string
          skills?: Json
        }
        Relationships: [
          {
            foreignKeyName: "team_member_scoring_member_id_org_id_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "team_member_scoring_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          department_id: string
          gender: string
          id: string
          is_demo: boolean
          job_title_id: string
          name: string
          org_id: string
          person_code: string
          portrait_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          gender: string
          id?: string
          is_demo?: boolean
          job_title_id: string
          name: string
          org_id: string
          person_code: string
          portrait_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          gender?: string
          id?: string
          is_demo?: boolean
          job_title_id?: string
          name?: string
          org_id?: string
          person_code?: string
          portrait_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_department_id_org_id_fkey"
            columns: ["department_id", "org_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "team_members_job_title_id_org_id_fkey"
            columns: ["job_title_id", "org_id"]
            isOneToOne: false
            referencedRelation: "job_titles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "team_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activity_name_of: {
        Args: { person: string }
        Returns: string
      }
      admin_set_user_status: {
        Args: { next_status: string; target: string }
        Returns: undefined
      }
      avatar_url_from_metadata: {
        Args: { meta: Json }
        Returns: string
      }
      create_personal_org: {
        Args: { owner_id: string }
        Returns: string
      }
      delete_my_account: {
        Args: never
        Returns: undefined
      }
      display_name_from_metadata: {
        Args: { meta: Json }
        Returns: string
      }
      is_active_user: {
        Args: never
        Returns: boolean
      }
      is_admin: {
        Args: never
        Returns: boolean
      }
      my_org_ids: {
        Args: never
        Returns: string[]
      }
      my_owner_org_ids: {
        Args: never
        Returns: string[]
      }
      resolve_solideo_employment: {
        Args: { p_department: string; p_job_title: string }
        Returns: { department_code: string; department_id: string; department_name: string; job_title_code: string; job_title_id: string; job_title_label: string }[]
      }
      task_dashboard_stats: {
        Args: { as_of?: string; target_org: string }
        Returns: { completed_this_week: number; daily_added: number[]; daily_completed: number[]; daily_dates: string[]; my_open_count: number; open_count: number; overdue_count: number; today: string; week_start: string }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
