import DriverDashboard from '@/components/DriverDashboard';
import RoleGate from '@/components/RoleGate';

export default function ChauffeurPage() {
  return (
    <RoleGate allow="driver">
      <DriverDashboard />
    </RoleGate>
  );
}
