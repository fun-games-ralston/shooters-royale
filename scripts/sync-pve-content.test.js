const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractLiteral, generatedSource, names } = require('./sync-pve-content.js');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('extracts every PvE content table without evaluating the game', () => {
  for (const name of names) {
    const literal = extractLiteral(source, name);
    assert.match(literal, /^[\[{]/);
    assert.doesNotThrow(() => vm.runInNewContext(`(${literal})`));
  }
});

test('generated content is deterministic and exposes the complete catalog', () => {
  const first = generatedSource(source);
  const second = generatedSource(source);
  assert.equal(first, second);
  const sandbox = { globalThis: {} };
  vm.runInNewContext(first, sandbox);
  const content = sandbox.globalThis.BlockRoyaleContent;
  assert.equal(content.WEAPONS.length, 14);
  assert.equal(content.PETS.length, 7);
  assert.equal(content.ARENAS.length, 10);
  assert.equal(content.HAIRS.length, 7);
  assert.equal(content.OUTFITS.length, 8);
  assert.equal(content.ACCS.length, 7);
  assert.match(content.CONTENT_VERSION, /^[a-f0-9]{16}$/);
});
