\set ON_ERROR_STOP on
begin;
do $$
declare
  v integer; i integer; h text; id uuid; body jsonb; r jsonb; replay jsonb;
  versions integer := case when to_regprocedure('public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)') is null then 1 else 2 end;
begin
  for v in 1..versions loop
    h := 'RECEIPT_TEST_'||v;
    if exists(select 1 from public.players where handle=h) then raise exception 'fixture exists'; end if;
    r := public.sr_register(h,'1234','test');
    if r->>'ok' is distinct from 'true' then raise exception 'registration failed %',r; end if;
    perform public.sr_save(h,'1234','{"marker":"newer-inventory"}');
    for i in 0..61 loop
      id := md5(v::text||':'||i::text)::uuid;
      body := jsonb_build_object('p_arena','skyport','p_skill','rookie','p_bots',1,
        'p_kills',0,'p_headshots',0,'p_damage',0,'p_won',true,'p_duration',i%5,
        'p_time_limit',6,'p_mode','custom','p_save',jsonb_build_object('marker','stale-save'));
      r := public.sr_submit_once(h,'1234',id,v,body);
      if r->>'ok' is distinct from 'true' then raise exception 'short win % v% failed %',i,v,r; end if;
      replay := public.sr_submit_once(h,'1234',id,v,body);
      if replay is distinct from r then raise exception 'retry changed response'; end if;
      if not exists(select 1 from public.sr_board('test',100) b where b.handle=h and b.wins=i+1) then
        raise exception 'board did not increase exactly once';
      end if;
    end loop;
    if (select count(*) from public.matches m where m.handle=h) <> 62 or
       (select count(*) from public.score_receipts s where s.handle=h) <> 62 then
      raise exception 'receipt or match total incorrect';
    end if;
    if (select save->>'marker' from public.players p where p.handle=h) is distinct from 'newer-inventory' then
      raise exception 'queued result overwrote newer save';
    end if;
    r := public.sr_submit_once(h,'9999',id,v,body);
    if r->>'error' is distinct from 'BAD_PIN' then raise exception 'receipt replay bypassed auth'; end if;
    r := public.sr_submit_once(h,'1234',id,v,body||'{"p_won":false}');
    if r->>'error' is distinct from 'MATCH_ID_CONFLICT' then raise exception 'changed payload reused ID'; end if;
    r := public.sr_submit_once(h,'1234',md5(h||'bad')::uuid,v,body||'{"p_duration":-1}');
    if r->>'error' is distinct from 'BAD_DURATION' then raise exception 'negative duration accepted'; end if;
    replay := public.sr_submit_once(h,'1234',md5(h||'bad')::uuid,v,body||'{"p_duration":-1}');
    if replay is distinct from r then raise exception 'rejection was not stable'; end if;
    r := public.sr_submit_once(h,'1234',md5(h||'loss')::uuid,v,body||'{"p_won":false}');
    if r->>'ok' is distinct from 'true' then raise exception 'short loss rejected'; end if;
    if not exists(select 1 from public.sr_board('test',100) b where b.handle=h and b.wins=62 and b.matches=63) then
      raise exception 'loss or failed result inflated wins';
    end if;
  end loop;
  if has_table_privilege('anon','public.score_receipts','select') or
     has_table_privilege('authenticated','public.score_receipts','insert') then
    raise exception 'private receipts exposed';
  end if;
  if not has_function_privilege('anon','public.sr_submit_once(text,text,uuid,integer,jsonb)','execute') then
    raise exception 'client cannot submit';
  end if;
  raise notice 'PASS: zero-to-four-second wins, 62 distinct IDs per endpoint, duplicate replies, board totals, auth, rejection receipts, loss counts, saves and ACLs';
end $$;
rollback;
