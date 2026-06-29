'use strict';
/* ═══════════════════════════════════════════════════════════════
   원카드 · app.js  —  UI 컨트롤러 (세팅 · 렌더 · 패스앤플레이)
   온라인 레이어(realtime.js)는 App.renderOnline / App.relay 를 사용.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: '스페이드', H: '하트', D: '다이아', C: '클로버' };
  const isRedSuit = (s) => s === 'H' || s === 'D';

  const App = {
    mode: 'hotseat',     // 'hotseat' | 'online'
    game: null,          // 로컬 엔진 (hotseat / online-host)
    cfg: null,           // 마지막 시작 설정 (새 판용)
    myPid: null,         // online: 내 플레이어 id
    isHost: false,
    pendingCover: false, // hotseat 가림막 대기
  };
  window.App = App;

  /* ───────────────────────── 카드 렌더 ───────────────────────── */
  function cardEl(card, opt = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    if (!card) { el.classList.add('back'); return el; }
    const red = card.suit === 'JOKER' ? card.rank === 'COLOR' : isRedSuit(card.suit);
    el.classList.add(red ? 'red' : 'black');
    if (card.suit === 'JOKER') {
      el.classList.add('joker');
      el.innerHTML =
        `<div class="corner tl"><span class="r">JKR</span></div>
         <div class="pip"><span class="jk">JOKER</span></div>
         <div class="corner br"><span class="r">JKR</span></div>`;
    } else {
      const sym = SUIT_SYM[card.suit];
      el.innerHTML =
        `<div class="corner tl"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>
         <div class="pip"><span class="psym">${sym}</span><span class="prank">${card.rank}</span></div>
         <div class="corner br"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>`;
    }
    if (opt.playable) el.classList.add('playable');
    if (opt.dim) el.classList.add('dim');
    if (opt.onClick) el.addEventListener('click', opt.onClick);
    return el;
  }

  /* ───────────────────────── 뷰모델 ───────────────────────── */
  // 로컬 엔진 → 특정 플레이어 시점 뷰모델
  function vmFromEngine(g, viewPid) {
    const pub = g.publicState();
    return {
      players: pub.players.map(p => ({
        id: p.id, name: p.name, count: p.count,
        isTurn: p.id === pub.turnPlayerId,
        oneCard: p.count === 1,
      })),
      top: pub.top, currentSuit: pub.currentSuit, deckCount: pub.deckCount,
      dir: pub.dir, pendingAttack: pub.pendingAttack, attackActive: pub.attackActive,
      winner: pub.winner, log: pub.log,
      lastAction: pub.lastAction, rules: pub.rules,
      turnPlayerId: pub.turnPlayerId,
      turnPlayerName: g.playerName(pub.turnPlayerId),
      myPid: viewPid,
      myHand: g.handOf(viewPid).slice(),
      playableIds: viewPid === pub.turnPlayerId ? g.playableIds(viewPid) : [],
      canSubmit: viewPid === pub.turnPlayerId ? g.canSubmit(viewPid) : false,
      canCounter: viewPid === pub.turnPlayerId ? g.canCounter(viewPid) : false,
      isMyTurn: viewPid === pub.turnPlayerId,
    };
  }

  // 온라인: 받은 publicState + 내 손패 → 뷰모델
  function vmFromPublic(pub, myPid, myHand) {
    const ruleset = pub.rules || OneCard.defaultRules();
    const fakeTop = pub.top;
    // playable 계산을 위해 미니 판정 (엔진 없이)
    const tmp = new OneCard.OneCardGame(
      { players: pub.players.map(p => ({ id: p.id, name: p.name })), startCards: 1, useJokers: pub.useJokers, rules: ruleset },
    );
    tmp.discard = [fakeTop]; tmp.currentSuit = pub.currentSuit;
    tmp.pendingAttack = pub.pendingAttack; tmp.attackActive = pub.attackActive;
    tmp.turn = pub.players.findIndex(p => p.id === pub.turnPlayerId);
    tmp.hands[myPid] = myHand.slice();
    const isMine = myPid === pub.turnPlayerId;
    return {
      players: pub.players.map(p => ({
        id: p.id, name: p.name, count: p.count,
        isTurn: p.id === pub.turnPlayerId, oneCard: p.count === 1,
      })),
      top: pub.top, currentSuit: pub.currentSuit, deckCount: pub.deckCount,
      dir: pub.dir, pendingAttack: pub.pendingAttack, attackActive: pub.attackActive,
      winner: pub.winner, log: pub.log || [],
      lastAction: pub.lastAction, rules: pub.rules,
      turnPlayerId: pub.turnPlayerId,
      turnPlayerName: (pub.players.find(p => p.id === pub.turnPlayerId) || {}).name,
      myPid, myHand: myHand.slice(),
      playableIds: isMine ? tmp.playableIds(myPid) : [],
      canSubmit: isMine ? tmp.canSubmit(myPid) : false,
      canCounter: isMine ? tmp.canCounter(myPid) : false,
      isMyTurn: isMine,
    };
  }

  /* ───────────────────────── 렌더 ───────────────────────── */
  function render(vm) {
    // 상대 좌석
    const opp = $('#opponents'); opp.innerHTML = '';
    vm.players.forEach(p => {
      if (p.id === vm.myPid) return;
      const seat = document.createElement('div');
      seat.className = 'seat' + (p.isTurn ? ' turn' : '');
      const fan = Array.from({ length: Math.min(p.count, 6) }, () => '<span class="mb"></span>').join('');
      seat.innerHTML =
        `<div class="nm">${p.isTurn ? '<span class="dir">●</span>' : ''}${escapeHtml(p.name)}</div>
         <div class="cnt">${p.count}장</div>
         <div class="mini-fan">${fan}</div>
         ${p.oneCard ? '<span class="onecard">원카드</span>' : ''}`;
      opp.appendChild(seat);
    });

    // 중앙
    const tc = $('#top-card'); tc.innerHTML = ''; tc.appendChild(cardEl(vm.top));
    const chip = $('#suit-chip');
    chip.textContent = SUIT_SYM[vm.currentSuit] || '♠';
    chip.className = 'chip ' + (isRedSuit(vm.currentSuit) ? 'red' : 'black');
    $('#deck-n').textContent = vm.deckCount;

    // 공격 카운터
    const ac = $('#attack-counter');
    if (vm.attackActive && vm.pendingAttack > 0) {
      ac.classList.add('show');
      $('#atk-num').textContent = vm.pendingAttack;
      $('#atk-hint').textContent = vm.isMyTurn
        ? (vm.canCounter ? '공격 카드로 반격하거나, 받을 수 있어요.' : '반격 카드 없음 — 전부 받아야 합니다.')
        : `${vm.turnPlayerName} 의 반격 차례`;
    } else ac.classList.remove('show');

    // 턴 표시
    const dirTxt = vm.dir === 1 ? '시계방향 →' : '← 반시계방향';
    $('#turn-who').innerHTML = `<b>${escapeHtml(vm.turnPlayerName)}</b> 의 차례`;
    let sub = `방향 ${dirTxt}`;
    if (vm.isMyTurn) {
      if (vm.attackActive && vm.pendingAttack > 0)
        sub += vm.canCounter ? ' · <span class="can">반격 가능</span>' : ` · <span class="cant">반격 불가 (${vm.pendingAttack}장 받기)</span>`;
      else sub += vm.canSubmit ? ` · <span class="can">제출 가능 (${vm.playableIds.length}장)</span>` : ' · <span class="cant">낼 카드 없음 → 뽑기</span>';
    }
    $('#turn-sub').innerHTML = sub;

    // 내 손패
    const me = vm.players.find(p => p.id === vm.myPid);
    $('#my-name').innerHTML = `${escapeHtml(me ? me.name : '')} <span class="you">YOU</span>`;
    $('#my-count').textContent = `${vm.myHand.length}장`;
    const hand = $('#myhand'); hand.innerHTML = '';
    const playable = new Set(vm.playableIds);
    vm.myHand.forEach(c => {
      const pl = vm.isMyTurn && playable.has(c.id);
      const el = cardEl(c, {
        playable: pl,
        dim: vm.isMyTurn && !pl,
        onClick: pl ? () => onPlay(c) : null,
      });
      hand.appendChild(el);
    });

    // 액션 (뽑기 / 받기)
    const act = $('#actions'); act.innerHTML = '';
    if (vm.isMyTurn && !vm.winner) {
      const underAtk = vm.attackActive && vm.pendingAttack > 0;
      const drawBtn = document.createElement('button');
      drawBtn.className = 'btn' + (underAtk ? ' danger' : '');
      if (underAtk) {
        drawBtn.textContent = `공격 ${vm.pendingAttack}장 받기`;
        drawBtn.onclick = onDraw;
      } else if (!vm.canSubmit) {
        drawBtn.textContent = '1장 뽑기';
        drawBtn.onclick = onDraw;
      } else {
        drawBtn.textContent = '낼 수 있는 카드가 있어요';
        drawBtn.disabled = true;
      }
      act.appendChild(drawBtn);
    } else if (!vm.winner) {
      const wait = document.createElement('div');
      wait.style.color = 'var(--muted)'; wait.style.fontSize = '14px';
      wait.textContent = `${vm.turnPlayerName} 의 차례를 기다리는 중…`;
      act.appendChild(wait);
    }

    // 로그
    renderLog(vm.log);

    // 승리
    if (vm.winner) showWin(vm.players.find(p => p.id === vm.winner));

    // 효과음 · 이펙트
    if (window.Effects) Effects.onRender(vm);
  }

  function renderLog(log) {
    const box = $('#logbox'); box.innerHTML = '';
    (log || []).slice().reverse().forEach(l => {
      const d = document.createElement('div'); d.className = 'li'; d.textContent = l.msg;
      box.appendChild(d);
    });
  }

  /* ───────────────────────── 액션 처리 ───────────────────────── */
  async function onPlay(card) {
    let suit = null;
    const needSuit = card.suit === 'JOKER' || (App.game ? card.rank === App.game.rules.wildRank : false)
      || (App._rules ? card.rank === App._rules.wildRank : false);
    if (needSuit) {
      suit = await pickSuit();
      if (!suit) return; // 취소
    }
    if (App.mode === 'online') { RT.sendMove({ type: 'play', cardId: card.id, suit }); return; }
    // hotseat
    const pid = App.game.currentPlayer().id;
    const r = App.game.play(pid, card.id, suit ? { suit } : {});
    if (!r.ok) { flash(r.error); return; }
    afterLocalMove();
  }

  function onDraw() {
    if (App.mode === 'online') { RT.sendMove({ type: 'draw' }); return; }
    const pid = App.game.currentPlayer().id;
    const r = App.game.drawAndPass(pid);
    if (!r.ok) { flash(r.error); return; }
    afterLocalMove();
  }

  // hotseat: 한 수 끝난 뒤 → 승리/가림막
  function afterLocalMove() {
    if (App.game.winner) { render(vmFromEngine(App.game, App.game.winner)); return; }
    const next = App.game.currentPlayer();
    showCover(next, () => render(vmFromEngine(App.game, next.id)));
    // 가림막 동안 잠깐 토스트
    toast(`<b>${escapeHtml(next.name)}</b> 차례`);
  }

  /* 무늬 선택 모달 → Promise */
  function pickSuit() {
    return new Promise(resolve => {
      const modal = $('#suit-modal');
      modal.classList.add('show');
      const handler = (e) => {
        const b = e.target.closest('button[data-s]');
        if (!b) return;
        cleanup(); resolve(b.dataset.s);
      };
      const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
      function cleanup() { modal.classList.remove('show'); $('#suit-pick').removeEventListener('click', handler); document.removeEventListener('keydown', onKey); }
      $('#suit-pick').addEventListener('click', handler);
      document.addEventListener('keydown', onKey);
    });
  }

  /* 패스앤플레이 가림막 */
  function showCover(player, onReady) {
    if (App.mode === 'online') { onReady(); return; } // 온라인은 가림막 불필요
    const cv = $('#cover');
    $('#cover-who').innerHTML = `<b>${escapeHtml(player.name)}</b> 의 차례`;
    cv.classList.add('show');
    $('#cover-ready').onclick = () => { cv.classList.remove('show'); onReady(); };
  }

  /* 승리 / 토스트 / flash */
  function showWin(p) {
    const w = $('#win'); $('#win-who').textContent = p ? p.name : '';
    w.classList.add('show');
  }
  let toastTimer;
  function toast(html) {
    const t = $('#toast'); t.innerHTML = html; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1100);
  }
  function flash(msg) { toast(escapeHtml(msg)); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  /* ───────────────────────── 온라인 렌더 훅 ───────────────────────── */
  App.renderOnline = function (pub, myHand, myPid) {
    App._rules = pub.rules;
    render(vmFromPublic(pub, myPid, myHand || []));
  };
  App.showGame = function () { $('#setup').style.display = 'none'; $('#game').classList.add('show'); };
  App.toast = toast;
  App.escapeHtml = escapeHtml;

  /* ═══════════════════════════ 세팅 화면 ═══════════════════════════ */
  let playerCount = 4, startCards = 7;
  const MAXP = 6, MINP = 2;

  function rebuildPlayerInputs() {
    const grid = $('#players-grid');
    const existing = $$('.player-input input').map(i => i.value);
    grid.innerHTML = '';
    for (let i = 0; i < playerCount; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'player-input';
      wrap.innerHTML = `<span class="pn">${i + 1}</span><input type="text" maxlength="12" value="${existing[i] || ('플레이어' + (i + 1))}"/>`;
      grid.appendChild(wrap);
    }
  }

  function readConfig() {
    const names = $$('.player-input input').map((i, idx) => (i.value.trim() || ('플레이어' + (idx + 1))));
    const optVal = id => { const v = $('#' + id).value; return v === '없음' ? null : v; };
    const rules = {
      attack: {
        '2': Math.max(0, +$('#atk2').value || 0),
        'A': Math.max(0, +$('#atkA').value || 0),
        'JOKER_BLACK': 5, 'JOKER_COLOR': 7,
      },
      wildRank: optVal('wildRank'),
      skipRank: optVal('skipRank'),
      reverseRank: optVal('reverseRank'),
      extraTurnRank: optVal('extraRank'),
      jokerCountersNumber: $('#jokerCounters').checked,
      mustDeclareOneCard: true,
    };
    return {
      players: names.map((n, i) => ({ id: 'p' + (i + 1), name: n })),
      startCards, useJokers: $('#use-jokers').checked, rules,
    };
  }

  function startHotseat() {
    const cfg = readConfig();
    App.cfg = cfg; App.mode = 'hotseat';
    App.game = new OneCard.OneCardGame(cfg);
    App._rules = App.game.rules;
    if (window.Effects) Effects.reset();
    $('#room-info').textContent = '한 기기 · 패스앤플레이';
    App.showGame();
    const first = App.game.currentPlayer();
    showCover(first, () => render(vmFromEngine(App.game, first.id)));
  }
  App.startHotseatFromCfg = function () { // 새 판
    App.game = new OneCard.OneCardGame(App.cfg);
    App._rules = App.game.rules;
    if (window.Effects) Effects.reset();
    const first = App.game.currentPlayer();
    showCover(first, () => render(vmFromEngine(App.game, first.id)));
  };
  App.readConfig = readConfig;

  /* ───────────────────────── 이벤트 바인딩 ───────────────────────── */
  function bind() {
    $('#player-stepper').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      playerCount = Math.min(MAXP, Math.max(MINP, playerCount + (+b.dataset.d)));
      $('#player-count').textContent = playerCount; rebuildPlayerInputs();
    });
    $('#start-stepper').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      startCards = Math.min(12, Math.max(1, startCards + (+b.dataset.d)));
      $('#start-count').textContent = startCards;
    });
    $('#btn-start').addEventListener('click', startHotseat);

    // 온라인
    $('#btn-host').addEventListener('click', () => RT.host(readConfig()));
    $('#btn-join').addEventListener('click', () => {
      const room = $('#rt-room').value.trim();
      const name = $('#rt-myname').value.trim() || '플레이어';
      if (!room) { flash('방 코드를 입력하세요'); return; }
      RT.join(room, name);
    });

    // 게임 상단
    $('#btn-rematch').addEventListener('click', () => {
      if (App.mode === 'online') { if (App.isHost) RT.rematch(); else flash('마스터만 새 판을 시작할 수 있어요'); }
      else { $('#win').classList.remove('show'); App.startHotseatFromCfg(); }
    });
    $('#btn-quit').addEventListener('click', () => location.reload());
    $('#win-rematch').addEventListener('click', () => {
      $('#win').classList.remove('show');
      if (App.mode === 'online') { if (App.isHost) RT.rematch(); }
      else App.startHotseatFromCfg();
    });
    $('#win-home').addEventListener('click', () => location.reload());

    // 로그 토글
    $('#log-toggle').addEventListener('click', () => $('#logbox').classList.toggle('show'));
    // 음소거 토글
    const muteBtn = $('#btn-mute');
    if (muteBtn && window.Effects) {
      const sync = () => { muteBtn.textContent = Effects.isMuted() ? '🔇' : '🔊'; muteBtn.title = Effects.isMuted() ? '소리 켜기' : '소리 끄기'; };
      sync();
      muteBtn.addEventListener('click', () => { Effects.unlock(); Effects.setMuted(!Effects.isMuted()); sync(); });
    }
    // 덱 클릭 = 뽑기(가능 시)
    $('#deck-pile').addEventListener('click', () => {
      const btn = $('#actions button:not([disabled])');
      if (btn && /뽑기|받기/.test(btn.textContent)) btn.click();
    });

    rebuildPlayerInputs();
    RT.initUI();  // 온라인 가능 여부에 따라 버튼 활성화
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
