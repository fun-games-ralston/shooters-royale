(() => {
  'use strict';

  const SUPABASE_URL = 'https://ctzjitzkolqghvonjtnx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_L7lbsM1-zMaOxfIASXIMCQ_0EeF20mq';
  const MATCH_VERSION = `${PVPRealSim.CONTENT_VERSION}-timed1`;
  const SIM_MS = 1000 / PVPRealSim.CFG.simulationHz;
  const INPUT_MS = 1000 / PVPRealSim.CFG.inputHz;
  const SNAPSHOT_MS = 1000 / PVPRealSim.CFG.snapshotHz;
  const $ = selector => document.querySelector(selector);
  const els = Object.fromEntries([
    'setup', 'lobby', 'play', 'connectStatus', 'hostName', 'guestName', 'roomCode', 'create', 'join',
    'lobbyState', 'lobbyCode', 'invite', 'copy', 'lobbyRoster', 'startMatch', 'leaveLobby', 'role',
    'players', 'rtt', 'messages', 'messageRate', 'viewport', 'arena', 'hp', 'hpFill', 'weaponName',
    'ammo', 'reserve', 'reloadState', 'roundOver', 'roundTitle', 'roundSummary', 'roundSync',
    'connectionLost', 'roomRoster', 'log', 'leaveMatch', 'weaponBar', 'hitMarker',
    'hostArena', 'savedKit', 'rematch', 'roundClock', 'scoreLine', 'controlHint', 'respawnHint',
  ].map(id => [id, document.getElementById(id)]));

  const keys = Object.create(null);
  const keyPulseUntil = Object.create(null);
  const weaponKeys = {};
  let roundId = '';
  let starting = false;
  let startTimer = null;
  let startRetryTimer = null;
  let readyTimer = null;
  const readyPlayers = new Set();
  let localLifeId = 0;
  let roomWins = {};
  let roomDraws = 0;
  let room = null;
  let authority = null;
  let predictor = null;
  let remoteBuffer = null;
  let world = null;
  let roster = [];
  let latest = null;
  let isHost = false;
  let peerId = '';
  let connected = false;
  let running = false;
  let roundEnded = false;
  let roundConfirmed = false;
  let seenHost = false;
  let hostLossTimer = null;
  let clockTimer = null;
  let frameHandle = 0;
  let lastFrame = 0;
  let simAccum = 0;
  let inputAccum = 0;
  let snapshotAccum = 0;
  let inputSeq = 0;
  let fireId = 0;
  let reloadId = 0;
  let trigger = false;
  let activeWeapon = 'sidearm';
  let localProfile = null;
  let matchArenaId = 'foundry';
  let localYaw = 0;
  let localPitch = 0;
  let aimInitialized = false;
  let lastEventSeq = 0;
  let lastAckSent = 0;
  let roundFinalizeTimer = null;
  let roundFinalizeDeadline = 0;
  const roundAcks = new Set();
  let lastMetricTotal = 0;
  let observedRate = 0;
  let rateTimer = null;

  let renderer = null;
  let scene = null;
  let camera = null;
  let viewModel = null;
  let viewWeapon = '';
  const fighterModels = new Map();
  const projectileModels = new Map();
  const effects = [];
  const petModels = new Map();

  function savedAppearance() {
    try {
      const state = JSON.parse(localStorage.getItem('sr_save_v1') || '{}');
      return state && state.eq || {};
    } catch (_) { return {}; }
  }

  function profileFromSave() {
    const eq = savedAppearance();
    return PVPRealSim.safeProfile({loadout:[eq.primary || 'sidearm',eq.secondary || null,eq.melee || 'knife'],pet:eq.pet,hair:eq.hair,outfit:eq.outfit,acc:eq.acc});
  }

  function populateSetup() {
    const profile = profileFromSave();
    els.savedKit.textContent = profile.loadout.map((id,index) => `${index+1}: ${id ? PVPRealSim.WEAPONS[id].name : 'Empty'}`).join(' · ') + ' · ' + (profile.pet ? PVPRealSim.PETS[profile.pet].name : 'No companion');
    for (const arena of PVPRealSim.CONTENT.ARENAS) els.hostArena.add(new Option(arena.name, arena.id));
    try { const saved=JSON.parse(localStorage.getItem('sr_save_v1')||'{}');els.hostArena.value=PVPRealSim.ARENAS[saved.cfg?.arena]?saved.cfg.arena:'foundry'; } catch (_) { els.hostArena.value='foundry'; }
  }

  function parseRoom(value) {
    const text=String(value||'').trim();
    const code=text.includes('#')?text.split('#').pop():text;
    return code.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,20);
  }

  function cleanName(value) {
    return (String(value || 'FIGHTER').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'FIGHTER').slice(0, 16);
  }

  function shortName(id) {
    const person = roster.find(item => item.playerId === id);
    return person ? person.name : String(id || '').slice(0, 6);
  }

  function setStage(stage) {
    for (const name of ['setup', 'lobby', 'play']) els[name].classList.toggle('hidden', name !== stage);
    document.body.dataset.stage = stage;
    publishDiagnostics();
  }

  function log(text, kind = '') {
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
    line.className = kind;
    els.log.prepend(line);
    while (els.log.children.length > 50) els.log.lastChild.remove();
  }

  function makeClient() {
    return supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 40 } },
    });
  }

  async function begin(host) {
    if (room || running) return;
    if (!window.supabase || !window.THREE || !window.PVPRealtime || !window.PVPRealSim || !window.BlockRoyaleContent || !window.BlockRoyaleWorld) {
      els.connectStatus.textContent = 'A required multiplayer or 3D library did not load. Refresh and try again.';
      return;
    }
    isHost = host;
    peerId = PVPRealtime.randomPeerId();
    const code = host ? PVPRealtime.randomRoomCode(12) : parseRoom(els.roomCode.value);
    const name = cleanName(host ? els.hostName.value : els.guestName.value);
    localProfile = profileFromSave();
    if (!host && String(code).replace(/[^A-Z2-9]/gi, '').length < 8) {
      els.connectStatus.textContent = 'Enter the host’s room code.';
      return;
    }
    els.create.disabled = true;
    els.join.disabled = true;
    els.connectStatus.textContent = 'Connecting…';
    room = new PVPRealtime.RealtimeRoom({
      client: makeClient(), roomCode: code, peerId, name, isHost: host,profile:localProfile,contentVersion:MATCH_VERSION,
      onInput: (id, input, receivedAt) => {
        if(authority && authority.receiveInput(id,input,receivedAt).accepted && startRetryTimer){clearInterval(startRetryTimer);startRetryTimer=null;}
      },
      onReady: handleReady,
      onRoundAck: handleRoundAck,
      onSnapshot: receiveSnapshot,
      onLobby: receiveLobby,
      onRoster: updateRoster,
      onStatus: status => {
        if (status.kind === 'error' || status.kind === 'send_error') {
          log(status.error ? status.error.message : `Network send failed: ${status.status}`, 'bad');
        }
        updateTelemetry();
        updateLobbyControls();
      },
    });
    try {
      await room.connect();
      connected = true;
      els.role.textContent = host ? 'HOST AUTHORITY' : 'GUEST CLIENT';
      els.lobbyCode.textContent = room.roomCode;
      const base = `${location.origin}${location.pathname}`;
      els.invite.value = `${base}#${room.roomCode}`;
      history.replaceState(null, '', `#${room.roomCode}`);
      setStage('lobby');
      if (!host) {
        await room.syncClock();
        clockTimer = setInterval(() => room && !roundEnded && room.syncClock(), 2500);
      }
      rateTimer = setInterval(sampleMessageRate, 1000);
      log(host ? 'Host authority connected' : 'Guest connected; waiting for host', 'good');
      updateLobbyControls();
    } catch (error) {
      els.connectStatus.textContent = `Could not connect: ${error.message}`;
      els.create.disabled = false;
      els.join.disabled = false;
      if (room) await room.close();
      room = null;
      authority = null;
      predictor = null;world=null;
    }
  }

  function admittedPlayers(next) {
    const own = next.find(item => item.playerId === peerId);
    const other = next.find(item => item.playerId !== peerId && item.role !== 'host') || next.find(item => item.playerId !== peerId);
    return [own, other].filter(Boolean);
  }

  function updateRoster(next) {
    roster = next.slice();
    if (authority) {
      const admitted = admittedPlayers(next);
      const ids = new Set(admitted.map(item => item.playerId));
      ids.add(peerId);
      for (const person of admitted) {
        if (!authority.players.has(person.playerId)) {
          if (authority.addPlayer(person.playerId, { name: person.name, profile: person.profile })) log(`${person.name} entered ${world.def.name}`, 'good');
        }
      }
      for (const id of [...authority.players.keys()]) {
        if (id !== peerId && !ids.has(id)) {
          authority.removePlayer(id);
          log(`${shortName(id)} disconnected`, 'bad');
        }
      }
      if (next.length > 2) log('Room is full; extra presence is not admitted', 'bad');
    }
    if (!isHost) {
      const hostPresent = next.some(item => item.role === 'host');
      if (hostPresent) {
        seenHost = true;
        if (hostLossTimer) clearTimeout(hostLossTimer);
        hostLossTimer = null;
      } else if (connected && seenHost && !roundEnded && !hostLossTimer) {
        hostLossTimer = setTimeout(() => {
          hostLossTimer = null;
          if (room && !room.roster.some(item => item.role === 'host')) endForHostLoss();
        }, 1500);
      }
    }
    if(roundEnded&&admittedPlayers(roster).length<2){
      if(readyTimer)clearInterval(readyTimer);readyTimer=null;
      els.rematch.disabled=true;els.rematch.textContent='Your friend left';
      els.roundSync.textContent='Leave this room to invite someone again.';
    }
    renderRosters();
    updateLobbyControls();
    updateTelemetry();
  }

  function renderRosters() {
    const admitted = admittedPlayers(roster);
    const roomRows = admitted.map(person => {
      const row = document.createElement('div');
      row.textContent = `${person.playerId === peerId ? '◆' : '◇'} ${person.name} · ${person.role === 'host' ? 'HOST' : 'GUEST'}`;
      return row;
    });
    els.roomRoster.replaceChildren(...roomRows);
    const seats = [];
    for (let index = 0; index < 2; index += 1) {
      const person = admitted[index];
      const seat = document.createElement('div');
      seat.className = `seat${person ? '' : ' empty'}`;
      if (person) {
        const title = document.createElement('strong');
        const detail = document.createElement('small');
        title.textContent = `${person.playerId === peerId ? '◆' : '◇'} ${person.name}`;
        const profile = PVPRealSim.safeProfile(person.profile);
        const pet = profile.pet ? PVPRealSim.PETS[profile.pet].name : 'NO PET';
        detail.textContent = `${profile.loadout.filter(Boolean).map(id => PVPRealSim.WEAPONS[id].name).join(' / ')} · ${pet}`;
        seat.append(title, detail);
      } else {
        seat.textContent = '◇ OPEN FIGHTER SLOT';
      }
      seats.push(seat);
    }
    els.lobbyRoster.replaceChildren(...seats);
    els.players.textContent = `${Math.min(admitted.length, 2)} / 2`;
  }

  function canStart() {
    const admitted = admittedPlayers(roster);
    return isHost && admitted.length === 2 && roster.length === 2 && admitted.every(item => item.contentVersion === MATCH_VERSION) && room && room.canStart();
  }

  function updateLobbyControls() {
    if (!room) return;
    const hostPresent = roster.some(item => item.role === 'host');
    if (isHost) {
      const ready = canStart();
      els.startMatch.disabled = !ready;
      const mismatch = roster.some(item => item.contentVersion && item.contentVersion !== MATCH_VERSION);
      els.startMatch.textContent = ready ? `Start 3-minute round` : roster.length < 2 ? 'Waiting for fighter' : mismatch ? 'Refresh both players' : 'Connecting your friend';
      els.lobbyState.textContent = ready ? 'Your friend is here. Ready to play.' : mismatch ? 'Game versions differ. Refresh both devices.' : 'Share the invite with one friend.';
    } else {
      els.startMatch.disabled = true;
      els.startMatch.textContent = 'Waiting for host';
      els.lobbyState.textContent = hostPresent ? 'Connected. The host starts the round.' : 'Finding your friend…';
    }
  }

  async function requestStart() {
    if (!canStart() || running || starting) return;
    if (roundEnded && !admittedPlayers(roster).every(p=>readyPlayers.has(p.playerId))) return;
    const message = { seq: Date.now(), roundId: `${peerId}-${Date.now()}`, type:'real_start', startsAtMs:Date.now()+1200, durationMs:180000, protocol:3, world:els.hostArena.value, contentVersion:MATCH_VERSION };
    starting=true;els.startMatch.disabled=true;els.startMatch.textContent='Starting…';
    if (await room.sendLobby(message)) {
      receiveLobby({...message,hostId:peerId});
      let attempts=0;
      startRetryTimer=setInterval(()=>{if(!room||++attempts>12){clearInterval(startRetryTimer);startRetryTimer=null;return;}room.sendLobby(message);},500);
    } else { starting=false;updateLobbyControls(); }
  }

  function handleReady(id, forRound) {
    if(!isHost || !roundEnded || forRound!==roundId || !admittedPlayers(roster).some(p=>p.playerId===id))return;
    readyPlayers.add(id);
    if(readyPlayers.has(peerId))requestStart();
    else els.roundSync.textContent='Your friend wants another round.';
  }

  async function readyAgain() {
    if(!roundEnded || !room || readyPlayers.has(peerId))return;
    readyPlayers.add(peerId);els.rematch.disabled=true;els.rematch.textContent='Waiting for your friend…';
    if(isHost)requestStart();
    else {
      const send=()=>room&&roundEnded&&room.sendReady(roundId);
      await send();readyTimer=setInterval(send,1000);
    }
  }

  function receiveLobby(message) {
    if (!message || message.type!=='real_start' || running || message.roundId===roundId || !message.roundId || message.protocol!==3 || message.contentVersion!==MATCH_VERSION || !PVPRealSim.ARENAS[message.world])return;
    if(startTimer)clearTimeout(startTimer);
    if(readyTimer)clearInterval(readyTimer);
    if(roundFinalizeTimer)clearInterval(roundFinalizeTimer);
    if(startRetryTimer)clearInterval(startRetryTimer);
    if(frameHandle)cancelAnimationFrame(frameHandle);
    readyTimer=roundFinalizeTimer=startRetryTimer=null;
    roundId=message.roundId;starting=true;roundEnded=false;roundConfirmed=false;
    roundAcks.clear();readyPlayers.clear();latest=null;lastEventSeq=lastAckSent=0;localLifeId=0;
    inputSeq=fireId=reloadId=0;trigger=false;aimInitialized=false;
    for(const code of Object.keys(keys))keys[code]=false;
    for(const code of Object.keys(keyPulseUntil))keyPulseUntil[code]=0;
    els.roundOver.classList.add('hidden');els.connectionLost.classList.add('hidden');
    els.rematch.disabled=false;els.rematch.textContent='Play again';
    matchArenaId=message.world;world=PVPRealSim.makeArenaWorld(matchArenaId);
    if(isHost){
      authority=new PVPRealSim.Authority({world,startTimeMs:Date.now(),durationMs:180000,roundId});
      for(const person of admittedPlayers(roster))authority.addPlayer(person.playerId,{name:person.name,profile:person.profile});
    }else{
      predictor=new PVPRealSim.ClientPredictor(peerId,world,localProfile);remoteBuffer=new PVPRealSim.RemoteBuffer(100);
      if(clockTimer)clearInterval(clockTimer);
      clockTimer=setInterval(()=>room&&!roundEnded&&room.syncClock(),2500);
    }
    activeWeapon=localProfile.loadout[0];buildWeaponBar();
    const hostNow=isHost?Date.now():room.toHostTime(Date.now());
    const delay=Math.max(0,Math.min(2000,Number(message.startsAtMs)-hostNow));
    setStage('lobby');els.lobbyState.textContent=`Opening ${world.def.name}…`;
    startTimer=setTimeout(startArena,delay);
  }

  function startArena() {
    if (running || roundEnded) return;
    if(authority)authority.serverTimeMs=Date.now();
    if (authority && !authority.startRound()) {
      log('Round requires exactly two admitted players', 'bad');
      updateLobbyControls();
      return;
    }
    starting = false;
    running = true;
    setStage('play');
    resetScene();
    initThree();
    const local = authoritativeLocal();
    if (local) {
      localYaw = local.yaw;
      localPitch = local.pitch;
      aimInitialized = true;
    }
    lastFrame = performance.now();
    simAccum = inputAccum = snapshotAccum = 0;
    log(`${world.def.name} duel started`, 'good');
    updateWeaponButtons();
    frameHandle = requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!running) return;
    const elapsed = Math.min(100, Math.max(0, now - lastFrame));
    lastFrame = now;
    simAccum += elapsed;
    inputAccum += elapsed;
    snapshotAccum += elapsed;
    if (keys.ArrowLeft) localYaw += elapsed * 0.0018;
    if (keys.ArrowRight) localYaw -= elapsed * 0.0018;
    if (keys.ArrowUp) localPitch = Math.min(1.1, localPitch + elapsed * 0.0012);
    if (keys.ArrowDown) localPitch = Math.max(-1.1, localPitch - elapsed * 0.0012);
    while (authority && simAccum >= SIM_MS) {
      authority.step(SIM_MS, Date.now());
      simAccum -= SIM_MS;
    }
    while (inputAccum >= INPUT_MS && running) {
      sendLocalInput();
      inputAccum -= INPUT_MS;
    }
    while (authority && snapshotAccum >= SNAPSHOT_MS && running) {
      const snapshot = authority.createSnapshot();
      latest = snapshot;
      processSnapshotEvents(snapshot);
      room.sendSnapshot(snapshot);
      if (snapshot.roundEnded) finishRound(snapshot);
      snapshotAccum -= SNAPSHOT_MS;
    }
    updateScene(now);
    updateHud();
    updateTelemetry();
    renderer.render(scene, camera);
    if(running)frameHandle = requestAnimationFrame(frame);
  }

  function movementInput() {
    const active = code => !!keys[code] || performance.now() < (keyPulseUntil[code] || 0);
    return {
      moveF: (active('KeyW') ? 1 : 0) - (active('KeyS') ? 1 : 0),
      moveR: (active('KeyD') ? 1 : 0) - (active('KeyA') ? 1 : 0),
      yaw: localYaw,
      pitch: localPitch,
      jump: active('Space'),
      sprint: !!(keys.ShiftLeft || keys.ShiftRight),
      trigger,
      ads: !!keys.MouseRight,
      fireId,
      reloadId,
      weapon: activeWeapon,
    };
  }

  function sendLocalInput() {
    const alive = localAlive();
    const base = alive ? movementInput() : { ...movementInput(), moveF: 0, moveR: 0, jump: false, trigger: false };
    const hostTime = authority ? authority.serverTimeMs : room.toHostTime(Date.now());
    const input = PVPRealSim.sanitizeInput({ ...base, seq: ++inputSeq, clientTimeMs: Date.now(), shotAtMs: hostTime });
    input.roundId=roundId;
    if (authority) authority.receiveInput(peerId, input, authority.serverTimeMs);
    else if (predictor) {
      if (alive) predictor.predict(input, INPUT_MS, input.seq);
      room.sendInput(input);
    }
  }

  function receiveSnapshot(snapshot) {
    if (!snapshot || snapshot.protocol !== 3 || snapshot.contentVersion !== PVPRealSim.CONTENT_VERSION || snapshot.world !== matchArenaId || snapshot.roundId !== roundId || !predictor || !remoteBuffer || isHost) return;
    const result = predictor.applySnapshot(snapshot);
    if(!result.accepted)return;
    latest = snapshot;
    remoteBuffer.push(snapshot);
    const own = snapshot.players.find(item => item.id === peerId);
    if (own && (!aimInitialized || (own.lifeId||0)!==localLifeId)) {
      localLifeId=own.lifeId||0;
      activeWeapon=own.weapon;
      trigger=false;
      localYaw = own.yaw;
      localPitch = own.pitch;
      aimInitialized = true;
    }
    if (result.accepted) processSnapshotEvents(snapshot);
    if (snapshot.roundEnded) {
      const seq = Math.max(0, Number(snapshot.roundEndSeq) || 0);
      if (seq) {
        lastAckSent = seq;
        room.sendRoundAck(seq,roundId);
      }
      finishRound(snapshot);
    }
    updateHud();
  }

  function processSnapshotEvents(snapshot) {
    for (const event of snapshot.events || []) {
      if (!event || event.seq <= lastEventSeq) continue;
      lastEventSeq = event.seq;
      showCombatEvent(event);
    }
  }

  function showCombatEvent(event) {
    if (event.type === 'fire') {
      for (const ray of event.rays || []) addTracer(event.origin, ray.end, ray.hit, event.weapon);
      if (event.playerId === peerId) muzzleFlash();
      log(`${shortName(event.playerId)} fired ${PVPRealSim.WEAPONS[event.weapon]?.name || event.weapon}`, 'shot');
      return;
    }
    if (event.type === 'rocket_spawn') {
      if (event.playerId === peerId) muzzleFlash();
      log(`${shortName(event.playerId)} launched a bazooka`, 'shot');
      return;
    }
    if (event.type === 'explosion') {
      addExplosion(event.point);
      return;
    }
    if (event.type === 'arena_warning') {
      addArenaWarning(event);
      log(`${event.label} incoming`, 'bad');
      return;
    }
    if (event.type === 'arena_impact') {
      addExplosion({ x: event.x, y: PVPRealSim.CONTENT.ARENAS.find(item => item.id === matchArenaId) ? 0.2 : 0, z: event.z });
      return;
    }
    if (event.type === 'pet_attack') {
      log(`${PVPRealSim.PETS[event.pet].name} bit ${shortName(event.targetId)} · ${event.targetHp} HP`, 'good');
      if (event.playerId === peerId) showHitMarker();
      return;
    }
    if (event.type === 'pet_hit' || event.type === 'pet_down') {
      const pet = PVPRealSim.PETS[event.pet];
      log(`${pet.name} ${event.type === 'pet_down' ? 'was downed' : `took ${event.damage} damage · ${event.petHp} HP`}`, event.type === 'pet_down' ? 'bad' : 'shot');
      if (event.playerId === peerId) showHitMarker();
      return;
    }
    if (event.type === 'pet_revive') { log(`${PVPRealSim.PETS[event.pet].name} returned`, 'good'); return; }
    if (event.type === 'overheat') { log(`${shortName(event.playerId)} overheated ${PVPRealSim.WEAPONS[event.weapon].name}`, 'bad'); return; }
    if (event.type === 'hit' || event.type === 'death') {
      const attacker = shortName(event.playerId);
      const target = shortName(event.targetId);
      log(`${attacker} hit ${target} · ${event.part} · ${event.targetHp} HP`, event.type === 'death' ? 'bad' : 'good');
      if (event.playerId === peerId) showHitMarker();
      return;
    }
    // Finalize from the complete snapshot, after the final scores arrive.
  }

  function authoritativeLocal() {
    if (authority) return authority.players.get(peerId) || null;
    return latest && latest.players.find(item => item.id === peerId) || null;
  }

  function localAlive() {
    const local = authoritativeLocal();
    return !local || local.alive !== false;
  }

  function finishRound(source) {
    const winnerId = source && source.winnerId;
    const roundEndSeq = Math.max(0, Number(source && (source.roundEndSeq || source.seq)) || 0);
    if (!isHost && room && roundEndSeq && lastAckSent !== roundEndSeq) {
      lastAckSent = roundEndSeq;
      room.sendRoundAck(roundEndSeq,roundId);
    }
    if (roundEnded) return;
    roundEnded = true;
    running = false;
    trigger = false;
    for (const code of Object.keys(keys)) keys[code] = false;
    for (const code of Object.keys(keyPulseUntil)) keyPulseUntil[code] = 0;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    const won = winnerId === peerId;
    document.exitPointerLock?.();
    if(winnerId)roomWins[winnerId]=(roomWins[winnerId]||0)+1;else roomDraws++;
    els.roundTitle.textContent = winnerId ? won ? 'Victory' : 'Defeat' : 'Draw';
    els.roundTitle.classList.toggle('win', won);
    const scores=source.players||latest?.players||[];
    els.roundSummary.textContent=scores.map(p=>`${shortName(p.id)}: ${p.kills||0} kills`).join(' · ');
    els.roundSync.textContent='Round wins: '+admittedPlayers(roster).map(p=>`${shortName(p.playerId)} ${roomWins[p.playerId]||0}`).join(' — ') + ` · ${roomDraws} ${roomDraws===1?'draw':'draws'} this visit`;

    els.roundOver.classList.remove('hidden');
    log(winnerId ? `${shortName(winnerId)} won the round` : 'Round ended with no survivor', won ? 'good' : 'bad');
    if (isHost && authority) startRoundFinalizer();
    updateHud();
    updateTelemetry();
    publishDiagnostics();
  }

  function expectedGuestIds() {
    return admittedPlayers(roster).filter(item => item.playerId !== peerId).map(item => item.playerId);
  }

  function handleRoundAck(playerId, roundEndSeq, forRound) {
    if (forRound!==roundId || !isHost || !authority || !authority.roundEnded || roundEndSeq !== authority.roundEndSeq) return;
    roundAcks.add(playerId);
    if (expectedGuestIds().every(id => roundAcks.has(id))) completeRoundConfirmation(true);
  }

  function startRoundFinalizer() {
    roundAcks.add(peerId);
    roundFinalizeDeadline = Date.now() + 3000;
    sendFinalSnapshot();
    roundFinalizeTimer = setInterval(sendFinalSnapshot, 250);
  }

  function sendFinalSnapshot() {
    if (!room || !authority || roundConfirmed) return;
    room.sendSnapshot(authority.createSnapshot());
    if (expectedGuestIds().every(id => roundAcks.has(id))) completeRoundConfirmation(true);
    else if (Date.now() >= roundFinalizeDeadline) completeRoundConfirmation(false);
  }

  function completeRoundConfirmation(confirmed) {
    if (roundConfirmed) return;
    if (roundFinalizeTimer) clearInterval(roundFinalizeTimer);
    roundFinalizeTimer = null;
    roundConfirmed = confirmed;

    log(confirmed ? 'Round result confirmed by both players' : 'Round confirmation timed out', confirmed ? 'good' : 'bad');
    updateTelemetry();
    publishDiagnostics();
  }

  function endForHostLoss() {
    running = false;
    roundEnded = true;
    trigger = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    els.connectionLost.classList.remove('hidden');
    setStage('play');
    log('Host disconnected; the authoritative round ended', 'bad');
  }

  function updateHud() {
    const local = authoritativeLocal();
    if (!local) return;
    const states=authority?[...authority.players.values()]:latest?.players||[];
    const remaining=authority?Math.max(0,authority.endsAtMs-authority.serverTimeMs):latest?.remainingMs||0;
    const seconds=Math.ceil(remaining/1000);els.roundClock.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    els.scoreLine.textContent=states.map(p=>`${shortName(p.id)} ${p.kills||0}`).join(' — ');
    const respawn=authority?Math.max(0,(local.respawnAt||0)-authority.serverTimeMs):local.respawnMs||0;
    els.respawnHint.classList.toggle('hidden',local.alive!==false||roundEnded);
    els.respawnHint.textContent=`Back in ${Math.ceil(respawn/1000)}…`;
    if(authority&&(local.lifeId||0)!==localLifeId){localLifeId=local.lifeId||0;localYaw=local.yaw;localPitch=local.pitch;activeWeapon=local.weapon;trigger=false;}
    els.controlHint.classList.toggle('hidden',document.pointerLockElement===els.arena||roundEnded||local.alive===false);
    const equippedWeapon = local.weapon || 'sidearm';
    let ammo = local.ammo;
    let reserve = local.reserve;
    let reloadMs = local.reloadMs || 0;
    if (authority && local.inventory) {
      const item = local.inventory[equippedWeapon];
      ammo = item.ammo;
      reserve = item.reserve;
      reloadMs = Math.max(0, local.reloadUntil - authority.serverTimeMs);
    }
    els.hp.textContent = Math.max(0, Math.round(local.hp));
    els.hpFill.style.width = `${Math.max(0, local.hp) / PVPRealSim.CFG.baseHp * 100}%`;
    els.hpFill.style.background = local.hp > 70 ? 'var(--green)' : 'var(--red)';
    const weapon = PVPRealSim.WEAPONS[activeWeapon];
    els.weaponName.textContent = weapon.name;
    els.ammo.textContent = equippedWeapon === activeWeapon ? ammo < 0 ? '∞' : ammo ?? '—' : '…';
    els.reserve.textContent = equippedWeapon === activeWeapon ? ammo < 0 ? weapon.heat ? `${Math.round(local.heat || 0)}% HEAT` : '∞' : reserve ?? '—' : '…';
    els.reloadState.textContent = reloadMs > 0 ? `RELOADING ${Math.ceil(reloadMs / 100) / 10}s` : local.alive === false ? 'ELIMINATED' : weapon.charge && trigger ? 'CHARGING' : '';
    updateWeaponButtons();
  }

  function updateWeaponButtons() {
    for (const button of els.weaponBar.querySelectorAll('[data-weapon]')) button.classList.toggle('active', button.dataset.weapon === activeWeapon);
  }

  function buildWeaponBar() {
    weaponKeys.Digit1 = localProfile.loadout[0];
    weaponKeys.Digit2 = localProfile.loadout[1];
    weaponKeys.Digit3 = localProfile.loadout[2];
    const buttons = localProfile.loadout.map((id, index) => {
      const weapon = PVPRealSim.WEAPONS[id];
      const button = document.createElement('button'); button.dataset.weapon = id || '';button.disabled=!weapon;
      const key = document.createElement('kbd'); key.textContent = String(index + 1);
      const name = document.createElement('b'); name.textContent = weapon ? weapon.name : 'Empty';
      const role = document.createElement('span'); role.textContent = '';
      button.append(key, name, role); return button;
    });
    els.weaponBar.replaceChildren(...buttons); updateWeaponButtons();
  }

  function sampleMessageRate() {
    if (!room) return;
    const total = room.metrics.sent + room.metrics.received;
    observedRate = total - lastMetricTotal;
    lastMetricTotal = total;
    updateTelemetry();
  }

  function updateTelemetry() {
    if (!room) return;
    els.rtt.textContent = isHost ? 'HOST' : room.rttMs === null ? 'SYNCING' : `${Math.round(room.rttMs)} ms`;
    els.messages.textContent = `${room.metrics.sent} ↑ ${room.metrics.received} ↓`;
    els.messageRate.textContent = `${observedRate} / s`;
    els.messageRate.style.color = observedRate > 85 ? 'var(--red)' : '';
    publishDiagnostics();
  }

  function publishDiagnostics() {
    const local = authoritativeLocal();
    Object.assign(document.body.dataset, {
      role: isHost ? 'host' : room ? 'guest' : 'none',
      room: room ? room.roomCode : '',
      connected: String(connected),
      running: String(running),
      roundEnded: String(roundEnded),
      roundConfirmed: String(roundConfirmed),
      winner: latest && latest.winnerId || authority && authority.winnerId || '',
      messagesSent: String(room ? room.metrics.sent : 0),
      messagesReceived: String(room ? room.metrics.received : 0),
      observedRate: String(observedRate),
      world: world ? world.id : '',
      contentVersion: PVPRealSim.CONTENT_VERSION,
      localHp: String(local ? Math.round(local.hp) : ''),
      localX: String(local ? Number(local.x).toFixed(3) : ''),
      localY: String(local ? Number(local.y).toFixed(3) : ''),
      localZ: String(local ? Number(local.z).toFixed(3) : ''),
    });
  }

  function resetScene(){
    if(scene){
      const geometries=new Set(),materials=new Set();
      scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);});
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    }
    renderer?.renderLists.dispose();
    fighterModels.clear();projectileModels.clear();petModels.clear();effects.length=0;viewModel=null;viewWeapon='';
  }

  function initThree() {
    if(!renderer){
      renderer = new THREE.WebGLRenderer({canvas:els.arena,antialias:true,powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
      addEventListener('resize',resizeRenderer);
    }
    renderer.outputEncoding = THREE.sRGBEncoding;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(world.colors.sky);
    scene.fog = new THREE.FogExp2(world.colors.fog, world.def.fogD || 0.012);
    camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.05, 180);
    camera.rotation.order = 'YXZ';
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(world.colors.light, 0x181421, 1.4));
    const key = new THREE.DirectionalLight(0xffd2a0, 1.1); key.position.set(-18, 30, 12); scene.add(key);
    const ember = new THREE.PointLight(world.colors.accent, 1.8, 42); ember.position.set(0, 7, 0); scene.add(ember);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (const item of world.visuals) {
      const material = new THREE.MeshLambertMaterial({ color: item.color, emissive: item.emissive ? item.color : 0x000000, emissiveIntensity: item.emissive || 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(item.x, item.y, item.z);
      mesh.scale.set(item.w, item.h, item.d);
      scene.add(mesh);
    }
    addArenaAtmosphere();
    resizeRenderer();

  }

  function addArenaAtmosphere() {
    const points = [];
    const count = Math.min(480, world.def.fx && world.def.fx.n || 180);
    for (let index = 0; index < count; index += 1) points.push((Math.random() - 0.5) * world.size, Math.random() * 16, (Math.random() - 0.5) * world.size);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({ color: world.def.fx && world.def.fx.c || world.colors.accent, size: world.def.fx && world.def.fx.type === 'snow' ? .12 : .07, transparent: true, opacity: 0.55 });
    scene.add(new THREE.Points(geometry, material));
  }

  function resizeRenderer() {
    if (!renderer) return;
    const width = Math.max(2, els.viewport.clientWidth);
    const height = Math.max(2, els.viewport.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function boxPart(parent, color, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  function createFighter(id) {
    const group = new THREE.Group();
    group.userData.id = id;
    const state = authority && authority.players.get(id) || latest && latest.players.find(player => player.id === id);
    const profile = PVPRealSim.safeProfile(state && state.profile);
    const outfit = PVPRealSim.CONTENT.OUTFITS.find(item => item.id === profile.outfit) || PVPRealSim.CONTENT.OUTFITS[0];
    const hair = PVPRealSim.CONTENT.HAIRS.find(item => item.id === profile.hair) || PVPRealSim.CONTENT.HAIRS[0];
    const acc = PVPRealSim.CONTENT.ACCS.find(item => item.id === profile.acc) || PVPRealSim.CONTENT.ACCS[0];
    boxPart(group, outfit.shirt, 0, 1.12, 0, .76, .86, .42);
    boxPart(group, outfit.pant, -.2, .44, 0, .32, .78, .34);boxPart(group, outfit.pant, .2, .44, 0, .32, .78, .34);
    boxPart(group, outfit.shoe, -.2, .08, -.08, .34, .16, .52);boxPart(group, outfit.shoe, .2, .08, -.08, .34, .16, .52);
    boxPart(group, outfit.skin, 0, 1.68, 0, .62, .52, .55);
    boxPart(group, outfit.arm, -.52, 1.13, -.05, .26, .82, .28);boxPart(group, outfit.arm, .52, 1.13, -.05, .26, .82, .28);
    for (const part of hair.parts || []) boxPart(group, part.c, part.x, 1.68 + part.y, part.z, part.w, part.h, part.d);
    for (const part of acc.parts || []) boxPart(group, part.c, part.x, 1.68 + part.y, part.z, part.w, part.h, part.d);
    for (const part of acc.back || []) boxPart(group, part.c, part.x, 1.12 + part.y, part.z, part.w, part.h, part.d);
    if (acc.cape) boxPart(group, acc.cape.c, 0, 1.05, .28, .7, 1.1, .08);
    if (acc.halo) { const halo = new THREE.Mesh(new THREE.TorusGeometry(.44,.035,6,18),new THREE.MeshBasicMaterial({color:acc.halo.c}));halo.position.set(0,2.2,0);halo.rotation.x=Math.PI/2;group.add(halo); }
    if (acc.wings) { boxPart(group, acc.wings.c, -.52, 1.2, .3, .55, .16, .7);boxPart(group, acc.wings.c, .52, 1.2, .3, .55, .16, .7); }
    group.userData.weaponHolder = new THREE.Group();group.userData.weaponHolder.position.set(.32,1.34,-.36);group.userData.weaponHolder.scale.setScalar(.8);group.add(group.userData.weaponHolder);
    scene.add(group);
    fighterModels.set(id, group);
    return group;
  }

  function addWeaponParts(parent, weaponId) {
    const weapon = PVPRealSim.WEAPONS[weaponId] || PVPRealSim.WEAPONS.sidearm;
    for (const part of weapon.parts || []) boxPart(parent, part.c, part.x, part.y, part.z, part.w, part.h, part.d);
    parent.userData.weapon = weapon.id;
  }

  function updateFighterWeapon(model, weaponId) {
    const holder = model.userData.weaponHolder;if (!holder || holder.userData.weapon === weaponId) return;
    while (holder.children.length) holder.remove(holder.children[0]);addWeaponParts(holder, weaponId);
  }

  function buildViewModel(weaponId) {
    if (viewModel) camera.remove(viewModel);
    viewWeapon = weaponId;
    viewModel = new THREE.Group();
    const skin = 0xc98a5e;
    boxPart(viewModel, skin, -0.28, -0.08, 0.1, 0.22, 0.2, 0.55);
    boxPart(viewModel, skin, 0.28, -0.08, 0.1, 0.22, 0.2, 0.55);
    addWeaponParts(viewModel, weaponId);
    viewModel.scale.setScalar(1.45);
    viewModel.position.set(0.43, -0.4, -0.75);
    viewModel.rotation.set(-0.06, -0.08, 0);
    camera.add(viewModel);
  }

  function createPetModel(state) {
    const def = PVPRealSim.PETS[state.defId];const group = new THREE.Group();
    for (const part of def.parts || []) boxPart(group, part.c, part.x, part.y, part.z, part.w, part.h, part.d);
    group.scale.setScalar(def.scale || 1);return group;
  }

  function visualPlayers(now) {
    if (authority) return [...authority.players.values()];
    if (!latest) return predictor ? [predictor.state] : [];
    const output = [];
    output.push(predictor.state);
    for (const person of latest.players) {
      if (person.id === peerId) continue;
      output.push(remoteBuffer.at(person.id, room.toHostTime(Date.now())) || person);
    }
    return output;
  }

  function updateScene(now) {
    if (!scene || !camera) return;
    const players = visualPlayers(now);
    const ids = new Set(players.map(person => person.id));
    for (const person of players) {
      if (person.id === peerId) continue;
      const model = fighterModels.get(person.id) || createFighter(person.id);
      model.visible = person.alive !== false;
      model.position.set(person.x, person.y, person.z);
      model.rotation.y = person.yaw;
      updateFighterWeapon(model, person.weapon);
    }
    for (const [id, model] of fighterModels) if (!ids.has(id)) { scene.remove(model); fighterModels.delete(id); }
    const pets = authority ? [...authority.pets.values()] : latest && latest.pets || [];
    const petIds = new Set();
    for (const pet of pets) {
      petIds.add(pet.id);let model = petModels.get(pet.id);
      if (!model) { model = createPetModel(pet);scene.add(model);petModels.set(pet.id, model); }
      model.visible = pet.alive !== false;model.position.set(pet.x, pet.y, pet.z);model.rotation.y = pet.yaw;
    }
    for (const [id, model] of petModels) if (!petIds.has(id)) { scene.remove(model);petModels.delete(id); }
    const local = authority ? authority.players.get(peerId) : predictor && predictor.state;
    if (local) {
      camera.position.set(local.x, local.y + PVPRealSim.CFG.eye, local.z);
      camera.rotation.set(localPitch, localYaw, 0, 'YXZ');
      const speed = Math.hypot(local.vx || 0, local.vz || 0);
      if (viewWeapon !== activeWeapon) buildViewModel(activeWeapon);
      if (viewModel) {
        const bob = local.onGround === false ? 0 : Math.sin(now * 0.012) * Math.min(0.018, speed * 0.0025);
        viewModel.position.y = -0.4 + bob;
      }
    }
    const projectiles = authority ? authority.projectiles : latest && latest.projectiles || [];
    const projectileIds = new Set();
    for (const item of projectiles) {
      projectileIds.add(item.id);
      let model = projectileModels.get(item.id);
      if (!model) {
        model = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff6b2c }));
        scene.add(model); projectileModels.set(item.id, model);
      }
      model.position.set(item.x, item.y, item.z);
    }
    for (const [id, model] of projectileModels) if (!projectileIds.has(id)) { scene.remove(model); projectileModels.delete(id); }
    animateEffects(now);
  }

  function addTracer(origin, end, hit, weaponId) {
    if (!scene || !origin || !end) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(end.x, end.y, end.z),
    ]);
    const weapon = PVPRealSim.WEAPONS[weaponId] || PVPRealSim.WEAPONS.sidearm;
    const material = new THREE.LineBasicMaterial({ color: hit ? weapon.tracer || 0x7fd45b : weapon.tracer || 0xf2b134, transparent: true, opacity: 1 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    effects.push({ kind: 'tracer', object: line, born: performance.now(), life: 220 });
  }

  function addExplosion(point) {
    if (!scene || !point) return;
    const material = new THREE.MeshBasicMaterial({ color: 0xff6b2c, transparent: true, opacity: 0.8 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
    sphere.position.set(point.x, point.y, point.z);
    sphere.scale.setScalar(0.15);
    const light = new THREE.PointLight(0xff8b32, 4, 15);
    light.position.copy(sphere.position);
    scene.add(sphere, light);
    effects.push({ kind: 'explosion', object: sphere, light, born: performance.now(), life: 480 });
  }

  function addArenaWarning(event) {
    if (!scene) return;
    const material = new THREE.MeshBasicMaterial({ color: world.colors.accent, transparent: true, opacity: .72, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(.2, event.r - .18), event.r, 40), material);
    ring.rotation.x = -Math.PI / 2;ring.position.set(event.x, .09, event.z);scene.add(ring);
    effects.push({ kind: 'warning', object: ring, born: performance.now(), life: Math.max(180, event.impactAt - (authority ? authority.serverTimeMs : room.toHostTime(Date.now()))) });
  }

  function muzzleFlash() {
    if (!camera) return;
    const light = new THREE.PointLight(PVPRealSim.WEAPONS[activeWeapon].color, 3, 4);
    light.position.set(0.25, -0.2, -1.2);
    camera.add(light);
    effects.push({ kind: 'muzzle', object: light, born: performance.now(), life: 65 });
  }

  function animateEffects(now) {
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index];
      const progress = (now - effect.born) / effect.life;
      if (progress >= 1) {
        if (effect.object.parent) effect.object.parent.remove(effect.object);
        if (effect.light && effect.light.parent) effect.light.parent.remove(effect.light);
        effect.object.geometry?.dispose();
        effect.object.material?.dispose();
        effect.light?.dispose?.();
        effects.splice(index, 1);
        continue;
      }
      if (effect.kind === 'tracer') effect.object.material.opacity = 1 - progress;
      if (effect.kind === 'warning') { effect.object.material.opacity = .35 + Math.sin(progress * Math.PI * 12) * .3;effect.object.scale.setScalar(.92 + progress * .08); }
      if (effect.kind === 'explosion') {
        effect.object.scale.setScalar(0.2 + progress * 4.5);
        effect.object.material.opacity = 0.8 * (1 - progress);
        effect.light.intensity = 4 * (1 - progress);
      }
      if (effect.kind === 'muzzle') effect.object.intensity = 3 * (1 - progress);
    }
  }

  function showHitMarker() {
    els.hitMarker.classList.remove('hidden');
    els.hitMarker.getAnimations().forEach(animation => animation.cancel());
    void els.hitMarker.offsetWidth;
    setTimeout(() => els.hitMarker.classList.add('hidden'), 180);
  }

  function chooseWeapon(id) {
    if (!PVPRealSim.WEAPONS[id] || !localProfile || !localProfile.loadout.includes(id) || roundEnded) return;
    activeWeapon = id;
    updateWeaponButtons();
  }

  async function leave() {
    running = false;
    connected = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    if (clockTimer) clearInterval(clockTimer);
    if (rateTimer) clearInterval(rateTimer);
    if (roundFinalizeTimer) clearInterval(roundFinalizeTimer);
    if(readyTimer)clearInterval(readyTimer);
    if(startRetryTimer)clearInterval(startRetryTimer);
    if(startTimer)clearTimeout(startTimer);
    if(hostLossTimer)clearTimeout(hostLossTimer);
    if (room) await room.close();
    location.href = location.href.split('#')[0];
  }

  addEventListener('keydown', event => {
    keys[event.code] = true;
    if (!event.repeat && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) keyPulseUntil[event.code] = performance.now() + 110;
    if (weaponKeys[event.code]) chooseWeapon(weaponKeys[event.code]);
    if (event.code === 'KeyR' && !event.repeat) reloadId += 1;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  });
  addEventListener('keyup', event => { keys[event.code] = false; });
  addEventListener('mousemove', event => {
    if (document.pointerLockElement !== els.arena || !running || roundEnded) return;
    localYaw -= event.movementX * 0.0024;
    localPitch = Math.max(-1.1, Math.min(1.1, localPitch - event.movementY * 0.0022));
    aimInitialized = true;
  });
  els.arena.addEventListener('mousedown', event => {
    if (event.button === 2) { keys.MouseRight = true;event.preventDefault();return; }
    if (event.button !== 0 || !running || roundEnded || !localAlive()) return;
    trigger = true;
    fireId += 1;
    els.arena.focus();
    if (els.arena.requestPointerLock && document.pointerLockElement !== els.arena) {
      try {
        const request = els.arena.requestPointerLock();
        if (request && typeof request.catch === 'function') request.catch(() => {});
      } catch (_) {}
    }
  });
  addEventListener('mouseup', event => { if (event.button === 0) trigger = false;if (event.button === 2) keys.MouseRight = false; });
  els.arena.addEventListener('contextmenu', event => event.preventDefault());
  els.weaponBar.addEventListener('click', event => {
    const button = event.target.closest('[data-weapon]');
    if (button) chooseWeapon(button.dataset.weapon);
  });
  els.create.addEventListener('click', () => begin(true));
  els.join.addEventListener('click', () => begin(false));
  els.startMatch.addEventListener('click', requestStart);
  els.rematch.addEventListener('click',readyAgain);
  document.addEventListener('pointerlockerror',()=>{trigger=false;els.controlHint.textContent='Mouse capture blocked. Open this game in Chrome or Edge to play.';});
  document.addEventListener('pointerlockchange',()=>{trigger=false;for(const code of Object.keys(keys))keys[code]=false;});
  addEventListener('blur',()=>{trigger=false;for(const code of Object.keys(keys))keys[code]=false;});
  els.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(els.invite.value); els.copy.textContent = 'Copied'; }
    catch (_) { els.invite.select(); }
    setTimeout(() => { els.copy.textContent = 'Copy invite'; }, 1200);
  });
  els.leaveLobby.addEventListener('click', leave);
  els.leaveMatch.addEventListener('click', leave);
  addEventListener('beforeunload', () => room && room.close());

  window.__pvpRealTest = {
    version: 3,
    state: () => ({
      stage: document.body.dataset.stage || 'setup', isHost, peerId, roomCode: room && room.roomCode,
      connected, running, roundEnded, roundConfirmed, winnerId: latest && latest.winnerId,
      roster: roster.map(item => ({ ...item })), local: authoritativeLocal() && { ...authoritativeLocal() },
      messages: room ? { ...room.metrics, observedRate } : null, lastEventSeq, lastAckSent,
      world: world && world.id, contentVersion: PVPRealSim.CONTENT_VERSION,
      pets: authority ? [...authority.pets.values()].map(item => ({ ...item })) : latest && latest.pets || [],
    }),
    fire: () => { if (running && !roundEnded) fireId += 1; },
    weapon: chooseWeapon,
    aim: (yaw, pitch = 0) => { localYaw = Number(yaw) || 0; localPitch = Math.max(-1.1, Math.min(1.1, Number(pitch) || 0)); aimInitialized = true; },
  };

  populateSetup();
  document.body.dataset.stage = 'setup';
  if(location.hash.length>1){els.roomCode.value=parseRoom(location.hash.slice(1));els.setup.classList.add('invited');els.join.textContent='Join your friend';}
})();
