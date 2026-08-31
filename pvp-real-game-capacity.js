'use strict';

const assert=require('node:assert/strict');

// Values come directly from the production game in index.html.
const GAME={
  baseMoveSpeed:6,
  fastestWeaponMove:1.18,
  sprintMultiplier:1.32,
  bodyWidth:1.0,
  rocketSpeed:58,
  weapons:{
    sidearm:{rpm:300},
    smg:{rpm:900},
    minigun:{rpm:1200},
    bazooka:{rpm:55},
  },
};

const PLAN_LIMITS={free:100,pro:500};
const PROFILES={
  currentSpike:{inputHz:8,snapshotHz:8},
  fourPlayerFreeCeiling:{inputHz:10,snapshotHz:8},
  playableBeta:{inputHz:20,snapshotHz:15},
  responsiveShooter:{inputHz:30,snapshotHz:20},
};

// Supabase counts both a client send and every delivery as events. A shared
// snapshot therefore costs N events, while one guest input costs two events.
function eventRate(players,{inputHz,snapshotHz},sharedEventsPerSecond=0){
  return players*snapshotHz + (players-1)*inputHz*2 + players*sharedEventsPerSecond;
}

function allPlayersShotRate(players,weapon){
  return players*GAME.weapons[weapon].rpm/60;
}

function capacityRows(){
  const rows=[];
  for(const players of [2,3,4]) for(const [profile,rate] of Object.entries(PROFILES)){
    const base=eventRate(players,rate);
    rows.push({
      players,profile,inputHz:rate.inputHz,snapshotHz:rate.snapshotHz,
      baseEventsPerSecond:base,
      freeHeadroom:PLAN_LIMITS.free-base,
      freePass:base<=PLAN_LIMITS.free,
      proPass:base<=PLAN_LIMITS.pro,
    });
  }
  return rows;
}

function naiveShotRows(){
  const rows=[];
  for(const players of [2,4]) for(const weapon of Object.keys(GAME.weapons)){
    const shots=allPlayersShotRate(players,weapon);
    const current=eventRate(players,PROFILES.currentSpike,shots);
    const playable=eventRate(players,PROFILES.playableBeta,shots);
    rows.push({
      players,weapon,shotsPerSecond:Number(shots.toFixed(1)),
      currentSpikeEvents:Math.round(current),
      playableBetaEvents:Math.round(playable),
      freePassAt8Hz:current<=PLAN_LIMITS.free,
      proPassAt15Hz:playable<=PLAN_LIMITS.pro,
    });
  }
  return rows;
}

function motionRows(){
  const sprint=GAME.baseMoveSpeed*GAME.fastestWeaponMove*GAME.sprintMultiplier;
  return [8,10,12,15,20,30].map(snapshotHz=>({
    snapshotHz,
    intervalMs:Number((1000/snapshotHz).toFixed(1)),
    sprintBlocksPerUpdate:Number((sprint/snapshotHz).toFixed(2)),
    bodyWidthsPerUpdate:Number((sprint/snapshotHz/GAME.bodyWidth).toFixed(2)),
    rocketBlocksPerUpdate:Number((GAME.rocketSpeed/snapshotHz).toFixed(2)),
  }));
}

function sampleSnapshot(players){
  const player=id=>[id,12.34,1.2,-8.76,3.2,0,-4.1,1.57,-.18,170,20,1,'minigun',0,93,0,5,481];
  const pet=(id,owner)=>[id,owner,10.1,.4,-7.2,5.4,0,-1.2,1.1,90,0,'p3',.4];
  const rocket=(id,owner)=>[id,owner,4.2,1.3,-2.7,-.7,.02,-.7,4.2];
  const snapshot={
    v:2,seq:912,t:1788150000123,
    p:Array.from({length:players},(_,i)=>player(`p${i+1}`)),
    pet:Array.from({length:players},(_,i)=>pet(`pet${i+1}`,`p${i+1}`)),
    proj:Array.from({length:players},(_,i)=>rocket(`r${i+1}`,`p${i+1}`)),
    hazards:[[2,9.2,0,-4.1,5.5,1.1]],
    events:[[901,'hit','p1','p2',30,140],[902,'fire','p3','minigun',7781]],
  };
  return Buffer.byteLength(JSON.stringify(snapshot));
}

const capacity=capacityRows();
const shots=naiveShotRows();
const motion=motionRows();
const payloads=[2,3,4].map(players=>({players,bytes:sampleSnapshot(players),kilobytes:Number((sampleSnapshot(players)/1024).toFixed(2))}));

console.log('\nBaseline transport cost (snapshots + guest inputs; gameplay events bundled)');
console.table(capacity);
console.log('Naive per-shot broadcasts (why bullets must not be individual messages)');
console.table(shots);
console.log('Real production-game motion between remote snapshots');
console.table(motion);
console.log('Compact full-game snapshot estimate (players + one pet and rocket each)');
console.table(payloads);

const fourCurrent=capacity.find(r=>r.players===4&&r.profile==='currentSpike');
const fourPlayable=capacity.find(r=>r.players===4&&r.profile==='playableBeta');
const twoPlayable=capacity.find(r=>r.players===2&&r.profile==='playableBeta');
assert.equal(fourCurrent.baseEventsPerSecond,80);
assert.equal(fourPlayable.baseEventsPerSecond,180);
assert.equal(twoPlayable.baseEventsPerSecond,70);
assert.equal(fourPlayable.freePass,false);
assert.equal(fourPlayable.proPass,true);
assert.ok(payloads.at(-1).bytes<4096,'compact four-player state should remain comfortably below 4 KB');
assert.ok(motion.find(r=>r.snapshotHz===8).bodyWidthsPerUpdate>1,'8 Hz crosses more than one body width per update');
assert.ok(shots.find(r=>r.players===4&&r.weapon==='minigun').currentSpikeEvents>PLAN_LIMITS.free);

console.log('PASS: 2-player 20/15 Hz fits Free; 4-player 20/15 Hz needs >100 events/s; compact payload size is not the bottleneck.');

