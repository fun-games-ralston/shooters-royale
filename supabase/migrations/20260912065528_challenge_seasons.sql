-- Block Royale Challenge Ladder and four-week seasons.
--
-- This migration is additive. Existing clients keep using sr_submit/sr_board,
-- every existing match is retained as Preseason history, and no player save or
-- lifetime counter is reset. The feature client uses the versioned RPCs below.

create table if not exists public.seasons (
  slug        text primary key,
  name        text        not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint seasons_slug_format check (slug ~ '^[a-z0-9-]{3,32}$'),
  constraint seasons_dates_ordered check (ends_at > starts_at)
);

alter table public.seasons enable row level security;
revoke all on table public.seasons from public, anon, authenticated;

-- These helpers predate the migration. Pin their lookup path as part of the
-- additive hardening so Supabase's security advisor remains clean.
alter function public.sr_clean_handle(text) set search_path = '';
alter function public.sr_handle_ok(text) set search_path = '';

insert into public.seasons (slug, name, starts_at, ends_at)
values
  ('preseason', 'Preseason', '2000-01-01 00:00:00+00', '2026-09-25 07:00:00+00'),
  ('season-1',  'Season 1',  '2026-09-25 07:00:00+00', '2026-10-23 07:00:00+00')
on conflict (slug) do update set
  name = excluded.name,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at;

