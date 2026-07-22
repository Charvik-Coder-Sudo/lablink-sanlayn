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
      audit_logs: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_user_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accessories: {
        Row: {
          created_at: string
          description: string
          id: string
          make: string | null
          model: string | null
          photo_url: string | null
          quantity: number
          remarks: string | null
          serial_number: string | null
          status: Database["public"]["Enums"]["equipment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          make?: string | null
          model?: string | null
          photo_url?: string | null
          quantity: number
          remarks?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          make?: string | null
          model?: string | null
          photo_url?: string | null
          quantity?: number
          remarks?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          updated_at?: string
        }
        Relationships: []
      }
      accessory_bookings: {
        Row: {
          accessory_id: string
          booking_date: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          end_time: string
          id: string
          project_name: string
          purpose: string
          quantity: number
          return_reason: string | null
          returned_at: string | null
          returned_by: string | null
          start_time: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          accessory_id: string
          booking_date: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          end_time: string
          id?: string
          project_name: string
          purpose: string
          quantity: number
          return_reason?: string | null
          returned_at?: string | null
          returned_by?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          accessory_id?: string
          booking_date?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          end_time?: string
          id?: string
          project_name?: string
          purpose?: string
          quantity?: number
          return_reason?: string | null
          returned_at?: string | null
          returned_by?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accessory_bookings_accessory_id_fkey"
            columns: ["accessory_id"]
            isOneToOne: false
            referencedRelation: "accessories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accessory_bookings_returned_by_profile_fk"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accessory_bookings_user_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_date: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          end_date: string
          end_time: string
          equipment_id: string
          id: string
          project_name: string
          purpose: string
          quantity: number
          return_reason: string | null
          returned_at: string | null
          returned_by: string | null
          start_time: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          booking_date: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date: string
          end_time: string
          equipment_id: string
          id?: string
          project_name: string
          purpose: string
          quantity: number
          return_reason?: string | null
          returned_at?: string | null
          returned_by?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          booking_date?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string
          end_time?: string
          equipment_id?: string
          id?: string
          project_name?: string
          purpose?: string
          quantity?: number
          return_reason?: string | null
          returned_at?: string | null
          returned_by?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_returned_by_profile_fk"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          calibration_date: string | null
          calibration_due_date: string | null
          category: string
          created_at: string
          equipment_code: string | null
          id: string
          lab_location: string
          manufacturer: string | null
          model: string | null
          name: string
          remarks: string | null
          serial_number: string | null
          status: Database["public"]["Enums"]["equipment_status"]
          total_quantity: number
          updated_at: string
        }
        Insert: {
          calibration_date?: string | null
          calibration_due_date?: string | null
          category: string
          created_at?: string
          equipment_code?: string | null
          id?: string
          lab_location: string
          manufacturer?: string | null
          model?: string | null
          name: string
          remarks?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          total_quantity: number
          updated_at?: string
        }
        Update: {
          calibration_date?: string | null
          calibration_due_date?: string | null
          category?: string
          created_at?: string
          equipment_code?: string | null
          id?: string
          lab_location?: string
          manufacturer?: string | null
          model?: string | null
          name?: string
          remarks?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          total_quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          designation: string | null
          dob: string | null
          email: string
          employee_id: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          dob?: string | null
          email: string
          employee_id: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          dob?: string | null
          email?: string
          employee_id?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accessory_available_qty: {
        Args: {
          _accessory_id: string
          _end: string
          _from_date: string
          _start: string
          _to_date: string
        }
        Returns: number
      }
      accessory_booking_slots: {
        Args: { _accessory_ids: string[]; _from: string; _to: string }
        Returns: {
          id: string
          accessory_id: string
          user_id: string
          booking_date: string
          end_date: string
          start_time: string
          end_time: string
          quantity: number
          project_name: string
          full_name: string | null
          department: string | null
        }[]
      }
      admin_update_accessory_booking: {
        Args: {
          _booking_date: string
          _booking_id: string
          _end: string
          _end_date: string
          _override?: boolean
          _project_name: string
          _purpose: string
          _quantity: number
          _start: string
        }
        Returns: Database["public"]["Tables"]["accessory_bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "accessory_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_booking: {
        Args: {
          _booking_date: string
          _booking_id: string
          _end: string
          _end_date: string
          _override?: boolean
          _project_name: string
          _purpose: string
          _quantity: number
          _start: string
        }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_accessory_booking: {
        Args: { _booking_id: string; _reason?: string | null }
        Returns: Database["public"]["Tables"]["accessory_bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "accessory_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_booking: {
        Args: { _booking_id: string; _reason?: string | null }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_accessory_booking: {
        Args: {
          _accessory_id: string
          _booking_date: string
          _end: string
          _end_date: string
          _project_name: string
          _purpose: string
          _quantity: number
          _start: string
        }
        Returns: Database["public"]["Tables"]["accessory_bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "accessory_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_booking: {
        Args: {
          _booking_date: string
          _end: string
          _end_date: string
          _equipment_id: string
          _project_name: string
          _purpose: string
          _quantity: number
          _start: string
        }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      equipment_available_qty: {
        Args: {
          _end: string
          _equipment_id: string
          _from_date: string
          _start: string
          _to_date: string
        }
        Returns: number
      }
      equipment_booking_slots: {
        Args: { _equipment_ids: string[]; _from: string; _to: string }
        Returns: {
          id: string
          equipment_id: string
          user_id: string
          booking_date: string
          end_date: string
          start_time: string
          end_time: string
          quantity: number
          project_name: string
          full_name: string | null
          department: string | null
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      return_accessory_booking: {
        Args: { _booking_id: string; _reason?: string | null }
        Returns: Database["public"]["Tables"]["accessory_bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "accessory_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_booking: {
        Args: { _booking_id: string; _reason?: string | null }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "employee"
      booking_status:
        | "booked"
        | "cancelled"
        | "returned"
        | "completed"
        | "pending"
        | "approved"
        | "rejected"
        | "in_use"
        | "overdue"
      equipment_status: "active" | "maintenance" | "retired"
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
      app_role: ["admin", "manager", "employee"],
      booking_status: [
        "booked",
        "cancelled",
        "returned",
        "completed",
        "pending",
        "approved",
        "rejected",
        "in_use",
        "overdue",
      ],
      equipment_status: ["active", "maintenance", "retired"],
    },
  },
} as const
