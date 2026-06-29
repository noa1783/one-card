'use strict';
/* ═══════════════════════════════════════════════════════════════
   솔리테어 (클론다이크) · solitaire.js
   탭으로 이동 · 되돌리기 · 자동완성. 4개 무늬 A→K 완성 시 승리.
   ═══════════════════════════════════════════════════════════════ */
(function (root) {

  const C = (typeof Cards !== 'undefined') ? Cards : null;
  const SUITS = ['S', 'H', 'D', 'C'];
  const isRed = (c) => c.suit === 'H' || c.suit === 'D';
  const ord = (c) => C.order(c.rank);

  class Solitaire {
    constructor(opt = {}, rng) { this.rng = rng || Math.random; this.drawCount = opt.drawCount || 1; this.reset(); }
    reset() {
      const deck = C.shuffle(C.buildDeck(), this.rng);
      this.tab = [[], [], [], [], [], [], []];
      for (let p = 0; p < 7; p++)
        for (let k = 0; k <= p; k++)
          this.tab[p].push({ c: deck.pop(), up: k === p });
      this.stock = deck.slice();      // 나머지 24장 (뒤집힌 상태)
      this.waste = [];
      this.found = { S: [], H: [], D: [], C: [] };
      this.moves = 0; this.history = [];
      return this;
    }
    _snap() {
      return JSON.stringify({ tab: this.tab, stock: this.stock, waste: this.waste, found: this.found, moves: this.moves });
    }
    _push() { this.history.push(this._snap()); if (this.history.length > 200) this.history.shift(); }
    undo() {
      if (!this.history.length) return false;
      const s = JSON.parse(this.history.pop());
      this.tab = s.tab; this.stock = s.stock; this.waste = s.waste; this.found = s.found; this.moves = s.moves;
      return true;
    }

    topTab(p) { const a = this.tab[p]; return a.length ? a[a.length - 1] : null; }
    topWaste() { return this.waste.length ? this.waste[this.waste.length - 1] : null; }
    topFound(suit) { const a = this.found[suit]; return a.length ? a[a.length - 1] : null; }

    /* ── 스톡 ── */
    drawStock() {
      this._push();
      if (this.stock.length) {
        for (let i = 0; i < this.drawCount && this.stock.length; i++) this.waste.push(this.stock.pop());
      } else if (this.waste.length) {
        this.stock = this.waste.reverse(); this.waste = [];
      } else { this.history.pop(); return false; }
      this.moves++; return true;
    }

    /* ── 파운데이션 가능? ── */
    canFound(card) {
      const f = this.found[card.suit];
      if (!f.length) return card.rank === 'A';
      return ord(card) === ord(f[f.length - 1]) + 1;
    }
    /* ── 태블로 그룹이 다른 더미 위에 놓일 수 있나 ── */
    canStack(movingFirst, destPile) {
      const t = this.topTab(destPile);
      if (!t) return movingFirst.rank === 'K';
      if (!t.up) return false;
      return (isRed(movingFirst) !== isRed(t.c ? t.c : t)) && ord(movingFirst) === ord(t.c) - 1;
    }
    /* idx..end 가 유효한 내림차순 교대색 묶음인가 */
    validGroup(p, idx) {
      const a = this.tab[p];
      if (idx < 0 || idx >= a.length || !a[idx].up) return false;
      for (let i = idx; i < a.length - 1; i++) {
        const cur = a[i].c, nxt = a[i + 1].c;
        if (!a[i + 1].up) return false;
        if (!(isRed(cur) !== isRed(nxt) && ord(cur) === ord(nxt) + 1)) return false;
      }
      return true;
    }

    _flip(p) { const t = this.topTab(p); if (t && !t.up) t.up = true; }

    /* ── 이동들 (성공 시 true) ── */
    wasteToFound() {
      const c = this.topWaste(); if (!c || !this.canFound(c)) return false;
      this._push(); this.found[c.suit].push(this.waste.pop()); this.moves++; return true;
    }
    wasteToTab(destPile) {
      const c = this.topWaste(); if (!c || !this.canStack(c, destPile)) return false;
      this._push(); this.tab[destPile].push({ c: this.waste.pop(), up: true }); this.moves++; return true;
    }
    tabToFound(p) {
      const t = this.topTab(p); if (!t || !t.up || !this.canFound(t.c)) return false;
      this._push(); this.found[t.c.suit].push(this.tab[p].pop().c); this._flip(p); this.moves++; return true;
    }
    tabToTab(srcP, idx, destP) {
      if (srcP === destP || !this.validGroup(srcP, idx)) return false;
      const group = this.tab[srcP].slice(idx);
      if (!this.canStack(group[0].c, destP)) return false;
      this._push();
      this.tab[srcP].splice(idx);
      group.forEach(x => this.tab[destP].push(x));
      this._flip(srcP); this.moves++; return true;
    }
    foundToTab(suit, destP) {
      const c = this.topFound(suit); if (!c) return false;
      if (!this.canStack(c, destP)) return false;
      this._push(); this.tab[destP].push({ c: this.found[suit].pop(), up: true }); this.moves++; return true;
    }

    /* 자동: 올릴 수 있는 카드 1장 파운데이션으로 (반복 호출용) */
    autoOnce() {
      const w = this.topWaste(); if (w && this.canFound(w)) { return this.wasteToFound(); }
      for (let p = 0; p < 7; p++) { const t = this.topTab(p); if (t && t.up && this.canFound(t.c)) return this.tabToFound(p); }
      return false;
    }
    foundCount() { return SUITS.reduce((s, su) => s + this.found[su].length, 0); }
    isWon() { return this.foundCount() === 52; }
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { Solitaire }; return; }
  root.Solitaire = Solitaire;

  /* ════════════════════ UI ════════════════════ */
  if (typeof document === 'undefined') return;
  const $ = (s) => document.querySelector(s);
  let game = null, sel = null, won = false;

  function init() { game = new Solitaire(); sel = null; won = false; Sfx.unlock(); render(); }

  function clearSel() { sel = null; }
  function setSel(s) { sel = s; }

  // 선택된 소스에서 목적지(dest)로 이동 시도
  function tryMove(dest) {
    if (!sel) return false;
    let ok = false;
    if (dest.type === 'found') {
      if (sel.type === 'waste') ok = game.wasteToFound();
      else if (sel.type === 'tab') { const a = game.tab[sel.pile]; if (sel.index === a.length - 1) ok = game.tabToFound(sel.pile); }
    } else if (dest.type === 'tab') {
      if (sel.type === 'waste') ok = game.wasteToTab(dest.pile);
      else if (sel.type === 'tab') ok = game.tabToTab(sel.pile, sel.index, dest.pile);
      else if (sel.type === 'found') ok = game.foundToTab(sel.suit, dest.pile);
    }
    if (ok) { Sfx.place(); afterMove(); } else { Sfx.invalid(); }
    clearSel(); render();
    return ok;
  }

  function afterMove() {
    if (game.isWon()) { won = true; }
  }

  // 클릭 핸들러들
  function onStock() { clearSel(); if (game.drawStock()) Sfx.draw(); render(); }
  function onWaste() {
    if (won) return;
    const c = game.topWaste(); if (!c) return;
    if (sel && sel.type === 'waste') { clearSel(); render(); return; }
    if (sel) { tryMove({ type: 'waste-as-dest' }); return; } // waste는 목적지 아님 → 무효
    setSel({ type: 'waste' }); render();
  }
  function onFound(suit) {
    if (won) return;
    if (sel) { tryMove({ type: 'found', suit }); return; }
    // 선택 없을 때 파운데이션 카드를 빼서 옮기고 싶다면 선택
    if (game.topFound(suit)) { setSel({ type: 'found', suit }); render(); }
  }
  function onTabCard(pile, index) {
    if (won) return;
    const a = game.tab[pile];
    const card = a[index];
    if (sel) {
      // 목적지로 시도 (그 더미로)
      tryMove({ type: 'tab', pile });
      return;
    }
    if (!card.up) {
      // 뒤집힌 카드: 맨 위면 자동으로 뒤집기는 안 함(이동으로만). 무시
      return;
    }
    if (game.validGroup(pile, index)) { setSel({ type: 'tab', pile, index }); render(); }
    else Sfx.invalid();
  }
  function onTabEmpty(pile) { if (won) return; if (sel) tryMove({ type: 'tab', pile }); }

  function autoComplete() {
    if (won) return;
    let n = 0;
    const step = () => {
      if (game.autoOnce()) { Sfx.foundation(); n++; render(); if (game.isWon()) { won = true; render(); finish(); return; } setTimeout(step, 90); }
      else if (n === 0) Fx.toast('올릴 수 있는 카드가 없어요', 900);
    };
    step();
  }

  /* ── 렌더 ── */
  function render() {
    $('#moves').textContent = game.moves;
    $('#found-count').textContent = game.foundCount();

    // 스톡
    const stockEl = $('#stock'); stockEl.innerHTML = '';
    if (game.stock.length) { const b = Cards.el(null, { faceDown: true, onClick: onStock }); stockEl.appendChild(b); }
    else { const e = document.createElement('div'); e.className = 'card empty recycle'; e.textContent = '↻'; e.onclick = onStock; stockEl.appendChild(e); }
    $('#stock-n').textContent = game.stock.length;

    // 웨이스트
    const wEl = $('#waste'); wEl.innerHTML = '';
    const wc = game.topWaste();
    if (wc) { const el = Cards.el(wc, { onClick: onWaste }); if (sel && sel.type === 'waste') el.classList.add('sel'); wEl.appendChild(el); }
    else { const e = document.createElement('div'); e.className = 'card empty'; wEl.appendChild(e); }

    // 파운데이션
    SUITS.forEach(su => {
      const fEl = $('#found-' + su); fEl.innerHTML = '';
      const top = game.topFound(su);
      if (top) { const el = Cards.el(top, { onClick: () => onFound(su) }); if (sel && sel.type === 'found' && sel.suit === su) el.classList.add('sel'); fEl.appendChild(el); }
      else { const e = document.createElement('div'); e.className = 'card empty found-slot'; e.dataset.suit = su; e.textContent = Cards.SUIT_SYM[su]; e.onclick = () => onFound(su); fEl.appendChild(e); }
    });

    // 태블로
    const tEl = $('#tableau'); tEl.innerHTML = '';
    game.tab.forEach((pile, p) => {
      const col = document.createElement('div'); col.className = 'col';
      if (!pile.length) {
        const e = document.createElement('div'); e.className = 'card empty'; e.onclick = () => onTabEmpty(p); col.appendChild(e);
      } else {
        pile.forEach((node, i) => {
          const el = Cards.el(node.c, { faceDown: !node.up });
          el.classList.add('stacked');
          el.style.marginTop = i === 0 ? '0' : (node.up ? 'calc(var(--card-h) * -0.72)' : 'calc(var(--card-h) * -0.86)');
          if (node.up) el.addEventListener('click', () => onTabCard(p, i));
          // 선택 강조 (선택된 묶음 전체)
          if (sel && sel.type === 'tab' && sel.pile === p && i >= sel.index) el.classList.add('sel');
          col.appendChild(el);
        });
      }
      col.addEventListener('click', (e) => { if (e.target === col && sel) onTabEmpty(p); });
      tEl.appendChild(col);
    });

    $('#btn-undo').disabled = game.history.length === 0;
    if (won) finish();
  }

  function finish() {
    const r = $('#result'); if (r.classList.contains('show')) return;
    $('#result-big').textContent = '클리어!';
    $('#result-big').className = 'big winc';
    $('#result-sub').textContent = `${game.moves}수 만에 완성했어요.`;
    r.classList.add('show');
    Sfx.win(); Fx.sparkle('gold'); Fx.flash('gold');
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    $('#btn-new').addEventListener('click', () => { $('#result').classList.remove('show'); init(); });
    $('#result-new').addEventListener('click', () => { $('#result').classList.remove('show'); init(); });
    $('#btn-undo').addEventListener('click', () => { if (game.undo()) { Sfx.flip(); clearSel(); render(); } });
    $('#btn-auto').addEventListener('click', autoComplete);
    // 빈 곳 탭하면 선택 해제
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { clearSel(); render(); } });
  });

})(typeof window !== 'undefined' ? window : globalThis);
