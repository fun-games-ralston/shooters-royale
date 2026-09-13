\set ON_ERROR_STOP on
begin;
do $$
declare result jsonb; i integer; skill text; target text;
begin
  if exists(select 1 from public.players where handle in ('LIMIT_V1_TEST','LIMIT_V2_TEST','LIMIT_CH_TEST')) then
    raise exception 'test handle already exists';
  end if;
  perform public.sr_register('LIMIT_V1_TEST','1234','test');
  perform public.sr_register('LIMIT_V2_TEST','1234','test');
  perform public.sr_register('LIMIT_CH_TEST','1234','test');
  -- 61 accepted matches also exceed the removed 3,600-second rolling quota.
  for i in 1..61 loop
    result := public.sr_submit('LIMIT_V1_TEST','1234','foundry','rookie',1,1,0,200,true,60,'{}');
    if not (result->>'ok')::boolean then raise exception 'legacy match % rejected: %', i, result; end if;
    result := public.sr_submit_v2('LIMIT_V2_TEST','1234','foundry','rookie',1,1,0,200,true,60,1,'custom','{}');
    if not (result->>'ok')::boolean then raise exception 'custom match % rejected: %', i, result; end if;
  end loop;
  -- Challenge progression still clears every six wins beyond match 25.
  foreach skill in array array['rookie','regular','veteran','elite','nightmare'] loop
    for i in 1..6 loop
      result := public.sr_submit_v2('LIMIT_CH_TEST','1234','foundry',skill,7,3,0,600,true,60,3,'challenge','{}');
      if not (result->>'ok')::boolean or (result->>'challenge_clear')::boolean <> (i=6) then
        raise exception 'Challenge % win % incorrect: %', skill, i, result;
      end if;
    end loop;
  end loop;
  if (result->>'best_tier')::integer <> 5 then raise exception 'Nightmare did not clear'; end if;
  foreach target in array array['LIMIT_V1_TEST','LIMIT_V2_TEST','LIMIT_CH_TEST'] loop
    if (select wins from public.players where handle=target) <>
       (select count(*) from public.matches where handle=target and won) then
      raise exception 'win counters do not reconcile for %', target;
    end if;
  end loop;
  if (select wins from public.players where handle='LIMIT_V1_TEST') <> 61 or
     (select wins from public.players where handle='LIMIT_V2_TEST') <> 61 then
    raise exception '61 wins were not credited';
  end if;
  -- Existing authentication and per-result sanity rules remain enforced.
  result := public.sr_submit('LIMIT_V1_TEST','9999','foundry','rookie',1,1,0,200,true,60,'{}');
  if result->>'error' <> 'BAD_PIN' then raise exception 'legacy auth bypass'; end if;
  result := public.sr_submit_v2('LIMIT_V2_TEST','9999','foundry','rookie',1,1,0,200,true,60,1,'custom','{}');
  if result->>'error' <> 'BAD_PIN' then raise exception 'v2 auth bypass'; end if;
  result := public.sr_submit('LIMIT_V1_TEST','1234','foundry','rookie',1,1,0,200,true,-1,'{}');
  if result->>'error' <> 'BAD_DURATION' then raise exception 'duration validation changed'; end if;
  result := public.sr_submit_v2('LIMIT_CH_TEST','1234','foundry','nightmare',1,1,0,200,true,60,3,'challenge','{}');
  if result->>'ok' is distinct from 'true' or (result->>'qualifying_win')::boolean or result->>'challenge_ineligible_reason' is distinct from 'NOT_STANDARD_CHALLENGE' then raise exception 'Challenge rules changed'; end if;
  if not has_function_privilege('anon','public.sr_submit(text,text,text,text,integer,integer,integer,integer,boolean,integer,jsonb)','execute') or
     not has_function_privilege('anon','public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)','execute') then
    raise exception 'client cannot submit';
  end if;
  raise notice 'PASS: 61 legacy wins, 61 Custom wins, 30 Challenge wins, counters and validation';
end $$;
rollback;
