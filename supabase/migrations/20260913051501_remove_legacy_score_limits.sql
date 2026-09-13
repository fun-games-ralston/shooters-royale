-- Remove the official-site hourly scoring quotas without changing existing data.
-- Preserves authentication, per-result checks and the existing function ACL.
-- No seasonal endpoints or gameplay are installed by this patch.

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
