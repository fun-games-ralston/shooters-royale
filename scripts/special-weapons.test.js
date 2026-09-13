'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Specials=require('../shared/weapon-specials.js');
const {extractLiteral}=require('./sync-pve-content.js');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const weapons=vm.runInNewContext(`(${extractLiteral(source,'WEAPONS')})`);
const weapon=id=>weapons.find(item=>item.id===id);

test('Lockjaw and Dragonfire keep the approved balance contract',()=>{
  const lockjaw=weapon('lockjaw'),flame=weapon('dragonfire');
  assert.ok(lockjaw); assert.equal(lockjaw.name,'Lockjaw Launcher');
  assert.equal(lockjaw.dmg,60); assert.equal(lockjaw.mag,4); assert.equal(lockjaw.reserve,0);
  assert.ok(lockjaw.range>=300); assert.equal(lockjaw.bodyOnly,true); assert.equal(lockjaw.homing,true);
  assert.equal(lockjaw.lockOn.time,1.2); assert.equal(lockjaw.pvp,false);
  assert.ok(flame); assert.equal(flame.name,'Dragonfire');
  assert.equal(flame.dmg,70); assert.equal(flame.mag,8); assert.equal(flame.range,15);
  assert.equal(flame.flameDuration,3); assert.equal(flame.bodyOnly,true); assert.equal(flame.pvp,false);
  assert.equal(Specials.flameDamage(flame.dmg,1),70);
  assert.equal(Specials.flameDamage(flame.dmg,flame.flameDuration),210);
});

test('lock requires one continuous visible target and stays confirmed after cover',()=>{
  let state=Specials.advanceLock(null,'A',.55,1.2);
  state=Specials.advanceLock(state,'B',.4,1.2);
  assert.equal(state.targetId,'B'); assert.equal(state.progress,.4); assert.equal(state.ready,false);
  state=Specials.advanceLock(state,'B',.8,1.2);
  assert.equal(state.ready,true); assert.equal(state.justLocked,true);
  state=Specials.advanceLock(state,null,.5,1.2);
  assert.equal(state.targetId,'B'); assert.equal(state.ready,true);
});

test('lock selection requires aim, range, and line of sight',()=>{
  const targets=[
    {id:'blocked',alive:true,pos:{x:0,y:0,z:8}},
    {id:'visible',alive:true,pos:{x:.15,y:0,z:12}},
    {id:'wide',alive:true,pos:{x:4,y:0,z:10}},
  ];
  const picked=Specials.selectLockTarget({x:0,y:1.15,z:0},{x:0,y:0,z:1},targets,{
    maxRange:320,coneDegrees:3,visible:target=>target.id!=='blocked'
  });
  assert.equal(picked.id,'visible');
});

test('homing guidance visibly steers around a blocking wall and still reaches its target',()=>{
  const target={x:14,y:1,z:0};
  let pos={x:0,y:1,z:0},direction={x:1,y:0,z:0},closest=Infinity,maxSide=0;
  const clearance=(start,dir,max)=>{
    if(Math.abs(dir.x)<1e-8) return max;
    const t=(5-start.x)/dir.x;
    if(t>0&&t<max){ const z=start.z+dir.z*t,y=start.y+dir.y*t; if(Math.abs(z)<2.2&&y<4.2) return t; }
    return max;
  };
  for(let i=0;i<500;i++){
    direction=Specials.homingDirection(pos,direction,target,.02,{turnRate:4.8,avoidSide:1,probe:5,clearance:(dir,max)=>clearance(pos,dir,max)});
    const next={x:pos.x+direction.x*.44,y:pos.y+direction.y*.44,z:pos.z+direction.z*.44};
    closest=Math.min(closest,Specials.segmentPointDistance(pos,next,target));
    maxSide=Math.max(maxSide,Math.abs(next.z),Math.max(0,next.y-1)); pos=next;
    if(closest<.8) break;
  }
  assert.ok(maxSide>.8,'missile should take a visible detour');
  assert.ok(closest<.8,'missile should still reach the target');
});

test('flame cone can damage several visible targets but stops at walls and range',()=>{
  const targets=[
    {id:'near',alive:true,pos:{x:0,y:0,z:5}},
    {id:'edge',alive:true,pos:{x:.8,y:0,z:10}},
    {id:'blocked',alive:true,pos:{x:0,y:0,z:12}},
    {id:'wide',alive:true,pos:{x:3,y:0,z:10}},
    {id:'far',alive:true,pos:{x:0,y:0,z:16}},
  ];
  const hit=Specials.flameTargets({x:0,y:1.15,z:0},{x:0,y:0,z:1},targets,{
    range:15,endRadius:1.35,visible:target=>target.id!=='blocked'
  }).map(target=>target.id);
  assert.deepEqual(hit,['near','edge']);
});

test('special PvE mechanics cannot silently degrade into ordinary PvP shots',()=>{
  const Sim=require('../pvp-real/sim.js');
  assert.equal(Sim.WEAPONS.lockjaw,undefined);
  assert.equal(Sim.WEAPONS.dragonfire,undefined);
  assert.deepEqual(Sim.safeProfile({loadout:['lockjaw','dragonfire','knife']}).loadout,['sidearm',null,'knife']);
});

test('live HUD includes explicit lock confirmation instructions',()=>{
  assert.match(source,/TARGET LOCKED · LMB FIRE/);
  assert.match(source,/HOLD RMB ON A VISIBLE FIGHTER/);
  assert.match(source,/HOLD LMB TO BURN FOR UP TO 3 SECONDS/);
});
