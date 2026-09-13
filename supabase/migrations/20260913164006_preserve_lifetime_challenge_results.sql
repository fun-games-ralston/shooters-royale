-- Lifetime result credit is independent of seasonal Challenge eligibility.
-- This changes no existing player totals, saves, matches or receipts.
begin;
do $patch$
declare
  fn oid := to_regprocedure('public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)');
  definition text;
  old_rule text;
  guard text := ' and p_bots = 7 and p_time_limit = 3 and season_name is not null and public.sr_tier_rank(p_skill) = required_tier';
begin
  if fn is null then return; end if; -- Legacy-only installations need no seasonal change.
  definition := pg_get_functiondef(fn);
  if position('challenge_ineligible_reason' in definition)>0 then return; end if;
  if position('TOO_FAST' in definition)>0 or position('TOO_SHORT' in definition)>0 then
    raise exception 'Apply hourly and short-match fixes before lifetime Challenge fix';
  end if;
  foreach old_rule in array array[
$old$  if mode_name = 'challenge' and (p_bots <> 7 or p_time_limit <> 3) then
    return jsonb_build_object('ok', false, 'error', 'NOT_STANDARD_CHALLENGE');
  end if;$old$,
$old$  if mode_name = 'challenge' and season_name is null then
    return jsonb_build_object('ok', false, 'error', 'NO_ACTIVE_SEASON');
  end if;$old$,
$old$    if public.sr_tier_rank(p_skill) <> required_tier then
      return jsonb_build_object(
        'ok', false, 'error', 'BAD_CHALLENGE_TIER',
        'required_skill', lower(public.sr_tier_name(required_tier))
      );
    end if;$old$
  ] loop
    if position(old_rule in definition)=0 then raise exception 'Unexpected Challenge rejection rule; inspect before updating'; end if;
    definition := replace(definition,old_rule,'');
  end loop;
  if position('qualifies := coalesce(p_won,false) and k >= required_kills;' in definition)>0 then
    definition := replace(definition,
      'qualifies := coalesce(p_won,false) and k >= required_kills;',
      'qualifies := coalesce(p_won,false) and k >= required_kills' || guard || ';');
  elsif position('and k >= 3' in definition)>0 then
    definition := replace(definition,'and k >= 3','and k >= 3' || guard);
  else
    raise exception 'Unexpected Challenge qualification rule; inspect before updating';
  end if;
  if position($old$'season', season_name,$old$ in definition)=0 then raise exception 'Unexpected result response'; end if;
  definition := replace(definition,$old$'season', season_name,$old$,$new$'season', season_name,
    'challenge_ineligible_reason', case
      when mode_name <> 'challenge' or not coalesce(p_won,false) or qualifies then null
      when season_name is null then 'NO_ACTIVE_SEASON'
      when p_bots <> 7 or p_time_limit <> 3 then 'NOT_STANDARD_CHALLENGE'
      when public.sr_tier_rank(p_skill) <> required_tier then 'BAD_CHALLENGE_TIER'
      else 'ELIMINATION_TARGET'
    end,$new$);
  execute definition;
end $patch$;
notify pgrst, 'reload schema';
commit;
