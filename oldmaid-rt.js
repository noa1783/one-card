'use strict';
/* ═══════════════════════════════════════════════════════════════
   도둑잡기 온라인 · oldmaid-rt.js  (Firebase RTDB · 호스트 권한)
   - 마스터가 엔진을 들고 모든 뽑기를 검증·적용
   - 각 플레이어는 자기 손패만 수신, 자기 차례에 인덱스로 뽑기 전송
   - firebase-config.js 비어있으면 비활성 → 싱글(봇)만
   - rooms/{CODE} 사용(원카드와 동일 보안규칙), game:'oldmaid' 로 구분
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const RT = {}; window.RT = RT;
  let db = null, ready = false, roomCode = null, myPid = null, isHost = false;
  let game = null, myHand = [], unsub = [];
  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function cfgValid() { const c = window.FIREBASE_CONFIG; return !!(c && c.databaseURL && !/YOUR_/.test(c.databaseURL)); }

  RT.initUI = function () {
    const status = document.getElementById('rt-status');
    const hostBtn = document.getElementById('btn-host');
    if (!status) return;
    if (typeof firebase === 'undefined') { status.textContent = '오프라인 · Firebase 미로드 — 싱글만 가능'; return; }
    if (!cfgValid()) { status.textContent = '오프라인 · firebase-config.js 필요 — 싱글만 가능'; return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.database(); ready = true;
      status.textContent = '온라인 준비됨 · 방 만들기/참가 가능'; status.classList.add('on');
      if (hostBtn) hostBtn.disabled = false;
    } catch (e) { status.textContent = '온라인 초기화 실패: ' + (e.message || e); console.error('[도둑잡기]', e); }
    const r = new URLSearchParams(location.search).get('room');
    if (r) { const i = document.getElementById('rt-room'); if (i) i.value = r.toUpperCase(); }
  };

  const code4 = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  const newPid = () => 'u' + Math.random().toString(36).slice(2, 8);
  const ref = (sub) => db.ref('rooms/' + roomCode + (sub ? '/' + sub : ''));

  RT.host = function () {
    if (!ready) { Fx.toast('온라인 비활성 — firebase-config.js 확인', 1200); return; }
    isHost = true; App2.isHost = true; App2.mode = 'online';
    roomCode = code4(); myPid = newPid(); App2.myId = myPid;
    const myName = (document.getElementById('rt-myname').value || '').trim() || '마스터';
    const room = { game: 'oldmaid', phase: 'lobby', host: myPid, players: {}, move: null, state: null };
    room.players[myPid] = { id: myPid, name: myName, joinedAt: Date.now() };
    Fx.toast('방 생성 중…', 800);
    ref().set(room).then(() => {
      App2.showGame(); document.getElementById('room-info').innerHTML = `방 <b>${roomCode}</b>`;
      openLobby(); listenRoom(); listenMovesAsHost();
    }).catch(err => {
      console.error('[도둑잡기] 방 생성 실패', err);
      Fx.toast(/permission/i.test(err.message || '') ? '쓰기 권한 거부 — DB 규칙 확인' : '방 생성 실패: ' + err.message, 1600);
      isHost = false; App2.mode = 'single';
    });
  };

  RT.join = function (code, name) {
    if (!ready) { Fx.toast('온라인 비활성 — firebase-config.js 확인', 1200); return; }
    roomCode = code.toUpperCase(); myPid = newPid(); App2.myId = myPid; isHost = false; App2.isHost = false; App2.mode = 'online';
    ref().get().then(snap => {
      if (!snap.exists()) { Fx.toast('그런 방이 없어요 (코드 확인)', 1200); return; }
      const room = snap.val();
      if (room.game !== 'oldmaid') { Fx.toast('이 방은 도둑잡기 방이 아니에요', 1300); return; }
      if (room.phase !== 'lobby') { Fx.toast('이미 시작된 방이에요', 1200); return; }
      return ref('players/' + myPid).set({ id: myPid, name, joinedAt: Date.now() }).then(() => {
        App2.showGame(); document.getElementById('room-info').innerHTML = `방 <b>${roomCode}</b>`;
        openLobby(); listenRoom();
      });
    }).catch(err => {
      console.error('[도둑잡기] 참가 실패', err);
      Fx.toast(/permission/i.test(err.message || '') ? '읽기 권한 거부 — DB 규칙 확인' : '참가 실패: ' + err.message, 1600);
    });
  };

  /* 로비 */
  function ensureLobby() {
    let el = document.getElementById('lobby'); if (el) return el;
    el = document.createElement('div'); el.id = 'lobby'; el.className = 'cover show';
    el.innerHTML = `<div class="who display">대기실</div>
      <p>방 코드 <b style="color:var(--gold);letter-spacing:.15em" id="lobby-code"></b> — 친구에게 공유</p>
      <button class="btn ghost" id="lobby-copy" style="font-size:13px;padding:7px 14px">초대 링크 복사</button>
      <div id="lobby-list" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:18px 0;max-width:520px"></div>
      <div id="lobby-actions"></div>
      <p id="lobby-wait" style="color:var(--muted)"></p>`;
    document.body.appendChild(el);
    el.querySelector('#lobby-copy').onclick = () => { navigator.clipboard?.writeText(location.origin + location.pathname + '?room=' + roomCode); Fx.toast('초대 링크 복사됨', 900); };
    return el;
  }
  function openLobby() { const el = ensureLobby(); el.classList.add('show'); el.querySelector('#lobby-code').textContent = roomCode; }
  function renderLobby(room) {
    const el = ensureLobby();
    const players = Object.values(room.players || {}).sort((a, b) => a.joinedAt - b.joinedAt);
    el.querySelector('#lobby-list').innerHTML = players.map(p => `<div class="seat" style="min-width:auto;padding:8px 14px">${esc(p.name)}${p.id === room.host ? ' <span style="color:#1a1407;background:var(--gold);padding:1px 7px;border-radius:20px;font-size:11px;font-weight:800">마스터</span>' : ''}</div>`).join('');
    const act = el.querySelector('#lobby-actions'), wait = el.querySelector('#lobby-wait');
    if (isHost) {
      act.innerHTML = `<button class="btn primary" id="lobby-start" ${players.length < 2 ? 'disabled' : ''} style="font-size:16px;padding:13px 28px">게임 시작 (${players.length}명)</button>`;
      act.querySelector('#lobby-start').onclick = () => RT.startGame();
      wait.textContent = players.length < 2 ? '최소 2명 필요' : '';
    } else { act.innerHTML = ''; wait.textContent = '마스터가 시작하기를 기다리는 중…'; }
  }
  function closeLobby() { const el = document.getElementById('lobby'); if (el) el.classList.remove('show'); }

  RT.startGame = function () {
    if (!isHost) return;
    ref().get().then(snap => {
      const room = snap.val();
      const players = Object.values(room.players || {}).sort((a, b) => a.joinedAt - b.joinedAt).map(p => ({ id: p.id, name: p.name, isBot: false }));
      if (players.length < 2) return;
      game = new OldMaid({ players });
      publish('playing');
    });
  };
  RT.rematch = function () { if (!isHost || !game) return; game.reset(); publish('playing'); };

  function publish(phase) {
    const updates = {};
    updates['phase'] = phase || 'playing';
    updates['state'] = game.publicState();
    updates['hands'] = game.handsMap();
    updates['move'] = null;
    ref().update(updates);
  }

  function listenMovesAsHost() {
    const r = ref('move');
    const cb = r.on('value', snap => {
      const mv = snap.val(); if (!mv || !game || game.loser) return;
      // 보낸 사람이 현재 차례인지 검증
      if (game.players[game.turn].id !== mv.pid) { ref('move').set(null); return; }
      if (mv.type === 'draw') game.draw(typeof mv.idx === 'number' ? mv.idx : -1);
      publish(game.loser ? 'ended' : 'playing');
    });
    unsub.push(() => r.off('value', cb));
  }

  function listenRoom() {
    const pRef = ref('players');
    const pc = pRef.on('value', s => {
      const room = { players: s.val() || {} };
      ref('host').get().then(h => { room.host = h.val(); if (document.getElementById('lobby')?.classList.contains('show')) renderLobby(room); });
    });
    unsub.push(() => pRef.off('value', pc));

    const phRef = ref('phase');
    const ph = phRef.on('value', s => { const p = s.val(); if (p === 'playing' || p === 'ended') closeLobby(); });
    unsub.push(() => phRef.off('value', ph));

    const stRef = ref('state');
    const st = stRef.on('value', s => { const pub = s.val(); if (pub) App2.renderOnline(pub, myHand, myPid); });
    unsub.push(() => stRef.off('value', st));

    const hRef = ref('hands/' + myPid);
    const hc = hRef.on('value', s => { myHand = s.val() || []; ref('state').get().then(ss => { const pub = ss.val(); if (pub) App2.renderOnline(pub, myHand, myPid); }); });
    unsub.push(() => hRef.off('value', hc));
  }

  RT.sendMove = function (move) { if (!roomCode) return; ref('move').set(Object.assign({ pid: myPid, ts: Date.now() }, move)); };
})();
