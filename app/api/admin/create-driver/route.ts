import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Crée un nouveau compte chauffeur complet (auth + profil + fiche chauffeur).
// Tourne côté serveur avec la clé service_role — jamais exposée au navigateur.
// Voir /api/admin/driver-password pour le même schéma d'authentification.

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

    const { fullName, phone, email, password, licenseNumber } = await req.json();
    if (!fullName || !email || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Nom, email et mot de passe (8 caractères minimum) sont requis.' }, { status: 400 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Vérifie que l'appelant est authentifié et admin.
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Session invalide.' }, { status: 401 });
    }
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (profileError || profile?.role !== 'admin') {
      return NextResponse.json({ error: "Accès refusé : rôle admin requis." }, { status: 403 });
    }

    // 2. Crée le compte auth (email déjà confirmé, pas d'email envoyé).
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return NextResponse.json({ error: createError?.message ?? 'Échec de la création du compte.' }, { status: 400 });
    }
    const driverId = created.user.id;

    // 3. Profil (rôle driver).
    const { error: insertProfileError } = await admin
      .from('profiles')
      .insert({ id: driverId, role: 'driver', full_name: fullName, phone: phone || null });
    if (insertProfileError) {
      return NextResponse.json({ error: insertProfileError.message }, { status: 400 });
    }

    // 4. Fiche chauffeur.
    const { error: insertDriverError } = await admin
      .from('drivers')
      .insert({ id: driverId, license_number: licenseNumber || null, validation_status: 'approved' });
    if (insertDriverError) {
      return NextResponse.json({ error: insertDriverError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, driverId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Erreur serveur.' }, { status: 500 });
  }
}
