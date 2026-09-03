'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RealtimeRoom, randomRoomCode } = require('./transport.js');

class FakeChannel {
  constructor(topic, options) { this.topic = topic;this.options = options;this.handlers = [];this.sent = [];this.state = {}; }
  on(type, filter, handler) { this.handlers.push({ type, event: filter.event, handler });return this; }
  subscribe(handler) { queueMicrotask(() => handler('SUBSCRIBED'));return this; }
  async track(value) { this.tracked = value;return 'ok'; }
  presenceState() { return this.state; }
  async send(message) { this.sent.push(message);return 'ok'; }
  emit(type, event, payload = {}) { for (const handler of this.handlers) if (handler.type === type && handler.event === event) handler.handler(payload); }
}

class FakeClient {
  constructor() { this.channels = [];this.removed = []; }
  channel(topic, options) { const channel = new FakeChannel(topic, options);this.channels.push(channel);return channel; }
  async removeChannel(channel) { this.removed.push(channel);return 'ok'; }
}

test('room codes use unambiguous secure-random characters', () => {
  let index = 0;const cryptoApi = { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i += 1) bytes[i] = index++;return bytes; } };
  const code = randomRoomCode(12, cryptoApi);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  assert.doesNotMatch(code, /[01IO]/);
});

test('presence carries the content version and sanitized match profile', async () => {
  const client = new FakeClient();
  const profile = { loadout: ['sidearm', 'knife'], pet: 'dog', hair: 'crop' };
  const room = new RealtimeRoom({ client, roomCode: 'ABCDEFGH2345', peerId: 'guest1', name: 'Guest', isHost: false, profile, contentVersion: 'abc123' });
  await room.connect();
  assert.deepEqual(client.channels[0].tracked.profile, profile);
  assert.equal(client.channels[0].tracked.contentVersion, 'abc123');
  await room.close();
});

test('guest controls and round acknowledgement use only its point-to-point input channel', async () => {
  const client = new FakeClient();
  const room = new RealtimeRoom({ client, roomCode: 'ABCDEFGH2345', peerId: 'guest1', name: 'Guest', isHost: false });
  await room.connect();
  assert.equal(client.channels.length, 2);
  assert.equal(client.channels[1].topic, 'pvp:ABCDEFGH2345:input:guest1');
  await room.sendInput({ seq: 1, moveF: 1 });await room.sendRoundAck(7);
  assert.deepEqual(client.channels[1].sent.map(message => message.event), ['input', 'round_ack']);
  assert.equal(client.channels[0].sent.length, 0);
});

test('host opens one input subscription and receives guest input and final acknowledgement', async () => {
  const client = new FakeClient(), inputs = [], acknowledgements = [];
  const room = new RealtimeRoom({ client, roomCode: 'ABCDEFGH2345', peerId: 'host1', name: 'Host', isHost: true,
    onInput: (...args) => inputs.push(args), onRoundAck: (...args) => acknowledgements.push(args) });
  await room.connect();const state = client.channels[0];
  state.state = { host1: [{ playerId: 'host1', name: 'Host', role: 'host', ready: true }], guest1: [{ playerId: 'guest1', name: 'Guest', role: 'guest', ready: true }] };
  state.emit('presence', 'sync');await new Promise(resolve => setImmediate(resolve));
  const input = client.channels[1];input.emit('broadcast', 'input', { payload: { playerId: 'guest1', input: { seq: 3 } } });
  input.emit('broadcast', 'round_ack', { payload: { playerId: 'guest1', roundEndSeq: 9 } });
  assert.equal(inputs[0][1].seq, 3);assert.deepEqual(acknowledgements, [['guest1', 9]]);assert.equal(room.canStart(), true);
});

test('only host can broadcast snapshots and only the present host can start a lobby', async () => {
  const hostClient = new FakeClient();const host = new RealtimeRoom({ client: hostClient, roomCode: 'ABCDEFGH2345', peerId: 'host', isHost: true });
  await host.connect();assert.equal(await host.sendSnapshot({ seq: 1 }), true);
  const guestClient = new FakeClient(), starts = [];
  const guest = new RealtimeRoom({ client: guestClient, roomCode: 'ABCDEFGH2345', peerId: 'guest', isHost: false, onLobby: value => starts.push(value) });
  await guest.connect();const state = guestClient.channels[0];state.state = { host: [{ playerId: 'host', role: 'host' }], guest: [{ playerId: 'guest', role: 'guest' }] };state.emit('presence', 'sync');
  state.emit('broadcast', 'lobby', { payload: { seq: 1, type: 'real_start', hostId: 'impostor' } });
  state.emit('broadcast', 'lobby', { payload: { seq: 2, type: 'real_start', hostId: 'host' } });
  state.emit('broadcast', 'lobby', { payload: { seq: 2, type: 'real_start', hostId: 'host' } });
  assert.deepEqual(starts.map(value => value.seq), [2]);assert.equal(await guest.sendSnapshot({ seq: 1 }), false);assert.equal(await guest.sendLobby({ seq: 3 }), false);
});
