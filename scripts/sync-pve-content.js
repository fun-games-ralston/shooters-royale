#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'index.html');
const outputPath = path.join(root, 'shared', 'pve-content.generated.js');
const names = ['WEAPONS', 'FOODS', 'HAIRS', 'OUTFITS', 'ACCS', 'PETS', 'PET_TACTICS', 'ARENAS'];

function findLiteralEnd(source, start) {
  const open = source[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`Expected array or object literal at ${start}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`Unterminated literal beginning at ${start}`);
}

function extractLiteral(source, name) {
  const marker = `const ${name} =`;
  const declaration = source.indexOf(marker);
  if (declaration < 0) throw new Error(`Could not find ${marker}`);
  const arrayStart = source.indexOf('[', declaration + marker.length);
  const objectStart = source.indexOf('{', declaration + marker.length);
  const candidates = [arrayStart, objectStart].filter(index => index >= 0);
  const start = Math.min(...candidates);
  if (!Number.isFinite(start)) throw new Error(`Could not find ${name} literal`);
  return source.slice(start, findLiteralEnd(source, start));
}

function generatedSource(source) {
  const literals = Object.fromEntries(names.map(name => [name, extractLiteral(source, name)]));
  const digest = crypto.createHash('sha256').update(names.map(name => literals[name]).join('\n')).digest('hex').slice(0, 16);
  const definitions = names.map(name => `  const ${name} = ${literals[name]};`).join('\n\n');
  return `/* GENERATED from index.html by scripts/sync-pve-content.js. Do not edit by hand. */\n` +
    `(function(root,factory){\n` +
    `  const api=factory();\n` +
    `  if(typeof module==='object'&&module.exports) module.exports=api;\n` +
    `  else root.BlockRoyaleContent=api;\n` +
    `})(typeof globalThis!=='undefined'?globalThis:this,function(){\n` +
    `  'use strict';\n\n${definitions}\n\n` +
    `  return {CONTENT_VERSION:'${digest}',WEAPONS,FOODS,HAIRS,OUTFITS,ACCS,PETS,PET_TACTICS,ARENAS};\n` +
    `});\n`;
}

function main(argv = process.argv.slice(2)) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const expected = generatedSource(source);
  if (argv.includes('--check')) {
    const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (actual !== expected) {
      console.error('PvP content is out of sync with index.html. Run: node scripts/sync-pve-content.js');
      process.exitCode = 1;
      return false;
    }
    console.log('PvP content matches the PvE source of truth.');
    return true;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, expected);
  console.log(`Wrote ${path.relative(root, outputPath)}`);
  return true;
}

if (require.main === module) main();

module.exports = { extractLiteral, generatedSource, main, names };
