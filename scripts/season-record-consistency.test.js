'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function fn(name){
 const at=source.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.notEqual(at,-1);return source.slice(at,source.indexOf('\n}',at)+2);
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function briefingContext({queuePending=0,progress,board}={}){
 const elements=new Map(), timers=[];
 const context={ACC:{handle:'FIGHTER',pin:'1234'},S:{cfg:{mode:'custom'},challenge:{bestTier:4,tierWins:5}},NET:{on:()=>true},
  ARENAS:[{id:'foundry'}],AR:{foundry:{name:'Foundry'}},challengeArena:'foundry',challengeBriefToken:0,challengeBriefTimer:null,
  challengeBriefDeadline:0,CHALLENGE_BRIEF_MS:6000,now:0,started:[],pendingPlayMode:null,accMode:null,guestCustomAllowed:false,
  Date:{now:()=>context.now},clearInterval(){},setInterval:tick=>{timers.push(tick);return timers.length},
  $:id=>{if(!elements.has(id)) elements.set(id,{style:{},classList:{add(){},remove(){}},textContent:''});return elements.get(id);},
  show(){},saveState(){},challengeBriefSeason:()=> 'Season 1',nextChallengeArena:()=> 'foundry',updateChallengeStanding(){},
  SCORES:{flush:()=>Promise.resolve(),status:()=>({pending:queuePending,failed:0})},loadSeasonStatus:()=>Promise.resolve(),
  seasonBoard:()=>board||Promise.resolve({ok:true,rows:[]}),seasonProgress:()=>progress||Promise.resolve({ok:true,best_tier:0,tier_wins:2}),
  reconcileChallengeProgress:r=>{context.S.challenge={bestTier:r.best_tier,tierWins:r.tier_wins};return true;},
  startMatch:()=>context.started.push(context.S.challenge.bestTier+1)};
 vm.runInNewContext(['requestPlaySignIn','cancelChallengeBriefing','challengeBriefFailure','deployChallengeBrief','showChallengeBriefing'].map(fn).join('\n'),context);
 return {context,elements,timers};
}
test('slow standings never delay progress or start a match at a stale saved tier',async()=>{
 const delayedBoard=deferred(), delayedProgress=deferred();
 const {context,timers}=briefingContext({board:delayedBoard.promise,progress:delayedProgress.promise});
 const loading=context.showChallengeBriefing();
 await new Promise(setImmediate);
 context.now=7000;
 assert.equal(timers.length,0,'countdown cannot start while progress is unresolved');
 assert.deepEqual(context.started,[]);
 delayedProgress.resolve({ok:true,best_tier:0,tier_wins:2});await loading;
 assert.equal(timers.length,1,'standings must not hold up a valid Challenge');
 context.now+=6001;timers[0]();
 assert.deepEqual(context.started,[1]);
 delayedBoard.resolve({ok:true,rows:[]});
});
test('pending results and unavailable progress give an explicit retry without starting a wrong-tier game',async()=>{
 for(const options of [{queuePending:1},{progress:Promise.resolve({ok:false,error:'NO_NETWORK'})}]){
  const {context,timers,elements}=briefingContext(options);await context.showChallengeBriefing();
  assert.equal(timers.length,0);assert.deepEqual(context.started,[]);
  assert.match(elements.get('#briefCount').textContent,/TRY AGAIN/);
 }
});
test('leaving or switching fighter during progress load cannot deploy the earlier fighter',async()=>{
 for(const cancel of [c=>c.cancelChallengeBriefing(),c=>{c.ACC={handle:'OTHER'};}]){
  const progress=deferred(),{context,timers}=briefingContext({progress:progress.promise});
  const loading=context.showChallengeBriefing();await new Promise(setImmediate);cancel(context);
  progress.resolve({ok:true,best_tier:0,tier_wins:0});await loading;
  assert.equal(timers.length,0);assert.deepEqual(context.started,[]);
 }
});
test('Challenge requires a signed-in fighter; Custom offers guest play; Training remains separate',()=>{
 const {context,timers}=briefingContext();context.ACC=null;
 assert.equal(context.requestPlaySignIn('challenge'),true);assert.equal(context.pendingPlayMode,'challenge');
 context.guestCustomAllowed=true;
 assert.equal(context.requestPlaySignIn('custom'),false);
 assert.equal(context.requestPlaySignIn('challenge'),true,'guest choice cannot bypass Challenge sign-in');
 assert.equal(timers.length,0);
 assert.match(fn('showCustomBriefing'),/normalizeMode\(S.cfg.mode\)==='custom'/);
 assert.match(fn('renderAccount'),/Play Custom as guest/);
});
test('shuffled Challenge rotation visits every map before repeating and never uses Custom settings',()=>{
 const context={ARENAS:['foundry','grid','skyport','ghosttown'].map(id=>({id})),challengeMapBag:[],lastChallengeArena:null,
  challengeArena:'skyport',Math,clamp:(v,a,b)=>Math.max(a,Math.min(v,b)),challengeTargetSkill:()=> 'regular',
  CHALLENGE_RULES:{bots:7,time:3},S:{cfg:{mode:'custom',arena:'grid',bots:1,time:6,skill:'nightmare',hunted:true}}};
 vm.runInNewContext(['nextChallengeArena','normalizeMode','matchRules'].map(fn).join('\n'),context);
 let previous;
 for(let cycle=0;cycle<30;cycle++){
  const maps=[];
  for(let i=0;i<4;i++){
   const peek=context.nextChallengeArena(false);assert.equal(context.nextChallengeArena(false),peek);
   const current=context.nextChallengeArena(true);assert.equal(current,peek);assert.notEqual(current,previous);previous=current;maps.push(current);
  }
  assert.equal(new Set(maps).size,4);
 }
 const custom=context.matchRules(context.S.cfg),saved=JSON.stringify(context.S.cfg);
 const challenge=context.matchRules({...context.S.cfg,mode:'challenge'});
 assert.deepEqual(JSON.parse(JSON.stringify(custom)),{mode:'custom',arena:'grid',skill:'nightmare',bots:1,time:6,hunted:true});
 assert.deepEqual(JSON.parse(JSON.stringify(challenge)),{mode:'challenge',arena:'skyport',skill:'regular',bots:7,time:3,hunted:false});
 assert.equal(JSON.stringify(context.S.cfg),saved);
});
test('recorded Stats responses cannot overwrite a newly selected fighter',async()=>{
 const response=deferred(), context={ACC:{handle:'FIRST'},ACCOUNT_STATS:null,statsRequestToken:0,statsAuthBlocked:null,NET:{on:()=>true,call:()=>response.promise},renderPlayerCard(){throw Error('stale render');}};
 vm.runInNewContext(fn('refreshAccountStats'),context);
 const loading=context.refreshAccountStats();context.ACC={handle:'SECOND'};
 response.resolve({ok:true,handle:'FIRST',wins:400});await loading;
 assert.equal(context.ACCOUNT_STATS,null);
});
test('board labels, match timestamps and new read endpoints share the same meaning',()=>{
 assert.match(fn('renderBoard'),/CURRENT TIER/);assert.match(fn('renderBoard'),/r.season_wins/);
 assert.match(fn('renderBoard'),/RECENT CHALLENGES/);assert.match(fn('renderBoard'),/matchTimestamp\(m.played_at\)/);
 assert.match(fn('seasonBoard'),/sr_board_v3/);assert.match(fn('seasonRecent'),/sr_recent_v3/);
 assert.doesNotMatch(fn('seasonBoard'),/sr_board_v2|sr_board'/);
});
test('out-of-order lifetime Stats replies cannot move the same fighter backward',async()=>{
 const first=deferred(),second=deferred();let calls=0;
 const context={ACC:{handle:'SAME'},ACCOUNT_STATS:null,statsRequestToken:0,statsAuthBlocked:null,NET:{on:()=>true,call:()=>++calls===1?first.promise:second.promise},renderPlayerCard(){}};
 vm.runInNewContext(fn('refreshAccountStats'),context);
 const older=context.refreshAccountStats(),newer=context.refreshAccountStats();
 second.resolve({ok:true,wins:10});await newer;
 first.resolve({ok:true,wins:9});await older;
 assert.equal(context.ACCOUNT_STATS.wins,10);
});

test('Stats polling stops after an authentication failure until sign-in is renewed',async()=>{
 let calls=0;const context={ACC:{handle:'LOCKED'},ACCOUNT_STATS:null,statsRequestToken:0,statsAuthBlocked:null,
  NET:{on:()=>true,call:async()=>{calls++;return {ok:false,error:'BAD_PIN'};}},renderPlayerCard(){}};
 vm.runInNewContext(fn('refreshAccountStats'),context);
 await context.refreshAccountStats();await context.refreshAccountStats();
 assert.equal(calls,1);
 context.ACC={handle:'LOCKED'};context.statsAuthBlocked=null;
 await context.refreshAccountStats();assert.equal(calls,2);
});
