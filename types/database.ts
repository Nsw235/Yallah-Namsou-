export type VehicleType = 'berline' | 'van' | 'suv';
export type TripStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentMethod = 'airtel_money' | 'moov_money' | 'cash';
export type PaymentStatus = 'pending' | 'paid' | 'failed';

export interface Profile {
  id: string;
  role: 'passenger' | 'driver' | 'admin';
  full_name: string | null;
  phone: string | null;
  created_at: string;
}

export interface Driver {
  id: string;
  license_number: string | null;
  validation_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  rating_avg: number;
  created_at: string;
}

export interface Vehicle {
  id: string;
  driver_id: string;
  type: VehicleType;
  plate: string;
  brand: string | null;
  model: string | null;
  passenger_capacity: number;
  status: 'offline' | 'available' | 'busy';
}

export interface PricingRule {
  id: string;
  vehicle_type: VehicleType;
  base_fare: number;
  price_per_km: number;
  peak_multiplier: number;
}

export interface Trip {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  vehicle_type: VehicleType;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string | null;
  estimated_price: number | null;
  final_price: number | null;
  status: TripStatus;
  requested_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Payment {
  id: string;
  trip_id: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  provider_reference: string | null;
  created_at: string;
}

export interface Rating {
  id: string;
  trip_id: string;
  rated_by: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

// Vue enrichie utilisée par l'UI pour afficher le chauffeur d'une course
export interface TripWithDriver extends Trip {
  driver_profile?: Pick<Profile, 'full_name' | 'phone'> | null;
  driver_info?: Pick<Driver, 'rating_avg'> | null;
  vehicle_info?: Pick<Vehicle, 'plate' | 'brand' | 'model'> | null;
}
