(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./pve-content.generated.js'):root.BlockRoyaleContent);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BlockRoyaleWorld=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Content){
  'use strict';

  if(!Content) throw new Error('Block Royale content must load before the shared world builder');
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const mulberry32=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  const shadeHex=(n,f)=>{const r=clamp(((n>>16&255)*f)|0,0,255),g=clamp(((n>>8&255)*f)|0,0,255),b=clamp(((n&255)*f)|0,0,255);return(r<<16)|(g<<8)|b;};

  function groundAt(boxes,x,z,fromY=60){
    let best=0;
    for(const b of boxes) if(x>=b.x0-.3&&x<=b.x1+.3&&z>=b.z0-.3&&z<=b.z1+.3&&b.y1<=fromY+.01&&b.y1>best) best=b.y1;
    return best;
  }

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

  function freeAt(world,x,y,z,r=.34,h=1.92){
    for(const b of world.boxes) if(x-r<b.x1&&x+r>b.x0&&z-r<b.z1&&z+r>b.z0&&y<b.y1&&y+h>b.y0)return false;
    return true;
  }

  function findDuelSpawns(world){
    const candidates=world.spawns.filter(s=>freeAt(world,s.x,s.y+.02,s.z));
    let best=null,bestScore=-Infinity;
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
      const a=candidates[i],b=candidates[j],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,dist=Math.hypot(dx,dy,dz)||1;
      const d={x:dx/dist,y:dy/dist,z:dz/dist};
      const clear=rayWorld(world,{x:a.x,y:a.y+1.66,z:a.z},d,dist)>=dist-.5;
      const score=(clear?1000:0)+dist-Math.abs(a.y-b.y)*4;
      if(score>bestScore){bestScore=score;best=[a,b];}
    }
    return best||candidates.slice(0,2);
  }

  function propRock(add,R,x,y,z,scale,col){
    const s=scale||1;
    add(x,y+.55*s,z,2.2*s,1.5*s,2*s,col);
    add(x-.7*s,y+.4*s,z+.5*s,1.2*s,1*s,1.1*s,shadeHex(col,1.12));
    add(x+.6*s,y+.75*s,z-.4*s,1*s,1.6*s,.9*s,shadeHex(col,.86));
    if(R()<.5)add(x+.2*s,y+1.5*s,z+.2*s,.8*s,.7*s,.8*s,shadeHex(col,1.2));
  }
  function propTree(add,R,x,y,z,h,trunk,leaf){
    const t=h*.55;add(x,y+t/2,z,.5,t,.5,trunk);add(x,y+t+.7,z,2.6,1.5,2.6,leaf);add(x,y+t+1.9,z,1.7,1.1,1.7,shadeHex(leaf,1.12));
    if(R()<.6)add(x,y+t+2.7,z,.9,.7,.9,shadeHex(leaf,1.24));
  }
  function propDeadTree(add,R,x,y,z,h,col){
    add(x,y+h/2,z,.42,h,.42,col);const a=R()*3;
    add(x+Math.cos(a)*.8,y+h*.75,z+Math.sin(a)*.8,1.5,.28,.28,col,0,false);
    add(x-Math.cos(a)*.7,y+h*.55,z-Math.sin(a)*.7,.28,.28,1.4,col,0,false);
  }
  function propCrystal(add,R,x,y,z,h,col){
    add(x,y+h/2,z,.7,h,.7,col,.35);add(x+.5,y+h*.35,z-.3,.45,h*.6,.45,col,.45,false);add(x-.4,y+h*.28,z+.4,.4,h*.5,.4,col,.3,false);
  }
  function propRiver(add,R,H,col,width){
    const w=width||6,wob=[];for(let i=-1;i<=1;i++)wob.push((R()-.5)*H*.5);
    for(let i=0;i<14;i++){const t=i/13,z=-H*.85+t*H*1.7,x=wob[0]*(1-t)*(1-t)+wob[1]*2*t*(1-t)+wob[2]*t*t;add(x,.06,z,w,.12,H*1.7/14+.4,col,.22,false);}
  }

  function themeDecor(def,R,H,add){
    if(def.id==='foundry'){
      for(let i=0;i<7;i++){const x=(R()-.5)*H*1.6,z=(R()-.5)*H*1.6;add(x,3,z,1.4,6,1.4,0x50412e);add(x,6.4,z,2.2,1.2,2.2,0xe0553a,.4);}
      for(let i=0;i<6;i++)propRock(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,.8+R()*.6,0x413a31);
    }else if(def.id==='sandpit'){
      for(let i=0;i<7;i++)add((R()-.5)*H*1.7,.5,(R()-.5)*H*1.7,1.2,1,1.2,0x8f7042);
      for(let i=0;i<8;i++)propRock(add,R,(R()-.5)*H*1.75,0,(R()-.5)*H*1.75,.9+R()*.9,0xa8834c);
      for(let i=0;i<6;i++)propDeadTree(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,3+R()*2.4,0x7a5f39);propRiver(add,R,H,0xc9a464,7);
    }else if(def.id==='grid'){
      for(let i=0;i<24;i++){const t=(i/23-.5)*def.size;add(t,.03,0,.16,.06,def.size,0x3df2c4,.9,false);add(0,.03,t,def.size,.06,.16,0x3df2c4,.9,false);}
    }else if(def.id==='atrium'){
      for(let i=0;i<7;i++){const x=(R()-.5)*H*1.6,z=(R()-.5)*H*1.6;add(x,.6,z,2.6,1.2,2.6,0x9a9184);propTree(add,R,x,1.2,z,4.4+R()*1.8,0x6b4f2e,0x4f8f3a);}
      for(let i=0;i<5;i++)propRock(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,.7,0xb9b2a5);propRiver(add,R,H,0x5fa8d8,5);
    }else if(def.id==='frostbite'){
      for(let i=0;i<9;i++){const x=(R()-.5)*H*1.7,z=(R()-.5)*H*1.7,h=2+R()*5;add(x,h/2,z,.9+R(),h,.9+R(),0xbfe8ff,.12);}
      for(let i=0;i<7;i++)propRock(add,R,(R()-.5)*H*1.75,0,(R()-.5)*H*1.75,.85+R()*.7,0xaebfcd);
      for(let i=0;i<8;i++)propTree(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,4.6+R()*2,0x5c4a3a,0x8fb8a0);propRiver(add,R,H,0x9fd8ef,6);
    }else if(def.id==='emberfall'){
      for(let i=0;i<6;i++){const x=(R()-.5)*H*1.6,z=(R()-.5)*H*1.6,h=3+R()*6;add(x,h/2,z,2+R()*2,h,2+R()*2,0x1a0f0a);add(x,h+.2,z,1.4,.4,1.4,0xff6b2c,.9);}
      for(let i=0;i<7;i++)propRock(add,R,(R()-.5)*H*1.75,0,(R()-.5)*H*1.75,.9+R()*.8,0x241611);
      for(let i=0;i<7;i++)propDeadTree(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,3.4+R()*2.6,0x2e1c12);propRiver(add,R,H,0xff6b2c,5);
    }else if(def.id==='skyport'){
      for(let i=0;i<8;i++){const x=(R()-.5)*40,z=(R()-.5)*40;add(x,5.5,z,.4,11,.4,0x50575f);add(x,11.2,z,1.6,.5,1.6,0xf2b134,.6);}
    }else if(def.id==='bazaar'){
      const cols=[0xff3ea5,0x3df2c4,0xf2b134,0xa97bff];for(let i=0;i<16;i++){const x=(R()-.5)*H*1.7,z=(R()-.5)*H*1.7,c=cols[(R()*4)|0];add(x,2.6,z,3.4,.3,3.4,c,.7);add(x,1.3,z,.24,2.6,.24,0x2a1c3a);add(x,4.2,z,.14,2.4,.14,c,.9,false);}
      for(let i=0;i<6;i++)propTree(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,4.8+R()*1.6,0x4a3320,0x2f8f6a);
    }else if(def.id==='bonetemple'){
      for(let i=0;i<6;i++){const x=(R()-.5)*H*1.5,z=(R()-.5)*H*1.5;for(let k=-2;k<=2;k++)add(x+k*1.1,3.5-Math.abs(k)*.5,z,.7,7-Math.abs(k)*1.4,.7,0xd9d2c4);}
      for(let i=0;i<7;i++)propRock(add,R,(R()-.5)*H*1.75,0,(R()-.5)*H*1.75,.9+R()*.7,0x8f8577);
      for(let i=0;i<6;i++)propDeadTree(add,R,(R()-.5)*H*1.7,0,(R()-.5)*H*1.7,3+R()*2,0xc7bfae);
    }else if(def.id==='voidnexus'){
      for(let i=0;i<22;i++){const x=(R()-.5)*70,z=(R()-.5)*70,y=3+R()*16,s=1+R()*3;add(x,y,z,s,s,s,0x2a1a4a,.25,false);}
      for(let i=0;i<9;i++)propCrystal(add,R,(R()-.5)*44,0,(R()-.5)*44,2.4+R()*3,0xa97bff);
    }
  }

  function makeWorld(arenaId='foundry'){
    const def=Content.ARENAS.find(item=>item.id===arenaId)||Content.ARENAS[0];
    const visuals=[],boxes=[],spawns=[],hazards=[],R=mulberry32(def.seed),H=def.size/2;
    const add=(x,y,z,w,h,d,color,emissive=0,solid=true)=>{visuals.push({x,y,z,w,h,d,color,emissive,solid});if(solid)boxes.push({x0:x-w/2,x1:x+w/2,y0:y-h/2,y1:y+h/2,z0:z-d/2,z1:z+d/2});};
    if(def.void){for(const [x,z,w,d] of [[0,0,34,34],[-24,-24,20,20],[26,-22,18,22],[-26,24,22,18],[24,26,20,20],[0,-32,16,12],[0,32,14,14]]){add(x,-1,z,w,2,d,def.ground);add(x,-2.6,z,w*.86,1.4,d*.86,shadeHex(def.ground,.7));}}
    else{add(0,-1,0,def.size,2,def.size,def.ground);for(let i=0;i<26;i++){const w=4+R()*10,d=4+R()*10;add((R()-.5)*def.size*.85,.02,(R()-.5)*def.size*.85,w,.05,d,shadeHex(def.ground,1.16),0,false);}}
    if(!def.void){for(const [x,z,w,d] of [[0,-H,def.size,1],[0,H,def.size,1],[-H,0,1,def.size],[H,0,1,def.size]]){add(x,5.5,z,w,11,d,def.wall);add(x,11.3,z,w+.4,.6,d+.4,shadeHex(def.wall,1.4));}for(let i=0;i<10;i++){const t=(i/9-.5)*def.size*.94;add(t,4,-H+1.1,1.2,8,.5,shadeHex(def.wall,1.25));add(t,4,H-1.1,1.2,8,.5,shadeHex(def.wall,1.25));}}
    const nObs=16+((R()*8)|0);for(let i=0;i<nObs;i++){const w=2+R()*5,d=2+R()*5,h=1.6+R()*3.6;let x=(R()-.5)*def.size*.82,z=(R()-.5)*def.size*.82;if(Math.abs(x)<7&&Math.abs(z)<7)x+=12*Math.sign(x||1);if(def.void&&Math.max(Math.abs(x),Math.abs(z))>30)continue;add(x,h/2,z,w,h,d,shadeHex(def.wall,.9+R()*.5));add(x,h+.12,z,w*.96,.24,d*.96,shadeHex(def.accent,.85),def.fx.type==='spark'?.35:0);}
    for(const [index,spot] of [[0,[-1,-1]],[1,[1,-1]],[2,[-1,1]],[3,[1,1]]]){if(index>0&&R()<.18)continue;const dw=11+R()*7,dd=11+R()*7,dy=4.4+R()*1.6,x=spot[0]*H*.48,z=spot[1]*H*.48;add(x,dy,z,dw,.6,dd,shadeHex(def.wall,1.1));for(const [px,pz] of [[-1,-1],[1,-1],[-1,1],[1,1]])add(x+px*(dw/2-.7),dy/2,z+pz*(dd/2-.7),1,dy,1,shadeHex(def.wall,.75));add(x,dy+.75,z-dd/2+.2,dw,.9,.24,shadeHex(def.accent,.7),.15);add(x,dy+.75,z+dd/2-.2,dw,.9,.24,shadeHex(def.accent,.7),.15);const dx=-spot[0],dz=-spot[1],steps=Math.round(dy/.55),sx=x+dx*(dw/2+.4),sz=z+dz*(dd/2+.4);for(let s=0;s<steps;s++){const hgt=dy-s*.55;add(sx+dx*s*1.05,hgt/2,sz+dz*s*1.05,dx?1.6:3.4,hgt,dz?1.6:3.4,shadeHex(def.wall,1));}}
    const cy=3.2;add(0,cy,0,13,.6,13,shadeHex(def.wall,1.2));for(const [px,pz] of [[-1,-1],[1,-1],[-1,1],[1,1]])add(px*5.6,cy/2,pz*5.6,1.2,cy,1.2,shadeHex(def.wall,.8));add(0,cy+2.2,0,4,3.6,4,shadeHex(def.accent,.6),.25);for(let s=0;s<6;s++){const hgt=cy-s*.53;add(0,hgt/2,7.4+s*1.05,4.4,hgt,1.05,shadeHex(def.wall,1.05));add(0,hgt/2,-7.4-s*1.05,4.4,hgt,1.05,shadeHex(def.wall,1.05));}
    if(def.hazard&&def.hazard.type==='lava')for(let i=0;i<5;i++){const w=6+R()*9,d=6+R()*9,x=(R()-.5)*def.size*.7,z=(R()-.5)*def.size*.7;if(Math.abs(x)<9&&Math.abs(z)<9)continue;add(x,.06,z,w,.12,d,0xff5a1c,.85,false);hazards.push({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2,dps:def.hazard.dps});}
    themeDecor(def,R,H,add);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2+R()*.24,r=def.size*(def.void?.2:.4)*(.86+R()*.28),x=Math.cos(a)*r,z=Math.sin(a)*r;spawns.push({x,z,y:groundAt(boxes,x,z,60)});}
    const world={id:def.id,def,size:def.size,H,boxes,visuals,spawns,hazards,colors:{sky:def.sky,fog:def.fog,ground:def.ground,accent:def.accent,wall:def.wall,light:def.light}};
    world.duelSpawns=findDuelSpawns(world);return world;
  }

  return {makeWorld,groundAt,rayBox,rayWorld,freeAt,findDuelSpawns,shadeHex};
});
