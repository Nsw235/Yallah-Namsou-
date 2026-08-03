import PrivateFleetApp from '@/components/PrivateFleetApp';
import RoleGate from '@/components/RoleGate';

export default function ClientPage() {
  return (
    <RoleGate allow="passenger">
      <PrivateFleetApp />
    </RoleGate>
  );
}
