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
      assignments: {
        Row: {
          allocation_percent: number
          bid_id: string
          created_at: string
          ends_at: string
          id: string
          member_id: string
          org_id: string
          starts_at: string
        }
        Insert: {
          allocation_percent: number
          bid_id: string
          created_at?: string
          ends_at: string
          id?: string
          member_id: string
          org_id: string
          starts_at: string
        }
        Update: {
          allocation_percent?: number
          bid_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          member_id?: string
          org_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_member_fkey"
            columns: ["member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          before_after: Json
          created_at: string
          id: string
          org_id: string
          request_id: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          before_after?: Json
          created_at?: string
          id?: string
          org_id: string
          request_id?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          before_after?: Json
          created_at?: string
          id?: string
          org_id?: string
          request_id?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_documents: {
        Row: {
          bid_id: string
          created_at: string
          download_error_code: string | null
          download_status: string
          format: string | null
          id: string
          mime_type: string | null
          name: string
          object_key: string | null
          original_url: string
          page_count: number | null
          parse_error_code: string | null
          parse_quality: Json | null
          parse_status: string | null
          parser_id: string | null
          revision_id: string
          sha256: string | null
          size_bytes: number | null
          text_object_key: string | null
        }
        Insert: {
          bid_id: string
          created_at?: string
          download_error_code?: string | null
          download_status?: string
          format?: string | null
          id?: string
          mime_type?: string | null
          name: string
          object_key?: string | null
          original_url: string
          page_count?: number | null
          parse_error_code?: string | null
          parse_quality?: Json | null
          parse_status?: string | null
          parser_id?: string | null
          revision_id: string
          sha256?: string | null
          size_bytes?: number | null
          text_object_key?: string | null
        }
        Update: {
          bid_id?: string
          created_at?: string
          download_error_code?: string | null
          download_status?: string
          format?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          object_key?: string | null
          original_url?: string
          page_count?: number | null
          parse_error_code?: string | null
          parse_quality?: Json | null
          parse_status?: string | null
          parser_id?: string | null
          revision_id?: string
          sha256?: string | null
          size_bytes?: number | null
          text_object_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_documents_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_documents_revision_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
          },
        ]
      }
      bid_notices: {
        Row: {
          agency: string | null
          budget_krw: number | null
          content_hash: string
          created_at: string
          deadline_at: string | null
          id: string
          is_demo: boolean
          last_synced_at: string
          latest_revision: number
          notice_id: string
          plan_ref: string | null
          pre_spec_ref: string | null
          published_at: string | null
          source: string
          source_url: string
          stage: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agency?: string | null
          budget_krw?: number | null
          content_hash: string
          created_at?: string
          deadline_at?: string | null
          id?: string
          is_demo?: boolean
          last_synced_at?: string
          latest_revision?: number
          notice_id: string
          plan_ref?: string | null
          pre_spec_ref?: string | null
          published_at?: string | null
          source: string
          source_url: string
          stage: string
          status: string
          title: string
          updated_at?: string
        }
        Update: {
          agency?: string | null
          budget_krw?: number | null
          content_hash?: string
          created_at?: string
          deadline_at?: string | null
          id?: string
          is_demo?: boolean
          last_synced_at?: string
          latest_revision?: number
          notice_id?: string
          plan_ref?: string | null
          pre_spec_ref?: string | null
          published_at?: string | null
          source?: string
          source_url?: string
          stage?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      bid_reviews: {
        Row: {
          assignee_id: string | null
          bid_id: string
          created_at: string
          decided_at: string
          decision: string
          disagreement_flag: boolean
          id: string
          org_id: string
          reason: string
          reviewer_id: string | null
          revision_id: string
          score_run_id: string | null
          system_recommendation: string | null
        }
        Insert: {
          assignee_id?: string | null
          bid_id: string
          created_at?: string
          decided_at?: string
          decision: string
          disagreement_flag?: boolean
          id?: string
          org_id: string
          reason: string
          reviewer_id?: string | null
          revision_id: string
          score_run_id?: string | null
          system_recommendation?: string | null
        }
        Update: {
          assignee_id?: string | null
          bid_id?: string
          created_at?: string
          decided_at?: string
          decision?: string
          disagreement_flag?: boolean
          id?: string
          org_id?: string
          reason?: string
          reviewer_id?: string | null
          revision_id?: string
          score_run_id?: string | null
          system_recommendation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_reviews_assignee_fkey"
            columns: ["org_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "bid_reviews_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_reviews_revision_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
          },
          {
            foreignKeyName: "bid_reviews_score_run_fkey"
            columns: ["score_run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "score_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      bid_revisions: {
        Row: {
          amendment_no: string | null
          bid_id: string
          changed_fields: string[]
          checksum: string
          created_at: string
          fetched_at: string
          id: string
          normalized: Json
          raw_payload: Json
          revision: number
        }
        Insert: {
          amendment_no?: string | null
          bid_id: string
          changed_fields?: string[]
          checksum: string
          created_at?: string
          fetched_at?: string
          id?: string
          normalized: Json
          raw_payload: Json
          revision: number
        }
        Update: {
          amendment_no?: string | null
          bid_id?: string
          changed_fields?: string[]
          checksum?: string
          created_at?: string
          fetched_at?: string
          id?: string
          normalized?: Json
          raw_payload?: Json
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "bid_revisions_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_structured_requirements: {
        Row: {
          bid_id: string
          code: string | null
          created_at: string
          id: string
          kind: string
          name: string | null
          revision_id: string
          seq: number
          source_operation: string
          value: Json
        }
        Insert: {
          bid_id: string
          code?: string | null
          created_at?: string
          id?: string
          kind: string
          name?: string | null
          revision_id: string
          seq: number
          source_operation: string
          value: Json
        }
        Update: {
          bid_id?: string
          code?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          revision_id?: string
          seq?: number
          source_operation?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bid_structured_requirements_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_structured_requirements_revision_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          effective_at: string
          financials: Json | null
          id: string
          industry_codes: Json
          is_demo: boolean
          licenses: Json
          name: string
          note: string | null
          org_id: string
          past_projects: Json
          preferences: Json | null
          revision: number
          technologies: Json
          technologies_complete: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          financials?: Json | null
          id?: string
          industry_codes?: Json
          is_demo?: boolean
          licenses?: Json
          name: string
          note?: string | null
          org_id: string
          past_projects?: Json
          preferences?: Json | null
          revision: number
          technologies?: Json
          technologies_complete?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          financials?: Json | null
          id?: string
          industry_codes?: Json
          is_demo?: boolean
          licenses?: Json
          name?: string
          note?: string | null
          org_id?: string
          past_projects?: Json
          preferences?: Json | null
          revision?: number
          technologies?: Json
          technologies_complete?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      eval_runs: {
        Row: {
          created_at: string
          dataset_sha256: string
          dataset_version: string
          git_commit: string
          id: string
          metrics: Json
          split: string
          system_id: string
        }
        Insert: {
          created_at?: string
          dataset_sha256: string
          dataset_version: string
          git_commit: string
          id?: string
          metrics?: Json
          split: string
          system_id: string
        }
        Update: {
          created_at?: string
          dataset_sha256?: string
          dataset_version?: string
          git_commit?: string
          id?: string
          metrics?: Json
          split?: string
          system_id?: string
        }
        Relationships: []
      }
      ingest_errors: {
        Row: {
          created_at: string
          error_code: string
          id: string
          ingest_run_id: string
          redacted_detail: string
          result_code: string | null
          source_key: string
        }
        Insert: {
          created_at?: string
          error_code: string
          id?: string
          ingest_run_id: string
          redacted_detail?: string
          result_code?: string | null
          source_key: string
        }
        Update: {
          created_at?: string
          error_code?: string
          id?: string
          ingest_run_id?: string
          redacted_detail?: string
          result_code?: string | null
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_errors_ingest_run_id_fkey"
            columns: ["ingest_run_id"]
            isOneToOne: false
            referencedRelation: "ingest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_runs: {
        Row: {
          batch: string | null
          cursor: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_key: string
          params: Json | null
          quota_used: number
          requested_by: string | null
          run_mode: string
          source: string
          started_at: string
          status: string
          summary: Json
          trigger: string
        }
        Insert: {
          batch?: string | null
          cursor?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_key: string
          params?: Json | null
          quota_used?: number
          requested_by?: string | null
          run_mode: string
          source: string
          started_at?: string
          status?: string
          summary?: Json
          trigger: string
        }
        Update: {
          batch?: string | null
          cursor?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_key?: string
          params?: Json | null
          quota_used?: number
          requested_by?: string | null
          run_mode?: string
          source?: string
          started_at?: string
          status?: string
          summary?: Json
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          sol_role: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          org_role?: string
          sol_role?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          org_role?: string
          sol_role?: string
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
          sol_role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          org_role?: string
          sol_role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          org_role?: string
          sol_role?: string
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
      notifications: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          org_id: string
          payload: Json
          provider_message_id: string | null
          read_at: string | null
          sent_at: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          org_id: string
          payload?: Json
          provider_message_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          org_id?: string
          payload?: Json
          provider_message_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
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
      outbox_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          attempts: number
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          next_attempt_at: string | null
          org_id: string | null
          payload: Json
          processed_at: string | null
          status: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          attempts?: number
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          next_attempt_at?: string | null
          org_id?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          attempts?: number
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          next_attempt_at?: string | null
          org_id?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbox_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      qualification_checks: {
        Row: {
          basis: string
          bid_id: string
          checked_at: string
          company_evidence: Json
          evidence: Json
          id: string
          mandatory: boolean
          org_id: string
          outcome: string
          profile_evidence: Json | null
          reason: string
          reason_code: string | null
          requirement_code: string | null
          requirement_name: string
          revision_id: string
          score_run_id: string
        }
        Insert: {
          basis: string
          bid_id: string
          checked_at?: string
          company_evidence?: Json
          evidence?: Json
          id?: string
          mandatory?: boolean
          org_id: string
          outcome: string
          profile_evidence?: Json | null
          reason: string
          reason_code?: string | null
          requirement_code?: string | null
          requirement_name: string
          revision_id: string
          score_run_id: string
        }
        Update: {
          basis?: string
          bid_id?: string
          checked_at?: string
          company_evidence?: Json
          evidence?: Json
          id?: string
          mandatory?: boolean
          org_id?: string
          outcome?: string
          profile_evidence?: Json | null
          reason?: string
          reason_code?: string | null
          requirement_code?: string | null
          requirement_name?: string
          revision_id?: string
          score_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_checks_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_checks_revision_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
          },
          {
            foreignKeyName: "qualification_checks_score_run_fkey"
            columns: ["score_run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "score_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      requirement_assessments: {
        Row: {
          basis: string
          company_evidence: Json
          created_at: string
          flags: string[]
          id: string
          item_id: string
          item_kind: string
          kev_distribution: Json | null
          kev_label: string | null
          notice_evidence: Json
          org_id: string
          rule_reason: string | null
          rule_status: string
          score_run_id: string
        }
        Insert: {
          basis: string
          company_evidence?: Json
          created_at?: string
          flags?: string[]
          id?: string
          item_id: string
          item_kind: string
          kev_distribution?: Json | null
          kev_label?: string | null
          notice_evidence?: Json
          org_id: string
          rule_reason?: string | null
          rule_status: string
          score_run_id: string
        }
        Update: {
          basis?: string
          company_evidence?: Json
          created_at?: string
          flags?: string[]
          id?: string
          item_id?: string
          item_kind?: string
          kev_distribution?: Json | null
          kev_label?: string | null
          notice_evidence?: Json
          org_id?: string
          rule_reason?: string | null
          rule_status?: string
          score_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirement_assessments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_assessments_score_run_fkey"
            columns: ["score_run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "score_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      requirement_extractions: {
        Row: {
          bid_id: string
          created_at: string
          id: string
          latency_ms: number
          model_name: string
          payload: Json
          prompt_hash: string
          prompt_version: string
          provider: string
          retries: number
          revision_id: string
          schema_version: string
          status: string
          translations: Json | null
          warnings: Json
        }
        Insert: {
          bid_id: string
          created_at?: string
          id?: string
          latency_ms?: number
          model_name: string
          payload?: Json
          prompt_hash: string
          prompt_version: string
          provider: string
          retries?: number
          revision_id: string
          schema_version: string
          status?: string
          translations?: Json | null
          warnings?: Json
        }
        Update: {
          bid_id?: string
          created_at?: string
          id?: string
          latency_ms?: number
          model_name?: string
          payload?: Json
          prompt_hash?: string
          prompt_version?: string
          provider?: string
          retries?: number
          revision_id?: string
          schema_version?: string
          status?: string
          translations?: Json | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "requirement_extractions_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_extractions_revision_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
          },
        ]
      }
      score_factors: {
        Row: {
          evidence: Json
          factor: string
          id: string
          max_points: number
          missing: boolean
          normalized: number | null
          note: string | null
          org_id: string
          points: number
          raw_value: Json | null
          score_run_id: string
        }
        Insert: {
          evidence?: Json
          factor: string
          id?: string
          max_points: number
          missing?: boolean
          normalized?: number | null
          note?: string | null
          org_id: string
          points: number
          raw_value?: Json | null
          score_run_id: string
        }
        Update: {
          evidence?: Json
          factor?: string
          id?: string
          max_points?: number
          missing?: boolean
          normalized?: number | null
          note?: string | null
          org_id?: string
          points?: number
          raw_value?: Json | null
          score_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_factors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_factors_score_run_fkey"
            columns: ["score_run_id", "org_id"]
            isOneToOne: false
            referencedRelation: "score_runs"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      score_runs: {
        Row: {
          ai_provider: string
          algorithm_version: string
          bid_id: string
          company_profile_id: string
          created_at: string
          error_code: string | null
          explanation: string | null
          extraction_id: string | null
          fallback_reason: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          injection_suspected: boolean
          input_snapshot: Json | null
          input_snapshot_hash: string | null
          kev_calibration: string | null
          kev_model: string | null
          kev_output: Json | null
          missing_factors: string[]
          model_metadata: Json
          org_id: string
          profile_revision: number
          prompt_hash: string | null
          question_set_version: string | null
          queued_at: string
          qwen_model: string | null
          recommendation: string | null
          recommendation_basis: string | null
          requested_by: string | null
          review_flags: string[]
          revision_id: string
          run_mode: string
          score: number | null
          started_at: string | null
          status: string
        }
        Insert: {
          ai_provider: string
          algorithm_version: string
          bid_id: string
          company_profile_id: string
          created_at?: string
          error_code?: string | null
          explanation?: string | null
          extraction_id?: string | null
          fallback_reason?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          injection_suspected?: boolean
          input_snapshot?: Json | null
          input_snapshot_hash?: string | null
          kev_calibration?: string | null
          kev_model?: string | null
          kev_output?: Json | null
          missing_factors?: string[]
          model_metadata?: Json
          org_id: string
          profile_revision: number
          prompt_hash?: string | null
          question_set_version?: string | null
          queued_at?: string
          qwen_model?: string | null
          recommendation?: string | null
          recommendation_basis?: string | null
          requested_by?: string | null
          review_flags?: string[]
          revision_id: string
          run_mode: string
          score?: number | null
          started_at?: string | null
          status?: string
        }
        Update: {
          ai_provider?: string
          algorithm_version?: string
          bid_id?: string
          company_profile_id?: string
          created_at?: string
          error_code?: string | null
          explanation?: string | null
          extraction_id?: string | null
          fallback_reason?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          injection_suspected?: boolean
          input_snapshot?: Json | null
          input_snapshot_hash?: string | null
          kev_calibration?: string | null
          kev_model?: string | null
          kev_output?: Json | null
          missing_factors?: string[]
          model_metadata?: Json
          org_id?: string
          profile_revision?: number
          prompt_hash?: string | null
          question_set_version?: string | null
          queued_at?: string
          qwen_model?: string | null
          recommendation?: string | null
          recommendation_basis?: string | null
          requested_by?: string | null
          review_flags?: string[]
          revision_id?: string
          run_mode?: string
          score?: number | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_runs_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_runs_company_profile_fkey"
            columns: ["company_profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "score_runs_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "requirement_extractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_runs_revision_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
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
      audit_request_id: {
        Args: never
        Returns: string
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
      ingest_save_revision: {
        Args: { p: Json }
        Returns: { bid_id: string; revision_id: string }[]
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
      my_sol_org_ids: {
        Args: { roles: string[] }
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
