import { supabase } from '@/lib/supabaseClient';

/** Rôle réel (table profiles) du compte connecté. null si non trouvé/RLS bloque. */
export async function getMyRole(userId: string): Promise<'passenger' | 'driver' | 'admin' | null> {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (error) throw error;
  return data?.role ?? null;
}
