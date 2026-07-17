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
          style_preferences: string[] | null
          undertone: string | null
          updated_at: string
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
          style_preferences?: string[] | null
          undertone?: string | null
          updated_at?: string
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
          style_preferences?: string[] | null
          undertone?: string | null
          updated_at?: string
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
      [_ in never]: never
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

export type Tables
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

export type TablesInsert
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

export type TablesUpdate
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

export type Enums
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

export type CompositeTypes
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
export const Constants = {
  public: {
    Enums: {},
  },
} as const
