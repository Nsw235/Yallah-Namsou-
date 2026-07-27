-- =========================================================================
-- Seed : 3 chauffeurs de démonstration, un par catégorie de véhicule.
-- Déjà appliqué sur le projet Supabase "moto-taxi-tchad" utilisé par l'app.
-- À exécuter uniquement si vous recréez la base sur un nouveau projet.
-- Mot de passe de démo (ne sert qu'à des tests internes, à changer/supprimer
-- en production) : demo-Pf-2026!
-- =========================================================================

create extension if not exists pgcrypto;

do $$
declare
  v_moussa uuid := gen_random_uuid();
  v_ahmat  uuid := gen_random_uuid();
  v_fatime uuid := gen_random_uuid();
begin
  -- Driver 1: Moussa B. — Berline
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    aud, role, confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    v_moussa, '00000000-0000-0000-0000-000000000000', 'moussa.driver@privatefleet.demo',
    crypt('demo-Pf-2026!', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', '', '', '', ''
  );
  update public.profiles set role='driver', full_name='Moussa B.', phone='+235 66 00 00 01' where id = v_moussa;
  insert into public.drivers (id, license_number, validation_status, rating_avg) values (v_moussa, 'TD-LIC-0001', 'approved', 5.0);
  insert into public.vehicles (driver_id, type, plate, brand, model, passenger_capacity, status)
  values (v_moussa, 'berline', 'TC-123-AB', 'Mercedes-Maybach', 'Berline Argentée', 4, 'available');

  -- Driver 2: Ahmat K. — Prestige
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    aud, role, confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    v_ahmat, '00000000-0000-0000-0000-000000000000', 'ahmat.driver@privatefleet.demo',
    crypt('demo-Pf-2026!', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', '', '', '', ''
  );
  update public.profiles set role='driver', full_name='Ahmat K.', phone='+235 66 00 00 02' where id = v_ahmat;
  insert into public.drivers (id, license_number, validation_status, rating_avg) values (v_ahmat, 'TD-LIC-0002', 'approved', 4.9);
  insert into public.vehicles (driver_id, type, plate, brand, model, passenger_capacity, status)
  values (v_ahmat, 'prestige', 'TC-456-CD', 'Mercedes-Maybach', 'Prestige Noire', 4, 'available');

  -- Driver 3: Fatimé N. — SUV
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    aud, role, confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    v_fatime, '00000000-0000-0000-0000-000000000000', 'fatime.driver@privatefleet.demo',
    crypt('demo-Pf-2026!', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', '', '', '', ''
  );
  update public.profiles set role='driver', full_name='Fatimé N.', phone='+235 66 00 00 03' where id = v_fatime;
  insert into public.drivers (id, license_number, validation_status, rating_avg) values (v_fatime, 'TD-LIC-0003', 'approved', 4.95);
  insert into public.vehicles (driver_id, type, plate, brand, model, passenger_capacity, status)
  values (v_fatime, 'suv', 'TC-789-EF', 'Mercedes-Benz', 'SUV G-Class', 5, 'available');
end $$;
