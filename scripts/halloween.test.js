'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const World=require('../shared/world.js');
const Halloween=require('../shared/halloween.js');
const Content=require('../shared/pve-content.generated.js');
const Sim=require('../pvp-real/sim.js');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const {extractLiteral}=require('./sync-pve-content.js');
function fn(name){
  const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+10);
  assert.ok(start>=0);return source.slice(start,end);
}

test('all twelve Halloween spawns are clear and connected by walkable ground',()=>{
  const world=World.makeWorld('ghosttown');
  assert.equal(world.spawns.length,12);
  assert.equal(world.duelSpawns.length,2);
  assert.equal(world.hazards.length,0);
  for(const s of world.spawns)assert.ok(World.freeAt(world,s.x,s.y+.02,s.z),JSON.stringify(s));
  // Ground-only flood fill catches blocked lanes and sealed-in spawn pockets.
  const seen=new Set(),queue=[[world.spawns[0].x,world.spawns[0].z]];
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i],key=x+','+z;if(seen.has(key))continue;seen.add(key);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,nz=z+dz;
      if(Math.abs(nx)<39&&Math.abs(nz)<39&&!seen.has(nx+','+nz)&&World.freeAt(world,nx,.08,nz))queue.push([nx,nz]);
    }
  }
  for(const s of world.spawns)assert.ok(seen.has(s.x+','+s.z),'isolated spawn '+JSON.stringify(s));
  for(const [x,z] of [[-17,0],[17,-4],[0,-13],[0,13]])assert.ok(seen.has(x+','+z),'inaccessible landmark route');
});

test('Halloween solo and Friends use identical collision and spawn geometry',()=>{
  class Group{add(){}}
  const context={THREE:{Group},BlockRoyaleHalloween:{build:Halloween.build,atmosphere:()=>({step(){}})},
    boxMesh:()=>({position:{set(){}}}),mulberry32:()=>()=>0,groundAt:World.groundAt,
    def:Content.ARENAS.find(a=>a.id==='ghosttown'),result:null};
  vm.runInNewContext(fn('makeWorld')+'\nresult=makeWorld(def);',context);
  const solo=JSON.parse(JSON.stringify({boxes:context.result.boxes,spawns:context.result.spawns}));
  const friends=World.makeWorld('ghosttown');
  assert.deepEqual(solo.boxes,friends.boxes);assert.deepEqual(solo.spawns,friends.spawns);
  assert.ok(friends.visuals.some(v=>v.emissive>0&&!v.solid),'glowing scenery must stay out of collision');
});

test('fighters can climb all four haunted-house rooftops without jumping',()=>{
  for(const [x,z,dir] of [[-24,-24,-1],[24,-24,1],[-24,24,-1],[24,24,1]]){
    const a=new Sim.Authority({world:Sim.makeArenaWorld('ghosttown'),startTimeMs:1000});
    const p=a.addPlayer('host',{x:x-dir*13,y:0,z});a.addPlayer('guest');a.startRound();
    for(let i=0;i<80;i++){
      a.receiveInput('host',{seq:i+1,moveF:1,yaw:-dir*Math.PI/2,weapon:'sidearm',trigger:false},a.serverTimeMs);
      a.step(34,a.serverTimeMs+34);
    }
    assert.ok(Math.abs(p.y-4.55)<.01,'inaccessible rooftop '+[x,z]);
    assert.ok(World.freeAt(a.world,p.x,p.y+.02,p.z),'fighter stuck inside rooftop');
  }
});

test('returning saves receive the free map without charging coins or replacing progress',()=>{
  const defaults=vm.runInNewContext('('+extractLiteral(source,'DEFAULT_STATE')+')');
  const context={DEFAULT_STATE:defaults,ARENAS:Content.ARENAS,W:{knife:{melee:true},sidearm:{}},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),normalizeMode:v=>v,S:null,result:null,
    save:{coins:912,own:{arena:['foundry','skyport'],weapons:['knife','sidearm']},cfg:{arena:'skyport'},stats:{wins:758,matches:900}}};
  vm.runInNewContext(fn('adoptSave')+'\nresult=adoptSave(save);',context);
  assert.equal(context.result,true);assert.equal(context.S.coins,912);assert.equal(context.S.stats.wins,758);
  assert.equal(context.S.cfg.arena,'skyport');
  assert.deepEqual(Array.from(context.S.own.arena),['foundry','skyport','ghosttown']);
  assert.deepEqual(context.save.own.arena,['foundry','skyport'],'do not mutate the supplied cloud save');
  vm.runInNewContext('adoptSave(S);',context);
  assert.equal(context.S.own.arena.filter(id=>id==='ghosttown').length,1);
});

