\set ON_ERROR_STOP on

begin;

do $$
declare
  result jsonb;
  first_handle text;
  second_handle text;
  board_count integer;
begin
  -- The row inserted before the migration must remain intact as Preseason.
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

  perform public.sr_register('CUSTOM_TEST','1111','ralston');
  perform public.sr_register('LOWKILL_TEST','2222','ralston');
  perform public.sr_register('STANDARD_TEST','3333','ralston');
  perform public.sr_register('STRONG_TEST','4444','ralston');

  result := public.sr_submit_v2(
    'CUSTOM_TEST','1111','foundry','nightmare',1,
    1,0,200,true,45,1,'custom','{"marker":"custom-save"}'::jsonb
  );
  if not (result->>'ok')::boolean or (result->>'challenge_clear')::boolean then
    raise exception 'Custom result was treated as a Challenge clear: %', result;
  end if;

  result := public.sr_submit_v2(
    'LOWKILL_TEST','2222','foundry','rookie',7,
    2,0,400,true,120,3,'challenge','{}'::jsonb
  );
  if not (result->>'ok')::boolean or (result->>'challenge_clear')::boolean then
    raise exception 'low-contribution survival was treated as a clear: %', result;
  end if;

  result := public.sr_submit_v2(
    'STANDARD_TEST','3333','foundry','nightmare',7,
    3,1,800,true,140,3,'challenge','{}'::jsonb
  );
  if result->>'error' <> 'BAD_CHALLENGE_TIER' then
    raise exception 'player skipped directly to Nightmare: %', result;
  end if;

  perform public.sr_submit_v2(
    'STANDARD_TEST','3333','foundry','rookie',7,
    3,0,600,true,140,3,'challenge','{}'::jsonb
  );
  perform public.sr_submit_v2(
    'STANDARD_TEST','3333','foundry','regular',7,
    3,0,700,true,140,3,'challenge','{}'::jsonb
  );
  result := public.sr_submit_v2(
    'STANDARD_TEST','3333','foundry','veteran',7,
    3,1,800,true,140,3,'challenge','{}'::jsonb
  );
  if not (result->>'challenge_clear')::boolean then
    raise exception 'standard Challenge did not clear: %', result;
  end if;

  perform public.sr_submit_v2(
    'STRONG_TEST','4444','foundry','rookie',7,
    3,0,600,true,140,3,'challenge','{}'::jsonb
  );
  perform public.sr_submit_v2(
    'STRONG_TEST','4444','foundry','regular',7,
    3,0,700,true,140,3,'challenge','{}'::jsonb
  );
  result := public.sr_submit_v2(
    'STRONG_TEST','4444','foundry','veteran',7,
    4,1,900,true,130,3,'challenge','{}'::jsonb
  );
  if not (result->>'challenge_clear')::boolean then
    raise exception 'strong Challenge did not clear: %', result;
  end if;

  -- Surviving the next tier with too few eliminations must not replace the best clear.
  perform public.sr_submit_v2(
    'STRONG_TEST','4444','foundry','elite',7,
    2,0,500,true,150,3,'challenge','{}'::jsonb
  );

  select b.handle into first_handle
    from public.sr_board_v2('ralston',50,'preseason') b
   where b.handle in ('STANDARD_TEST','STRONG_TEST')
   order by b.rank
   limit 1;
  if first_handle <> 'STRONG_TEST' then
    raise exception 'best-performance ordering is wrong: %', first_handle;
  end if;

  select b.handle into second_handle
    from public.sr_board_v2('ralston',50,'preseason') b
   where b.handle = 'STANDARD_TEST';
  if second_handle is null then
    raise exception 'eligible standard clear is missing from board';
  end if;

  select count(*) into board_count
    from public.sr_board_v2('ralston',50,'preseason') b
   where b.handle in ('CUSTOM_TEST','LOWKILL_TEST');
  if board_count <> 0 then
    raise exception 'Custom or low-kill result leaked onto board';
  end if;

  result := public.sr_submit_v2(
    'STANDARD_TEST','3333','foundry','nightmare',1,
    1,0,200,true,30,3,'challenge','{}'::jsonb
  );
  if result->>'error' <> 'NOT_STANDARD_CHALLENGE' then
    raise exception 'one-opponent Challenge was not rejected: %', result;
  end if;

  if (select count(*) from public.matches where handle='STANDARD_TEST') <> 3 then
    raise exception 'rejected result created a match row';
  end if;

  if not has_function_privilege('anon','public.sr_board_v2(text,integer,text)','execute') then
    raise exception 'anon cannot call seasonal board RPC';
  end if;
  if has_table_privilege('anon','public.seasons','select') then
    raise exception 'anon can read seasons table directly';
  end if;
  if has_function_privilege('anon','public.sr_stamp_match_season()','execute') then
    raise exception 'anon can execute internal season trigger';
  end if;
end
$$;

rollback;

select 'challenge seasons tests passed' as result;
