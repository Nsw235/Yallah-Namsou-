export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      drivers: {
        Row: {
          created_at: string
          id: string
          insurance_expiry: string | null
          license_number: string | null
          rating_avg: number | null
          validation_status: Database["public"]["Enums"]["driver_validation_status"]
        }
        Insert: {
          created_at?: string
          id: string
          insurance_expiry?: string | null
          license_number?: string | null
          rating_avg?: number | null
          validation_status?: Database["public"]["Enums"]["driver_validation_status"]
        }
        Update: {
          created_at?: string
          id?: string
          insurance_expiry?: string | null
          license_number?: string | null
          rating_avg?: number | null
          validation_status?: Database["public"]["Enums"]["driver_validation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "drivers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          trip_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          trip_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          base_fare: number
          id: string
          peak_multiplier: number
          price_per_km: number
          updated_at: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          base_fare: number
          id?: string
          peak_multiplier?: number
          price_per_km: number
          updated_at?: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          base_fare?: number
          id?: string
          peak_multiplier?: number
          price_per_km?: number
          updated_at?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rated_by: string
          rating: number
          tag: string | null
          trip_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rated_by: string
          rating: number
          tag?: string | null
          trip_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rated_by?: string
          rating?: number
          tag?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_rated_by_fkey"
            columns: ["rated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          accepted_at: string | null
          completed_at: string | null
          distance_km: number | null
          driver_id: string | null
          driver_notes: string | null
          dropoff_address: string | null
          dropoff_lat: number
          dropoff_lng: number
          estimated_price: number | null
          final_price: number | null
          id: string
          passenger_id: string
          pickup_address: string | null
          pickup_lat: number
          pickup_lng: number
          requested_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["trip_status"]
          vehicle_id: string | null
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          accepted_at?: string | null
          completed_at?: string | null
          distance_km?: number | null
          driver_id?: string | null
          driver_notes?: string | null
          dropoff_address?: string | null
          dropoff_lat: number
          dropoff_lng: number
          estimated_price?: number | null
          final_price?: number | null
          id?: string
          passenger_id: string
          pickup_address?: string | null
          pickup_lat: number
          pickup_lng: number
          requested_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          vehicle_id?: string | null
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          accepted_at?: string | null
          completed_at?: string | null
          distance_km?: number | null
          driver_id?: string | null
          driver_notes?: string | null
          dropoff_address?: string | null
          dropoff_lat?: number
          dropoff_lng?: number
          estimated_price?: number | null
          final_price?: number | null
          id?: string
          passenger_id?: string
          pickup_address?: string | null
          pickup_lat?: number
          pickup_lng?: number
          requested_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          vehicle_id?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: [
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string | null
          driver_id: string
          id: string
          last_lat: number | null
          last_lng: number | null
          model: string | null
          passenger_capacity: number
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          type: Database["public"]["Enums"]["vehicle_type"]
          updated_at: string
        }
        Insert: {
          brand?: string | null
          driver_id: string
          id?: string
          last_lat?: number | null
          last_lng?: number | null
          model?: string | null
          passenger_capacity?: number
          plate: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          type: Database["public"]["Enums"]["vehicle_type"]
          updated_at?: string
        }
        Update: {
          brand?: string | null
          driver_id?: string
          id?: string
          last_lat?: number | null
          last_lng?: number | null
          model?: string | null
          passenger_capacity?: number
          plate?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          type?: Database["public"]["Enums"]["vehicle_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_nearest_driver: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
      }
      cancel_my_pending_trip: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
      }
      driver_complete_trip: {
        Args: { p_final_price: number; p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
      }
      driver_start_trip: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
      }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      passenger_complete_trip: {
        Args: { p_final_price: number; p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
      }
      passenger_confirm_boarding: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
      }
      update_my_vehicle_location: {
        Args: { p_lat: number; p_lng: number; p_vehicle_id: string }
        Returns: undefined
      }
    }
    Enums: {
      driver_validation_status: "pending" | "approved" | "rejected" | "suspended"
      payment_method: "airtel_money" | "moov_money" | "cash"
      payment_status: "pending" | "paid" | "failed"
      trip_status: "pending" | "accepted" | "in_progress" | "completed" | "cancelled"
      user_role: "passenger" | "driver" | "admin"
      vehicle_status: "offline" | "available" | "busy"
      vehicle_type: "suv" | "van" | "berline"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
