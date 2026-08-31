(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PVPNetcode=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DEFAULTS=Object.freeze({
    tickRate:60,
    inputRate:8,
    snapshotRate:8,
    maxPlayers:4,
    moveSpeed:7.5,
    arenaHalfSize:22,
    playerRadius:.55,
    baseHp:200,
    weaponDamage:30,
    weaponRange:60,
    fireCooldownMs:200,
    maxRewindMs:200,
    historyMs:350,
    futureShotToleranceMs:35,
    interpolationDelayMs:125,
  });

  const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const normAngle=a=>{
    a=finite(a,0)%(Math.PI*2);
    return a>Math.PI?a-Math.PI*2:a<-Math.PI?a+Math.PI*2:a;
  };
  const safeId=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);

  function normalizeMove(x,z){
    x=clamp(finite(x),-1,1); z=clamp(finite(z),-1,1);
    const l=Math.hypot(x,z);
    return l>1?{x:x/l,z:z/l}:{x,z};
  }

  /* This is the complete client-to-host authority boundary. Position, health,
     damage, target ids and hit claims are deliberately not copied. */
  function sanitizeInput(raw){
    raw=raw&&typeof raw==='object'?raw:{};
    const move=normalizeMove(raw.moveX,raw.moveZ);
    return {
      seq:Math.max(0,Math.floor(finite(raw.seq))),
      clientTimeMs:finite(raw.clientTimeMs),
      moveX:move.x,
      moveZ:move.z,
      yaw:normAngle(raw.yaw),
      fireId:Math.max(0,Math.floor(finite(raw.fireId))),
      shotAtMs:finite(raw.shotAtMs,raw.clientTimeMs),
    };
  }

  function rayCircle(origin,dir,center,radius,maxRange){
    const rx=center.x-origin.x,rz=center.z-origin.z;
    const along=rx*dir.x+rz*dir.z;
    if(along<=0||along>maxRange) return null;
    const sideSq=rx*rx+rz*rz-along*along;
    if(sideSq>radius*radius) return null;
    const near=along-Math.sqrt(Math.max(0,radius*radius-sideSq));
    return Math.max(0,near);
  }

  class HostAuthority{
    constructor(options={}){
      this.cfg=Object.assign({},DEFAULTS,options);
      this.players=new Map();
      this.serverTimeMs=finite(options.startTimeMs,0);
      this.snapshotSeq=0;
      this.eventSeq=0;
      this.events=[];
      this.roundActive=false;
      this.roundEnded=false;
      this.winnerId=null;
      this.roundEndSeq=0;
      this.metrics={acceptedInputs:0,droppedInputs:0,acceptedShots:0,droppedShots:0,rewoundShots:0};
    }

    addPlayer(id,spawn={}){
      id=safeId(id);
      if(!id||this.players.has(id)||this.players.size>=this.cfg.maxPlayers) return null;
      const p={
        id,
        x:clamp(finite(spawn.x),-this.cfg.arenaHalfSize,this.cfg.arenaHalfSize),
        z:clamp(finite(spawn.z),-this.cfg.arenaHalfSize,this.cfg.arenaHalfSize),
        yaw:normAngle(spawn.yaw),
        hp:this.cfg.baseHp,
        alive:true,
        input:sanitizeInput({}),
        lastInputSeq:0,
        lastFireId:0,
        lastFireAcceptedAtMs:-Infinity,
        history:[],
      };
      this.players.set(id,p);
      this._recordPlayer(p,this.serverTimeMs);
      this._event('joined',{playerId:id});
      return p;
    }

    removePlayer(id){
      id=safeId(id);
      if(!this.players.delete(id)) return false;
      this._event('left',{playerId:id});
      this._checkRoundEnd('last_connected');
      return true;
    }

    startRound(){
      if(this.roundEnded||this.players.size<2) return false;
      this.roundActive=true;
      return true;
    }

    receiveInput(id,raw,receivedAtMs=this.serverTimeMs){
      const p=this.players.get(safeId(id));
      if(!p||!p.alive) return {accepted:false,reason:'unknown_or_dead'};
      if(this.roundEnded) return {accepted:false,reason:'round_ended'};
      const input=sanitizeInput(raw);
      if(input.seq<=p.lastInputSeq){
        this.metrics.droppedInputs++;
        return {accepted:false,reason:'stale_input'};
      }
      p.lastInputSeq=input.seq;
      p.input=input;
      p.yaw=input.yaw;
      this.metrics.acceptedInputs++;
      let shot=null;
      if(input.fireId>p.lastFireId){
        p.lastFireId=input.fireId;
        shot=this._resolveShot(p,input,finite(receivedAtMs,this.serverTimeMs));
      }
      return {accepted:true,shot};
    }

    step(dtMs,nowMs){
      dtMs=clamp(finite(dtMs),0,100);
      const target=Number.isFinite(Number(nowMs))?Number(nowMs):this.serverTimeMs+dtMs;
      this.serverTimeMs=Math.max(this.serverTimeMs,target);
      const dt=dtMs/1000;
      for(const p of this.players.values()){
        if(p.alive&&!this.roundEnded){
          p.x=clamp(p.x+p.input.moveX*this.cfg.moveSpeed*dt,-this.cfg.arenaHalfSize,this.cfg.arenaHalfSize);
          p.z=clamp(p.z+p.input.moveZ*this.cfg.moveSpeed*dt,-this.cfg.arenaHalfSize,this.cfg.arenaHalfSize);
          p.yaw=p.input.yaw;
        }
        this._recordPlayer(p,this.serverTimeMs);
      }
    }

    _recordPlayer(p,atMs){
      const last=p.history[p.history.length-1];
      const sample={atMs,x:p.x,z:p.z,yaw:p.yaw,alive:p.alive};
      if(last&&last.atMs===atMs) p.history[p.history.length-1]=sample;
      else p.history.push(sample);
      const cutoff=atMs-this.cfg.historyMs;
      while(p.history.length>2&&p.history[1].atMs<cutoff) p.history.shift();
    }

    samplePlayerAt(id,atMs){
      const p=this.players.get(safeId(id));
      if(!p||!p.history.length) return null;
      const h=p.history;
      if(atMs<=h[0].atMs) return Object.assign({},h[0]);
      const last=h[h.length-1];
      if(atMs>=last.atMs) return Object.assign({},last);
      let lo=0,hi=h.length-1;
      while(hi-lo>1){ const mid=(lo+hi)>>1; if(h[mid].atMs<=atMs) lo=mid; else hi=mid; }
      const a=h[lo],b=h[hi],t=(atMs-a.atMs)/Math.max(1,b.atMs-a.atMs);
      return {atMs,x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),yaw:a.yaw,alive:a.alive&&b.alive};
    }

    _resolveShot(shooter,input,receivedAtMs){
      if(receivedAtMs-shooter.lastFireAcceptedAtMs<this.cfg.fireCooldownMs){
        this.metrics.droppedShots++;
        return {accepted:false,reason:'fire_rate'};
      }
      shooter.lastFireAcceptedAtMs=receivedAtMs;
      const requested=finite(input.shotAtMs,receivedAtMs);
      const shotAt=clamp(requested,receivedAtMs-this.cfg.maxRewindMs,receivedAtMs+this.cfg.futureShotToleranceMs);
      const shooterPast=this.samplePlayerAt(shooter.id,shotAt)||shooter;
      const dir={x:-Math.sin(input.yaw),z:-Math.cos(input.yaw)};
      let target=null,distance=Infinity,targetPast=null;
      for(const other of this.players.values()){
        if(other===shooter||!other.alive) continue;
        const past=this.samplePlayerAt(other.id,shotAt);
        if(!past||!past.alive) continue;
        const d=rayCircle(shooterPast,dir,past,this.cfg.playerRadius,this.cfg.weaponRange);
        if(d!==null&&d<distance){target=other;targetPast=past;distance=d;}
      }
      const rewindMs=Math.max(0,receivedAtMs-shotAt);
      this.metrics.acceptedShots++;
      if(rewindMs>1) this.metrics.rewoundShots++;
      const result={
        accepted:true,shooterId:shooter.id,fireId:input.fireId,shotAtMs:shotAt,receivedAtMs,rewindMs,hit:false,
        origin:{x:shooterPast.x,z:shooterPast.z},dir,end:{x:shooterPast.x+dir.x*this.cfg.weaponRange,z:shooterPast.z+dir.z*this.cfg.weaponRange},
      };
      if(target){
        target.hp=Math.max(0,target.hp-this.cfg.weaponDamage);
        if(target.hp===0) target.alive=false;
        result.hit=true;
        result.targetId=target.id;
        result.damage=this.cfg.weaponDamage;
        result.targetHp=target.hp;
        result.killed=!target.alive;
        result.impact={x:shooterPast.x+dir.x*distance,z:shooterPast.z+dir.z*distance,distance};
        this._event(result.killed?'death':'hit',result);
        if(result.killed) this._checkRoundEnd('last_alive');
      }else this._event('shot',result);
      return result;
    }

    _checkRoundEnd(reason){
      if(!this.roundActive||this.roundEnded) return null;
      const alive=Array.from(this.players.values()).filter(p=>p.alive);
      if(alive.length>1) return null;
      this.roundEnded=true;
      this.winnerId=alive[0]?alive[0].id:null;
      const event=this._event('round_end',{winnerId:this.winnerId,reason:reason||'last_alive'});
      this.roundEndSeq=event.seq;
      return event;
    }

    _event(type,data){
      const event=Object.assign({seq:++this.eventSeq,type,serverTimeMs:this.serverTimeMs},data||{});
      this.events.push(event);
      return event;
    }

    drainEvents(){ const out=this.events; this.events=[]; return out; }

    createSnapshot(){
      return {
        protocol:1,
        seq:++this.snapshotSeq,
        serverTimeMs:this.serverTimeMs,
        roundEnded:this.roundEnded,
        roundEndSeq:this.roundEndSeq,
        winnerId:this.winnerId,
        players:Array.from(this.players.values(),p=>({
          id:p.id,x:p.x,z:p.z,yaw:p.yaw,hp:p.hp,alive:p.alive,lastProcessedInput:p.lastInputSeq,
        })),
      };
    }
  }

  class ClientPredictor{
    constructor(playerId,options={}){
      this.id=safeId(playerId);
      this.cfg=Object.assign({},DEFAULTS,options);
      this.x=finite(options.x); this.z=finite(options.z); this.yaw=normAngle(options.yaw);
      this.hp=this.cfg.baseHp; this.alive=true;
      this.seq=0; this.fireId=0; this.lastSnapshotSeq=0; this.pending=[];
      this.predictedHistory=[];
      this.remotes=new Map();
      this.metrics={staleSnapshots:0,corrections:0,maxCorrection:0};
    }

    makeInput(control,clientTimeMs,dtMs,alreadyPredicted=false){
      const fire=!!(control&&control.fire);
      if(fire) this.fireId++;
      const input=sanitizeInput({
        seq:++this.seq,
        clientTimeMs,
        moveX:control&&control.moveX,
        moveZ:control&&control.moveZ,
        yaw:control&&control.yaw,
        fireId:this.fireId,
        shotAtMs:fire?clientTimeMs:0,
      });
      const stepMs=clamp(finite(dtMs),0,250);
      if(!alreadyPredicted) this._integrate(input,stepMs);
      this.pending.push({input,dtMs:stepMs});
      return input;
    }

    predict(control,dtMs,hostTimeMs){
      if(!this.alive) return false;
      const move=normalizeMove(control&&control.moveX,control&&control.moveZ);
      this._integrate({moveX:move.x,moveZ:move.z,yaw:normAngle(control&&control.yaw)},clamp(finite(dtMs),0,100));
      if(Number.isFinite(Number(hostTimeMs))){
        this.predictedHistory.push({atMs:Number(hostTimeMs),x:this.x,z:this.z,yaw:this.yaw});
        const cutoff=Number(hostTimeMs)-1000;
        while(this.predictedHistory.length>2&&this.predictedHistory[1].atMs<cutoff) this.predictedHistory.shift();
      }
      return true;
    }

    _predictedAt(atMs){
      const h=this.predictedHistory;
      if(!h.length||atMs<h[0].atMs||atMs>h[h.length-1].atMs) return null;
      if(atMs===h[0].atMs) return Object.assign({},h[0]);
      for(let i=1;i<h.length;i++) if(h[i].atMs>=atMs){
        const a=h[i-1],b=h[i],t=(atMs-a.atMs)/Math.max(1,b.atMs-a.atMs);
        return {atMs,x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),yaw:a.yaw};
      }
      return Object.assign({},h[h.length-1]);
    }

    _integrate(input,dtMs){
      const dt=dtMs/1000;
      this.x=clamp(this.x+input.moveX*this.cfg.moveSpeed*dt,-this.cfg.arenaHalfSize,this.cfg.arenaHalfSize);
      this.z=clamp(this.z+input.moveZ*this.cfg.moveSpeed*dt,-this.cfg.arenaHalfSize,this.cfg.arenaHalfSize);
      this.yaw=input.yaw;
    }

    applySnapshot(snapshot,receivedAtMs=0){
      if(!snapshot||snapshot.protocol!==1||snapshot.seq<=this.lastSnapshotSeq){
        this.metrics.staleSnapshots++;
        return {accepted:false,reason:'stale_snapshot'};
      }
      this.lastSnapshotSeq=snapshot.seq;
      const self=(snapshot.players||[]).find(p=>p.id===this.id);
      let correction=0;
      if(self){
        const predicted=this._predictedAt(snapshot.serverTimeMs);
        correction=predicted?Math.hypot(predicted.x-self.x,predicted.z-self.z):Math.hypot(this.x-self.x,this.z-self.z);
        if(correction>.001){
          this.metrics.corrections++;
          this.metrics.maxCorrection=Math.max(this.metrics.maxCorrection,correction);
        }
        this.hp=clamp(finite(self.hp,this.cfg.baseHp),0,this.cfg.baseHp);
        this.alive=self.alive!==false&&this.hp>0;
        this.pending=this.pending.filter(p=>p.input.seq>self.lastProcessedInput);
        if(!this.alive){
          this.x=self.x; this.z=self.z; this.yaw=self.yaw;
          this.pending=[]; this.predictedHistory=[];
        }else if(predicted){
          const dx=self.x-predicted.x,dz=self.z-predicted.z;
          this.x+=dx; this.z+=dz;
          for(const sample of this.predictedHistory) if(sample.atMs>=snapshot.serverTimeMs){sample.x+=dx;sample.z+=dz;}
          while(this.predictedHistory.length>2&&this.predictedHistory[1].atMs<snapshot.serverTimeMs-50) this.predictedHistory.shift();
        }else{
          this.x=self.x; this.z=self.z; this.yaw=self.yaw;
          for(const item of this.pending) this._integrate(item.input,item.dtMs);
        }
      }
      for(const p of snapshot.players||[]){
        if(p.id===this.id) continue;
        let q=this.remotes.get(p.id);
        if(!q){q=[];this.remotes.set(p.id,q);}
        q.push({atMs:snapshot.serverTimeMs,receivedAtMs,x:p.x,z:p.z,yaw:p.yaw,hp:p.hp,alive:p.alive});
        while(q.length>24) q.shift();
      }
      return {accepted:true,correction,pending:this.pending.length};
    }

    remoteAt(id,hostRenderTimeMs){
      const q=this.remotes.get(safeId(id));
      if(!q||!q.length) return null;
      if(hostRenderTimeMs<=q[0].atMs) return Object.assign({},q[0]);
      const last=q[q.length-1];
      if(hostRenderTimeMs>=last.atMs) return Object.assign({},last);
      for(let i=1;i<q.length;i++) if(q[i].atMs>=hostRenderTimeMs){
        const a=q[i-1],b=q[i],t=(hostRenderTimeMs-a.atMs)/Math.max(1,b.atMs-a.atMs);
        return {atMs:hostRenderTimeMs,x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),yaw:a.yaw,hp:b.hp,alive:b.alive};
      }
      return Object.assign({},last);
    }
  }

  class SimulatedLink{
    constructor(options={}){
      this.latencyMs=Math.max(0,finite(options.latencyMs,80));
      this.jitterMs=Math.max(0,finite(options.jitterMs,20));
      this.loss=clamp(finite(options.loss),0,1);
      this.random=options.random||Math.random;
      this.queue=[];
      this.sent=0; this.dropped=0; this.delivered=0;
    }
    send(nowMs,payload,deliver){
      this.sent++;
      if(this.random()<this.loss){this.dropped++;return false;}
      const delay=Math.max(0,this.latencyMs+(this.random()*2-1)*this.jitterMs);
      this.queue.push({atMs:nowMs+delay,payload,deliver});
      this.queue.sort((a,b)=>a.atMs-b.atMs);
      return true;
    }
    flush(nowMs){
      let n=0;
      while(this.queue.length&&this.queue[0].atMs<=nowMs){
        const item=this.queue.shift(); item.deliver(item.payload,item.atMs); n++; this.delivered++;
      }
      return n;
    }
  }

  function seededRandom(seed=1){
    let x=(Math.floor(finite(seed,1))>>>0)||1;
    return function(){ x=(x*1664525+1013904223)>>>0; return x/4294967296; };
  }

  return {DEFAULTS,HostAuthority,ClientPredictor,SimulatedLink,sanitizeInput,rayCircle,seededRandom};
});
