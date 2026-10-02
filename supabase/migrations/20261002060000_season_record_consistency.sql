-- Read models and future match telemetry only. No historical matches, receipts, totals or saves are rewritten.
begin;
create or replace function public.sr_board_v2(
  p_club text, p_limit integer, p_season text
) returns table (
  rank bigint,
  handle text,
  club text,
  best_tier integer,
  best_tier_name text,
  best_kills integer,
  best_damage integer,
  season_matches bigint,
  last_played timestamptz,
  season_slug text,
  season_name text,
  season_ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select s.*
      from public.seasons s
     where s.slug = coalesce(
       nullif(lower(p_season),''),
       (select a.slug from public.seasons a
         where now() >= a.starts_at and now() < a.ends_at
         order by a.starts_at desc limit 1)
     )
     limit 1
  ), eligible as (
    select m.*,
           public.sr_tier_rank(m.skill) as tier
      from public.matches m
      join wanted s on s.slug = m.season_slug
     where m.ranked_eligible
        or (s.slug = 'preseason' and m.match_mode = 'legacy' and m.won)
  ), best as (
    select distinct on (e.handle)
           e.handle, e.tier, e.kills, e.damage, e.played_at
      from eligible e
     order by e.handle, e.tier desc, e.kills desc, e.damage desc, e.played_at asc
  ), totals as (
    select m.handle, count(*) as n, max(m.played_at) as last_played
      from public.matches m
      join wanted s on s.slug = m.season_slug
     where m.match_mode = 'challenge' or (s.slug = 'preseason' and m.match_mode = 'legacy')
     group by m.handle
  ), ordered as (
    select p.handle, p.club,
           b.tier, b.kills, b.damage, b.played_at,
           coalesce(t.n,0) as season_matches,
           coalesce(t.last_played,b.played_at) as last_played,
           s.slug as season_slug, s.name as season_name, s.ends_at,
           row_number() over (
             order by b.tier desc, b.kills desc, b.damage desc, b.played_at asc, p.handle
           ) as place
      from best b
      join public.players p on p.handle = b.handle
      join wanted s on true
      left join totals t on t.handle = b.handle
     where nullif(p_club,'') is null or p.club = lower(p_club)
  )
  select o.place, o.handle, o.club,
         o.tier, public.sr_tier_name(o.tier),
         o.kills, o.damage, o.season_matches, o.last_played,
         o.season_slug, o.season_name, o.ends_at
    from ordered o
   order by o.place
   limit least(greatest(coalesce(p_limit,25),1),100)
$$;

create or replace function public.sr_recent_v2(
  p_club text, p_limit integer, p_season text
) returns table (
  handle text,
  arena text,
  kills integer,
  won boolean,
  challenge_clear boolean,
  played_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select s.slug
      from public.seasons s
     where s.slug = coalesce(
       nullif(lower(p_season),''),
       (select a.slug from public.seasons a
         where now() >= a.starts_at and now() < a.ends_at
         order by a.starts_at desc limit 1)
     )
     limit 1
  )
  select m.handle, m.arena, m.kills, m.won,
         (m.ranked_eligible or (s.slug = 'preseason' and m.match_mode = 'legacy' and m.won)) as challenge_clear,
         m.played_at
    from public.matches m
    join public.players p on p.handle = m.handle
    join wanted s on s.slug = m.season_slug
   where (m.match_mode = 'challenge' or (s.slug = 'preseason' and m.match_mode = 'legacy'))
     and (nullif(p_club,'') is null or p.club = lower(p_club))
   order by m.played_at desc
   limit least(greatest(coalesce(p_limit,10),1),40)
$$;


-- Healing and life-drain allow real damage/headshots above the old per-bot
-- guesses. Preserve submitted integer totals instead of silently clipping them.
-- Authentication, supported rules, kill bounds and duration validation stay.
do $patch$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.sr_submit(text,text,text,text,integer,integer,integer,integer,boolean,integer,jsonb)',
    'public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=replace(definition,'least(greatest(coalesce(p_damage,0), 0), b * 400 + 500)','greatest(coalesce(p_damage,0), 0)');
    definition:=replace(definition,'least(greatest(coalesce(p_headshots,0), 0), k * 3 + 20)','greatest(coalesce(p_headshots,0), 0)');
    if position('TOO_FAST' in definition)>0 or position('TOO_SHORT' in definition)>0 then
      raise exception 'Apply the existing quota/short-win migrations first: %',signature;
    end if;
    if definition ~ 'b\s*\*\s*400\s*\+\s*500' or definition ~ 'k\s*\*\s*3\s*\+\s*20' then
      raise exception 'Unexpected telemetry cap definition; inspect before updating: %',signature;
    end if;
    execute definition;
  end loop;
end $patch$;

