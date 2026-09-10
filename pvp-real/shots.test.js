'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Sim=require('./sim.js');

test('hitscan starts at the current shooter eye even when the input asks for historical rewind',()=>{
  const a=new Sim.Authority({world:Sim.makeFlatWorld(),startTimeMs:1000});
  const host=a.addPlayer('host'),guest=a.addPlayer('guest');a.startRound();
  const old={x:guest.x,y:guest.y,z:guest.z};
  guest.x+=4;guest.y=2;guest.z+=3;
  guest.input={...guest.input,shotAtMs:1000,yaw:.4,pitch:.2};a.serverTimeMs=1150;
  a._fireHitscan(guest,Sim.WEAPONS.sidearm);
  const event=a.events.findLast(e=>e.type==='fire');
  assert.deepEqual(event.origin,{x:guest.x,y:guest.y+Sim.CFG.eye,z:guest.z});
  assert.notEqual(event.origin.x,old.x);assert.equal(event.rewindMs,150);
  assert.deepEqual(event.aim,Sim.dirFromAngles(.4,.2));assert.equal(event.lifeId,guest.lifeId||0);
});

test('rockets start at the player eye, never behind the shooter',()=>{
  const a=new Sim.Authority({world:Sim.makeFlatWorld()});const p=a.addPlayer('host');
  p.x=3;p.y=2;p.z=4;p.input={...p.input,yaw:1,pitch:.5};
  a._spawnRocket(p,Sim.WEAPONS.bazooka);
  assert.deepEqual(a.events.findLast(e=>e.type==='rocket_spawn').origin,{x:3,y:2+Sim.CFG.eye,z:4});
});

test('muzzle positions use each PvE weapon barrel geometry',()=>{
  for(const id of Sim.WEAPON_IDS){
    const p=Sim.muzzlePoint(id);assert.ok(Number.isFinite(p.z));
    for(const part of Sim.WEAPONS[id].parts)assert.ok(p.z<part.z-part.d/2);
  }
  assert.notEqual(Sim.muzzlePoint('sidearm').z,Sim.muzzlePoint('sniper').z);
});

test('late local shot effects cannot reappear after turning, dying, or respawning',()=>{
  const state={alive:true,lifeId:0,yaw:0,pitch:0};
  const event={lifeId:0,serverTimeMs:1000,aim:Sim.dirFromAngles(0,0)};
  assert.equal(Sim.shotVisualAllowed(event,state,1200),true);
  assert.equal(Sim.shotVisualAllowed(event,{...state,yaw:Math.PI/2},1200),false);
  assert.equal(Sim.shotVisualAllowed(event,{...state,alive:false},1200),false);
  assert.equal(Sim.shotVisualAllowed(event,{...state,lifeId:1},1200),false);
  assert.equal(Sim.shotVisualAllowed(event,state,1500),false);
});
