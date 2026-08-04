import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Cette route tourne côté serveur (jamais dans le navigateur) et utilise la
// clé service_role Supabase pour changer directement le mot de passe d'un
// chauffeur, sans envoi d'email. Elle vérifie d'abord que l'appelant est
// bien authentifié ET admin avant d'autoriser l'opération.
//
// Variables d'environnement requises sur Vercel (Project Settings > Environment
// Variables) :
//   NEXT_PUBLIC_SUPABASE_URL      (déjà utilisée par le reste de l'app)
//   SUPABASE_SERVICE_ROLE_KEY     (Supabase Dashboard > Project Settings > API > service_role)
//                                  ⚠️ Ne JAMAIS préfixer cette clé par NEXT_PUBLIC_, elle
//                                  doit rester strictement côté serveur.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jijvqzrldnijjfhlawda.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Configuration serveur manquante : SUPABASE_SERVICE_ROLE_KEY n'est pas définie sur Vercel." },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

    const { driverId, newPassword } = await req.json();
    if (!driverId || typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json({ error: 'Mot de passe invalide (8 caractères minimum).' }, { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Vérifie que le token appartient bien à un utilisateur authentifié.
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Session invalide.' }, { status: 401 });
    }

    // 2. Vérifie que cet utilisateur a le rôle admin.
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (profileError || profile?.role !== 'admin') {
      return NextResponse.json({ error: "Accès refusé : rôle admin requis." }, { status: 403 });
    }

    // 3. Change le mot de passe du chauffeur ciblé via l'API admin Supabase.
    const { error: updateError } = await admin.auth.admin.updateUserById(driverId, { password: newPassword });
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Erreur serveur.' }, { status: 500 });
  }
}