-- Every Challenge participant appears immediately. Promotion is still driven
-- only by the original qualifying-win/clear receipts. Custom and new-season
-- legacy results never enter the season totals or current-tier performance.
create or replace function public.sr_board_v3(p_club text, p_limit integer, p_season text)
returns table (
  rank bigint, handle text, club text, current_tier integer, current_tier_name text,
  season_wins bigint, best_kills integer, best_damage integer, season_matches bigint,
  tier_wins integer, mastered boolean, last_played timestamptz,
  season_slug text, season_name text, season_ends_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with wanted as (
    select s.* from public.seasons s
    where s.slug = coalesce(nullif(lower(p_season),''),
      (select a.slug from public.seasons a where now() >= a.starts_at and now() < a.ends_at
       order by a.starts_at desc limit 1))
  ), runs as (
    select m.*, public.sr_tier_rank(m.skill) as tier
    from public.matches m join wanted s on s.slug=m.season_slug
    where m.match_mode='challenge' or (s.slug='preseason' and m.match_mode='legacy')
  ), totals as (
    select r.handle, count(*) as attempts, count(*) filter(where r.won) as wins,
      coalesce(max(r.tier) filter(where r.ranked_eligible or
        (r.season_slug='preseason' and r.match_mode='legacy' and r.won)),0) as cleared,
      min(r.played_at) as first_played, max(r.played_at) as last_played
    from runs r group by r.handle
  ), standings as (
    select t.*, least(t.cleared+1,5) as current_tier,
      coalesce(max(r.kills),0) as best_kills, coalesce(max(r.damage),0) as best_damage,
      case when t.cleared>=5 then 6 else least(count(*) filter(where r.challenge_win_qualifies)::integer,6) end as tier_wins
    from totals t left join runs r on r.handle=t.handle and r.tier=least(t.cleared+1,5)
      and (r.match_mode='legacy' or (r.bots=7 and r.time_limit_minutes=3))
    group by t.handle,t.attempts,t.wins,t.cleared,t.first_played,t.last_played
  )
  select row_number() over(order by b.current_tier desc,b.wins desc,b.best_kills desc,
      b.best_damage desc,b.first_played,p.handle),
    p.handle,p.club,b.current_tier,public.sr_tier_name(b.current_tier),b.wins,
    b.best_kills,b.best_damage,b.attempts,b.tier_wins,b.cleared>=5,b.last_played,
    s.slug,s.name,s.ends_at
  from standings b join public.players p on p.handle=b.handle cross join wanted s
  where nullif(p_club,'') is null or p.club=lower(p_club)
  order by 1 limit least(greatest(coalesce(p_limit,25),1),100)
$$;

create or replace function public.sr_recent_v3(p_club text,p_limit integer,p_season text)
returns table(handle text,arena text,skill text,kills integer,damage integer,
  won boolean,challenge_win_qualifies boolean,challenge_clear boolean,played_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with wanted as (
    select s.slug from public.seasons s
    where s.slug=coalesce(nullif(lower(p_season),''),
      (select a.slug from public.seasons a where now()>=a.starts_at and now()<a.ends_at
       order by a.starts_at desc limit 1))
  )
  select m.handle,m.arena,m.skill,m.kills,m.damage,m.won,m.challenge_win_qualifies,
    (m.ranked_eligible or (s.slug='preseason' and m.match_mode='legacy' and m.won)),m.played_at
  from public.matches m join wanted s on s.slug=m.season_slug
  join public.players p on p.handle=m.handle
  where (m.match_mode='challenge' or (s.slug='preseason' and m.match_mode='legacy'))
    and (nullif(p_club,'') is null or p.club=lower(p_club))
  order by m.played_at desc,m.id desc limit least(greatest(coalesce(p_limit,10),1),40)
$$;

-- Recorded lifetime Stats use the same counters as the legacy lifetime board.
-- Returning saves or receipt retries cannot invent extra recorded matches.
create or replace function public.sr_account_stats(p_handle text,p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare st text; r public.players;
begin
  st:=public.sr_auth(p_handle,p_pin);
  if st<>'OK' then return jsonb_build_object('ok',false,'error',st); end if;
  select * into r from public.players where handle=public.sr_clean_handle(p_handle);
  return jsonb_build_object('ok',true,'handle',r.handle,'matches',r.matches,'wins',r.wins,
    'kills',r.kills,'best',r.best_kills);
end $$;
revoke all on function public.sr_board_v3(text,integer,text) from public;
revoke all on function public.sr_recent_v3(text,integer,text) from public;
revoke all on function public.sr_account_stats(text,text) from public;
grant execute on function public.sr_board_v3(text,integer,text) to anon,authenticated;
grant execute on function public.sr_recent_v3(text,integer,text) to anon,authenticated;
grant execute on function public.sr_account_stats(text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
