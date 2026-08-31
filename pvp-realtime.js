(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PVPRealtime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ROOM_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const clean=v=>String(v||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,20);
  const cleanPeer=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);

  function randomRoomCode(length=12,cryptoApi=globalThis.crypto){
    if(!cryptoApi||!cryptoApi.getRandomValues) throw new Error('Secure random room codes require crypto.getRandomValues');
    const bytes=new Uint8Array(Math.max(8,Math.min(20,length)));
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes,b=>ROOM_ALPHABET[b%ROOM_ALPHABET.length]).join('');
  }

  function randomPeerId(cryptoApi=globalThis.crypto){
    if(cryptoApi&&cryptoApi.randomUUID) return cryptoApi.randomUUID().replace(/-/g,'');
    return randomRoomCode(20,cryptoApi).toLowerCase();
  }

  class RealtimeRoom{
    constructor(options={}){
      if(!options.client) throw new Error('A Supabase client is required');
      this.client=options.client;
      this.roomCode=clean(options.roomCode);
      this.peerId=cleanPeer(options.peerId)||randomPeerId();
      this.name=String(options.name||'Fighter').replace(/[<>]/g,'').slice(0,16);
      this.isHost=!!options.isHost;
      this.onInput=options.onInput||(()=>{});
      this.onSnapshot=options.onSnapshot||(()=>{});
      this.onEvent=options.onEvent||(()=>{});
      this.onLobby=options.onLobby||(()=>{});
      this.onRoster=options.onRoster||(()=>{});
      this.onStatus=options.onStatus||(()=>{});
      this.stateChannel=null;
      this.inputChannel=null;
      this.hostInputChannels=new Map();
      this.hostInputReady=new Set();
      this.roster=[];
      this.clockOffsetMs=0;
      this.rttMs=null;
      this.clockSamples=[];
      this.lastGameEventSeq=0;
      this.lastLobbySeq=0;
      this.metrics={sent:0,received:0,errors:0};
    }

    async connect(){
      if(this.roomCode.length<8) throw new Error('Room code must contain at least 8 characters');
      const topic=`pvp:${this.roomCode}:state`;
      this.stateChannel=this.client.channel(topic,{
        config:{broadcast:{ack:true,self:false},presence:{key:this.peerId}},
      });
      this.stateChannel
        .on('broadcast',{event:'snapshot'},({payload})=>{this.metrics.received++;this.onSnapshot(payload);})
        .on('broadcast',{event:'game'},({payload})=>{
          this.metrics.received++;
          const seq=Number(payload&&payload.seq);
          if(Number.isFinite(seq)&&seq<=this.lastGameEventSeq) return;
          if(Number.isFinite(seq)) this.lastGameEventSeq=seq;
          this.onEvent(payload);
        })
        .on('broadcast',{event:'lobby'},({payload})=>{
          this.metrics.received++;
          const seq=Number(payload&&payload.seq);
          if(Number.isFinite(seq)&&seq<=this.lastLobbySeq) return;
          const host=this.roster.find(p=>p.role==='host');
          if(!host||cleanPeer(payload&&payload.hostId)!==host.playerId) return;
          if(Number.isFinite(seq)) this.lastLobbySeq=seq;
          this.onLobby(payload);
        })
        .on('broadcast',{event:'clock'},({payload})=>{this.metrics.received++;this._clock(payload);})
        .on('presence',{event:'sync'},()=>this._syncPresence())
        .on('presence',{event:'join'},()=>this._syncPresence())
        .on('presence',{event:'leave'},()=>this._syncPresence());

      await this._subscribe(this.stateChannel,'state');
      if(!this.isHost) await this._openClientInput();
      await this.stateChannel.track({
        playerId:this.peerId,name:this.name,role:this.isHost?'host':'guest',ready:true,joinedAt:Date.now(),
      });
      this.onStatus({kind:'connected',roomCode:this.roomCode,peerId:this.peerId});
      return this;
    }

    async _subscribe(channel,label){
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error(`${label} channel timed out`)),10000);
        channel.subscribe(status=>{
          if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}
          else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
            clearTimeout(timer);this.metrics.errors++;reject(new Error(`${label} channel: ${status}`));
          }
        });
      });
    }

    _syncPresence(){
      if(!this.stateChannel) return;
      const state=this.stateChannel.presenceState();
      const byId=new Map();
      for(const entries of Object.values(state||{})) for(const raw of entries||[]){
        const playerId=cleanPeer(raw.playerId);
        if(playerId&&!byId.has(playerId)) byId.set(playerId,{
          playerId,name:String(raw.name||'Fighter').slice(0,16),role:raw.role==='host'?'host':'guest',ready:raw.ready===true,
        });
      }
      this.roster=Array.from(byId.values()).sort((a,b)=>a.playerId.localeCompare(b.playerId));
      if(this.isHost) for(const p of this.roster) if(p.playerId!==this.peerId) this._ensureHostInput(p.playerId);
      this.onRoster(this.roster.slice());
    }

    async _openClientInput(){
      const topic=`pvp:${this.roomCode}:input:${this.peerId}`;
      this.inputChannel=this.client.channel(topic,{config:{broadcast:{ack:true,self:false}}});
      await this._subscribe(this.inputChannel,'input');
    }

    _ensureHostInput(playerId){
      playerId=cleanPeer(playerId);
      if(!playerId||this.hostInputChannels.has(playerId)) return;
      const topic=`pvp:${this.roomCode}:input:${playerId}`;
      const channel=this.client.channel(topic,{config:{broadcast:{ack:false,self:false}}});
      channel.on('broadcast',{event:'input'},({payload})=>{
        this.metrics.received++;
        if(payload&&cleanPeer(payload.playerId)===playerId) this.onInput(playerId,payload.input,Date.now());
      });
      this.hostInputChannels.set(playerId,channel);
      this._subscribe(channel,`input ${playerId}`).then(()=>{
        this.hostInputReady.add(playerId);
        this.onStatus({kind:'input_ready',playerId});
      }).catch(error=>{
          this.metrics.errors++;
          this.onStatus({kind:'error',error});
        });
    }

    async sendInput(input){
      if(this.isHost) return false;
      return this._send(this.inputChannel,'input',{playerId:this.peerId,input});
    }

    async sendSnapshot(snapshot){
      if(!this.isHost) return false;
      return this._send(this.stateChannel,'snapshot',snapshot);
    }

    async sendEvent(event){
      if(!this.isHost) return false;
      return this._send(this.stateChannel,'game',event);
    }

    async sendLobby(message){
      if(!this.isHost) return false;
      const payload=Object.assign({},message,{hostId:this.peerId});
      return this._send(this.stateChannel,'lobby',payload);
    }

    async _send(channel,event,payload){
      if(!channel) return false;
      this.metrics.sent++;
      const status=await channel.send({type:'broadcast',event,payload});
      if(status!=='ok'){
        this.metrics.errors++;
        this.onStatus({kind:'send_error',event,status});
        return false;
      }
      return true;
    }

    async syncClock(){
      if(this.isHost||!this.stateChannel) return;
      await this._send(this.stateChannel,'clock',{kind:'ping',playerId:this.peerId,t0:Date.now()});
    }

    _clock(message){
      if(!message||typeof message!=='object') return;
      if(this.isHost&&message.kind==='ping'){
        this._send(this.stateChannel,'clock',{
          kind:'pong',playerId:cleanPeer(message.playerId),t0:Number(message.t0),hostAt:Date.now(),
        });
        return;
      }
      if(!this.isHost&&message.kind==='pong'&&cleanPeer(message.playerId)===this.peerId){
        const t1=Date.now(),t0=Number(message.t0),hostAt=Number(message.hostAt);
        if(!Number.isFinite(t0)||!Number.isFinite(hostAt)) return;
        const sample={rttMs:Math.max(0,t1-t0),offsetMs:hostAt-(t0+t1)/2};
        this.clockSamples.push(sample);
        this.clockSamples.sort((a,b)=>a.rttMs-b.rttMs);
        if(this.clockSamples.length>8) this.clockSamples.length=8;
        const best=this.clockSamples[0];
        this.rttMs=best.rttMs; this.clockOffsetMs=best.offsetMs;
        this.onStatus({kind:'clock',rttMs:this.rttMs,clockOffsetMs:this.clockOffsetMs});
      }
    }

    toHostTime(clientWallTimeMs){ return Number(clientWallTimeMs)+this.clockOffsetMs; }

    canStart(){
      if(!this.isHost||this.roster.length<2||this.roster.length>4) return false;
      return this.roster.filter(p=>p.playerId!==this.peerId).every(p=>p.ready&&this.hostInputReady.has(p.playerId));
    }

    async close(){
      const channels=[this.inputChannel,...this.hostInputChannels.values(),this.stateChannel].filter(Boolean);
      await Promise.all(channels.map(c=>this.client.removeChannel(c)));
      this.inputChannel=null; this.stateChannel=null; this.hostInputChannels.clear();
      this.hostInputReady.clear();
      this.onStatus({kind:'closed'});
    }
  }

  return {RealtimeRoom,randomRoomCode,randomPeerId};
});
