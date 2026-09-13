\set ON_ERROR_STOP on

begin;

select plan(1);

do $$
declare
  result jsonb;
  i integer;
  board_count integer;
  current_progress integer;
begin
  -- The row inserted before the season migrations remains intact as
  -- Preseason history, including the player's permanent save.
  if not exists (
    select 1 from public.matches
     where handle = 'LEGACY_TEST'
       and season_slug = 'preseason'
       and match_mode = 'legacy'
       and ranked_eligible = false
  ) then
    raise exception 'legacy match was not preserved as Preseason';
  end if;
  if (select save->>'marker' from public.players where handle='LEGACY_TEST') <> 'keep-me' then
    raise exception 'legacy player save changed';
  end if;

  if (select ends_at from public.seasons where slug='preseason') <> '2026-10-01 07:00:00+00'::timestamptz then
    raise exception 'Preseason does not end at the October 1 Pacific launch';
  end if;
  if (select starts_at from public.seasons where slug='season-1') <> '2026-10-01 07:00:00+00'::timestamptz
     or (select ends_at from public.seasons where slug='season-1') <> '2026-11-01 07:00:00+00'::timestamptz then
    raise exception 'Season 1 is not the October Pacific calendar month';
  end if;
  if (select starts_at from public.seasons where slug='season-3') <> '2026-12-01 08:00:00+00'::timestamptz then
    raise exception 'calendar seasons do not preserve Pacific midnight across DST';
  end if;

  perform public.sr_register('CUSTOM_TEST','1111','ralston');
  perform public.sr_register('SIXWIN_TEST','2222','ralston');

  result := public.sr_submit_v2(
    'CUSTOM_TEST','1111','foundry','nightmare',1,
    1,0,200,true,45,1,'custom','{"marker":"custom-save"}'::jsonb
  );
  if not (result->>'ok')::boolean or (result->>'qualifying_win')::boolean or (result->>'challenge_clear')::boolean then
    raise exception 'Custom result affected Challenge progress: %', result;
  end if;

  -- A low-elimination Rookie win does not qualify.
  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','rookie',7,
    2,0,400,true,60,3,'challenge','{}'::jsonb
  );
  if (result->>'qualifying_win')::boolean or (result->>'tier_wins')::integer <> 0 then
    raise exception 'low-elimination Rookie win qualified: %', result;
  end if;

  -- Qualifying wins accumulate, and an intervening loss does not erase them.
  for i in 1..3 loop
    result := public.sr_submit_v2(
      'SIXWIN_TEST','2222','foundry','rookie',7,
      3,0,600,true,60,3,'challenge','{}'::jsonb
    );
    if not (result->>'qualifying_win')::boolean or (result->>'challenge_clear')::boolean
       or (result->>'tier_wins')::integer <> i then
      raise exception 'Rookie progress %/6 is wrong: %', i, result;
    end if;
  end loop;

  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','rookie',7,
    4,0,600,false,60,3,'challenge','{}'::jsonb
  );
  if (result->>'tier_wins')::integer <> 3 then
    raise exception 'loss erased qualifying wins: %', result;
  end if;

  for i in 4..6 loop
    result := public.sr_submit_v2(
      'SIXWIN_TEST','2222','foundry','rookie',7,
      3,0,600,true,60,3,'challenge','{}'::jsonb
    );
    if i < 6 and (result->>'challenge_clear')::boolean then
      raise exception 'Rookie cleared before six qualifying wins: %', result;
    end if;
  end loop;
  if not (result->>'challenge_clear')::boolean
     or (result->>'best_tier')::integer <> 1
     or result->>'next_skill' <> 'regular'
     or (result->>'tier_wins')::integer <> 0 then
    raise exception 'sixth Rookie win did not advance to Regular: %', result;
  end if;

  -- Regular keeps the three-elimination requirement.
  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','regular',7,
    2,0,500,true,60,3,'challenge','{}'::jsonb
  );
  if (result->>'qualifying_win')::boolean then
    raise exception 'two eliminations qualified at Regular: %', result;
  end if;
  for i in 1..6 loop
    result := public.sr_submit_v2(
      'SIXWIN_TEST','2222','foundry','regular',7,
      3,0,700,true,60,3,'challenge','{}'::jsonb
    );
  end loop;
  if not (result->>'challenge_clear')::boolean or result->>'next_skill' <> 'veteran' then
    raise exception 'Regular did not clear after six qualifying wins: %', result;
  end if;

  -- Veteran and harder require two eliminations per qualifying win.
  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','veteran',7,
    1,0,350,true,60,3,'challenge','{}'::jsonb
  );
  if (result->>'qualifying_win')::boolean then
    raise exception 'one elimination qualified at Veteran: %', result;
  end if;
  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','veteran',7,
    2,0,500,true,60,3,'challenge','{}'::jsonb
  );
  if not (result->>'qualifying_win')::boolean or (result->>'tier_wins')::integer <> 1 then
    raise exception 'two eliminations did not qualify at Veteran: %', result;
  end if;

  select (p->>'tier_wins')::integer into current_progress
    from (select public.sr_challenge_progress_v1('SIXWIN_TEST','2222') p) q;
  if current_progress <> 1 then
    raise exception 'authenticated progress endpoint disagrees with submit: %', current_progress;
  end if;

  select count(*) into board_count
    from public.sr_board_v2('ralston',50,'preseason') b
   where b.handle = 'SIXWIN_TEST' and b.best_tier = 2;
  if board_count <> 1 then
    raise exception 'completed Regular tier is missing from the board';
  end if;

  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','nightmare',7,
    7,0,900,true,60,3,'challenge','{}'::jsonb
  );
  if result->>'error' <> 'BAD_CHALLENGE_TIER' then
    raise exception 'player skipped directly to Nightmare: %', result;
  end if;

  result := public.sr_submit_v2(
    'SIXWIN_TEST','2222','foundry','veteran',1,
    1,0,200,true,30,3,'challenge','{}'::jsonb
  );
  if result->>'error' <> 'NOT_STANDARD_CHALLENGE' then
    raise exception 'one-opponent Challenge was not rejected: %', result;
  end if;

  if not has_function_privilege('anon','public.sr_board_v2(text,integer,text)','execute') then
    raise exception 'anon cannot call seasonal board RPC';
  end if;
  if not has_function_privilege('anon','public.sr_challenge_progress_v1(text,text)','execute') then
    raise exception 'anon cannot call authenticated Challenge progress RPC';
  end if;
  if has_table_privilege('anon','public.seasons','select') then
    raise exception 'anon can read seasons table directly';
  end if;
  if has_function_privilege('anon','public.sr_stamp_match_season()','execute') then
    raise exception 'anon can execute internal season trigger';
  end if;
end
$$;

select pass('challenge seasons behavior and permissions');
select * from finish();

rollback;
