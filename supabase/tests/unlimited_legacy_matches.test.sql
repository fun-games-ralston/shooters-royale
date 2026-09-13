\set ON_ERROR_STOP on
begin;
do $$
declare result jsonb; i integer;
begin
  if exists(select 1 from public.players where handle='LIMIT_V1_TEST') then
    raise exception 'test handle already exists';
  end if;
  perform public.sr_register('LIMIT_V1_TEST','1234','test');
  for i in 1..61 loop
    result := public.sr_submit('LIMIT_V1_TEST','1234','foundry','rookie',1,1,0,200,true,60,'{"marker":"preserve-save"}');
    if not (result->>'ok')::boolean then raise exception 'match % rejected: %', i, result; end if;
  end loop;
  if (select wins from public.players where handle='LIMIT_V1_TEST') <> 61 or
     (select count(*) from public.matches where handle='LIMIT_V1_TEST' and won) <> 61 then
    raise exception 'all 61 wins must count';
  end if;
  if (select save->>'marker' from public.players where handle='LIMIT_V1_TEST') <> 'preserve-save' then
    raise exception 'cloud save not preserved';
  end if;
  result := public.sr_submit('LIMIT_V1_TEST','9999','foundry','rookie',1,1,0,200,true,60,'{}');
  if result->>'error' <> 'BAD_PIN' then raise exception 'auth check changed'; end if;
  result := public.sr_submit('LIMIT_V1_TEST','1234','foundry','rookie',1,1,0,200,true,-1,'{}');
  if result->>'error' <> 'BAD_DURATION' then raise exception 'duration check changed'; end if;
  result := public.sr_submit('LIMIT_V1_TEST','1234','foundry','rookie',1,999,999,999999,true,10,'{}');
  if (select max(kills) from public.matches where handle='LIMIT_V1_TEST') <> 1 then
    raise exception 'impossible kills no longer clipped';
  end if;
  if not has_function_privilege('anon','public.sr_submit(text,text,text,text,integer,integer,integer,integer,boolean,integer,jsonb)','execute') then
    raise exception 'client submit permission lost';
  end if;
  raise notice 'PASS: 61 wins beyond both hourly quotas, saves, authentication and per-result validation';
end $$;
rollback;
