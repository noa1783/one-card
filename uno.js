'use strict';
/* ═══════════════════════════════════════════════════════════════
   우노 · uno.js  —  순수 룰 엔진(UnoGame) + 브라우저 UI(UApp)
   엔진은 node/브라우저 양쪽 동작. 온라인은 uno-rt.js 가 담당.
   ─────────────────────────────────────────────────────────────
   카드:  { color:'R'|'Y'|'G'|'B'|'W',
            value:'0'..'9'|'skip'|'rev'|'+2'|'wild'|'wild4', id }
   ═══════════════════════════════════════════════════════════════ */
(function (root) {

  const COLORS = ['R', 'G', 'B', 'Y'];
  const COLOR_NAME = { R: '빨강', G: '초록', B: '파랑', Y: '노랑', W: '와일드' };

  function buildUnoDeck() {
    const d = []; let n = 0;
    const add = (color, value) => d.push({ color, value, id: 'u' + (n++) });
    for (const c of COLORS) {
      add(c, '0');
      for (let k = 1; k <= 9; k++) { add(c, '' + k); add(c, '' + k); }
      ['skip', 'rev', '+2'].forEach(v => { add(c, v); add(c, v); });
    }
    for (let i = 0; i < 4; i++) { add('W', 'wild'); add('W', 'wild4'); }
    return d; // 108장
  }
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const isWild = (c) => c.color === 'W';
  const drawValue = (c) => c.value === '+2' ? 2 : (c.value === 'wild4' ? 4 : 0);
  const isDraw = (c) => drawValue(c) > 0;
  const isNum = (c) => /^[0-9]$/.test(c.value);

  function defaultRules() {
    return {
      startCards: 7,
      drawMode: 'one',     // 'one' = 못 낼 때 1장 먹고 넘김 / 'untilPlayable' = 낼 카드 나올 때까지 먹기
      stacking: true,      // +2/+4 누적(되받아치기) 허용
      wild4Strict: false,  // 와일드+4는 현재 색 카드가 없을 때만
    };
  }

  // 두 드로우 카드가 누적될 수 있는가 (+2↔+2, +4↔+4. 교차는 기본 불가)
  function canStack(top, played, rules) {
    if (!rules.stacking) return false;
    if (top.value === '+2' && played.value === '+2') return true;
    if (top.value === 'wild4' && played.value === 'wild4') return true;
    return false;
  }

  // 정적 판정: 이 카드를 지금 낼 수 있는가
  // ctx: { color, top, attackActive, pendingDraw, rules, hand? }
  function canPlay(card, ctx) {
    const r = ctx.rules || defaultRules();
    if (ctx.attackActive && ctx.pendingDraw > 0) {     // 공격 받는 중 → 누적 카드만
      if (!isDraw(card)) return false;
      return canStack(ctx.top, card, r);
    }
    if (card.value === 'wild4') {
      if (r.wild4Strict && ctx.hand) {
        const hasColor = ctx.hand.some(c => c.id !== card.id && c.color === ctx.color);
        return !hasColor;
      }
      return true;
    }
    if (card.value === 'wild') return true;
    if (card.color === ctx.color) return true;                       // 색 일치
    if (ctx.top && !isWild(ctx.top) && card.value === ctx.top.value) return true; // 숫자/기호 일치
    return false;
  }

  // ═══════════════════════ 엔진 ═══════════════════════
  class UnoGame {
    constructor(cfg, rng) {
      this.rng = rng || Math.random;
      this.players = cfg.players.map(p => ({ id: p.id, name: p.name }));
      this.rules = Object.assign(defaultRules(), cfg.rules || {});
      if (cfg.startCards) this.rules.startCards = cfg.startCards;
      this.startCards = this.rules.startCards || 7;
      this.reset();
    }
    reset() {
      const deck = shuffle(buildUnoDeck(), this.rng);
      this.hands = {}; this.players.forEach(p => this.hands[p.id] = []);
      for (let k = 0; k < this.startCards; k++)
        for (const p of this.players) this.hands[p.id].push(deck.pop());
      // 시작 카드는 숫자 카드가 맨 위로
      let start = deck.pop(); let guard = 0;
      while (!isNum(start) && deck.length && guard++ < 300) { deck.unshift(start); start = deck.pop(); }
      this.deck = deck; this.discard = [start];
      this.currentColor = start.color === 'W' ? COLORS[Math.floor(this.rng() * 4)] : start.color;
      this.turn = 0; this.dir = 1;
      this.pendingDraw = 0; this.attackActive = false;
      this.winner = null; this.log = []; this.lastAction = null; this.seq = 0;
      this._say(`게임 시작 · 시작 카드 ${this.label(start)}`);
      return this;
    }

    top() { return this.discard[this.discard.length - 1]; }
    currentPlayer() { return this.players[this.turn]; }
    handOf(pid) { return this.hands[pid] || []; }
    count(pid) { return this.handOf(pid).length; }
    playerName(pid) { const p = this.players.find(x => x.id === pid); return p ? p.name : pid; }
    colorName(x) { return COLOR_NAME[x] || x; }
    label(c) {
      if (!c) return '-';
      if (c.color === 'W') return c.value === 'wild4' ? '와일드+4' : '와일드';
      const cn = { R: '🔴', G: '🟢', B: '🔵', Y: '🟡' }[c.color];
      const vn = c.value === 'skip' ? '건너뛰기' : c.value === 'rev' ? '방향전환' : c.value;
      return cn + vn;
    }
    _say(m) { this.log.push({ t: Date.now(), msg: m }); if (this.log.length > 200) this.log.shift(); }

    _ctx(hand) { return { color: this.currentColor, top: this.top(), attackActive: this.attackActive, pendingDraw: this.pendingDraw, rules: this.rules, hand }; }
    isPlayable(card, hand) { return canPlay(card, this._ctx(hand)); }
    playableIds(pid) {
      pid = pid || this.currentPlayer().id;
      if (this.winner || pid !== this.currentPlayer().id) return [];
      const hand = this.handOf(pid);
      return hand.filter(c => canPlay(c, this._ctx(hand))).map(c => c.id);
    }
    canSubmit(pid) { return this.playableIds(pid).length > 0; }
    canCounter(pid) {
      pid = pid || this.currentPlayer().id;
      if (!this.attackActive || this.pendingDraw <= 0 || pid !== this.currentPlayer().id) return false;
      const hand = this.handOf(pid);
      return hand.some(c => canPlay(c, this._ctx(hand)));
    }

    _advance(steps) { const n = this.players.length; let i = this.turn; for (let s = 0; s < steps; s++) i = (i + this.dir + n) % n; this.turn = i; }
    _reshuffle() {
      if (this.deck.length > 0) return;
      const t = this.discard.pop();
      this.deck = shuffle(this.discard, this.rng); this.discard = [t];
      this._say('덱 소진 → 버린 더미 셔플');
    }
    _draw(pid, k) {
      const drawn = [];
      for (let i = 0; i < k; i++) { this._reshuffle(); if (!this.deck.length) break; const c = this.deck.pop(); this.hands[pid].push(c); drawn.push(c); }
      return drawn;
    }

    play(pid, cardId, opt = {}) {
      if (this.winner) return { ok: false, error: '이미 끝난 게임' };
      if (pid !== this.currentPlayer().id) return { ok: false, error: '당신 차례가 아님' };
      const hand = this.hands[pid];
      const idx = hand.findIndex(c => c.id === cardId);
      if (idx < 0) return { ok: false, error: '손에 없는 카드' };
      const card = hand[idx];
      if (!canPlay(card, this._ctx(hand))) return { ok: false, error: '낼 수 없는 카드' };

      const wasUnderAttack = this.attackActive && this.pendingDraw > 0;
      hand.splice(idx, 1); this.discard.push(card);
      this.lastAction = { type: 'play', playerId: pid, card, counter: wasUnderAttack, seq: ++this.seq };

      if (isWild(card)) this.currentColor = (opt.color && COLORS.includes(opt.color)) ? opt.color : this.currentColor;
      else this.currentColor = card.color;

      const name = this.playerName(pid);
      this._say(`${name} → ${this.label(card)}${isWild(card) ? ` (색: ${this.colorName(this.currentColor)})` : ''}`);

      if (hand.length === 0) { this.winner = pid; this._say(`🏆 ${name} 승리!`); return { ok: true, winner: pid }; }

      const dv = drawValue(card);
      if (dv > 0) {
        this.pendingDraw += dv; this.attackActive = true;
        this._say(`⚔ +${dv}! 누적 ${this.pendingDraw}장`);
        this._advance(1);
        return { ok: true, oneCard: this._uno(pid) };
      }

      let skip = false, reversed = false;
      if (card.value === 'rev') { this.dir *= -1; reversed = true; if (this.players.length === 2) skip = true; }
      if (card.value === 'skip') skip = true;
      this.lastAction.effects = { skip: card.value === 'skip', reversed };
      this._advance(skip ? 2 : 1);
      if (card.value === 'skip') this._say('⏭ 다음 사람 건너뜀');
      if (reversed) this._say('🔄 방향 전환');
      return { ok: true, oneCard: this._uno(pid) };
    }
    _uno(pid) { const one = this.count(pid) === 1; if (one) this._say(`❗ ${this.playerName(pid)} UNO!`); return one; }

    drawAndPass(pid) {
      if (this.winner) return { ok: false, error: '이미 끝난 게임' };
      if (pid !== this.currentPlayer().id) return { ok: false, error: '당신 차례가 아님' };

      if (this.attackActive && this.pendingDraw > 0) {            // 공격분 전부 받기
        const drawn = this._draw(pid, this.pendingDraw);
        this.lastAction = { type: 'draw', playerId: pid, count: drawn.length, wasAttack: true, seq: ++this.seq };
        this._say(`${this.playerName(pid)} 공격 ${drawn.length}장 받음`);
        this.pendingDraw = 0; this.attackActive = false; this._advance(1);
        return { ok: true, drawn: drawn.length };
      }

      let drawn, keepTurn = false;
      if (this.rules.drawMode === 'untilPlayable') {
        drawn = []; let guard = 0;
        while (guard++ < 300) {
          const got = this._draw(pid, 1);
          if (!got.length) break;                                       // 덱 완전 소진
          drawn.push(got[0]);
          if (canPlay(got[0], this._ctx(this.hands[pid]))) { keepTurn = true; break; } // 낼 카드 나옴 → 멈춤
        }
      } else {
        drawn = this._draw(pid, 1);
      }
      this.lastAction = { type: 'draw', playerId: pid, count: drawn.length, wasAttack: false, seq: ++this.seq };
      this._say(`${this.playerName(pid)} ${drawn.length}장 뽑기${keepTurn ? ' (낼 카드 나옴 — 이어서 내기)' : ''}`);
      if (!keepTurn) this._advance(1);   // untilPlayable에서 낼 카드 뽑으면 턴 유지 → 직접 내고 넘김
      return { ok: true, drawn: drawn.length, keepTurn };
    }

    publicState() {
      return {
        game: 'uno',
        players: this.players.map(p => ({ id: p.id, name: p.name, count: this.count(p.id) })),
        top: this.top(), currentColor: this.currentColor,
        turn: this.turn, turnPlayerId: this.currentPlayer().id, dir: this.dir,
        pendingDraw: this.pendingDraw, attackActive: this.attackActive,
        deckCount: this.deck.length, winner: this.winner,
        log: this.log.slice(-30), lastAction: this.lastAction,
        startCards: this.startCards, rules: this.rules,
      };
    }
    handsMap() { const h = {}; this.players.forEach(p => h[p.id] = this.handOf(p.id)); return h; }
  }

  // 정적 헬퍼 (온라인 클라이언트가 손패 합법성 계산에 사용)
  UnoGame.canPlay = canPlay;
  UnoGame.drawValue = drawValue;
  UnoGame.isWild = isWild;
  UnoGame.buildDeck = buildUnoDeck;
  UnoGame.defaultRules = defaultRules;
  UnoGame.COLORS = COLORS;
  UnoGame.COLOR_NAME = COLOR_NAME;

  if (typeof module !== 'undefined' && module.exports) { module.exports = { UnoGame }; return; }
  root.UnoGame = UnoGame;

  /* ════════════════════ UI (브라우저 전용) ════════════════════ */
  if (typeof document === 'undefined') return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ME = 'me';
  const UApp = { mode: 'hotseat', game: null, cfg: null, myPid: ME, isHost: false };
  window.UApp = UApp;

  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  UApp.escapeHtml = esc;
  UApp.showGame = function () { $('#setup').style.display = 'none'; $('#game').classList.add('show'); };

  let toastTimer;
  function toast(html, ms) { const t = $('#toast'); if (!t) return; t.innerHTML = html; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1100); }
  UApp.toast = (h, m) => toast(h, m);

  /* ── 카드 DOM ── */
  const SYM = { skip: '⊘', rev: '⇄', '+2': '+2' };
  function symOf(c) { return SYM[c.value] || c.value; }
  function ucardEl(card, opt = {}) {
    const el = document.createElement('div'); el.className = 'ucard';
    if (opt.faceDown || !card) { el.classList.add('back'); if (opt.onClick) el.addEventListener('click', opt.onClick); return el; }
    el.classList.add('c-' + card.color.toLowerCase());
    if (card.color === 'W') {
      el.classList.add('wild');
      const tag = card.value === 'wild4' ? '+4' : '';
      el.innerHTML = `<span class="quad"></span><span class="cn tl">${tag || '★'}</span>
        <span class="oval"><span class="big">${card.value === 'wild4' ? '+4' : 'W'}</span></span>
        <span class="cn br">${tag || '★'}</span>`;
    } else {
      const s = symOf(card);
      el.innerHTML = `<span class="cn tl">${s}</span><span class="oval"><span class="big">${s}</span></span><span class="cn br">${s}</span>`;
    }
    if (opt.playable) el.classList.add('playable');
    if (opt.dim) el.classList.add('dim');
    if (opt.onClick) el.addEventListener('click', opt.onClick);
    return el;
  }

  /* ── 뷰모델 ── */
  function computePlayable(pub, hand) {
    const ctx = { color: pub.currentColor, top: pub.top, attackActive: pub.attackActive, pendingDraw: pub.pendingDraw, rules: pub.rules || defaultRules(), hand };
    return hand.filter(c => canPlay(c, ctx)).map(c => c.id);
  }
  function vmFromEngine(g, viewPid) {
    const pub = g.publicState();
    const mine = viewPid === pub.turnPlayerId;
    return Object.assign(baseVM(pub), {
      myPid: viewPid, myHand: g.handOf(viewPid).slice(),
      playableIds: mine ? g.playableIds(viewPid) : [],
      canSubmit: mine ? g.canSubmit(viewPid) : false,
      canCounter: mine ? g.canCounter(viewPid) : false,
      isMyTurn: mine,
    });
  }
  function vmFromPublic(pub, myPid, myHand) {
    const mine = myPid === pub.turnPlayerId;
    const pl = mine ? computePlayable(pub, myHand) : [];
    return Object.assign(baseVM(pub), {
      myPid, myHand: myHand.slice(), playableIds: pl,
      canSubmit: pl.length > 0,
      canCounter: mine && pub.attackActive && pub.pendingDraw > 0 && pl.length > 0,
      isMyTurn: mine,
    });
  }
  function baseVM(pub) {
    return {
      players: pub.players.map(p => ({ id: p.id, name: p.name, count: p.count, isTurn: p.id === pub.turnPlayerId, oneCard: p.count === 1 })),
      top: pub.top, currentColor: pub.currentColor, deckCount: pub.deckCount, dir: pub.dir,
      pendingDraw: pub.pendingDraw, attackActive: pub.attackActive, winner: pub.winner,
      log: pub.log, lastAction: pub.lastAction, rules: pub.rules,
      turnPlayerId: pub.turnPlayerId, turnPlayerName: (pub.players.find(p => p.id === pub.turnPlayerId) || {}).name,
    };
  }

  /* ── 렌더 ── */
  const COLOR_HEX = { R: '#d9412e', G: '#3aa856', B: '#2f6fd6', Y: '#e6b422' };
  let winFired = false, lastSeq = null, primed = false;
  let revealing = false, revealedSeq = null, pendingVM = null, lockUI = false, prevLen = 0;

  // 진입점: 온라인에서 내가 뽑았으면 한 장씩 연출 후 렌더 / 그 외엔 바로 렌더
  function render(vm) {
    const la = vm.lastAction;
    if (UApp.mode === 'online') {
      const grew = vm.myHand.length - prevLen;
      const myDraw = la && la.type === 'draw' && la.playerId === vm.myPid && grew > 0 && la.seq !== revealedSeq;
      if (myDraw) {
        revealedSeq = la.seq; lastSeq = la.seq;     // 내 뽑기 효과는 연출이 담당
        const drawn = vm.myHand.slice(vm.myHand.length - grew);
        const base = vm.myHand.slice(0, vm.myHand.length - grew);
        doReveal(vm, drawn, base, null);
        return;
      }
    }
    if (revealing) { pendingVM = vm; return; }
    paint(vm, vm.myHand); afterFx(vm); prevLen = vm.myHand.length;
  }

  // 뽑은 카드를 중앙에 한 장씩 보여주고 손패에 더하는 연출
  function doReveal(vm, drawn, baseHand, after) {
    revealing = true; lockUI = true;
    if (vm.lastAction && vm.lastAction.wasAttack) Fx.flash('bad');
    paint(vm, baseHand);
    revealSequence(drawn, vm, baseHand, () => {
      revealing = false; lockUI = false;
      const v = pendingVM || vm; pendingVM = null;
      paint(v, v.myHand); afterFx(v); prevLen = v.myHand.length;
      if (after) after(v);
    });
  }
  function revealSequence(cards, vm, baseHand, done) {
    const overlay = $('#draw-reveal'); const shown = baseHand.slice(); let i = 0;
    function step() {
      if (i >= cards.length) { overlay.classList.remove('show'); overlay.innerHTML = ''; done(); return; }
      const c = cards[i++];
      overlay.innerHTML = '';
      const cap = document.createElement('div'); cap.className = 'dr-cap'; cap.textContent = '뽑은 카드';
      const big = ucardEl(c); big.classList.add('dr-card');
      overlay.appendChild(cap); overlay.appendChild(big);
      overlay.classList.add('show'); Sfx.draw();
      setTimeout(() => {
        shown.push(c); paint(vm, shown);   // 손패에 추가
        big.classList.add('dr-out');
        setTimeout(step, 200);
      }, 520);
    }
    step();
  }

  // 효과음/승리/결과 처리 (paint 뒤 1회)
  function afterFx(vm) {
    fireFx(vm);
    if (vm.winner && !winFired) { winFired = true; Sfx.win(); Fx.sparkle('gold'); }
    if (!vm.winner) winFired = false;
    if (vm.winner) endGame(vm); else { const r = $('#result'); if (r) r.classList.remove('show'); }
  }

  // 실제 DOM 그리기 (handCards 로 손패 지정 — 연출 중 부분 손패 표시)
  function paint(vm, handCards) {
    handCards = handCards || vm.myHand;
    // 상대 좌석
    const opp = $('#opp'); opp.innerHTML = '';
    vm.players.forEach(p => {
      if (p.id === vm.myPid) return;
      const seat = document.createElement('div');
      seat.className = 'seat' + (p.isTurn ? ' turn' : '');
      const fan = Array.from({ length: Math.min(p.count, 7) }, () => '<span class="mb"></span>').join('');
      seat.innerHTML = `<div class="snm">${p.isTurn ? '<span class="tn">●</span> ' : ''}${esc(p.name)}</div>
        <div class="scnt">${p.count}장</div><div class="fan">${fan}</div>
        ${p.oneCard ? '<span class="uno-badge">UNO</span>' : ''}`;
      opp.appendChild(seat);
    });

    // 중앙
    const tc = $('#top-card'); tc.innerHTML = ''; tc.appendChild(ucardEl(vm.top));
    const chip = $('#color-chip'); chip.style.background = COLOR_HEX[vm.currentColor] || '#888';
    $('#deck-n').textContent = vm.deckCount;

    // 공격(누적) 카운터
    const ac = $('#attack');
    if (vm.attackActive && vm.pendingDraw > 0) {
      ac.classList.add('show'); $('#atk-num').textContent = vm.pendingDraw;
      $('#atk-hint').textContent = vm.isMyTurn
        ? (vm.canCounter ? '누적 카드로 받아치거나, 전부 받으세요.' : '받아칠 카드 없음 — 전부 받아야 합니다.')
        : `${vm.turnPlayerName} 의 차례`;
    } else ac.classList.remove('show');

    // 턴 표시
    const dirTxt = vm.dir === 1 ? '정방향 →' : '← 역방향';
    $('#turn-who').innerHTML = `<b>${esc(vm.turnPlayerName)}</b> 의 차례`;
    let sub = `방향 ${dirTxt} · 현재 색 <b style="color:${COLOR_HEX[vm.currentColor]}">${COLOR_NAME[vm.currentColor]}</b>`;
    if (vm.isMyTurn && !vm.winner) {
      if (vm.attackActive && vm.pendingDraw > 0)
        sub += vm.canCounter ? ' · <span class="can">받아치기 가능</span>' : ` · <span class="cant">${vm.pendingDraw}장 받기</span>`;
      else sub += vm.canSubmit ? ` · <span class="can">낼 수 있음 (${vm.playableIds.length})</span>` : ' · <span class="cant">낼 카드 없음 → 뽑기</span>';
    }
    $('#turn-sub').innerHTML = sub;

    // 내 손패
    const me = vm.players.find(p => p.id === vm.myPid) || { name: '', count: handCards.length };
    $('#my-name').innerHTML = `${esc(me.name || '나')} <span class="you">YOU</span>`;
    $('#my-count').textContent = `${handCards.length}장${handCards.length === 1 ? ' · UNO!' : ''}`;
    const hand = $('#myhand'); hand.innerHTML = '';
    const playable = new Set(vm.playableIds);
    handCards.forEach(c => {
      const pl = vm.isMyTurn && !lockUI && playable.has(c.id);
      hand.appendChild(ucardEl(c, { playable: pl, dim: vm.isMyTurn && !lockUI && !pl, onClick: pl ? () => onPlay(c) : null }));
    });

    // 액션
    const act = $('#actions'); act.innerHTML = '';
    if (vm.isMyTurn && !vm.winner && !lockUI) {
      const underAtk = vm.attackActive && vm.pendingDraw > 0;
      const b = document.createElement('button'); b.className = 'btn' + (underAtk ? ' danger' : ' primary');
      if (underAtk) { b.textContent = `공격 ${vm.pendingDraw}장 받기`; b.onclick = onDraw; }
      else if (!vm.canSubmit) { b.textContent = vm.rules && vm.rules.drawMode === 'untilPlayable' ? '낼 때까지 뽑기' : '1장 뽑기'; b.onclick = onDraw; }
      else { b.textContent = '낼 수 있는 카드가 있어요'; b.disabled = true; }
      act.appendChild(b);
    } else if (!vm.winner) {
      const w = document.createElement('div'); w.style.cssText = 'color:var(--muted);font-size:14px';
      w.textContent = `${vm.turnPlayerName} 의 차례를 기다리는 중…`;
      act.appendChild(w);
    }

    // 로그
    $('#logbox').innerHTML = (vm.log || []).slice().reverse().map(l => `<div class="li">${esc(l.msg)}</div>`).join('');
  }

  function popTop() { const c = $('#top-card .ucard'); if (!c) return; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
  function shake() { const g = $('#game'); if (!g) return; g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); setTimeout(() => g.classList.remove('shake'), 460); }
  function attackFx(n) { shake(); Fx.flash('bad'); Sfx.place(); Sfx.invalid(); toast(`<b style="color:var(--danger)">⚔️ +${n} 공격!</b>`, 950); }

  function fireFx(vm) {
    const la = vm.lastAction; const seq = la && la.seq != null ? la.seq : null;
    if (seq != null && seq !== lastSeq) {
      if (primed) playFx(la, vm);
      lastSeq = seq;
    }
    primed = true;
  }
  function playFx(la, vm) {
    if (la.type === 'draw') { if (la.playerId !== vm.myPid) { Sfx.draw(); if (la.wasAttack) Fx.flash('bad'); } return; } // 내 뽑기는 연출이 처리
    if (la.type !== 'play') return;
    popTop();
    const c = la.card;
    if (UnoGame.drawValue(c) > 0) { attackFx(UnoGame.drawValue(c)); return; }
    if (UnoGame.isWild(c)) { Sfx.place(); Fx.sparkle('gold'); return; }
    Sfx.place();
  }
  function resetFx() { lastSeq = null; primed = false; winFired = false; revealing = false; revealedSeq = null; pendingVM = null; lockUI = false; prevLen = 0; }

  /* ── 액션 처리 ── */
  async function onPlay(card) {
    if (lockUI) return;
    Sfx.unlock();
    let color = null;
    if (card.color === 'W') { color = await pickColor(); if (!color) return; }
    if (UApp.mode === 'online') { RT.sendMove({ type: 'play', cardId: card.id, color }); return; }
    const pid = UApp.game.currentPlayer().id;
    const r = UApp.game.play(pid, card.id, color ? { color } : {});
    if (!r.ok) { toast(esc(r.error)); return; }
    afterLocalMove();
  }
  function onDraw() {
    if (lockUI) return;
    Sfx.unlock();
    if (UApp.mode === 'online') { RT.sendMove({ type: 'draw' }); return; }
    const pid = UApp.game.currentPlayer().id;
    const r = UApp.game.drawAndPass(pid);
    if (!r.ok) { toast(esc(r.error)); return; }
    afterLocalDraw(pid, r);
  }
  function afterLocalMove() {   // 카드 낸 뒤
    if (UApp.game.winner) { render(vmFromEngine(UApp.game, UApp.game.winner)); return; }
    const next = UApp.game.currentPlayer();
    showCover(next, () => render(vmFromEngine(UApp.game, next.id)));
    toast(`<b>${esc(next.name)}</b> 차례`);
  }
  function afterLocalDraw(actorPid, r) {   // 뽑은 뒤 — 뽑은 카드를 actor에게 한 장씩 연출
    const g = UApp.game;
    const vm = vmFromEngine(g, actorPid);
    const n = r.drawn, full = vm.myHand;
    const drawn = full.slice(full.length - n), base = full.slice(0, full.length - n);
    const next = g.currentPlayer();
    doReveal(vm, drawn, base, () => {
      if (next.id !== actorPid) {                 // 턴 넘어감 → 다음 사람 가림막
        showCover(next, () => render(vmFromEngine(g, next.id)));
        toast(`<b>${esc(next.name)}</b> 차례`);
      }
      // next.id === actorPid (낼 카드 뽑아 턴 유지): doReveal이 이미 전체 손패+제출 가능 표시까지 그림
    });
  }

  /* 색 선택 모달 → Promise */
  function pickColor() {
    return new Promise(resolve => {
      const modal = $('#color-modal'); modal.classList.add('show');
      const handler = (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; cleanup(); resolve(b.dataset.c); };
      const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
      function cleanup() { modal.classList.remove('show'); $('#color-pick').removeEventListener('click', handler); document.removeEventListener('keydown', onKey); }
      $('#color-pick').addEventListener('click', handler);
      document.addEventListener('keydown', onKey);
    });
  }

  /* 패스앤플레이 가림막 */
  function showCover(player, onReady) {
    if (UApp.mode === 'online') { onReady(); return; }
    const cv = $('#cover'); $('#cover-who').innerHTML = `<b>${esc(player.name)}</b> 의 차례`;
    cv.classList.add('show');
    $('#cover-ready').onclick = () => { cv.classList.remove('show'); Sfx.unlock(); onReady(); };
  }

  function endGame(vm) {
    const r = $('#result'); if (r.classList.contains('show')) return;
    const won = UApp.mode === 'online' ? vm.winner === vm.myPid : true;
    const wname = (vm.players.find(p => p.id === vm.winner) || {}).name || '';
    $('#result-big').textContent = won ? '🏆 승리!' : '아쉽게 패배';
    $('#result-big').className = 'big ' + (won ? 'winc' : 'losec');
    $('#result-sub').textContent = UApp.mode === 'online'
      ? (won ? '가장 먼저 손패를 비웠어요!' : `${wname} 가 먼저 비웠어요.`)
      : `${wname} 가 손패를 모두 비웠습니다!`;
    r.classList.add('show');
  }

  /* ── 온라인 렌더 진입점 (uno-rt.js 호출) ── */
  UApp.renderOnline = function (pub, hand, myPid) {
    UApp.myPid = myPid;
    render(vmFromPublic(pub, myPid, hand || []));
  };

  /* ════════════════════ 세팅 ════════════════════ */
  let playerCount = 4, startCards = 7;
  const MAXP = 8, MINP = 2;

  function rebuildNames() {
    const grid = $('#players-grid'); const existing = $$('.player-input input').map(i => i.value);
    grid.innerHTML = '';
    for (let i = 0; i < playerCount; i++) {
      const w = document.createElement('div'); w.className = 'player-input';
      w.innerHTML = `<span class="pn">${i + 1}</span><input type="text" maxlength="12" value="${existing[i] || ('플레이어' + (i + 1))}"/>`;
      grid.appendChild(w);
    }
  }
  function readConfig() {
    const names = $$('.player-input input').map((i, idx) => (i.value.trim() || ('플레이어' + (idx + 1))));
    const rules = {
      startCards,
      drawMode: $('#drawmode').value,
      stacking: $('#stacking').checked,
      wild4Strict: $('#wild4').checked,
    };
    return { players: names.map((n, i) => ({ id: 'p' + (i + 1), name: n })), startCards, rules };
  }
  UApp.readConfig = readConfig;

  function startHotseat() {
    const cfg = readConfig(); UApp.cfg = cfg; UApp.mode = 'hotseat';
    UApp.game = new UnoGame(cfg); resetFx();
    $('#room-info').textContent = '한 기기 · 패스앤플레이';
    UApp.showGame(); Sfx.unlock();
    const first = UApp.game.currentPlayer();
    showCover(first, () => render(vmFromEngine(UApp.game, first.id)));
  }
  UApp.startFromCfg = function () { // 새 판 (hotseat)
    UApp.game = new UnoGame(UApp.cfg); resetFx();
    const first = UApp.game.currentPlayer();
    showCover(first, () => render(vmFromEngine(UApp.game, first.id)));
  };

  function newGame() {
    $('#result').classList.remove('show');
    if (UApp.mode === 'online') { if (UApp.isHost) RT.rematch(); else toast('마스터만 새 판을 시작할 수 있어요', 1100); return; }
    UApp.startFromCfg();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#pstep').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; playerCount = Math.min(MAXP, Math.max(MINP, playerCount + (+b.dataset.d))); $('#pcount').textContent = playerCount; rebuildNames(); });
    $('#sstep').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; startCards = Math.min(12, Math.max(1, startCards + (+b.dataset.d))); $('#scount').textContent = startCards; });
    $('#btn-start').addEventListener('click', startHotseat);
    $('#btn-new').addEventListener('click', newGame);
    $('#result-new').addEventListener('click', newGame);
    $('#logt').addEventListener('click', () => $('#logbox').classList.toggle('show'));
    $('#deck-pile').addEventListener('click', () => { const b = $('#actions button:not([disabled])'); if (b && /뽑기|받기/.test(b.textContent)) b.click(); });

    if (window.RT) {
      RT.initUI && RT.initUI();
      const h = $('#btn-host'), j = $('#btn-join');
      if (h) h.addEventListener('click', () => RT.host(readConfig()));
      if (j) j.addEventListener('click', () => {
        const room = ($('#rt-room').value || '').trim();
        const name = ($('#rt-myname').value || '').trim() || '플레이어';
        if (!room) { toast('방 코드를 입력하세요', 900); return; }
        RT.join(room, name);
      });
    }
    rebuildNames();
  });

})(typeof window !== 'undefined' ? window : globalThis);
