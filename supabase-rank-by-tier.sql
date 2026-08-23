-- =====================================================================
--  Shooter's Royale — rank the leaderboard by difficulty
--
--  HOW TO RUN THIS
--    Supabase → SQL Editor → New query → paste → Run. Takes a second.
--
--  WHAT IT CHANGES
--    Nothing about your data. No new tables, no new columns, nothing is
--    deleted. It only replaces the sr_board function with one that sorts
--    differently. Every match anyone has already played still counts.
--
--  THE RULE, in one sentence a sixth grader can repeat:
--
--      Your place on the board is the hardest difficulty you have ever won
--      on. Ties are broken by how many wins you have at that level.
--
--  Why this and not "hardest difficulty gives more coins": on a hard tier you
--  perform worse at everything, so any reward tied to performance shrinks along
--  with you, and any reward that does not shrink can be farmed by loading
--  Nightmare and walking into a wall. Standing is different — it is not a rate,
--  so it cannot be farmed at all. Playing Rookie five hundred times never moves
--  you up. Beating Veteran once moves you a whole band.
--
--  The difficulty of every match is already stored in `matches.skill` and was
--  validated server-side when it was submitted, so this reads real history
--  rather than anything the game could have made up.
-- =====================================================================

-- Rookie is the floor, Nightmare the ceiling. `mixed` lobbies draw bots from
-- rookie through elite, so they sit at Regular — worth something, not the top.
create or replace function public.sr_tier_rank(p text)
returns integer language sql immutable as $$
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
returns text language sql immutable as $$
  select case coalesce(n,0)
    when 5 then 'NIGHTMARE'
    when 4 then 'ELITE'
    when 3 then 'VETERAN'
    when 2 then 'REGULAR'
    when 1 then 'ROOKIE'
    else 'UNRANKED'
  end
$$;

-- The board gains three columns (best_tier, best_tier_name, tier_wins), and
-- Postgres will not let `create or replace` change a function's return type,
-- so the old one has to go first. Dropping a function touches no data.
drop function if exists public.sr_board(text,integer);

create function public.sr_board(p_club text, p_limit integer)
returns table (
  rank bigint, handle text, club text,
  matches integer, wins integer, kills integer, headshots integer, best_kills integer,
  best_tier integer, best_tier_name text, tier_wins bigint,
  last_seen timestamptz
)
language sql security definer set search_path = public as $$
  with best as (                    -- the hardest tier each player has ever won on
    select m.handle, max(public.sr_tier_rank(m.skill)) as bt
      from public.matches m
     where m.won
     group by m.handle
  ),
  tw as (                           -- and how many wins they have at that tier or above
    select m.handle, count(*) as n
      from public.matches m
      join best b on b.handle = m.handle
     where m.won and public.sr_tier_rank(m.skill) >= b.bt
     group by m.handle
  )
  select row_number() over (
           order by coalesce(b.bt,0) desc, coalesce(tw.n,0) desc, p.kills desc, p.handle
         ) as rank,
         p.handle, p.club, p.matches, p.wins, p.kills, p.headshots, p.best_kills,
         coalesce(b.bt,0)                        as best_tier,
         public.sr_tier_name(coalesce(b.bt,0))   as best_tier_name,
         coalesce(tw.n,0)                        as tier_wins,
         p.last_seen
    from public.players p
    left join best b on b.handle = p.handle
    left join tw   on tw.handle  = p.handle
   where p.matches > 0
     and (nullif(p_club,'') is null or p.club = lower(p_club))
   order by coalesce(b.bt,0) desc, coalesce(tw.n,0) desc, p.kills desc, p.handle
   limit least(greatest(coalesce(p_limit,25),1),100)
$$;

grant execute on function public.sr_tier_rank(text)    to anon, authenticated;
grant execute on function public.sr_tier_name(integer) to anon, authenticated;
grant execute on function public.sr_board(text,integer) to anon, authenticated;

-- =====================================================================
--  If you ever want the old "most wins" board back, re-run the sr_board
--  function from supabase-setup.sql. Nothing here is destructive.
--
--  To see the standings yourself:
--      select rank, handle, best_tier_name, tier_wins, wins, kills
--        from sr_board('ralston', 25);
-- =====================================================================
