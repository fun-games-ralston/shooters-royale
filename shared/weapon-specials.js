(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BlockRoyaleWeaponSpecials=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const clamp=(value,min,max)=>value<min?min:value>max?max:value;
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const length=v=>Math.hypot(v.x,v.y,v.z);
  function normalize(v,fallback={x:0,y:0,z:-1}){
    const size=length(v);
    return size>1e-8?{x:v.x/size,y:v.y/size,z:v.z/size}:{...fallback};
  }
  function aimPoint(target){
    if(target.aimPoint) return target.aimPoint;
    const pos=target.pos||target;
    return {x:pos.x,y:pos.y+(target.aimHeight===undefined?1.15:target.aimHeight),z:pos.z};
  }

  function selectLockTarget(origin,direction,candidates,options={}){
    const aim=normalize(direction), maxRange=options.maxRange||320;
    const cone=Math.cos((options.coneDegrees||3)*Math.PI/180);
    const visible=options.visible||(()=>true);
    let best=null,bestScore=-Infinity;
    for(const candidate of candidates||[]){
      if(!candidate||candidate.alive===false||candidate===options.ignore) continue;
      const point=aimPoint(candidate);
      const delta={x:point.x-origin.x,y:point.y-origin.y,z:point.z-origin.z};
      const distance=length(delta);
      if(distance<=0||distance>maxRange) continue;
      const alignment=dot(aim,normalize(delta));
      if(alignment<cone||!visible(candidate,origin,point,distance)) continue;
      const score=alignment*10000-distance;
      if(score>bestScore){best=candidate;bestScore=score;}
    }
    return best;
  }

  function advanceLock(state,candidateId,dt,lockSeconds){
    const current=state||{};
    if(current.ready&&current.targetId) return {...current,justLocked:false};
    if(!candidateId) return {targetId:null,progress:0,ready:false,justLocked:false};
    const same=current.targetId===candidateId;
    const progress=(same?current.progress||0:0)+Math.max(0,dt||0);
    const ready=progress>=lockSeconds;
    return {targetId:candidateId,progress:Math.min(progress,lockSeconds),ready,justLocked:ready&&!current.ready};
  }

  function turnTowards(current,desired,maxRadians){
    const from=normalize(current),to=normalize(desired,from);
    const angle=Math.acos(clamp(dot(from,to),-1,1));
    if(angle<1e-5||angle<=maxRadians) return to;
    const amount=clamp(maxRadians/angle,0,1);
    return normalize({x:from.x+(to.x-from.x)*amount,y:from.y+(to.y-from.y)*amount,z:from.z+(to.z-from.z)*amount},to);
  }

  function homingDirection(position,current,target,dt,options={}){
    const direct=normalize({x:target.x-position.x,y:target.y-position.y,z:target.z-position.z},current);
    const probe=options.probe||5,clearance=options.clearance;
    let desired=direct;
    if(clearance&&clearance(direct,probe)<probe*.82){
      const side=options.avoidSide<0?-1:1;
      const right=normalize({x:-direct.z,y:0,z:direct.x},{x:1,y:0,z:0});
      const paths=[
        normalize({x:direct.x+right.x*1.35*side,y:direct.y+.72,z:direct.z+right.z*1.35*side}),
        normalize({x:direct.x-right.x*1.35*side,y:direct.y+.72,z:direct.z-right.z*1.35*side}),
        normalize({x:direct.x,y:direct.y+1.5,z:direct.z}),
      ];
      let best=paths[0],score=-Infinity;
      for(const path of paths){
        const pathScore=clearance(path,probe)+dot(path,direct)*.7;
        if(pathScore>score){score=pathScore;best=path;}
      }
      desired=best;
    }
    return turnTowards(current,desired,(options.turnRate||4.6)*Math.max(0,dt||0));
  }

  function segmentPointDistance(a,b,point){
    const ab={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z};
    const ap={x:point.x-a.x,y:point.y-a.y,z:point.z-a.z};
    const denom=dot(ab,ab)||1;
    const t=clamp(dot(ap,ab)/denom,0,1);
    return length({x:a.x+ab.x*t-point.x,y:a.y+ab.y*t-point.y,z:a.z+ab.z*t-point.z});
  }

  function flameTargets(origin,direction,candidates,options={}){
    const aim=normalize(direction),range=options.range||15;
    const baseRadius=options.baseRadius===undefined?.5:options.baseRadius;
    const endRadius=options.endRadius===undefined?1.35:options.endRadius;
    const visible=options.visible||(()=>true),hits=[];
    for(const candidate of candidates||[]){
      if(!candidate||candidate.alive===false||candidate===options.ignore) continue;
      const point=aimPoint(candidate);
      const rel={x:point.x-origin.x,y:point.y-origin.y,z:point.z-origin.z};
      const forward=dot(rel,aim);
      if(forward<0||forward>range) continue;
      const closest={x:origin.x+aim.x*forward,y:origin.y+aim.y*forward,z:origin.z+aim.z*forward};
      const radius=baseRadius+(endRadius-baseRadius)*(forward/range);
      if(length({x:point.x-closest.x,y:point.y-closest.y,z:point.z-closest.z})>radius) continue;
      const distance=length(rel);
      if(!visible(candidate,origin,point,distance)) continue;
      hits.push({candidate,distance:forward});
    }
    hits.sort((a,b)=>a.distance-b.distance);
    return hits.map(hit=>hit.candidate);
  }

  return {normalize,selectLockTarget,advanceLock,turnTowards,homingDirection,segmentPointDistance,flameTargets};
});
