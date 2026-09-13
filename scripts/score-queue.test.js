'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create,PREFIX}=require('../shared/score-queue.js');
function storage(){
  const data=new Map();
  return {get length(){return data.size;},key:i=>[...data.keys()][i],
    getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};
}
const body={p_arena:'skyport',p_bots:1,p_won:true,p_duration:0};
function setup(extra={}){
  let tick=0,n=0,a={handle:'ALICE',pin:'1234'};
  const s=extra.storage||storage();
  const q=create({storage:s,account:()=>a,now:()=>tick,uuid:()=>String(++n).padStart(4,'0'),
    send:async()=>({ok:true}),...extra});
  return {q,s,time:t=>{tick=t;},account:value=>{a=value;}};
}
test('lost response retries the same immutable ID after reload and removes only after acknowledgement',async()=>{
  const seen=new Set(); let writes=0,calls=0;
  const send=async r=>{
    calls++; if(!seen.has(r.p_match_id)){seen.add(r.p_match_id);writes++;}
    if(calls===1) throw new Error('response lost after commit');
    return {ok:true};
  };
  const {q,s}=setup({send});
  const mutable={...body,p_pin:'secret',p_handle:'OTHER',p_save:{coins:999}};
  q.enqueue(1,mutable);mutable.p_won=false;
  await q.flush();assert.equal(q.status().pending,1);assert.equal(writes,1);
  const saved=[...s.data.values()][0];
  assert.doesNotMatch(saved,/secret|p_pin|p_save|coins|OTHER/);
  assert.equal(JSON.parse(saved).payload.p_won,true);
  const reloaded=setup({storage:s,send}); reloaded.time(60000);
  await reloaded.q.flush();assert.equal(writes,1);assert.equal(calls,2);
  assert.equal(reloaded.q.status().pending,0);assert.equal(s.length,0);
});
test('pending results survive multiple reloads and a missing server migration; no legacy fallback',async()=>{
  const {q,s}=setup({send:async()=>({ok:false,error:'HTTP_404'})});
  q.enqueue(2,body);await q.flush();assert.equal(q.status().pending,1);
  const r=setup({storage:s,send:async()=>({ok:false,error:'HTTP_404'})});r.time(100000);
  await r.q.flush();assert.equal(r.q.status().pending,1);assert.equal(s.length,1);
});
test('two tabs cannot overwrite each other pending matches',async()=>{
  const s=storage(),send=async()=>({ok:false,error:'NO_NETWORK'});
  const a=setup({storage:s,send,uuid:()=> 'a'}),b=setup({storage:s,send,uuid:()=> 'b'});
  a.q.enqueue(1,body);b.q.enqueue(1,body);await Promise.all([a.q.flush(),b.q.flush()]);
  assert.equal(s.length,2);assert.equal(a.q.status().pending,2);
});
test('retry uses only the matching signed-in account; switching during a request never sends remaining results as someone else',async()=>{
  let release;const calls=[];
  const ctx=setup({send:r=>{calls.push(r);return new Promise(resolve=>{release=resolve;});}});
  ctx.q.enqueue(1,body);ctx.q.enqueue(1,body);
  ctx.account({handle:'BOB',pin:'5678'});release({ok:true});await ctx.q.flush();
  assert.equal(calls.length,1);assert.equal(calls[0].p_handle,'ALICE');
  assert.equal(ctx.q.status().pending,0);assert.equal(ctx.s.length,1);
  ctx.account({handle:'ALICE',pin:'9999'});const pending=ctx.q.flush();
  assert.equal(calls[1].p_handle,'ALICE');assert.equal(calls[1].p_pin,'9999');
  release({ok:true});await pending;assert.equal(ctx.s.length,0);
});
test('bad PIN pauses automatic retry instead of repeatedly locking the account',async()=>{
  let calls=0;const ctx=setup({send:async()=>{calls++;return {ok:false,error:'BAD_PIN'};}});
  ctx.q.enqueue(1,body);await ctx.q.flush();ctx.time(100000);
  for(let i=0;i<10;i++) await ctx.q.flush();assert.equal(calls,1);
  ctx.account({handle:'ALICE',pin:'4321'});await ctx.q.flush();assert.equal(calls,2);
});
test('permanent rejection stays visible and does not block the next valid result',async()=>{
  const ctx=setup({send:async r=>r.p_match_id==='0001'?{ok:false,error:'BAD_DURATION'}:{ok:true}});
  ctx.q.enqueue(1,body);await ctx.q.flush();ctx.q.enqueue(1,body);await ctx.q.flush();
  assert.equal(ctx.q.status().failed,1);assert.equal(ctx.q.status().pending,0);
  assert.equal(ctx.q.status().failedError,'BAD_DURATION');assert.equal(ctx.s.length,1);
});
test('unavailable storage retains results in memory and reports that closing the tab would lose them',async()=>{
  const ctx=setup({storage:{get length(){throw Error('blocked');},setItem(){throw Error('full');}},send:async()=>({ok:false,error:'NO_NETWORK'})});
  ctx.q.enqueue(1,body);await ctx.q.flush();assert.equal(ctx.q.status().pending,1);
  assert.equal(ctx.q.status().volatile,true);
});
test('temporary failures back off and keep later matches ordered',async()=>{
  const calls=[];let fail=true;
  const ctx=setup({send:async r=>{calls.push(r.p_match_id);return fail?{ok:false,error:'NO_NETWORK'}:{ok:true};}});
  ctx.q.enqueue(1,body);ctx.q.enqueue(1,body);await ctx.q.flush();
  await ctx.q.flush();assert.deepEqual(calls,['0001']);
  ctx.time(5000);fail=false;await ctx.q.flush();
  assert.deepEqual(calls,['0001','0001','0002']);assert.equal(ctx.s.length,0);
});
test('short completed frontend results enter the queue without a cloud save or a PIN',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const start=source.indexOf('function cloudSubmit('),end=source.indexOf('\nconst HEAD_MULT',start);
  const calls=[],context={ACC:{handle:'ALICE'},S:{cfg:{skill:'rookie',bots:1}},NET:{on:()=>true},
    SCORES:{enqueue:(version,result)=>calls.push({version,result})},renderScoreStatus:()=>{}};
  vm.runInNewContext(source.slice(start,end),context);
  context.cloudSubmit({kills:0,hs:0,dmg:0,win:true},'skyport',0.2,{skill:'rookie',bots:1,time:6,mode:'custom'});
  assert.equal(calls.length,1);assert.equal(calls[0].result.p_duration,0);
  assert.equal(calls[0].result.p_won,true);assert.equal(calls[0].result.p_save,undefined);
});

test('accepted lifetime wins retain the reason Challenge did not advance',async()=>{
  const {q}=setup({send:async()=>({ok:true,challenge_ineligible_reason:'BAD_CHALLENGE_TIER'})});
  q.enqueue(2,body);await q.flush();
  assert.equal(q.status().pending,0);assert.equal(q.status().failed,0);
  assert.equal(q.status().last.challengeReason,'BAD_CHALLENGE_TIER');
});
