'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('./sim.js');

function eventRate(players, inputHz, snapshotHz, sharedEventsPerSecond = 0) {
  return players * snapshotHz + (players - 1) * inputHz * 2 + players * sharedEventsPerSecond;
}

test('two-player shared-content traffic keeps headroom below the 100 event/s free-tier limit', () => {
  const baseline = eventRate(2, Sim.CFG.inputHz, Sim.CFG.snapshotHz);
  const withPetAndHazardActivity = eventRate(2, Sim.CFG.inputHz, Sim.CFG.snapshotHz, 5);
  assert.equal(baseline, 70);
  assert.equal(withPetAndHazardActivity, 80);
  assert.ok(withPetAndHazardActivity < 100);
});

test('real full-content snapshots remain far below the 256 KB payload ceiling', () => {
  const authority = new Sim.Authority({ world: Sim.makeArenaWorld('emberfall'), startTimeMs: 1_000 });
  authority.addPlayer('host', { profile: { loadout: ['minigun', 'bazooka', 'bat'], pet: 'trex', hair: 'gold', outfit: 'reaperk', acc: 'wings' } });
  authority.addPlayer('guest', { profile: { loadout: ['tesla', 'reaper', 'claws'], pet: 'bear', hair: 'void', outfit: 'voidw', acc: 'halo' } });
  authority.startRound();authority.nextArenaEventAt = authority.serverTimeMs;authority.step(34, authority.serverTimeMs + 34);
  const bytes = Buffer.byteLength(JSON.stringify(authority.createSnapshot()));
  assert.ok(bytes < 20_000, `snapshot unexpectedly large: ${bytes} bytes`);
  assert.ok(bytes < 256_000);
});

test('four players at the same responsiveness would exceed the intended free-tier event budget', () => {
  assert.equal(eventRate(4, Sim.CFG.inputHz, Sim.CFG.snapshotHz), 180);
  assert.ok(eventRate(4, Sim.CFG.inputHz, Sim.CFG.snapshotHz) > 100);
});