const hauntConfig=Content.ARENAS.find(a=>a.id==='ghosttown').haunt;
function hauntFighter(id='fighter',x=-11,y=0,z=-13){return {id,x,y,z,alive:true};}
function advanceHaunt(state,seconds,fighters){
  const events=[];for(let i=0;i<Math.round(seconds/.05);i++)events.push(...Halloween.stepHaunt(state,.05,fighters));return events;
}

test('ghosts warn, recoil after contact, and return before fading on the third hit',()=>{
  const state=Halloween.createHaunt(hauntConfig),p=hauntFighter();
  assert.deepEqual(advanceHaunt(state,4.9,[p]),[]);
  const warning=advanceHaunt(state,.2,[p]);assert.equal(warning.length,1);assert.equal(warning[0].type,'ghost_warning');
  assert.equal(state.ghosts[0].phase,'warning');
  assert.equal(advanceHaunt(state,1.1,[p]).filter(e=>e.type==='ghost_hit').length,0);
  const hits=advanceHaunt(state,.3,[p]).filter(e=>e.type==='ghost_hit');
  assert.equal(hits.length,1);assert.equal(hits[0].damage,12);
  const g=state.ghosts[0];assert.equal(g.phase,'warning');assert.equal(g.targetId,p.id);
  assert.ok(Math.hypot(g.x-p.x,g.z-p.z)>hauntConfig.radius,'recoil opens space to escape');
  assert.equal(advanceHaunt(state,1.8,[p]).filter(e=>e.type==='ghost_hit').length,0,'recovery cannot deal another contact hit');
  const deadline=g.huntUntil,again=advanceHaunt(state,5,[p]);
  assert.equal(again.filter(e=>e.type==='ghost_hit').length,2);
  assert.ok(again.some(e=>e.type==='ghost_warning'&&e.repeat));
  assert.equal(g.hits,3);assert.equal(g.phase,'rest');assert.equal(g.huntUntil,deadline,'repeat strikes never reset the hunt timer');
  assert.equal(advanceHaunt(state,1,[p]).filter(e=>e.type==='ghost_hit').length,0);
});

test('running fighters escape, ghosts time out, and a new target gets a fresh warning',()=>{
  const state=Halloween.createHaunt(hauntConfig),p=hauntFighter();advanceHaunt(state,6.4,[p]);
  const events=[];
  for(let i=0;i<60;i++){p.x+=6*.05;events.push(...Halloween.stepHaunt(state,.05,[p]));}
  assert.equal(events.filter(e=>e.type==='ghost_hit').length,0);
  p.alive=false;advanceHaunt(state,.05,[p]);assert.equal(state.ghosts[0].phase,'rest');
  assert.ok(state.ghosts.every(g=>g.targetId===null));
  advanceHaunt(state,5.1,[]);const replacement=hauntFighter('bot');
  const fresh=advanceHaunt(state,.05,[replacement]);assert.equal(fresh[0].type,'ghost_warning');
  assert.equal(fresh[0].targetId,'bot');assert.equal(state.ghosts[0].phase,'warning');
  // A nearby but evasive target is not pursued forever.
  const g=state.ghosts[0];g.phase='chase';g.huntUntil=state.time+.1;
  replacement.x=g.x+10;advanceHaunt(state,.2,[replacement]);assert.equal(g.phase,'rest');
});

test('ghost faces its target with the eyes on its positive-Z model face',()=>{
  const state=Halloween.createHaunt(hauntConfig);advanceHaunt(state,5.1,[hauntFighter('fighter',-18,0,-13)]);
  assert.equal(state.ghosts[0].yaw,-Math.PI/2);
});

