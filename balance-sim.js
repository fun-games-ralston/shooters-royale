/* =====================================================================
   balance-sim.js — the only balance harness that exists.

   It drives a *simulated player* inside the real, running game, so every
   number it produces comes from the same code the kids play.

   How to use it:
     1. Serve the folder:   python3 -m http.server 8123
     2. Open http://localhost:8123/index.html
     3. Open the browser console and paste:

          fetch('/balance-sim.js').then(r=>r.text()).then(t=>eval(t))

     4. Then run, for example:

          sweep(['ak47','smg','sniper'], 10)              // 10 matches each
          simMatch('bazooka','sidearm','claws','regular',7,'trex')
          petSweep(PETS.map(p=>p.id), 5)                 // compare all companions

   sweep(list, n, secondary, melee) returns average kills, win % and damage.

   WHAT IT IS GOOD AT
     - Catching runtime errors across every weapon and arena.
     - Spotting a weapon that is doing almost nothing (the Bazooka's rockets
       used to detonate three metres from the muzzle; this is how that surfaced).
     - Rough ordering: is a 2,600-coin gun clearly worse than the free pistol?

   WHAT IT IS BAD AT
     - It tracks targets with a smoothed lag and a fixed error cone. It never
       panics, never gets flanked on purpose, and never deliberately ambushes.
       That flatters precise semi-autos and punishes the Scattergun and melee.
     - It picks between slot 1 and slot 2 by comparing ranges, which is cruder
       than what a person does.
     - Ten matches is roughly +/- 15% noise. Treat the output as directional.
   ===================================================================== */
