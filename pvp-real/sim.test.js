const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CFG,
  WEAPONS,
  Authority,
  ClientPredictor,
  RemoteBuffer,
  makeFoundryWorld,
  makeArenaWorld,
  makeFlatWorld,
  CONTENT,
  CONTENT_VERSION,
  PETS,
  dirFromAngles,
  rayWorld,
} = require('./sim.js');

function setupFlat(loadout = ['sidearm', 'scatter', 'knife']) {
  const authority = new Authority({ world: makeFlatWorld(), startTimeMs: 1_000 });
  const host = authority.addPlayer('host', { name: 'Host', profile: { loadout } });
  const guest = authority.addPlayer('guest', { name: 'Guest', profile: { loadout } });
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
  const { authority, host } = setupFlat(['sidearm', 'ak47', 'knife']);
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
  const { authority, host, guest } = setupFlat(['sidearm', 'bazooka', 'knife']);
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
    protocol: 3,
    contentVersion: require('./sim.js').CONTENT_VERSION,
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
    protocol: 3,
    contentVersion: require('./sim.js').CONTENT_VERSION,
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

test('every PvE arena builds deterministically with valid duel spawns', () => {
  for (const arena of CONTENT.ARENAS) {
    const first = makeArenaWorld(arena.id);
    const second = makeArenaWorld(arena.id);
    assert.equal(first.id, arena.id);
    assert.deepEqual(first.boxes, second.boxes, arena.id);
    assert.deepEqual(first.duelSpawns, second.duelSpawns, arena.id);
    assert.equal(first.duelSpawns.length, 2, arena.id);
    assert.ok(first.visuals.length > 100, arena.id);
  }
});

test('all fourteen shared weapons are authoritative and serializable', () => {
  assert.equal(Object.keys(WEAPONS).length, 14);
  const authority = new Authority({ world: makeFlatWorld(), startTimeMs: 1_000 });
  const loadout = ['tesla', 'reaper', 'knife'];
  const host = authority.addPlayer('host', { profile: { loadout } });
  authority.addPlayer('guest', { profile: { loadout: ['sidearm', 'scatter', 'bat'] } });
  assert.equal(authority.startRound(), true);
  assert.deepEqual(host.loadout, loadout);
  assert.equal(input(authority, host, 1, { weapon: 'ak47' }).accepted, true);
  step(authority);
  assert.equal(host.weapon, 'tesla', 'host cannot equip a weapon outside the synchronized loadout');
  const snapshot = authority.createSnapshot();
  assert.equal(snapshot.protocol, 3);
  assert.equal(snapshot.contentVersion, CONTENT_VERSION);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  assert.ok(JSON.stringify(snapshot).length < 256_000);
});

test('companion AI leaves formation, attacks the enemy, and is included in snapshots', () => {
  const authority = new Authority({ world: makeFlatWorld(), startTimeMs: 1_000 });
  const host = authority.addPlayer('host', { profile: { pet: 'raptor' } });
  const guest = authority.addPlayer('guest', { profile: { pet: 'bear' } });
  assert.equal(authority.startRound(), true);
  const pet = authority.pets.get(host.id);
  const start = { x: pet.x, z: pet.z };
  for (let index = 0; index < 240 && guest.hp === CFG.baseHp; index += 1) step(authority, 34);
  assert.ok(Math.hypot(pet.x - start.x, pet.z - start.z) > 1);
  assert.ok(guest.hp < CFG.baseHp, `raptor never attacked; guest remained at ${guest.hp} HP`);
  const snapshot = authority.createSnapshot();
  assert.equal(snapshot.pets.length, 2);
  assert.ok(snapshot.events.some(event => event.type === 'pet_attack'));
});

test('enemy companions have authoritative HP, can be downed, and revive after eighteen seconds', () => {
  const authority = new Authority({ world: makeFlatWorld(), startTimeMs: 1_000 });
  const host = authority.addPlayer('host', { profile: { loadout: ['reaper', 'sidearm', 'knife'] } });
  const guest = authority.addPlayer('guest', { profile: { pet: 'dog' } });
  authority.startRound();authority.createSnapshot();
  const pet = authority.pets.get(guest.id);pet.x = 0;pet.y = 0;pet.z = -3;
  host.x = 0;host.y = 0;host.z = 0;host.yaw = 0;host.input.yaw = 0;
  input(authority, host, 1, { weapon: 'reaper', trigger: true, fireId: 1, pitch: Math.atan2(-1.1, 3) });
  step(authority, 34);authority.serverTimeMs += 1_100;step(authority, 34);
  assert.equal(pet.alive, false);
  assert.ok(authority.createSnapshot().events.some(event => event.type === 'pet_down'));
  authority.serverTimeMs = pet.downUntil;step(authority, 34);
  assert.equal(pet.alive, true);
  assert.equal(pet.hp, pet.maxHp);
});

test('lava, void falls, and timed arena events are enforced by host authority', () => {
  const lavaAuthority = new Authority({ world: makeArenaWorld('emberfall'), startTimeMs: 1_000 });
  const host = lavaAuthority.addPlayer('host');
  lavaAuthority.addPlayer('guest');
  lavaAuthority.startRound();
  const lava = lavaAuthority.world.hazards[0];
  host.x = (lava.x0 + lava.x1) / 2;host.z = (lava.z0 + lava.z1) / 2;host.y = 0;
  const hp = host.hp;for (let index = 0; index < 30; index += 1) step(lavaAuthority, 34);
  assert.ok(host.hp < hp, 'lava must deal authoritative damage');
  lavaAuthority.nextArenaEventAt = lavaAuthority.serverTimeMs;
  step(lavaAuthority, 34);
  assert.ok(lavaAuthority.createSnapshot().events.some(event => event.type === 'arena_warning'));

  const voidAuthority = new Authority({ world: makeArenaWorld('skyport'), startTimeMs: 1_000 });
  const falling = voidAuthority.addPlayer('falling');voidAuthority.addPlayer('safe');voidAuthority.startRound();
  falling.y = -9;step(voidAuthority, 34);
  assert.equal(falling.alive, false);
});

test('shared pet catalog keeps tactics and highlighted special skills', () => {
  assert.equal(Object.keys(PETS).length, 7);
  for (const pet of Object.values(PETS)) {
    assert.ok(pet.tactic.skill);
    assert.ok(pet.tactic.role);
    assert.ok(pet.perkTxt);
  }
});
