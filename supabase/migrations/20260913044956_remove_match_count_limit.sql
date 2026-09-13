-- Feature-branch scoring fix. Apply only as part of an approved backend release.
-- Replace both submission functions without touching existing scores or saves.
-- Remove both hourly quotas: even the duration sum can reject a legitimate
-- completed match straddling the rolling-hour boundary. Keep authentication,
-- per-match validation, Challenge eligibility, row locking and existing grants.

create or replace function public.sr_submit(
  p_handle text, p_pin text,
  p_arena text, p_skill text, p_bots integer,
  p_kills integer, p_headshots integer, p_damage integer,
  p_won boolean, p_duration integer,
  p_save jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare st text; r public.players; h text;
        k int; hs int; dmg int; b int; dur int;
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
  mode_name text := lower(coalesce(p_mode,''));
  season_name text;
  best_tier integer := 0;
  best_tier_after integer := 0;
  required_tier integer := 1;
  next_tier integer := 1;
  required_kills integer := 3;
  qualifying_wins integer := 0;
  qualifying_wins_after integer := 0;
  qualifies boolean := false;
  clears_tier boolean := false;
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

  -- Serialize submissions for one fighter so two tabs cannot both turn a
  -- fifth qualifying win into duplicate tier clears.
  perform 1 from public.players p where p.handle = h for update;

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

    required_kills := case when required_tier <= 2 then 3 else 2 end;
    if best_tier >= 5 then
      qualifying_wins := 6;
    else
      select least(count(*)::integer, 6) into qualifying_wins
        from public.matches m
       where m.handle = h
         and m.season_slug = season_name
         and m.match_mode = 'challenge'
         and public.sr_tier_rank(m.skill) = required_tier
         and m.challenge_win_qualifies;
    end if;

    qualifies := coalesce(p_won,false) and k >= required_kills;
    qualifying_wins_after := least(6, qualifying_wins + case when qualifies then 1 else 0 end);
    clears_tier := qualifies and (best_tier >= 5 or qualifying_wins_after >= 6);
  end if;

  insert into public.matches (
    handle, arena, skill, bots, kills, headshots, damage, won, duration_s,
    season_slug, match_mode, time_limit_minutes, ranked_eligible,
    challenge_win_qualifies
  ) values (
    h,
    left(regexp_replace(lower(coalesce(p_arena,'')), '[^a-z0-9_-]', '', 'g'),24),
    lower(p_skill), b, k, hs, dmg, coalesce(p_won,false), dur,
    season_name, mode_name, tl, clears_tier, qualifies
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

  best_tier_after := greatest(best_tier, case when clears_tier then required_tier else 0 end);
  next_tier := least(best_tier_after + 1, 5);

  return jsonb_build_object(
    'ok', true,
    'handle', r.handle,
    'matches', r.matches,
    'wins', r.wins,
    'kills', r.kills,
    'best_kills', r.best_kills,
    'season', season_name,
    'qualifying_win', qualifies,
    'challenge_clear', clears_tier,
    'completed_skill', case when clears_tier then lower(public.sr_tier_name(required_tier)) else null end,
    'best_tier', best_tier_after,
    'tier_wins', case when clears_tier and best_tier_after < 5 then 0 else qualifying_wins_after end,
    'wins_required', 6,
    'eliminations_required', required_kills,
    'next_skill', case when mode_name = 'challenge' then lower(public.sr_tier_name(next_tier)) else null end
  );
end
$$;
