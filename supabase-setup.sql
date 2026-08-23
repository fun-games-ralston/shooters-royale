-- =====================================================================
--  Shooter's Royale — online leaderboard + cloud save
--
--  HOW TO RUN THIS
--    1. Open your Supabase project (ethan-game)
--    2. Left sidebar → SQL Editor → New query
--    3. Paste this whole file in and press Run
--    4. That's it. You never have to touch SQL again.
--
--  WHAT IT STORES
--    A made-up handle, a 4-digit PIN (hashed, never readable), a club name,
--    and game stats. No email, no real name, no age, no anything that could
--    identify a child. That is deliberate — see the note at the bottom.
--
--  HOW IT IS PROTECTED
--    The tables have row level security on and ZERO policies, which means the
--    key shipped inside the game cannot read or write them at all. Every read
--    and write goes through the six functions at the bottom of this file,
--    which validate everything before they touch a row.
--
--  Every function returns jsonb like {"ok":true,...} or {"ok":false,"error":"BAD_PIN"}
--  rather than raising, because a raised exception in Postgres rolls back the
--  whole transaction — including the wrong-PIN counter that powers the lockout.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------
create table if not exists public.players (
  handle        text primary key,
  pin_hash      text        not null,
  club          text        not null default 'ralston',
  matches       integer     not null default 0,
  wins          integer     not null default 0,
  kills         integer     not null default 0,
  headshots     integer     not null default 0,
  damage        bigint      not null default 0,
  best_kills    integer     not null default 0,
  save          jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  fails         integer     not null default 0,
  locked_until  timestamptz
);

create table if not exists public.matches (
  id          bigserial primary key,
  handle      text        not null references public.players(handle) on delete cascade,
  played_at   timestamptz not null default now(),
  arena       text,
  skill       text,
  bots        integer,
  kills       integer,
  headshots   integer,
  damage      integer,
  won         boolean,
  duration_s  integer
);

create index if not exists matches_handle_time on public.matches (handle, played_at desc);
create index if not exists matches_time        on public.matches (played_at desc);
create index if not exists players_club_rank   on public.players (club, wins desc, kills desc);

-- Locked down on purpose. No policies = the game's publishable key cannot
-- touch these tables directly. Everything goes through the functions below.
alter table public.players enable row level security;
alter table public.matches enable row level security;

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------

-- Handles are stored uppercase, so SLAGKING and slagking are the same person.
create or replace function public.sr_clean_handle(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9_]', '', 'g'))
$$;

-- A short blocklist. Middle schoolers are creative, so expect to add to it.
-- It over-blocks a little on purpose (PEACOCK is collateral damage). To ban a
-- new word, add it to the list and re-run just this function.
create or replace function public.sr_handle_ok(p text)
returns boolean language sql immutable as $$
  select length(p) between 3 and 14
     and p !~ '(FUCK|SHIT|BITCH|CUNT|NIGG|FAGG|RAPE|NAZI|HITLER|PENIS|VAGIN|BOOB|DICK|COCK|WHORE|SLUT|PORN|SEX|ANUS|ASSHOL)'
$$;

