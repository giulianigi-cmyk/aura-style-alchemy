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
          created_at: string
          date: string
          id: string
          item_ids: string[]
          notes: string | null
          occasion: string | null
          user_id: string
          weather_condition: string | null
          weather_temp: number | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          item_ids?: string[]
          notes?: string | null
          occasion?: string | null
          user_id?: string
          weather_condition?: string | null
          weather_temp?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          item_ids?: string[]
          notes?: string | null
          occasion?: string | null
          user_id?: string
          weather_condition?: string | null
          weather_temp?: number | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          birth_date: string | null
          city: string | null
          clarity: string | null
          created_at: string
          favorite_brands: string[] | null
          full_name: string | null
          gender: string | null
          id: string
          latitude: number | null
          longitude: number | null
          owned_brands: string[]
          profile_image: string | null
          season: string | null
          setup_complete: boolean
          sizes: Json | null
          style_preferences: string[] | null
          undertone: string | null
          updated_at: string
          username: string | null
          value: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          city?: string | null
          clarity?: string | null
          created_at?: string
          favorite_brands?: string[] | null
          full_name?: string | null
          gender?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          owned_brands?: string[]
          profile_image?: string | null
          season?: string | null
          setup_complete?: boolean
          sizes?: Json | null
          style_preferences?: string[] | null
          undertone?: string | null
          updated_at?: string
          username?: string | null
          value?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          birth_date?: string | null
          city?: string | null
          clarity?: string | null
          created_at?: string
          favorite_brands?: string[] | null
          full_name?: string | null
          gender?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          owned_brands?: string[]
          profile_image?: string | null
          season?: string | null
          setup_complete?: boolean
          sizes?: Json | null
          style_preferences?: string[] | null
          undertone?: string | null
          updated_at?: string
          username?: string | null
          value?: string | null
        }
        Relationships: []
      }
      wardrobe_items: {
        Row: {
          brand: string | null
          category: string | null
          color: string | null
          colors: string[]
          created_at: string
          currency: string | null
          id: string
          image_url: string
          material: string[]
          occasion: string | null
          price: number | null
          season: string | null
          size: string | null
          style: string | null
          user_id: string
          worn_count: number
        }
        Insert: {
          brand?: string | null
          category?: string | null
          color?: string | null
          colors?: string[]
          created_at?: string
          currency?: string | null
          id?: string
          image_url: string
          material?: string[]
          occasion?: string | null
          price?: number | null
          season?: string | null
          size?: string | null
          style?: string | null
          user_id?: string
          worn_count?: number
        }
        Update: {
          brand?: string | null
          category?: string | null
          color?: string | null
          colors?: string[]
          created_at?: string
          currency?: string | null
          id?: string
          image_url?: string
          material?: string[]
          occasion?: string | null
          price?: number | null
          season?: string | null
          size?: string | null
          style?: string | null
          user_id?: string
          worn_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      can_access_share: { Args: { _share_id: string }; Returns: boolean }
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
      search_profiles: {
        Args: { _q: string }
        Returns: {
          id: string
          profile_image: string
          relation: string
          username: string
        }[]
      }
      unfriend: { Args: { _other: string }; Returns: undefined }
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
