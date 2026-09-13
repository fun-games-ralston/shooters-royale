'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create, INTERVAL_MS, STORAGE_KEY } = require('../shared/playtime-reminder.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
function advance(timer, from, milliseconds, active = true) {
  timer.update(from, active);
  for (let elapsed = 1000; elapsed <= milliseconds; elapsed += 1000) timer.update(from + elapsed, active);
  return from + milliseconds;
}
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 10);
  return source.slice(start, end);
}

test('only active play accrues; pauses, menus and background intervals do not', () => {
  const timer = create(storage());
  let now = advance(timer, 0, 15 * 60000);
  now = advance(timer, now, 60 * 60000, false);
  assert.equal(timer.minutes(), 15);
  now = advance(timer, now, 14 * 60000);
  assert.equal(timer.due(), false);
  advance(timer, now, 60000);
  assert.equal(timer.minutes(), 30);
  assert.equal(timer.due(), true);
});

test('a suspended frame is not counted as gameplay', () => {
  const timer = create(storage());
  timer.update(0, true);
  timer.update(2 * INTERVAL_MS, true);
  assert.equal(timer.minutes(), 0);
  assert.equal(timer.due(), false);
});

test('both dismissal choices allow another full 30 active minutes before reminding', () => {
  const timer = create(storage());
  let now = advance(timer, 0, INTERVAL_MS + 60000);
  assert.equal(timer.due(), true);
  timer.dismiss();
  now = advance(timer, now, INTERVAL_MS - 60000);
  assert.equal(timer.due(), false);
  advance(timer, now, 60000);
  assert.equal(timer.due(), true);
});

test('reload preserves active time and dismissal, without counting time off the page', () => {
  const saved = storage();
  const first = create(saved);
  advance(first, 0, INTERVAL_MS);
  first.save();
  const reloaded = create(saved);
  assert.equal(reloaded.due(), true);
  reloaded.dismiss();
  const again = create(saved);
  advance(again, 100000000, INTERVAL_MS - 60000);
  assert.equal(again.due(), false);
  assert.equal(again.minutes(), 59);
});

test('unavailable or malformed session storage cannot stop play', () => {
  const saved = storage();
  saved.setItem(STORAGE_KEY, '{bad json');
  for (const provider of [null, saved, { getItem() { throw Error(); }, setItem() { throw Error(); } }]) {
    const timer = create(provider);
    advance(timer, 0, INTERVAL_MS);
    assert.equal(timer.due(), true);
    assert.doesNotThrow(() => timer.dismiss());
  }
});

test('a due reminder waits until the match and outro finish; both choices leave scores unchanged', () => {
  const elements = new Map();
  let focused = null;
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(['hidden']);
      elements.set(id, { textContent: '', classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) }, focus: () => { focused = id; } });
    }
    return elements.get(id);
  }
  const timer = create(storage());
  advance(timer, 0, INTERVAL_MS);
  const ctx = { PLAYTIME: timer, G: { on: true, over: false }, S: { stats: { wins: 9 } }, document: { hidden: false }, $: element, buildMenuScene() {}, show() {} };
  vm.createContext(ctx);
  vm.runInContext(extract('showBreakReminder') + extract('dismissBreakReminder'), ctx);
  ctx.showBreakReminder();
  assert.equal(element('#ovBreak').classList.contains('hidden'), true);
  ctx.G.over = true; // outro still running
  ctx.showBreakReminder();
  assert.equal(element('#ovBreak').classList.contains('hidden'), true);
  ctx.G.on = false;
  ctx.showBreakReminder();
  assert.equal(element('#ovBreak').classList.contains('hidden'), false);
  assert.match(element('#breakText').textContent, /30 minutes/);
  assert.equal(focused, '#btnKeepPlaying');
  ctx.dismissBreakReminder(false);
  assert.equal(element('#ovBreak').classList.contains('hidden'), true);
  assert.equal(timer.due(), false);
  assert.equal(ctx.S.stats.wins, 9);
  ctx.dismissBreakReminder(true);
  assert.equal(focused, '#btnPlay');
  assert.equal(ctx.S.stats.wins, 9);
});

test('server rejections are visible, including a preview using the old capped backend', async () => {
  const start = source.indexOf('function cloudSubmit('), end = source.indexOf('\nconst HEAD_MULT', start);
  for (const error of ['TOO_FAST', 'TOO_SHORT', 'NO_NETWORK']) {
    const notices = [];
    const ctx = { ACC: { handle: 'TEST', pin: '0000' }, S: { cfg: { skill: 'rookie', bots: 7 } }, NET: { on: () => true, call: async () => ({ ok: false, error }) }, toast: message => notices.push(message), netMsg: e => e };
    vm.createContext(ctx);
    vm.runInContext(source.slice(start, end), ctx);
    ctx.cloudSubmit({ kills: 1, hs: 0, dmg: 200, win: true }, 'foundry', 10, { skill: 'rookie', bots: 7, time: 3, mode: 'challenge' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(notices, [`Score not sent to the leaderboard: ${error}`]);
  }
});


test('the main game script parses and keeps the existing Trial mode', () => {
  const start = source.indexOf('<script>', source.indexOf('three.min.js')) + 8;
  assert.doesNotThrow(() => new vm.Script(source.slice(start, source.lastIndexOf('</script>'))));
  assert.match(source, /mode:'trial'/);
  assert.doesNotMatch(source, /sr_submit_v2|SEASONAL CHALLENGE/);
});
