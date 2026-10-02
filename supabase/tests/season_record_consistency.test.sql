\set ON_ERROR_STOP on
begin;
do $$
declare r jsonb; b record; n bigint; i integer; payload jsonb; receipt_id uuid;
begin
  perform public.sr_register('BOARD_TEST','1234','boardtest');
  perform public.sr_register('TIE_TEST','1234','boardtest');
  perform public.sr_save('BOARD_TEST','1234','{"marker":"keep-inventory"}');
  r:=public.sr_submit_v2('BOARD_TEST','1234','foundry','rookie',7,2,0,450,true,0,3,'challenge','{}');
  select * into b from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST';
  if b.handle is null or b.current_tier<>1 or b.season_wins<>1 or b.season_matches<>1 or b.tier_wins<>0 then raise exception 'first nonqualifying win missing: %',row_to_json(b); end if;
  for i in 1..5 loop
    r:=public.sr_submit_v2('BOARD_TEST','1234','grid','rookie',7,5,0,1100,true,1,3,'challenge','{}');
  end loop;
  select * into b from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST';
  if b.handle is null or b.current_tier<>1 or b.best_kills<>5 or b.best_damage<>1100 or b.tier_wins<>5 then raise exception 'Rookie maxima/progress mismatch'; end if;
  r:=public.sr_submit_v2('BOARD_TEST','1234','foundry','rookie',7,3,0,650,true,1,3,'challenge','{}');
  select * into b from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST';
  if b.handle is null or b.current_tier<>2 or b.season_wins<>7 or b.season_matches<>7 or b.tier_wins<>0 or b.best_kills<>0 or b.best_damage<>0 then raise exception 'promotion totals or old tier performance leaked: %',row_to_json(b); end if;
  -- Max kills and max damage need not occur together, and a loss is a run.
  perform public.sr_submit_v2('BOARD_TEST','1234','foundry','regular',7,6,0,1700,false,1,3,'challenge','{}');
  perform public.sr_submit_v2('BOARD_TEST','1234','skyport','regular',7,3,0,1900,true,1,3,'challenge','{}');
  select * into b from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST';
  if b.handle is null or b.current_tier<>2 or b.season_wins<>8 or b.season_matches<>9 or b.best_kills<>6 or b.best_damage<>1900 or b.tier_wins<>1 then raise exception 'current-tier independent single-match highs incorrect'; end if;
  -- Custom/legacy records remain lifetime results only, even with higher skill.
  for i in 1..61 loop
    perform public.sr_submit_v2('BOARD_TEST','1234','foundry','nightmare',7,7,0,3000,true,0,3,'custom','{}');
    perform public.sr_submit('BOARD_TEST','1234','foundry','nightmare',7,7,0,3000,true,0,'{}');
  end loop;
  select * into b from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST';
  if b.handle is null or b.current_tier<>2 or b.season_wins<>8 or b.season_matches<>9 or b.best_kills<>6 or b.best_damage<>1900 then raise exception 'Custom/legacy polluted season'; end if;
  select season_matches into n from public.sr_board_v2('boardtest',100,'') where handle='BOARD_TEST';
  if n<>9 then raise exception 'cached-client run total polluted'; end if;
  if exists(select 1 from public.sr_recent_v2('boardtest',40,'') where handle='BOARD_TEST' and kills=7 and challenge_clear) then raise exception 'legacy wins still displayed as clear'; end if;
  select count(*) into n from public.sr_recent_v3('boardtest',40,'') where handle='BOARD_TEST';
  if n<>9 then raise exception 'season feed includes non-Challenge or lost Challenge'; end if;
  if not exists(select 1 from public.sr_recent_v3('boardtest',40,'') where handle='BOARD_TEST' and skill='rookie' and challenge_clear) then raise exception 'actual tier clear missing from feed'; end if;
  r:=public.sr_account_stats('BOARD_TEST','1234');
  if (r->>'matches')::integer<>131 or (r->>'wins')::integer<>130 then raise exception 'recorded lifetime totals mismatch: %',r; end if;
  if not exists(select 1 from public.sr_board('boardtest',100) where handle='BOARD_TEST' and matches=(r->>'matches')::int and wins=(r->>'wins')::int) then raise exception 'lifetime board and account Stats disagree'; end if;
  r:=public.sr_account_stats('BOARD_TEST','0000');
  if r->>'error'<>'BAD_PIN' or r ? 'wins' then raise exception 'Stats bypass auth'; end if;
  -- Replaying a receipt advances neither season nor lifetime totals twice.
  payload:='{"p_arena":"grid","p_skill":"regular","p_bots":7,"p_kills":4,"p_headshots":81,"p_damage":4500,"p_won":true,"p_duration":0,"p_time_limit":3,"p_mode":"challenge"}';
  receipt_id:=md5('BOARD_TEST_RECEIPT')::uuid;
  r:=public.sr_submit_once('BOARD_TEST','1234',receipt_id,2,payload);
  if public.sr_submit_once('BOARD_TEST','1234',receipt_id,2,payload) is distinct from r then raise exception 'unstable receipt'; end if;
  select * into b from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST';
  if b.handle is null or b.season_wins<>9 or b.season_matches<>10 or b.tier_wins<>2 or b.best_damage<>4500 then raise exception 'duplicate result advanced counters'; end if;
  if not exists(select 1 from public.matches where handle='BOARD_TEST' and damage=4500 and headshots=81) then raise exception 'legitimate telemetry silently clipped'; end if;
  if (select save->>'marker' from public.players where handle='BOARD_TEST')<>'keep-inventory' then raise exception 'save overwritten'; end if;
  -- Rank prefers tier, then wins, then current-tier kills/damage. Attempts
  -- do not award rank, and changing a club cannot change a fighter's counts.
  insert into public.matches(handle,skill,bots,kills,damage,won,season_slug,match_mode,time_limit_minutes,ranked_eligible,challenge_win_qualifies)
  select 'TIE_TEST','rookie',7,3,600,true,(select slug from public.seasons where now()>=starts_at and now()<ends_at),'challenge',3,true,true;
  insert into public.matches(handle,skill,bots,kills,damage,won,season_slug,match_mode,time_limit_minutes)
  select 'TIE_TEST','regular',7,7,2500,false,(select slug from public.seasons where now()>=starts_at and now()<ends_at),'challenge',3 from generate_series(1,20);
  if not exists(select 1 from public.sr_board_v3('boardtest',100,'') where handle='BOARD_TEST' and rank=1) then raise exception 'performance/attempts outranked total wins'; end if;
  if (select count(*) from public.sr_board_v3('differentclub',100,''))<>0
    or (select count(*) from public.sr_recent_v3('differentclub',40,''))<>0
    or (select count(*) from public.sr_recent_v2('differentclub',40,''))<>0 then raise exception 'club filter broken'; end if;
  if not exists(select 1 from public.sr_board_v3('test',100,'preseason') where handle='LEGACY_TEST') then raise exception 'Preseason history disappeared'; end if;
  if has_table_privilege('anon','public.score_receipts','select') or has_table_privilege('anon','public.seasons','select') then raise exception 'private table exposed'; end if;
  if not has_function_privilege('anon','public.sr_board_v3(text,integer,text)','execute') then raise exception 'public board inaccessible'; end if;
  raise notice 'PASS: first run, low-kill wins, promotion, independent current-tier maxima, losses, 61 Custom + 61 legacy results, feed/board agreement, recorded Stats, PIN auth, retries, inventory, ranking, club scope and Preseason';
end $$;
rollback;
