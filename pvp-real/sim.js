(function(root,factory){
  const api=factory(
    typeof module==='object'&&module.exports?require('../shared/pve-content.generated.js'):root.BlockRoyaleContent,
    typeof module==='object'&&module.exports?require('../shared/world.js'):root.BlockRoyaleWorld
  );
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PVPRealSim=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Content,SharedWorld){
  'use strict';

  if(!Content||!SharedWorld) throw new Error('Shared PvE content and world modules must load before PvP simulation');

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
  const WEAPONS=Object.fromEntries(Content.WEAPONS.map(source=>[source.id,Object.freeze({
    ...source,
    kind:source.proj?'rocket':source.melee?'melee':'hitscan',
    projectileSpeed:source.projSpeed,
    color:source.tracer||source.flash||0xf2b134,
  })]));
  const WEAPON_IDS=Object.keys(WEAPONS);
  const PETS=Object.fromEntries(Content.PETS.map(pet=>[pet.id,Object.freeze({...pet,tactic:Content.PET_TACTICS[pet.id]})]));
  const ARENAS=Object.fromEntries(Content.ARENAS.map(arena=>[arena.id,Object.freeze(arena)]));
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

  function makeLegacyFoundryWorld(){
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

  function makeArenaWorld(id='foundry'){return SharedWorld.makeWorld(ARENAS[id]?id:'foundry');}
  function makeFoundryWorld(){return makeArenaWorld('foundry');}

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
      jump:raw.jump===true,sprint:raw.sprint===true,trigger:raw.trigger===true,ads:raw.ads===true,
      fireId:Math.max(0,Math.floor(finite(raw.fireId))),shotAtMs:finite(raw.shotAtMs),
      reloadId:Math.max(0,Math.floor(finite(raw.reloadId))),
      weapon:WEAPONS[raw.weapon]?raw.weapon:'sidearm',
    };
  }

  function inventory(){
    const out={};for(const id of WEAPON_IDS){const weapon=WEAPONS[id];out[id]={ammo:weapon.mag>0?weapon.mag:-1,reserve:weapon.reserve||0};}return out;
  }

  function safeProfile(raw={}){
    const defaults=['sidearm','scatter','knife'];
    const loadout=[];
    for(const id of Array.isArray(raw.loadout)?raw.loadout:defaults)if(WEAPONS[id]&&!loadout.includes(id)&&loadout.length<3)loadout.push(id);
    for(const id of defaults)if(!loadout.includes(id)&&loadout.length<3)loadout.push(id);
    const pick=(list,id,fallback)=>list.some(item=>item.id===id)?id:fallback;
    return {loadout,pet:PETS[raw.pet]?raw.pet:null,
      hair:pick(Content.HAIRS,raw.hair,'crop'),outfit:pick(Content.OUTFITS,raw.outfit,'recruit'),acc:pick(Content.ACCS,raw.acc,'none')};
  }

  function makePlayer(id,name,spawn,profile={}){
    profile=safeProfile(profile);
    return {id,name:safeName(name),x:spawn.x,y:spawn.y,z:spawn.z,vx:0,vy:0,vz:0,yaw:0,pitch:0,onGround:true,
      hp:CFG.baseHp,alive:true,weapon:profile.loadout[0],loadout:profile.loadout,profile,inventory:inventory(),reloadUntil:0,nextFireAt:0,
      input:sanitizeInput({}),lastInputSeq:0,lastConsumedFireId:0,lastReloadId:0,jumpLatch:false,
      history:[],lastShotAt:-Infinity,lastDamageAt:-Infinity,shotCounter:0,kills:0,heat:0,heatLockUntil:0,triggerSince:0,chargeSince:0,burstLeft:0,poisonUntil:0,poisonNextAt:0,poisonOwnerId:null};
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
    const gravity=world.def&&world.def.mod&&world.def.mod.grav||1;
    player.vy-=CFG.gravity*gravity*dt;
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
    if(!world.def?.void&&player.y<0){player.y=0;player.vy=0;player.onGround=true;}
  }

  function integrateMovement(player,input,world,dt){
    const weapon=WEAPONS[player.weapon]||WEAPONS.sidearm;
    const pet=player.profile&&PETS[player.profile.pet];
    const petSpeed=pet&&pet.perk==='pack'&&!player.petDown?1.07:1;
    const arenaSpeed=world.def&&world.def.mod&&world.def.mod.speed||1;
    const chargeSlow=weapon.charge&&input.trigger?weapon.chargeSlow||1:1;
    const stunned=player.stunUntil&&player.stunUntil>player.nowMs;
    let speed=stunned?0:CFG.baseMoveSpeed*weapon.speed*petSpeed*arenaSpeed*chargeSlow*(input.sprint?CFG.sprint:1);
    const sy=Math.sin(input.yaw),cy=Math.cos(input.yaw);
    const wx=-sy*input.moveF+cy*input.moveR,wz=-cy*input.moveF-sy*input.moveR;
    const friction=world.def&&world.def.mod&&world.def.mod.friction;
    const accel=friction?Math.max(2,15*friction):15;
    player.vx=lerp(player.vx,wx*speed,clamp(accel*dt,0,1));player.vz=lerp(player.vz,wz*speed,clamp(accel*dt,0,1));
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
      this.world=options.world||makeArenaWorld('foundry');this.players=new Map();this.pets=new Map();this.projectiles=[];this.events=[];
      this.serverTimeMs=finite(options.startTimeMs,0);this.snapshotSeq=0;this.eventSeq=0;this.projectileSeq=0;
      this.roundActive=false;this.roundEnded=false;this.roundEndSeq=0;this.winnerId=null;
      this.random=mulberry32((this.world.def&&this.world.def.seed||11)^0x51ed270b);this.nextArenaEventAt=Infinity;this.arenaEvents=[];
      this.metrics={acceptedInputs:0,droppedInputs:0,shots:0,hits:0,rockets:0,petHits:0,hazardHits:0};
    }

    addPlayer(id,options={}){
      id=safeId(id);if(!id||this.players.has(id)||this.players.size>=CFG.maxPlayers)return null;
      const defaultSpawn=this.world.duelSpawns[this.players.size]||this.world.spawns[this.players.size]||{x:0,y:0,z:0};
      const spawn={x:finite(options.x,defaultSpawn.x),y:finite(options.y,defaultSpawn.y),z:finite(options.z,defaultSpawn.z)};
      const player=makePlayer(id,options.name||id,spawn,options.profile);this.players.set(id,player);this._makePet(player);this._facePlayers();this._record(player,this.serverTimeMs);
      this._event('joined',{playerId:id,name:player.name});return player;
    }

    removePlayer(id){
      id=safeId(id);if(!this.players.delete(id))return false;this.pets.delete(id);
      this._event('left',{playerId:id});this._checkRoundEnd('last_connected');return true;
    }

    _facePlayers(){
      const list=[...this.players.values()];if(list.length!==2)return;
      for(const [a,b] of [[list[0],list[1]],[list[1],list[0]]]){
        a.yaw=Math.atan2(-(b.x-a.x),-(b.z-a.z));a.input.yaw=a.yaw;
      }
    }

    startRound(){
      if(this.players.size!==2||this.roundEnded)return false;this.roundActive=true;
      const event=this.world.def&&this.world.def.event;if(event)this.nextArenaEventAt=this.serverTimeMs+(event.every[0]+this.random()*(event.every[1]-event.every[0]))*1000;
      return true;
    }

    receiveInput(id,raw,receivedAtMs=this.serverTimeMs){
      const player=this.players.get(safeId(id));if(!player||!player.alive)return{accepted:false,reason:'unknown_or_dead'};
      if(this.roundEnded)return{accepted:false,reason:'round_ended'};
      const input=sanitizeInput(raw);if(input.seq<=player.lastInputSeq){this.metrics.droppedInputs++;return{accepted:false,reason:'stale_input'};}
      player.lastInputSeq=input.seq;player.input=input;player.inputReceivedAt=finite(receivedAtMs,this.serverTimeMs);this.metrics.acceptedInputs++;return{accepted:true};
    }

    step(dtMs,nowMs){
      dtMs=clamp(finite(dtMs),0,50);this.serverTimeMs=Math.max(this.serverTimeMs,finite(nowMs,this.serverTimeMs+dtMs));const dt=dtMs/1000;
      for(const player of this.players.values())if(player.alive&&!this.roundEnded){
        player.nowMs=this.serverTimeMs;this._weaponInput(player);this._tickStatus(player,dt);integrateMovement(player,player.input,this.world,dt);this._applyWorldRules(player,dt);this._record(player,this.serverTimeMs);
        this._tryFire(player);
      }
      this._stepPets(dt);this._stepArenaEvents();this._stepProjectiles(dt);for(const player of this.players.values())this._record(player,this.serverTimeMs);
      this._checkRoundEnd('last_alive');
    }

    _makePet(owner){
      const def=PETS[owner.profile.pet];if(!def)return null;
      const tactic=def.tactic||Content.PET_TACTICS.dog,sy=Math.sin(owner.yaw),cy=Math.cos(owner.yaw);
      const pet={id:`pet_${owner.id}`,ownerId:owner.id,defId:def.id,x:owner.x+sy*tactic.back+cy*tactic.side,y:owner.y,z:owner.z+cy*tactic.back-sy*tactic.side,
        vx:0,vz:0,yaw:owner.yaw,hp:def.hp,maxHp:def.hp,alive:true,downUntil:0,nextAttackAt:0,targetId:null,retreatUntil:0,lastPoisonTarget:null};
      owner.petDown=false;this.pets.set(owner.id,pet);return pet;
    }

    _tickStatus(player,dt){
      const weapon=WEAPONS[player.weapon];
      if(weapon&&weapon.heat&&player.heat>0&&!player.input.trigger)player.heat=Math.max(0,player.heat-weapon.heat.cool*dt);
      if(player.poisonUntil>this.serverTimeMs&&this.serverTimeMs>=player.poisonNextAt){
        player.poisonNextAt=this.serverTimeMs+1000;const owner=this.players.get(player.poisonOwnerId);
        this._damage(player,4,owner,'BODY',{x:player.x,y:player.y+1,z:player.z},'pet');
      }
      const pet=PETS[player.profile.pet];
      if(pet&&pet.perk==='mend'&&!player.petDown&&this.serverTimeMs-player.lastDamageAt>=3000&&player.hp>0&&player.hp<CFG.baseHp)player.hp=Math.min(CFG.baseHp,player.hp+1.5*dt);
    }

    _applyWorldRules(player,dt){
      for(const hazard of this.world.hazards||[])if(player.x>=hazard.x0&&player.x<=hazard.x1&&player.z>=hazard.z0&&player.z<=hazard.z1&&player.y<.7){
        if(this.serverTimeMs>=(player.nextHazardAt||0)){player.nextHazardAt=this.serverTimeMs+250;this.metrics.hazardHits++;this._damage(player,hazard.dps*.25,null,'BODY',{x:player.x,y:player.y,z:player.z},'lava');}
      }
      if(this.world.def&&this.world.def.void&&player.y<-8)this._damage(player,CFG.baseHp*2,null,'BODY',{x:player.x,y:player.y,z:player.z},'void');
    }

    _petCanSee(pet,target){
      const dx=target.x-pet.x,dy=target.y+1-(pet.y+.7),dz=target.z-pet.z,distance=Math.hypot(dx,dy,dz)||1;
      return rayWorld(this.world,{x:pet.x,y:pet.y+.7,z:pet.z},{x:dx/distance,y:dy/distance,z:dz/distance},distance)>=distance-.45;
    }

    _stepPets(dt){
      for(const pet of this.pets.values()){
        const owner=this.players.get(pet.ownerId),def=PETS[pet.defId],tactic=def.tactic||Content.PET_TACTICS.dog;if(!owner)continue;
        if(!pet.alive){
          owner.petDown=true;
          if(this.serverTimeMs>=pet.downUntil&&owner.alive){pet.alive=true;pet.hp=pet.maxHp;owner.petDown=false;pet.x=owner.x;pet.y=owner.y;pet.z=owner.z;this._event('pet_revive',{playerId:owner.id,petId:pet.id,pet:def.id});}
          continue;
        }
        if(!owner.alive)continue;
        const enemies=[...this.players.values()].filter(player=>player.id!==owner.id&&player.alive);
        let target=this.players.get(pet.targetId),targetDistance=target?Math.hypot(target.x-owner.x,target.z-owner.z):Infinity;
        if(!target||!target.alive||targetDistance>tactic.leash)target=null;
        if(!target){target=enemies.filter(player=>Math.hypot(player.x-owner.x,player.z-owner.z)<=tactic.acquire&&this._petCanSee(pet,player)).sort((a,b)=>{
          if(def.id==='raptor')return a.hp-b.hp;return Math.hypot(a.x-pet.x,a.z-pet.z)-Math.hypot(b.x-pet.x,b.z-pet.z);
        })[0]||null;}
        pet.targetId=target&&target.id;
        const sy=Math.sin(owner.yaw),cy=Math.cos(owner.yaw),formation={x:owner.x+sy*tactic.back+cy*tactic.side,z:owner.z+cy*tactic.back-sy*tactic.side};
        let tx=target?target.x:formation.x,tz=target?target.z:formation.z;
        if(pet.retreatUntil>this.serverTimeMs&&target){const dx=pet.x-target.x,dz=pet.z-target.z,length=Math.hypot(dx,dz)||1;tx=pet.x+dx/length*4.5;tz=pet.z+dz/length*4.5;}
        const dx=tx-pet.x,dz=tz-pet.z,length=Math.hypot(dx,dz)||1,reach=Math.round(def.range*.75*10)/10,stop=target?reach*.72:.65;
        if(Math.hypot(pet.x-owner.x,pet.z-owner.z)>tactic.leash+6){pet.x=formation.x;pet.z=formation.z;pet.y=owner.y;}
        else if(length>stop){const step=Math.min(length-stop,def.speed*dt),nx=pet.x+dx/length*step,nz=pet.z+dz/length*step,ny=groundAt(this.world.boxes,nx,nz,pet.y+3);if(SharedWorld.freeAt(this.world,nx,ny+.02,nz,.3,Math.max(.7,def.scale||1))){pet.x=nx;pet.z=nz;pet.y=ny;}}
        pet.yaw=Math.atan2(-dx,-dz);
        if(target&&this._petCanSee(pet,target)&&Math.hypot(target.x-pet.x,target.z-pet.z)<reach&&this.serverTimeMs>=pet.nextAttackAt){
          pet.nextAttackAt=this.serverTimeMs+def.cd*1000;this.metrics.petHits++;
          this._damage(target,def.dmg,owner,'BODY',{x:target.x,y:target.y+1,z:target.z},'pet');
          if(def.poison&&target.alive){target.poisonUntil=this.serverTimeMs+def.poison.t*1000;target.poisonNextAt=this.serverTimeMs+1000;target.poisonOwnerId=owner.id;}
          if(def.perk==='apex'&&target.alive){const ax=target.x-pet.x,az=target.z-pet.z,l=Math.hypot(ax,az)||1;target.vx+=ax/l*5;target.vz+=az/l*5;target.vy+=2.4;}
          if(tactic.retreat)pet.retreatUntil=this.serverTimeMs+tactic.retreat*1000;
          this._event('pet_attack',{playerId:owner.id,targetId:target.id,petId:pet.id,pet:def.id,damage:def.dmg,targetHp:Math.round(target.hp)});
        }
      }
    }

    _scheduleArenaEvent(){
      const def=this.world.def,event=def&&def.event;if(!event)return;
      const radius=Math.max(4,this.world.H*.65),angle=this.random()*Math.PI*2,range=this.random()*radius;
      const item={id:`a${++this.projectileSeq}`,type:event.type,x:Math.cos(angle)*range,z:Math.sin(angle)*range,r:event.r,dmg:event.dmg,impactAt:this.serverTimeMs+1000};
      this.arenaEvents.push(item);this._event('arena_warning',{...item,label:event.label||event.type.toUpperCase()});
      this.nextArenaEventAt=this.serverTimeMs+(event.every[0]+this.random()*(event.every[1]-event.every[0]))*1000;
    }

    _stepArenaEvents(){
      if(this.roundEnded)return;if(this.serverTimeMs>=this.nextArenaEventAt)this._scheduleArenaEvent();
      for(let i=this.arenaEvents.length-1;i>=0;i--){const event=this.arenaEvents[i];if(this.serverTimeMs<event.impactAt)continue;
        for(const player of this.players.values())if(player.alive&&Math.hypot(player.x-event.x,player.z-event.z)<event.r){this.metrics.hazardHits++;this._damage(player,event.dmg,null,'BODY',{x:player.x,y:player.y+1,z:player.z},event.type);}
        this._event('arena_impact',{...event});this.arenaEvents.splice(i,1);
      }
    }

    _weaponInput(player){
      const input=player.input;
      if(WEAPONS[input.weapon]&&player.loadout.includes(input.weapon)&&input.weapon!==player.weapon){
        player.weapon=input.weapon;player.reloadUntil=0;player.nextFireAt=Math.max(player.nextFireAt,this.serverTimeMs+180);
        player.burstLeft=0;player.chargeSince=0;player.triggerSince=0;
        this._event('weapon',{playerId:player.id,weapon:player.weapon});
      }
      if(input.reloadId>player.lastReloadId){player.lastReloadId=input.reloadId;this._startReload(player);}
      if(player.reloadUntil&&this.serverTimeMs>=player.reloadUntil)this._finishReload(player);
    }

    _startReload(player){
      const weapon=WEAPONS[player.weapon],ammo=player.inventory[player.weapon];
      if(weapon.mag<=0||player.reloadUntil||ammo.ammo>=weapon.mag||ammo.reserve<=0)return false;
      const duration=weapon.shellReload?weapon.shellReload*Math.min(weapon.mag-ammo.ammo,ammo.reserve):weapon.reload;
      player.reloadUntil=this.serverTimeMs+duration*1000;this._event('reload',{playerId:player.id,weapon:player.weapon});return true;
    }

    _finishReload(player){
      const weapon=WEAPONS[player.weapon],ammo=player.inventory[player.weapon],take=Math.min(weapon.mag-ammo.ammo,ammo.reserve);
      ammo.ammo+=take;ammo.reserve-=take;player.reloadUntil=0;
    }

    _tryFire(player){
      const weapon=WEAPONS[player.weapon],input=player.input,ammo=player.inventory[player.weapon];
      const edge=input.fireId>player.lastConsumedFireId;
      if(input.trigger&&!player.triggerSince)player.triggerSince=this.serverTimeMs;
      if(!input.trigger){player.triggerSince=0;player.chargeSince=0;}
      if(weapon.charge&&input.trigger&&!player.chargeSince)player.chargeSince=this.serverTimeMs;
      if(weapon.burst&&edge){player.lastConsumedFireId=input.fireId;player.burstLeft=weapon.burst;}
      let wants=weapon.burst?player.burstLeft>0:weapon.auto?input.trigger:edge;
      if(weapon.spinup&&input.trigger&&this.serverTimeMs-player.triggerSince<weapon.spinup*1000)wants=false;
      if(weapon.charge&&input.trigger&&this.serverTimeMs-player.chargeSince<weapon.charge*1000)wants=false;
      if(weapon.heat&&this.serverTimeMs<player.heatLockUntil)wants=false;
      if(!wants||player.reloadUntil||this.serverTimeMs<player.nextFireAt)return;
      if(weapon.mag>0&&ammo.ammo<=0){if(edge)player.lastConsumedFireId=input.fireId;this._startReload(player);return;}
      if(!weapon.auto&&!weapon.burst)player.lastConsumedFireId=input.fireId;
      if(weapon.mag>0)ammo.ammo--;if(weapon.burst)player.burstLeft--;
      if(weapon.heat){player.heat+=weapon.heat.per;if(player.heat>=100){player.heat=100;player.heatLockUntil=this.serverTimeMs+weapon.heat.lock*1000;this._event('overheat',{playerId:player.id,weapon:weapon.id});}}
      if(weapon.charge)player.chargeSince=this.serverTimeMs;
      player.nextFireAt=this.serverTimeMs+60000/weapon.rpm;this.metrics.shots++;
      if(weapon.kind==='rocket')this._spawnRocket(player,weapon);
      else this._fireHitscan(player,weapon);
      if(weapon.mag>0&&ammo.ammo<=0)this._startReload(player);
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
      for(const pet of this.pets.values()){
        if(pet.ownerId===shooterId||!pet.alive)continue;const def=PETS[pet.defId],scale=def.scale||1;
        let hx=.25,hz=.25,height=.5;for(const part of def.parts){hx=Math.max(hx,(Math.abs(part.x)+part.w/2)*scale);hz=Math.max(hz,(Math.abs(part.z)+part.d/2)*scale);height=Math.max(height,(part.y+part.h/2)*scale);}
        const distance=rayBox(o,d,{x0:pet.x-hx,x1:pet.x+hx,y0:pet.y,y1:pet.y+height,z0:pet.z-hz,z1:pet.z+hz});
        if(distance!==null&&distance<bestDistance){bestDistance=distance;best={pet,hit:{part:'PET',m:1},distance};}
      }
      return best;
    }

    _fireHitscan(shooter,weapon){
      const requested=shooter.input.shotAtMs||shooter.inputReceivedAt||this.serverTimeMs;
      const shotAt=clamp(requested,this.serverTimeMs-CFG.maxRewindMs,this.serverTimeMs+CFG.futureShotToleranceMs);
      const past=this._sample(shooter.id,shotAt)||shooter,o={x:past.x,y:past.y+CFG.eye,z:past.z},base=dirFromAngles(shooter.input.yaw,shooter.input.pitch);
      let spread=weapon.spread||0;
      if(weapon.hipMult&&!shooter.input.ads)spread*=weapon.hipMult;
      if(weapon.bipod&&Math.hypot(shooter.vx,shooter.vz)<.15)spread*=weapon.bipod.spread;
      if(weapon.bloom){shooter.bloom=Math.min(weapon.bloom.max,(shooter.bloom||0)+weapon.bloom.per);spread+=shooter.bloom;}
      const random=mulberry32(hash(`${shooter.id}:${++shooter.shotCounter}:${this.serverTimeMs}`)),rays=[],damages=new Map();
      for(let pellet=0;pellet<(weapon.pellets||1);pellet++){
        const d=spreadDir(base,spread,random),worldDistance=rayWorld(this.world,o,d,weapon.range),hit=this._rayPlayers(shooter.id,o,d,worldDistance,shotAt);
        const distance=hit?hit.distance:worldDistance,end={x:o.x+d.x*distance,y:o.y+d.y*distance,z:o.z+d.z*distance};
        const target=hit&&(hit.player||hit.pet);rays.push({end,hit:!!hit,part:hit&&hit.hit.part,targetId:target&&target.id,targetType:hit&&hit.pet?'pet':'player'});
        if(hit){let damage=weapon.dmg*hit.hit.m*falloff(weapon,hit.distance);
          if(hit.player&&weapon.melee&&weapon.backstab){const toShooter=Math.atan2(-(shooter.x-hit.player.x),-(shooter.z-hit.player.z)),facing=Math.cos(normAngle(toShooter-hit.player.yaw));if(facing<-.35)damage*=weapon.backstab;}
          const current=damages.get(target.id)||{player:hit.player,pet:hit.pet,amount:0,part:hit.hit.part,impact:end};current.amount+=damage;if(hit.hit.part==='HEAD')current.part='HEAD';damages.set(target.id,current);}
      }
      this._event('fire',{playerId:shooter.id,weapon:weapon.id,origin:o,rays,rewindMs:Math.max(0,Math.round(this.serverTimeMs-shotAt))});
      for(const item of damages.values()){
        const target=item.player||item.pet,before=target.hp;if(item.pet)this._damagePet(item.pet,item.amount,shooter,weapon.id);else this._damage(item.player,item.amount,shooter,item.part,item.impact,weapon.id);const dealt=Math.max(0,before-target.hp);
        if(weapon.leech&&dealt>0)shooter.hp=Math.min(CFG.baseHp,shooter.hp+weapon.leech);
        if(item.player&&weapon.knock&&item.player.alive){const dx=item.player.x-shooter.x,dz=item.player.z-shooter.z,l=Math.hypot(dx,dz)||1;item.player.vx+=dx/l*weapon.knock;item.player.vz+=dz/l*weapon.knock;item.player.vy+=weapon.knock*.24;}
        if(item.player&&weapon.stun&&item.player.alive)item.player.stunUntil=this.serverTimeMs+weapon.stun*1000;
      }
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
          const owner=this.players.get(projectile.ownerId);if(hit){if(hit.pet)this._damagePet(hit.pet,weapon.dmg,owner,weapon.id);else this._damage(hit.player,weapon.dmg,owner,hit.hit.part,point,weapon.id);}
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
        if(player===owner&&amount>0){const dx=player.x-point.x,dz=player.z-point.z,l=Math.hypot(dx,dz)||1;player.vx+=dx/l*9;player.vz+=dz/l*9;player.vy+=5;}
      }
      for(const pet of this.pets.values())if(pet.alive){const distance=Math.hypot(pet.x-point.x,pet.y+.6-point.y,pet.z-point.z);if(distance<weapon.splashR)this._damagePet(pet,weapon.splash*(1-distance/weapon.splashR),owner,weapon.id);}
      this._event('explosion',{projectileId,playerId:owner&&owner.id,weapon:weapon.id,point,victims});
    }

    _damagePet(pet,amount,attacker,weapon){
      if(!pet||!pet.alive)return;const dealt=Math.min(pet.hp,Math.max(0,Math.round(amount)));if(!dealt)return;
      pet.hp-=dealt;if(pet.hp<=0){pet.hp=0;pet.alive=false;pet.downUntil=this.serverTimeMs+18000;const owner=this.players.get(pet.ownerId);if(owner)owner.petDown=true;}
      this._event(pet.alive?'pet_hit':'pet_down',{playerId:attacker&&attacker.id,targetId:pet.ownerId,petId:pet.id,pet:pet.defId,weapon,damage:dealt,petHp:pet.hp});
    }

    _damage(target,amount,attacker,part,impact,weapon){
      if(!target||!target.alive)return;const guardian=PETS[target.profile&&target.profile.pet];if(guardian&&guardian.perk==='guardian'&&!target.petDown)amount*=.9;
      const dealt=Math.min(target.hp,Math.max(0,Math.round(amount)));if(!dealt)return;target.lastDamageAt=this.serverTimeMs;
      target.hp=Math.max(0,target.hp-dealt);if(target.hp===0)target.alive=false;
      if(attacker&&target!==attacker&&target.hp===0){attacker.kills++;}
      this.metrics.hits++;this._event(target.hp===0?'death':'hit',{playerId:attacker&&attacker.id,targetId:target.id,weapon,damage:dealt,targetHp:target.hp,part,impact});
    }

    _checkRoundEnd(reason){
      if(!this.roundActive||this.roundEnded)return null;const alive=[...this.players.values()].filter(p=>p.alive);if(alive.length>1)return null;
      this.roundEnded=true;this.winnerId=alive[0]?alive[0].id:null;const event=this._event('round_end',{winnerId:this.winnerId,reason});this.roundEndSeq=event.seq;return event;
    }

    _event(type,data={}){const event={seq:++this.eventSeq,serverTimeMs:this.serverTimeMs,...data,type};this.events.push(event);return event;}

    createSnapshot(){
      const events=this.events;this.events=[];
      return {protocol:3,contentVersion:Content.CONTENT_VERSION,world:this.world.id,seq:++this.snapshotSeq,serverTimeMs:this.serverTimeMs,roundEnded:this.roundEnded,roundEndSeq:this.roundEndSeq,winnerId:this.winnerId,events,
        players:[...this.players.values()].map(p=>{const ammo=p.inventory[p.weapon];return{id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,yaw:p.yaw,pitch:p.pitch,hp:p.hp,alive:p.alive,weapon:p.weapon,loadout:p.loadout,profile:p.profile,heat:p.heat,ammo:ammo.ammo,reserve:ammo.reserve,reloadMs:Math.max(0,p.reloadUntil-this.serverTimeMs),lastProcessedInput:p.lastInputSeq};}),
        pets:[...this.pets.values()].map(p=>({id:p.id,ownerId:p.ownerId,defId:p.defId,x:p.x,y:p.y,z:p.z,yaw:p.yaw,hp:p.hp,maxHp:p.maxHp,alive:p.alive,targetId:p.targetId})),
        arenaEvents:this.arenaEvents.map(event=>({...event})),projectiles:this.projectiles.map(p=>({id:p.id,ownerId:p.ownerId,weapon:p.weapon,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,life:p.life}))};
    }
  }

  class ClientPredictor{
    constructor(id,world=makeArenaWorld('foundry'),profile={}){
      this.id=safeId(id);this.world=world;this.state=makePlayer(this.id,this.id,{x:0,y:0,z:0},profile);this.history=[];this.lastSnapshotSeq=0;this.metrics={staleSnapshots:0,maxCorrection:0};
    }
    predict(input,dtMs,inputSeq){
      if(!this.state.alive)return false;const clean=sanitizeInput({...input,seq:inputSeq});integrateMovement(this.state,clean,this.world,clamp(dtMs,0,50)/1000);
      this.history.push({seq:inputSeq,input:clean,dtMs:clamp(dtMs,0,50)});if(this.history.length>240)this.history.shift();return true;
    }
    applySnapshot(snapshot){
      if(!snapshot||snapshot.protocol!==3||snapshot.contentVersion!==Content.CONTENT_VERSION||snapshot.seq<=this.lastSnapshotSeq){this.metrics.staleSnapshots++;return{accepted:false,reason:'stale_snapshot'};}
      const own=snapshot.players.find(p=>p.id===this.id);if(!own)return{accepted:false,reason:'missing_self'};this.lastSnapshotSeq=snapshot.seq;
      const error=Math.hypot(this.state.x-own.x,this.state.y-own.y,this.state.z-own.z);this.metrics.maxCorrection=Math.max(this.metrics.maxCorrection,error);
      Object.assign(this.state,{x:own.x,y:own.y,z:own.z,vx:own.vx,vy:own.vy,vz:own.vz,yaw:own.yaw,pitch:own.pitch,hp:own.hp,alive:own.alive,weapon:own.weapon,loadout:own.loadout,profile:own.profile,heat:own.heat,onGround:Math.abs(own.vy)<.01});
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

  return {CFG,CONTENT_VERSION:Content.CONTENT_VERSION,CONTENT:Content,WEAPONS,WEAPON_IDS,PETS,ARENAS,HITBOX,Authority,ClientPredictor,RemoteBuffer,makeArenaWorld,makeFoundryWorld,makeFlatWorld,safeProfile,sanitizeInput,dirFromAngles,rayBox,rayWorld};
});
