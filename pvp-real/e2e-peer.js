#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { createClient } = require('@supabase/supabase-js');
const PVPRealtime = require('../pvp-test/pvp-realtime.js');
const Sim = require('./sim.js');

const SUPABASE_URL = 'https://ctzjitzkolqghvonjtnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L7lbsM1-zMaOxfIASXIMCQ_0EeF20mq';
const role = process.argv[2];
const roomCode = String(process.argv[3] || '').toUpperCase();
const name = String(process.argv[4] || (role === 'host' ? 'NODEHOST' : 'NODEGUEST')).slice(0, 16);
if (!['host', 'guest'].includes(role) || roomCode.length < 8) {
  console.error('usage: e2e-peer.js <host|guest> <room-code> [name]');
  process.exit(2);
}

const peerId = `${role}-e2e-${process.pid}`;
const isHost = role === 'host';
const world = Sim.makeFoundryWorld();
const authority = isHost ? new Sim.Authority({ world, startTimeMs: Date.now() }) : null;
const predictor = !isHost ? new Sim.ClientPredictor(peerId, world) : null;
const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 40 } },
});

let network = null;
let roster = [];
let running = false;
let roundEnded = false;
let inputSeq = 0;
let fireId = 0;
let reloadId = 0;
let lastSnapshot = null;
let startSent = false;
let state = { moveF: 0, moveR: 0, jump: false, sprint: false, trigger: false, weapon: 'sidearm', yaw: 0, pitch: 0 };
let moveTimer = null;
let inputTimer = null;
let simTimer = null;
let snapshotTimer = null;
let reportTimer = null;
let lastReportPosition = null;
const roundAcks = new Set();

function out(type, data = {}) {
  process.stdout.write(`${JSON.stringify({ type, at: Date.now(), role, peerId, ...data })}\n`);
}

function own() {
  if (authority) return authority.players.get(peerId) || null;
  return lastSnapshot && lastSnapshot.players.find(player => player.id === peerId) || predictor.state;
}

function aimAtOpponent() {
  const me = own();
  const opponent = authority
    ? [...authority.players.values()].find(player => player.id !== peerId)
    : lastSnapshot && lastSnapshot.players.find(player => player.id !== peerId);
  if (!me || !opponent) return;
  const dx = opponent.x - me.x;
  const dz = opponent.z - me.z;
  state.yaw = Math.atan2(-dx, -dz);
  state.pitch = Math.atan2(opponent.y + Sim.CFG.eye - (me.y + Sim.CFG.eye), Math.hypot(dx, dz));
}

function makeInput() {
  const hostTime = authority ? authority.serverTimeMs : network.toHostTime(Date.now());
  return Sim.sanitizeInput({ ...state, seq: ++inputSeq, fireId, reloadId, clientTimeMs: Date.now(), shotAtMs: hostTime });
}

function sendInput() {
  if (!running || roundEnded) return;
  aimAtOpponent();
  const input = makeInput();
  if (authority) authority.receiveInput(peerId, input, authority.serverTimeMs);
  else {
    predictor.predict(input, 1000 / Sim.CFG.inputHz, input.seq);
    network.sendInput(input);
  }
}

function startLoops() {
  if (running) return;
  if (authority && !authority.startRound()) return;
  running = true;
  out('started', { players: roster.length });
  inputTimer = setInterval(sendInput, 1000 / Sim.CFG.inputHz);
  if (authority) {
    simTimer = setInterval(() => authority.step(1000 / Sim.CFG.simulationHz, authority.serverTimeMs + 1000 / Sim.CFG.simulationHz), 1000 / Sim.CFG.simulationHz);
    snapshotTimer = setInterval(() => {
      const snapshot = authority.createSnapshot();
      lastSnapshot = snapshot;
      network.sendSnapshot(snapshot);
      if (snapshot.roundEnded) finish(snapshot);
    }, 1000 / Sim.CFG.snapshotHz);
  }
  reportTimer = setInterval(report, 500);
}

function stopGameplay() {
  for (const timer of [inputTimer, simTimer, snapshotTimer, reportTimer]) if (timer) clearInterval(timer);
  inputTimer = simTimer = snapshotTimer = reportTimer = null;
  running = false;
  state.trigger = false;
}

function report() {
  const me = own();
  if (!me) return;
  const position = { x: Number(me.x.toFixed(3)), y: Number(me.y.toFixed(3)), z: Number(me.z.toFixed(3)) };
  const moved = lastReportPosition ? Math.hypot(position.x - lastReportPosition.x, position.y - lastReportPosition.y, position.z - lastReportPosition.z) : 0;
  lastReportPosition = position;
  out('state', { position, moved, hp: me.hp, alive: me.alive, weapon: me.weapon, messages: { ...network.metrics } });
}

