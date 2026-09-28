// Generated from the migrated schema. Regenerate with `pnpm db:types` (Supabase CLI).
// Do not edit by hand.

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
      agent_audit_log: {
        Row: {
          id: number
          org_id: string
          actor: string
          actor_type: string
          api_key_id: string | null
          action: string
          target: string | null
          payload: Json
          result: string
          created_at: string
        }
        Insert: {
          id?: never
          org_id: string
          actor: string
          actor_type: string
          api_key_id?: string | null
          action: string
          target?: string | null
          payload?: Json
          result?: string
          created_at?: string
        }
        Update: {
          id?: never
          org_id?: string
          actor?: string
          actor_type?: string
          api_key_id?: string | null
          action?: string
          target?: string | null
          payload?: Json
          result?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_audit_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          id: string
          org_id: string
          name: string
          prefix: string
          key_hash: string
          scopes: string[]
          created_by: string | null
          last_used_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          prefix: string
          key_hash: string
          scopes?: string[]
          created_by?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          prefix?: string
          key_hash?: string
          scopes?: string[]
          created_by?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          id: string
          org_id: string
          campaign_id: string
          lead_id: string
          status: string
          current_step_order: number
          next_send_at: string | null
          sending_account_id: string | null
          stopped_reason: string | null
          last_sent_at: string | null
          enrolled_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          campaign_id: string
          lead_id: string
          status?: string
          current_step_order?: number
          next_send_at?: string | null
          sending_account_id?: string | null
          stopped_reason?: string | null
          last_sent_at?: string | null
          enrolled_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          campaign_id?: string
          lead_id?: string
          status?: string
          current_step_order?: number
          next_send_at?: string | null
          sending_account_id?: string | null
          stopped_reason?: string | null
          last_sent_at?: string | null
          enrolled_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_org_id_campaign_id_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "campaign_leads_org_id_lead_id_fkey"
            columns: ["org_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "campaign_leads_org_id_sending_account_id_fkey"
            columns: ["org_id", "sending_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      campaign_sending_accounts: {
        Row: {
          org_id: string
          campaign_id: string
          sending_account_id: string
          created_at: string
        }
        Insert: {
          org_id: string
          campaign_id: string
          sending_account_id: string
          created_at?: string
        }
        Update: {
          org_id?: string
          campaign_id?: string
          sending_account_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sending_accounts_org_id_campaign_id_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "campaign_sending_accounts_org_id_sending_account_id_fkey"
            columns: ["org_id", "sending_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      campaigns: {
        Row: {
          id: string
          org_id: string
          name: string
          status: string
          timezone: string
          send_window_start: string
          send_window_end: string
          send_days: number[]
          daily_limit: number
          daily_limit_per_inbox: number
          approval_mode: string
          track_opens: boolean
          track_clicks: boolean
          auto_promote_winner: boolean
          created_by: string | null
          started_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          status?: string
          timezone?: string
          send_window_start?: string
          send_window_end?: string
          send_days?: number[]
          daily_limit?: number
          daily_limit_per_inbox?: number
          approval_mode?: string
          track_opens?: boolean
          track_clicks?: boolean
          auto_promote_winner?: boolean
          created_by?: string | null
          started_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          status?: string
          timezone?: string
          send_window_start?: string
          send_window_end?: string
          send_days?: number[]
          daily_limit?: number
          daily_limit_per_inbox?: number
          approval_mode?: string
          track_opens?: boolean
          track_clicks?: boolean
          auto_promote_winner?: boolean
          created_by?: string | null
          started_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          id: string
          org_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_variants: {
        Row: {
          id: string
          org_id: string
          step_id: string
          ab_group: string
          subject: string
          body: string
          weight: number
          is_active: boolean
          is_winner: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          step_id: string
          ab_group?: string
          subject?: string
          body?: string
          weight?: number
          is_active?: boolean
          is_winner?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          step_id?: string
          ab_group?: string
          subject?: string
          body?: string
          weight?: number
          is_active?: boolean
          is_winner?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_variants_org_id_step_id_fkey"
            columns: ["org_id", "step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      events: {
        Row: {
          id: number
          org_id: string
          send_id: string
          type: string
          meta: Json
          created_at: string
        }
        Insert: {
          id?: never
          org_id: string
          send_id: string
          type: string
          meta?: Json
          created_at?: string
        }
        Update: {
          id?: never
          org_id?: string
          send_id?: string
          type?: string
          meta?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_send_id_fkey"
            columns: ["org_id", "send_id"]
            isOneToOne: false
            referencedRelation: "sends"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      imports: {
        Row: {
          id: string
          org_id: string
          list_id: string | null
          filename: string
          storage_path: string | null
          status: string
          column_mapping: Json
          total_rows: number
          imported_count: number
          duplicate_count: number
          suppressed_count: number
          invalid_count: number
          error_report_path: string | null
          error: string | null
          created_by: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          list_id?: string | null
          filename: string
          storage_path?: string | null
          status?: string
          column_mapping?: Json
          total_rows?: number
          imported_count?: number
          duplicate_count?: number
          suppressed_count?: number
          invalid_count?: number
          error_report_path?: string | null
          error?: string | null
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          list_id?: string | null
          filename?: string
          storage_path?: string | null
          status?: string
          column_mapping?: Json
          total_rows?: number
          imported_count?: number
          duplicate_count?: number
          suppressed_count?: number
          invalid_count?: number
          error_report_path?: string | null
          error?: string | null
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_org_id_list_id_fkey"
            columns: ["org_id", "list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      lead_list_members: {
        Row: {
          org_id: string
          list_id: string
          lead_id: string
          added_at: string
        }
        Insert: {
          org_id: string
          list_id: string
          lead_id: string
          added_at?: string
        }
        Update: {
          org_id?: string
          list_id?: string
          lead_id?: string
          added_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_members_org_id_lead_id_fkey"
            columns: ["org_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "lead_list_members_org_id_list_id_fkey"
            columns: ["org_id", "list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      lead_lists: {
        Row: {
          id: string
          org_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_lists_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          id: string
          org_id: string
          email: string
          first_name: string | null
          last_name: string | null
          company: string | null
          title: string | null
          custom_json: Json
          status: string
          verification_status: string
          verification_detail: Json | null
          verified_at: string | null
          import_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          first_name?: string | null
          last_name?: string | null
          company?: string | null
          title?: string | null
          custom_json?: Json
          status?: string
          verification_status?: string
          verification_detail?: Json | null
          verified_at?: string | null
          import_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          email?: string
          first_name?: string | null
          last_name?: string | null
          company?: string | null
          title?: string | null
          custom_json?: Json
          status?: string
          verification_status?: string
          verification_detail?: Json | null
          verified_at?: string | null
          import_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_import_id_fkey"
            columns: ["org_id", "import_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      memberships: {
        Row: {
          id: string
          org_id: string
          user_id: string
          role: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          role: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          role?: string
          created_at?: string
          updated_at?: string
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
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          id: string
          org_id: string
          lead_id: string
          stage_id: string
          campaign_id: string | null
          source: string
          booking_link: string | null
          notes: string | null
          moved_at: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          lead_id: string
          stage_id: string
          campaign_id?: string | null
          source: string
          booking_link?: string | null
          notes?: string | null
          moved_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          lead_id?: string
          stage_id?: string
          campaign_id?: string | null
          source?: string
          booking_link?: string | null
          notes?: string | null
          moved_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_org_id_campaign_id_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "opportunities_org_id_lead_id_fkey"
            columns: ["org_id", "lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "opportunities_org_id_stage_id_fkey"
            columns: ["org_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      organizations: {
        Row: {
          id: string
          name: string
          approval_mode: string
          sending_paused: boolean
          sending_paused_at: string | null
          sending_paused_by: string | null
          sending_paused_reason: string | null
          physical_address: string | null
          default_timezone: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          approval_mode?: string
          sending_paused?: boolean
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_paused_reason?: string | null
          physical_address?: string | null
          default_timezone?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          approval_mode?: string
          sending_paused?: boolean
          sending_paused_at?: string | null
          sending_paused_by?: string | null
          sending_paused_reason?: string | null
          physical_address?: string | null
          default_timezone?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          id: string
          org_id: string
          name: string
          position: number
          kind: string
          is_entry: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          position: number
          kind?: string
          is_entry?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          position?: number
          kind?: string
          is_entry?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      replies: {
        Row: {
          id: string
          org_id: string
          sending_account_id: string | null
          send_id: string | null
          lead_id: string | null
          message_id: string
          in_reply_to: string | null
          references: string[]
          from_email: string
          subject: string | null
          body_text: string | null
          body_html: string | null
          classification: string | null
          classification_source: string | null
          match_method: string | null
          received_at: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          sending_account_id?: string | null
          send_id?: string | null
          lead_id?: string | null
          message_id: string
          in_reply_to?: string | null
          references?: string[]
          from_email: string
          subject?: string | null
          body_text?: string | null
          body_html?: string | null
          classification?: string | null
          classification_source?: string | null
          match_method?: string | null
          received_at: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          sending_account_id?: string | null
          send_id?: string | null
          lead_id?: string | null
          message_id?: string
          in_reply_to?: string | null
          references?: string[]
          from_email?: string
          subject?: string | null
          body_text?: string | null
          body_html?: string | null
          classification?: string | null
          classification_source?: string | null
          match_method?: string | null
          received_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "replies_org_id_lead_id_fkey"
            columns: ["org_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "replies_org_id_send_id_fkey"
            columns: ["org_id", "send_id"]
            isOneToOne: false
            referencedRelation: "sends"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "replies_org_id_sending_account_id_fkey"
            columns: ["org_id", "sending_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sending_account_credentials: {
        Row: {
          account_id: string
          org_id: string
          ciphertext: string
          key_version: number
          updated_at: string
        }
        Insert: {
          account_id: string
          org_id: string
          ciphertext: string
          key_version?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          org_id?: string
          ciphertext?: string
          key_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sending_account_credentials_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sending_accounts: {
        Row: {
          id: string
          org_id: string
          domain_id: string | null
          email: string
          display_name: string | null
          provider: string
          smtp_host: string
          smtp_port: number
          smtp_secure: boolean
          imap_host: string
          imap_port: number
          imap_secure: boolean
          username: string
          timezone: string | null
          daily_cap: number
          sent_today: number
          sent_today_date: string | null
          warmup_enabled: boolean
          warmup_stage: number
          warmup_daily_target: number
          status: string
          health: string
          health_score: number | null
          health_detail: string | null
          last_checked_at: string | null
          imap_uidvalidity: number | null
          imap_last_uid: number | null
          imap_last_synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          domain_id?: string | null
          email: string
          display_name?: string | null
          provider: string
          smtp_host: string
          smtp_port: number
          smtp_secure?: boolean
          imap_host: string
          imap_port: number
          imap_secure?: boolean
          username: string
          timezone?: string | null
          daily_cap?: number
          sent_today?: number
          sent_today_date?: string | null
          warmup_enabled?: boolean
          warmup_stage?: number
          warmup_daily_target?: number
          status?: string
          health?: string
          health_score?: number | null
          health_detail?: string | null
          last_checked_at?: string | null
          imap_uidvalidity?: number | null
          imap_last_uid?: number | null
          imap_last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          domain_id?: string | null
          email?: string
          display_name?: string | null
          provider?: string
          smtp_host?: string
          smtp_port?: number
          smtp_secure?: boolean
          imap_host?: string
          imap_port?: number
          imap_secure?: boolean
          username?: string
          timezone?: string | null
          daily_cap?: number
          sent_today?: number
          sent_today_date?: string | null
          warmup_enabled?: boolean
          warmup_stage?: number
          warmup_daily_target?: number
          status?: string
          health?: string
          health_score?: number | null
          health_detail?: string | null
          last_checked_at?: string | null
          imap_uidvalidity?: number | null
          imap_last_uid?: number | null
          imap_last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sending_accounts_org_id_domain_id_fkey"
            columns: ["org_id", "domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sending_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sends: {
        Row: {
          id: string
          org_id: string
          campaign_id: string
          campaign_lead_id: string
          lead_id: string
          step_id: string | null
          variant_id: string | null
          sending_account_id: string | null
          status: string
          message_id: string | null
          in_reply_to: string | null
          subject: string | null
          body_html: string | null
          body_text: string | null
          scheduled_at: string | null
          sent_at: string | null
          error: string | null
          attempt_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          campaign_id: string
          campaign_lead_id: string
          lead_id: string
          step_id?: string | null
          variant_id?: string | null
          sending_account_id?: string | null
          status?: string
          message_id?: string | null
          in_reply_to?: string | null
          subject?: string | null
          body_html?: string | null
          body_text?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          error?: string | null
          attempt_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          campaign_id?: string
          campaign_lead_id?: string
          lead_id?: string
          step_id?: string | null
          variant_id?: string | null
          sending_account_id?: string | null
          status?: string
          message_id?: string | null
          in_reply_to?: string | null
          subject?: string | null
          body_html?: string | null
          body_text?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          error?: string | null
          attempt_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sends_org_id_campaign_id_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sends_org_id_campaign_lead_id_fkey"
            columns: ["org_id", "campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sends_org_id_lead_id_fkey"
            columns: ["org_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sends_org_id_sending_account_id_fkey"
            columns: ["org_id", "sending_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sends_org_id_step_id_fkey"
            columns: ["org_id", "step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sends_org_id_variant_id_fkey"
            columns: ["org_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "email_variants"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          id: string
          org_id: string
          sequence_id: string
          step_order: number
          delay_days: number
          delay_hours: number
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          sequence_id: string
          step_order: number
          delay_days?: number
          delay_hours?: number
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          sequence_id?: string
          step_order?: number
          delay_days?: number
          delay_hours?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_org_id_sequence_id_fkey"
            columns: ["org_id", "sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sequences: {
        Row: {
          id: string
          org_id: string
          campaign_id: string
          stop_on_reply: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          campaign_id: string
          stop_on_reply?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          campaign_id?: string
          stop_on_reply?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequences_org_id_campaign_id_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      suppression_list: {
        Row: {
          id: string
          org_id: string
          email: string
          reason: string
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          reason: string
          source?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          email?: string
          reason?: string
          source?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppression_list_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      warmup_events: {
        Row: {
          id: number
          org_id: string
          account_id: string
          peer_account_id: string | null
          type: string
          message_id: string | null
          created_at: string
        }
        Insert: {
          id?: never
          org_id: string
          account_id: string
          peer_account_id?: string | null
          type: string
          message_id?: string | null
          created_at?: string
        }
        Update: {
          id?: never
          org_id?: string
          account_id?: string
          peer_account_id?: string | null
          type?: string
          message_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warmup_events_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "warmup_events_peer_account_id_fkey"
            columns: ["peer_account_id"]
            isOneToOne: false
            referencedRelation: "sending_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: {
        Args: {
          p_name: string
        }
        Returns: string
      }
      set_sending_paused: {
        Args: {
          p_org_id: string
          p_paused: boolean
          p_reason?: string
          p_actor?: string
        }
        Returns: undefined
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

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
