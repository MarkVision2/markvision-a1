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
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          budget: string
          cabinet_id: string
          created_at: string
          created_by: string | null
          goal: string
          id: string
          lead_form_id: string | null
          pixel_event: string | null
          pixel_id: string | null
          project_id: string | null
          text: string
          whatsapp_id: string | null
        }
        Insert: {
          budget?: string
          cabinet_id: string
          created_at?: string
          created_by?: string | null
          goal?: string
          id?: string
          lead_form_id?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
          text?: string
          whatsapp_id?: string | null
        }
        Update: {
          budget?: string
          cabinet_id?: string
          created_at?: string
          created_by?: string | null
          goal?: string
          id?: string
          lead_form_id?: string | null
          pixel_event?: string | null
          pixel_id?: string | null
          project_id?: string | null
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
          ctr: number
          currency: string
          date: string
          external_id: string
          id: string
          impressions: number
          leads: number
          project_id: string | null
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
          ctr?: number
          currency?: string
          date: string
          external_id: string
          id?: string
          impressions?: number
          leads?: number
          project_id?: string | null
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
          ctr?: number
          currency?: string
          date?: string
          external_id?: string
          id?: string
          impressions?: number
          leads?: number
          project_id?: string | null
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
            referencedRelation: "projects"
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
          to_stage_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id: string
          to_stage_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage_id?: string | null
          id?: string
          lead_id?: string
          to_stage_id?: string
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
          campaign: string | null
          channel: Database["public"]["Enums"]["lead_channel"] | null
          city: string | null
          created_at: string
          created_by: string | null
          email: string | null
          first_response_at: string | null
          first_touch_at: string | null
          id: string
          landing_url: string | null
          last_activity_at: string
          last_contact_at: string | null
          last_inbound_at: string | null
          last_outbound_at: string | null
          name: string
          next_action_at: string | null
          next_visit_at: string | null
          note: string | null
          paid: boolean
          paid_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          phone: string
          pinned: boolean
          pipeline_id: string
          project_id: string | null
          referrer: string | null
          reject_reason: string | null
          rejected_at: string | null
          service: string | null
          source: string
          stage_id: string
          updated_at: string
          utm: Json | null
        }
        Insert: {
          age?: number | null
          ai_score?: number
          amount?: number
          assigned_to?: string | null
          campaign?: string | null
          channel?: Database["public"]["Enums"]["lead_channel"] | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_response_at?: string | null
          first_touch_at?: string | null
          id?: string
          landing_url?: string | null
          last_activity_at?: string
          last_contact_at?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          name: string
          next_action_at?: string | null
          next_visit_at?: string | null
          note?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          phone: string
          pinned?: boolean
          pipeline_id: string
          project_id?: string | null
          referrer?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          service?: string | null
          source?: string
          stage_id: string
          updated_at?: string
          utm?: Json | null
        }
        Update: {
          age?: number | null
          ai_score?: number
          amount?: number
          assigned_to?: string | null
          campaign?: string | null
          channel?: Database["public"]["Enums"]["lead_channel"] | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_response_at?: string | null
          first_touch_at?: string | null
          id?: string
          landing_url?: string | null
          last_activity_at?: string
          last_contact_at?: string | null
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          name?: string
          next_action_at?: string | null
          next_visit_at?: string | null
          note?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          phone?: string
          pinned?: boolean
          pipeline_id?: string
          project_id?: string | null
          referrer?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          service?: string | null
          source?: string
          stage_id?: string
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
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_role: string | null
          id: string
          login: string | null
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
          name?: string
          phone?: string | null
          sip_extension?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          domain: string | null
          id: string
          initials: string
          is_primary: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          initials?: string
          is_primary?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          initials?: string
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
            referencedRelation: "projects"
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
          module_key: string
          user_id: string
        }
        Insert: {
          module_key: string
          user_id: string
        }
        Update: {
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
            referencedRelation: "projects"
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
      whatsapp_config: {
        Row: {
          connected: boolean
          connected_at: string | null
          display_name: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connected?: boolean
          connected_at?: string | null
          display_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connected?: boolean
          connected_at?: string | null
          display_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_phone: { Args: { p: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "manager" | "director" | "marketer" | "viewer"
      communication_channel:
        | "whatsapp"
        | "telegram"
        | "instagram"
        | "phone"
        | "web"
        | "email"
      communication_direction: "in" | "out"
      communication_type: "call" | "message" | "note"
      deal_status: "pending" | "paid" | "cancelled"
      lead_channel: "whatsapp" | "telegram" | "instagram" | "phone" | "web"
      payment_method: "cash" | "card" | "kaspi" | "transfer"
      task_status: "pending" | "done" | "overdue" | "cancelled"
      task_type: "call" | "followup" | "visit" | "other" | "revival"
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
      app_role: ["admin", "manager", "director", "marketer", "viewer"],
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
      deal_status: ["pending", "paid", "cancelled"],
      lead_channel: ["whatsapp", "telegram", "instagram", "phone", "web"],
      payment_method: ["cash", "card", "kaspi", "transfer"],
      task_status: ["pending", "done", "overdue", "cancelled"],
      task_type: ["call", "followup", "visit", "other", "revival"],
    },
  },
} as const