function finish(snapshot) {
  if (!snapshot || !snapshot.roundEnded) return;
  if (!isHost && snapshot.roundEndSeq) network.sendRoundAck(snapshot.roundEndSeq);
  if (roundEnded) return;
  roundEnded = true;
  stopGameplay();
  out('round_end', { winnerId: snapshot.winnerId, roundEndSeq: snapshot.roundEndSeq, messages: { ...network.metrics } });
  if (isHost) {
    const deadline = Date.now() + 3000;
    const retry = setInterval(() => {
      network.sendSnapshot(authority.createSnapshot());
      const guests = roster.filter(player => player.playerId !== peerId).map(player => player.playerId);
      if (guests.every(id => roundAcks.has(id)) || Date.now() >= deadline) {
        clearInterval(retry);
        out('round_confirmed', { confirmed: guests.every(id => roundAcks.has(id)), acks: [...roundAcks], messages: { ...network.metrics } });
      }
    }, 250);
  }
}

function updateRoster(next) {
  roster = next;
  if (authority) {
    const guest = next.find(player => player.playerId !== peerId);
    if (guest && !authority.players.has(guest.playerId)) authority.addPlayer(guest.playerId, { name: guest.name });
    for (const id of [...authority.players.keys()]) if (id !== peerId && (!guest || id !== guest.playerId)) authority.removePlayer(id);
    maybeStart();
  }
  out('roster', { roster: next.map(player => ({ id: player.playerId, name: player.name, role: player.role })) });
}

function maybeStart() {
  if (!isHost || startSent || !network || !network.canStart() || roster.length !== 2) return;
  startSent = true;
  const message = { seq: Date.now(), type: 'real_start', startsAtMs: Date.now() + 900, protocol: 2, world: 'foundry' };
  network.sendLobby(message).then(ok => { if (ok) setTimeout(startLoops, 900); });
}

function receiveSnapshot(snapshot) {
  if (isHost || !snapshot || snapshot.protocol !== 2) return;
  lastSnapshot = snapshot;
  predictor.applySnapshot(snapshot);
  if (snapshot.roundEnded) {
    if (snapshot.roundEndSeq) network.sendRoundAck(snapshot.roundEndSeq);
    finish(snapshot);
  }
}

function receiveLobby(message) {
  if (!isHost && message && message.type === 'real_start' && message.protocol === 2) {
    const wait = Math.max(0, Number(message.startsAtMs) - network.toHostTime(Date.now()));
    setTimeout(startLoops, wait);
  }
}

function command(raw) {
  let message;
  try { message = JSON.parse(raw); } catch (_) { out('command_error', { raw }); return; }
  if (message.type === 'move') {
    state.moveF = Number(message.moveF) || 0;
    state.moveR = Number(message.moveR) || 0;
    state.sprint = message.sprint === true;
    if (moveTimer) clearTimeout(moveTimer);
    if (Number(message.duration) > 0) moveTimer = setTimeout(() => { state.moveF = 0; state.moveR = 0; state.sprint = false; }, Number(message.duration));
  } else if (message.type === 'jump') {
    state.jump = true; setTimeout(() => { state.jump = false; }, 120);
  } else if (message.type === 'fire') {
    fireId += 1;
    state.trigger = true;
    setTimeout(() => { state.trigger = false; }, Number(message.duration) || 100);
  } else if (message.type === 'weapon' && Sim.WEAPONS[message.weapon]) state.weapon = message.weapon;
  else if (message.type === 'reload') reloadId += 1;
  else if (message.type === 'report') report();
  else if (message.type === 'quit') shutdown(0);
  out('command', { command: message });
}

async function shutdown(code) {
  stopGameplay();
  if (moveTimer) clearTimeout(moveTimer);
  if (network) await network.close();
  process.exit(code);
}

async function main() {
  if (authority) authority.addPlayer(peerId, { name });
  network = new PVPRealtime.RealtimeRoom({
    client, roomCode, peerId, name, isHost,
    onInput: (id, input, receivedAt) => authority && authority.receiveInput(id, input, receivedAt),
    onRoundAck: (id, seq) => {
      if (authority && authority.roundEnded && seq === authority.roundEndSeq) roundAcks.add(id);
    },
    onSnapshot: receiveSnapshot,
    onLobby: receiveLobby,
    onRoster: updateRoster,
    onStatus: status => {
      out('network', { status: status.kind, rttMs: network && network.rttMs });
      if (status.kind === 'input_ready') maybeStart();
    },
  });
  await network.connect();
  if (!isHost) {
    await network.syncClock();
    setInterval(() => !roundEnded && network.syncClock(), 2500).unref();
  }
  readline.createInterface({ input: process.stdin }).on('line', command);
  out('connected', { roomCode });
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
main().catch(error => { out('fatal', { message: error.message, stack: error.stack }); process.exit(1); });
