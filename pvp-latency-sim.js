'use strict';

const assert=require('node:assert/strict');
const {HostAuthority,ClientPredictor,SimulatedLink,seededRandom}=require('./pvp-netcode.js');

function movementScenario(latencyMs,jitterMs,loss,seed){
  const host=new HostAuthority({moveSpeed:7.5});
  host.addPlayer('guest');
  const client=new ClientPredictor('guest',{moveSpeed:7.5});
  const up=new SimulatedLink({latencyMs,jitterMs,loss,random:seededRandom(seed)});
  const down=new SimulatedLink({latencyMs,jitterMs,loss,random:seededRandom(seed+1000)});
  let nextInput=10,nextSnapshot=10,inputElapsed=0;
  for(let now=10;now<=4500;now+=10){
    const control={moveX:now<1200?1:0,yaw:-Math.PI/2};
    client.predict(control,10,now);inputElapsed+=10;
    if(now>=nextInput&&now<=2200){
      const input=client.makeInput(control,now,inputElapsed,true);inputElapsed=0;
      up.send(now,input,(message,at)=>host.receiveInput('guest',message,at));
      nextInput+=125;
    }
    up.flush(now);
    host.step(10,now);
    if(now>=nextSnapshot){
      down.send(now,host.createSnapshot(),(message,at)=>client.applySnapshot(message,at));
      nextSnapshot+=125;
    }
    down.flush(now);
  }
  down.flush(Infinity);
  const truth=host.players.get('guest');
  return {
    latencyMs,jitterMs,lossPct:Math.round(loss*100),
    finalError:Number(Math.hypot(client.x-truth.x,client.z-truth.z).toFixed(3)),
    maxCorrection:Number(client.metrics.maxCorrection.toFixed(3)),
    stalePackets:host.metrics.droppedInputs+client.metrics.staleSnapshots,
    lostPackets:up.dropped+down.dropped,
  };
}

function crossingShot(latencyMs){
  const host=new HostAuthority({moveSpeed:12,maxRewindMs:200});
  host.addPlayer('shooter',{x:0,z:0});
  const target=host.addPlayer('target',{x:10,z:-1.2});
  host.receiveInput('target',{seq:1,moveZ:1});
  const receivedAt=100+latencyMs;
  for(let now=10;now<=receivedAt;now+=10) host.step(10,now);
  const shot=host.receiveInput('shooter',{
    seq:1,fireId:1,yaw:-Math.PI/2,shotAtMs:100,clientTimeMs:100,
  },receivedAt).shot;
  return {latencyMs,rewindMs:shot.rewindMs,hit:shot.hit,targetAtArrival:Number(target.z.toFixed(2))};
}

const movement=[
  movementScenario(0,0,0,1),
  movementScenario(60,20,0,2),
  movementScenario(120,45,.02,3),
  movementScenario(180,70,.05,4),
  movementScenario(250,100,.10,5),
];
const shots=[0,60,120,180,200,250].map(crossingShot);

console.log('\nMovement sync after settling');
console.table(movement);
console.log('Crossing-target shot received after network delay');
console.table(shots);

for(const row of movement) assert.ok(row.finalError<=.2,`movement did not converge at ${row.latencyMs} ms: ${row.finalError}`);
for(const row of shots.filter(r=>r.latencyMs<=200)) assert.equal(row.hit,true,`expected rewind hit at ${row.latencyMs} ms`);
assert.equal(shots.find(r=>r.latencyMs===250).hit,false,'shots older than the 200 ms fairness cap must not rewind to the claimed time');
console.log('PASS: authority converged in every scenario; rewind worked through 200 ms and was capped beyond it.');