window.__errs=[]; window.addEventListener('error',e=>__errs.push(String(e.message)+' @'+e.lineno));
window.simMatch=function(primary,secondary,melee,skill,bots,pet){
  S.cfg.mode='trial'; S.cfg.bots=bots||7; S.cfg.skill=skill||'regular'; S.cfg.time=6;
  S.own.weapons=WEAPONS.map(w=>w.id); S.coins=999999;
  S.own.pet=PETS.map(p=>p.id);
  S.food={steak:4,gapple:2};
  S.eq.primary=primary; S.eq.secondary=secondary; S.eq.melee=melee;
  S.eq.pet=pet||null;
  startMatch(); G.grace=0;
  const errs=[]; let hpMin=200, cur=null, react=0, aim={x:0,y:0,z:0}, jitT=0, jx=0;
  const DT=0.033;
  const pref=w=> w.melee?2 : (w.id==='sniper'||w.id==='reaper')?45 : w.fall?w.fall[0]*0.8 : 30;
  for(let i=0;i<12000 && !G.over && G.on;i++){
    const p=G.pl; let best=null,bd=1e9;
    for(const o of G.ents){ if(!o.alive||o.isPlayer) continue;
      const d=Math.hypot(o.pos.x-p.pos.x,o.pos.z-p.pos.z);
      if(d<bd&&los(p,o)){bd=d;best=o;} }
    if(best!==cur){ cur=best; react=0.28+Math.random()*0.22;
      if(best) aim={x:best.pos.x,y:best.pos.y+1.2,z:best.pos.z}; }
    react-=DT;
    keys['KeyW']=keys['KeyS']=keys['KeyA']=keys['KeyD']=false;
    if(best){
      const wantMelee = bd<4 && p.slots[2];
      const wantSec = !wantMelee && p.slots[1] && Math.abs(bd-pref(W[p.slots[1]]))<Math.abs(bd-pref(W[p.slots[0]]));
      const tgt = wantMelee?2:(wantSec?1:0);
      if(p.slot!==tgt&&p.slots[tgt]){ p.slot=tgt; p.wep=p.slots[tgt]; p.ammo=p.ammoBy[p.wep].a; p.bloom=0; }
      const wp=W[p.wep], want=pref(wp);
      const towards = bd>want*1.15, away = bd<want*0.55 && !wp.melee;
      keys['KeyW']=towards; keys['KeyS']=away;
      if(!towards&&!away){ jitT-=DT; if(jitT<=0){jitT=0.9; jx=Math.random()<.5;} keys[jx?'KeyA':'KeyD']=true; }
      const err=0.5+bd*0.02;
      const tx=best.pos.x+(Math.random()-.5)*err, tz=best.pos.z+(Math.random()-.5)*err;
      // splash weapons: any player learns within a minute to aim at the feet
      const ty=wp.splash ? best.pos.y+0.2+(Math.random()-.5)*err*0.4
        : best.pos.y+(Math.random()<0.22?1.62:1.10)+(Math.random()-.5)*err*0.6;
      const k=Math.min(1,DT*7.5);
      aim.x+=(tx-aim.x)*k; aim.y+=(ty-aim.y)*k; aim.z+=(tz-aim.z)*k;
      G.yaw=Math.atan2(-(aim.x-p.pos.x),-(aim.z-p.pos.z));
      G.pitch=Math.atan2(aim.y-(p.pos.y+EYE),Math.hypot(aim.x-p.pos.x,aim.z-p.pos.z));
      const inRange = bd < (wp.melee?wp.range*0.85:(wp.fall?wp.fall[1]:wp.range));
      const shooting = react<=0 && inRange;
      mouseDown=shooting; wantFire=shooting;
      // players hold right-mouse at range whether or not the gun has a scope
      G.ads = shooting && !wp.noAds && !wp.melee && bd>(wp.scope?18:12);
      if(wp.charge&&shooting) p.chargeT+=DT;
      if(wp.mag>0 && p.ammo<=0 && p.reloadT<=0) startReload(p);
    } else {
      mouseDown=false; G.ads=false; keys['KeyW']=true;
      jitT-=DT; if(jitT<=0){ jitT=1.4; G.yaw=Math.random()*6.28; }
      const wp=W[p.wep];
      if(wp.mag>0&&p.ammo<wp.mag&&p.reloadT<=0) startReload(p);
    }
    if(G.pl.hp<95){ const kf=Object.keys(G.pl.food).filter(x=>G.pl.food[x]>0)[0]; if(kf&&G.pl.eatT<=0) eatFood(kf); }
    try{ tick(DT); }catch(e){ errs.push('t'+i+': '+e.message+' | '+(e.stack||'').split('\n')[1]); break; }
    hpMin=Math.min(hpMin,G.pl.hp);
  }
  for(const kk in keys) keys[kk]=false;
  mouseDown=false; G.ads=false;
  return {over:G.over, win:G.pl.alive&&G.ents.filter(e=>e.alive).length===1, kills:G.kills, petKills:G.petKills||0, hs:G.hs,
    dmg:Math.round(G.dmgDone), hp:Math.round(G.pl.hp), hpMin:Math.round(hpMin), petHp:G.pet?Math.round(G.pet.hp):null,
    petDown:G.pet?G.pet.down>0:false, errs};
};
window.petSweep=function(list,n){
  const out={};
  for(const id of list){
    let k=0,pk=0,w=0,d=0,down=0,e=0;
    for(let i=0;i<n;i++){ const r=simMatch('sidearm',null,'knife','regular',7,id);
      k+=r.kills; pk+=r.petKills; w+=r.win?1:0; d+=r.dmg; down+=r.petDown?1:0; if(r.errs.length)e++; }
    out[id]={kills:+(k/n).toFixed(1),petKills:+(pk/n).toFixed(1),winPct:Math.round(w/n*100),
      dmg:Math.round(d/n),downPct:Math.round(down/n*100),errs:e};
  }
  return out;
};
window.sweep=function(list,n,sec,mel){
  const out={};
  for(const id of list){
    let k=0,w=0,d=0,e=0;
    for(let i=0;i<n;i++){ const r=simMatch(id,sec||null,mel||'knife','regular',7);
      k+=r.kills; w+=r.win?1:0; d+=r.dmg; if(r.errs.length) e++; }
    out[id]={kills:+(k/n).toFixed(1), winPct:Math.round(w/n*100), dmg:Math.round(d/n), errs:e};
  }
  return out;
};
'sim ready';
