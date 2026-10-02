-- Read-only production verification after the candidate migration.
select to_regprocedure('public.sr_board_v3(text,integer,text)') is not null as board_installed,
       to_regprocedure('public.sr_recent_v3(text,integer,text)') is not null as recent_installed,
       to_regprocedure('public.sr_account_stats(text,text)') is not null as stats_installed;

select p.proname as function_name,
       pg_get_functiondef(p.oid) not like '%TOO_FAST%' as no_hourly_cap,
       pg_get_functiondef(p.oid) not like '%TOO_SHORT%' as no_minimum_duration,
       pg_get_functiondef(p.oid) not like '%b * 400 + 500%' as no_damage_clip,
       pg_get_functiondef(p.oid) not like '%k * 3 + 20%' as no_headshot_clip
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('sr_submit','sr_submit_v2');

select not exists (
  select 1 from public.sr_recent_v2('ralston',40,'season-1') r
  join public.players p on p.handle=r.handle where p.club is distinct from 'ralston'
) as cached_feed_club_scope;

select * from public.sr_board_v3('ralston',100,'season-1');
select * from public.sr_recent_v3('ralston',20,'season-1');
