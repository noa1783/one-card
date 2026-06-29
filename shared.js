'use strict';
/* ═══════════════════════════════════════════════════════════════
   카드 게임 공용 · shared.js
   window.Cards  덱/카드 헬퍼 + 카드 DOM 렌더
   window.Sfx    Web Audio 효과음
   window.Fx     화면 이펙트 + 토스트
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: '스페이드', H: '하트', D: '다이아', C: '클로버' };
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRedSuit = (s) => s === 'H' || s === 'D';

  /* ── Cards ── */
  const Cards = {
    SUITS, RANKS, SUIT_SYM, SUIT_NAME, isRedSuit,
    buildDeck(opt = {}) {
      const d = []; let n = 0;
      for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, id: 'c' + (n++) });
      if (opt.jokers) for (let i = 0; i < opt.jokers; i++)
        d.push({ suit: 'JOKER', rank: i === 0 ? 'BLACK' : 'COLOR', id: 'c' + (n++) });
      return d;
    },
    shuffle(a, rng) {
      rng = rng || Math.random;
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
    isRed: (c) => c.suit === 'JOKER' ? c.rank === 'COLOR' : isRedSuit(c.suit),
    isJoker: (c) => c.suit === 'JOKER',
    // 블랙잭 값(에이스 11 우선; UI에서 소프트 조정)
    bjValue: (r) => r === 'A' ? 11 : (['J', 'Q', 'K', '10'].includes(r) ? 10 : +r),
    // 클론다이크 순위 A=1 … K=13
    order: (r) => RANKS.indexOf(r) + 1,
    label(c) {
      if (!c) return '-';
      if (c.suit === 'JOKER') return c.rank === 'BLACK' ? '블랙조커' : '컬러조커';
      return SUIT_SYM[c.suit] + c.rank;
    },
    /* 카드 DOM. opt:{faceDown, selectable, onClick, mini} */
    el(card, opt = {}) {
      const el = document.createElement('div');
      el.className = 'card';
      if (opt.faceDown || !card) {
        el.classList.add('back');
        if (opt.onClick) el.addEventListener('click', opt.onClick);
        return el;
      }
      const red = Cards.isRed(card);
      el.classList.add(red ? 'red' : 'black');
      if (card.suit === 'JOKER') {
        el.classList.add('joker');
        el.innerHTML = `<div class="corner tl"><span class="r">JKR</span></div>
          <div class="pip"><span class="jk">JOKER</span></div>
          <div class="corner br"><span class="r">JKR</span></div>`;
      } else {
        const sym = SUIT_SYM[card.suit];
        el.innerHTML = `<div class="corner tl"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>
          <div class="pip"><span class="psym">${sym}</span><span class="prank">${card.rank}</span></div>
          <div class="corner br"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>`;
      }
      if (opt.onClick) el.addEventListener('click', opt.onClick);
      return el;
    },
  };

  /* ── Sfx (Web Audio 합성) ── */
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('cardgames_muted') === '1'; } catch (e) {}
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    }
    return ctx;
  }
  function tone(o) {
    if (muted) return; const c = ac(); if (!c) return;
    const t = c.currentTime + (o.when || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t + (o.dur || .15));
    const g = c.createGain(); const peak = o.gain == null ? .18 : o.gain;
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak, t + (o.attack || .005));
    g.gain.exponentialRampToValueAtTime(.0001, t + (o.dur || .15) + (o.release || .08));
    osc.connect(g).connect(master); osc.start(t); osc.stop(t + (o.dur || .15) + .12);
  }
  function noise(o) {
    if (muted) return; const c = ac(); if (!c) return;
    const t = c.currentTime + (o.when || 0); const dur = o.dur || .12;
    const buf = c.createBuffer(1, Math.max(1, (c.sampleRate * dur) | 0), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = o.filter || 'highpass'; f.frequency.value = o.freq || 1500; if (o.q) f.Q.value = o.q;
    const g = c.createGain(); g.gain.setValueAtTime(o.gain == null ? .2 : o.gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + dur + .05);
  }
  const Sfx = {
    unlock() { const c = ac(); if (c && c.state === 'suspended') c.resume(); },
    isMuted: () => muted,
    setMuted(m) { muted = m; try { localStorage.setItem('cardgames_muted', m ? '1' : '0'); } catch (e) {} },
    deal() { noise({ dur: .05, gain: .09, freq: 2400 }); tone({ freq: 480, slideTo: 360, type: 'triangle', dur: .05, gain: .06 }); },
    flip() { noise({ dur: .04, gain: .08, freq: 3000 }); tone({ freq: 600, dur: .04, gain: .05, type: 'triangle' }); },
    place() { noise({ dur: .05, gain: .10, freq: 1800 }); tone({ freq: 320, slideTo: 220, type: 'sine', dur: .06, gain: .07 }); },
    invalid() { tone({ freq: 180, type: 'square', dur: .14, gain: .14 }); tone({ freq: 130, type: 'square', dur: .16, gain: .12, when: .04 }); },
    foundation() { [659, 880, 1175].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: .12, gain: .12, when: i * .05 })); },
    pair() { tone({ freq: 880, type: 'triangle', dur: .1, gain: .12 }); tone({ freq: 1320, type: 'sine', dur: .14, gain: .09, when: .05 }); },
    chip() { tone({ freq: 1400, type: 'square', dur: .04, gain: .1 }); tone({ freq: 2100, type: 'square', dur: .05, gain: .07, when: .02 }); },
    draw() { noise({ dur: .05, gain: .08, freq: 3200 }); tone({ freq: 280, dur: .04, gain: .05, type: 'triangle' }); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: .16, gain: .18, when: i * .12 })); [784, 988, 1175].forEach(f => tone({ freq: f, type: 'sine', dur: .5, gain: .12, when: .48 })); },
    lose() { tone({ freq: 392, slideTo: 130, type: 'sawtooth', dur: .5, gain: .2 }); noise({ dur: .4, gain: .1, filter: 'lowpass', freq: 700, when: .05 }); },
    blackjack() { [659, 988, 1319, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: .14, gain: .16, when: i * .07 })); },
  };

  /* ── Fx (화면) ── */
  function ensure(id, cls) { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; if (cls) e.className = cls; document.body.appendChild(e); } return e; }
  const Fx = {
    flash(kind) { const el = ensure('fx-flash'); el.className = ''; void el.offsetWidth; el.classList.add(kind); },
    sparkle(kind, x, y) {
      const layer = ensure('fx-sparkle'); const cx = x == null ? innerWidth / 2 : x, cy = y == null ? innerHeight * .4 : y;
      const chars = kind === 'gold' ? ['✦', '✧', '★', '◆', '✺'] : ['✦', '✧'];
      const n = kind === 'gold' ? 16 : 7;
      for (let i = 0; i < n; i++) {
        const s = document.createElement('span'); s.className = 'spk'; s.textContent = chars[i % chars.length];
        const ang = Math.PI * 2 * i / n + Math.random() * .5, dist = 80 + Math.random() * 150;
        s.style.left = cx + 'px'; s.style.top = cy + 'px';
        s.style.setProperty('--dx', Math.cos(ang) * dist + 'px'); s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        if (kind === 'gold') s.style.color = `hsl(${Math.random() * 360},90%,65%)`;
        layer.appendChild(s); setTimeout(() => s.remove(), 900);
      }
    },
    toast(html, ms) {
      const t = ensure('toast', 'toast'); t.innerHTML = html; t.classList.add('show');
      clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), ms || 1200);
    },
  };

  // 첫 동작에서 오디오 잠금 해제
  document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
  document.addEventListener('keydown', () => Sfx.unlock(), { once: true });

  // 음소거 버튼 자동 연결 (#btn-mute 있으면)
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btn-mute'); if (!b) return;
    const sync = () => { b.textContent = Sfx.isMuted() ? '🔇' : '🔊'; b.title = Sfx.isMuted() ? '소리 켜기' : '소리 끄기'; };
    sync(); b.addEventListener('click', () => { Sfx.unlock(); Sfx.setMuted(!Sfx.isMuted()); sync(); });
  });

  window.Cards = Cards; window.Sfx = Sfx; window.Fx = Fx;
})();