-- Verifies a PIN and returns 'OK', 'NO_SUCH_PLAYER', 'LOCKED' or 'BAD_PIN'.
-- Never raises, so the failed-attempt counter it writes actually survives.
create or replace function public.sr_auth(p_handle text, p_pin text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.players;
begin
  select * into r from public.players where handle = public.sr_clean_handle(p_handle);
  if not found then
    return 'NO_SUCH_PLAYER';
  end if;

  if r.locked_until is not null and r.locked_until > now() then
    return 'LOCKED';
  end if;

  if r.pin_hash <> extensions.crypt(coalesce(p_pin,''), r.pin_hash) then
    -- eight wrong guesses buys a fifteen minute timeout, so a four digit PIN
    -- cannot simply be counted through from 0000 to 9999
    update public.players
       set fails = fails + 1,
           locked_until = case when fails + 1 >= 8 then now() + interval '15 minutes' else null end
     where handle = r.handle;
    return 'BAD_PIN';
  end if;

  update public.players set fails = 0, locked_until = null, last_seen = now()
   where handle = r.handle;
  return 'OK';
end $$;

-- ---------------------------------------------------------------------
-- 1. register — claim a handle
-- ---------------------------------------------------------------------
create or replace function public.sr_register(p_handle text, p_pin text, p_club text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare h text := public.sr_clean_handle(p_handle);
        c text := lower(regexp_replace(coalesce(nullif(p_club,''),'ralston'), '[^A-Za-z0-9_-]', '', 'g'));
begin
  if not public.sr_handle_ok(h) then
    return jsonb_build_object('ok', false, 'error', 'BAD_HANDLE');
  end if;
  if coalesce(p_pin,'') !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'BAD_PIN_FORMAT');
  end if;
  if exists (select 1 from public.players where handle = h) then
    return jsonb_build_object('ok', false, 'error', 'TAKEN');
  end if;

  insert into public.players (handle, pin_hash, club)
  values (h, extensions.crypt(p_pin, extensions.gen_salt('bf')), c);

  return jsonb_build_object('ok', true, 'handle', h, 'club', c,
                            'save', '{}'::jsonb, 'fresh', true);
end $$;

-- ---------------------------------------------------------------------
-- 2. login — get your save back on any device
-- ---------------------------------------------------------------------
create or replace function public.sr_login(p_handle text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare st text; r public.players;
begin
  st := public.sr_auth(p_handle, p_pin);
  if st <> 'OK' then
    return jsonb_build_object('ok', false, 'error', st);
  end if;
  select * into r from public.players where handle = public.sr_clean_handle(p_handle);
  return jsonb_build_object('ok', true, 'handle', r.handle, 'club', r.club,
                            'save', r.save, 'matches', r.matches, 'fresh', false);
end $$;

-- ---------------------------------------------------------------------
-- 3. submit — record one finished trial
--
--    The leaderboard ranks only on stats this function can sanity check:
--      * you cannot kill more fighters than were in the lobby
--      * you cannot claim more than 25 trials or more than an hour of play
--        in any one hour
--    This is honestly not unbreakable, and it is not trying to be. A kid who
--    really wants to can submit fabricated matches at 25 an hour. What stops
--    that in practice is that it is *visible*: the board shows everyone's trial
--    count, so 25 trials and 25 wins in an afternoon looks exactly as silly as
--    it is, and every single attempt leaves a row in `matches` with their name
--    on it. Social consequences beat clever validation with twelve year olds.
-- ---------------------------------------------------------------------
create or replace function public.sr_submit(
  p_handle text, p_pin text,
  p_arena text, p_skill text, p_bots integer,
  p_kills integer, p_headshots integer, p_damage integer,
  p_won boolean, p_duration integer,
  p_save jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare st text; r public.players; h text;
        k int; hs int; dmg int; b int; dur int; spent int; recent int;
begin
  st := public.sr_auth(p_handle, p_pin);
  if st <> 'OK' then
    return jsonb_build_object('ok', false, 'error', st);
  end if;
  h := public.sr_clean_handle(p_handle);

  b   := least(greatest(coalesce(p_bots,1), 1), 11);
  k   := least(greatest(coalesce(p_kills,0), 0), b);              -- can't kill more than were there
  hs  := least(greatest(coalesce(p_headshots,0), 0), k * 3 + 20);
  dmg := least(greatest(coalesce(p_damage,0), 0), b * 400 + 500); -- 200 hp + shield + pets, generously
  dur := least(greatest(coalesce(p_duration,0), 0), 1200);

  -- Only the physically impossible is refused. Getting deleted fifteen seconds
  -- in is a completely normal thing that happens to a beginner, and it should
  -- still count as a trial they turned up for.
  if dur < 5 then
    return jsonb_build_object('ok', false, 'error', 'TOO_SHORT');
  end if;

  -- Rate limits do the anti-cheat work instead of per-match rules, deliberately.
  -- A rule like "five kills cannot happen in sixteen seconds" sounds reasonable
  -- and then throws away a real player's best run of the week, which is exactly
  -- the run they wanted on the board. Rate limits can never do that to a single
  -- honest match; they only bite someone submitting on a loop.
  --   * 25 trials an hour, when a real one runs several minutes
  --   * you cannot claim more minutes of play in an hour than an hour holds
  select count(*), coalesce(sum(m.duration_s), 0) into recent, spent
    from public.matches m
   where m.handle = h and m.played_at > now() - interval '1 hour';
  if recent >= 25 or spent + dur > 3600 then
    return jsonb_build_object('ok', false, 'error', 'TOO_FAST');
  end if;

  insert into public.matches (handle, arena, skill, bots, kills, headshots, damage, won, duration_s)
  values (h, left(coalesce(p_arena,''),24), left(coalesce(p_skill,''),16), b, k, hs, dmg,
          coalesce(p_won,false), dur);

  update public.players set
    matches    = matches + 1,
    wins       = wins + case when coalesce(p_won,false) then 1 else 0 end,
    kills      = kills + k,
    headshots  = headshots + hs,
    damage     = damage + dmg,
    best_kills = greatest(best_kills, k),
    save       = case when p_save is null or p_save = '{}'::jsonb then save else p_save end,
    last_seen  = now()
  where handle = h
  returning * into r;

  return jsonb_build_object('ok', true, 'handle', r.handle, 'matches', r.matches,
                            'wins', r.wins, 'kills', r.kills, 'best_kills', r.best_kills);
end $$;

-- ---------------------------------------------------------------------
-- 4. save — push progress up without finishing a trial
--    (used after shopping, so a purchase is never lost)
-- ---------------------------------------------------------------------
create or replace function public.sr_save(p_handle text, p_pin text, p_save jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare st text;
begin
  st := public.sr_auth(p_handle, p_pin);
  if st <> 'OK' then
    return jsonb_build_object('ok', false, 'error', st);
  end if;
  if p_save is not null and p_save <> '{}'::jsonb then
    update public.players set save = p_save, last_seen = now()
     where handle = public.sr_clean_handle(p_handle);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 5. leaderboard — public, and it never returns a PIN hash
-- ---------------------------------------------------------------------
create or replace function public.sr_board(p_club text, p_limit integer)
returns table (
  rank bigint, handle text, club text,
  matches integer, wins integer, kills integer, headshots integer, best_kills integer,
  last_seen timestamptz
)
language sql security definer set search_path = public as $$
  select row_number() over (order by p.wins desc, p.kills desc, p.best_kills desc, p.handle) as rank,
         p.handle, p.club, p.matches, p.wins, p.kills, p.headshots, p.best_kills, p.last_seen
    from public.players p
   where p.matches > 0
     and (nullif(p_club,'') is null or p.club = lower(p_club))
   order by p.wins desc, p.kills desc, p.best_kills desc, p.handle
   limit least(greatest(coalesce(p_limit,25),1),100)
$$;

-- ---------------------------------------------------------------------
-- 6. recent — a live feed of finished trials, so the board feels alive
-- ---------------------------------------------------------------------
create or replace function public.sr_recent(p_club text, p_limit integer)
returns table (handle text, arena text, kills integer, won boolean, played_at timestamptz)
language sql security definer set search_path = public as $$
  select m.handle, m.arena, m.kills, m.won, m.played_at
    from public.matches m
    join public.players p on p.handle = m.handle
   where (nullif(p_club,'') is null or p.club = lower(p_club))
   order by m.played_at desc
   limit least(greatest(coalesce(p_limit,10),1),40)
$$;

-- ---------------------------------------------------------------------
-- permissions: the game may call these six functions and nothing else.
-- sr_auth is internal — it is only ever called by the functions above.
-- ---------------------------------------------------------------------
revoke execute on function public.sr_auth(text,text) from public, anon, authenticated;

grant execute on function public.sr_register(text,text,text)  to anon, authenticated;
grant execute on function public.sr_login(text,text)          to anon, authenticated;
grant execute on function public.sr_save(text,text,jsonb)     to anon, authenticated;
grant execute on function public.sr_board(text,integer)       to anon, authenticated;
grant execute on function public.sr_recent(text,integer)      to anon, authenticated;
grant execute on function public.sr_submit(text,text,text,text,integer,integer,integer,integer,boolean,integer,jsonb)
  to anon, authenticated;

-- =====================================================================
--  RUNNING THE CLUB  (paste any of these into the SQL Editor)
--
--  See who has been playing:
--      select handle, club, matches, wins, kills, last_seen
--        from players order by last_seen desc;
--
--  Free up a handle or remove someone:
--      delete from players where handle = 'SLAGKING';
--
--  Rename someone whose handle got past the filter:
--      update players set handle = 'NEWNAME' where handle = 'OLDNAME';
--
--  Reset a forgotten PIN to 1234:
--      update players set pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')),
--                         fails = 0, locked_until = null
--       where handle = 'SLAGKING';
--
--  Spot a cheater — look for lots of fast, perfect trials:
--      select handle, count(*), avg(duration_s)::int as avg_len, sum(kills)
--        from matches where played_at > now() - interval '1 day'
--       group by handle order by sum(kills) desc;
--
--  ON KIDS AND DATA
--    Nothing stored here can identify a child: no email, no real name, no age,
--    no location, no device id. That is what keeps this outside COPPA's scope,
--    and it is worth keeping that way even when someone suggests "wouldn't it
--    be easier with Google sign-in". It would not. Tell the parents and the
--    school it exists anyway.
-- =====================================================================
