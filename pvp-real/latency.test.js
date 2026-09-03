'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('./sim.js');

function random(seed) { return () => { seed |= 0;seed = seed + 0x6D2B79F5 | 0;let t = Math.imul(seed ^ seed >>> 15, 1 | seed);t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function movementScenario(latencyMs, jitterMs, loss, seed) {
  const rng = random(seed), world = Sim.makeFlatWorld();
  const host = new Sim.Authority({ world, startTimeMs: 0 });
  host.addPlayer('host');const guest = host.addPlayer('guest');host.startRound();
  const client = new Sim.ClientPredictor('guest', world);client.applySnapshot(host.createSnapshot());
  const up = [], down = [];let seq = 0, nextInput = 0, nextSnapshot = 0;
  const send = (queue, now, value) => { if (rng() < loss) return;queue.push({ at: now + Math.max(0, latencyMs + (rng() * 2 - 1) * jitterMs), value }); };
  for (let now = 10; now <= 5_000; now += 10) {
    if (now >= nextInput) {
      const moving = now < 1_200, input = Sim.sanitizeInput({ seq: ++seq, moveF: moving ? 1 : 0, yaw: guest.yaw, weapon: 'sidearm', clientTimeMs: now, shotAtMs: now });
      client.predict(input, 50, seq);send(up, now, input);nextInput += 50;
    }
    for (let index = up.length - 1; index >= 0; index -= 1) if (up[index].at <= now) { host.receiveInput('guest', up[index].value, now);up.splice(index, 1); }
    host.step(10, now);
    if (now >= nextSnapshot) { send(down, now, host.createSnapshot());nextSnapshot += 1000 / Sim.CFG.snapshotHz; }
    down.sort((a, b) => a.at - b.at);
    while (down[0] && down[0].at <= now) client.applySnapshot(down.shift().value);
  }
  while (down.length) client.applySnapshot(down.shift().value);
  return { error: Math.hypot(client.state.x - guest.x, client.state.y - guest.y, client.state.z - guest.z), maxCorrection: client.metrics.maxCorrection };
}

for (const scenario of [{ latency: 60, jitter: 20, loss: 0 }, { latency: 120, jitter: 45, loss: .02 }, { latency: 180, jitter: 70, loss: .05 }]) {
  test(`prediction converges after ${scenario.latency} ms latency, jitter, and packet loss`, () => {
    const result = movementScenario(scenario.latency, scenario.jitter, scenario.loss, scenario.latency);
    assert.ok(result.error < .3, `final reconciliation error ${result.error}`);
  });
}

function crossingShot(latencyMs) {
  const authority = new Sim.Authority({ world: Sim.makeFlatWorld(), startTimeMs: 0 });
  const shooter = authority.addPlayer('shooter');const target = authority.addPlayer('target');authority.startRound();
  shooter.x = 0;shooter.z = 0;shooter.yaw = -Math.PI / 2;target.x = 10;target.z = -.6;authority.createSnapshot();
  authority.receiveInput('target', { seq: 1, moveF: -1, yaw: 0, weapon: 'sidearm' }, 0);
  for (let now = 10; now <= 100 + latencyMs; now += 10) authority.step(10, now);
  authority.receiveInput('shooter', { seq: 1, fireId: 1, trigger: true, yaw: -Math.PI / 2, pitch: 0, weapon: 'sidearm', shotAtMs: 100 }, 100 + latencyMs);
  authority.step(10, 110 + latencyMs);
  const fire = authority.createSnapshot().events.find(event => event.type === 'fire');
  return { hit: target.hp < Sim.CFG.baseHp, rewindMs: fire.rewindMs };
}

test('rewind hit detection compensates through the 200 ms cap and clamps older claims', () => {
  for (const latency of [0, 60, 120, 180, 200]) assert.equal(crossingShot(latency).hit, true, `${latency} ms should hit`);
  const old = crossingShot(250);
  assert.equal(old.rewindMs, Sim.CFG.maxRewindMs);
});
