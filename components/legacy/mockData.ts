export type FleetStatus = 'en_course' | 'en_attente' | 'indisponible';

export type FleetVehicle = {
  id: string;
  code: string;
  label: 'Berline' | 'Van' | 'SUV';
  status: FleetStatus;
  driverName: string;
  lat: number;
  lng: number;
};

export const STATUS_META: Record<FleetStatus, { label: string; dot: string; text: string }> = {
  en_course: { label: 'En Course', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  en_attente: { label: 'En Attente', dot: 'bg-amber-400', text: 'text-amber-400' },
  indisponible: { label: 'Indisponible', dot: 'bg-red-400', text: 'text-red-400' },
};

export const MOCK_FLEET: FleetVehicle[] = [
  { id: 'v1', code: 'FR01', label: 'Berline', status: 'en_course', driverName: 'Jean D.', lat: 12.1348, lng: 15.0557 },
  { id: 'v2', code: 'FR02', label: 'Van', status: 'en_attente', driverName: 'Sophie M.', lat: 12.128, lng: 15.048 },
  { id: 'v3', code: 'FR03', label: 'SUV', status: 'indisponible', driverName: 'Amadou K.', lat: 12.141, lng: 15.062 },
];

export const MOCK_STATS = {
  totalCourses: 8,
  revenue: 320,
  coursesPerHour: 1.2,
  byType: [
    { label: 'Berline', value: 8 },
    { label: 'Van', value: 3 },
    { label: 'SUV', value: 7 },
    { label: 'Berline', value: 2 },
    { label: 'Van', value: 2 },
  ],
};
