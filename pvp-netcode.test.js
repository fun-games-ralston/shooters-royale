'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  HostAuthority,ClientPredictor,SimulatedLink,sanitizeInput,seededRandom,
}=require('./pvp-netcode.js');

const close=(actual,expected,tolerance=.001)=>{
  assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} is not within ${tolerance} of ${expected}`);
};

test('client input cannot write authoritative position, health, damage, or hit claims',()=>{
  const clean=sanitizeInput({
    seq:4,moveX:99,moveZ:99,yaw:Infinity,fireId:2,
    x:999,z:999,hp:9999,damage:9999,targetId:'victim',hit:true,
  });
  assert.deepEqual(Object.keys(clean),['seq','clientTimeMs','moveX','moveZ','yaw','fireId','shotAtMs']);
  close(Math.hypot(clean.moveX,clean.moveZ),1);

  const host=new HostAuthority();
  const player=host.addPlayer('player',{x:2,z:3});
  host.receiveInput('player',{seq:1,x:999,z:999,hp:9999,moveX:0,moveZ:0});
  assert.equal(player.x,2);
  assert.equal(player.z,3);
  assert.equal(player.hp,200);
});

test('host rejects duplicate and out-of-order input sequences',()=>{
  const host=new HostAuthority();
  const p=host.addPlayer('p1');
  assert.equal(host.receiveInput('p1',{seq:2,moveX:1}).accepted,true);
  assert.equal(host.receiveInput('p1',{seq:2,moveX:-1}).reason,'stale_input');
  assert.equal(host.receiveInput('p1',{seq:1,moveX:-1}).reason,'stale_input');
  host.step(100,100);
  assert.ok(p.x>0,'stale packets must not reverse movement');
  assert.equal(host.metrics.droppedInputs,2);
});

test('host movement is the ground-truth position and stays inside the arena',()=>{
  const host=new HostAuthority({moveSpeed:10,arenaHalfSize:2});
  const p=host.addPlayer('p1');
  host.receiveInput('p1',{seq:1,moveX:1,moveZ:1,yaw:.5});
  host.step(100,100);
  close(Math.hypot(p.x,p.z),1);
  for(let now=200;now<=1100;now+=100) host.step(100,now);
  assert.equal(p.x,2);
  assert.equal(p.z,2);
});

test('lag compensation hits where the target was when the shot was fired',()=>{
  const host=new HostAuthority({moveSpeed:7.5,maxRewindMs:200});
  host.addPlayer('shooter',{x:0,z:0});
  const target=host.addPlayer('target',{x:10,z:-.75});
  host.receiveInput('target',{seq:1,moveZ:1});
  for(let now=10;now<=250;now+=10) host.step(10,now);
  assert.ok(target.z>1,'target is no longer crossing the shot line when the packet arrives');

  const result=host.receiveInput('shooter',{
    seq:1,fireId:1,yaw:-Math.PI/2,clientTimeMs:100,shotAtMs:100,
  },250).shot;
  assert.equal(result.accepted,true);
  assert.equal(result.hit,true);
  assert.equal(result.targetId,'target');
  assert.equal(result.rewindMs,150);
  assert.equal(target.hp,170);
  close(result.impact.z,0,.001);
});

test('rewind is capped so a client cannot shoot arbitrarily far into the past',()=>{
  const host=new HostAuthority({moveSpeed:10,maxRewindMs:200});
  host.addPlayer('shooter',{x:0,z:0});
  const target=host.addPlayer('target',{x:10,z:0});
  host.receiveInput('target',{seq:1,moveZ:1});
  for(let now=10;now<=400;now+=10) host.step(10,now);

  const result=host.receiveInput('shooter',{
    seq:1,fireId:1,yaw:-Math.PI/2,shotAtMs:0,
  },400).shot;
  assert.equal(result.shotAtMs,200);
  assert.equal(result.hit,false);
  assert.equal(target.hp,200);
});

test('one fire edge can damage once and the host enforces weapon cadence',()=>{
  const host=new HostAuthority({fireCooldownMs:200});
  host.addPlayer('shooter');
  const target=host.addPlayer('target',{x:10});
  const fire=(seq,fireId,at)=>host.receiveInput('shooter',{
    seq,fireId,yaw:-Math.PI/2,shotAtMs:at,
  },at).shot;

  assert.equal(fire(1,1,0).hit,true);
  assert.equal(host.receiveInput('shooter',{seq:2,fireId:1,yaw:-Math.PI/2},25).shot,null);
  assert.equal(fire(3,2,50).reason,'fire_rate');
  assert.equal(target.hp,170);
  assert.equal(fire(4,3,250).hit,true);
  assert.equal(target.hp,140);
});

test('only the host can declare death, and a dead player cannot keep moving',()=>{
  const host=new HostAuthority({weaponDamage:200});
  host.addPlayer('shooter');
  const target=host.addPlayer('target',{x:10});
  const shot=host.receiveInput('shooter',{
    seq:1,fireId:1,yaw:-Math.PI/2,shotAtMs:0,
  },0).shot;
  assert.equal(shot.killed,true);
  assert.equal(target.hp,0);
  assert.equal(target.alive,false);
  assert.equal(host.receiveInput('target',{seq:1,moveX:1},10).reason,'unknown_or_dead');
  host.step(100,100);
  assert.equal(target.x,10);
});

test('client rejects stale snapshots and reconciles from host state',()=>{
  const client=new ClientPredictor('me',{moveSpeed:8});
  client.makeInput({moveX:1,yaw:.2},0,125);
  client.makeInput({moveX:1,yaw:.2},125,125);
  close(client.x,2);
  const fresh={protocol:1,seq:2,serverTimeMs:125,players:[
    {id:'me',x:.8,z:0,yaw:.2,hp:200,alive:true,lastProcessedInput:1},
  ]};
  const result=client.applySnapshot(fresh,200);
  assert.equal(result.accepted,true);
  close(client.x,1.8);
  assert.equal(client.pending.length,1);
  assert.equal(client.applySnapshot(Object.assign({},fresh,{seq:1}),220).reason,'stale_snapshot');
  close(client.x,1.8);
});

test('remote players are interpolated between authoritative snapshots',()=>{
  const client=new ClientPredictor('me');
  client.applySnapshot({protocol:1,seq:1,serverTimeMs:0,players:[
    {id:'me',x:0,z:0,yaw:0,hp:200,alive:true,lastProcessedInput:0},
    {id:'other',x:0,z:0,yaw:0,hp:200,alive:true,lastProcessedInput:0},
  ]});
  client.applySnapshot({protocol:1,seq:2,serverTimeMs:100,players:[
    {id:'me',x:0,z:0,yaw:0,hp:200,alive:true,lastProcessedInput:0},
    {id:'other',x:10,z:4,yaw:1,hp:170,alive:true,lastProcessedInput:1},
  ]});
  const remote=client.remoteAt('other',50);
  close(remote.x,5);
  close(remote.z,2);
});

test('prediction converges after 150 ms latency, jitter, packet loss, and reordering',()=>{
  const host=new HostAuthority({moveSpeed:7.5});
  host.addPlayer('guest');
  const client=new ClientPredictor('guest',{moveSpeed:7.5});
  const up=new SimulatedLink({latencyMs:150,jitterMs:90,loss:.2,random:seededRandom(42)});
  const down=new SimulatedLink({latencyMs:150,jitterMs:90,loss:.2,random:seededRandom(84)});
  let nextInput=0,nextSnapshot=0;

  for(let now=0;now<=3500;now+=10){
    if(now>=nextInput&&now<=1800){
      const moving=now<1000;
      const input=client.makeInput({moveX:moving?1:0,yaw:-Math.PI/2},now,125);
      up.send(now,input,(msg,at)=>host.receiveInput('guest',msg,at));
      nextInput+=125;
    }
    up.flush(now);
    host.step(10,now);
    if(now>=nextSnapshot){
      const snap=host.createSnapshot();
      down.send(now,snap,(msg,at)=>client.applySnapshot(msg,at));
      nextSnapshot+=125;
    }
    down.flush(now);
  }
  down.flush(Infinity);
  const authoritative=host.players.get('guest');
  assert.ok(Math.hypot(client.x-authoritative.x,client.z-authoritative.z)<.15,
    `client ${client.x.toFixed(3)}, host ${authoritative.x.toFixed(3)}`);
  assert.ok(up.dropped+down.dropped>0,'the deterministic run should exercise loss');
  assert.ok(client.metrics.staleSnapshots>0,'the deterministic run should exercise reordering');
});
