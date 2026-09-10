'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Sim=require('./sim.js');
test('small authoritative corrections preserve the visible position, then decay without changing simulation',()=>{
 const camera=new Sim.CameraCorrection();const before={x:10,y:0,z:0,alive:true,lifeId:0};const after={...before,x:9.7};
 camera.reconcile(before,after);assert.equal(camera.sample(after,0).x,10);
 let last=10;for(let i=0;i<30;i++){const x=camera.sample(after,16.67).x;assert.ok(x<=last&&x>=9.7);last=x;}
 assert.ok(last-9.7<0.001);assert.equal(after.x,9.7);
});
test('camera resets instead of drifting between respawns or large teleports',()=>{
 const c=new Sim.CameraCorrection();let a={x:1,y:0,z:0,alive:true,lifeId:0},b={...a,x:.8};
 c.reconcile(a,b);c.reconcile(b,{...b,x:40,lifeId:1});assert.equal(c.sample({x:40,y:0,z:0},0).x,40);
 c.reconcile(a,{...a,x:10});assert.equal(c.sample({x:10,y:0,z:0},0).x,10);
});
test('render-rate prediction moves on every frame while transport remains at 20 Hz',()=>{
 const world=Sim.makeFlatWorld(),authority=new Sim.Authority({world});authority.addPlayer('host');const guest=authority.addPlayer('guest');
 const p=new Sim.ClientPredictor('guest',world);p.applySnapshot(authority.createSnapshot());
 let sends=0,accum=0,last=p.state.z,movingFrames=0;
 for(let frame=0;frame<60;frame++){
   p.predict({moveF:1,yaw:0},1000/60,sends+1);accum+=1000/60;
   if(accum>=50){sends++;accum-=50;}
   if(Math.abs(p.state.z-last)>.001)movingFrames++;last=p.state.z;
 }
 assert.equal(sends,20);assert.equal(movingFrames,60);
});
test('snapshot preserves airborne state at jump apex instead of inventing a grounded frame',()=>{
 const a=new Sim.Authority({world:Sim.makeFlatWorld()});a.addPlayer('host');const guest=a.addPlayer('guest');
 guest.vy=0;guest.y=3;guest.onGround=false;guest.jumpLatch=true;
 const p=new Sim.ClientPredictor('guest',a.world);p.applySnapshot(a.createSnapshot());
 assert.equal(p.state.onGround,false);assert.equal(p.state.jumpLatch,true);
});

function cameraRun(smooth,latency,jitter,loss){
 const world=Sim.makeFlatWorld(),a=new Sim.Authority({world}),host=a.addPlayer('host'),guest=a.addPlayer('guest');
 a.startRound();const p=new Sim.ClientPredictor('guest',world),c=new Sim.CameraCorrection();p.applySnapshot(a.createSnapshot());
 let seed=72;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};
 let seq=0,inputAccum=0,nextHost=0,nextSnapshot=0,lastZ=p.state.z;
 const up=[],down=[],deltas=[];
 const send=(queue,value,now)=>{if(random()>=loss)queue.push({at:now+Math.max(0,latency+(random()*2-1)*jitter),value});};
 for(let now=1000/60;now<5000;now+=1000/60){
   const input={moveF:now<2200?1:0,yaw:0,weapon:'sidearm'};
   inputAccum+=1000/60;
   if(smooth)p.predict(input,1000/60,seq+1);
   if(inputAccum>=50){inputAccum-=50;seq++;if(!smooth)p.predict(input,50,seq);send(up,{...input,seq},now);}
   up.sort((x,y)=>x.at-y.at);while(up[0]?.at<=now){const item=up.shift();a.receiveInput(guest.id,item.value,item.at);}
   while(nextHost<=now){a.step(1000/30,nextHost);nextHost+=1000/30;}
   if(nextSnapshot<=now){send(down,a.createSnapshot(),now);nextSnapshot+=1000/15;}
   down.sort((x,y)=>x.at-y.at);while(down[0]?.at<=now){const before={...p.state};const result=p.applySnapshot(down.shift().value);if(result.accepted&&smooth)c.reconcile(before,p.state);}
   const pose=smooth?c.sample(p.state,1000/60):p.state;
   if(now>500&&now<2000)deltas.push(pose.z-lastZ);lastZ=pose.z;
 }
 const mean=deltas.reduce((x,y)=>x+y,0)/deltas.length;
 return{jitter:Math.sqrt(deltas.reduce((sum,x)=>sum+(x-mean)**2,0)/deltas.length),error:Math.abs(p.state.z-guest.z)};
}
for(const conditions of [[60,20,0],[120,45,.02],[180,70,.05]])test(`camera steadiness improves during movement at ${conditions[0]} ms latency`,()=>{
 const old=cameraRun(false,...conditions),current=cameraRun(true,...conditions);
 assert.ok(current.jitter<old.jitter*.7,JSON.stringify({old,current}));
 assert.ok(current.error<.3,`Stopped reconciliation error: ${current.error}`);
});
