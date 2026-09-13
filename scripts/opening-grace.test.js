'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

test('arena combat does not have a movement-only opening grace period',()=>{
  assert.doesNotMatch(source,/G\.grace|TRIAL BEGINS IN/);
  assert.match(source,/if\(mouseDown&&canFire\(p\)\)\{/);
  assert.match(source,/if\(shoot && p\.reloadT<=0\)\{ fire\(p,playerAim\(\)\); \}/);
});
