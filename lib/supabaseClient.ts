import { createClient } from '@supabase/supabase-js';

// Valeurs par défaut = projet Supabase "yallah-namsou" (clé publique, sans risque à exposer côté client).
// Idéalement, surcharge-les via NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
// dans Vercel → Settings → Environment Variables.
const FALLBACK_SUPABASE_URL = 'https://jijvqzrldnijjfhlawda.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_nQgrYTherG1AtCfmOQ6nTg_iIDQY7vP';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    'Variables Supabase manquantes, valeurs par défaut utilisées. Configure NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans Vercel pour utiliser ton propre projet.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
