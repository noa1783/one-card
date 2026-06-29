'use strict';
/* ═══════════════════════════════════════════════════════════════
   원카드 · realtime.js  —  온라인 멀티 (Firebase RTDB · 호스트 권한)
   - 마스터(호스트)가 엔진을 들고 모든 수를 적용·검증
   - 각 플레이어는 자기 손패(private)만 받고, 수는 move 슬롯으로 전송
   - firebase-config.js 가 비어있으면 전체 비활성 → 패스앤플레이만
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const RT = {};
  window.RT = RT;

  let db = null, ready = false;
  let roomCode = null, myPid = null, isHost = false, hostCfg = null;
  let game = null;            // 호스트 전용 엔진
  let unsub = [];

  const esc = (s) => (window.App ? App.escapeHtml(s) : String(s));

  /* ── 사용 가능 여부 ── */
  function cfgValid() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.databaseURL && !/YOUR_/.test(c.databaseURL));
  }

  RT.initUI = function () {
    const status = document.getElementById('rt-status');
    const hostBtn = document.getElementById('btn-host');
    if (typeof firebase === 'undefined') {
      status.textContent = '오프라인 · Firebase 스크립트 미로드 (인터넷 연결 확인) — 패스앤플레이만 가능';
      return;
    }
    if (!cfgValid()) {
      status.textContent = '오프라인 · firebase-config.js 를 채워야 온라인 가능 (현재 YOUR_ 값) — 패스앤플레이만 가능';
      return;
    }
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      db = firebase.database();
      ready = true;
      status.textContent = '온라인 준비됨 · 방 만들기/참가 가능';
      status.classList.add('on');
      hostBtn.disabled = false;
    } catch (e) {
      status.textContent = '온라인 초기화 실패: ' + (e && e.message ? e.message : e) + ' — 패스앤플레이로 진행하세요';
      console.error('[원카드] firebase init 실패', e);
    }
    // 초대 링크에 ?room= 있으면 자동 채움
    const r = new URLSearchParams(location.search).get('room');
    if (r) document.getElementById('rt-room').value = r.toUpperCase();
  };

  const code4 = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  const newPid = () => 'u' + Math.random().toString(36).slice(2, 8);
  const roomRef = (sub) => db.ref('rooms/' + roomCode + (sub ? '/' + sub : ''));

  /* ── 호스트: 방 생성 ── */
  RT.host = function (cfg) {
    if (!ready) {
      App.toast('온라인 비활성 — firebase-config.js 확인');
      console.warn('[원카드] RT.host: ready=false (firebase 미초기화 또는 config 미설정)');
      return;
    }
    hostCfg = cfg; isHost = true; App.isHost = true; App.mode = 'online';
    roomCode = code4(); myPid = newPid(); App.myPid = myPid;
    const myName = (document.getElementById('rt-myname').value.trim()) || (cfg.players[0] && cfg.players[0].name) || '마스터';
    const room = {
      phase: 'lobby',
      host: myPid,
      config: { startCards: cfg.startCards, useJokers: cfg.useJokers, rules: cfg.rules },
      players: {},
      move: null, state: null,
    };
    room.players[myPid] = { id: myPid, name: myName, joinedAt: Date.now() };
    App.toast('방 생성 중…');
    roomRef().set(room).then(() => {
      App.showGame();
      document.getElementById('room-info').innerHTML = `방 <b>${roomCode}</b>`;
      openLobby();
      listenRoom();
      listenMovesAsHost();
    }).catch(err => {
      console.error('[원카드] 방 생성 실패', err);
      const msg = /permission|PERMISSION/.test(err.message || '')
        ? '쓰기 권한 거부 — DB 보안 규칙(rooms .read/.write true) 게시 확인'
        : '방 생성 실패: ' + (err.message || err);
      App.toast(msg);
      isHost = false; App.mode = 'hotseat';
    });
  };

  /* ── 플레이어: 참가 ── */
  RT.join = function (code, name) {
    if (!ready) {
      App.toast('온라인 비활성 — firebase-config.js 확인');
      console.warn('[원카드] RT.join: ready=false');
      return;
    }
    roomCode = code.toUpperCase(); myPid = newPid(); App.myPid = myPid;
    isHost = false; App.isHost = false; App.mode = 'online';
    roomRef().get().then(snap => {
      if (!snap.exists()) { App.toast('그런 방이 없어요 (코드 확인)'); return; }
      const room = snap.val();
      if (room.phase !== 'lobby') { App.toast('이미 시작된 방이에요'); return; }
      return roomRef('players/' + myPid).set({ id: myPid, name, joinedAt: Date.now() }).then(() => {
        App.showGame();
        document.getElementById('room-info').innerHTML = `방 <b>${roomCode}</b>`;
        openLobby();
        listenRoom();
      });
    }).catch(err => {
      console.error('[원카드] 참가 실패', err);
      const msg = /permission|PERMISSION/.test(err.message || '')
        ? '읽기 권한 거부 — DB 보안 규칙 게시 확인'
        : '참가 실패: ' + (err.message || err);
      App.toast(msg);
    });
  };

  /* ── 로비 오버레이 ── */
  function ensureLobby() {
    let el = document.getElementById('lobby');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lobby';
    el.className = 'cover show';
    el.style.zIndex = 75;
    el.innerHTML = `
      <div class="who display">대기실</div>
      <p>방 코드 <b style="color:var(--gold);letter-spacing:.15em" id="lobby-code"></b> — 친구에게 공유하세요</p>
      <button class="btn ghost" id="lobby-copy" style="font-size:13px;padding:7px 14px">초대 링크 복사</button>
      <div id="lobby-list" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:18px 0;max-width:520px"></div>
      <div id="lobby-actions"></div>
      <p id="lobby-wait" style="color:var(--muted)"></p>`;
    document.body.appendChild(el);
    el.querySelector('#lobby-copy').onclick = () => {
      const link = location.origin + location.pathname + '?room=' + roomCode;
      navigator.clipboard?.writeText(link); App.toast('초대 링크 복사됨');
    };
    return el;
  }
  function openLobby() {
    const el = ensureLobby(); el.classList.add('show');
    el.querySelector('#lobby-code').textContent = roomCode;
  }
  function renderLobby(room) {
    const el = ensureLobby();
    const players = Object.values(room.players || {}).sort((a, b) => a.joinedAt - b.joinedAt);
    el.querySelector('#lobby-list').innerHTML = players.map(p =>
      `<div class="seat" style="min-width:auto">${esc(p.name)}${p.id === room.host ? ' <span class="onecard">마스터</span>' : ''}</div>`).join('');
    const act = el.querySelector('#lobby-actions');
    const wait = el.querySelector('#lobby-wait');
    if (isHost) {
      act.innerHTML = `<button class="btn primary" id="lobby-start" ${players.length < 2 ? 'disabled' : ''} style="font-size:16px;padding:13px 28px">게임 시작 (${players.length}명)</button>`;
      act.querySelector('#lobby-start').onclick = () => RT.startGame();
      wait.textContent = players.length < 2 ? '최소 2명 필요' : '';
    } else {
      act.innerHTML = '';
      wait.textContent = '마스터가 시작하기를 기다리는 중…';
    }
  }
  function closeLobby() { const el = document.getElementById('lobby'); if (el) el.classList.remove('show'); }

  /* ── 호스트: 게임 시작 ── */
  RT.startGame = function () {
    if (!isHost) return;
    roomRef().get().then(snap => {
      const room = snap.val();
      const players = Object.values(room.players || {}).sort((a, b) => a.joinedAt - b.joinedAt)
        .map(p => ({ id: p.id, name: p.name }));
      if (players.length < 2) return;
      game = new OneCard.OneCardGame({
        players, startCards: room.config.startCards,
        useJokers: room.config.useJokers, rules: room.config.rules,
      });
      publish('playing');
    });
  };
  RT.rematch = function () {
    if (!isHost || !game) return;
    game.reset();
    publish('playing');
  };

  /* ── 호스트: 상태 + 손패 발행 ── */
  function publish(phase) {
    const pub = game.publicState();
    const hands = {};
    game.players.forEach(p => { hands[p.id] = game.handOf(p.id); });
    const updates = {};
    updates['phase'] = phase || 'playing';
    updates['state'] = pub;
    updates['hands'] = hands;
    updates['move'] = null;
    roomRef().update(updates);
  }

  /* ── 호스트: 들어온 수 적용 ── */
  function listenMovesAsHost() {
    const ref = roomRef('move');
    const cb = ref.on('value', snap => {
      const mv = snap.val();
      if (!mv || !game) return;
      const pid = mv.pid;
      let r;
      if (mv.type === 'play') r = game.play(pid, mv.cardId, mv.suit ? { suit: mv.suit } : {});
      else if (mv.type === 'draw') r = game.drawAndPass(pid);
      else r = { ok: false };
      // 적용 결과와 무관하게 슬롯 비우고 재발행 (실패해도 상태 동기화)
      publish(game.winner ? 'ended' : 'playing');
    });
    unsub.push(() => ref.off('value', cb));
  }

  /* ── 공통: 방 구독 (로비/상태/내 손패) ── */
  let myHand = [];
  function listenRoom() {
    const pRef = roomRef('players');
    const pc = pRef.on('value', s => {
      const room = { players: s.val() || {}, host: null };
      roomRef('host').get().then(h => { room.host = h.val(); if (document.getElementById('lobby')?.classList.contains('show')) renderLobby(room); });
    });
    unsub.push(() => pRef.off('value', pc));

    const phRef = roomRef('phase');
    const ph = phRef.on('value', s => {
      const phase = s.val();
      if (phase === 'playing' || phase === 'ended') closeLobby();
    });
    unsub.push(() => phRef.off('value', ph));

    const stRef = roomRef('state');
    const st = stRef.on('value', s => {
      const pub = s.val(); if (!pub) return;
      App.renderOnline(pub, myHand, myPid);
    });
    unsub.push(() => stRef.off('value', st));

    const hRef = roomRef('hands/' + myPid);
    const hc = hRef.on('value', s => {
      myHand = s.val() || [];
      roomRef('state').get().then(ss => { const pub = ss.val(); if (pub) App.renderOnline(pub, myHand, myPid); });
    });
    unsub.push(() => hRef.off('value', hc));
  }

  /* ── 플레이어/호스트: 수 전송 ── */
  RT.sendMove = function (move) {
    if (!roomCode) return;
    roomRef('move').set(Object.assign({ pid: myPid, ts: Date.now() }, move));
  };

})();
