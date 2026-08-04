-- Étend les droits du BackOffice admin :
--  1. L'admin peut modifier n'importe quel profil (nom, téléphone, photo)
--     -- nécessaire pour éditer les infos chauffeur et uploader leur photo
--     depuis la page admin.
--  2. L'admin peut uploader/remplacer/supprimer la photo de n'importe quel
--     utilisateur dans le bucket "avatars" (jusqu'ici chacun ne pouvait
--     gérer que son propre dossier).
--  3. L'admin peut modifier la grille tarifaire (pricing_rules), utilisée
--     par le nouvel écran Paramètres.

-- profiles : admin peut tout modifier
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (is_admin()) with check (is_admin());

-- pricing_rules : admin peut modifier les tarifs
drop policy if exists pricing_rules_admin_all on public.pricing_rules;
create policy pricing_rules_admin_all on public.pricing_rules for all to authenticated
  using (is_admin()) with check (is_admin());

-- storage.objects (bucket avatars) : admin peut gérer n'importe quel fichier
drop policy if exists "Admins can upload any avatar" on storage.objects;
create policy "Admins can upload any avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and is_admin());

drop policy if exists "Admins can update any avatar" on storage.objects;
create policy "Admins can update any avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and is_admin());

drop policy if exists "Admins can delete any avatar" on storage.objects;
create policy "Admins can delete any avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and is_admin());
