'use strict';
/* ═══════════════════════════════════════════════════════════════
   원카드 · effects.js  —  효과음(Web Audio 합성) + 화면 이펙트
   음원 파일 없이 즉석 합성 → 오프라인/배포 모두 OK.
   App.render() 가 매 렌더마다 Effects.onRender(vm) 호출.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const Effects = {};
  window.Effects = Effects;

  /* ── 오디오 코어 ─────────────────────────────────────────── */
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('onecard_muted') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    return ctx;
  }
  Effects.unlock = function () { const c = ac(); if (c && c.state === 'suspended') c.resume(); };
  Effects.isMuted = () => muted;
  Effects.setMuted = function (m) {
    muted = m;
    try { localStorage.setItem('onecard_muted', m ? '1' : '0'); } catch (e) {}
  };

  function tone(o) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const t = c.currentTime + (o.when || 0);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t + (o.dur || 0.15));
    const g = c.createGain();
    const peak = o.gain == null ? 0.18 : o.gain;
    const atk = o.attack == null ? 0.005 : o.attack;
    const rel = o.release == null ? 0.08 : o.release;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.15) + rel);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + (o.dur || 0.15) + rel + 0.03);
  }

  function noise(o) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const t = c.currentTime + (o.when || 0);
    const dur = o.dur || 0.12;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = o.filter || 'highpass'; filt.frequency.value = o.freq || 1500;
    if (o.q) filt.Q.value = o.q;
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain == null ? 0.2 : o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t); src.stop(t + dur + 0.03);
  }

  /* ── 사운드 프리셋 ───────────────────────────────────────── */
  const SOUND = {
    play() {                       // 일반 카드: 가벼운 "탁"
      noise({ dur: 0.05, gain: 0.10, filter: 'highpass', freq: 2200 });
      tone({ freq: 520, slideTo: 360, type: 'triangle', dur: 0.05, gain: 0.07 });
    },
    attack() {                     // 공격: 묵직한 "쿵 + 클래시"
      tone({ freq: 180, slideTo: 55, type: 'sawtooth', dur: 0.20, gain: 0.30 });
      noise({ dur: 0.22, gain: 0.28, filter: 'lowpass', freq: 600 });
      tone({ freq: 90, slideTo: 40, type: 'square', dur: 0.18, gain: 0.16, when: 0.02 });
    },
    counter() {                    // 반격: 금속성 "챙!"
      tone({ freq: 1320, type: 'square', dur: 0.08, gain: 0.13 });
      tone({ freq: 1980, type: 'square', dur: 0.12, gain: 0.10, when: 0.015 });
      noise({ dur: 0.10, gain: 0.12, filter: 'bandpass', freq: 5200, q: 2 });
      tone({ freq: 2640, type: 'triangle', dur: 0.14, gain: 0.06, when: 0.03 });
    },
    joker() {                      // 조커: 반짝이는 상승 아르페지오
      const notes = [523, 659, 784, 1047, 1319];
      notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.10, gain: 0.12, when: i * 0.05 }));
      noise({ dur: 0.4, gain: 0.05, filter: 'highpass', freq: 6000, when: 0.05 });
      tone({ freq: 1568, type: 'sine', dur: 0.25, gain: 0.07, when: 0.25 });
    },
    wild() {                       // 7 무늬변경: 위로 "슈웅"
      tone({ freq: 300, slideTo: 1000, type: 'sine', dur: 0.18, gain: 0.13 });
      noise({ dur: 0.12, gain: 0.06, filter: 'highpass', freq: 3000 });
    },
    draw() {                       // 1장 뽑기: 작은 "스윽"
      noise({ dur: 0.05, gain: 0.08, filter: 'highpass', freq: 3200 });
      tone({ freq: 280, dur: 0.04, gain: 0.05, type: 'triangle' });
    },
    take() {                       // 공격 받기: 하강 "어이쿠"
      tone({ freq: 320, slideTo: 110, type: 'sawtooth', dur: 0.32, gain: 0.22 });
      noise({ dur: 0.3, gain: 0.12, filter: 'lowpass', freq: 800 });
    },
    win() {                        // 승리 팡파레
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.18, when: i * 0.12 }));
      [784, 988, 1175].forEach(f => tone({ freq: f, type: 'sine', dur: 0.5, gain: 0.12, when: 0.48 }));
    },
  };

  /* ── 화면 이펙트 ─────────────────────────────────────────── */
  function flash(kind) {
    const el = document.getElementById('fx-flash'); if (!el) return;
    el.className = ''; void el.offsetWidth;       // reflow → 애니메이션 재시작
    el.classList.add(kind);
  }
  function shake() {
    const g = document.getElementById('game'); if (!g) return;
    g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake');
    setTimeout(() => g.classList.remove('shake'), 450);
  }
  function popTop() {
    const t = document.getElementById('top-card'); if (!t) return;
    t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
  }
  function sparkle(kind) {
    const layer = document.getElementById('fx-sparkle'); if (!layer) return;
    const chars = kind === 'joker' ? ['✦', '✧', '★', '◆', '✺'] : ['✦', '✧'];
    const cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;
    const n = kind === 'joker' ? 16 : 6;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'spk';
      s.textContent = chars[i % chars.length];
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dist = 80 + Math.random() * 160;
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      if (kind === 'joker') s.style.color = `hsl(${Math.random() * 360},90%,65%)`;
      layer.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  /* ── 카드 분류 ───────────────────────────────────────────── */
  function classify(la, rules) {
    if (!la) return null;
    if (la.type === 'draw') return la.wasAttack ? 'take' : 'draw';
    if (la.type !== 'play') return null;
    const c = la.card;
    if (!c) return 'play';
    if (c.suit === 'JOKER') return 'joker';
    if (la.counter) return 'counter';
    const av = (window.OneCard && rules) ? OneCard.attackValue(c, rules) : 0;
    if (av > 0) return 'attack';
    if (rules && c.rank === rules.wildRank) return 'wild';
    return 'play';
  }

  function fire(kind) {
    switch (kind) {
      case 'attack': SOUND.attack(); flash('atk'); shake(); break;
      case 'counter': SOUND.counter(); flash('counter'); sparkle('counter'); break;
      case 'joker': SOUND.joker(); flash('joker'); sparkle('joker'); popTop(); break;
      case 'wild': SOUND.wild(); flash('wild'); popTop(); break;
      case 'take': SOUND.take(); break;
      case 'draw': SOUND.draw(); break;
      case 'play': default: SOUND.play(); popTop(); break;
    }
  }

  /* ── 렌더 훅 ─────────────────────────────────────────────── */
  let lastSeq = null, winFired = false;
  Effects.onRender = function (vm) {
    const la = vm.lastAction;
    const seq = la && la.seq != null ? la.seq : null;
    if (seq != null && seq !== lastSeq) {
      if (lastSeq !== null) fire(classify(la, vm.rules || (window.App && App._rules)));
      lastSeq = seq;
    }
    if (vm.winner && !winFired) { winFired = true; SOUND.win(); sparkle('joker'); }
    if (!vm.winner) winFired = false;
  };
  Effects.reset = function () { lastSeq = null; winFired = false; };

  /* 첫 사용자 동작에서 오디오 잠금 해제 */
  document.addEventListener('pointerdown', () => Effects.unlock(), { once: true });
  document.addEventListener('keydown', () => Effects.unlock(), { once: true });
})();
