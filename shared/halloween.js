(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BlockRoyaleHalloween=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  // Both solo and Friends use this layout, including the exact cover and stairs.
  // Moving ghosts, bats and swing seats are scenery and never enter collision.
  function build(add,def){
    const H=def.size/2,wood=0x655078,roof=0x353046,orange=0xff8a32,mint=0xa5f5ce;
    const decks=[];
    add(0,-1,0,def.size,2,def.size,def.ground);
    // A cross of cobbled paths connects every landmark with two escape routes.
    add(0,.025,0,def.size-2,.05,8,0x484354,0,false);
    add(0,.026,0,8,.05,def.size-2,0x484354,0,false);
    for(let k=-4;k<=4;k++){
      add(k*7,.06,0,3,.08,.16,0xb89966,0,false);
      add(0,.06,k*7,.16,.08,3,0xb89966,0,false);
    }
    for(const [x,z,w,d] of [[0,-H,def.size,1],[0,H,def.size,1],[-H,0,1,def.size],[H,0,1,def.size]]){
      add(x,2,z,w,4,d,roof);
      add(x,4.1,z,w+.2,.2,d+.2,wood);
    }
    for(let i=-4;i<=4;i++) for(const z of [-H,H]){
      add(i*8,4.8,z,.45,1.4,.45,wood);
      add(i*8,5.55,z,.6,.2,.6,orange,.6,false);
    }
    for(const x of [-4,4]) add(x,2.8,-34,.7,5.6,.7,wood);
    add(0,5.7,-34,9,.5,.8,wood);

    // Four boarded houses form the ghost-town backdrop and reachable rooftops.
    for(const [x,z] of [[-24,-24],[24,-24],[-24,24],[24,24]]){
      const toward=-Math.sign(z),side=-Math.sign(x);
      add(x,2.1,z-toward*4.5,10,4.2,.6,wood);
      for(const dx of [-4.7,4.7]) add(x+dx,2.1,z,.6,4.2,9,wood);
      for(const dx of [-3.3,3.3]) add(x+dx,2.1,z+toward*4.5,3.4,4.2,.6,wood);
      add(x,3.75,z+toward*4.5,3.2,.9,.6,wood);
      add(x,4.4,z,11,.3,10,roof);
      add(x,5.2,z-toward*2,10,1.3,1.1,roof);
      add(x,6.15,z-toward*2,7,.6,1.1,roof);
      add(x+2,6.6,z-toward*2,1,2,1,0x78667e);
      for(const dx of [-3.25,3.25]){
        add(x+dx,2.6,z+toward*4.84,1.4,1.6,.08,mint,.65,false);
        add(x+dx,2.55,z+toward*4.91,1.8,.24,.1,0x8c714f,0,false);
        add(x+dx,3.05,z+toward*4.91,1.8,.24,.1,0x8c714f,0,false);
      }
      for(let i=0;i<8;i++){
        const h=(i+1)*.55;
        add(x+side*(5.5+(7-i)*.85),h/2,z,1,h,2.6,0x78667e);
      }
      decks.push({x,z,y:4.55,w:11,d:10});
      pumpkin(add,x+side*3,0,z+toward*6,1.1);
    }

    // The pumpkin carousel is low enough to step onto from every direction.
    add(0,.25,0,12,.5,12,0x60516d);
    add(0,1.5,0,1.4,2,1.4,wood);
    pumpkin(add,0,2,0,3.1);
    for(const [x,z] of [[-4,-4],[4,-4],[-4,4],[4,4]]){
      add(x,3.35,z,.45,5.7,.45,wood);
      add(x,6.25,z,.8,.35,.8,orange,.55,false);
    }
    add(0,6.65,0,12,.35,12,roof);
    add(0,7.2,0,8,.7,8,wood);
    add(0,7.85,0,4,.6,4,orange,.2,false);
    pumpkin(add,0,8.15,0,2.5);
    for(let i=-4;i<=4;i++) for(const z of [-6,6]) add(i*1.2,6.4,z,.22,.22,.22,i%2?mint:orange,.9,false);
    for(const x of [-4,4]){
      add(x,1.15,0,1.5,1.3,3,0x9b829b);
      add(x,2.1,-1,1,1.5,1,0x9b829b);
      add(x,2.35,-1.53,.16,.16,.08,mint,.7,false);
    }
    decks.push({x:0,z:0,y:.5,w:12,d:12});

    // Swing yard: real posts and an open underpass, moving seats added below.
    for(const x of [-20,-14]) for(const z of [-4,4]) add(x,2.5,z,.45,5,.45,0x658581);
    for(const z of [-4,4]) add(-17,5.05,z,7,.4,.45,0x658581);
    for(const x of [-20,-14]) add(x,5.05,0,.4,.4,8,0x658581);
    // Climbing blocks and a broad staircase slide on the opposite side.
    for(let i=0;i<6;i++) add(17,((i+1)*.5)/2,-3+i,3,(i+1)*.5,1,wood);
    add(17,2.8,3,4,.4,3,0x658581);
    for(let i=0;i<6;i++) add(17,(3-i*.5)/2,5+i,3,3-i*.5,1,0xb57d45);
    decks.push({x:17,z:3,y:3,w:4,d:3});

    // Cemetery cover stays below head height; lanterns mark the lanes.
    for(const [x,z] of [[-10,19],[-5,23],[5,23],[10,19],[-10,-19],[10,-19]]){
      add(x,.75,z,1.6,1.5,.65,0x9990a2);
      add(x,1.57,z,1.2,.2,.7,0xbab3c1);
      add(x,1.1,z+.34,.25,.6,.06,roof,0,false);
      add(x,1.1,z+.35,.7,.2,.06,roof,0,false);
    }
    for(const [x,z] of [[-9,-10],[9,-10],[-9,10],[9,10],[-28,5],[28,-5]]) pumpkin(add,x,0,z,1.3);
    for(const [x,z] of [[-8,-29],[8,-29],[-8,29],[8,29],[-29,-8],[29,8]]){
      add(x,2,z,.3,4,.3,wood);
      add(x,4.2,z,.75,.65,.75,orange,.7,false);
    }
    for(const [x,z] of [[-32,-15],[32,15],[-15,32],[15,-32]]){
      add(x,3,z,.6,6,.6,wood);
      add(x-1,4.5,z,2,.3,.3,wood,0,false);
      add(x+1,5.4,z,.3,.3,2,wood,0,false);
    }
    const spawns=[[-30,0],[30,0],[0,-30],[0,30],[-30,-10],[30,10],[-10,-30],[10,30],[-30,10],[30,-10],[10,-30],[-10,30]].map(([x,z])=>({x,y:0,z}));
    return {spawns,decks};
  }

  function pumpkin(add,x,y,z,s){
    add(x,y+s*.48,z,s*1.15,s*.85,s,0xd76622);
    add(x,y+s*.97,z,.18*s,.25*s,.2*s,0x6e8350,0,false);
    for(const side of [-1,1]){
      add(x+side*s*.25,y+s*.63,z+s*.51,s*.19,s*.18,.04,0xffd784,.95,false);
      add(x+side*s*.24,y+s*.34,z+s*.51,s*.19,s*.12,.04,0xffd784,.95,false);
    }
    add(x,y+s*.28,z+s*.51,s*.38,s*.12,.04,0xffd784,.95,false);
  }

  function atmosphere(THREE,group){
    const movers=[],geometry=new THREE.BoxGeometry(1,1,1);
    const materials={};
    function part(parent,x,y,z,w,h,d,color,opacity=1){
      const key=color+'|'+opacity;
      if(!materials[key]) materials[key]=new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1});
      const m=new THREE.Mesh(geometry,materials[key]);m.position.set(x,y,z);m.scale.set(w,h,d);parent.add(m);return m;
    }
    // Ghosts float above rooftops, with no enemy name tags or health bars.
    for(const [i,p] of [[-11,9,-13],[13,10,13],[-25,9,17],[24,10,-19]].entries()){
      const ghost=new THREE.Group();ghost.position.set(...p);group.add(ghost);
      part(ghost,0,0,0,1.3,1.5,.8,0xd4ffe8,.68);
      part(ghost,0,.85,0,1,.45,.7,0xd4ffe8,.68);
      for(const x of [-.44,0,.44]) part(ghost,x,-.85,0,.35,.35,.65,0xd4ffe8,.68);
      for(const x of [-.28,.28]) part(ghost,x,.25,.42,.18,.25,.05,0x204b48);
      part(ghost,0,-.15,.42,.18,.22,.05,0x204b48);
      movers.push({mesh:ghost,x:p[0],y:p[1],z:p[2],phase:i*1.7,type:'ghost'});
    }
    for(const z of [-2.5,2.5]){
      const swing=new THREE.Group();swing.position.set(-17,4.85,z);group.add(swing);
      for(const x of [-.7,.7]) part(swing,x,-1.6,0,.06,3.2,.06,0xaab8af);
      part(swing,0,-3.25,0,1.8,.22,.9,0xde9956);
      movers.push({mesh:swing,phase:z,type:'swing'});
    }
    for(let i=0;i<8;i++){
      const bat=new THREE.Group();group.add(bat);
      part(bat,0,0,0,.2,.25,.3,0x9a849f);
      const left=part(bat,-.3,0,0,.5,.08,.3,0x9a849f),right=part(bat,.3,0,0,.5,.08,.3,0x9a849f);
      movers.push({mesh:bat,left,right,phase:i*Math.PI/4,type:'bat'});
    }
    const moon=new THREE.Mesh(new THREE.SphereGeometry(5,16,12),new THREE.MeshBasicMaterial({color:0xe5dab3}));
    moon.position.set(-31,26,-37);group.add(moon);
    if(typeof document!=='undefined'){
      const cv=document.createElement('canvas');cv.width=512;cv.height=96;
      const ctx=cv.getContext('2d');ctx.fillStyle='#34213f';ctx.fillRect(0,0,512,96);
      ctx.strokeStyle='#e9a35f';ctx.lineWidth=6;ctx.strokeRect(4,4,504,88);
      ctx.fillStyle='#ffd7a3';ctx.font='bold 44px monospace';ctx.textAlign='center';ctx.fillText('GHOSTLIGHT',256,65);
      const sign=new THREE.Mesh(new THREE.PlaneGeometry(8,1.5),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),side:THREE.DoubleSide}));
      sign.position.set(0,6.2,-33.55);group.add(sign);
    }
    // A few translucent patches stay at ankle height and off the central lanes.
    for(const [x,z] of [[-25,-12],[25,12],[-12,25],[12,-25]]) part(group,x,.15,z,9,.14,5,0xa5d4cd,.12);
    function step(t){
      for(const m of movers){
        if(m.type==='ghost'){
          m.mesh.position.set(m.x+Math.sin(t*.35+m.phase)*1.2,m.y+Math.sin(t*.8+m.phase)*.55,m.z+Math.cos(t*.3+m.phase)*.8);
          m.mesh.rotation.y=Math.sin(t*.3+m.phase)*.5;
        }else if(m.type==='swing') m.mesh.rotation.z=Math.sin(t*.9+m.phase)*.24;
        else{
          const a=t*.18+m.phase;m.mesh.position.set(Math.cos(a)*24,13+Math.sin(a*3)*1.5,Math.sin(a)*24);
          m.mesh.rotation.y=-a;m.left.rotation.z=Math.sin(t*8+m.phase)*.7;m.right.rotation.z=-m.left.rotation.z;
        }
      }
    }
    step(0);return {step};
  }
  return {build,atmosphere};
});