test('ghost contacts use full 3D distance, pursue rooftops and share a victim cooldown',()=>{
  const state=Halloween.createHaunt(hauntConfig),p=hauntFighter('roof',-11,4.55,-13);
  advanceHaunt(state,6.4,[p]);assert.equal(state.nextHit.roof,undefined,'cannot hit a roof through the floor');
  assert.ok(state.ghosts[0].y>1.4,'ghost climbs toward target');
  assert.equal(advanceHaunt(state,2,[p]).filter(e=>e.type==='ghost_hit').length,1);
  advanceHaunt(state,1.6,[]);
  for(const g of state.ghosts)Object.assign(g,{x:p.x,y:p.y+1,z:p.z,phase:'chase',targetId:p.id,until:state.time+10});
  assert.equal(advanceHaunt(state,.05,[p]).filter(e=>e.type==='ghost_hit').length,1,'stacked ghosts deal one contact hit');
  for(const g of state.ghosts)Object.assign(g,{phase:'chase',targetId:p.id,until:state.time+10});
  assert.equal(advanceHaunt(state,.05,[p]).filter(e=>e.type==='ghost_hit').length,0,'cooldown spans all ghosts');
});

test('solo ghost contacts use actual damage rules and Training remains immune',()=>{
  for(const training of [false,true]){
    const player={pos:{x:-11,y:0,z:-13},isPlayer:true,alive:true,hp:200,abs:0};
    const context={BlockRoyaleHalloween:Halloween,G:{haunt:Halloween.createHaunt(hauntConfig),ents:[player],pl:player,over:false,training,t:0},
      petPerk:()=>false,fxHit(){},AU:{tone(){},hurt(){}},toast(){},huntedTarget:()=>null,setTimeout(){},
      $:()=>({classList:{toggle(){}},style:{}})};
    vm.runInNewContext(fn('damage')+'\n'+fn('updateGhosts'),context);
    for(let i=0;i<135;i++){context.G.t+=.05;vm.runInNewContext('updateGhosts(.05);',context);}
    assert.equal(player.hp,training?200:188);
    const time=context.G.haunt.time;context.G.over=true;vm.runInNewContext('updateGhosts(.05);',context);
    assert.equal(context.G.haunt.time,time,'completed matches freeze haunt simulation');
  }
});

test('Friends host enforces ghost damage and replicates positions, warnings and phases',()=>{
  const a=new Sim.Authority({world:Sim.makeArenaWorld('ghosttown'),startTimeMs:1000,durationMs:180000});
  const p=a.addPlayer('host',{x:-11,y:0,z:-13}),other=a.addPlayer('guest',{x:30,y:0,z:0});
  for(let i=0;i<150;i++)a.step(50,a.serverTimeMs+50);
  assert.equal(p.hp,200,'no lobby damage');assert.equal(a.haunt.time,0);
  a.startRound();for(let i=0;i<135;i++)a.step(50,a.serverTimeMs+50);
  const snap=a.createSnapshot();assert.equal(p.hp,188);assert.equal(other.hp,200);
  assert.ok(snap.events.some(e=>e.type==='ghost_warning'&&e.targetId==='host'));
  assert.ok(snap.events.some(e=>e.type==='hit'&&e.weapon==='ghost'&&e.damage===12&&e.playerId===null));
  assert.equal(snap.ghosts.length,4);assert.equal(snap.ghosts[0].phase,'warning');
  assert.equal(snap.ghosts[0].x,a.haunt.ghosts[0].x);
  assert.equal(snap.ghosts[0].targetId,'host');
  snap.ghosts[0].x=999;assert.notEqual(a.haunt.ghosts[0].x,999,'snapshot cannot mutate host simulation');
  assert.equal(other.kills,0);
});

