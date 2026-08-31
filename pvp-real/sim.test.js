const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CFG,
  WEAPONS,
  Authority,
  ClientPredictor,
  RemoteBuffer,
  makeFoundryWorld,
  makeFlatWorld,
  dirFromAngles,
  rayWorld,
} = require('./sim.js');

function setupFlat() {
  const authority = new Authority({ world: makeFlatWorld(), startTimeMs: 1_000 });
  const host = authority.addPlayer('host', { name: 'Host' });
  const guest = authority.addPlayer('guest', { name: 'Guest' });
  assert.equal(authority.startRound(), true);
  authority.createSnapshot();
  return { authority, host, guest };
}

function input(authority, player, seq, overrides = {}) {
  return authority.receiveInput(player.id, {
    seq,
    clientTimeMs: authority.serverTimeMs,
    shotAtMs: authority.serverTimeMs,
    yaw: player.yaw,
    pitch: player.pitch,
    weapon: player.weapon,
    ...overrides,
  });
}

function step(authority, ms = 34) {
  authority.step(ms, authority.serverTimeMs + ms);
}

function fireSemi(authority, player, seq, fireId, weapon = player.weapon) {
  if (player.weapon !== weapon) {
    assert.equal(input(authority, player, seq, { weapon, fireId: 0, trigger: false }).accepted, true);
    step(authority, 200);
    step(authority, 200);
    seq += 1;
  }
  assert.equal(input(authority, player, seq, { weapon, fireId, trigger: true }).accepted, true);
  step(authority);
  input(authority, player, seq + 1, { weapon, fireId, trigger: false });
}

test('Foundry generation is deterministic and selects two clear, valid duel spawns', () => {
  const one = makeFoundryWorld();
  const two = makeFoundryWorld();
  assert.deepEqual(one.visuals, two.visuals);
  assert.equal(one.duelSpawns.length, 2);
  const [a, b] = one.duelSpawns;
  const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const direction = {
    x: (b.x - a.x) / distance,
    y: (b.y - a.y) / distance,
    z: (b.z - a.z) / distance,
  };
  assert.ok(distance > 15);
  assert.ok(rayWorld(one, { x: a.x, y: a.y + CFG.eye, z: a.z }, direction, distance) >= distance - 0.5);
});

test('authority moves, jumps, and rejects stale inputs', () => {
  const { authority, host } = setupFlat();
  const startX = host.x;
  const startZ = host.z;
  assert.equal(input(authority, host, 1, { moveF: 1, sprint: true }).accepted, true);
  for (let i = 0; i < 15; i += 1) step(authority);
  assert.ok(Math.hypot(host.x - startX, host.z - startZ) > 2.5);
  assert.equal(input(authority, host, 1, { moveF: -1 }).reason, 'stale_input');
  assert.equal(input(authority, host, 2, { jump: true }).accepted, true);
  step(authority);
  assert.ok(host.y > 0);
  assert.ok(host.vy > 0);
});

test('sidearm cadence, ammo, head damage, death, and round result are authoritative', () => {
  const { authority, host, guest } = setupFlat();
  fireSemi(authority, host, 1, 1);
  assert.equal(guest.hp, 125);
  assert.equal(host.inventory.sidearm.ammo, 11);

  authority.step(210, authority.serverTimeMs + 210);
  fireSemi(authority, host, 3, 2);
  authority.step(210, authority.serverTimeMs + 210);
  fireSemi(authority, host, 5, 3);

  assert.equal(guest.hp, 0);
  assert.equal(guest.alive, false);
  assert.equal(authority.roundEnded, true);
  assert.equal(authority.winnerId, host.id);
  const snapshot = authority.createSnapshot();
  assert.equal(snapshot.roundEnded, true);
  assert.equal(snapshot.winnerId, host.id);
  assert.ok(snapshot.roundEndSeq > 0);
  assert.ok(snapshot.events.some(event => event.type === 'death'));
  assert.ok(snapshot.events.some(event => event.type === 'round_end'));
  assert.equal(input(authority, host, 7, { moveF: 1 }).reason, 'round_ended');
});

