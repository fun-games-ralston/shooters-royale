'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const next = source.indexOf('\nfunction ', start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

function rulesContext() {
  const context = {
    result: null,
    S: { challenge: { season: 'preseason', bestTier: 2 } },
    SEASON_STATUS: { current: { slug: 'preseason' } },
    localSeasonStatus: () => ({ current: { slug: 'preseason' } }),
  };
  vm.runInNewContext(
    "const CHALLENGE_RULES=Object.freeze({bots:7,time:3,minKills:3});\n" +
      "const CHALLENGE_TIERS=Object.freeze(['rookie','regular','veteran','elite','nightmare']);\n" +
      'const clamp=(v,a,b)=>v<a?a:v>b?b:v;\n' +
      functionSource('normalizeMode') + '\n' +
      functionSource('challengeProgress') + '\n' +
      functionSource('challengeTargetSkill') + '\n' +
      functionSource('recordChallengeClear') + '\n' +
      functionSource('matchRules') + '\n' +
      functionSource('challengeCleared'),
    context
  );
  return context;
}

test('the complete inline game script parses', () => {
  const start = source.indexOf('<script>', source.indexOf('three.min.js')) + '<script>'.length;
  const end = source.lastIndexOf('</script>');
  assert.doesNotThrow(() => new vm.Script(source.slice(start, end), { filename: 'index-inline.js' }));
});

test('old Trial saves migrate to Challenge without changing custom controls', () => {
  const context = rulesContext();
  vm.runInNewContext("result=normalizeMode('trial')", context);
  assert.equal(context.result, 'challenge');

  vm.runInNewContext(
    "result=matchRules({mode:'challenge',arena:'foundry',skill:'nightmare',bots:1,time:6})",
    context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    mode: 'challenge', arena: 'foundry', skill: 'veteran', bots: 7, time: 3,
  });

  vm.runInNewContext(
    "result=matchRules({mode:'custom',arena:'grid',skill:'rookie',bots:1,time:6})",
    context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    mode: 'custom', arena: 'grid', skill: 'rookie', bots: 1, time: 6,
  });
});

test('a Challenge needs a win and three eliminations', () => {
  const context = rulesContext();
  const evaluate = (win, kills, mode = 'challenge') => {
    vm.runInNewContext(`result=challengeCleared({win:${win},kills:${kills}},{mode:'${mode}'})`, context);
    return context.result;
  };
  assert.equal(evaluate(true, 3), true);
  assert.equal(evaluate(true, 2), false);
  assert.equal(evaluate(false, 7), false);
  assert.equal(evaluate(true, 7, 'custom'), false);
});

test('the Preseason transition changes to Season 1 on the announced date', () => {
  const context = { result: null };
  vm.runInNewContext(
    "const SEASON_FALLBACK=Object.freeze({current:{slug:'preseason',name:'Preseason',starts_at:'2000-01-01T00:00:00Z',ends_at:'2026-09-25T07:00:00Z'},next:{slug:'season-1',name:'Season 1',starts_at:'2026-09-25T07:00:00Z',ends_at:'2026-10-23T07:00:00Z'}});\n" +
      functionSource('localSeasonStatus') + '\n' + functionSource('seasonDaysUntil'),
    context
  );
  vm.runInNewContext("result=localSeasonStatus(Date.parse('2026-09-12T07:00:00Z'))", context);
  assert.equal(context.result.current.slug, 'preseason');
  assert.equal(context.result.next.slug, 'season-1');
  vm.runInNewContext("result=seasonDaysUntil('2026-09-25T07:00:00Z',Date.parse('2026-09-12T07:00:00Z'))", context);
  assert.equal(context.result, 13);
  vm.runInNewContext("result=localSeasonStatus(Date.parse('2026-09-25T07:00:00Z'))", context);
  assert.equal(context.result.current.slug, 'season-1');
});

test('Custom fallback saves progress but never calls the legacy leaderboard submit', async () => {
  const calls = [];
  const context = {
    ACC: { handle: 'PLAYER', pin: '1234' },
    S: { cfg: {}, stats: {} },
    NET: {
      on: () => true,
      call: async (fn, body) => {
        calls.push({ fn, body });
        return fn === 'sr_submit_v2' ? { ok: false, error: 'HTTP_404' } : { ok: true };
      },
    },
    matchRules: () => { throw new Error('explicit rules expected'); },
    toast: () => {},
    netMsg: value => value,
  };
  vm.runInNewContext(functionSource('cloudSubmit'), context);
  const rules = { mode: 'custom', arena: 'foundry', skill: 'nightmare', bots: 1, time: 1 };
  context.cloudSubmit({ kills: 1, hs: 0, dmg: 200, win: true }, 'foundry', 30, rules);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call.fn), ['sr_submit_v2', 'sr_save']);
});

test('main menu uses a read-only Challenge briefing and Custom owns Match Setup', () => {
  const menu = source.slice(source.indexOf('<div class="menu-col">'), source.indexOf('</div>', source.indexOf('<div class="menu-col">')));
  assert.match(menu, /Seasonal challenge/);
  assert.match(menu, /Custom battle/);
  assert.doesNotMatch(menu, />Match setup</);
  assert.match(source, /btnPlay'\)\.onclick=.*showChallengeBriefing\(\)/);
  assert.match(source, /btnSetup'\)\.onclick=.*mode='custom'.*renderSetup\(\).*scr-setup/);
  const brief = source.slice(source.indexOf('id="scr-challenge"'), source.indexOf('<!-- SETUP -->'));
  assert.doesNotMatch(brief, />Change</);
  assert.match(source, /btnAgain'\)\.onclick=.*startMatch\(\)/);
  assert.match(source, /CHALLENGE CLEAR \\u2014 NEXT TARGET/);
  assert.doesNotMatch(functionSource('stepUpHint'), /Match setup/);
  assert.match(source, /const CHALLENGE_BRIEF_MS=6000/);
  assert.doesNotMatch(functionSource('startMatch'), /pauseMatch\(true\)/);
  assert.doesNotMatch(functionSource('startMatch'), /arena is ready/i);
  assert.doesNotMatch(source.match(/btnPlay'\)\.onclick[^\n]+/)[0], /captureMouse/);
});
