(() => {
  'use strict';

  const SUPABASE_URL = 'https://ctzjitzkolqghvonjtnx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_L7lbsM1-zMaOxfIASXIMCQ_0EeF20mq';
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
  ].map(id => [id, document.getElementById(id)]));

  const keys = Object.create(null);
  const weaponKeys = { Digit1: 'sidearm', Digit2: 'ak47', Digit3: 'scatter', Digit4: 'bazooka' };
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
    if (!window.supabase || !window.THREE || !window.PVPRealtime || !window.PVPRealSim) {
      els.connectStatus.textContent = 'A required multiplayer or 3D library did not load. Refresh and try again.';
      return;
    }
    isHost = host;
    peerId = PVPRealtime.randomPeerId();
    const code = host ? PVPRealtime.randomRoomCode(12) : els.roomCode.value;
    const name = cleanName(host ? els.hostName.value : els.guestName.value);
    if (!host && String(code).replace(/[^A-Z2-9]/gi, '').length < 8) {
      els.connectStatus.textContent = 'Enter the host’s room code.';
      return;
    }
    els.create.disabled = true;
    els.join.disabled = true;
    els.connectStatus.textContent = 'Connecting to the real-game PvP room…';
    world = PVPRealSim.makeFoundryWorld();
    if (host) {
      authority = new PVPRealSim.Authority({ world, startTimeMs: Date.now() });
      authority.addPlayer(peerId, { name });
    } else {
      predictor = new PVPRealSim.ClientPredictor(peerId, world);
      remoteBuffer = new PVPRealSim.RemoteBuffer(100);
    }
    room = new PVPRealtime.RealtimeRoom({
      client: makeClient(), roomCode: code, peerId, name, isHost: host,
      onInput: (id, input, receivedAt) => authority && authority.receiveInput(id, input, receivedAt),
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
      const base = location.href.split('#')[0];
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
      predictor = null;
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
          if (authority.addPlayer(person.playerId, { name: person.name })) log(`${person.name} entered the Foundry`, 'good');
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
        detail.textContent = person.role === 'host' ? 'HOST AUTHORITY' : 'GUEST CLIENT';
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
    return isHost && admitted.length === 2 && roster.length === 2 && room && room.canStart();
  }

  function updateLobbyControls() {
    if (!room) return;
    const hostPresent = roster.some(item => item.role === 'host');
    if (isHost) {
      const ready = canStart();
      els.startMatch.disabled = !ready;
      els.startMatch.textContent = ready ? 'Start Foundry duel' : roster.length < 2 ? 'Waiting for fighter' : 'Finishing handshake';
      els.lobbyState.textContent = ready ? 'Both fighters are synchronized.' : 'Share the invite with one friend.';
    } else {
      els.startMatch.disabled = true;
      els.startMatch.textContent = 'Waiting for host';
      els.lobbyState.textContent = hostPresent ? 'Connected. The host starts the round.' : 'Finding host authority…';
    }
  }

  async function requestStart() {
    if (!canStart() || running) return;
    const message = { seq: Date.now(), type: 'real_start', startsAtMs: Date.now() + 900, protocol: 2, world: 'foundry' };
    els.startMatch.disabled = true;
    els.startMatch.textContent = 'Starting…';
    if (await room.sendLobby(message)) receiveLobby({ ...message, hostId: peerId });
    else updateLobbyControls();
  }

  function receiveLobby(message) {
    if (!message || message.type !== 'real_start' || running || roundEnded || message.protocol !== 2) return;
    const hostNow = isHost ? Date.now() : room.toHostTime(Date.now());
    const delay = Math.max(0, Number(message.startsAtMs) - hostNow);
    els.lobbyState.textContent = `Opening Foundry in ${Math.max(1, Math.ceil(delay / 1000))}…`;
    setTimeout(startArena, delay);
  }

  function startArena() {
    if (running || roundEnded) return;
    if (authority && !authority.startRound()) {
      log('Round requires exactly two admitted players', 'bad');
      updateLobbyControls();
      return;
    }
    running = true;
    setStage('play');
    initThree();
    const local = authoritativeLocal();
    if (local) {
      localYaw = local.yaw;
      localPitch = local.pitch;
      aimInitialized = true;
    }
    lastFrame = performance.now();
    simAccum = inputAccum = snapshotAccum = 0;
    log('Foundry duel started', 'good');
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
      authority.step(SIM_MS, authority.serverTimeMs + SIM_MS);
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
    frameHandle = requestAnimationFrame(frame);
  }

  function movementInput() {
    return {
      moveF: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
      moveR: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      yaw: localYaw,
      pitch: localPitch,
      jump: !!keys.Space,
      sprint: !!(keys.ShiftLeft || keys.ShiftRight),
      trigger,
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
    if (authority) authority.receiveInput(peerId, input, authority.serverTimeMs);
    else if (predictor) {
      if (alive) predictor.predict(input, INPUT_MS, input.seq);
      room.sendInput(input);
    }
  }

  function receiveSnapshot(snapshot) {
    if (!snapshot || snapshot.protocol !== 2 || isHost) return;
    latest = snapshot;
    remoteBuffer.push(snapshot);
    const result = predictor.applySnapshot(snapshot);
    const own = snapshot.players.find(item => item.id === peerId);
    if (own && !aimInitialized) {
      localYaw = own.yaw;
      localPitch = own.pitch;
      aimInitialized = true;
    }
    if (result.accepted) processSnapshotEvents(snapshot);
    if (snapshot.roundEnded) {
      const seq = Math.max(0, Number(snapshot.roundEndSeq) || 0);
      if (seq) {
        lastAckSent = seq;
        room.sendRoundAck(seq);
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
      for (const ray of event.rays || []) addTracer(event.origin, ray.end, ray.hit);
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
    if (event.type === 'hit' || event.type === 'death') {
      const attacker = shortName(event.playerId);
      const target = shortName(event.targetId);
      log(`${attacker} hit ${target} · ${event.part} · ${event.targetHp} HP`, event.type === 'death' ? 'bad' : 'good');
      if (event.playerId === peerId) showHitMarker();
      return;
    }
    if (event.type === 'round_end') finishRound(event);
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
      room.sendRoundAck(roundEndSeq);
    }
    if (roundEnded) return;
    roundEnded = true;
    running = false;
    trigger = false;
    for (const code of Object.keys(keys)) keys[code] = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    const won = winnerId === peerId;
    els.roundTitle.textContent = won ? 'Victory' : 'Game over';
    els.roundTitle.classList.toggle('win', won);
    els.roundSummary.textContent = winnerId ? `${shortName(winnerId)} is the last fighter alive.` : 'No fighter survived.';
    els.roundSync.textContent = isHost ? 'Waiting for the guest to confirm this result…' : 'Result received from host authority.';
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

  function handleRoundAck(playerId, roundEndSeq) {
    if (!isHost || !authority || !authority.roundEnded || roundEndSeq !== authority.roundEndSeq) return;
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
    els.roundSync.textContent = confirmed ? 'Both players confirmed the same result. Network traffic stopped.' : 'Confirmation timed out. This result remains host-authoritative.';
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
    els.weaponName.textContent = PVPRealSim.WEAPONS[activeWeapon].name;
    els.ammo.textContent = equippedWeapon === activeWeapon ? ammo ?? '—' : '…';
    els.reserve.textContent = equippedWeapon === activeWeapon ? reserve ?? '—' : '…';
    els.reloadState.textContent = reloadMs > 0 ? `RELOADING ${Math.ceil(reloadMs / 100) / 10}s` : local.alive === false ? 'ELIMINATED' : '';
    updateWeaponButtons();
  }

  function updateWeaponButtons() {
    for (const button of els.weaponBar.querySelectorAll('[data-weapon]')) button.classList.toggle('active', button.dataset.weapon === activeWeapon);
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
      localHp: String(local ? Math.round(local.hp) : ''),
      localX: String(local ? Number(local.x).toFixed(3) : ''),
      localY: String(local ? Number(local.y).toFixed(3) : ''),
      localZ: String(local ? Number(local.z).toFixed(3) : ''),
    });
  }

  function initThree() {
    if (renderer) {
      resizeRenderer();
      return;
    }
    renderer = new THREE.WebGLRenderer({ canvas: els.arena, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(world.colors.sky);
    scene.fog = new THREE.FogExp2(world.colors.fog, 0.012);
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
    addEventListener('resize', resizeRenderer);
  }

  function addArenaAtmosphere() {
    const points = [];
    for (let index = 0; index < 180; index += 1) points.push((Math.random() - 0.5) * 72, Math.random() * 12, (Math.random() - 0.5) * 72);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({ color: world.colors.accent, size: 0.07, transparent: true, opacity: 0.55 });
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
    boxPart(group, 0x4a5a3c, 0, 1.12, 0, 0.76, 0.86, 0.42);
    boxPart(group, 0x2f3a2a, -0.2, 0.44, 0, 0.32, 0.78, 0.34);
    boxPart(group, 0x2f3a2a, 0.2, 0.44, 0, 0.32, 0.78, 0.34);
    boxPart(group, 0x1e1a16, -0.2, 0.08, -0.08, 0.34, 0.16, 0.52);
    boxPart(group, 0x1e1a16, 0.2, 0.08, -0.08, 0.34, 0.16, 0.52);
    boxPart(group, 0xc98a5e, 0, 1.68, 0, 0.62, 0.52, 0.55);
    boxPart(group, 0x3b2a1c, 0, 1.96, 0, 0.68, 0.18, 0.61);
    boxPart(group, 0x4a5a3c, -0.52, 1.13, -0.05, 0.26, 0.82, 0.28);
    boxPart(group, 0x4a5a3c, 0.52, 1.13, -0.05, 0.26, 0.82, 0.28);
    const gun = boxPart(group, 0x292d31, 0.32, 1.34, -0.46, 0.18, 0.18, 0.82);
    gun.userData.gun = true;
    scene.add(group);
    fighterModels.set(id, group);
    return group;
  }

  function buildViewModel(weaponId) {
    if (viewModel) camera.remove(viewModel);
    viewWeapon = weaponId;
    viewModel = new THREE.Group();
    const skin = 0xc98a5e;
    boxPart(viewModel, skin, -0.28, -0.08, 0.1, 0.22, 0.2, 0.55);
    boxPart(viewModel, skin, 0.28, -0.08, 0.1, 0.22, 0.2, 0.55);
    if (weaponId === 'sidearm') {
      boxPart(viewModel, 0x30343a, 0, 0.05, -0.2, 0.22, 0.25, 0.72);
      boxPart(viewModel, 0x1e2228, 0, -0.16, 0.02, 0.18, 0.4, 0.22);
    } else if (weaponId === 'ak47') {
      boxPart(viewModel, 0x7a4b24, 0, 0.02, -0.12, 0.26, 0.28, 1.18);
      boxPart(viewModel, 0x292d31, 0, 0.05, -0.72, 0.16, 0.16, 0.7);
      boxPart(viewModel, 0x292d31, 0, -0.18, -0.05, 0.19, 0.42, 0.25);
    } else if (weaponId === 'scatter') {
      boxPart(viewModel, 0x5b351e, 0, 0.03, -0.15, 0.32, 0.3, 1.05);
      boxPart(viewModel, 0x20242a, 0, 0.04, -0.82, 0.16, 0.16, 0.8);
    } else {
      boxPart(viewModel, 0x38413d, 0, 0.03, -0.2, 0.42, 0.42, 1.25);
      boxPart(viewModel, 0xe0553a, 0, 0.03, -0.72, 0.48, 0.48, 0.18);
    }
    viewModel.position.set(0.43, -0.4, -0.75);
    viewModel.rotation.set(-0.06, -0.08, 0);
    camera.add(viewModel);
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
    }
    for (const [id, model] of fighterModels) if (!ids.has(id)) { scene.remove(model); fighterModels.delete(id); }
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

  function addTracer(origin, end, hit) {
    if (!scene || !origin || !end) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(end.x, end.y, end.z),
    ]);
    const material = new THREE.LineBasicMaterial({ color: hit ? 0x7fd45b : 0xf2b134, transparent: true, opacity: 1 });
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
        effects.splice(index, 1);
        continue;
      }
      if (effect.kind === 'tracer') effect.object.material.opacity = 1 - progress;
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
    if (!PVPRealSim.WEAPONS[id] || roundEnded) return;
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
    if (room) await room.close();
    location.href = location.href.split('#')[0];
  }

  addEventListener('keydown', event => {
    keys[event.code] = true;
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
    if (event.button !== 0 || !running || roundEnded) return;
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
  addEventListener('mouseup', event => { if (event.button === 0) trigger = false; });
  els.weaponBar.addEventListener('click', event => {
    const button = event.target.closest('[data-weapon]');
    if (button) chooseWeapon(button.dataset.weapon);
  });
  els.create.addEventListener('click', () => begin(true));
  els.join.addEventListener('click', () => begin(false));
  els.startMatch.addEventListener('click', requestStart);
  els.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(els.invite.value); els.copy.textContent = 'Copied'; }
    catch (_) { els.invite.select(); }
    setTimeout(() => { els.copy.textContent = 'Copy invite'; }, 1200);
  });
  els.leaveLobby.addEventListener('click', leave);
  els.leaveMatch.addEventListener('click', leave);
  addEventListener('beforeunload', () => room && room.close());

  window.__pvpRealTest = {
    version: 1,
    state: () => ({
      stage: document.body.dataset.stage || 'setup', isHost, peerId, roomCode: room && room.roomCode,
      connected, running, roundEnded, roundConfirmed, winnerId: latest && latest.winnerId,
      roster: roster.map(item => ({ ...item })), local: authoritativeLocal() && { ...authoritativeLocal() },
      messages: room ? { ...room.metrics, observedRate } : null, lastEventSeq, lastAckSent,
    }),
    fire: () => { if (running && !roundEnded) fireId += 1; },
    weapon: chooseWeapon,
    aim: (yaw, pitch = 0) => { localYaw = Number(yaw) || 0; localPitch = Math.max(-1.1, Math.min(1.1, Number(pitch) || 0)); aimInitialized = true; },
  };

  document.body.dataset.stage = 'setup';
  if (location.hash.length > 1) els.roomCode.value = location.hash.slice(1).toUpperCase();
})();
