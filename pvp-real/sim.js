(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PVPRealSim=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const CFG={
    baseHp:200,maxPlayers:2,simulationHz:30,inputHz:20,snapshotHz:15,
    gravity:26,radius:.34,height:1.92,eye:1.66,step:.62,
    baseMoveSpeed:6,sprint:1.32,historyMs:500,maxRewindMs:200,futureShotToleranceMs:35,
  };
  const HITBOX=[
    {part:'HEAD',y0:1.42,y1:1.96,hx:.28,hz:.28,m:2.5},
    {part:'BODY',y0:.84,y1:1.42,hx:.50,hz:.24,m:1},
    {part:'LEGS',y0:0,y1:.84,hx:.32,hz:.24,m:.65},
  ];
  const WEAPONS={
    sidearm:{id:'sidearm',name:'M9 Sidearm',kind:'hitscan',dmg:30,rpm:300,mag:12,reserve:72,reload:1.15,spread:.9,range:60,fall:[26,55,.6],speed:1.12,auto:false,color:0xffe08a},
    ak47:{id:'ak47',name:'AK-47',kind:'hitscan',dmg:32,rpm:600,mag:20,reserve:80,reload:2,spread:1.8,range:90,fall:[60,90,.7],speed:.98,auto:true,color:0xffb347},
    scatter:{id:'scatter',name:'Scattergun',kind:'hitscan',dmg:16,pellets:9,rpm:85,mag:5,reserve:30,reload:2.1,spread:4.6,range:30,fall:[11,24,.3],speed:1.06,auto:false,color:0xffc46b},
    bazooka:{id:'bazooka',name:'Bazooka',kind:'rocket',dmg:95,splash:85,splashR:5.6,rpm:55,mag:2,reserve:6,reload:3.2,spread:.7,range:150,speed:.84,auto:false,projectileSpeed:58,color:0xff6b2c},
  };
  const WEAPON_IDS=Object.keys(WEAPONS);
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const lerp=(a,b,t)=>a+(b-a)*t;
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const safeId=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
  const safeName=v=>(String(v||'Fighter').replace(/[^a-zA-Z0-9 _-]/g,'').trim()||'Fighter').slice(0,16);
  const normAngle=v=>{v=finite(v);return Math.atan2(Math.sin(v),Math.cos(v));};
  const hash=v=>{let h=2166136261;for(const c of String(v)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const mulberry32=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  const shadeHex=(n,f)=>{const r=clamp(((n>>16&255)*f)|0,0,255),g=clamp(((n>>8&255)*f)|0,0,255),b=clamp(((n&255)*f)|0,0,255);return(r<<16)|(g<<8)|b;};

  function rayBox(o,d,b){
    let t0=-1e9,t1=1e9;
    for(const axis of ['x','y','z']){
      const lo=b[axis+'0'],hi=b[axis+'1'],dd=d[axis],oo=o[axis];
      if(Math.abs(dd)<1e-8){if(oo<lo||oo>hi)return null;continue;}
      let a=(lo-oo)/dd,c=(hi-oo)/dd;if(a>c){const q=a;a=c;c=q;}
      if(a>t0)t0=a;if(c<t1)t1=c;if(t0>t1)return null;
    }
    if(t1<0)return null;
    return t0>0?t0:0;
  }

  function rayWorld(world,o,d,max){
    let best=max;
    for(const b of world.boxes){const t=rayBox(o,d,b);if(t!==null&&t<best)best=t;}
    return best;
  }

  function groundAt(boxes,x,z,fromY=60){
    let best=0;
    for(const b of boxes) if(x>=b.x0-.3&&x<=b.x1+.3&&z>=b.z0-.3&&z<=b.z1+.3&&b.y1<=fromY+.01&&b.y1>best) best=b.y1;
    return best;
  }

  function makeFoundryWorld(){
    const visuals=[],boxes=[],spawns=[],R=mulberry32(11),size=76,H=size/2;
    const colors={sky:0x16121c,fog:0x1a1520,ground:0x3a3229,accent:0xe0553a,wall:0x2e2822,light:0xffd9b0};
    const add=(x,y,z,w,h,d,color,emissive=0,solid=true)=>{
      visuals.push({x,y,z,w,h,d,color,emissive,solid});
      if(solid) boxes.push({x0:x-w/2,x1:x+w/2,y0:y-h/2,y1:y+h/2,z0:z-d/2,z1:z+d/2});
    };
    add(0,-1,0,size,2,size,colors.ground);
    for(let i=0;i<26;i++){
      const w=4+R()*10,d=4+R()*10;
      add((R()-.5)*size*.85,.02,(R()-.5)*size*.85,w,.05,d,shadeHex(colors.ground,1.16),0,false);
    }
    const wallH=11;
    [[0,-H,size,1],[0,H,size,1],[-H,0,1,size],[H,0,1,size]].forEach(([x,z,w,d])=>{
      add(x,wallH/2,z,w,wallH,d,colors.wall);
      add(x,wallH+.3,z,w+.4,.6,d+.4,shadeHex(colors.wall,1.4));
    });
    for(let i=0;i<10;i++){
      const t=(i/9-.5)*size*.94;
      add(t,4,-H+1.1,1.2,8,.5,shadeHex(colors.wall,1.25));
      add(t,4,H-1.1,1.2,8,.5,shadeHex(colors.wall,1.25));
    }
    const nObs=16+((R()*8)|0);
    for(let i=0;i<nObs;i++){
      const w=2+R()*5,d=2+R()*5,h=1.6+R()*3.6;
      let x=(R()-.5)*size*.82,z=(R()-.5)*size*.82;
      if(Math.abs(x)<7&&Math.abs(z)<7)x+=12*Math.sign(x||1);
      add(x,h/2,z,w,h,d,shadeHex(colors.wall,.9+R()*.5));
      add(x,h+.12,z,w*.96,.24,d*.96,shadeHex(colors.accent,.85));
    }
    const deckSpots=[[-1,-1],[1,-1],[-1,1],[1,1]];
    deckSpots.forEach((spot,i)=>{
      if(i>0&&R()<.18)return;
      const dw=11+R()*7,dd=11+R()*7,dy=4.4+R()*1.6,x=spot[0]*(H*.48),z=spot[1]*(H*.48);
      add(x,dy,z,dw,.6,dd,shadeHex(colors.wall,1.1));
      [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([px,pz])=>add(x+px*(dw/2-.7),dy/2,z+pz*(dd/2-.7),1,dy,1,shadeHex(colors.wall,.75)));
      add(x,dy+.75,z-dd/2+.2,dw,.9,.24,shadeHex(colors.accent,.7));
      add(x,dy+.75,z+dd/2-.2,dw,.9,.24,shadeHex(colors.accent,.7));
      const dx=-spot[0],dz=-spot[1],steps=Math.round(dy/.55),sx=x+dx*(dw/2+.4),sz=z+dz*(dd/2+.4);
      for(let s=0;s<steps;s++){
        const hgt=dy-s*.55;
        add(sx+dx*s*1.05,hgt/2,sz+dz*s*1.05,dx?1.6:3.4,hgt,dz?1.6:3.4,shadeHex(colors.wall,1));
      }
    });
    const cy=3.2;
    add(0,cy,0,13,.6,13,shadeHex(colors.wall,1.2));
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([px,pz])=>add(px*5.6,cy/2,pz*5.6,1.2,cy,1.2,shadeHex(colors.wall,.8)));
    add(0,cy+2.2,0,4,3.6,4,shadeHex(colors.accent,.6),.25);
    for(let s=0;s<6;s++){const hgt=cy-s*.53;add(0,hgt/2,7.4+s*1.05,4.4,hgt,1.05,shadeHex(colors.wall,1.05));}
    for(let s=0;s<6;s++){const hgt=cy-s*.53;add(0,hgt/2,-7.4-s*1.05,4.4,hgt,1.05,shadeHex(colors.wall,1.05));}
    for(let i=0;i<7;i++){
      const x=(R()-.5)*H*1.6,z=(R()-.5)*H*1.6;
      add(x,3,z,1.4,6,1.4,0x50412e);add(x,6.4,z,2.2,1.2,2.2,colors.accent,.4);
    }
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2+R()*.24,r=size*.4*(.86+R()*.28),x=Math.cos(a)*r,z=Math.sin(a)*r;
      spawns.push({x,z,y:groundAt(boxes,x,z,60)});
    }
    const world={id:'foundry',size,H,boxes,visuals,spawns,colors};
    world.duelSpawns=findDuelSpawns(world);
    return world;
  }

  function boxHit(world,x,y,z){
    const r=CFG.radius,h=CFG.height;
    for(const b of world.boxes) if(x-r<b.x1&&x+r>b.x0&&z-r<b.z1&&z+r>b.z0&&y<b.y1&&y+h>b.y0)return b;
    return null;
  }

  function freeAt(world,x,y,z){return !boxHit(world,x,y+.02,z);}

  function findDuelSpawns(world){
    const candidates=world.spawns.filter(s=>freeAt(world,s.x,s.y,s.z));
    let best=null,bestScore=-1;
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
      const a=candidates[i],b=candidates[j],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,dist=Math.hypot(dx,dy,dz);
      const o={x:a.x,y:a.y+CFG.eye,z:a.z},d={x:dx/dist,y:dy/dist,z:dz/dist};
      const clear=rayWorld(world,o,d,dist)>=dist-.5;
      const score=clear?dist-Math.abs(a.y-b.y)*4:-1;
      if(score>bestScore){bestScore=score;best=[a,b];}
    }
    return best||candidates.slice(0,2);
  }

  function makeFlatWorld(){
    const colors={sky:0x16121c,fog:0x1a1520,ground:0x3a3229,accent:0xe0553a,wall:0x2e2822,light:0xffd9b0};
    return {id:'flat',size:80,H:40,colors,boxes:[{x0:-40,x1:40,y0:-2,y1:0,z0:-40,z1:40}],
      visuals:[{x:0,y:-1,z:0,w:80,h:2,d:80,color:colors.ground,solid:true}],
      spawns:[{x:-9,y:0,z:0},{x:9,y:0,z:0}],duelSpawns:[{x:-9,y:0,z:0},{x:9,y:0,z:0}]};
  }

  function sanitizeInput(raw={}){
    let f=clamp(finite(raw.moveF),-1,1),r=clamp(finite(raw.moveR),-1,1);
    const len=Math.hypot(f,r);if(len>1){f/=len;r/=len;}
    return {
      seq:Math.max(0,Math.floor(finite(raw.seq))),clientTimeMs:finite(raw.clientTimeMs),
      moveF:f,moveR:r,yaw:normAngle(raw.yaw),pitch:clamp(finite(raw.pitch),-1.1,1.1),
      jump:raw.jump===true,sprint:raw.sprint===true,trigger:raw.trigger===true,
      fireId:Math.max(0,Math.floor(finite(raw.fireId))),shotAtMs:finite(raw.shotAtMs),
      reloadId:Math.max(0,Math.floor(finite(raw.reloadId))),
      weapon:WEAPONS[raw.weapon]?raw.weapon:'sidearm',
    };
  }

  function inventory(){
    const out={};for(const id of WEAPON_IDS)out[id]={ammo:WEAPONS[id].mag,reserve:WEAPONS[id].reserve};return out;
  }

  function makePlayer(id,name,spawn){
    return {id,name:safeName(name),x:spawn.x,y:spawn.y,z:spawn.z,vx:0,vy:0,vz:0,yaw:0,pitch:0,onGround:true,
      hp:CFG.baseHp,alive:true,weapon:'sidearm',inventory:inventory(),reloadUntil:0,nextFireAt:0,
      input:sanitizeInput({}),lastInputSeq:0,lastConsumedFireId:0,lastReloadId:0,jumpLatch:false,
      history:[],lastShotAt:-Infinity,shotCounter:0,kills:0};
  }

  function moveAxis(player,axis,delta,world){
    if(!delta)return;
    const old=player[axis];player[axis]+=delta;
    for(const b of world.boxes){
      if(player.x-CFG.radius<b.x1&&player.x+CFG.radius>b.x0&&player.z-CFG.radius<b.z1&&player.z+CFG.radius>b.z0&&player.y<b.y1&&player.y+CFG.height>b.y0){
        if(b.y1>player.y&&b.y1-player.y<=CFG.step&&freeAt(world,player.x,b.y1,player.z)){player.y=b.y1;continue;}
        player[axis]=old;return;
      }
    }
  }

  function moveVertical(player,dt,world){
    player.vy-=CFG.gravity*dt;
    let ny=player.y+player.vy*dt;
    if(player.vy<=0){
      let support=null;
      for(const b of world.boxes){
        if(player.x-CFG.radius<b.x1&&player.x+CFG.radius>b.x0&&player.z-CFG.radius<b.z1&&player.z+CFG.radius>b.z0&&b.y1<=player.y+.03&&ny<b.y1&&(support===null||b.y1>support))support=b.y1;
      }
      if(support!==null){ny=support;player.vy=0;player.onGround=true;}else player.onGround=false;
    }else{
      for(const b of world.boxes){
        if(player.x-CFG.radius<b.x1&&player.x+CFG.radius>b.x0&&player.z-CFG.radius<b.z1&&player.z+CFG.radius>b.z0&&b.y0>=player.y+CFG.height-.05&&ny+CFG.height>b.y0){ny=b.y0-CFG.height;player.vy=0;}
      }
      player.onGround=false;
    }
    player.y=ny;
    if(player.y<0){player.y=0;player.vy=0;player.onGround=true;}
  }

  function integrateMovement(player,input,world,dt){
    const weapon=WEAPONS[player.weapon]||WEAPONS.sidearm;
    let speed=CFG.baseMoveSpeed*weapon.speed*(input.sprint?CFG.sprint:1);
    const sy=Math.sin(input.yaw),cy=Math.cos(input.yaw);
    const wx=-sy*input.moveF+cy*input.moveR,wz=-cy*input.moveF-sy*input.moveR;
    const k=clamp(15*dt,0,1);
    player.vx=lerp(player.vx,wx*speed,k);player.vz=lerp(player.vz,wz*speed,k);
    if(input.jump&&!player.jumpLatch&&player.onGround){player.vy=8.7;player.onGround=false;}
    player.jumpLatch=input.jump;
    moveAxis(player,'x',player.vx*dt,world);moveAxis(player,'z',player.vz*dt,world);moveVertical(player,dt,world);
    player.x=clamp(player.x,-world.H+1.2,world.H-1.2);player.z=clamp(player.z,-world.H+1.2,world.H-1.2);
    player.yaw=input.yaw;player.pitch=input.pitch;
  }

  function dirFromAngles(yaw,pitch){
    const cp=Math.cos(pitch);return{x:-Math.sin(yaw)*cp,y:Math.sin(pitch),z:-Math.cos(yaw)*cp};
  }

  function spreadDir(base,degrees,random){
    if(degrees<=0)return{...base};
    const radians=degrees*Math.PI/180,a=random()*Math.PI*2,m=Math.sqrt(random())*radians;
    const up=Math.abs(base.y)>.95?{x:1,y:0,z:0}:{x:0,y:1,z:0};
    let rx=base.y*up.z-base.z*up.y,ry=base.z*up.x-base.x*up.z,rz=base.x*up.y-base.y*up.x;
    const rl=Math.hypot(rx,ry,rz)||1;rx/=rl;ry/=rl;rz/=rl;
    const ux=ry*base.z-rz*base.y,uy=rz*base.x-rx*base.z,uz=rx*base.y-ry*base.x;
    const ox=Math.cos(a)*m,oy=Math.sin(a)*m,d={x:base.x+rx*ox+ux*oy,y:base.y+ry*ox+uy*oy,z:base.z+rz*ox+uz*oy};
    const l=Math.hypot(d.x,d.y,d.z)||1;return{x:d.x/l,y:d.y/l,z:d.z/l};
  }

  function falloff(weapon,distance){
    if(!weapon.fall)return 1;const [near,far,min]=weapon.fall;
    if(distance<=near)return 1;if(distance>=far)return min;return 1-(1-min)*((distance-near)/(far-near));
  }

  class Authority{
    constructor(options={}){
      this.world=options.world||makeFoundryWorld();this.players=new Map();this.projectiles=[];this.events=[];
      this.serverTimeMs=finite(options.startTimeMs,0);this.snapshotSeq=0;this.eventSeq=0;this.projectileSeq=0;
      this.roundActive=false;this.roundEnded=false;this.roundEndSeq=0;this.winnerId=null;
      this.metrics={acceptedInputs:0,droppedInputs:0,shots:0,hits:0,rockets:0};
    }

    addPlayer(id,options={}){
      id=safeId(id);if(!id||this.players.has(id)||this.players.size>=CFG.maxPlayers)return null;
      const defaultSpawn=this.world.duelSpawns[this.players.size]||this.world.spawns[this.players.size]||{x:0,y:0,z:0};
      const spawn={x:finite(options.x,defaultSpawn.x),y:finite(options.y,defaultSpawn.y),z:finite(options.z,defaultSpawn.z)};
      const player=makePlayer(id,options.name||id,spawn);this.players.set(id,player);this._facePlayers();this._record(player,this.serverTimeMs);
      this._event('joined',{playerId:id,name:player.name});return player;
    }

    removePlayer(id){
      id=safeId(id);if(!this.players.delete(id))return false;
      this._event('left',{playerId:id});this._checkRoundEnd('last_connected');return true;
    }

    _facePlayers(){
      const list=[...this.players.values()];if(list.length!==2)return;
      for(const [a,b] of [[list[0],list[1]],[list[1],list[0]]]){
        a.yaw=Math.atan2(-(b.x-a.x),-(b.z-a.z));a.input.yaw=a.yaw;
      }
    }

    startRound(){if(this.players.size!==2||this.roundEnded)return false;this.roundActive=true;return true;}

    receiveInput(id,raw,receivedAtMs=this.serverTimeMs){
      const player=this.players.get(safeId(id));if(!player||!player.alive)return{accepted:false,reason:'unknown_or_dead'};
      if(this.roundEnded)return{accepted:false,reason:'round_ended'};
      const input=sanitizeInput(raw);if(input.seq<=player.lastInputSeq){this.metrics.droppedInputs++;return{accepted:false,reason:'stale_input'};}
      player.lastInputSeq=input.seq;player.input=input;player.inputReceivedAt=finite(receivedAtMs,this.serverTimeMs);this.metrics.acceptedInputs++;return{accepted:true};
    }

    step(dtMs,nowMs){
      dtMs=clamp(finite(dtMs),0,50);this.serverTimeMs=Math.max(this.serverTimeMs,finite(nowMs,this.serverTimeMs+dtMs));const dt=dtMs/1000;
      for(const player of this.players.values())if(player.alive&&!this.roundEnded){
        this._weaponInput(player);integrateMovement(player,player.input,this.world,dt);this._record(player,this.serverTimeMs);
        this._tryFire(player);
      }
      this._stepProjectiles(dt);for(const player of this.players.values())this._record(player,this.serverTimeMs);
      this._checkRoundEnd('last_alive');
    }

    _weaponInput(player){
      const input=player.input;
      if(WEAPONS[input.weapon]&&input.weapon!==player.weapon){
        player.weapon=input.weapon;player.reloadUntil=0;player.nextFireAt=Math.max(player.nextFireAt,this.serverTimeMs+180);
        this._event('weapon',{playerId:player.id,weapon:player.weapon});
      }
      if(input.reloadId>player.lastReloadId){player.lastReloadId=input.reloadId;this._startReload(player);}
      if(player.reloadUntil&&this.serverTimeMs>=player.reloadUntil)this._finishReload(player);
    }

    _startReload(player){
      const weapon=WEAPONS[player.weapon],ammo=player.inventory[player.weapon];
      if(player.reloadUntil||ammo.ammo>=weapon.mag||ammo.reserve<=0)return false;
      player.reloadUntil=this.serverTimeMs+weapon.reload*1000;this._event('reload',{playerId:player.id,weapon:player.weapon});return true;
    }

    _finishReload(player){
      const weapon=WEAPONS[player.weapon],ammo=player.inventory[player.weapon],take=Math.min(weapon.mag-ammo.ammo,ammo.reserve);
      ammo.ammo+=take;ammo.reserve-=take;player.reloadUntil=0;
    }

    _tryFire(player){
      const weapon=WEAPONS[player.weapon],input=player.input,ammo=player.inventory[player.weapon];
      const edge=input.fireId>player.lastConsumedFireId,wants=weapon.auto?input.trigger:edge;
      if(!wants||player.reloadUntil||this.serverTimeMs<player.nextFireAt)return;
      if(ammo.ammo<=0){if(edge)player.lastConsumedFireId=input.fireId;this._startReload(player);return;}
      if(!weapon.auto)player.lastConsumedFireId=input.fireId;
      ammo.ammo--;player.nextFireAt=this.serverTimeMs+60000/weapon.rpm;this.metrics.shots++;
      if(weapon.kind==='rocket')this._spawnRocket(player,weapon);
      else this._fireHitscan(player,weapon);
      if(ammo.ammo<=0)this._startReload(player);
    }

    _sample(id,atMs){
      const p=this.players.get(id);if(!p||!p.history.length)return null;const h=p.history;
      if(atMs<=h[0].atMs)return{...h[0]};const last=h[h.length-1];if(atMs>=last.atMs)return{...last};
      let lo=0,hi=h.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(h[mid].atMs<=atMs)lo=mid;else hi=mid;}
      const a=h[lo],b=h[hi],t=(atMs-a.atMs)/Math.max(1,b.atMs-a.atMs);
      return{atMs,x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t),yaw:a.yaw,pitch:a.pitch,alive:a.alive&&b.alive};
    }

    _record(player,atMs){
      const sample={atMs,x:player.x,y:player.y,z:player.z,yaw:player.yaw,pitch:player.pitch,alive:player.alive};
      const last=player.history.at(-1);if(last&&last.atMs===atMs)player.history[player.history.length-1]=sample;else player.history.push(sample);
      const cutoff=atMs-CFG.historyMs;while(player.history.length>2&&player.history[1].atMs<cutoff)player.history.shift();
    }

    _rayPlayers(shooterId,o,d,max,atMs){
      let best=null,bestDistance=max;
      for(const player of this.players.values()){
        if(player.id===shooterId||!player.alive)continue;const past=atMs===undefined?player:this._sample(player.id,atMs);if(!past||!past.alive)continue;
        for(const hit of HITBOX){
          const box={x0:past.x-hit.hx,x1:past.x+hit.hx,y0:past.y+hit.y0,y1:past.y+hit.y1,z0:past.z-hit.hz,z1:past.z+hit.hz};
          const distance=rayBox(o,d,box);if(distance!==null&&distance<bestDistance){bestDistance=distance;best={player,hit,distance};}
        }
      }
      return best;
    }

    _fireHitscan(shooter,weapon){
      const requested=shooter.input.shotAtMs||shooter.inputReceivedAt||this.serverTimeMs;
      const shotAt=clamp(requested,this.serverTimeMs-CFG.maxRewindMs,this.serverTimeMs+CFG.futureShotToleranceMs);
      const past=this._sample(shooter.id,shotAt)||shooter,o={x:past.x,y:past.y+CFG.eye,z:past.z},base=dirFromAngles(shooter.input.yaw,shooter.input.pitch);
      const random=mulberry32(hash(`${shooter.id}:${++shooter.shotCounter}:${this.serverTimeMs}`)),rays=[],damages=new Map();
      for(let pellet=0;pellet<(weapon.pellets||1);pellet++){
        const d=spreadDir(base,weapon.spread,random),worldDistance=rayWorld(this.world,o,d,weapon.range),hit=this._rayPlayers(shooter.id,o,d,worldDistance,shotAt);
        const distance=hit?hit.distance:worldDistance,end={x:o.x+d.x*distance,y:o.y+d.y*distance,z:o.z+d.z*distance};
        rays.push({end,hit:!!hit,part:hit&&hit.hit.part,targetId:hit&&hit.player.id});
        if(hit){const damage=weapon.dmg*hit.hit.m*falloff(weapon,hit.distance),current=damages.get(hit.player.id)||{player:hit.player,amount:0,part:hit.hit.part,impact:end};current.amount+=damage;if(hit.hit.part==='HEAD')current.part='HEAD';damages.set(hit.player.id,current);}
      }
      this._event('fire',{playerId:shooter.id,weapon:weapon.id,origin:o,rays});
      for(const item of damages.values())this._damage(item.player,item.amount,shooter,item.part,item.impact,weapon.id);
    }

    _spawnRocket(shooter,weapon){
      const d=spreadDir(dirFromAngles(shooter.input.yaw,shooter.input.pitch),weapon.spread,mulberry32(hash(`${shooter.id}:rocket:${this.serverTimeMs}`)));
      const origin={x:shooter.x-d.x*.8,y:shooter.y+1.55,z:shooter.z-d.z*.8},id=`r${++this.projectileSeq}`;
      const projectile={id,ownerId:shooter.id,weapon:weapon.id,x:origin.x,y:origin.y,z:origin.z,vx:d.x*weapon.projectileSpeed,vy:d.y*weapon.projectileSpeed,vz:d.z*weapon.projectileSpeed,life:5};
      this.projectiles.push(projectile);this.metrics.rockets++;this._event('rocket_spawn',{playerId:shooter.id,projectileId:id,origin,d,weapon:weapon.id});
    }

    _stepProjectiles(dt){
      for(let i=this.projectiles.length-1;i>=0;i--){
        const projectile=this.projectiles[i],weapon=WEAPONS[projectile.weapon],speed=Math.hypot(projectile.vx,projectile.vy,projectile.vz)||1;
        const d={x:projectile.vx/speed,y:projectile.vy/speed,z:projectile.vz/speed},step=speed*dt,o={x:projectile.x,y:projectile.y,z:projectile.z};
        const worldDistance=rayWorld(this.world,o,d,step+.4),hit=this._rayPlayers(projectile.ownerId,o,d,Math.min(worldDistance,step+.4));
        projectile.x+=projectile.vx*dt;projectile.y+=projectile.vy*dt;projectile.z+=projectile.vz*dt;projectile.vy-=3*dt;projectile.life-=dt;
        if(hit||worldDistance<step+.4||projectile.life<=0||projectile.y<-10){
          const point={x:o.x+d.x*Math.min(hit?hit.distance:worldDistance,step),y:o.y+d.y*Math.min(hit?hit.distance:worldDistance,step),z:o.z+d.z*Math.min(hit?hit.distance:worldDistance,step)};
          const owner=this.players.get(projectile.ownerId);if(hit)this._damage(hit.player,weapon.dmg,owner,hit.hit.part,point,weapon.id);
          this._explode(point,weapon,owner,projectile.id);this.projectiles.splice(i,1);
        }
      }
    }

    _explode(point,weapon,owner,projectileId){
      const victims=[];
      for(const player of this.players.values())if(player.alive){
        const distance=Math.hypot(player.x-point.x,player.y+1-point.y,player.z-point.z);if(distance>=weapon.splashR)continue;
        const factor=(1-distance/weapon.splashR)*(player===owner?.35:1),amount=weapon.splash*factor;
        if(amount>0){this._damage(player,amount,owner,'BODY',{x:player.x,y:player.y+1,z:player.z},weapon.id);victims.push({playerId:player.id,amount:Math.round(amount)});}
      }
      this._event('explosion',{projectileId,playerId:owner&&owner.id,weapon:weapon.id,point,victims});
    }

    _damage(target,amount,attacker,part,impact,weapon){
      if(!target||!target.alive)return;const dealt=Math.min(target.hp,Math.max(0,Math.round(amount)));if(!dealt)return;
      target.hp=Math.max(0,target.hp-dealt);if(target.hp===0)target.alive=false;
      if(attacker&&target!==attacker&&target.hp===0){attacker.kills++;}
      this.metrics.hits++;this._event(target.hp===0?'death':'hit',{playerId:attacker&&attacker.id,targetId:target.id,weapon,damage:dealt,targetHp:target.hp,part,impact});
    }

    _checkRoundEnd(reason){
      if(!this.roundActive||this.roundEnded)return null;const alive=[...this.players.values()].filter(p=>p.alive);if(alive.length>1)return null;
      this.roundEnded=true;this.winnerId=alive[0]?alive[0].id:null;const event=this._event('round_end',{winnerId:this.winnerId,reason});this.roundEndSeq=event.seq;return event;
    }

    _event(type,data={}){const event={seq:++this.eventSeq,type,serverTimeMs:this.serverTimeMs,...data};this.events.push(event);return event;}

    createSnapshot(){
      const events=this.events;this.events=[];
      return {protocol:2,seq:++this.snapshotSeq,serverTimeMs:this.serverTimeMs,roundEnded:this.roundEnded,roundEndSeq:this.roundEndSeq,winnerId:this.winnerId,events,
        players:[...this.players.values()].map(p=>{const ammo=p.inventory[p.weapon];return{id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,yaw:p.yaw,pitch:p.pitch,hp:p.hp,alive:p.alive,weapon:p.weapon,ammo:ammo.ammo,reserve:ammo.reserve,reloadMs:Math.max(0,p.reloadUntil-this.serverTimeMs),lastProcessedInput:p.lastInputSeq};}),
        projectiles:this.projectiles.map(p=>({id:p.id,ownerId:p.ownerId,weapon:p.weapon,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,life:p.life}))};
    }
  }

  class ClientPredictor{
    constructor(id,world=makeFoundryWorld()){
      this.id=safeId(id);this.world=world;this.state=makePlayer(this.id,this.id,{x:0,y:0,z:0});this.history=[];this.lastSnapshotSeq=0;this.metrics={staleSnapshots:0,maxCorrection:0};
    }
    predict(input,dtMs,inputSeq){
      if(!this.state.alive)return false;const clean=sanitizeInput({...input,seq:inputSeq});integrateMovement(this.state,clean,this.world,clamp(dtMs,0,50)/1000);
      this.history.push({seq:inputSeq,input:clean,dtMs:clamp(dtMs,0,50)});if(this.history.length>240)this.history.shift();return true;
    }
    applySnapshot(snapshot){
      if(!snapshot||snapshot.protocol!==2||snapshot.seq<=this.lastSnapshotSeq){this.metrics.staleSnapshots++;return{accepted:false,reason:'stale_snapshot'};}
      const own=snapshot.players.find(p=>p.id===this.id);if(!own)return{accepted:false,reason:'missing_self'};this.lastSnapshotSeq=snapshot.seq;
      const error=Math.hypot(this.state.x-own.x,this.state.y-own.y,this.state.z-own.z);this.metrics.maxCorrection=Math.max(this.metrics.maxCorrection,error);
      Object.assign(this.state,{x:own.x,y:own.y,z:own.z,vx:own.vx,vy:own.vy,vz:own.vz,yaw:own.yaw,pitch:own.pitch,hp:own.hp,alive:own.alive,weapon:own.weapon,onGround:Math.abs(own.vy)<.01});
      this.history=this.history.filter(item=>item.seq>own.lastProcessedInput);
      if(!own.alive){this.history=[];return{accepted:true,error};}
      const replay=this.history.slice();this.history=[];
      for(const item of replay){integrateMovement(this.state,item.input,this.world,item.dtMs/1000);this.history.push(item);}
      return{accepted:true,error};
    }
  }

  class RemoteBuffer{
    constructor(delayMs=100){this.delayMs=delayMs;this.byId=new Map();}
    push(snapshot){
      if(!snapshot||!Array.isArray(snapshot.players))return;
      for(const player of snapshot.players){const list=this.byId.get(player.id)||[];list.push({t:snapshot.serverTimeMs,state:{...player}});while(list.length>24)list.shift();this.byId.set(player.id,list);}
    }
    at(id,hostTimeMs){
      const list=this.byId.get(id);if(!list||!list.length)return null;const target=hostTimeMs-this.delayMs;
      if(target<=list[0].t)return{...list[0].state};if(target>=list.at(-1).t)return{...list.at(-1).state};
      let a=list[0],b=list.at(-1);for(let i=1;i<list.length;i++)if(list[i].t>=target){a=list[i-1];b=list[i];break;}
      const t=(target-a.t)/Math.max(1,b.t-a.t),out={...b.state};for(const key of ['x','y','z','vx','vy','vz','yaw','pitch'])out[key]=lerp(a.state[key],b.state[key],t);return out;
    }
  }

  return {CFG,WEAPONS,WEAPON_IDS,HITBOX,Authority,ClientPredictor,RemoteBuffer,makeFoundryWorld,makeFlatWorld,sanitizeInput,dirFromAngles,rayBox,rayWorld};
});
