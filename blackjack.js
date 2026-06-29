'use strict';
/* ═══════════════════════════════════════════════════════════════
   블랙잭 · blackjack.js
   딜러 대 플레이어. 6덱 슈, 칩 베팅, 블랙잭 3:2, 더블다운.
   딜러는 17 이상에서 스탠드(소프트17도 스탠드).
   ═══════════════════════════════════════════════════════════════ */
(function (root) {

  const C = (typeof Cards !== 'undefined') ? Cards : null;

  function handValue(cards) {
    let total = 0, elevens = 0;
    for (const c of cards) { total += C.bjValue(c.rank); if (c.rank === 'A') elevens++; }
    while (total > 21 && elevens > 0) { total -= 10; elevens--; }
    return { total, soft: elevens > 0 };
  }
  const isBJ = (cards) => cards.length === 2 && handValue(cards).total === 21;

  class Blackjack {
    constructor(opt = {}, rng) {
      this.rng = rng || Math.random;
      this.chips = opt.chips || 1000;
      this.decks = opt.decks || 6;
      this.shoe = []; this._newShoe();
      this.phase = 'bet';       // bet | player | dealer | done
      this.bet = 0; this.player = []; this.dealer = [];
      this.outcome = null;      // {result:'win'|'lose'|'push'|'bj', delta, text}
    }
    _newShoe() {
      const d = [];
      for (let i = 0; i < this.decks; i++) C.buildDeck().forEach(c => d.push({ ...c, id: c.id + '_' + i }));
      this.shoe = C.shuffle(d, this.rng);
    }
    _draw() { if (this.shoe.length < 15) this._newShoe(); return this.shoe.pop(); }

    value(who) { return handValue(who === 'dealer' ? this.dealer : this.player); }

    deal(bet) {
      if (this.phase !== 'bet' && this.phase !== 'done') return { ok: false, error: '진행 중' };
      bet = Math.max(1, Math.min(bet, this.chips));
      if (this.chips < bet) return { ok: false, error: '칩 부족' };
      this.bet = bet; this.chips -= bet;
      this.player = [this._draw(), this._draw()];
      this.dealer = [this._draw(), this._draw()];
      this.outcome = null; this.phase = 'player'; this.doubled = false;
      // 내추럴 처리
      if (isBJ(this.player) || isBJ(this.dealer)) { this._dealerReveal(true); }
      return { ok: true };
    }
    hit() {
      if (this.phase !== 'player') return { ok: false };
      this.player.push(this._draw());
      if (this.value('player').total > 21) this._settle();   // 버스트
      return { ok: true };
    }
    canDouble() { return this.phase === 'player' && this.player.length === 2 && this.chips >= this.bet; }
    double() {
      if (!this.canDouble()) return { ok: false };
      this.chips -= this.bet; this.bet *= 2; this.doubled = true;
      this.player.push(this._draw());
      if (this.value('player').total > 21) this._settle();
      else this._dealerReveal(false);
      return { ok: true };
    }
    stand() {
      if (this.phase !== 'player') return { ok: false };
      this._dealerReveal(false);
      return { ok: true };
    }
    _dealerReveal(naturalCheck) {
      this.phase = 'dealer';
      // 딜러 17까지 (플레이어가 버스트가 아니면)
      if (this.value('player').total <= 21) {
        while (this.value('dealer').total < 17) this.dealer.push(this._draw());
      }
      this._settle();
    }
    _settle() {
      const p = this.value('player').total, d = this.value('dealer').total;
      const pBJ = isBJ(this.player), dBJ = isBJ(this.dealer);
      let result, delta, text;
      if (pBJ && dBJ) { result = 'push'; delta = this.bet; text = '둘 다 블랙잭 — 무승부'; }
      else if (pBJ) { result = 'bj'; delta = Math.floor(this.bet * 2.5); text = '블랙잭! 3:2 승리'; }
      else if (dBJ) { result = 'lose'; delta = 0; text = '딜러 블랙잭 — 패배'; }
      else if (p > 21) { result = 'lose'; delta = 0; text = '버스트 — 패배'; }
      else if (d > 21) { result = 'win'; delta = this.bet * 2; text = '딜러 버스트 — 승리'; }
      else if (p > d) { result = 'win'; delta = this.bet * 2; text = `${p} vs ${d} — 승리`; }
      else if (p < d) { result = 'lose'; delta = 0; text = `${p} vs ${d} — 패배`; }
      else { result = 'push'; delta = this.bet; text = `${p} vs ${d} — 무승부`; }
      this.chips += delta;
      const net = delta - this.bet;
      this.outcome = { result, delta, net, text, p, d, pBJ, dBJ };
      this.phase = 'done';
    }
    publicState(hideHole) {
      const hole = (this.phase === 'player') && hideHole !== false;
      return {
        chips: this.chips, bet: this.bet, phase: this.phase,
        player: this.player.slice(), playerVal: this.value('player'),
        dealer: this.dealer.slice(), dealerVal: this.value('dealer'),
        dealerShown: hole && this.dealer.length ? [this.dealer[0]] : this.dealer.slice(),
        dealerShownVal: hole && this.dealer.length ? handValue([this.dealer[0]]) : this.value('dealer'),
        hole, outcome: this.outcome, canDouble: this.canDouble(),
      };
    }
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { Blackjack, handValue, isBJ }; return; }
  root.Blackjack = Blackjack;

  /* ════════════════════ UI ════════════════════ */
  if (typeof document === 'undefined') return;
  const $ = (s) => document.querySelector(s);
  let game = null, bet = 100, busy = false;

  function init() {
    game = new Blackjack({ chips: 1000 });
    render();
  }
  function clampBet() { bet = Math.max(10, Math.min(bet, game.chips)); if (game.chips <= 0) bet = 0; }

  function render() {
    const st = game.publicState();
    $('#chips').textContent = st.chips.toLocaleString();

    // 딜러
    const dealEl = $('#dealer-cards'); dealEl.innerHTML = '';
    if (st.phase === 'bet') { dealEl.innerHTML = '<div class="placeholder">딜러</div>'; $('#dealer-val').textContent = ''; }
    else {
      st.dealer.forEach((c, i) => {
        const faceDown = st.hole && i === 1;
        dealEl.appendChild(Cards.el(c, { faceDown }));
      });
      $('#dealer-val').textContent = st.hole ? `${st.dealerShownVal.total} + ?` : valText(st.dealerVal);
    }

    // 플레이어
    const pEl = $('#player-cards'); pEl.innerHTML = '';
    if (st.phase === 'bet') { pEl.innerHTML = '<div class="placeholder">플레이어</div>'; $('#player-val').textContent = ''; }
    else { st.player.forEach(c => pEl.appendChild(Cards.el(c))); $('#player-val').textContent = valText(st.playerVal); }

    // 베팅 영역 / 액션 영역
    const betArea = $('#bet-area'), actArea = $('#act-area');
    if (st.phase === 'bet' || st.phase === 'done') {
      clampBet();
      betArea.style.display = ''; actArea.style.display = 'none';
      $('#betval').textContent = bet.toLocaleString();
      $('#btn-deal').disabled = game.chips < 10;
      $('#bet-hint').textContent = st.outcome ? st.outcome.text : (game.chips < 10 ? '칩이 부족해요 — 리바이' : '베팅하고 딜!');
      $('#rebuy').style.display = game.chips < 10 ? '' : 'none';
    } else {
      betArea.style.display = 'none'; actArea.style.display = '';
      $('#btn-double').disabled = !st.canDouble;
      $('#btn-double').textContent = st.canDouble ? `더블 (+${game.bet})` : '더블';
    }
    $('#bet-badge').textContent = st.bet ? `베팅 ${st.bet.toLocaleString()}` : '';
  }
  function valText(v) { return v.soft ? `${v.total} (소프트)` : `${v.total}`; }

  function deal() {
    if (busy) return; clampBet(); if (bet < 10) return;
    Sfx.chip(); const r = game.deal(bet);
    if (!r.ok) { Fx.toast(r.error); return; }
    Sfx.deal();
    render();
    if (game.phase === 'done') finishRound();   // 내추럴
  }
  function act(fn, snd) {
    if (busy || game.phase !== 'player') return;
    if (snd) snd();
    fn();
    render();
    if (game.phase === 'dealer' || game.phase === 'done') {
      // 딜러 연출은 즉시 정산되어 있음 — 결과 표시
      if (game.phase === 'done') finishRound();
    }
  }
  function finishRound() {
    const o = game.outcome;
    setTimeout(() => {
      if (o.result === 'win' || o.result === 'bj') {
        if (o.result === 'bj') { Sfx.blackjack(); } else Sfx.win();
        Fx.flash('good'); Fx.sparkle('gold');
        Fx.toast(`<b style="color:var(--ok)">+${o.net.toLocaleString()}</b><br>${o.text}`, 1500);
      } else if (o.result === 'push') {
        Fx.toast(o.text, 1300);
      } else {
        Sfx.lose(); Fx.flash('bad');
        Fx.toast(`<b style="color:var(--danger)">${o.net.toLocaleString()}</b><br>${o.text}`, 1500);
      }
      render();
    }, 350);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    $('#betstep').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      bet = bet + (+b.dataset.d); clampBet(); Sfx.chip(); render();
    });
    $('#bet-all').addEventListener('click', () => { bet = game.chips; clampBet(); Sfx.chip(); render(); });
    $('#btn-deal').addEventListener('click', deal);
    $('#btn-hit').addEventListener('click', () => act(() => game.hit(), Sfx.deal));
    $('#btn-stand').addEventListener('click', () => act(() => game.stand(), Sfx.flip));
    $('#btn-double').addEventListener('click', () => { if (game.canDouble()) { Sfx.chip(); act(() => game.double()); } });
    $('#rebuy').addEventListener('click', () => { game.chips += 1000; bet = 100; Fx.toast('리바이 +1,000'); render(); });
  });

})(typeof window !== 'undefined' ? window : globalThis);
