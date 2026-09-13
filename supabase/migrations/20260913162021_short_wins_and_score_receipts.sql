-- Existing player totals and saves are not rewritten or backfilled.
begin;

-- Keep live v1/v2 rules and ACLs; replace only the short-match rejection.
do $patch$
declare
  fn record;
  definition text;
  old_rule text := $old$if dur < 5 then
    return jsonb_build_object('ok', false, 'error', 'TOO_SHORT');
  end if;$old$;
begin
  for fn in select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('sr_submit','sr_submit_v2')
  loop
    definition := pg_get_functiondef(fn.oid);
    if position('TOO_FAST' in definition)>0 then
      raise exception 'Apply the hourly quota migration first: %', fn.proname;
    end if;
    if position('TOO_SHORT' in definition)>0 then
      if position(old_rule in definition)=0 then
        raise exception 'Unexpected short-match rule in %; inspect before updating', fn.proname;
      end if;
      definition := replace(definition, old_rule, $new$if p_duration is null or p_duration < 0 then
    return jsonb_build_object('ok', false, 'error', 'BAD_DURATION');
  end if;$new$);
      execute definition;
    end if;
  end loop;
end $patch$;

-- Receipts are private, immutable through the client API and retained for
-- safe retries even after a browser has been closed for a long time.
create table if not exists public.score_receipts (
  handle text not null references public.players(handle) on delete cascade,
  match_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (handle, match_id)
);
alter table public.score_receipts enable row level security;
revoke all on public.score_receipts from public, anon, authenticated;

create or replace function public.sr_submit_once(
  p_handle text, p_pin text, p_match_id uuid, p_version integer, p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st text;
  h text;
  request_body jsonb;
  receipt public.score_receipts;
  result jsonb;
begin
  st := public.sr_auth(p_handle,p_pin);
  if st <> 'OK' then return jsonb_build_object('ok',false,'error',st); end if;
  h := public.sr_clean_handle(p_handle);
  if p_match_id is null or p_version is null or p_version not in (1,2)
     or jsonb_typeof(p_result) is distinct from 'object' then
    return jsonb_build_object('ok',false,'error','BAD_RESULT');
  end if;
  -- Never queue or replay a cloud save: an old result must not overwrite a
  -- newer inventory or Stats save. sr_save remains responsible for saves.
  request_body := jsonb_build_object('version',p_version,'result',p_result - 'p_save');
  -- One fighter's receipt check and scoring run under the same row lock.
  -- Concurrent tabs therefore cannot both score the same match ID.
  perform 1 from public.players where handle=h for update;
  select * into receipt from public.score_receipts where handle=h and match_id=p_match_id;
  if found then
    if receipt.request <> request_body then
      return jsonb_build_object('ok',false,'error','MATCH_ID_CONFLICT');
    end if;
    return receipt.response;
  end if;
  if p_version=1 then
    result := public.sr_submit(h,p_pin,
      p_result->>'p_arena',p_result->>'p_skill',(p_result->>'p_bots')::integer,
      (p_result->>'p_kills')::integer,(p_result->>'p_headshots')::integer,
      (p_result->>'p_damage')::integer,(p_result->>'p_won')::boolean,
      (p_result->>'p_duration')::integer,'{}'::jsonb);
  else
    if to_regprocedure('public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)') is null then
      return jsonb_build_object('ok',false,'error','SERVER_UPGRADE_REQUIRED');
    end if;
    result := public.sr_submit_v2(h,p_pin,
      p_result->>'p_arena',p_result->>'p_skill',(p_result->>'p_bots')::integer,
      (p_result->>'p_kills')::integer,(p_result->>'p_headshots')::integer,
      (p_result->>'p_damage')::integer,(p_result->>'p_won')::boolean,
      (p_result->>'p_duration')::integer,(p_result->>'p_time_limit')::integer,
      p_result->>'p_mode','{}'::jsonb);
  end if;
  -- Temporary failures are not receipts. Rejected completed results are kept
  -- too, so a later retry cannot reinterpret the original result.
  if result->>'error' in ('NO_ACTIVE_SEASON') then return result; end if;
  insert into public.score_receipts(handle,match_id,request,response)
  values(h,p_match_id,request_body,result);
  return result;
end $$;
revoke all on function public.sr_submit_once(text,text,uuid,integer,jsonb) from public;
grant execute on function public.sr_submit_once(text,text,uuid,integer,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