alter table public.matches
  add column if not exists season_slug text references public.seasons(slug),
  add column if not exists match_mode text not null default 'legacy',
  add column if not exists time_limit_minutes smallint,
  add column if not exists ranked_eligible boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'matches_match_mode_valid'
       and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_match_mode_valid
      check (match_mode in ('legacy', 'challenge', 'custom'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'matches_time_limit_valid'
       and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_time_limit_valid
      check (time_limit_minutes is null or time_limit_minutes between 1 and 6);
  end if;
end
$$;

-- Old results stay visible as historical Preseason results. They are not
-- relabelled as standard Challenge clears because their rules were adjustable.
update public.matches
   set season_slug = 'preseason',
       match_mode = 'legacy',
       ranked_eligible = false
 where season_slug is null;

create index if not exists matches_season_board
  on public.matches (season_slug, match_mode, ranked_eligible, handle, played_at desc);

-- Old versions of the game do not send season metadata. Stamp those inserts
-- into the active period as legacy history without allowing them onto a new
-- seasonal Challenge board.
create or replace function public.sr_stamp_match_season()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.season_slug is null then
    select s.slug into new.season_slug
      from public.seasons s
     where new.played_at >= s.starts_at and new.played_at < s.ends_at
     order by s.starts_at desc
     limit 1;
  end if;
  new.match_mode := coalesce(new.match_mode, 'legacy');
  return new;
end
$$;

drop trigger if exists matches_stamp_season on public.matches;
create trigger matches_stamp_season
before insert on public.matches
for each row execute function public.sr_stamp_match_season();

revoke execute on function public.sr_stamp_match_season() from public, anon, authenticated;

create or replace function public.sr_tier_rank(p text)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select case lower(coalesce(p,''))
    when 'nightmare' then 5
    when 'elite'     then 4
    when 'veteran'   then 3
    when 'mixed'     then 2
    when 'regular'   then 2
    when 'rookie'    then 1
    else 0
  end
$$;

create or replace function public.sr_tier_name(n integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case coalesce(n,0)
    when 5 then 'NIGHTMARE'
    when 4 then 'ELITE'
    when 3 then 'VETERAN'
    when 2 then 'REGULAR'
    when 1 then 'ROOKIE'
    else 'UNRANKED'
  end
$$;

-- Public read model for the title and leaderboard countdown. The seasons table
-- itself stays inaccessible to browser roles.
create or replace function public.sr_season_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with current_season as (
    select s.slug, s.name, s.starts_at, s.ends_at
      from public.seasons s
     where now() >= s.starts_at and now() < s.ends_at
     order by s.starts_at desc
     limit 1
  ), next_season as (
    select s.slug, s.name, s.starts_at, s.ends_at
      from public.seasons s
     where s.starts_at > now()
     order by s.starts_at
     limit 1
  )
  select jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'current', (select to_jsonb(c) from current_season c),
    'next', (select to_jsonb(n) from next_season n)
  )
$$;

-- Versioned submit endpoint. The old sr_submit remains untouched for the live
-- main build. Only an exact 7-opponent, 3-minute Challenge win with at least
-- three eliminations can become a seasonal leaderboard result.
create or replace function public.sr_submit_v2(
  p_handle text, p_pin text,
  p_arena text, p_skill text, p_bots integer,
  p_kills integer, p_headshots integer, p_damage integer,
  p_won boolean, p_duration integer, p_time_limit integer,
  p_mode text, p_save jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
  r public.players;
  h text;
  k integer;
  hs integer;
  dmg integer;
  b integer;
  dur integer;
  tl integer;
  spent integer;
  recent integer;
  mode_name text := lower(coalesce(p_mode,''));
  season_name text;
  best_tier integer := 0;
  required_tier integer := 1;
  qualifies boolean := false;
begin
  st := public.sr_auth(p_handle, p_pin);
  if st <> 'OK' then
    return jsonb_build_object('ok', false, 'error', st);
  end if;
  h := public.sr_clean_handle(p_handle);

  if mode_name not in ('challenge','custom') then
    return jsonb_build_object('ok', false, 'error', 'BAD_MODE');
  end if;
  if lower(coalesce(p_skill,'')) not in ('rookie','regular','veteran','elite','nightmare','mixed') then
    return jsonb_build_object('ok', false, 'error', 'BAD_SKILL');
  end if;
  if coalesce(p_bots,0) not between 1 and 11 or coalesce(p_time_limit,0) not between 1 and 6 then
    return jsonb_build_object('ok', false, 'error', 'BAD_RULES');
  end if;
  if mode_name = 'challenge' and (p_bots <> 7 or p_time_limit <> 3) then
    return jsonb_build_object('ok', false, 'error', 'NOT_STANDARD_CHALLENGE');
  end if;

  b := p_bots;
  tl := p_time_limit;
  k := least(greatest(coalesce(p_kills,0), 0), b);
  hs := least(greatest(coalesce(p_headshots,0), 0), k * 3 + 20);
  dmg := least(greatest(coalesce(p_damage,0), 0), b * 400 + 500);
  dur := least(greatest(coalesce(p_duration,0), 0), 1200);

  if dur < 5 then
    return jsonb_build_object('ok', false, 'error', 'TOO_SHORT');
  end if;

  select count(*), coalesce(sum(m.duration_s), 0) into recent, spent
    from public.matches m
   where m.handle = h and m.played_at > now() - interval '1 hour';
  if recent >= 25 or spent + dur > 3600 then
    return jsonb_build_object('ok', false, 'error', 'TOO_FAST');
  end if;

  select s.slug into season_name
    from public.seasons s
   where now() >= s.starts_at and now() < s.ends_at
   order by s.starts_at desc
   limit 1;

  if mode_name = 'challenge' and season_name is null then
    return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SEASON');
  end if;

  if mode_name = 'challenge' then
    select coalesce(max(public.sr_tier_rank(m.skill)),0) into best_tier
      from public.matches m
     where m.handle = h
       and m.season_slug = season_name
       and (m.ranked_eligible
            or (season_name = 'preseason' and m.match_mode = 'legacy' and m.won));
    required_tier := least(best_tier + 1, 5);
    if public.sr_tier_rank(p_skill) <> required_tier then
      return jsonb_build_object(
        'ok', false, 'error', 'BAD_CHALLENGE_TIER',
        'required_skill', lower(public.sr_tier_name(required_tier))
      );
    end if;
  end if;

  qualifies := mode_name = 'challenge'
               and coalesce(p_won,false)
               and k >= 3
               and season_name is not null;

  insert into public.matches (
    handle, arena, skill, bots, kills, headshots, damage, won, duration_s,
    season_slug, match_mode, time_limit_minutes, ranked_eligible
  ) values (
    h,
    left(regexp_replace(lower(coalesce(p_arena,'')), '[^a-z0-9_-]', '', 'g'),24),
    lower(p_skill), b, k, hs, dmg, coalesce(p_won,false), dur,
    season_name, mode_name, tl, qualifies
  );

  update public.players set
    matches = matches + 1,
    wins = wins + case when coalesce(p_won,false) then 1 else 0 end,
    kills = kills + k,
    headshots = headshots + hs,
    damage = damage + dmg,
    best_kills = greatest(best_kills, k),
    save = case when p_save is null or p_save = '{}'::jsonb then save else p_save end,
    last_seen = now()
  where handle = h
  returning * into r;

  return jsonb_build_object(
    'ok', true,
    'handle', r.handle,
    'matches', r.matches,
    'wins', r.wins,
    'kills', r.kills,
    'best_kills', r.best_kills,
    'season', season_name,
    'challenge_clear', qualifies,
    'next_skill', case
      when mode_name = 'challenge' then lower(public.sr_tier_name(least(required_tier + case when qualifies then 1 else 0 end,5)))
      else null
    end
  );
end
$$;

-- Seasonal board: one best qualifying clear per fighter. Replays matter only
-- when they improve difficulty, eliminations, or damage. Preseason also shows
-- legacy wins so no historical result disappears.
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
     where m.match_mode in ('legacy','challenge')
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
         (m.ranked_eligible or (m.match_mode = 'legacy' and m.won)) as challenge_clear,
         m.played_at
    from public.matches m
    join public.players p on p.handle = m.handle
    join wanted s on s.slug = m.season_slug
   where m.match_mode in ('legacy','challenge')
     and (nullif(p_club,'') is null or p.club = lower(p_club))
   order by m.played_at desc
   limit least(greatest(coalesce(p_limit,10),1),40)
$$;

revoke execute on function public.sr_tier_rank(text) from public;
revoke execute on function public.sr_tier_name(integer) from public;
revoke execute on function public.sr_season_status() from public;
revoke execute on function public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb) from public;
revoke execute on function public.sr_board_v2(text,integer,text) from public;
revoke execute on function public.sr_recent_v2(text,integer,text) from public;

grant execute on function public.sr_season_status() to anon, authenticated;
grant execute on function public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb) to anon, authenticated;
grant execute on function public.sr_board_v2(text,integer,text) to anon, authenticated;
grant execute on function public.sr_recent_v2(text,integer,text) to anon, authenticated;

comment on table public.seasons is
  'Four-week Block Royale Challenge Ladder periods. Player progression never resets.';
comment on column public.matches.match_mode is
  'legacy for pre-feature clients, challenge for standard ladder rules, custom for adjustable matches.';
comment on column public.matches.ranked_eligible is
  'True only for a standard Challenge win with at least three eliminations.';