test('AK automatic trigger respects fire cadence and stops after release', () => {
  const { authority, host } = setupFlat();
  assert.equal(input(authority, host, 1, { weapon: 'ak47', trigger: true }).accepted, true);
  for (let i = 0; i < 20; i += 1) step(authority, 34);
  const fired = WEAPONS.ak47.mag - host.inventory.ak47.ammo;
  assert.ok(fired >= 4 && fired <= 7, `unexpected automatic shots: ${fired}`);
  assert.equal(input(authority, host, 2, { weapon: 'ak47', trigger: false }).accepted, true);
  for (let i = 0; i < 10; i += 1) step(authority, 34);
  assert.equal(WEAPONS.ak47.mag - host.inventory.ak47.ammo, fired);
});

test('scattergun emits nine pellets and aggregates pellet damage', () => {
  const { authority, host, guest } = setupFlat();
  guest.x = 4;
  step(authority);
  fireSemi(authority, host, 1, 1, 'scatter');
  const snapshot = authority.createSnapshot();
  const fire = snapshot.events.find(event => event.type === 'fire' && event.weapon === 'scatter');
  assert.ok(fire);
  assert.equal(fire.rays.length, WEAPONS.scatter.pellets);
  assert.ok(guest.hp < CFG.baseHp);
  assert.equal(host.inventory.scatter.ammo, WEAPONS.scatter.mag - 1);
});

test('bazooka projectile travels, explodes, and applies authoritative damage', () => {
  const { authority, host, guest } = setupFlat();
  fireSemi(authority, host, 1, 1, 'bazooka');
  assert.equal(authority.projectiles.length, 1);
  for (let i = 0; i < 20 && authority.projectiles.length; i += 1) step(authority, 34);
  assert.equal(authority.projectiles.length, 0);
  assert.ok(guest.hp < CFG.baseHp);
  const snapshot = authority.createSnapshot();
  assert.ok(snapshot.events.some(event => event.type === 'rocket_spawn'));
  assert.ok(snapshot.events.some(event => event.type === 'explosion'));
});

test('client prediction reconciles acknowledged inputs and halts a dead client', () => {
  const world = makeFlatWorld();
  const predictor = new ClientPredictor('guest', world);
  predictor.state.x = 9;
  predictor.state.yaw = Math.PI / 2;
  for (let seq = 1; seq <= 4; seq += 1) predictor.predict({ moveF: 1, yaw: Math.PI / 2 }, 50, seq);
  assert.ok(predictor.history.length === 4);
  const result = predictor.applySnapshot({
    protocol: 2,
    seq: 1,
    players: [{
      id: 'guest', x: 8.5, y: 0, z: 0, vx: -1, vy: 0, vz: 0,
      yaw: Math.PI / 2, pitch: 0, hp: 120, alive: true, weapon: 'sidearm', lastProcessedInput: 2,
    }],
  });
  assert.equal(result.accepted, true);
  assert.equal(predictor.history.length, 2);
  assert.equal(predictor.state.hp, 120);
  const dead = predictor.applySnapshot({
    protocol: 2,
    seq: 2,
    players: [{
      id: 'guest', x: 8, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, hp: 0, alive: false, weapon: 'sidearm', lastProcessedInput: 4,
    }],
  });
  assert.equal(dead.accepted, true);
  assert.equal(predictor.history.length, 0);
  assert.equal(predictor.predict({ moveF: 1 }, 50, 5), false);
});

test('remote buffer interpolates between authoritative snapshots', () => {
  const buffer = new RemoteBuffer(100);
  buffer.push({ serverTimeMs: 1_000, players: [{ id: 'host', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 }] });
  buffer.push({ serverTimeMs: 1_100, players: [{ id: 'host', x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0 }] });
  assert.equal(buffer.at('host', 1_150).x, 5);
});

test('direction helper faces negative Z at zero yaw', () => {
  assert.deepEqual(dirFromAngles(0, 0), { x: -0, y: 0, z: -1 });
});
