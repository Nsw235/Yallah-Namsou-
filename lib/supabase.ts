import { createClient } from "@supabase/supabase-js";

// Valeurs par défaut = vrai projet Supabase "yallah-namsou" (clé publique, sans risque à exposer côté client).
// Tu peux les surcharger via NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY dans Vercel → Settings → Environment Variables.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jijvqzrldnijjfhlawda.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_nQgrYTherG1AtCfmOQ6nTg_iIDQY7vP";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type VehicleType = "suv" | "van" | "berline";

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  suv: "SUV",
  van: "Van",
  berline: "Berline",
};

export interface PricingRule {
  vehicle_type: VehicleType;
  base_fare: number;
  price_per_km: number;
  peak_multiplier: number;
}
