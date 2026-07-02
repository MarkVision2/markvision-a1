export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_cabinets: {
        Row: {
          access_token: string | null
          ad_account_id: string | null
          app_id: string | null
          auto_launch_enabled: boolean
          brief: string | null
          business_id: string | null
          campaign_objective: string | null
          city: string | null
          created_at: string
          created_by: string | null
          creative_cta: string | null
          creative_description: string | null
          creative_headline: string | null
          creative_media_urls: string[] | null
          creative_primary_text: string | null
          currency: string
          daily_budget: number
          days_of_week: number[]
          end_time: string | null
          external_id: string
          id: string
          instagram_id: string | null
          landing_url: string | null
          launch_hour: number
          lead_cost: number
          lead_form_id: string | null
          leads: number
          name: string
          online: boolean
          optimization_goal: string | null
          page_id: string | null
          page_name: string | null
          pixel_event: string | null
          pixel_id: string | null
          project_id: string | null
          provider: string
          revenue: number
          sales: number
          spend: number
          start_time: string | null
          target_age_max: number | null
          target_age_min: number | null
          target_exclusions: Json
          target_gender: string
          target_geo: string[] | null
          target_interests: Json
          target_languages: string[] | null
          telegram_group_id: string | null
          timezone: string
          type: string
          updated_at: string
          utm_template: string | null
          website_url: string | null
          whatsapp_number: string | null
        }
        Insert: {
          access_token?: string | null
          ad_account_id?: string | null
          app_id?: string | null
          auto_launch_enabled?: boolean
          brief?: string | null
          business_id?: string | null
          campaign_objective?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          creative_cta?: string | null
          creative_description?: string | null
          creative_headline?: string | null
          creative_media_urls?: string[] | null
          creative_primary_text?: string | null
          currency?: string
          daily_budget?: number
          days_of_week?: number[]
          end_time?: string | null
          external_id?: string
          id?: string
          instagram_id?: string | null
          landing_url?: string | null
          launch_hour?: number
          lead_cost?: number
          lead_form_id?: string | null
          leads?: number
          name: string
          online?: boolean
          optimization_goal?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          provider?: string
          revenue?: number
          sales?: number
          spend?: number
          start_time?: string | null
          target_age_max?: number | null
          target_age_min?: number | null
          target_exclusions?: Json
          target_gender?: string
          target_geo?: string[] | null
          target_interests?: Json
          target_languages?: string[] | null
          telegram_group_id?: string | null
          timezone?: string
          type?: string
          updated_at?: string
          utm_template?: string | null
          website_url?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          access_token?: string | null
          ad_account_id?: string | null
          app_id?: string | null
          auto_launch_enabled?: boolean
          brief?: string | null
          business_id?: string | null
          campaign_objective?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          creative_cta?: string | null
          creative_description?: string | null
          creative_headline?: string | null
          creative_media_urls?: string[] | null
          creative_primary_text?: string | null
          currency?: string
          daily_budget?: number
          days_of_week?: number[]
          end_time?: string | null
          external_id?: string
          id?: string
          instagram_id?: string | null
          landing_url?: string | null
          launch_hour?: number
          lead_cost?: number
          lead_form_id?: string | null
          leads?: number
          name?: string
          online?: boolean
          optimization_goal?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          provider?: string
          revenue?: number
          sales?: number
          spend?: number
          start_time?: string | null
          target_age_max?: number | null
          target_age_min?: number | null
          target_exclusions?: Json
          target_gender?: string
          target_geo?: string[] | null
          target_interests?: Json
          target_languages?: string[] | null
          telegram_group_id?: string | null
          timezone?: string
          type?: string
          updated_at?: string
          utm_template?: string | null
          website_url?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_cabinets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ad_cabinets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_cabinets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          budget: string
          cabinet_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          goal: string
          id: string
          last_error: string | null
          launch_id: string | null
          lead_form_id: string | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          pixel_event: string | null
          pixel_id: string | null
          project_id: string | null
          status: string
          status_message: string | null
          status_step: string | null
          status_updated_at: string | null
          text: string
          whatsapp_id: string | null
        }
        Insert: {
          budget?: string
          cabinet_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          goal?: string
          id?: string
          last_error?: string | null
          launch_id?: string | null
          lead_form_id?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          status?: string
          status_message?: string | null
          status_step?: string | null
          status_updated_at?: string | null
          text?: string
          whatsapp_id?: string | null
        }
        Update: {
          budget?: string
          cabinet_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          goal?: string
          id?: string
          last_error?: string | null
          launch_id?: string | null
          lead_form_id?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          status?: string
          status_message?: string | null
          status_step?: string | null
          status_updated_at?: string | null
          text?: string
          whatsapp_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_sync_runs: {
        Row: {
          cabinet_id: string | null
          clicks: number | null
          created_at: string | null
          created_by: string | null
          days: number | null
          error: string | null
          error_code: string | null
          external_id: string | null
          finished_at: string | null
          id: string
          kind: string
          leads: number | null
          ok: boolean | null
          payload: Json
          project_id: string | null
          provider: string | null
          revenue: number | null
          since: string | null
          spend: number | null
          started_at: string
          status: string
          triggered_by: string
          until: string | null
        }
        Insert: {
          cabinet_id?: string | null
          clicks?: number | null
          created_at?: string | null
          created_by?: string | null
          days?: number | null
          error?: string | null
          error_code?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          leads?: number | null
          ok?: boolean | null
          payload?: Json
          project_id?: string | null
          provider?: string | null
          revenue?: number | null
          since?: string | null
          spend?: number | null
          started_at?: string
          status?: string
          triggered_by?: string
          until?: string | null
        }
        Update: {
          cabinet_id?: string | null
          clicks?: number | null
          created_at?: string | null
          created_by?: string | null
          days?: number | null
          error?: string | null
          error_code?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          leads?: number | null
          ok?: boolean | null
          payload?: Json
          project_id?: string | null
          provider?: string | null
          revenue?: number | null
          since?: string | null
          spend?: number | null
          started_at?: string
          status?: string
          triggered_by?: string
          until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_sync_runs_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_sync_runs_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_sync_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ad_sync_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_sync_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_client_services: {
        Row: {
          client_id: string
          cost: number
          created_at: string
          id: string
          name: string
          price: number
        }
        Insert: {
          client_id: string
          cost?: number
          created_at?: string
          id?: string
          name: string
          price?: number
        }
        Update: {
          client_id?: string
          cost?: number
          created_at?: string
          id?: string
          name?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "agency_client_services_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "agency_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_clients: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          pay_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          pay_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          pay_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_rop_call_analyses: {
        Row: {
          ai_model: string | null
          call_at: string
          call_recording_url: string | null
          criteria: Json | null
          duration_sec: number | null
          id: string
          lead_id: string | null
          main_mistake: string | null
          manager_id: string | null
          objections: string[] | null
          overall_score: number | null
          processed_at: string
          project_id: string | null
          recommended_script_id: string | null
          strengths: string[] | null
          topics: string[] | null
          transcript: string | null
          transcript_segments: Json | null
          weaknesses: string[] | null
        }
        Insert: {
          ai_model?: string | null
          call_at: string
          call_recording_url?: string | null
          criteria?: Json | null
          duration_sec?: number | null
          id?: string
          lead_id?: string | null
          main_mistake?: string | null
          manager_id?: string | null
          objections?: string[] | null
          overall_score?: number | null
          processed_at?: string
          project_id?: string | null
          recommended_script_id?: string | null
          strengths?: string[] | null
          topics?: string[] | null
          transcript?: string | null
          transcript_segments?: Json | null
          weaknesses?: string[] | null
        }
        Update: {
          ai_model?: string | null
          call_at?: string
          call_recording_url?: string | null
          criteria?: Json | null
          duration_sec?: number | null
          id?: string
          lead_id?: string | null
          main_mistake?: string | null
          manager_id?: string | null
          objections?: string[] | null
          overall_score?: number | null
          processed_at?: string
          project_id?: string | null
          recommended_script_id?: string | null
          strengths?: string[] | null
          topics?: string[] | null
          transcript?: string | null
          transcript_segments?: Json | null
          weaknesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_call_analyses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_call_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_call_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_call_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_call_analyses_recommended_script_id_fkey"
            columns: ["recommended_script_id"]
            isOneToOne: false
            referencedRelation: "ai_rop_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rop_chat_analyses: {
        Row: {
          ai_model: string | null
          avg_response_min: number | null
          channel: string | null
          criteria: Json | null
          first_response_min: number | null
          flag_ghosted_by_manager: boolean | null
          flag_no_closing: boolean | null
          flag_price_without_qualification: boolean | null
          id: string
          lead_id: string | null
          manager_id: string | null
          message_count: number | null
          objections: string[] | null
          overall_score: number | null
          processed_at: string
          project_id: string | null
          strengths: string[] | null
          topics: string[] | null
          weaknesses: string[] | null
        }
        Insert: {
          ai_model?: string | null
          avg_response_min?: number | null
          channel?: string | null
          criteria?: Json | null
          first_response_min?: number | null
          flag_ghosted_by_manager?: boolean | null
          flag_no_closing?: boolean | null
          flag_price_without_qualification?: boolean | null
          id?: string
          lead_id?: string | null
          manager_id?: string | null
          message_count?: number | null
          objections?: string[] | null
          overall_score?: number | null
          processed_at?: string
          project_id?: string | null
          strengths?: string[] | null
          topics?: string[] | null
          weaknesses?: string[] | null
        }
        Update: {
          ai_model?: string | null
          avg_response_min?: number | null
          channel?: string | null
          criteria?: Json | null
          first_response_min?: number | null
          flag_ghosted_by_manager?: boolean | null
          flag_no_closing?: boolean | null
          flag_price_without_qualification?: boolean | null
          id?: string
          lead_id?: string | null
          manager_id?: string | null
          message_count?: number | null
          objections?: string[] | null
          overall_score?: number | null
          processed_at?: string
          project_id?: string | null
          strengths?: string[] | null
          topics?: string[] | null
          weaknesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_chat_analyses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_chat_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_chat_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_chat_analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rop_content_ideas: {
        Row: {
          audience: string | null
          based_on: string | null
          body: string | null
          created_at: string
          created_by: string | null
          cta: string | null
          format: Database["public"]["Enums"]["content_format"]
          hook: string | null
          id: string
          priority: Database["public"]["Enums"]["content_priority"]
          project_id: string | null
          source_lead_ids: string[] | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string | null
          based_on?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          cta?: string | null
          format: Database["public"]["Enums"]["content_format"]
          hook?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["content_priority"]
          project_id?: string | null
          source_lead_ids?: string[] | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string | null
          based_on?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          cta?: string | null
          format?: Database["public"]["Enums"]["content_format"]
          hook?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["content_priority"]
          project_id?: string | null
          source_lead_ids?: string[] | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_content_ideas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_content_ideas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_content_ideas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rop_manager_scores: {
        Row: {
          ai_recommendations: string[] | null
          ai_report: string | null
          calls_avg_score: number | null
          calls_total: number | null
          chats_avg_score: number | null
          chats_total: number | null
          conversion_score: number | null
          dial_score: number | null
          empathy_score: number | null
          generated_at: string
          id: string
          leads_assigned: number | null
          leads_paid: number | null
          manager_id: string | null
          overall_score: number | null
          period_end: string
          period_start: string
          project_id: string | null
          scripts_score: number | null
          sla_score: number | null
        }
        Insert: {
          ai_recommendations?: string[] | null
          ai_report?: string | null
          calls_avg_score?: number | null
          calls_total?: number | null
          chats_avg_score?: number | null
          chats_total?: number | null
          conversion_score?: number | null
          dial_score?: number | null
          empathy_score?: number | null
          generated_at?: string
          id?: string
          leads_assigned?: number | null
          leads_paid?: number | null
          manager_id?: string | null
          overall_score?: number | null
          period_end: string
          period_start: string
          project_id?: string | null
          scripts_score?: number | null
          sla_score?: number | null
        }
        Update: {
          ai_recommendations?: string[] | null
          ai_report?: string | null
          calls_avg_score?: number | null
          calls_total?: number | null
          chats_avg_score?: number | null
          chats_total?: number | null
          conversion_score?: number | null
          dial_score?: number | null
          empathy_score?: number | null
          generated_at?: string
          id?: string
          leads_assigned?: number | null
          leads_paid?: number | null
          manager_id?: string | null
          overall_score?: number | null
          period_end?: string
          period_start?: string
          project_id?: string | null
          scripts_score?: number | null
          sla_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_manager_scores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_manager_scores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_manager_scores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rop_scripts: {
        Row: {
          body: string
          category: Database["public"]["Enums"]["ai_script_category"]
          created_at: string
          created_by: string | null
          effectiveness: number | null
          id: string
          project_id: string | null
          source: Database["public"]["Enums"]["ai_script_source"]
          tags: string[]
          title: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          body: string
          category: Database["public"]["Enums"]["ai_script_category"]
          created_at?: string
          created_by?: string | null
          effectiveness?: number | null
          id?: string
          project_id?: string | null
          source?: Database["public"]["Enums"]["ai_script_source"]
          tags?: string[]
          title: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          body?: string
          category?: Database["public"]["Enums"]["ai_script_category"]
          created_at?: string
          created_by?: string | null
          effectiveness?: number | null
          id?: string
          project_id?: string | null
          source?: Database["public"]["Enums"]["ai_script_source"]
          tags?: string[]
          title?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rop_settings: {
        Row: {
          auto_flag_sla: boolean
          auto_generate_content: boolean
          auto_score_calls: boolean
          auto_score_chats: boolean
          auto_suggest_scripts: boolean
          created_at: string
          id: string
          kpi_max_reject_pct: number
          kpi_min_conversion_pct: number
          kpi_min_dial_pct: number
          project_id: string | null
          sla_callback_hours: number
          sla_chat_idle_hours: number
          sla_first_response_min: number
          system_prompt: string
          tone: string
          updated_at: string
          user_id: string | null
          watch_list: string[]
        }
        Insert: {
          auto_flag_sla?: boolean
          auto_generate_content?: boolean
          auto_score_calls?: boolean
          auto_score_chats?: boolean
          auto_suggest_scripts?: boolean
          created_at?: string
          id?: string
          kpi_max_reject_pct?: number
          kpi_min_conversion_pct?: number
          kpi_min_dial_pct?: number
          project_id?: string | null
          sla_callback_hours?: number
          sla_chat_idle_hours?: number
          sla_first_response_min?: number
          system_prompt: string
          tone?: string
          updated_at?: string
          user_id?: string | null
          watch_list?: string[]
        }
        Update: {
          auto_flag_sla?: boolean
          auto_generate_content?: boolean
          auto_score_calls?: boolean
          auto_score_chats?: boolean
          auto_suggest_scripts?: boolean
          created_at?: string
          id?: string
          kpi_max_reject_pct?: number
          kpi_min_conversion_pct?: number
          kpi_min_dial_pct?: number
          project_id?: string | null
          sla_callback_hours?: number
          sla_chat_idle_hours?: number
          sla_first_response_min?: number
          system_prompt?: string
          tone?: string
          updated_at?: string
          user_id?: string | null
          watch_list?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rop_trainer_sessions: {
        Row: {
          difficulty: string
          feedback: string | null
          finished_at: string | null
          id: string
          improvements: string[] | null
          messages: Json
          project_id: string | null
          scenario_channel: Database["public"]["Enums"]["trainer_channel"]
          scenario_id: string
          scenario_role: Database["public"]["Enums"]["trainer_role"]
          scenario_title: string
          score: number | null
          started_at: string
          user_id: string | null
          voice_recording_url: string | null
        }
        Insert: {
          difficulty: string
          feedback?: string | null
          finished_at?: string | null
          id?: string
          improvements?: string[] | null
          messages?: Json
          project_id?: string | null
          scenario_channel: Database["public"]["Enums"]["trainer_channel"]
          scenario_id: string
          scenario_role: Database["public"]["Enums"]["trainer_role"]
          scenario_title: string
          score?: number | null
          started_at?: string
          user_id?: string | null
          voice_recording_url?: string | null
        }
        Update: {
          difficulty?: string
          feedback?: string | null
          finished_at?: string | null
          id?: string
          improvements?: string[] | null
          messages?: Json
          project_id?: string | null
          scenario_channel?: Database["public"]["Enums"]["trainer_channel"]
          scenario_id?: string
          scenario_role?: Database["public"]["Enums"]["trainer_role"]
          scenario_title?: string
          score?: number | null
          started_at?: string
          user_id?: string | null
          voice_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_rop_trainer_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ai_rop_trainer_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rop_trainer_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          bucket_at: string
          fired_at: string
          id: string
          lead_id: string
          payload: Json | null
          rule: string
        }
        Insert: {
          bucket_at: string
          fired_at?: string
          id?: string
          lead_id: string
          payload?: Json | null
          rule: string
        }
        Update: {
          bucket_at?: string
          fired_at?: string
          id?: string
          lead_id?: string
          payload?: Json | null
          rule?: string
        }
        Relationships: []
      }
      automation_settings: {
        Row: {
          auto_msg_24h_enabled: boolean
          auto_msg_24h_hours: number
          auto_msg_24h_template_key: string
          cron_secret: string | null
          followup_2h_enabled: boolean
          followup_2h_minutes: number
          id: boolean
          meta_access_token: string | null
          meta_access_token_present: boolean | null
          revival_7d_days: number
          revival_7d_enabled: boolean
          revival_7d_template_key: string
          sipuni_enabled: boolean
          sipuni_operator: string | null
          sipuni_token: string | null
          sipuni_token_present: boolean | null
          sipuni_user: string | null
          telephony_provider: string
          updated_at: string
        }
        Insert: {
          auto_msg_24h_enabled?: boolean
          auto_msg_24h_hours?: number
          auto_msg_24h_template_key?: string
          cron_secret?: string | null
          followup_2h_enabled?: boolean
          followup_2h_minutes?: number
          id?: boolean
          meta_access_token?: string | null
          meta_access_token_present?: boolean | null
          revival_7d_days?: number
          revival_7d_enabled?: boolean
          revival_7d_template_key?: string
          sipuni_enabled?: boolean
          sipuni_operator?: string | null
          sipuni_token?: string | null
          sipuni_token_present?: boolean | null
          sipuni_user?: string | null
          telephony_provider?: string
          updated_at?: string
        }
        Update: {
          auto_msg_24h_enabled?: boolean
          auto_msg_24h_hours?: number
          auto_msg_24h_template_key?: string
          cron_secret?: string | null
          followup_2h_enabled?: boolean
          followup_2h_minutes?: number
          id?: boolean
          meta_access_token?: string | null
          meta_access_token_present?: boolean | null
          revival_7d_days?: number
          revival_7d_enabled?: boolean
          revival_7d_template_key?: string
          sipuni_enabled?: boolean
          sipuni_operator?: string | null
          sipuni_token?: string | null
          sipuni_token_present?: boolean | null
          sipuni_user?: string | null
          telephony_provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      cabinet_daily_insights: {
        Row: {
          cabinet_id: string
          clicks: number
          cpc: number
          cpl: number
          cpm: number
          crm_diagnostic_revenue: number
          crm_diagnostics: number
          crm_revenue: number
          crm_sales: number
          ctr: number
          currency: string
          date: string
          external_id: string
          id: string
          impressions: number
          leads: number
          manual_diagnostic_revenue: number | null
          manual_diagnostics: number | null
          manual_leads: number | null
          manual_revenue: number | null
          manual_sales: number | null
          manual_spend: number | null
          project_id: string | null
          provider: string
          revenue: number
          spend: number
          synced_at: string
        }
        Insert: {
          cabinet_id: string
          clicks?: number
          cpc?: number
          cpl?: number
          cpm?: number
          crm_diagnostic_revenue?: number
          crm_diagnostics?: number
          crm_revenue?: number
          crm_sales?: number
          ctr?: number
          currency?: string
          date: string
          external_id: string
          id?: string
          impressions?: number
          leads?: number
          manual_diagnostic_revenue?: number | null
          manual_diagnostics?: number | null
          manual_leads?: number | null
          manual_revenue?: number | null
          manual_sales?: number | null
          manual_spend?: number | null
          project_id?: string | null
          provider?: string
          revenue?: number
          spend?: number
          synced_at?: string
        }
        Update: {
          cabinet_id?: string
          clicks?: number
          cpc?: number
          cpl?: number
          cpm?: number
          crm_diagnostic_revenue?: number
          crm_diagnostics?: number
          crm_revenue?: number
          crm_sales?: number
          ctr?: number
          currency?: string
          date?: string
          external_id?: string
          id?: string
          impressions?: number
          leads?: number
          manual_diagnostic_revenue?: number | null
          manual_diagnostics?: number | null
          manual_leads?: number | null
          manual_revenue?: number | null
          manual_sales?: number | null
          manual_spend?: number | null
          project_id?: string | null
          provider?: string
          revenue?: number
          spend?: number
          synced_at?: string
        }
        Relationships: []
      }
      communications: {
        Row: {
          channel: Database["public"]["Enums"]["communication_channel"] | null
          content: string | null
          created_at: string
          created_by: string | null
          direction:
            | Database["public"]["Enums"]["communication_direction"]
            | null
          external_id: string | null
          id: string
          is_auto: boolean
          is_draft: boolean
          lead_id: string
          status: string | null
          template_key: string | null
          type: Database["public"]["Enums"]["communication_type"]
        }
        Insert: {
          channel?: Database["public"]["Enums"]["communication_channel"] | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          direction?:
            | Database["public"]["Enums"]["communication_direction"]
            | null
          external_id?: string | null
          id?: string
          is_auto?: boolean
          is_draft?: boolean
          lead_id: string
          status?: string | null
          template_key?: string | null
          type: Database["public"]["Enums"]["communication_type"]
        }
        Update: {
          channel?: Database["public"]["Enums"]["communication_channel"] | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          direction?:
            | Database["public"]["Enums"]["communication_direction"]
            | null
          external_id?: string | null
          id?: string
          is_auto?: boolean
          is_draft?: boolean
          lead_id?: string
          status?: string | null
          template_key?: string | null
          type?: Database["public"]["Enums"]["communication_type"]
        }
        Relationships: [
          {
            foreignKeyName: "communications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          paid_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          service_type: string | null
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          service_type?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          service_type?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string | null
          payload: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id?: string | null
          payload?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_plans: {
        Row: {
          avg_check: number
          cpl: number
          cr_lead_visit: number
          cr_visit_sale: number
          created_by: string | null
          id: string
          leads: number
          month_key: string
          project_id: string | null
          revenue: number
          sales: number
          saved_at: string
          spend: number
          updated_at: string
          visits: number
        }
        Insert: {
          avg_check?: number
          cpl?: number
          cr_lead_visit?: number
          cr_visit_sale?: number
          created_by?: string | null
          id?: string
          leads?: number
          month_key: string
          project_id?: string | null
          revenue?: number
          sales?: number
          saved_at?: string
          spend?: number
          updated_at?: string
          visits?: number
        }
        Update: {
          avg_check?: number
          cpl?: number
          cr_lead_visit?: number
          cr_visit_sale?: number
          created_by?: string | null
          id?: string
          leads?: number
          month_key?: string
          project_id?: string | null
          revenue?: number
          sales?: number
          saved_at?: string
          spend?: number
          updated_at?: string
          visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "finance_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          date: string
          fetched_at: string
          source: string
          usd_kzt: number
        }
        Insert: {
          date: string
          fetched_at?: string
          source?: string
          usd_kzt: number
        }
        Update: {
          date?: string
          fetched_at?: string
          source?: string
          usd_kzt?: number
        }
        Relationships: []
      }
      instagram_account_daily: {
        Row: {
          date: string
          followers: number | null
          id: string
          ig_user_id: string
          impressions: number | null
          new_followers: number | null
          profile_views: number | null
          project_id: string
          reach: number | null
          synced_at: string
          website_clicks: number | null
        }
        Insert: {
          date: string
          followers?: number | null
          id?: string
          ig_user_id: string
          impressions?: number | null
          new_followers?: number | null
          profile_views?: number | null
          project_id: string
          reach?: number | null
          synced_at?: string
          website_clicks?: number | null
        }
        Update: {
          date?: string
          followers?: number | null
          id?: string
          ig_user_id?: string
          impressions?: number | null
          new_followers?: number | null
          profile_views?: number | null
          project_id?: string
          reach?: number | null
          synced_at?: string
          website_clicks?: number | null
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          active: boolean
          created_at: string
          followers_count: number | null
          follows_count: number | null
          id: string
          ig_user_id: string
          last_error: string | null
          last_sync_at: string | null
          media_count: number | null
          name: string | null
          page_access_token: string
          page_id: string
          page_name: string | null
          page_token_present: boolean | null
          profile_picture_url: string | null
          project_id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          followers_count?: number | null
          follows_count?: number | null
          id?: string
          ig_user_id: string
          last_error?: string | null
          last_sync_at?: string | null
          media_count?: number | null
          name?: string | null
          page_access_token: string
          page_id: string
          page_name?: string | null
          page_token_present?: boolean | null
          profile_picture_url?: string | null
          project_id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          followers_count?: number | null
          follows_count?: number | null
          id?: string
          ig_user_id?: string
          last_error?: string | null
          last_sync_at?: string | null
          media_count?: number | null
          name?: string | null
          page_access_token?: string
          page_id?: string
          page_name?: string | null
          page_token_present?: boolean | null
          profile_picture_url?: string | null
          project_id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      instagram_codewords: {
        Row: {
          active: boolean
          caption: string | null
          codeword: string
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          published_at: string | null
          reel_id: string | null
          reel_url: string | null
          target_url: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          caption?: string | null
          codeword: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          published_at?: string | null
          reel_id?: string | null
          reel_url?: string | null
          target_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          caption?: string | null
          codeword?: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          published_at?: string | null
          reel_id?: string | null
          reel_url?: string | null
          target_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_codewords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "instagram_codewords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_codewords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_demographics: {
        Row: {
          dimension: string
          id: string
          ig_user_id: string
          key: string
          project_id: string
          snapshot_at: string
          value: number
        }
        Insert: {
          dimension: string
          id?: string
          ig_user_id: string
          key: string
          project_id: string
          snapshot_at?: string
          value?: number
        }
        Update: {
          dimension?: string
          id?: string
          ig_user_id?: string
          key?: string
          project_id?: string
          snapshot_at?: string
          value?: number
        }
        Relationships: []
      }
      instagram_media: {
        Row: {
          caption: string | null
          comments_count: number | null
          created_at: string
          id: string
          ig_user_id: string
          impressions: number | null
          last_synced_at: string
          like_count: number | null
          media_id: string
          media_product_type: string | null
          media_type: string | null
          media_url: string | null
          permalink: string | null
          plays: number | null
          project_id: string
          reach: number | null
          saved_count: number | null
          shares_count: number | null
          thumbnail_url: string | null
          timestamp: string | null
          total_interactions: number | null
          video_views: number | null
        }
        Insert: {
          caption?: string | null
          comments_count?: number | null
          created_at?: string
          id?: string
          ig_user_id: string
          impressions?: number | null
          last_synced_at?: string
          like_count?: number | null
          media_id: string
          media_product_type?: string | null
          media_type?: string | null
          media_url?: string | null
          permalink?: string | null
          plays?: number | null
          project_id: string
          reach?: number | null
          saved_count?: number | null
          shares_count?: number | null
          thumbnail_url?: string | null
          timestamp?: string | null
          total_interactions?: number | null
          video_views?: number | null
        }
        Update: {
          caption?: string | null
          comments_count?: number | null
          created_at?: string
          id?: string
          ig_user_id?: string
          impressions?: number | null
          last_synced_at?: string
          like_count?: number | null
          media_id?: string
          media_product_type?: string | null
          media_type?: string | null
          media_url?: string | null
          permalink?: string | null
          plays?: number | null
          project_id?: string
          reach?: number | null
          saved_count?: number | null
          shares_count?: number | null
          thumbnail_url?: string | null
          timestamp?: string | null
          total_interactions?: number | null
          video_views?: number | null
        }
        Relationships: []
      }
      instagram_organic_events: {
        Row: {
          codeword: string | null
          codeword_id: string | null
          contact: string | null
          created_at: string
          date: string
          event_type: string
          id: string
          lead_id: string | null
          occurred_at: string
          payload: Json
          project_id: string | null
          reel_id: string | null
          reel_url: string | null
          username: string | null
        }
        Insert: {
          codeword?: string | null
          codeword_id?: string | null
          contact?: string | null
          created_at?: string
          date?: string
          event_type: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          project_id?: string | null
          reel_id?: string | null
          reel_url?: string | null
          username?: string | null
        }
        Update: {
          codeword?: string | null
          codeword_id?: string | null
          contact?: string | null
          created_at?: string
          date?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          occurred_at?: string
          payload?: Json
          project_id?: string | null
          reel_id?: string | null
          reel_url?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_organic_events_codeword_id_fkey"
            columns: ["codeword_id"]
            isOneToOne: false
            referencedRelation: "instagram_codeword_stats"
            referencedColumns: ["codeword_id"]
          },
          {
            foreignKeyName: "instagram_organic_events_codeword_id_fkey"
            columns: ["codeword_id"]
            isOneToOne: false
            referencedRelation: "instagram_codewords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_organic_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_organic_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "instagram_organic_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_organic_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage_id: string | null
          id: string
          lead_id: string
          to_stage_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id: string
          to_stage_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id?: string
          to_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_status_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_status_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_status_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          age: number | null
          ai_score: number
          amount: number
          assigned_to: string | null
          cabinet_id: string | null
          campaign: string | null
          channel: Database["public"]["Enums"]["lead_channel"] | null
          city: string | null
          click_id: string | null
          created_at: string
          created_by: string | null
          diagnostic_amount: number
          email: string | null
          first_response_at: string | null
          first_touch_at: string | null
          id: string
          is_personal: boolean
          landing_url: string | null
          last_activity_at: string
          last_contact_at: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          name: string
          next_action_at: string | null
          next_visit_at: string | null
          note: string | null
          paid: boolean
          paid_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          phone: string
          pinned: boolean
          pipeline_id: string | null
          project_id: string | null
          referrer: string | null
          reject_reason: string | null
          rejected_at: string | null
          service: string | null
          source: string
          stage_id: string | null
          updated_at: string
          utm: Json | null
        }
        Insert: {
          age?: number | null
          ai_score?: number
          amount?: number
          assigned_to?: string | null
          cabinet_id?: string | null
          campaign?: string | null
          channel?: Database["public"]["Enums"]["lead_channel"] | null
          city?: string | null
          click_id?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic_amount?: number
          email?: string | null
          first_response_at?: string | null
          first_touch_at?: string | null
          id?: string
          is_personal?: boolean
          landing_url?: string | null
          last_activity_at?: string
          last_contact_at?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name: string
          next_action_at?: string | null
          next_visit_at?: string | null
          note?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          phone: string
          pinned?: boolean
          pipeline_id?: string | null
          project_id?: string | null
          referrer?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          service?: string | null
          source?: string
          stage_id?: string | null
          updated_at?: string
          utm?: Json | null
        }
        Update: {
          age?: number | null
          ai_score?: number
          amount?: number
          assigned_to?: string | null
          cabinet_id?: string | null
          campaign?: string | null
          channel?: Database["public"]["Enums"]["lead_channel"] | null
          city?: string | null
          click_id?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic_amount?: number
          email?: string | null
          first_response_at?: string | null
          first_touch_at?: string | null
          id?: string
          is_personal?: boolean
          landing_url?: string | null
          last_activity_at?: string
          last_contact_at?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name?: string
          next_action_at?: string | null
          next_visit_at?: string | null
          note?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          phone?: string
          pinned?: boolean
          pipeline_id?: string | null
          project_id?: string | null
          referrer?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          service?: string | null
          source?: string
          stage_id?: string | null
          updated_at?: string
          utm?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          created_at: string
          emoji: string | null
          id: string
          key: string
          label: string
          order_index: number
        }
        Insert: {
          created_at?: string
          emoji?: string | null
          id?: string
          key: string
          label: string
          order_index?: number
        }
        Update: {
          created_at?: string
          emoji?: string | null
          id?: string
          key?: string
          label?: string
          order_index?: number
        }
        Relationships: []
      }
      meta_campaign_daily: {
        Row: {
          cabinet_id: string | null
          campaign_id: string
          clicks: number
          currency: string
          date: string
          id: string
          impressions: number
          leads: number
          messages: number
          project_id: string | null
          purchases: number
          revenue: number
          spend: number
          synced_at: string
        }
        Insert: {
          cabinet_id?: string | null
          campaign_id: string
          clicks?: number
          currency?: string
          date: string
          id?: string
          impressions?: number
          leads?: number
          messages?: number
          project_id?: string | null
          purchases?: number
          revenue?: number
          spend?: number
          synced_at?: string
        }
        Update: {
          cabinet_id?: string | null
          campaign_id?: string
          clicks?: number
          currency?: string
          date?: string
          id?: string
          impressions?: number
          leads?: number
          messages?: number
          project_id?: string | null
          purchases?: number
          revenue?: number
          spend?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaign_daily_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaign_daily_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaign_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_campaign_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaign_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaigns: {
        Row: {
          cabinet_id: string | null
          campaign_id: string
          daily_budget: number | null
          destination_type: string | null
          effective_status: string | null
          id: string
          last_synced_at: string
          lifetime_budget: number | null
          name: string
          objective: string | null
          project_id: string | null
          start_time: string | null
          status: string | null
          stop_time: string | null
        }
        Insert: {
          cabinet_id?: string | null
          campaign_id: string
          daily_budget?: number | null
          destination_type?: string | null
          effective_status?: string | null
          id?: string
          last_synced_at?: string
          lifetime_budget?: number | null
          name: string
          objective?: string | null
          project_id?: string | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
        }
        Update: {
          cabinet_id?: string | null
          campaign_id?: string
          daily_budget?: number | null
          destination_type?: string | null
          effective_status?: string | null
          id?: string
          last_synced_at?: string
          lifetime_budget?: number | null
          name?: string
          objective?: string | null
          project_id?: string | null
          start_time?: string | null
          status?: string | null
          stop_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaigns_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_creative_daily: {
        Row: {
          ad_id: string
          cabinet_id: string | null
          campaign_id: string | null
          clicks: number
          currency: string
          date: string
          id: string
          impressions: number
          leads: number
          messages: number
          project_id: string | null
          purchases: number
          revenue: number
          spend: number
          synced_at: string
        }
        Insert: {
          ad_id: string
          cabinet_id?: string | null
          campaign_id?: string | null
          clicks?: number
          currency?: string
          date: string
          id?: string
          impressions?: number
          leads?: number
          messages?: number
          project_id?: string | null
          purchases?: number
          revenue?: number
          spend?: number
          synced_at?: string
        }
        Update: {
          ad_id?: string
          cabinet_id?: string | null
          campaign_id?: string | null
          clicks?: number
          currency?: string
          date?: string
          id?: string
          impressions?: number
          leads?: number
          messages?: number
          project_id?: string | null
          purchases?: number
          revenue?: number
          spend?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_creative_daily_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creative_daily_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creative_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_creative_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creative_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_creatives: {
        Row: {
          ad_id: string
          adset_id: string | null
          cabinet_id: string | null
          campaign_id: string | null
          creative_type: string
          cta: string | null
          destination_url: string | null
          effective_status: string | null
          headline: string | null
          id: string
          image_url: string | null
          last_synced_at: string
          name: string
          poster_url: string | null
          primary_text: string | null
          project_id: string | null
          status: string | null
          thumbnail_url: string | null
          video_id: string | null
          video_url: string | null
        }
        Insert: {
          ad_id: string
          adset_id?: string | null
          cabinet_id?: string | null
          campaign_id?: string | null
          creative_type?: string
          cta?: string | null
          destination_url?: string | null
          effective_status?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          last_synced_at?: string
          name: string
          poster_url?: string | null
          primary_text?: string | null
          project_id?: string | null
          status?: string | null
          thumbnail_url?: string | null
          video_id?: string | null
          video_url?: string | null
        }
        Update: {
          ad_id?: string
          adset_id?: string | null
          cabinet_id?: string | null
          campaign_id?: string | null
          creative_type?: string
          cta?: string | null
          destination_url?: string | null
          effective_status?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          last_synced_at?: string
          name?: string
          poster_url?: string | null
          primary_text?: string | null
          project_id?: string | null
          status?: string | null
          thumbnail_url?: string | null
          video_id?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_creatives_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creatives_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_tokens: {
        Row: {
          access_token: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string
          last_validated_at: string | null
          last_validation_status: string | null
          project_id: string
          token_last4: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label: string
          last_validated_at?: string | null
          last_validation_status?: string | null
          project_id: string
          token_last4?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          last_validated_at?: string | null
          last_validation_status?: string | null
          project_id?: string
          token_last4?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_tokens_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_tokens_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_tokens_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_finance: {
        Row: {
          created_by: string | null
          id: string
          month_key: string
          project_id: string | null
          revenue: number
          spend: number
          updated_at: string
        }
        Insert: {
          created_by?: string | null
          id?: string
          month_key: string
          project_id?: string | null
          revenue?: number
          spend?: number
          updated_at?: string
        }
        Update: {
          created_by?: string | null
          id?: string
          month_key?: string
          project_id?: string | null
          revenue?: number
          spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_finance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "monthly_finance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_finance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_attribution: {
        Row: {
          cabinet_id: string | null
          captured_at: string
          click_id: string | null
          id: string
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          phone: string
          project_id: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          cabinet_id?: string | null
          captured_at?: string
          click_id?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          phone: string
          project_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          cabinet_id?: string | null
          captured_at?: string
          click_id?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          phone?: string
          project_id?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          is_diagnostic: boolean
          is_terminal: boolean
          key: string
          order_index: number
          pipeline_id: string
          title: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_diagnostic?: boolean
          is_terminal?: boolean
          key: string
          order_index: number
          pipeline_id: string
          title: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_diagnostic?: boolean
          is_terminal?: boolean
          key?: string
          order_index?: number
          pipeline_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "pipelines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_role: string | null
          id: string
          login: string | null
          must_change_password: boolean
          name: string
          phone: string | null
          sip_extension: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_role?: string | null
          id: string
          login?: string | null
          must_change_password?: boolean
          name?: string
          phone?: string | null
          sip_extension?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_role?: string | null
          id?: string
          login?: string | null
          must_change_password?: boolean
          name?: string
          phone?: string | null
          sip_extension?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_briefs: {
        Row: {
          ai_cta: string | null
          ai_headline: string | null
          ai_primary_text: string | null
          ai_variants: Json
          audience: string | null
          brief_md: string | null
          created_at: string
          created_by: string | null
          geo: string | null
          monthly_budget: number | null
          niche: string | null
          product: string | null
          project_id: string
          tone: string | null
          updated_at: string
          usp: string | null
        }
        Insert: {
          ai_cta?: string | null
          ai_headline?: string | null
          ai_primary_text?: string | null
          ai_variants?: Json
          audience?: string | null
          brief_md?: string | null
          created_at?: string
          created_by?: string | null
          geo?: string | null
          monthly_budget?: number | null
          niche?: string | null
          product?: string | null
          project_id: string
          tone?: string | null
          updated_at?: string
          usp?: string | null
        }
        Update: {
          ai_cta?: string | null
          ai_headline?: string | null
          ai_primary_text?: string | null
          ai_variants?: Json
          audience?: string | null
          brief_md?: string | null
          created_at?: string
          created_by?: string | null
          geo?: string | null
          monthly_budget?: number | null
          niche?: string | null
          product?: string | null
          project_id?: string
          tone?: string | null
          updated_at?: string
          usp?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          creative_username: string | null
          domain: string | null
          id: string
          initials: string
          intake_token: string
          is_primary: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          creative_username?: string | null
          domain?: string | null
          id?: string
          initials?: string
          intake_token?: string
          is_primary?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          creative_username?: string | null
          domain?: string | null
          id?: string
          initials?: string
          intake_token?: string
          is_primary?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          created_at: string
          id: string
          position: number
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      report_subscriptions: {
        Row: {
          cabinet_ids: Json
          chat_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          last_sent_at: string | null
          name: string
          period: string
          schedule: string
          send_hour: number
          updated_at: string
        }
        Insert: {
          cabinet_ids?: Json
          chat_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_sent_at?: string | null
          name?: string
          period?: string
          schedule?: string
          send_hour?: number
          updated_at?: string
        }
        Update: {
          cabinet_ids?: Json
          chat_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_sent_at?: string | null
          name?: string
          period?: string
          schedule?: string
          send_hour?: number
          updated_at?: string
        }
        Relationships: []
      }
      revenue_plan: {
        Row: {
          id: string
          month_key: string
          project_id: string | null
          updated_at: string
          value: number
        }
        Insert: {
          id?: string
          month_key: string
          project_id?: string | null
          updated_at?: string
          value?: number
        }
        Update: {
          id?: string
          month_key?: string
          project_id?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_plan_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "revenue_plan_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_plan_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rnp_daily: {
        Row: {
          cash_received: number
          conducted_diagnostics: number
          created_at: string
          date: string
          diag_revenue: number
          id: string
          manual_cash: number | null
          manual_conducted_visits: number | null
          manual_crm_received: number | null
          manual_diagnostic_revenue: number | null
          manual_diagnostics: number | null
          manual_diagnostics_paid: number | null
          manual_leads: number | null
          manual_planned_visits: number | null
          manual_qualified: number | null
          manual_sales: number | null
          manual_sales_revenue: number | null
          manual_spend: number | null
          planned_diagnostics: number
          prepayments_count: number
          prepayments_sum: number
          project_id: string | null
          updated_at: string
        }
        Insert: {
          cash_received?: number
          conducted_diagnostics?: number
          created_at?: string
          date: string
          diag_revenue?: number
          id?: string
          manual_cash?: number | null
          manual_conducted_visits?: number | null
          manual_crm_received?: number | null
          manual_diagnostic_revenue?: number | null
          manual_diagnostics?: number | null
          manual_diagnostics_paid?: number | null
          manual_leads?: number | null
          manual_planned_visits?: number | null
          manual_qualified?: number | null
          manual_sales?: number | null
          manual_sales_revenue?: number | null
          manual_spend?: number | null
          planned_diagnostics?: number
          prepayments_count?: number
          prepayments_sum?: number
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          cash_received?: number
          conducted_diagnostics?: number
          created_at?: string
          date?: string
          diag_revenue?: number
          id?: string
          manual_cash?: number | null
          manual_conducted_visits?: number | null
          manual_crm_received?: number | null
          manual_diagnostic_revenue?: number | null
          manual_diagnostics?: number | null
          manual_diagnostics_paid?: number | null
          manual_leads?: number | null
          manual_planned_visits?: number | null
          manual_qualified?: number | null
          manual_sales?: number | null
          manual_sales_revenue?: number | null
          manual_spend?: number | null
          planned_diagnostics?: number
          prepayments_count?: number
          prepayments_sum?: number
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rnp_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "rnp_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rnp_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sipuni_cdr_log: {
        Row: {
          created_at: string
          duration_sec: number | null
          error_text: string | null
          id: string
          lead_id_resolved: string | null
          phone_normalized: string | null
          processing_status: string
          raw_payload: Json | null
          recording_url: string | null
          started_at: string | null
        }
        Insert: {
          created_at?: string
          duration_sec?: number | null
          error_text?: string | null
          id?: string
          lead_id_resolved?: string | null
          phone_normalized?: string | null
          processing_status: string
          raw_payload?: Json | null
          recording_url?: string | null
          started_at?: string | null
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          error_text?: string | null
          id?: string
          lead_id_resolved?: string | null
          phone_normalized?: string | null
          processing_status?: string
          raw_payload?: Json | null
          recording_url?: string | null
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sipuni_cdr_log_lead_id_resolved_fkey"
            columns: ["lead_id_resolved"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          done_at: string | null
          due_at: string
          id: string
          lead_id: string
          source: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at: string
          id?: string
          lead_id: string
          source?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at?: string
          id?: string
          lead_id?: string
          source?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      team_member_modules: {
        Row: {
          access_level: string
          module_key: string
          user_id: string
        }
        Insert: {
          access_level?: string
          module_key: string
          user_id: string
        }
        Update: {
          access_level?: string
          module_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_active_project: {
        Row: {
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_project_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "user_active_project_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_active_project_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_clicks: {
        Row: {
          click_id: string
          created_at: string
          ctwa_clid: string | null
          fbclid: string | null
          landing_url: string | null
          matched: boolean
          matched_at: string | null
          matched_phone: string | null
          project_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          click_id: string
          created_at?: string
          ctwa_clid?: string | null
          fbclid?: string | null
          landing_url?: string | null
          matched?: boolean
          matched_at?: string | null
          matched_phone?: string | null
          project_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          click_id?: string
          created_at?: string
          ctwa_clid?: string | null
          fbclid?: string | null
          landing_url?: string | null
          matched?: boolean
          matched_at?: string | null
          matched_phone?: string | null
          project_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      whatsapp_config: {
        Row: {
          ads_only: boolean
          api_token: string | null
          api_token_present: boolean | null
          api_url: string | null
          bot_webhook_url: string | null
          connected: boolean
          connected_at: string | null
          display_name: string | null
          id: string
          id_instance: string | null
          phone: string | null
          project_id: string | null
          updated_at: string
          user_id: string
          webhook_token: string | null
          webhook_token_present: boolean | null
          webhook_url: string | null
        }
        Insert: {
          ads_only?: boolean
          api_token?: string | null
          api_token_present?: boolean | null
          api_url?: string | null
          bot_webhook_url?: string | null
          connected?: boolean
          connected_at?: string | null
          display_name?: string | null
          id?: string
          id_instance?: string | null
          phone?: string | null
          project_id?: string | null
          updated_at?: string
          user_id: string
          webhook_token?: string | null
          webhook_token_present?: boolean | null
          webhook_url?: string | null
        }
        Update: {
          ads_only?: boolean
          api_token?: string | null
          api_token_present?: boolean | null
          api_url?: string | null
          bot_webhook_url?: string | null
          connected?: boolean
          connected_at?: string | null
          display_name?: string | null
          id?: string
          id_instance?: string | null
          phone?: string | null
          project_id?: string | null
          updated_at?: string
          user_id?: string
          webhook_token?: string | null
          webhook_token_present?: boolean | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "whatsapp_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ad_cabinets_safe: {
        Row: {
          ad_account_id: string | null
          auto_launch_enabled: boolean | null
          brief: string | null
          campaign_objective: string | null
          city: string | null
          created_at: string | null
          created_by: string | null
          creative_cta: string | null
          creative_description: string | null
          creative_headline: string | null
          creative_media_urls: string[] | null
          creative_primary_text: string | null
          currency: string | null
          daily_budget: number | null
          days_of_week: number[] | null
          end_time: string | null
          external_id: string | null
          id: string | null
          instagram_id: string | null
          landing_url: string | null
          launch_hour: number | null
          lead_cost: number | null
          lead_form_id: string | null
          leads: number | null
          name: string | null
          online: boolean | null
          optimization_goal: string | null
          page_id: string | null
          page_name: string | null
          pixel_event: string | null
          pixel_id: string | null
          project_id: string | null
          provider: string | null
          revenue: number | null
          sales: number | null
          spend: number | null
          start_time: string | null
          target_age_max: number | null
          target_age_min: number | null
          target_exclusions: Json | null
          target_gender: string | null
          target_geo: string[] | null
          target_interests: Json | null
          target_languages: string[] | null
          telegram_group_id: string | null
          timezone: string | null
          type: string | null
          updated_at: string | null
          utm_template: string | null
          website_url: string | null
          whatsapp_number: string | null
        }
        Insert: {
          ad_account_id?: string | null
          auto_launch_enabled?: boolean | null
          brief?: string | null
          campaign_objective?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          creative_cta?: string | null
          creative_description?: string | null
          creative_headline?: string | null
          creative_media_urls?: string[] | null
          creative_primary_text?: string | null
          currency?: string | null
          daily_budget?: number | null
          days_of_week?: number[] | null
          end_time?: string | null
          external_id?: string | null
          id?: string | null
          instagram_id?: string | null
          landing_url?: string | null
          launch_hour?: number | null
          lead_cost?: number | null
          lead_form_id?: string | null
          leads?: number | null
          name?: string | null
          online?: boolean | null
          optimization_goal?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          provider?: string | null
          revenue?: number | null
          sales?: number | null
          spend?: number | null
          start_time?: string | null
          target_age_max?: number | null
          target_age_min?: number | null
          target_exclusions?: Json | null
          target_gender?: string | null
          target_geo?: string[] | null
          target_interests?: Json | null
          target_languages?: string[] | null
          telegram_group_id?: string | null
          timezone?: string | null
          type?: string | null
          updated_at?: string | null
          utm_template?: string | null
          website_url?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          ad_account_id?: string | null
          auto_launch_enabled?: boolean | null
          brief?: string | null
          campaign_objective?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          creative_cta?: string | null
          creative_description?: string | null
          creative_headline?: string | null
          creative_media_urls?: string[] | null
          creative_primary_text?: string | null
          currency?: string | null
          daily_budget?: number | null
          days_of_week?: number[] | null
          end_time?: string | null
          external_id?: string | null
          id?: string | null
          instagram_id?: string | null
          landing_url?: string | null
          launch_hour?: number | null
          lead_cost?: number | null
          lead_form_id?: string | null
          leads?: number | null
          name?: string | null
          online?: boolean | null
          optimization_goal?: string | null
          page_id?: string | null
          page_name?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          provider?: string | null
          revenue?: number | null
          sales?: number | null
          spend?: number | null
          start_time?: string | null
          target_age_max?: number | null
          target_age_min?: number | null
          target_exclusions?: Json | null
          target_gender?: string | null
          target_geo?: string[] | null
          target_interests?: Json | null
          target_languages?: string[] | null
          telegram_group_id?: string | null
          timezone?: string | null
          type?: string | null
          updated_at?: string | null
          utm_template?: string | null
          website_url?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_cabinets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "ad_cabinets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_cabinets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stats_health: {
        Row: {
          cabinet_id: string | null
          cdi_crm_revenue: number | null
          cdi_crm_sales: number | null
          cdi_manual_revenue: number | null
          cdi_manual_sales: number | null
          crm_paid_amount: number | null
          crm_paid_leads: number | null
          date: string | null
          has_manual_override: boolean | null
          is_orphan: boolean | null
          project_id: string | null
          revenue_delta: number | null
          sales_delta: number | null
        }
        Relationships: []
      }
      inbound_tokens: {
        Row: {
          client_id: string | null
          is_active: boolean | null
          project_id: string | null
          token: string | null
        }
        Insert: {
          client_id?: never
          is_active?: never
          project_id?: string | null
          token?: string | null
        }
        Update: {
          client_id?: never
          is_active?: never
          project_id?: string | null
          token?: string | null
        }
        Relationships: []
      }
      instagram_accounts_safe: {
        Row: {
          active: boolean | null
          created_at: string | null
          followers_count: number | null
          follows_count: number | null
          id: string | null
          ig_user_id: string | null
          last_error: string | null
          last_sync_at: string | null
          media_count: number | null
          name: string | null
          page_id: string | null
          page_name: string | null
          page_token_present: boolean | null
          profile_picture_url: string | null
          project_id: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          followers_count?: number | null
          follows_count?: number | null
          id?: string | null
          ig_user_id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          media_count?: number | null
          name?: string | null
          page_id?: string | null
          page_name?: string | null
          page_token_present?: boolean | null
          profile_picture_url?: string | null
          project_id?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          followers_count?: number | null
          follows_count?: number | null
          id?: string | null
          ig_user_id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          media_count?: number | null
          name?: string | null
          page_id?: string | null
          page_name?: string | null
          page_token_present?: boolean | null
          profile_picture_url?: string | null
          project_id?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
      instagram_codeword_stats: {
        Row: {
          active: boolean | null
          codeword: string | null
          codeword_dms: number | null
          codeword_id: string | null
          last_event_at: string | null
          leads: number | null
          link_clicks: number | null
          project_id: string | null
          reel_url: string | null
          thumbnail_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_codewords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "instagram_codewords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_codewords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_organic_daily: {
        Row: {
          codeword_dms: number | null
          date: string | null
          leads: number | null
          link_clicks: number | null
          project_id: string | null
          unique_codeword_users: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_organic_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "instagram_organic_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_organic_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaign_overview: {
        Row: {
          cabinet_id: string | null
          campaign_id: string | null
          clicks_all: number | null
          daily_budget: number | null
          destination_type: string | null
          effective_status: string | null
          id: string | null
          impressions_all: number | null
          last_synced_at: string | null
          leads_all: number | null
          messages_all: number | null
          name: string | null
          objective: string | null
          project_id: string | null
          purchases_all: number | null
          revenue_all: number | null
          spend_all: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaigns_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_creative_crm_daily: {
        Row: {
          ad_id: string | null
          cabinet_id: string | null
          crm_diagnostic_revenue: number | null
          crm_diagnostics: number | null
          crm_leads: number | null
          crm_qualified: number | null
          crm_revenue: number | null
          crm_sales: number | null
          date: string | null
          project_id: string | null
        }
        Relationships: []
      }
      meta_creative_overview: {
        Row: {
          ad_id: string | null
          cabinet_id: string | null
          campaign_id: string | null
          clicks_all: number | null
          creative_type: string | null
          cta: string | null
          destination_url: string | null
          effective_status: string | null
          headline: string | null
          id: string | null
          image_url: string | null
          impressions_all: number | null
          last_active_date: string | null
          last_synced_at: string | null
          leads_all: number | null
          messages_all: number | null
          name: string | null
          primary_text: string | null
          project_id: string | null
          purchases_all: number | null
          revenue_all: number | null
          spend_all: number | null
          thumbnail_url: string | null
          video_id: string | null
          video_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_creatives_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creatives_cabinet_id_fkey"
            columns: ["cabinet_id"]
            isOneToOne: false
            referencedRelation: "ad_cabinets_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "meta_creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_creatives_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
      projects_public: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      team_members_view: {
        Row: {
          created_at: string | null
          display_role: string | null
          email: string | null
          id: string | null
          login: string | null
          modules: Json | null
          must_change_password: boolean | null
          name: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: []
      }
      whatsapp_config_safe: {
        Row: {
          ads_only: boolean | null
          api_token_present: boolean | null
          api_url: string | null
          connected: boolean | null
          connected_at: string | null
          display_name: string | null
          id: string | null
          id_instance: string | null
          phone: string | null
          project_id: string | null
          updated_at: string | null
          user_id: string | null
          webhook_token_present: boolean | null
          webhook_url: string | null
        }
        Insert: {
          ads_only?: boolean | null
          api_token_present?: boolean | null
          api_url?: string | null
          connected?: boolean | null
          connected_at?: string | null
          display_name?: string | null
          id?: string | null
          id_instance?: string | null
          phone?: string | null
          project_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          webhook_token_present?: boolean | null
          webhook_url?: string | null
        }
        Update: {
          ads_only?: boolean | null
          api_token_present?: boolean | null
          api_url?: string | null
          connected?: boolean | null
          connected_at?: string | null
          display_name?: string | null
          id?: string | null
          id_instance?: string | null
          phone?: string | null
          project_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          webhook_token_present?: boolean | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "inbound_tokens"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "whatsapp_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _get_usd_kzt_rate: { Args: { p_date: string }; Returns: number }
      _meta_get: { Args: { p_url: string }; Returns: Json }
      _normalize_act_id: { Args: { p_id: string }; Returns: string }
      backfill_lead_attribution: {
        Args: { p_project_id: string; p_since?: string }
        Returns: Json
      }
      bind_whatsapp_to_project: {
        Args: {
          p_api_token?: string
          p_api_url?: string
          p_id_instance: string
          p_project_id: string
        }
        Returns: string
      }
      cabinet_health_check: { Args: { p_cabinet_id: string }; Returns: Json }
      can_write_module: {
        Args: { _module_key: string; _user_id: string }
        Returns: boolean
      }
      ensure_cdi_row: {
        Args: { _cabinet_id: string; _date: string }
        Returns: undefined
      }
      ensure_project_pipeline: {
        Args: { p_project_id: string }
        Returns: string
      }
      gen_intake_token: { Args: never; Returns: string }
      get_creative_funnel: {
        Args: { p_ad_id: string; p_since?: string; p_until?: string }
        Returns: Json
      }
      has_module_access: {
        Args: { _module_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_viewer: { Args: { _user_id: string }; Returns: boolean }
      meta_structure_sync: {
        Args: { p_cabinet_id?: string; p_since?: string; p_until?: string }
        Returns: Json
      }
      normalize_green_api_url: { Args: { p_url: string }; Returns: string }
      normalize_phone: { Args: { p: string }; Returns: string }
      reconcile_cdi_for_project: {
        Args: { p_project_id: string; p_since?: string }
        Returns: Json
      }
      resolve_intake_project: { Args: { p_token: string }; Returns: string }
      rotate_project_intake_token: {
        Args: { p_project_id: string }
        Returns: string
      }
      save_whatsapp_bot_webhook: {
        Args: { p_bot_webhook_url: string; p_project_id: string }
        Returns: undefined
      }
      seed_demo_project_ask_med: {
        Args: {
          p_month_end?: string
          p_month_start?: string
          p_source_project_name?: string
        }
        Returns: Json
      }
      set_project_creative_username: {
        Args: { p_project_id: string; p_username: string }
        Returns: string
      }
      user_can_access_project: {
        Args: { _project_id: string }
        Returns: boolean
      }
    }
    Enums: {
      ai_script_category:
        | "greeting"
        | "objection_price"
        | "objection_no_time"
        | "objection_thinking"
        | "closing"
        | "follow_up"
        | "missed_call"
        | "custom"
      ai_script_source: "manual" | "ai"
      app_role:
        | "admin"
        | "manager"
        | "director"
        | "marketer"
        | "viewer"
        | "staff"
      communication_channel:
        | "whatsapp"
        | "telegram"
        | "instagram"
        | "phone"
        | "web"
        | "email"
      communication_direction: "in" | "out"
      communication_type: "call" | "message" | "note"
      content_format: "reels" | "post" | "story" | "article" | "video"
      content_priority: "high" | "mid" | "low"
      content_status: "idea" | "in_progress" | "published" | "rejected"
      deal_status: "pending" | "paid" | "cancelled"
      lead_channel: "whatsapp" | "telegram" | "instagram" | "phone" | "web"
      payment_method: "cash" | "card" | "kaspi" | "transfer"
      task_status: "pending" | "done" | "overdue" | "cancelled"
      task_type: "call" | "followup" | "visit" | "other" | "revival"
      trainer_channel: "phone" | "whatsapp" | "instagram"
      trainer_role: "patient" | "lead"
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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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

export const Constants = {
  public: {
    Enums: {
      ai_script_category: [
        "greeting",
        "objection_price",
        "objection_no_time",
        "objection_thinking",
        "closing",
        "follow_up",
        "missed_call",
        "custom",
      ],
      ai_script_source: ["manual", "ai"],
      app_role: ["admin", "manager", "director", "marketer", "viewer", "staff"],
      communication_channel: [
        "whatsapp",
        "telegram",
        "instagram",
        "phone",
        "web",
        "email",
      ],
      communication_direction: ["in", "out"],
      communication_type: ["call", "message", "note"],
      content_format: ["reels", "post", "story", "article", "video"],
      content_priority: ["high", "mid", "low"],
      content_status: ["idea", "in_progress", "published", "rejected"],
      deal_status: ["pending", "paid", "cancelled"],
      lead_channel: ["whatsapp", "telegram", "instagram", "phone", "web"],
      payment_method: ["cash", "card", "kaspi", "transfer"],
      task_status: ["pending", "done", "overdue", "cancelled"],
      task_type: ["call", "followup", "visit", "other", "revival"],
      trainer_channel: ["phone", "whatsapp", "instagram"],
      trainer_role: ["patient", "lead"],
    },
  },
} as const
