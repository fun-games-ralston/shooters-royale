-- Patch an already-installed v2 endpoint without installing seasonal features.
-- Preserve its live body, signature, owner, ACL, and all non-quota validation.
-- No player or match data is updated by this migration.
do $patch$
declare
  fn oid;
  definition text;
  quota text := $quota$  select count(*), coalesce(sum(m.duration_s), 0) into recent, spent
    from public.matches m
   where m.handle = h and m.played_at > now() - interval '1 hour';
  if recent >= 25 or spent + dur > 3600 then
    return jsonb_build_object('ok', false, 'error', 'TOO_FAST');
  end if;$quota$;
begin
  fn := to_regprocedure('public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)');
  if fn is null then return; end if;
  definition := pg_get_functiondef(fn);
  if position('TOO_FAST' in definition) = 0 then return; end if;
  if position(quota in definition) = 0 then
    raise exception 'Unexpected sr_submit_v2 quota definition; inspect before updating';
  end if;
  definition := replace(definition, quota, '  -- No rolling hourly scoring quotas.');
  if position('TOO_FAST' in definition) > 0 then
    raise exception 'Unexpected additional sr_submit_v2 quota; no update applied';
  end if;
  execute definition;
end $patch$;
