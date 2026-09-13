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
    S: { challenge: { season: 'preseason', bestTier: 2, tierWins: 0 } },
    SEASON_STATUS: { current: { slug: 'preseason' } },
    localSeasonStatus: () => ({ current: { slug: 'preseason' } }),
  };
  vm.runInNewContext(
    "const CHALLENGE_RULES=Object.freeze({bots:7,time:3,winsPerTier:6});\n" +
      "const CHALLENGE_TIERS=Object.freeze(['rookie','regular','veteran','elite','nightmare']);\n" +
      'const clamp=(v,a,b)=>v<a?a:v>b?b:v;\n' +
      functionSource('normalizeMode') + '\n' +
      functionSource('challengeProgress') + '\n' +
      functionSource('challengeTargetSkill') + '\n' +
      functionSource('challengeEliminationTarget') + '\n' +
      functionSource('challengeQualifyingWin') + '\n' +
      functionSource('challengeResultOutcome') + '\n' +
      functionSource('recordChallengeResult') + '\n' +
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
    mode: 'challenge', arena: 'foundry', skill: 'veteran', bots: 7, time: 3, hunted: false,
  });

  vm.runInNewContext(
    "result=matchRules({mode:'custom',arena:'grid',skill:'rookie',bots:1,time:6,hunted:true})",
    context
  );
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), {
    mode: 'custom', arena: 'grid', skill: 'rookie', bots: 1, time: 6, hunted: true,
  });

  vm.runInNewContext(
    "result=matchRules({mode:'custom',arena:'grid',skill:'rookie',bots:1,time:6,hunted:false})",
    context
  );
  assert.equal(context.result.hunted, false);

  for (const mode of ['challenge', 'training']) {
    vm.runInNewContext(
      `result=matchRules({mode:'${mode}',arena:'grid',skill:'rookie',bots:1,time:6,hunted:true})`,
      context
    );
    assert.equal(context.result.hunted, false, `${mode} must ignore the Custom-only hunt rule`);
  }
});

test('six cumulative qualifying wins clear a tier without losses erasing progress', () => {
  const context = rulesContext();
  context.S.challenge = { season: 'preseason', bestTier: 0, tierWins: 0 };
  const play = (win, kills, skill = 'rookie', mode = 'challenge') => {
    vm.runInNewContext(`result=recordChallengeResult({win:${win},kills:${kills}},{mode:'${mode}',skill:'${skill}'})`, context);
    return context.result;
  };
  assert.equal(play(true, 2).qualifying, false);
  assert.equal(context.S.challenge.tierWins, 0);
  for (let i = 1; i <= 3; i++) {
    const outcome = play(true, 3);
    assert.equal(outcome.qualifying, true);
    assert.equal(outcome.cleared, false);
    assert.equal(context.S.challenge.tierWins, i);
  }
  assert.equal(play(false, 7).qualifying, false);
  assert.equal(context.S.challenge.tierWins, 3, 'a loss must not erase qualifying wins');
  play(true, 3);
  play(true, 3);
  const clear = play(true, 3);
  assert.equal(clear.cleared, true);
  assert.equal(context.S.challenge.bestTier, 1);
  assert.equal(context.S.challenge.tierWins, 0, 'the next tier starts at zero');

  assert.equal(play(true, 2, 'regular').qualifying, false, 'Regular still needs three eliminations');
  context.S.challenge = { season: 'preseason', bestTier: 2, tierWins: 0 };
  assert.equal(play(true, 2, 'veteran').qualifying, true, 'Veteran needs only two eliminations');
  assert.equal(play(true, 7, 'veteran', 'custom').qualifying, false, 'Custom never qualifies');
});

