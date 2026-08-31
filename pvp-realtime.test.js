'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {RealtimeRoom,randomRoomCode}=require('./pvp-realtime.js');

class FakeChannel{
  constructor(topic,options){this.topic=topic;this.options=options;this.handlers=[];this.sent=[];this.state={};}
  on(type,filter,handler){this.handlers.push({type,event:filter.event,handler});return this;}
  subscribe(handler){queueMicrotask(()=>handler('SUBSCRIBED'));return this;}
  async track(value){this.tracked=value;return 'ok';}
  presenceState(){return this.state;}
  async send(message){this.sent.push(message);return 'ok';}
  emit(type,event,payload){
    for(const h of this.handlers) if(h.type===type&&h.event===event) h.handler(payload);
  }
}

class FakeClient{
  constructor(){this.channels=[];this.removed=[];}
  channel(topic,options){const c=new FakeChannel(topic,options);this.channels.push(c);return c;}
  async removeChannel(channel){this.removed.push(channel);return 'ok';}
}

test('room codes use secure-looking unambiguous characters',()=>{
  let i=0;
  const cryptoApi={getRandomValues(bytes){for(let n=0;n<bytes.length;n++) bytes[n]=i++;return bytes;}};
  const code=randomRoomCode(12,cryptoApi);
  assert.match(code,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  assert.doesNotMatch(code,/[01IO]/);
});

test('guest sends controls only on its point-to-point input channel',async()=>{
  const client=new FakeClient();
  const room=new RealtimeRoom({client,roomCode:'ABCDEFGH2345',peerId:'guest1',name:'Guest',isHost:false});
  await room.connect();
  assert.equal(client.channels.length,2);
  assert.equal(client.channels[0].topic,'pvp:ABCDEFGH2345:state');
  assert.equal(client.channels[1].topic,'pvp:ABCDEFGH2345:input:guest1');
  await room.sendInput({seq:1,moveX:1});
  assert.equal(client.channels[0].sent.length,0);
  assert.equal(client.channels[1].sent[0].event,'input');
  assert.deepEqual(client.channels[1].sent[0].payload,{playerId:'guest1',input:{seq:1,moveX:1}});
  await room.close();
  assert.equal(client.removed.length,2);
});

test('host opens one input subscription per present guest',async()=>{
  const client=new FakeClient();
  const received=[];
  const rosters=[];
  const room=new RealtimeRoom({
    client,roomCode:'ABCDEFGH2345',peerId:'host1',name:'Host',isHost:true,
    onInput:(...args)=>received.push(args),onRoster:r=>rosters.push(r),
  });
  await room.connect();
  const state=client.channels[0];
  state.state={host1:[{playerId:'host1',name:'Host',role:'host',ready:true}],guest1:[{playerId:'guest1',name:'Guest',role:'guest',ready:true}]};
  state.emit('presence','sync');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(client.channels.length,2);
  assert.equal(client.channels[1].topic,'pvp:ABCDEFGH2345:input:guest1');
  client.channels[1].emit('broadcast','input',{payload:{playerId:'guest1',input:{seq:3}}});
  assert.equal(received.length,1);
  assert.equal(received[0][0],'guest1');
  assert.equal(received[0][1].seq,3);
  assert.equal(rosters.at(-1).length,2);
  assert.equal(room.canStart(),true);
});

test('only the host can broadcast snapshots and game events',async()=>{
  const hostClient=new FakeClient();
  const host=new RealtimeRoom({client:hostClient,roomCode:'ABCDEFGH2345',peerId:'host',isHost:true});
  await host.connect();
  assert.equal(await host.sendSnapshot({seq:1}),true);
  assert.equal(await host.sendEvent({type:'hit'}),true);
  assert.deepEqual(hostClient.channels[0].sent.map(m=>m.event),['snapshot','game']);

  const guestClient=new FakeClient();
  const guest=new RealtimeRoom({client:guestClient,roomCode:'ABCDEFGH2345',peerId:'guest',isHost:false});
  await guest.connect();
  assert.equal(await guest.sendSnapshot({seq:1}),false);
  assert.equal(await guest.sendEvent({type:'hit'}),false);
});

test('guest renders a host game event sequence only once',async()=>{
  const client=new FakeClient();
  const events=[];
  const room=new RealtimeRoom({client,roomCode:'ABCDEFGH2345',peerId:'guest',isHost:false,onEvent:e=>events.push(e)});
  await room.connect();
  const state=client.channels[0];
  state.emit('broadcast','game',{payload:{seq:7,type:'hit'}});
  state.emit('broadcast','game',{payload:{seq:7,type:'hit'}});
  state.emit('broadcast','game',{payload:{seq:6,type:'hit'}});
  state.emit('broadcast','game',{payload:{seq:8,type:'death'}});
  assert.deepEqual(events.map(e=>e.seq),[7,8]);
});

test('only the present host can start the lobby, once',async()=>{
  const client=new FakeClient();
  const starts=[];
  const room=new RealtimeRoom({client,roomCode:'ABCDEFGH2345',peerId:'guest',isHost:false,onLobby:e=>starts.push(e)});
  await room.connect();
  const state=client.channels[0];
  state.state={host:[{playerId:'host',name:'Host',role:'host'}],guest:[{playerId:'guest',name:'Guest',role:'guest'}]};
  state.emit('presence','sync');
  state.emit('broadcast','lobby',{payload:{seq:1,type:'start',hostId:'impostor'}});
  state.emit('broadcast','lobby',{payload:{seq:2,type:'start',hostId:'host'}});
  state.emit('broadcast','lobby',{payload:{seq:2,type:'start',hostId:'host'}});
  assert.deepEqual(starts.map(e=>e.seq),[2]);
  assert.equal(await room.sendLobby({seq:3,type:'start'}),false);
});
