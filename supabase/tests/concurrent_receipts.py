"""Eight real PostgreSQL sessions retry one receipt, followed by rollback/retry."""
import concurrent.futures,json,os,subprocess
cmd=[os.environ['SCORE_TEST_PSQL'],'-X','-h',os.environ['SCORE_TEST_SOCKET'],'-p',os.environ['SCORE_TEST_PORT'],'-d','postgres','-v','ON_ERROR_STOP=1','-At']
def query(sql):
 result=subprocess.run(cmd+['-c',sql],capture_output=True,text=True,check=True)
 return result.stdout.strip().splitlines()[-1]
query("select sr_register('CONCUR_TEST','1234','test');")
payload=json.dumps(dict(p_arena='foundry',p_skill='rookie',p_bots=7,p_kills=3,p_headshots=1,p_damage=900,p_won=True,p_duration=0,p_time_limit=3,p_mode='challenge'))
call=f"select sr_submit_once('CONCUR_TEST','1234',md5('concurrent')::uuid,2,'{payload}'::jsonb);"
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
 replies=list(executor.map(query,[call]*8))
assert len(set(replies))==1 and json.loads(replies[0])['ok'],replies
counts=json.loads(query("select json_build_array((select matches from players where handle='CONCUR_TEST'),(select wins from players where handle='CONCUR_TEST'),(select count(*) from matches where handle='CONCUR_TEST'),(select count(*) from score_receipts where handle='CONCUR_TEST'));"))
assert counts==[1,1,1,1],counts
# A response from an explicitly rolled-back transaction cannot leave a receipt
# that makes the eventual retry appear acknowledged without scoring.
rollback_call=call.replace("md5('concurrent')","md5('rollback')")
query('begin; '+rollback_call+' rollback; select 1;')
assert query("select count(*) from score_receipts where handle='CONCUR_TEST';")=='1'
query(rollback_call)
assert query("select matches from players where handle='CONCUR_TEST';")=='2'
assert query("select count(*) from score_receipts where handle='CONCUR_TEST';")=='2'
print('PASS: eight concurrent replies, one match/win/receipt, rollback followed by exactly one retry')
