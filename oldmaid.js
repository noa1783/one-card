'use strict';
/* ═══════════════════════════════════════════════════════════════
   도둑잡기 · oldmaid.js
   52장 + 조커 1장. 같은 숫자 짝 버리기. 마지막 조커 든 사람 패배.
   엔진(OldMaid)은 순수 로직 → node 테스트 가능. 아래 UI는 브라우저 전용.
   ═══════════════════════════════════════════════════════════════ */
(function (root) {

  class OldMaid {
    constructor(cfg, rng) {
      this.rng = rng || Math.random;
      this.players = cfg.players.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot, safe: false }));
      this.reset();
    }
    reset() {
      const deck = Cards2.shuffle(Cards2.buildDeck({ jokers: 1 }), this.rng);
      this.hands = {}; this.players.forEach(p => { this.hands[p.id] = []; p.safe = false; });
      let i = 0;
      while (deck.length) { this.hands[this.players[i % this.players.length].id].push(deck.pop()); i++; }
      this.players.forEach(p => this.removePairs(p.id));
      this.turn = 0; this.loser = null; this.log = [];
      this.lastDraw = null; this._seq = 0; // {byId, fromId, card, paired, seq}
      // 시작 시 이미 빈 손이면 안전 처리
      this.players.forEach(p => { if (this.hands[p.id].length === 0) p.safe = true; });
      this._ensureActiveTurn();
      this._checkEnd();
      return this;
    }
    removePairs(pid) {
      const hand = this.hands[pid];
      const byRank = {};
      hand.forEach(c => { (byRank[c.rank] = byRank[c.rank] || []).push(c); });
      const removed = [];
      Object.values(byRank).forEach(arr => {
        while (arr.length >= 2) { removed.push(arr.pop(), arr.pop()); }
      });
      if (removed.length) {
        const rmIds = new Set(removed.map(c => c.id));
        this.hands[pid] = hand.filter(c => !rmIds.has(c.id));
      }
      return removed;
    }
    activePlayers() { return this.players.filter(p => this.hands[p.id].length > 0); }
    player(idx) { return this.players[idx]; }
    count(pid) { return (this.hands[pid] || []).length; }
    name(pid) { const p = this.players.find(x => x.id === pid); return p ? p.name : pid; }

    _ensureActiveTurn() {
      const n = this.players.length;
      let g = 0;
      while (this.hands[this.players[this.turn].id].length === 0 && g++ < n) this.turn = (this.turn + 1) % n;
    }
    // 현재 차례가 뽑을 대상(다음 활성 플레이어)
    targetOf(turnIdx) {
      const n = this.players.length;
      let i = (turnIdx + 1) % n, g = 0;
      while (g++ < n) {
        const p = this.players[i];
        if (this.hands[p.id].length > 0 && i !== turnIdx) return i;
        i = (i + 1) % n;
      }
      return -1;
    }
    currentTargetIdx() { return this.targetOf(this.turn); }

    /* 현재 플레이어가 target 의 idx 번째 카드를 뽑음 */
    draw(idx) {
      if (this.loser) return { ok: false };
      const cur = this.players[this.turn];
      const tIdx = this.currentTargetIdx();
      if (tIdx < 0) return { ok: false };
      const tgt = this.players[tIdx];
      const thand = this.hands[tgt.id];
      if (idx < 0 || idx >= thand.length) idx = Math.floor(this.rng() * thand.length);
      const card = thand.splice(idx, 1)[0];
      this.hands[cur.id].push(card);
      const removed = this.removePairs(cur.id);
      const paired = removed.some(c => c.id === card.id);
      this.lastDraw = { byId: cur.id, fromId: tgt.id, card, paired, pairedCards: removed, seq: ++this._seq };
      this.log.push(`${cur.name} ← ${tgt.name} : ${Cards2.label(card)}${paired ? ' (짝!)' : ''}`);

      // 안전 처리
      if (this.hands[tgt.id].length === 0) tgt.safe = true;
      if (this.hands[cur.id].length === 0) cur.safe = true;

      this._checkEnd();
      if (!this.loser) { this.turn = (this.turn + 1) % this.players.length; this._ensureActiveTurn(); }
      return { ok: true, card, paired };
    }
    _checkEnd() {
      const act = this.activePlayers();
      if (act.length <= 1) {
        this.loser = act.length === 1 ? act[0].id : null;
      }
    }
    publicState(viewId) {
      return {
        players: this.players.map((p, i) => ({
          id: p.id, name: p.name, isBot: p.isBot, safe: p.safe,
          count: this.count(p.id), isTurn: i === this.turn,
          isTarget: i === this.currentTargetIdx(),
        })),
        turn: this.turn, turnId: this.players[this.turn].id,
        targetIdx: this.currentTargetIdx(),
        myHand: viewId ? this.sortedHand(viewId) : [],
        loser: this.loser, log: this.log.slice(-20),
        lastDraw: this.lastDraw ? { byId: this.lastDraw.byId, fromId: this.lastDraw.fromId, paired: this.lastDraw.paired, pairedCards: this.lastDraw.pairedCards, seq: this.lastDraw.seq } : null,
      };
    }
    handsMap() { const h = {}; this.players.forEach(p => h[p.id] = this.sortedHand(p.id)); return h; }
    sortedHand(pid) {
      const ord = (c) => c.suit === 'JOKER' ? 99 : Cards2.order(c.rank);
      return (this.hands[pid] || []).slice().sort((a, b) => ord(a) - ord(b) || (a.suit > b.suit ? 1 : -1));
    }
  }

  // node 에서는 require('./shared'...) 대신 전역 Cards 사용; 둘 다 대응
  const Cards2 = (typeof Cards !== 'undefined') ? Cards : (typeof require !== 'undefined' ? require('./_cards_shim.js') : null);

  if (typeof module !== 'undefined' && module.exports) { module.exports = { OldMaid }; return; }
  root.OldMaid = OldMaid;

  /* ════════════════════ UI (브라우저) ════════════════════ */
  if (typeof document === 'undefined') return;
  const $ = (s) => document.querySelector(s);
  const ME = 'me';
  const App2 = { mode: 'single', game: null, myId: ME, online: null, lastSeq: 0, isHost: false };
  window.App2 = App2;
  let busy = false, numPlayers = 4;

  function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function showGame() { $('#setup').classList.add('hidden'); $('#game').classList.add('show'); }
  App2.showGame = showGame;
  function nmIn(players, id) { const p = players.find(x => x.id === id); return p ? p.name : id; }

  /* 시작 — 싱글(봇) */
  function startSingle() {
    const players = [{ id: ME, name: '나', isBot: false }];
    const botNames = ['봇 가', '봇 나', '봇 다', '봇 라'];
    for (let i = 0; i < numPlayers - 1; i++) players.push({ id: 'b' + i, name: botNames[i], isBot: true });
    App2.mode = 'single'; App2.myId = ME; App2.game = new OldMaid({ players }); App2.lastSeq = 0; busy = false;
    showGame(); Sfx.unlock(); Sfx.deal(); render(); maybeBot();
  }

  /* 현재 뷰모델 (싱글=로컬엔진 / 온라인=수신상태+내손패) */
  function currentVM() {
    if (App2.mode === 'online') { const o = App2.online; if (!o) return null; return Object.assign({}, o.pub, { myHand: o.hand || [], myId: App2.myId }); }
    if (!App2.game) return null;
    const vm = App2.game.publicState(ME); vm.myId = ME; return vm;
  }

  function render() {
    const vm = currentVM(); if (!vm) return;
    const myId = vm.myId;
    if (!vm.lastDraw) App2.lastPair = null;

    // 상대 좌석 (정보 표시만 — 뽑기는 중앙에서)
    const opp = $('#opp'); opp.innerHTML = '';
    vm.players.forEach((p) => {
      if (p.id === myId) return;
      const seat = document.createElement('div');
      seat.className = 'seat' + (p.isTurn ? ' turn' : '') + (p.isTarget && !vm.loser ? ' target' : '');
      const fanN = Math.min(p.count, 8);
      let fan = '';
      for (let i = 0; i < fanN; i++) fan += `<span class="mb"></span>`;
      seat.innerHTML = `<div class="snm">${p.safe ? '✅ ' : ''}${esc(p.name)}${p.isTurn ? ' <span class="tn">●</span>' : ''}</div>
        <div class="fan">${fan || '<span class="done">안전</span>'}</div>
        <div class="scnt">${p.count > 0 ? p.count + '장' : ''}</div>`;
      opp.appendChild(seat);
    });

    // 중앙 무대 — 뽑을 대상 카드 + 버린 짝
    const tIdx = vm.targetIdx;
    const tlab = $('#target-lab'), tcards = $('#target-cards');
    tcards.innerHTML = '';
    const isMyPick = vm.turnId === myId && !vm.loser;
    $('#stage').classList.toggle('mine', isMyPick);
    if (!vm.loser && tIdx >= 0) {
      const tp = vm.players[tIdx];
      tlab.innerHTML = isMyPick
        ? `👆 <b>${esc(tp.name)}</b> 에게서 한 장 뽑기`
        : `${esc(nmIn(vm.players, vm.turnId))} → <b>${esc(tp.name)}</b>`;
      for (let i = 0; i < tp.count; i++) {
        const el = Cards.el(null, { faceDown: true }); el.classList.add('fd');
        if (i > 0) el.style.marginLeft = 'calc(var(--card-w) * -0.5)';
        if (isMyPick) { el.classList.add('pickable'); el.addEventListener('click', () => humanDraw(i)); }
        tcards.appendChild(el);
      }
    } else { tlab.textContent = vm.loser ? '게임 종료' : ''; }

    // 버린 짝 (어떤 세트가 나갔는지)
    if (vm.lastDraw && vm.lastDraw.pairedCards && vm.lastDraw.pairedCards.length) App2.lastPair = vm.lastDraw.pairedCards;
    const dcards = $('#discard-cards'); dcards.innerHTML = '';
    (App2.lastPair || []).forEach(c => dcards.appendChild(Cards.el(c)));
    $('#discard-box').style.visibility = (App2.lastPair && App2.lastPair.length) ? 'visible' : 'hidden';

    // 상태
    const me = vm.players.find(p => p.id === myId) || { count: 0, safe: false };
    if (vm.loser) {
      $('#status').innerHTML = vm.loser === myId
        ? '내가 <b style="color:var(--danger)">도둑</b>... 패배!'
        : `<b>${esc(nmIn(vm.players, vm.loser))}</b> 가 도둑! 나는 안전 🎉`;
    } else if (me.safe) {
      $('#status').innerHTML = '나는 <b style="color:var(--ok)">안전</b> — 도둑이 돌아다니는 중…';
    } else if (isMyPick) {
      $('#status').innerHTML = '내 차례 — 위 카드 중 하나를 골라 뽑으세요';
    } else {
      $('#status').innerHTML = `<b>${esc(nmIn(vm.players, vm.turnId))}</b> 차례…`;
    }

    const hand = $('#myhand'); hand.innerHTML = '';
    (vm.myHand || []).forEach(c => hand.appendChild(Cards.el(c)));
    $('#mycount').textContent = me.count > 0 ? `${me.count}장` : '안전';
    $('#logbox').innerHTML = (vm.log || []).slice().reverse().map(l => `<div class="li">${esc(l)}</div>`).join('');

    if (vm.loser) endGame(vm);
    else { const r = $('#result'); if (r) r.classList.remove('show'); }
  }
  function pairLabel(cards) { return (cards || []).map(c => Cards.label(c)).join(' '); }

  /* 뽑기 */
  function humanDraw(idx) {
    if (busy) return;
    const vm = currentVM(); if (!vm || vm.loser) return;
    if (vm.turnId !== vm.myId) return;
    if (App2.mode === 'online') { Sfx.unlock(); RT.sendMove({ type: 'draw', idx }); return; }
    doDrawSingle(idx);
  }
  function doDrawSingle(idx) {
    busy = true;
    const r = App2.game.draw(idx);
    if (!r.ok) { busy = false; return; }
    const ld = App2.game.lastDraw;
    Sfx.flip();
    const pl = ld.paired ? ` · <span style="color:var(--ok)">${esc(pairLabel(ld.pairedCards))} 짝! 버림</span>` : '';
    Fx.toast(`<b>${esc(App2.game.name(ld.byId))}</b> 가 뽑음<br>${Cards.label(ld.card)}${pl}`, ld.paired ? 1300 : 850);
    if (ld.paired) { Sfx.pair(); Fx.sparkle('white'); }
    setTimeout(() => { render(); busy = false; maybeBot(); }, 700);
  }

  function maybeBot() {
    if (App2.mode !== 'single' || App2.game.loser || busy) return;
    const g = App2.game;
    if (g.players[g.turn].id === ME) return;
    busy = true;
    setTimeout(() => {
      if (g.loser) { busy = false; return; }
      const tIdx = g.currentTargetIdx();
      const tCount = tIdx >= 0 ? g.count(g.players[tIdx].id) : 0;
      g.draw(tCount > 0 ? Math.floor(Math.random() * tCount) : 0);
      const ld = g.lastDraw;
      if (ld) { ld.paired ? Sfx.pair() : Sfx.flip(); Fx.toast(`<b>${esc(g.name(ld.byId))}</b> ← ${esc(g.name(ld.fromId))}${ld.paired ? ' · <span style="color:var(--ok)">' + esc(pairLabel(ld.pairedCards)) + ' 버림!</span>' : ''}`, ld.paired ? 1000 : 700); }
      render(); busy = false;
      setTimeout(maybeBot, 350);
    }, 750);
  }

  /* 온라인 렌더 진입점 (oldmaid-rt.js 가 호출) */
  App2.renderOnline = function (pub, hand, myId) {
    App2.online = { pub, hand }; App2.myId = myId;
    render();
    const ld = pub.lastDraw;
    if (ld && ld.seq && ld.seq !== App2.lastSeq) {
      App2.lastSeq = ld.seq;
      ld.paired ? Sfx.pair() : Sfx.flip();
      Fx.toast(`<b>${esc(nmIn(pub.players, ld.byId))}</b> ← ${esc(nmIn(pub.players, ld.fromId))}${ld.paired ? ' · <span style="color:var(--ok)">' + esc(pairLabel(ld.pairedCards)) + ' 버림!</span>' : ''}`, ld.paired ? 1000 : 800);
      if (ld.paired) Fx.sparkle('white');
    }
  };

  function endGame(vm) {
    const won = vm.loser !== vm.myId;
    const r = $('#result'); if (r.classList.contains('show')) return;
    $('#result-big').textContent = won ? '안전!' : '도둑...';
    $('#result-big').className = 'big ' + (won ? 'winc' : 'losec');
    $('#result-sub').innerHTML = won
      ? `${esc(nmIn(vm.players, vm.loser))} 가 마지막 조커를 들고 패배했어요.`
      : '마지막까지 조커가 내 손에 남았어요.';
    r.classList.add('show');
    if (won) { Sfx.win(); Fx.sparkle('gold'); } else { Sfx.lose(); Fx.flash('bad'); }
  }

  function newGame() {
    $('#result').classList.remove('show');
    if (App2.mode === 'online') { if (App2.isHost) RT.rematch(); else Fx.toast('마스터만 새 게임을 시작할 수 있어요', 1000); return; }
    App2.game.reset(); App2.lastSeq = 0; busy = false; render(); maybeBot();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#pstep').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      numPlayers = Math.min(5, Math.max(2, numPlayers + (+b.dataset.d)));
      $('#pval').textContent = numPlayers;
    });
    $('#btn-start').addEventListener('click', startSingle);
    $('#btn-new').addEventListener('click', newGame);
    $('#result-new').addEventListener('click', newGame);
    $('#logt').addEventListener('click', () => $('#logbox').classList.toggle('show'));
    // 온라인 버튼 (oldmaid-rt.js 가 있을 때만)
    if (window.RT) {
      RT.initUI && RT.initUI();
      const h = $('#btn-host'), j = $('#btn-join');
      if (h) h.addEventListener('click', () => RT.host());
      if (j) j.addEventListener('click', () => {
        const room = ($('#rt-room').value || '').trim();
        const name = ($('#rt-myname').value || '').trim() || '플레이어';
        if (!room) { Fx.toast('방 코드를 입력하세요', 900); return; }
        RT.join(room, name);
      });
    }
  });

})(typeof window !== 'undefined' ? window : globalThis);