test('calendar seasons begin October 1 at Pacific midnight and follow month boundaries', () => {
  const context = { result: null };
  vm.runInNewContext(
    "const SEASON_TIME_ZONE='America/Los_Angeles';\n" +
      "const SEASON_FALLBACK=Object.freeze({current:{slug:'preseason',name:'Preseason',starts_at:'2000-01-01T00:00:00Z',ends_at:'2026-10-01T07:00:00Z'},next:{slug:'season-1',name:'Season 1',starts_at:'2026-10-01T07:00:00Z',ends_at:'2026-11-01T07:00:00Z'}});\n" +
      functionSource('zoneDateParts') + '\n' + functionSource('zoneOffsetMs') + '\n' + functionSource('pacificMonthStartMs') + '\n' +
      functionSource('localSeasonStatus') + '\n' + functionSource('seasonDaysUntil'),
    context
  );
  vm.runInNewContext("result=localSeasonStatus(Date.parse('2026-10-01T06:59:59Z'))", context);
  assert.equal(context.result.current.slug, 'preseason');
  assert.equal(context.result.next.slug, 'season-1');
  vm.runInNewContext("result=localSeasonStatus(Date.parse('2026-10-01T07:00:00Z'))", context);
  assert.equal(context.result.current.slug, 'season-1');
  assert.equal(context.result.current.ends_at, '2026-11-01T07:00:00.000Z');
  vm.runInNewContext("result=localSeasonStatus(Date.parse('2026-11-01T07:00:00Z'))", context);
  assert.equal(context.result.current.slug, 'season-2');
  assert.equal(context.result.current.ends_at, '2026-12-01T08:00:00.000Z', 'Pacific DST must not move the local reset hour');
});

