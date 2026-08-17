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
      batch_scans: {
        Row: {
          created_at: string
          id: string
          status: string
          total_photos: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          total_photos?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          total_photos?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_connections: {
        Row: {
          access_token: string
          account_email: string | null
          calendar_id: string
          connected_at: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          provider: string
          refresh_token: string | null
          token_expires_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          account_email?: string | null
          calendar_id?: string
          connected_at?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          provider: string
          refresh_token?: string | null
          token_expires_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          account_email?: string | null
          calendar_id?: string
          connected_at?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          provider?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      calendar_events_cache: {
        Row: {
          all_day: boolean
          connection_id: string
          description: string | null
          end_time: string | null
          external_event_id: string
          id: string
          imported_at: string
          location: string | null
          raw: Json | null
          start_time: string
          title: string | null
          user_id: string
        }
        Insert: {
          all_day?: boolean
          connection_id: string
          description?: string | null
          end_time?: string | null
          external_event_id: string
          id?: string
          imported_at?: string
          location?: string | null
          raw?: Json | null
          start_time: string
          title?: string | null
          user_id: string
        }
        Update: {
          all_day?: boolean
          connection_id?: string
          description?: string | null
          end_time?: string | null
          external_event_id?: string
          id?: string
          imported_at?: string
          location?: string | null
          raw?: Json | null
          start_time?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_cache_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          left_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          canonical_key: string | null
          created_at: string
          created_by: string
          id: string
          status: string
        }
        Insert: {
          canonical_key?: string | null
          created_at?: string
          created_by: string
          id?: string
          status?: string
        }
        Update: {
          canonical_key?: string | null
          created_at?: string
          created_by?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      essential_preset_items: {
        Row: {
          always_include: boolean
          category: string | null
          id: string
          name: string
          position: number
          preset_id: string
          quantity: number
        }
        Insert: {
          always_include?: boolean
          category?: string | null
          id?: string
          name: string
          position?: number
          preset_id: string
          quantity?: number
        }
        Update: {
          always_include?: boolean
          category?: string | null
          id?: string
          name?: string
          position?: number
          preset_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "essential_preset_items_preset_id_fkey"
            columns: ["preset_id"]
            isOneToOne: false
            referencedRelation: "essential_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      essential_presets: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      feedback_weights: {
        Row: {
          created_at: string
          feedback_type: string
          notes: string | null
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          feedback_type: string
          notes?: string | null
          updated_at?: string
          weight: number
        }
        Update: {
          created_at?: string
          feedback_type?: string
          notes?: string | null
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      friends: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          status?: string
        }
        Relationships: []
      }
      home_suggestions: {
        Row: {
          curated: Json | null
          date: string
          generated_at: string
          today_explanation: string | null
          today_item_ids: string[]
          today_occasion: string | null
          user_id: string
          wardrobe_fingerprint: string
        }
        Insert: {
          curated?: Json | null
          date: string
          generated_at?: string
          today_explanation?: string | null
          today_item_ids?: string[]
          today_occasion?: string | null
          user_id: string
          wardrobe_fingerprint: string
        }
        Update: {
          curated?: Json | null
          date?: string
          generated_at?: string
          today_explanation?: string | null
          today_item_ids?: string[]
          today_occasion?: string | null
          user_id?: string
          wardrobe_fingerprint?: string
        }
        Relationships: []
      }
      message_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_comments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_references"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          message_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "message_references"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_references: {
        Row: {
          event_snapshot: Json | null
          message_id: string
          outfit_id: string | null
          ref_type: string
          snapshot_image_url: string | null
        }
        Insert: {
          event_snapshot?: Json | null
          message_id: string
          outfit_id?: string | null
          ref_type: string
          snapshot_image_url?: string | null
        }
        Update: {
          event_snapshot?: Json | null
          message_id?: string
          outfit_id?: string | null
          ref_type?: string
          snapshot_image_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_references_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_references_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          content_type: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          metadata: Json | null
          sender_id: string
        }
        Insert: {
          body?: string | null
          content_type: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          sender_id: string
        }
        Update: {
          body?: string | null
          content_type?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      oauth_pending_connections: {
        Row: {
          created_at: string
          provider: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          provider: string
          state?: string
          user_id: string
        }
        Update: {
          created_at?: string
          provider?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      outfit_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          share_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          share_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          share_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outfit_comments_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "outfit_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      outfit_feedback: {
        Row: {
          aggregation_version: number
          context: Json | null
          created_at: string
          feedback_reason: string | null
          feedback_type: string
          id: string
          item_ids: string[]
          outfit_id: string | null
          processed_at: string | null
          rating: number | null
          session_id: string | null
          user_id: string
        }
        Insert: {
          aggregation_version?: number
          context?: Json | null
          created_at?: string
          feedback_reason?: string | null
          feedback_type: string
          id?: string
          item_ids?: string[]
          outfit_id?: string | null
          processed_at?: string | null
          rating?: number | null
          session_id?: string | null
          user_id: string
        }
        Update: {
          aggregation_version?: number
          context?: Json | null
          created_at?: string
          feedback_reason?: string | null
          feedback_type?: string
          id?: string
          item_ids?: string[]
          outfit_id?: string | null
          processed_at?: string | null
          rating?: number | null
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outfit_feedback_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfit_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "outfit_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      outfit_likes: {
        Row: {
          created_at: string
          id: string
          share_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          share_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          share_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outfit_likes_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "outfit_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      outfit_plans: {
        Row: {
          calendar_event_id: string | null
          created_at: string
          date: string
          day_segment: string | null
          general_date: string | null
          id: string
          item_ids: string[]
          notes: string | null
          occasion: string | null
          status: string
          trip_activity_id: string | null
          trip_id: string | null
          user_id: string
          weather_condition: string | null
          weather_estimated: boolean | null
          weather_temp: number | null
        }
        Insert: {
          calendar_event_id?: string | null
          created_at?: string
          date: string
          day_segment?: string | null
          general_date?: string | null
          id?: string
          item_ids?: string[]
          notes?: string | null
          occasion?: string | null
          status?: string
          trip_activity_id?: string | null
          trip_id?: string | null
          user_id?: string
          weather_condition?: string | null
          weather_estimated?: boolean | null
          weather_temp?: number | null
        }
        Update: {
          calendar_event_id?: string | null
          created_at?: string
          date?: string
          day_segment?: string | null
          general_date?: string | null
          id?: string
          item_ids?: string[]
          notes?: string | null
          occasion?: string | null
          status?: string
          trip_activity_id?: string | null
          trip_id?: string | null
          user_id?: string
          weather_condition?: string | null
          weather_estimated?: boolean | null
          weather_temp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outfit_plans_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: true
            referencedRelation: "calendar_events_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfit_plans_trip_activity_id_fkey"
            columns: ["trip_activity_id"]
            isOneToOne: false
            referencedRelation: "trip_day_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outfit_plans_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      outfit_sessions: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          occasion: string | null
          shown_item_ids: string[] | null
          shown_outfit_ids: string[] | null
          user_id: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          occasion?: string | null
          shown_item_ids?: string[] | null
          shown_outfit_ids?: string[] | null
          user_id: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          occasion?: string | null
          shown_item_ids?: string[] | null
          shown_outfit_ids?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      outfit_shares: {
        Row: {
          created_at: string
          id: string
          outfit_id: string
          shared_by: string
          shared_with: string
        }
        Insert: {
          created_at?: string
          id?: string
          outfit_id: string
          shared_by: string
          shared_with: string
        }
        Update: {
          created_at?: string
          id?: string
          outfit_id?: string
          shared_by?: string
          shared_with?: string
        }
        Relationships: [
          {
            foreignKeyName: "outfit_shares_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
        ]
      }
      outfits: {
        Row: {
          archived: boolean
          canvas_image_url: string | null
          cover_url: string | null
          created_at: string
          id: string
          item_ids: string[]
          name: string
          notes: string | null
          occasion: string[]
          season: string[]
          user_id: string
        }
        Insert: {
          archived?: boolean
          canvas_image_url?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          item_ids?: string[]
          name?: string
          notes?: string | null
          occasion?: string[]
          season?: string[]
          user_id?: string
        }
        Update: {
          archived?: boolean
          canvas_image_url?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          item_ids?: string[]
          name?: string
          notes?: string | null
          occasion?: string[]
          season?: string[]
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand: string | null
          canonical_image_url: string | null
          category: string | null
          color: string | null
          color_family: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          material: string | null
          provider_metadata: Json | null
          season: string | null
          source: string
          source_url: string | null
          subcategory: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          canonical_image_url?: string | null
          category?: string | null
          color?: string | null
          color_family?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          material?: string | null
          provider_metadata?: Json | null
          season?: string | null
          source: string
          source_url?: string | null
          subcategory?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          canonical_image_url?: string | null
          category?: string | null
          color?: string | null
          color_family?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          material?: string | null
          provider_metadata?: Json | null
          season?: string | null
          source?: string
          source_url?: string | null
          subcategory?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_location_id: string | null
          avatar_url: string | null
          bio: string | null
          birth_date: string | null
          city: string | null
          clarity: string | null
          created_at: string
          dress_preferences: Json
          favorite_brands: string[] | null
          full_name: string | null
          gender: string | null
          id: string
          industry: string | null
          latitude: number | null
          longitude: number | null
          owned_brands: string[]
          personal_formality: string | null
          profession: string | null
          profile_image: string | null
          season: string | null
          setup_complete: boolean
          share_wardrobe_to_library: boolean
          sizes: Json | null
          style_boldness: string | null
          style_preferences: string[] | null
          undertone: string | null
          updated_at: string
          username: string | null
          value: string | null
          work_days: string[]
          work_dress_code: string | null
          work_end_time: string
          work_start_time: string
        }
        Insert: {
          active_location_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          city?: string | null
          clarity?: string | null
          created_at?: string
          dress_preferences?: Json
          favorite_brands?: string[] | null
          full_name?: string | null
          gender?: string | null
          id?: string
          industry?: string | null
          latitude?: number | null
          longitude?: number | null
          owned_brands?: string[]
          personal_formality?: string | null
          profession?: string | null
          profile_image?: string | null
          season?: string | null
          setup_complete?: boolean
          share_wardrobe_to_library?: boolean
          sizes?: Json | null
          style_boldness?: string | null
          style_preferences?: string[] | null
          undertone?: string | null
          updated_at?: string
          username?: string | null
          value?: string | null
          work_days?: string[]
          work_dress_code?: string | null
          work_end_time?: string
          work_start_time?: string
        }
        Update: {
          active_location_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          city?: string | null
          clarity?: string | null
          created_at?: string
          dress_preferences?: Json
          favorite_brands?: string[] | null
          full_name?: string | null
          gender?: string | null
          id?: string
          industry?: string | null
          latitude?: number | null
          longitude?: number | null
          owned_brands?: string[]
          personal_formality?: string | null
          profession?: string | null
          profile_image?: string | null
          season?: string | null
          setup_complete?: boolean
          share_wardrobe_to_library?: boolean
          sizes?: Json | null
          style_boldness?: string | null
          style_preferences?: string[] | null
          undertone?: string | null
          updated_at?: string
          username?: string | null
          value?: string | null
          work_days?: string[]
          work_dress_code?: string | null
          work_end_time?: string
          work_start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_location_id_fkey"
            columns: ["active_location_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_detected_items: {
        Row: {
          bbox: Json | null
          brand: string | null
          category: string | null
          closure: string | null
          colors: string[]
          confidence: number | null
          created_at: string
          currency: string | null
          description: string | null
          fit: string | null
          gender: string | null
          heel_height: string | null
          id: string
          job_id: string
          length: string | null
          material: string[]
          occasion: string | null
          price: number | null
          scan_id: string
          season: string | null
          sleeve_length: string | null
          status: string
          style: string | null
          style_tags: string[]
          subcategory: string | null
          toe_shape: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bbox?: Json | null
          brand?: string | null
          category?: string | null
          closure?: string | null
          colors?: string[]
          confidence?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          fit?: string | null
          gender?: string | null
          heel_height?: string | null
          id?: string
          job_id: string
          length?: string | null
          material?: string[]
          occasion?: string | null
          price?: number | null
          scan_id: string
          season?: string | null
          sleeve_length?: string | null
          status?: string
          style?: string | null
          style_tags?: string[]
          subcategory?: string | null
          toe_shape?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          bbox?: Json | null
          brand?: string | null
          category?: string | null
          closure?: string | null
          colors?: string[]
          confidence?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          fit?: string | null
          gender?: string | null
          heel_height?: string | null
          id?: string
          job_id?: string
          length?: string | null
          material?: string[]
          occasion?: string | null
          price?: number | null
          scan_id?: string
          season?: string | null
          sleeve_length?: string | null
          status?: string
          style?: string | null
          style_tags?: string[]
          subcategory?: string | null
          toe_shape?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_detected_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "scan_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_detected_items_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "batch_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          image_path: string
          prefill: Json | null
          scan_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          image_path: string
          prefill?: Json | null
          scan_id: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          image_path?: string
          prefill?: Json | null
          scan_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_jobs_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "batch_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_domain_hints: {
        Row: {
          detected_signal: string | null
          domain: string
          first_detected_at: string
          hit_count: number
          last_seen_at: string
          needs_fallback: boolean
        }
        Insert: {
          detected_signal?: string | null
          domain: string
          first_detected_at?: string
          hit_count?: number
          last_seen_at?: string
          needs_fallback?: boolean
        }
        Update: {
          detected_signal?: string | null
          domain?: string
          first_detected_at?: string
          hit_count?: number
          last_seen_at?: string
          needs_fallback?: boolean
        }
        Relationships: []
      }
      shared_library_items: {
        Row: {
          brand: string | null
          category: string | null
          closure: string | null
          color: string | null
          colors: string[]
          created_at: string
          currency: string | null
          day_evening: string | null
          fit: string | null
          formality: number | null
          gender: string | null
          heel_height: string | null
          id: string
          image_url: string
          length: string | null
          material: string[]
          occasion: string | null
          owner_hash: string
          price: number | null
          product_id: string | null
          season: string | null
          size: string | null
          sleeve_length: string | null
          source_image_path: string | null
          source_item_id: string
          style: string | null
          style_tags: string[]
          subcategory: string | null
          thumbnail_path: string | null
          toe_shape: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          closure?: string | null
          color?: string | null
          colors?: string[]
          created_at?: string
          currency?: string | null
          day_evening?: string | null
          fit?: string | null
          formality?: number | null
          gender?: string | null
          heel_height?: string | null
          id?: string
          image_url: string
          length?: string | null
          material?: string[]
          occasion?: string | null
          owner_hash: string
          price?: number | null
          product_id?: string | null
          season?: string | null
          size?: string | null
          sleeve_length?: string | null
          source_image_path?: string | null
          source_item_id: string
          style?: string | null
          style_tags?: string[]
          subcategory?: string | null
          thumbnail_path?: string | null
          toe_shape?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          closure?: string | null
          color?: string | null
          colors?: string[]
          created_at?: string
          currency?: string | null
          day_evening?: string | null
          fit?: string | null
          formality?: number | null
          gender?: string | null
          heel_height?: string | null
          id?: string
          image_url?: string
          length?: string | null
          material?: string[]
          occasion?: string | null
          owner_hash?: string
          price?: number | null
          product_id?: string | null
          season?: string | null
          size?: string | null
          sleeve_length?: string | null
          source_image_path?: string | null
          source_item_id?: string
          style?: string | null
          style_tags?: string[]
          subcategory?: string | null
          thumbnail_path?: string | null
          toe_shape?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_library_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_day_activities: {
        Row: {
          activity_date: string
          activity_type: string
          created_at: string
          day_segment: string | null
          destination_id: string | null
          dress_code: string | null
          id: string
          notes: string | null
          trip_id: string
        }
        Insert: {
          activity_date: string
          activity_type: string
          created_at?: string
          day_segment?: string | null
          destination_id?: string | null
          dress_code?: string | null
          id?: string
          notes?: string | null
          trip_id: string
        }
        Update: {
          activity_date?: string
          activity_type?: string
          created_at?: string
          day_segment?: string | null
          destination_id?: string | null
          dress_code?: string | null
          id?: string
          notes?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_day_activities_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "trip_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_day_activities_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_destinations: {
        Row: {
          destination_name: string
          end_date: string
          id: string
          latitude: number | null
          longitude: number | null
          position: number
          start_date: string
          trip_id: string
        }
        Insert: {
          destination_name: string
          end_date: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          position: number
          start_date: string
          trip_id: string
        }
        Update: {
          destination_name?: string
          end_date?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          position?: number
          start_date?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_destinations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_essentials: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          quantity: number
          status: string
          trip_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          quantity?: number
          status?: string
          trip_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          quantity?: number
          status?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_essentials_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_packing_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          quantity: number
          source_location_id: string | null
          status: string
          trip_id: string
          wardrobe_item_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          quantity?: number
          source_location_id?: string | null
          status?: string
          trip_id: string
          wardrobe_item_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          quantity?: number
          source_location_id?: string | null
          status?: string
          trip_id?: string
          wardrobe_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_packing_items_source_location_id_fkey"
            columns: ["source_location_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_packing_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_packing_items_wardrobe_item_id_fkey"
            columns: ["wardrobe_item_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_items"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_source_locations: {
        Row: {
          id: string
          location_id: string
          trip_id: string
        }
        Insert: {
          id?: string
          location_id: string
          trip_id: string
        }
        Update: {
          id?: string
          location_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_source_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_source_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          id: string
          laundry_available: boolean
          name: string | null
          status: string
          trip_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          laundry_available?: boolean
          name?: string | null
          status?: string
          trip_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          laundry_available?: boolean
          name?: string | null
          status?: string
          trip_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_style_memory: {
        Row: {
          confidence_score: number
          context_axis: string | null
          context_evidence_count: number
          context_strength: number | null
          context_value: string | null
          created_at: string
          evidence_count: number
          id: string
          last_seen: string
          memory_type: string
          source: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          confidence_score?: number
          context_axis?: string | null
          context_evidence_count?: number
          context_strength?: number | null
          context_value?: string | null
          created_at?: string
          evidence_count?: number
          id?: string
          last_seen?: string
          memory_type: string
          source?: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          confidence_score?: number
          context_axis?: string | null
          context_evidence_count?: number
          context_strength?: number | null
          context_value?: string | null
          created_at?: string
          evidence_count?: number
          id?: string
          last_seen?: string
          memory_type?: string
          source?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      wardrobe_event_items: {
        Row: {
          event_id: string
          item_id: string
        }
        Insert: {
          event_id: string
          item_id: string
        }
        Update: {
          event_id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wardrobe_event_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wardrobe_event_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_items"
            referencedColumns: ["id"]
          },
        ]
      }
      wardrobe_events: {
        Row: {
          confidence: string | null
          created_at: string
          event_date: string
          event_type: string
          id: string
          imported_calendar_event_id: string | null
          is_repeat: boolean
          location: Json | null
          mood: string | null
          notes: string | null
          occasion: string | null
          outfit_id: string | null
          outfit_plan_id: string | null
          repeated_from_event_id: string | null
          temperature: number | null
          user_id: string
          weather_snapshot: Json | null
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          event_date: string
          event_type: string
          id?: string
          imported_calendar_event_id?: string | null
          is_repeat?: boolean
          location?: Json | null
          mood?: string | null
          notes?: string | null
          occasion?: string | null
          outfit_id?: string | null
          outfit_plan_id?: string | null
          repeated_from_event_id?: string | null
          temperature?: number | null
          user_id: string
          weather_snapshot?: Json | null
        }
        Update: {
          confidence?: string | null
          created_at?: string
          event_date?: string
          event_type?: string
          id?: string
          imported_calendar_event_id?: string | null
          is_repeat?: boolean
          location?: Json | null
          mood?: string | null
          notes?: string | null
          occasion?: string | null
          outfit_id?: string | null
          outfit_plan_id?: string | null
          repeated_from_event_id?: string | null
          temperature?: number | null
          user_id?: string
          weather_snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "wardrobe_events_outfit_id_fkey"
            columns: ["outfit_id"]
            isOneToOne: false
            referencedRelation: "outfits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wardrobe_events_outfit_plan_id_fkey"
            columns: ["outfit_plan_id"]
            isOneToOne: false
            referencedRelation: "outfit_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wardrobe_events_repeated_from_event_id_fkey"
            columns: ["repeated_from_event_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_events"
            referencedColumns: ["id"]
          },
        ]
      }
      wardrobe_items: {
        Row: {
          archived: boolean
          attrs_backfilled_at: string | null
          brand: string | null
          category: string | null
          closure: string | null
          color: string | null
          colors: string[]
          created_at: string
          currency: string | null
          day_evening: string | null
          fit: string | null
          formality: number | null
          gender: string | null
          heel_height: string | null
          id: string
          image_url: string
          last_worn: string | null
          length: string | null
          location_id: string | null
          material: string[]
          occasion: string | null
          price: number | null
          product_id: string | null
          purchase_date: string | null
          season: string | null
          size: string | null
          sleeve_length: string | null
          source: string | null
          style: string | null
          style_tags: string[]
          subcategory: string | null
          thumbnail_path: string | null
          toe_shape: string | null
          user_edited_fields: string[]
          user_id: string
          worn_count: number
        }
        Insert: {
          archived?: boolean
          attrs_backfilled_at?: string | null
          brand?: string | null
          category?: string | null
          closure?: string | null
          color?: string | null
          colors?: string[]
          created_at?: string
          currency?: string | null
          day_evening?: string | null
          fit?: string | null
          formality?: number | null
          gender?: string | null
          heel_height?: string | null
          id?: string
          image_url: string
          last_worn?: string | null
          length?: string | null
          location_id?: string | null
          material?: string[]
          occasion?: string | null
          price?: number | null
          product_id?: string | null
          purchase_date?: string | null
          season?: string | null
          size?: string | null
          sleeve_length?: string | null
          source?: string | null
          style?: string | null
          style_tags?: string[]
          subcategory?: string | null
          thumbnail_path?: string | null
          toe_shape?: string | null
          user_edited_fields?: string[]
          user_id?: string
          worn_count?: number
        }
        Update: {
          archived?: boolean
          attrs_backfilled_at?: string | null
          brand?: string | null
          category?: string | null
          closure?: string | null
          color?: string | null
          colors?: string[]
          created_at?: string
          currency?: string | null
          day_evening?: string | null
          fit?: string | null
          formality?: number | null
          gender?: string | null
          heel_height?: string | null
          id?: string
          image_url?: string
          last_worn?: string | null
          length?: string | null
          location_id?: string | null
          material?: string[]
          occasion?: string | null
          price?: number | null
          product_id?: string | null
          purchase_date?: string | null
          season?: string | null
          size?: string | null
          sleeve_length?: string | null
          source?: string | null
          style?: string | null
          style_tags?: string[]
          subcategory?: string | null
          thumbnail_path?: string | null
          toe_shape?: string | null
          user_edited_fields?: string[]
          user_id?: string
          worn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "wardrobe_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "wardrobe_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wardrobe_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      wardrobe_locations: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          is_primary: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_primary?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      user_style_memory_active: {
        Row: {
          confidence_score: number | null
          context_axis: string | null
          context_evidence_count: number | null
          context_strength: number | null
          context_value: string | null
          created_at: string | null
          effective_confidence: number | null
          effective_context_strength: number | null
          evidence_count: number | null
          id: string | null
          last_seen: string | null
          memory_type: string | null
          source: string | null
          user_id: string | null
          value: string | null
        }
        Insert: {
          confidence_score?: number | null
          context_axis?: string | null
          context_evidence_count?: number | null
          context_strength?: number | null
          context_value?: string | null
          created_at?: string | null
          effective_confidence?: never
          effective_context_strength?: never
          evidence_count?: number | null
          id?: string | null
          last_seen?: string | null
          memory_type?: string | null
          source?: string | null
          user_id?: string | null
          value?: string | null
        }
        Update: {
          confidence_score?: number | null
          context_axis?: string | null
          context_evidence_count?: number | null
          context_strength?: number | null
          context_value?: string | null
          created_at?: string | null
          effective_confidence?: never
          effective_context_strength?: never
          evidence_count?: number | null
          id?: string | null
          last_seen?: string | null
          memory_type?: string | null
          source?: string | null
          user_id?: string | null
          value?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      active_participant_count: {
        Args: { _conversation_id: string }
        Returns: number
      }
      add_group_participant: {
        Args: { _conversation_id: string; _new_member: string }
        Returns: undefined
      }
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      can_access_share: { Args: { _share_id: string }; Returns: boolean }
      can_read_shared_canvas: {
        Args: { _object_name: string }
        Returns: boolean
      }
      can_send_message: { Args: { _conversation_id: string }; Returns: boolean }
      claim_pending_feedback: {
        Args: { _limit?: number }
        Returns: {
          aggregation_version: number
          context: Json | null
          created_at: string
          feedback_reason: string | null
          feedback_type: string
          id: string
          item_ids: string[]
          outfit_id: string | null
          processed_at: string | null
          rating: number | null
          session_id: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "outfit_feedback"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_scan_jobs: {
        Args: { _limit: number }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          image_path: string
          prefill: Json | null
          scan_id: string
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "scan_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_group_conversation: {
        Args: { _members: string[] }
        Returns: string
      }
      drain_scan_jobs_if_needed: { Args: never; Returns: undefined }
      effective_style_confidence: {
        Args: { _confidence: number; _last_seen: string }
        Returns: number
      }
      get_conversation_messages: {
        Args: { _conversation_id: string; _limit?: number }
        Returns: {
          body: string
          comment_count: number
          content_type: string
          created_at: string
          deleted_at: string
          dislike_count: number
          event_snapshot: Json
          id: string
          like_count: number
          metadata: Json
          my_reaction: string
          outfit_id: string
          ref_type: string
          sender_id: string
          sender_profile_image: string
          sender_username: string
          snapshot_image_url: string
        }[]
      }
      get_conversation_participants: {
        Args: { _conversation_id: string }
        Returns: {
          joined_at: string
          left_at: string
          profile_image: string
          role: string
          user_id: string
          username: string
        }[]
      }
      get_message_thread_comments: {
        Args: { _message_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          profile_image: string
          user_id: string
          username: string
        }[]
      }
      get_or_create_direct_conversation: {
        Args: { _other: string }
        Returns: string
      }
      get_share_comments: {
        Args: { _share_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          profile_image: string
          user_id: string
          username: string
        }[]
      }
      get_shared_feed: {
        Args: never
        Returns: {
          canvas_image_url: string
          comment_count: number
          created_at: string
          direction: string
          like_count: number
          liked_by_me: boolean
          other_profile_image: string
          other_username: string
          outfit_id: string
          outfit_name: string
          share_id: string
          shared_by: string
          shared_with: string
        }[]
      }
      is_blocked: { Args: { _a: string; _b: string }; Returns: boolean }
      is_participant: { Args: { _conversation_id: string }; Returns: boolean }
      leave_group_conversation: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      list_conversations: {
        Args: never
        Returns: {
          can_send: boolean
          conversation_id: string
          created_at: string
          is_group: boolean
          last_message_at: string
          last_message_body: string
          last_message_type: string
          member_count: number
          my_role: string
          other_id: string
          other_profile_image: string
          status: string
          title: string
          unread_count: number
        }[]
      }
      list_friendships: {
        Args: never
        Returns: {
          created_at: string
          direction: string
          friendship_id: string
          other_id: string
          profile_image: string
          status: string
          username: string
        }[]
      }
      mark_conversation_read: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      profile_by_username: {
        Args: { _username: string }
        Returns: {
          id: string
          profile_image: string
          relation: string
          username: string
        }[]
      }
      promote_to_admin: {
        Args: { _conversation_id: string; _target: string }
        Returns: undefined
      }
      record_scrape_domain_hint: {
        Args: { p_domain: string; p_signal: string }
        Returns: undefined
      }
      remove_group_participant: {
        Args: { _conversation_id: string; _target: string }
        Returns: undefined
      }
      search_profiles: {
        Args: { _q: string }
        Returns: {
          id: string
          profile_image: string
          relation: string
          username: string
        }[]
      }
      shared_library_owner_hash: { Args: { _user_id: string }; Returns: string }
      unfriend: { Args: { _other: string }; Returns: undefined }
      upsert_style_memory: {
        Args: {
          _context_axis: string
          _context_value: string
          _memory_type: string
          _mirror_evidence_count: number
          _user_id: string
          _value: string
          _weight: number
        }
        Returns: {
          evidence_count: number
        }[]
      }
      username_available: { Args: { _username: string }; Returns: boolean }
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
    Enums: {},
  },
} as const
