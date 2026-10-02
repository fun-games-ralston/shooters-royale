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
