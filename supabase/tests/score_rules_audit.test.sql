\set ON_ERROR_STOP on
begin;
do $$
declare r jsonb; s text; b integer; d integer; expected integer := 0; body jsonb;
begin
  if exists(select 1 from public.players where handle='RULE_AUDIT') then raise exception 'fixture exists'; end if;
  perform public.sr_register('RULE_AUDIT','1234','test');
  -- Exercise the unchanged legacy RPC still used by already-open main tabs.
  foreach s in array array['rookie','regular','veteran','elite','nightmare','mixed'] loop
    foreach b in array array[1,11] loop
      foreach d in array array[0,2000] loop
        r := public.sr_submit('RULE_AUDIT','1234','skyport',s,b,0,0,0,true,d,'{}');
        expected := expected+1;
        if r->>'ok' is distinct from 'true' or (r->>'wins')::integer <> expected then
          raise exception 'legacy hidden win gate: skill %, bots %, duration %, response %',s,b,d,r;
        end if;
      end loop;
    end loop;
  end loop;
  if to_regprocedure('public.sr_submit_v2(text,text,text,text,integer,integer,integer,integer,boolean,integer,integer,text,jsonb)') is not null then
    body := '{"p_arena":"skyport","p_skill":"nightmare","p_bots":7,"p_kills":7,"p_headshots":0,"p_damage":700,"p_won":true,"p_duration":0,"p_time_limit":3,"p_mode":"challenge"}';
    -- Use a fresh fighter so Preseason legacy eligibility cannot affect the tier.
    perform public.sr_register('RULE_CHALLENGE','1234','test');
    r := public.sr_submit_once('RULE_CHALLENGE','1234',md5('wrong-tier')::uuid,2,body);
    if r->>'ok' is distinct from 'true' or (r->>'wins')::integer <> 1 or
       (r->>'challenge_clear')::boolean or r->>'challenge_ineligible_reason' is distinct from 'BAD_CHALLENGE_TIER' then
      raise exception 'tier mismatch discarded lifetime win or advanced Challenge: %',r;
    end if;
    r := public.sr_submit_once('RULE_CHALLENGE','1234',md5('wrong-rules')::uuid,2,body||'{"p_skill":"rookie","p_bots":1,"p_kills":1}');
    if r->>'ok' is distinct from 'true' or (r->>'wins')::integer <> 2 or
       (r->>'challenge_clear')::boolean or r->>'challenge_ineligible_reason' is distinct from 'NOT_STANDARD_CHALLENGE' then
      raise exception 'nonstandard match discarded lifetime win or advanced Challenge: %',r;
    end if;
    -- Rollback-only simulation of a calendar gap.
    update public.seasons set starts_at=starts_at+interval '1000 years',ends_at=ends_at+interval '1000 years';
    r := public.sr_submit_once('RULE_CHALLENGE','1234',md5('no-season')::uuid,2,body||'{"p_skill":"rookie"}');
    if r->>'ok' is distinct from 'true' or (r->>'wins')::integer <> 3 or
       (r->>'challenge_clear')::boolean or r->>'challenge_ineligible_reason' is distinct from 'NO_ACTIVE_SEASON' then
      raise exception 'season gap discarded lifetime win or advanced Challenge: %',r;
    end if;
    if exists(select 1 from public.matches where handle='RULE_CHALLENGE' and ranked_eligible) then
      raise exception 'ineligible match entered seasonal ranking';
    end if;
  end if;
  raise notice 'PASS: legacy zero-kill wins at every skill, lobby endpoints and duration extremes; Challenge ineligibility preserves lifetime totals';
end $$;
rollback;