test('season lifecycle messages appear on launch, checkpoints, and the final two days', () => {
  const context = { result: null };
  vm.runInNewContext(
    "const SEASON_TIME_ZONE='America/Los_Angeles';\n" +
      "const CHALLENGE_RULES=Object.freeze({bots:7,time:3,winsPerTier:6});\n" +
      "const CHALLENGE_TIERS=Object.freeze(['rookie','regular','veteran','elite','nightmare']);\n" +
      "const SKILLS={rookie:{name:'Rookie'},regular:{name:'Regular'},veteran:{name:'Veteran'},elite:{name:'Elite'},nightmare:{name:'Nightmare'}};\n" +
      functionSource('zoneDateParts') + '\n' + functionSource('seasonCalendarInfo') + '\n' + functionSource('seasonLifecycleReminder'),
    context
  );
  const status = "{current:{slug:'season-1',name:'Season 1',starts_at:'2026-10-01T07:00:00Z',ends_at:'2026-11-01T07:00:00Z'}}";
  const progress = "{bestTier:1,tierWins:4}";
  const titleOn = iso => {
    vm.runInNewContext(`result=seasonLifecycleReminder(${status},${progress},Date.parse('${iso}'))`, context);
    return context.result&&context.result.title;
  };
  assert.equal(titleOn('2026-10-01T18:00:00Z'), 'NEW SEASON');
  assert.equal(titleOn('2026-10-07T18:00:00Z'), 'WEEK ONE CHECKPOINT');
  assert.equal(titleOn('2026-10-15T18:00:00Z'), 'HALFWAY MARK');
  assert.equal(titleOn('2026-10-27T18:00:00Z'), 'FINAL WEEK');
  assert.equal(titleOn('2026-10-30T18:00:00Z'), '2 DAYS LEFT');
  assert.equal(titleOn('2026-10-31T18:00:00Z'), 'FINAL DAY');
  assert.equal(titleOn('2026-10-02T18:00:00Z'), null);
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

test('Challenge progress appears in both the six-second briefing and the leaderboard', () => {
  const briefing = functionSource('renderChallengeBriefRules');
  const board = functionSource('challengeProgressPanel');
  assert.match(source, /const CHALLENGE_BRIEF_MS=6000/);
  assert.match(briefing, /briefScore.*progress\.tierWins\+' \/ '\+CHALLENGE_RULES\.winsPerTier/);
  assert.match(briefing, /briefRequirement.*'WIN WITH '\+needed\+' ELIMINATIONS'/);
  assert.doesNotMatch(briefing, /AR\[|S\.eq\.(primary|pet)|\bOPPONENTS\b|\bMIN\b/);
  const briefHtml = source.slice(source.indexOf('id="scr-challenge"'), source.indexOf('<!-- SETUP -->'));
  assert.doesNotMatch(briefHtml, /briefPills|Deploy now/);
  assert.match(board, /YOUR RUN/);
  assert.match(board, /progress\.tierWins\+' \/ '\+CHALLENGE_RULES\.winsPerTier/);
  assert.match(board, /Losses do not erase progress/);
});

test('Challenge enters combat without a second firing lock or an origin-frame flash', () => {
  const spawn = functionSource('spawnMatch');
  const start = functionSource('startMatch');
  assert.doesNotMatch(source, /G\.grace|BATTLE BEGINS IN/);
  assert.match(spawn, /updateCamera\(0\); updateModels\(0\); updateHUD\(\); drawMinimap\(\)/);
  assert.match(start, /CLICK ARENA TO TAKE CONTROL/);
});

test('Custom and Training use a short briefing instead of a combat grace period', () => {
  const briefing = functionSource('showCustomBriefing');
  const customHtml = source.slice(source.indexOf('id="scr-custom-brief"'), source.indexOf('<!-- SETUP -->'));
  assert.match(source, /const CUSTOM_BRIEF_MS=3000/);
  assert.match(source, /btnDeploy2'\)\.onclick=.*showCustomBriefing\(\)/);
  assert.match(briefing, /rules\.mode==='training'/);
  assert.match(briefing, /rules\.hunted\?'SURVIVE THE HUNT':'LOCKED & LOADED'/);
  assert.doesNotMatch(customHtml, /Arena|Weapon|Pet|Opponent|Time limit/);
  assert.doesNotMatch(source, /G\.grace|BATTLE BEGINS IN/);
});

test('Custom setup prioritizes match choices and keeps Training last', () => {
  const setup = functionSource('renderSetup');
  const labels = ['Arena', 'Opponents', 'Opponent skill', 'Time limit', 'Hunted mode', 'Camera', 'Mouse sensitivity', 'Sound', 'Nametags', 'Training Range'];
  let previous = -1;
  for (const label of labels) {
    const current = setup.indexOf(`'${label}'`);
    assert.ok(current > previous, `${label} is out of order or missing`);
    previous = current;
  }
  assert.doesNotMatch(setup, /chipCard\('Mode'/);
  assert.doesNotMatch(setup, /Taking in|btnFighter/);
  assert.match(setup, /danger:true/);
  assert.match(setup, /Want every bot chasing you\? Turn this on\.\.\. if you dare\./);
  assert.match(setup, /danger:true,wide:true/);
  assert.match(source, /hunted:false/);
  assert.match(functionSource('adoptSave'), /p\.cfg\.mostWanted/);
  assert.match(functionSource('adoptSave'), /delete S\.cfg\.mostWanted/);
});

test('Hunted mode forces every living bot to target the player', () => {
  const player = { alive: true };
  const context = rulesContext();
  context.G = { rules: null, pl: player };
  vm.runInNewContext(functionSource('huntedTarget'), context);
  const targetFor = (mode, hunted) => {
    vm.runInNewContext(
      `G.rules=matchRules({mode:'${mode}',arena:'foundry',skill:'rookie',bots:5,time:3,hunted:${hunted}});result=huntedTarget()`,
      context
    );
    return context.result;
  };

  assert.equal(targetFor('custom', true), player);
  assert.equal(targetFor('custom', false), null);
  assert.equal(targetFor('challenge', true), null);
  assert.equal(targetFor('training', true), null);

  targetFor('custom', true);
  assert.equal(context.result, player);
  player.alive = false;
  vm.runInNewContext('result=huntedTarget()', context);
  assert.equal(context.result, null);

  const ai = functionSource('updateBot');
  assert.match(ai, /let best=marked/);
  assert.match(ai, /if\(!marked\)/);
  assert.match(functionSource('damage'), /const marked=t\.ai\?huntedTarget\(\):null/);
});
