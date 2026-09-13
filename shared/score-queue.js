(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.BlockRoyaleScores=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PREFIX='sr_score_queue_v1:';
  const AUTH=new Set(['BAD_PIN','LOCKED','NO_SUCH_PLAYER']);
  const PERMANENT=new Set(['BAD_RESULT','BAD_DURATION','BAD_MODE','BAD_SKILL','BAD_RULES',
    'NOT_STANDARD_CHALLENGE','BAD_CHALLENGE_TIER','MATCH_ID_CONFLICT','HTTP_400']);
  function uuid(){
    const c=globalThis.crypto;
    if(c.randomUUID) return c.randomUUID();
    const a=c.getRandomValues(new Uint8Array(16));
    a[6]=(a[6]&15)|64; a[8]=(a[8]&63)|128;
    return Array.from(a,(v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('');
  }
  function create(options){
    const {storage,account,send}=options, now=options.now||Date.now;
    const memory=new Map(), states=new Map();
    let running=false, blockedAuth=null, active=null;
    const owner=()=>{const a=account(); return a&&String(a.handle).toUpperCase();};
    const key=r=>PREFIX+r.handle+':'+r.id;
    function entries(handle){
      const found=new Map();
      try{
        for(let i=0;storage&&i<storage.length;i++){
          const k=storage.key(i); if(!k||!k.startsWith(PREFIX+handle+':')) continue;
          try{
            const r=JSON.parse(storage.getItem(k));
            if(r&&r.handle===handle&&k===key(r)&&r.payload) found.set(k,r);
          }catch(e){} // One damaged entry must not block other saved results.
        }
      }catch(e){}
      for(const [k,r] of memory) if(r.handle===handle) found.set(k,r);
      return Array.from(found.values()).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
    }
    function persist(r){
      try{
        if(!storage) throw new Error('storage unavailable');
        storage.setItem(key(r),JSON.stringify(r)); memory.delete(key(r)); return true;
      }catch(e){memory.set(key(r),r); return false;}
    }
    function remove(r){
      memory.delete(key(r));
      try{storage&&storage.removeItem(key(r));}catch(e){}
    }
    function status(){
      const h=owner(), list=h?entries(h):[];
      return {handle:h,pending:list.filter(r=>!r.permanent).length,
        failed:list.filter(r=>r.permanent).length,
        error:list.find(r=>!r.permanent&&r.error)?.error,
        failedError:list.find(r=>r.permanent)?.error,
        volatile:list.some(r=>memory.has(key(r))), last:states.get(h)||null};
    }
    function changed(){if(options.onChange) options.onChange(status());}
    function enqueue(version,result){
      const h=owner(); if(!h) return null;
      // Save only the immutable result. No PIN, cloud save, or mutable config.
      const payload=JSON.parse(JSON.stringify(result));
      delete payload.p_save; delete payload.p_pin; delete payload.p_handle;
      const r={id:(options.uuid||uuid)(),handle:h,version,payload,createdAt:now(),attempts:0,nextAt:0};
      persist(r); states.set(h,{id:r.id,state:'pending'}); changed();
      void flush(); return r.id;
    }
    function flush(){
      if(active) return active;
      active=run().finally(()=>{active=null;});
      return active;
    }
    async function run(){
      if(running) return;
      const a=account(); if(!a) {changed(); return;}
      const h=String(a.handle).toUpperCase(), token=h+':'+a.pin;
      if(blockedAuth===token) {changed(); return;}
      running=true;
      try{
        for(const r of entries(h)){
          if(owner()!==h || account().pin!==a.pin) break;
          if(r.permanent) continue;
          if(r.nextAt>now()) break;
          let result;
          try{result=await send({p_handle:h,p_pin:a.pin,p_match_id:r.id,p_version:r.version,p_result:r.payload});}
          catch(e){result={ok:false,error:'NO_NETWORK'};}
          if(result&&result.ok===true){
            remove(r); states.set(h,{id:r.id,state:'sent',challengeReason:result.challenge_ineligible_reason||null});
            if(owner()===h&&options.onAccepted){
              try{await options.onAccepted(result,r);}catch(e){}
            }
          }else{
            r.error=result&&result.error||'NO_NETWORK';
            r.attempts++;
            r.nextAt=now()+Math.min(60000,5000*Math.pow(2,Math.min(r.attempts-1,4)));
            r.permanent=PERMANENT.has(r.error);
            persist(r); states.set(h,{id:r.id,state:r.permanent?'failed':'pending',error:r.error});
            if(AUTH.has(r.error)) blockedAuth=token;
            // Preserve ordering after an uncertain result, including timeouts.
            if(!r.permanent) break;
          }
          changed();
        }
      }finally{running=false;changed();}
    }
    function resume(){
      blockedAuth=null;
      const h=owner(); if(h) for(const r of entries(h)) if(!r.permanent){r.nextAt=0;persist(r);}
      changed(); void flush();
    }
    return {enqueue,flush,resume,status,refresh:changed};
  }
  return {create,PREFIX};
});
