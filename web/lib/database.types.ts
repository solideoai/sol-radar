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
          download_error_message: string | null
          download_status: string
          format: string | null
          id: string
          mime_type: string | null
          name: string
          object_key: string | null
          original_url: string
          page_count: number | null
          parse_error_code: string | null
          parse_error_message: string | null
          parse_quality: Json | null
          parse_status: string | null
          parsed_at: string | null
          parsed_storage_id: string | null
          parser_id: string | null
          processing_attempt_id: string | null
          processing_lease_until: string | null
          raw_storage_id: string | null
          revision_id: string
          sha256: string | null
          size_bytes: number | null
          storage_bucket: string | null
          text_object_key: string | null
          text_storage_bucket: string | null
          uploaded_at: string | null
        }
        Insert: {
          bid_id: string
          created_at?: string
          download_error_code?: string | null
          download_error_message?: string | null
          download_status?: string
          format?: string | null
          id?: string
          mime_type?: string | null
          name: string
          object_key?: string | null
          original_url: string
          page_count?: number | null
          parse_error_code?: string | null
          parse_error_message?: string | null
          parse_quality?: Json | null
          parse_status?: string | null
          parsed_at?: string | null
          parsed_storage_id?: string | null
          parser_id?: string | null
          processing_attempt_id?: string | null
          processing_lease_until?: string | null
          raw_storage_id?: string | null
          revision_id: string
          sha256?: string | null
          size_bytes?: number | null
          storage_bucket?: string | null
          text_object_key?: string | null
          text_storage_bucket?: string | null
          uploaded_at?: string | null
        }
        Update: {
          bid_id?: string
          created_at?: string
          download_error_code?: string | null
          download_error_message?: string | null
          download_status?: string
          format?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          object_key?: string | null
          original_url?: string
          page_count?: number | null
          parse_error_code?: string | null
          parse_error_message?: string | null
          parse_quality?: Json | null
          parse_status?: string | null
          parsed_at?: string | null
          parsed_storage_id?: string | null
          parser_id?: string | null
          processing_attempt_id?: string | null
          processing_lease_until?: string | null
          raw_storage_id?: string | null
          revision_id?: string
          sha256?: string | null
          size_bytes?: number | null
          storage_bucket?: string | null
          text_object_key?: string | null
          text_storage_bucket?: string | null
          uploaded_at?: string | null
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
            foreignKeyName: "bid_documents_parsed_storage_fk"
            columns: ["parsed_storage_id", "text_storage_bucket", "text_object_key"]
            isOneToOne: false
            referencedRelation: "document_storage_objects"
            referencedColumns: ["id", "bucket", "path"]
          },
          {
            foreignKeyName: "bid_documents_raw_storage_fk"
            columns: ["raw_storage_id", "storage_bucket", "object_key"]
            isOneToOne: false
            referencedRelation: "document_storage_objects"
            referencedColumns: ["id", "bucket", "path"]
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
      bid_notice_events: {
        Row: {
          bid_id: string
          evidence: Json
          id: string
          kind: string
          occurred_at: string
          provider_status: string | null
          related_bid_id: string | null
          revision_id: string
        }
        Insert: {
          bid_id: string
          evidence?: Json
          id?: string
          kind: string
          occurred_at?: string
          provider_status?: string | null
          related_bid_id?: string | null
          revision_id: string
        }
        Update: {
          bid_id?: string
          evidence?: Json
          id?: string
          kind?: string
          occurred_at?: string
          provider_status?: string | null
          related_bid_id?: string | null
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_notice_events_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_notice_events_related_bid_id_fkey"
            columns: ["related_bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_notice_events_revision_id_bid_id_fkey"
            columns: ["revision_id", "bid_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id", "bid_id"]
          },
          {
            foreignKeyName: "bid_notice_events_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id"]
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
          procuring_agency_id: string | null
          provider_company_id: string | null
          provider_record_key: string | null
          published_at: string | null
          service_id: string | null
          source: string
          source_family: string | null
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
          procuring_agency_id?: string | null
          provider_company_id?: string | null
          provider_record_key?: string | null
          published_at?: string | null
          service_id?: string | null
          source: string
          source_family?: string | null
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
          procuring_agency_id?: string | null
          provider_company_id?: string | null
          provider_record_key?: string | null
          published_at?: string | null
          service_id?: string | null
          source?: string
          source_family?: string | null
          source_url?: string
          stage?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_notices_procuring_agency_id_fkey"
            columns: ["procuring_agency_id"]
            isOneToOne: false
            referencedRelation: "procurement_agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_opportunities: {
        Row: {
          canonical_notice_id: string
          canonical_reason: Json
          first_seen_at: string
          id: string
          identity_version: string
          is_demo: boolean
          superseded_by: string | null
        }
        Insert: {
          canonical_notice_id: string
          canonical_reason?: Json
          first_seen_at?: string
          id?: string
          identity_version?: string
          is_demo: boolean
          superseded_by?: string | null
        }
        Update: {
          canonical_notice_id?: string
          canonical_reason?: Json
          first_seen_at?: string
          id?: string
          identity_version?: string
          is_demo?: boolean
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_opportunities_canonical_notice_id_fkey"
            columns: ["canonical_notice_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_opportunities_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "bid_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_project_events: {
        Row: {
          actor_id: string | null
          bid_project_id: string
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          org_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          bid_project_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          org_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          bid_project_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          org_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_project_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_project_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_project_events_project_fkey"
            columns: ["bid_project_id", "org_id"]
            isOneToOne: false
            referencedRelation: "bid_projects"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      bid_projects: {
        Row: {
          bid_id: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          opened_by_review_id: string
          org_id: string
          owner_id: string | null
          result: string | null
          result_note: string | null
          result_recorded_at: string | null
          status: string
          submission_due_override: string | null
          updated_at: string
        }
        Insert: {
          bid_id: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          opened_by_review_id: string
          org_id: string
          owner_id?: string | null
          result?: string | null
          result_note?: string | null
          result_recorded_at?: string | null
          status?: string
          submission_due_override?: string | null
          updated_at?: string
        }
        Update: {
          bid_id?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          opened_by_review_id?: string
          org_id?: string
          owner_id?: string | null
          result?: string | null
          result_note?: string | null
          result_recorded_at?: string | null
          status?: string
          submission_due_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_projects_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_projects_opened_by_review_fkey"
            columns: ["opened_by_review_id", "org_id"]
            isOneToOne: false
            referencedRelation: "bid_reviews"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "bid_projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_projects_owner_fkey"
            columns: ["org_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      bid_relevance_assessments: {
        Row: {
          categories: string[]
          created_at: string
          evidence: Json
          id: string
          input_hash: string
          missing_channels: string[]
          policy_version: string
          relevance_score: number | null
          revision_id: string
          state: string
          tags: string[]
        }
        Insert: {
          categories?: string[]
          created_at?: string
          evidence?: Json
          id?: string
          input_hash: string
          missing_channels?: string[]
          policy_version: string
          relevance_score?: number | null
          revision_id: string
          state: string
          tags?: string[]
        }
        Update: {
          categories?: string[]
          created_at?: string
          evidence?: Json
          id?: string
          input_hash?: string
          missing_channels?: string[]
          policy_version?: string
          relevance_score?: number | null
          revision_id?: string
          state?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bid_relevance_assessments_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id"]
          },
        ]
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
      bid_watches: {
        Row: {
          bid_id: string
          created_at: string
          org_id: string
          user_id: string
        }
        Insert: {
          bid_id: string
          created_at?: string
          org_id: string
          user_id: string
        }
        Update: {
          bid_id?: string
          created_at?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_watches_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_watches_member_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
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
          public_history: Json
          revision: number
          sources: Json
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
          public_history?: Json
          revision: number
          sources?: Json
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
          public_history?: Json
          revision?: number
          sources?: Json
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
      document_storage_objects: {
        Row: {
          bucket: string
          created_at: string
          id: string
          lease_token: string
          lease_until: string
          logical_path: string
          mime_type: string
          path: string
          sha256: string
          size_bytes: number
          status: string
          updated_at: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          lease_token: string
          lease_until: string
          logical_path: string
          mime_type: string
          path: string
          sha256: string
          size_bytes: number
          status?: string
          updated_at?: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          lease_token?: string
          lease_until?: string
          logical_path?: string
          mime_type?: string
          path?: string
          sha256?: string
          size_bytes?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
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
      ingest_payloads: {
        Row: {
          content_type: string
          fetched_at: string
          id: string
          object_ref: string | null
          operation: string
          parser_version: string
          partition_key: string
          payload_hash: string
          run_id: string
          sanitized_payload: Json
          service_key: string
        }
        Insert: {
          content_type: string
          fetched_at?: string
          id?: string
          object_ref?: string | null
          operation: string
          parser_version?: string
          partition_key?: string
          payload_hash: string
          run_id: string
          sanitized_payload: Json
          service_key: string
        }
        Update: {
          content_type?: string
          fetched_at?: string
          id?: string
          object_ref?: string | null
          operation?: string
          parser_version?: string
          partition_key?: string
          payload_hash?: string
          run_id?: string
          sanitized_payload?: Json
          service_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_payloads_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_run_items: {
        Row: {
          bid_id: string | null
          created_at: string
          error_code: string | null
          id: string
          outcome: string
          payload_hash: string
          payload_id: string | null
          revision_id: string | null
          run_id: string
          source_record_key: string
        }
        Insert: {
          bid_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          outcome: string
          payload_hash: string
          payload_id?: string | null
          revision_id?: string | null
          run_id: string
          source_record_key: string
        }
        Update: {
          bid_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          outcome?: string
          payload_hash?: string
          payload_id?: string | null
          revision_id?: string | null
          run_id?: string
          source_record_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_run_items_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_run_items_payload_id_fkey"
            columns: ["payload_id"]
            isOneToOne: false
            referencedRelation: "ingest_payloads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_run_items_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "bid_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_runs: {
        Row: {
          batch: string | null
          completeness: string
          cursor: string | null
          fetched_count: number
          finished_at: string | null
          id: string
          idempotency_key: string | null
          job_key: string
          operation: string | null
          params: Json | null
          partition_key: string | null
          quota_used: number
          requested_by: string | null
          run_mode: string
          service_key: string | null
          source: string
          started_at: string
          status: string
          summary: Json
          trigger: string
        }
        Insert: {
          batch?: string | null
          completeness?: string
          cursor?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_key: string
          operation?: string | null
          params?: Json | null
          partition_key?: string | null
          quota_used?: number
          requested_by?: string | null
          run_mode: string
          service_key?: string | null
          source: string
          started_at?: string
          status?: string
          summary?: Json
          trigger: string
        }
        Update: {
          batch?: string | null
          completeness?: string
          cursor?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          job_key?: string
          operation?: string | null
          params?: Json | null
          partition_key?: string | null
          quota_used?: number
          requested_by?: string | null
          run_mode?: string
          service_key?: string | null
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
      kakao_notify_links: {
        Row: {
          access_expires_at: string | null
          access_token_enc: string | null
          created_at: string
          enabled: boolean
          last_result: string | null
          last_sent_at: string | null
          refresh_expires_at: string | null
          refresh_token_enc: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_expires_at?: string | null
          access_token_enc?: string | null
          created_at?: string
          enabled?: boolean
          last_result?: string | null
          last_sent_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_enc?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_expires_at?: string | null
          access_token_enc?: string | null
          created_at?: string
          enabled?: boolean
          last_result?: string | null
          last_sent_at?: string | null
          refresh_expires_at?: string | null
          refresh_token_enc?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kakao_notify_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kakao_send_claims: {
        Row: {
          bid_id: string | null
          claim_key: string
          claimed_at: string
          notification_id: string | null
          outbox_event_id: string | null
          user_id: string
        }
        Insert: {
          bid_id?: string | null
          claim_key: string
          claimed_at?: string
          notification_id?: string | null
          outbox_event_id?: string | null
          user_id: string
        }
        Update: {
          bid_id?: string | null
          claim_key?: string
          claimed_at?: string
          notification_id?: string | null
          outbox_event_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kakao_send_claims_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kakao_send_claims_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kakao_send_claims_outbox_event_id_fkey"
            columns: ["outbox_event_id"]
            isOneToOne: false
            referencedRelation: "outbox_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kakao_send_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_join_requests: {
        Row: {
          applicant_email: string
          applicant_name: string
          applicant_photo_path: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          department_id: string
          id: string
          job_title_id: string
          kind: string
          org_id: string
          sol_role: string | null
          status: string
          team_member_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          applicant_email: string
          applicant_name: string
          applicant_photo_path?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          department_id: string
          id?: string
          job_title_id: string
          kind: string
          org_id: string
          sol_role?: string | null
          status?: string
          team_member_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          applicant_email?: string
          applicant_name?: string
          applicant_photo_path?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          department_id?: string
          id?: string
          job_title_id?: string
          kind?: string
          org_id?: string
          sol_role?: string | null
          status?: string
          team_member_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_join_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_join_requests_department_fkey"
            columns: ["department_id", "org_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "member_join_requests_job_title_fkey"
            columns: ["job_title_id", "org_id"]
            isOneToOne: false
            referencedRelation: "job_titles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "member_join_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_join_requests_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_join_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      notice_match_candidates: {
        Row: {
          created_at: string
          evidence: Json
          id: string
          input_hash: string
          left_bid_id: string
          outcome: string
          policy_version: string
          reasons: string[]
          right_bid_id: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          id?: string
          input_hash: string
          left_bid_id: string
          outcome: string
          policy_version: string
          reasons?: string[]
          right_bid_id: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          id?: string
          input_hash?: string
          left_bid_id?: string
          outcome?: string
          policy_version?: string
          reasons?: string[]
          right_bid_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_match_candidates_left_bid_id_fkey"
            columns: ["left_bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_match_candidates_right_bid_id_fkey"
            columns: ["right_bid_id"]
            isOneToOne: false
            referencedRelation: "bid_notices"
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
      opportunity_notice_links: {
        Row: {
          bid_id: string
          decided_at: string
          evidence: Json
          history: Json
          opportunity_id: string
          policy_version: string
          relation: string
        }
        Insert: {
          bid_id: string
          decided_at?: string
          evidence?: Json
          history?: Json
          opportunity_id: string
          policy_version?: string
          relation: string
        }
        Update: {
          bid_id?: string
          decided_at?: string
          evidence?: Json
          history?: Json
          opportunity_id?: string
          policy_version?: string
          relation?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_notice_links_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: true
            referencedRelation: "bid_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_notice_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "bid_opportunities"
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
      procurement_agencies: {
        Row: {
          agency_code: string
          aliases: string[]
          code_namespace: string
          id: string
          name: string
        }
        Insert: {
          agency_code: string
          aliases?: string[]
          code_namespace: string
          id?: string
          name: string
        }
        Update: {
          agency_code?: string
          aliases?: string[]
          code_namespace?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profile_photo_folders: {
        Row: {
          folder: string
          touched_at: string
        }
        Insert: {
          folder: string
          touched_at?: string
        }
        Update: {
          folder?: string
          touched_at?: string
        }
        Relationships: []
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
          photo_path: string | null
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
          photo_path?: string | null
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
          photo_path?: string | null
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
      program_notice_runs: {
        Row: {
          dropped_count: number
          error_code: string | null
          fetched_count: number
          finished_at: string | null
          id: string
          run_mode: string
          saved_count: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          dropped_count?: number
          error_code?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          run_mode: string
          saved_count?: number
          source: string
          started_at?: string
          status: string
        }
        Update: {
          dropped_count?: number
          error_code?: string | null
          fetched_count?: number
          finished_at?: string | null
          id?: string
          run_mode?: string
          saved_count?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      program_notices: {
        Row: {
          agency: string | null
          apply_end_on: string | null
          apply_method: string | null
          apply_start_on: string | null
          created_at: string
          dedupe_key: string
          fetched_at: string
          id: string
          is_demo: boolean
          published_at: string | null
          source: string
          source_notice_id: string
          source_url: string
          summary: string | null
          tags: string[]
          target: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agency?: string | null
          apply_end_on?: string | null
          apply_method?: string | null
          apply_start_on?: string | null
          created_at?: string
          dedupe_key: string
          fetched_at: string
          id?: string
          is_demo?: boolean
          published_at?: string | null
          source: string
          source_notice_id: string
          source_url: string
          summary?: string | null
          tags?: string[]
          target?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agency?: string | null
          apply_end_on?: string | null
          apply_method?: string | null
          apply_start_on?: string | null
          created_at?: string
          dedupe_key?: string
          fetched_at?: string
          id?: string
          is_demo?: boolean
          published_at?: string | null
          source?: string
          source_notice_id?: string
          source_url?: string
          summary?: string | null
          tags?: string[]
          target?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
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
      recommendation_insights: {
        Row: {
          created_at: string
          error_code: string | null
          fallback_reason: string | null
          finished_at: string | null
          id: string
          model_name: string | null
          org_id: string
          payload: Json | null
          prompt_hash: string | null
          requested_by: string
          score_run_id: string
          source: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          fallback_reason?: string | null
          finished_at?: string | null
          id?: string
          model_name?: string | null
          org_id: string
          payload?: Json | null
          prompt_hash?: string | null
          requested_by?: string
          score_run_id: string
          source?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          fallback_reason?: string | null
          finished_at?: string | null
          id?: string
          model_name?: string | null
          org_id?: string
          payload?: Json | null
          prompt_hash?: string | null
          requested_by?: string
          score_run_id?: string
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_insights_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_insights_score_run_fkey"
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
          missing_reason: string | null
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
          missing_reason?: string | null
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
          missing_reason?: string | null
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
          kev_assist: Json | null
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
          request_hash: string | null
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
          kev_assist?: Json | null
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
          request_hash?: string | null
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
          kev_assist?: Json | null
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
          request_hash?: string | null
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
          bid_project_id: string | null
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
          bid_project_id?: string | null
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
          bid_project_id?: string | null
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
            foreignKeyName: "tasks_bid_project_fkey"
            columns: ["bid_project_id", "org_id"]
            isOneToOne: false
            referencedRelation: "bid_projects"
            referencedColumns: ["id", "org_id"]
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
          capability_source: string
          capability_version: string | null
          certifications: Json
          created_at: string
          grade: string | null
          member_id: string
          org_id: string
          past_projects: Json
          role: string
          skills: Json
        }
        Insert: {
          availability?: Json
          capability_source?: string
          capability_version?: string | null
          certifications?: Json
          created_at?: string
          grade?: string | null
          member_id: string
          org_id: string
          past_projects?: Json
          role: string
          skills?: Json
        }
        Update: {
          availability?: Json
          capability_source?: string
          capability_version?: string | null
          certifications?: Json
          created_at?: string
          grade?: string | null
          member_id?: string
          org_id?: string
          past_projects?: Json
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
          email: string | null
          employment_status: string
          gender: string | null
          id: string
          is_demo: boolean
          job_title_id: string
          name: string
          org_id: string
          person_code: string
          photo_path: string | null
          portrait_path: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          department_id: string
          email?: string | null
          employment_status?: string
          gender?: string | null
          id?: string
          is_demo?: boolean
          job_title_id: string
          name: string
          org_id: string
          person_code: string
          photo_path?: string | null
          portrait_path?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          department_id?: string
          email?: string | null
          employment_status?: string
          gender?: string | null
          id?: string
          is_demo?: boolean
          job_title_id?: string
          name?: string
          org_id?: string
          person_code?: string
          photo_path?: string | null
          portrait_path?: string | null
          updated_at?: string
          user_id?: string | null
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
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          age_confirmed_at: string
          marketing_agreed_at: string | null
          privacy_agreed_at: string
          terms_agreed_at: string
          user_id: string
        }
        Insert: {
          age_confirmed_at: string
          marketing_agreed_at?: string | null
          privacy_agreed_at: string
          terms_agreed_at: string
          user_id: string
        }
        Update: {
          age_confirmed_at?: string
          marketing_agreed_at?: string | null
          privacy_agreed_at?: string
          terms_agreed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bid_list_items: {
        Row: {
          agency: string | null
          budget_krw: number | null
          budget_krw_text: string | null
          deadline_at: string | null
          docs_download_failed: number | null
          docs_failed: number | null
          docs_parsed: number | null
          docs_partial: number | null
          docs_pending: number | null
          docs_total: number | null
          docs_unsupported: number | null
          id: string | null
          is_demo: boolean | null
          last_synced_at: string | null
          latest_decided_at: string | null
          latest_decision: string | null
          latest_reviewer_display_name: string | null
          latest_reviewer_email: string | null
          latest_revision: number | null
          latest_run_basis: string | null
          latest_run_created_at: string | null
          latest_run_flags: string[] | null
          latest_run_id: string | null
          latest_run_recommendation: string | null
          latest_run_score: number | null
          latest_run_status: string | null
          notice_id: string | null
          plan_ref: string | null
          published_at: string | null
          scored_recommendation: string | null
          scored_score: number | null
          source: string | null
          source_url: string | null
          stage: string | null
          status: string | null
          title: string | null
        }
        Relationships: []
      }
      opportunity_list_items: {
        Row: {
          agency: string | null
          agency_id: string | null
          agency_ids: string[] | null
          analysis_id: string | null
          analysis_status: string | null
          bid_id: string | null
          budget_krw: string | null
          budget_krw_value: number | null
          categories: string[] | null
          changed_at: string | null
          company_id: string | null
          company_ids: string[] | null
          deadline_at: string | null
          first_seen_at: string | null
          id: string | null
          is_demo: boolean | null
          it_scope: boolean | null
          latest_decision: string | null
          latest_decision_at: string | null
          latest_run_id: string | null
          latest_run_status: string | null
          notice_id: string | null
          org_id: string | null
          published_at: string | null
          recommend_key: string | null
          recommendation: string | null
          relevance_rank: number | null
          relevance_score: number | null
          relevance_state: string | null
          revision_id: string | null
          sol_score: number | null
          source: string | null
          source_conflict: boolean | null
          source_count: number | null
          source_families: string[] | null
          source_family: string | null
          source_url: string | null
          sources: Json | null
          stage: string | null
          status: string | null
          tags: string[] | null
          title: string | null
        }
        Relationships: []
      }
      watched_bid_list_items: {
        Row: {
          agency: string | null
          budget_krw: number | null
          budget_krw_text: string | null
          deadline_at: string | null
          docs_download_failed: number | null
          docs_failed: number | null
          docs_parsed: number | null
          docs_partial: number | null
          docs_pending: number | null
          docs_total: number | null
          docs_unsupported: number | null
          id: string | null
          is_demo: boolean | null
          last_synced_at: string | null
          latest_decided_at: string | null
          latest_decision: string | null
          latest_reviewer_display_name: string | null
          latest_reviewer_email: string | null
          latest_revision: number | null
          latest_run_basis: string | null
          latest_run_created_at: string | null
          latest_run_flags: string[] | null
          latest_run_id: string | null
          latest_run_recommendation: string | null
          latest_run_score: number | null
          latest_run_status: string | null
          notice_id: string | null
          plan_ref: string | null
          published_at: string | null
          scored_recommendation: string | null
          scored_score: number | null
          source: string | null
          source_url: string | null
          stage: string | null
          status: string | null
          title: string | null
        }
        Relationships: []
      }
      watched_opportunity_list_items: {
        Row: {
          agency: string | null
          agency_id: string | null
          agency_ids: string[] | null
          analysis_id: string | null
          analysis_status: string | null
          bid_id: string | null
          budget_krw: string | null
          budget_krw_value: number | null
          categories: string[] | null
          changed_at: string | null
          company_id: string | null
          company_ids: string[] | null
          deadline_at: string | null
          first_seen_at: string | null
          id: string | null
          is_demo: boolean | null
          it_scope: boolean | null
          latest_decision: string | null
          latest_decision_at: string | null
          latest_run_id: string | null
          latest_run_status: string | null
          notice_id: string | null
          org_id: string | null
          published_at: string | null
          recommend_key: string | null
          recommendation: string | null
          relevance_rank: number | null
          relevance_score: number | null
          relevance_state: string | null
          revision_id: string | null
          sol_score: number | null
          source: string | null
          source_conflict: boolean | null
          source_count: number | null
          source_families: string[] | null
          source_family: string | null
          source_url: string | null
          sources: Json | null
          stage: string | null
          status: string | null
          tags: string[] | null
          title: string | null
        }
        Relationships: []
      }
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
      assert_team_member_placement: {
        Args: { p_department_id: string; p_job_title_id: string; p_org_id: string }
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
      bid_watch_count: {
        Args: { p_bid_id: string }
        Returns: number
      }
      change_bid_project_status: {
        Args: { p_note: string; p_project_id: string; p_to_status: string }
        Returns: undefined
      }
      claim_document_processing: {
        Args: { p_attempt_id: string; p_document_id: string; p_lease_seconds: number }
        Returns: Json
      }
      claim_document_storage: {
        Args: { p: Json }
        Returns: Json
      }
      claim_document_storage_delete: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      claim_kakao_notification: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      claim_kakao_test: {
        Args: { p_outbox_event_id: string }
        Returns: boolean
      }
      claim_own_photo_slot: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      create_personal_org: {
        Args: { owner_id: string }
        Returns: string
      }
      create_team_member: {
        Args: { p_department_id: string; p_email?: string; p_job_title_id: string; p_name: string; p_org_id: string }
        Returns: Json
      }
      decide_join_request: {
        Args: { p_approve: boolean; p_request: string; p_seen_updated_at: string; p_sol_role?: string }
        Returns: string
      }
      delete_my_account: {
        Args: never
        Returns: undefined
      }
      disconnect_kakao_notify: {
        Args: never
        Returns: undefined
      }
      display_name_from_metadata: {
        Args: { meta: Json }
        Returns: string
      }
      document_processing_candidates: {
        Args: { p_after: string; p_is_demo: boolean; p_limit: number; p_max_per_bid: number }
        Returns: { bid_id: string; revision_created_at: string; revision_id: string }[]
      }
      document_storage_candidates: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["document_storage_objects"]["Row"][]
      }
      fail_document_download: {
        Args: { p_attempt_id: string; p_document_id: string; p_error_code: string; p_error_message: string }
        Returns: boolean
      }
      fail_document_parse: {
        Args: { p_attempt_id: string; p_document_id: string; p_error_code: string; p_error_message: string; p_parse_status: string; p_parser_id: string }
        Returns: boolean
      }
      find_unlinked_member: {
        Args: { p_department: string; p_name: string }
        Returns: { id: string; job_title_label: string; name: string; person_code: string }[]
      }
      finish_document_storage: {
        Args: { p: Json }
        Returns: undefined
      }
      finish_document_storage_delete: {
        Args: { p_id: string; p_token: string }
        Returns: undefined
      }
      finish_score_run: {
        Args: { p: Json }
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
      it_scope: {
        Args: { p_bid: Database["public"]["Tables"]["bid_notices"]["Row"] }
        Returns: boolean
      }
      it_scope_ai_title: {
        Args: { p_title: string }
        Returns: boolean
      }
      it_scope_it_class: {
        Args: { p_procurement_class: string }
        Returns: boolean
      }
      it_scope_of: {
        Args: { p_is_demo: boolean; p_procurement_class: string; p_relevance_state: string; p_source: string; p_title: string }
        Returns: boolean
      }
      latest_ingest_run: {
        Args: { p_origin: string }
        Returns: { finished_at: string; started_at: string; status: string; summary: Json }[]
      }
      link_bid_opportunity: {
        Args: { p_bid_id: string; p_evidence: Json; p_opportunity_id: string; p_relation: string }
        Returns: undefined
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
      next_new_hire_person_code: {
        Args: { p_org: string }
        Returns: string
      }
      open_bid_project: {
        Args: { p_review_id: string }
        Returns: { project_id: string; reopened: boolean }[]
      }
      opportunity_priority_tier: {
        Args: { p_categories: string[]; p_title: string }
        Returns: number
      }
      opportunity_recommend_key: {
        Args: { p_deadline_at: string; p_published_at: string; p_recommendation: string; p_score: number }
        Returns: string
      }
      own_photo_deletable: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      patch_bid_project: {
        Args: { p_due_at?: string; p_due_changed?: boolean; p_note?: string; p_owner_changed?: boolean; p_owner_id?: string; p_project_id: string; p_status?: string }
        Returns: undefined
      }
      procurement_dataset_version: {
        Args: { p_org_id: string }
        Returns: string
      }
      procurement_filter_options: {
        Args: { p_origin: string }
        Returns: Json
      }
      procurement_last_scheduled_ingest: {
        Args: { p_origin: string }
        Returns: string
      }
      procurement_live_metrics: {
        Args: { p_agency_limit?: number; p_as_of?: string; p_org_id: string; p_origin: string }
        Returns: Json
      }
      procurement_missing_relevance_revisions: {
        Args: { p_limit?: number }
        Returns: { bid_id: string; normalized: Json; raw_payload: Json; revision_id: string }[]
      }
      procurement_source_health: {
        Args: { p_origin: string }
        Returns: { auth_status: string; completeness: string; error_count: number; fetched_count: number; finished_at: string; last_success_at: string; service_key: string; source: string; started_at: string; status: string; summary: Json }[]
      }
      procurement_summary: {
        Args: { p_as_of?: string; p_org_id: string; p_origin: string }
        Returns: Json
      }
      record_bid_project_result: {
        Args: { p_note: string; p_project_id: string; p_result: string }
        Returns: undefined
      }
      refresh_bid_opportunity: {
        Args: { p_id: string }
        Returns: undefined
      }
      release_document_processing: {
        Args: { p_attempt_id: string; p_document_id: string }
        Returns: boolean
      }
      release_unqueued_score_run: {
        Args: { p_score_run_id: string }
        Returns: boolean
      }
      request_kakao_notify_test: {
        Args: never
        Returns: boolean
      }
      resolve_solideo_employment: {
        Args: { p_department: string; p_job_title: string }
        Returns: { department_code: string; department_id: string; department_name: string; job_title_code: string; job_title_id: string; job_title_label: string }[]
      }
      save_kakao_notify_link: {
        Args: { p_access_expires_at: string; p_access_token_enc: string; p_refresh_expires_at: string; p_refresh_token_enc: string }
        Returns: undefined
      }
      send_deadline_reminders: {
        Args: { p_now: string }
        Returns: number
      }
      set_kakao_notify_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      set_member_photo: {
        Args: { p_member: string; p_path?: string }
        Returns: undefined
      }
      set_my_photo: {
        Args: { p_path?: string }
        Returns: undefined
      }
      submit_join_request: {
        Args: { p_kind: string; p_name?: string; p_team_member?: string }
        Returns: string
      }
      task_dashboard_stats: {
        Args: { as_of?: string; target_org: string }
        Returns: { completed_this_week: number; daily_added: number[]; daily_completed: number[]; daily_dates: string[]; my_open_count: number; open_count: number; overdue_count: number; today: string; week_start: string }[]
      }
      team_member_edit_json: {
        Args: { m: Database["public"]["Tables"]["team_members"]["Row"] }
        Returns: Json
      }
      update_team_member: {
        Args: { p_department_id?: string; p_employment_status?: string; p_job_title_id?: string; p_member_id: string }
        Returns: Json
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
