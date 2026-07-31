'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import PrivateFleetApp from '@/components/PrivateFleetApp';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function routeByRole() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        if (!cancelled) setChecking(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (cancelled) return;

      if (profile?.role === 'admin') {
        router.replace('/admin');
        return;
      }
      if (profile?.role === 'driver') {
        router.replace('/chauffeur');
        return;
      }
      setChecking(false);
    }

    routeByRole();

    const { data: sub } = supabase.auth.onAuthStateChange(() => routeByRole());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (checking) {
    return (
      <div className="wrap-outer">
        <div className="device" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return <PrivateFleetApp />;
}
