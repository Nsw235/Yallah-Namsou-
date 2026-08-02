-- Ajoute la date de naissance au profil passager/chauffeur et impose un
-- âge minimum de 18 ans, comme le fait Uber à l'inscription. La
-- vérification côté client (AuthGate.tsx) n'est qu'un confort UX : la
-- vraie barrière est cette contrainte serveur, qui ne peut pas être
-- contournée en modifiant le client.

alter table public.profiles
  add column if not exists date_of_birth date;

alter table public.profiles
  drop constraint if exists profiles_minimum_age;

alter table public.profiles
  add constraint profiles_minimum_age
  check (date_of_birth is null or date_of_birth <= (current_date - interval '18 years'));

-- Le trigger de création de profil doit désormais aussi lire
-- date_of_birth depuis les métadonnées fournies par supabase.auth.signUp().
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, date_of_birth)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
