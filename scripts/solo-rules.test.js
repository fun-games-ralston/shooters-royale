'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const timeUpSource=source.slice(source.indexOf('function timeUp(){'),source.indexOf('function endMatch('));
test('solo timer draws with multiple survivors regardless of kills',()=>{
 const player={alive:true,kills:0},bot={alive:true,kills:10};const results=[];
 const context={G:{training:false,pl:player,ents:[player,bot]},endMatch:(...args)=>results.push(args)};
 vm.runInNewContext(timeUpSource+'timeUp()',context);assert.deepEqual(results,[[false,true]]);
 bot.alive=false;vm.runInNewContext(timeUpSource+'timeUp()',context);assert.deepEqual(results[1],[true,false]);
});
test('capture failure keeps solo paused and successful capture resumes',()=>{
 const handlers={};const canvas={addEventListener(){}};
 const context={G:{on:true,over:false,paused:false},$:()=>canvas,document:{addEventListener:(name,fn)=>handlers[name]=fn},window:{addEventListener(){}},pauseMatch:()=>{context.G.paused=true;},toast(){},onResize(){}};
 const start=source.indexOf('function initInput(){'),end=source.indexOf('\nfunction ',start+10);
 vm.runInNewContext(source.slice(start,end)+'\ninitInput();',context);
 handlers.pointerlockerror();assert.equal(context.G.paused,true);
 context.$=()=>({classList:{add(){}}});context.document.pointerLockElement=canvas;handlers.pointerlockchange();assert.equal(context.G.paused,false);
});
