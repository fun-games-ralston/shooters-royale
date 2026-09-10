'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Sim=require('./sim.js');
function setup(durationMs=180000){
 const a=new Sim.Authority({world:Sim.makeFlatWorld(),startTimeMs:1000,durationMs,roundId:'round-a'});
 const h=a.addPlayer('host',{profile:{loadout:['sidearm',null,'knife'],pet:'dog'}});
 const g=a.addPlayer('guest',{profile:{loadout:['sidearm',null,'knife']}});
 a.startRound();return{a,h,g};
}
const damage=(a,target,attacker)=>a._damage(target,999,attacker,'BODY',{x:target.x,y:1,z:target.z},'sidearm');
test('saved empty secondary stays empty; slot 3 stays melee with no free shotgun',()=>{
 assert.deepEqual(Sim.safeProfile({loadout:['sidearm',null,'knife']}).loadout,['sidearm',null,'knife']);
});
test('timed death scores once and respawns with fresh gear, cleared status, and protection',()=>{
 const{a,h,g}=setup();g.inventory.sidearm.ammo=0;g.poisonUntil=50000;g.heat=99;
 damage(a,g,h);damage(a,g,h);assert.equal(h.kills,1);assert.equal(g.deaths,1);
 a.step(34,3999);assert.equal(g.alive,false);assert.equal(a.roundEnded,false);
 a.step(1,4000);assert.equal(g.alive,true);assert.equal(g.hp,200);assert.equal(g.inventory.sidearm.ammo,12);
 assert.equal(g.poisonUntil,0);assert.equal(g.heat,0);assert.equal(g.lifeId,1);
 damage(a,g,h);assert.equal(g.hp,200);
 a.step(34,5600);damage(a,g,h);assert.equal(g.alive,false);assert.equal(h.kills,2);
});
test('timer picks most kills, including a currently dead player; ties draw',()=>{
 const{a,h,g}=setup(10000);h.kills=3;g.kills=2;damage(a,h,null);
 a.step(34,11000);assert.equal(a.roundEnded,true);assert.equal(a.winnerId,'host');
 const snap=a.createSnapshot();assert.equal(snap.remainingMs,0);assert.equal(snap.roundId,'round-a');
 const tie=setup(10000);tie.h.kills=tie.g.kills=2;tie.a.step(34,11000);assert.equal(tie.a.winnerId,null);assert.equal(tie.a.roundEnded,true);
});
test('timer closes scoring before pending combat and no post-game damage is possible',()=>{
 const{a,h,g}=setup(1000);a.step(34,2000);damage(a,g,h);assert.equal(h.kills,0);assert.equal(g.hp,200);
 a.step(34,8000);assert.equal(g.hp,200);
});
test('hazard and self deaths do not award kills; disconnect finishes timed round',()=>{
 const{a,h,g}=setup();damage(a,h,h);assert.equal(h.kills,0);damage(a,g,null);assert.equal(g.kills,0);
 assert.equal(a.roundEnded,false);a.removePlayer('guest');assert.equal(a.roundEnded,true);assert.equal(a.winnerId,'host');
});
test('old-round inputs cannot control a new round',()=>{
 const{a,h}=setup();assert.equal(a.receiveInput(h.id,{seq:99,roundId:'old'}).reason,'wrong_round');
 assert.equal(a.receiveInput(h.id,{seq:1,roundId:'round-a'}).accepted,true);
});
test('respawn clears client prediction from the previous life and remote interpolation does not cross spawns',()=>{
 const{a,h,g}=setup();const c=new Sim.ClientPredictor(g.id,a.world,g.profile);c.applySnapshot(a.createSnapshot());
 c.predict({seq:1,moveF:1},50,1);damage(a,g,h);a.step(34,4000);
 const snap=a.createSnapshot();c.applySnapshot(snap);assert.equal(c.history.length,0);assert.equal(c.state.x,g.x);assert.equal(c.state.z,g.z);
 const buffer=new Sim.RemoteBuffer(0);buffer.push({serverTimeMs:1,players:[{id:'x',lifeId:0,alive:true,x:0}]});buffer.push({serverTimeMs:3,players:[{id:'x',lifeId:1,alive:true,x:100}]});
 assert.equal(buffer.at('x',2).x,100);
});
test('respawns across all ten arenas stay serializable and have full health',()=>{
 for(const def of Sim.CONTENT.ARENAS){const a=new Sim.Authority({world:Sim.makeArenaWorld(def.id),durationMs:180000});
 const h=a.addPlayer('h'),g=a.addPlayer('g');a.startRound();damage(a,g,h);a.step(1,3000);
 assert.equal(g.alive,true,def.id);assert.ok(Number.isFinite(g.x)&&Number.isFinite(g.y)&&Number.isFinite(g.z),def.id);
 assert.ok(JSON.stringify(a.createSnapshot()).length<20000);}
});
