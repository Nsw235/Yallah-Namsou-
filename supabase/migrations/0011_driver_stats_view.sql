-- Statistiques chauffeur pré-calculées côté SQL (onglet "Statistiques").
-- Évite tout calcul de somme côté client : une seule requête RPC retourne
-- les totaux (aujourd'hui / cette semaine / total) déjà agrégés.

create or replace function public.get_driver_stats(p_driver_id uuid)
returns table (
  today_earnings numeric,
  today_count integer,
  week_earnings numeric,
  week_count integer,
  total_earnings numeric,
  total_count integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce(sum(final_price) filter (where completed_at >= date_trunc('day', now())), 0) as today_earnings,
    count(*) filter (where completed_at >= date_trunc('day', now()))::int as today_count,
    coalesce(sum(final_price) filter (where completed_at >= date_trunc('week', now())), 0) as week_earnings,
    count(*) filter (where completed_at >= date_trunc('week', now()))::int as week_count,
    coalesce(sum(final_price), 0) as total_earnings,
    count(*)::int as total_count
  from public.trips
  where driver_id = p_driver_id
    and status = 'completed'
    and driver_id = auth.uid();
$$;

revoke all on function public.get_driver_stats(uuid) from public;
grant execute on function public.get_driver_stats(uuid) to authenticated;