test('ghosts phase through haunted-house walls to reach a fighter inside',()=>{
  const a=new Sim.Authority({world:Sim.makeArenaWorld('ghosttown'),startTimeMs:1000,durationMs:180000});
  const p=a.addPlayer('host',{x:-24,y:0,z:-24});a.addPlayer('guest',{x:30,y:0,z:0});a.startRound();
  for(let i=0;i<230;i++)a.step(50,a.serverTimeMs+50);
  assert.equal(p.hp,188);assert.equal(a.metrics.hazardHits,1);
});

test('repeat contacts are spaced by two seconds and a host hunt deals at most 36 HP',()=>{
  const a=new Sim.Authority({world:Sim.makeArenaWorld('ghosttown'),startTimeMs:1000,durationMs:180000});
  const p=a.addPlayer('host',{x:-11,y:0,z:-13});a.addPlayer('guest',{x:30,y:0,z:0});a.startRound();
  for(let i=0;i<280;i++)a.step(50,a.serverTimeMs+50);
  const events=a.createSnapshot().events,hits=events.filter(e=>e.type==='hit'&&e.weapon==='ghost'&&e.targetId==='host');
  assert.equal(hits.length,3);assert.equal(p.hp,164);assert.equal(a.haunt.ghosts[0].phase,'rest');
  for(let i=1;i<hits.length;i++)assert.ok(hits[i].serverTimeMs-hits[i-1].serverTimeMs>=2000);
  assert.equal(events.filter(e=>e.type==='ghost_warning'&&e.repeat&&e.targetId==='host').length,2);
});

test('a hunt times out during its recovery warning instead of extending after contact',()=>{
  const state=Halloween.createHaunt(hauntConfig),p=hauntFighter();
  advanceHaunt(state,6.5,[p]);const g=state.ghosts[0];assert.equal(g.phase,'warning');
  g.huntUntil=state.time+.2;advanceHaunt(state,.3,[p]);assert.equal(g.phase,'rest');
});

test('running away after the first contact avoids later strikes in that hunt',()=>{
  const state=Halloween.createHaunt(hauntConfig),p=hauntFighter();
  advanceHaunt(state,6.5,[p]);assert.equal(state.ghosts[0].hits,1);
  const events=[];
  for(let i=0;i<160;i++){p.x-=6*.05;events.push(...Halloween.stepHaunt(state,.05,[p]));}
  assert.equal(events.filter(e=>e.type==='ghost_hit').length,0);
  assert.equal(state.ghosts[0].targetId,null);
});

test('cached single-contact map settings still work when loading the newer ghost module',()=>{
  const legacy={...hauntConfig};delete legacy.maxHits;delete legacy.recoil;
  const state=Halloween.createHaunt(legacy),events=advanceHaunt(state,6.5,[hauntFighter()]);
  assert.equal(events.filter(e=>e.type==='ghost_hit').length,1);
  assert.equal(state.ghosts[0].phase,'rest');
  for(const g of state.ghosts)assert.ok([g.x,g.y,g.z].every(Number.isFinite));
});

test('ghost deaths award no kill, respect respawn protection and stop after round end',()=>{
  const a=new Sim.Authority({world:Sim.makeArenaWorld('ghosttown'),startTimeMs:1000,durationMs:180000});
  const p=a.addPlayer('host',{x:-11,y:0,z:-13}),other=a.addPlayer('guest',{x:30,y:0,z:0});p.hp=12;a.startRound();
  for(let i=0;i<135;i++)a.step(50,a.serverTimeMs+50);
  assert.equal(p.alive,false);assert.equal(p.deaths,1);assert.equal(other.kills,0);
  for(let i=0;i<65;i++)a.step(50,a.serverTimeMs+50);
  assert.equal(p.alive,true);assert.equal(p.hp,200);
  for(const g of a.haunt.ghosts)Object.assign(g,{phase:'chase',targetId:p.id,x:p.x,y:p.y+1,z:p.z,until:a.haunt.time+10});
  a.step(50,a.serverTimeMs+50);assert.equal(p.hp,200);assert.ok(a.haunt.ghosts.every(g=>g.targetId!==p.id));
  a.roundEnded=true;const before=JSON.stringify(a.haunt);a.step(50,a.serverTimeMs+50);assert.equal(JSON.stringify(a.haunt),before);
});
