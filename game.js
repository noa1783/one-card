'use strict';
/* ═══════════════════════════════════════════════════════════════
   원카드 · game.js  —  순수 룰 엔진 (UI/네트워크 의존성 없음)
   node 와 브라우저 양쪽에서 동작.
   ─────────────────────────────────────────────────────────────
   카드 표현
     일반:  { suit:'S'|'H'|'D'|'C', rank:'2'..'10'|'J'|'Q'|'K'|'A', id }
     조커:  { suit:'JOKER', rank:'BLACK'|'COLOR', id }
   ═══════════════════════════════════════════════════════════════ */
(function (root) {

  const SUITS = ['S', 'H', 'D', 'C'];                 // ♠ ♥ ♦ ♣
  const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

  const RED = new Set(['H', 'D']);
  const isRed = (c) => c.suit === 'JOKER' ? c.rank === 'COLOR' : RED.has(c.suit);

  // ── 기본 룰 (마스터가 세팅 화면에서 덮어씀) ────────────────────
  function defaultRules() {
    return {
      attack: { '2': 2, 'A': 3, 'JOKER_BLACK': 5, 'JOKER_COLOR': 7 },
      wildRank: '7',        // 무늬 변경 (와일드)
      skipRank: 'J',        // 다음 사람 건너뛰기
      reverseRank: 'Q',     // 방향 전환
      extraTurnRank: 'K',   // 한 번 더 내기
      jokerCountersNumber: false, // 조커로 숫자공격(2/A) 반격 허용?
      mustDeclareOneCard: true,   // 1장 남으면 "원카드" 표시
    };
  }

  // ── 덱 생성 ───────────────────────────────────────────────────
  function buildDeck(useJokers) {
    const d = [];
    let n = 0;
    for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, id: 'c' + (n++) });
    if (useJokers) {
      d.push({ suit: 'JOKER', rank: 'BLACK', id: 'c' + (n++) });
      d.push({ suit: 'JOKER', rank: 'COLOR', id: 'c' + (n++) });
    }
    return d;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── 공격 카드 판별 ────────────────────────────────────────────
  function attackValue(card, rules) {
    if (card.suit === 'JOKER') {
      return rules.attack['JOKER_' + card.rank] || 0;
    }
    return rules.attack[card.rank] || 0;
  }
  const isAttack = (card, rules) => attackValue(card, rules) > 0;
  const isJoker = (card) => card.suit === 'JOKER';

  // 두 공격카드가 서로 쌓일(반격될) 수 있는가
  function canStack(onTop, played, rules) {
    const topJ = isJoker(onTop), playJ = isJoker(played);
    if (topJ && playJ) return true;                 // 조커 ↔ 조커
    if (!topJ && !playJ) return true;               // 숫자공격(2/A) ↔ 숫자공격
    // 한쪽만 조커
    return !!rules.jokerCountersNumber;             // 옵션
  }

  // ═══════════════════════════════════════════════════════════════
  //  게임
  // ═══════════════════════════════════════════════════════════════
  class OneCardGame {
    /**
     * @param cfg { players:[{id,name}], startCards, useJokers, rules }
     * @param rng 선택적 시드 난수 (테스트용)
     */
    constructor(cfg, rng) {
      this.rng = rng || Math.random;
      this.players = cfg.players.map(p => ({ id: p.id, name: p.name }));
      this.startCards = cfg.startCards || 7;
      this.useJokers = cfg.useJokers !== false;
      this.rules = Object.assign(defaultRules(), cfg.rules || {});
      this.reset();
    }

    reset() {
      const deck = shuffle(buildDeck(this.useJokers), this.rng);
      this.hands = {};
      for (const p of this.players) this.hands[p.id] = [];
      // 분배
      for (let k = 0; k < this.startCards; k++)
        for (const p of this.players) this.hands[p.id].push(deck.pop());

      // 시작 카드: 특수카드가 아닌 일반 카드가 맨 위로 오게 함
      let start = deck.pop();
      const isSpecial = (c) =>
        isAttack(c, this.rules) || isJoker(c) ||
        c.rank === this.rules.wildRank || c.rank === this.rules.skipRank ||
        c.rank === this.rules.reverseRank || c.rank === this.rules.extraTurnRank;
      let guard = 0;
      while (isSpecial(start) && deck.length && guard++ < 200) {
        deck.unshift(start);
        start = deck.pop();
      }

      this.deck = deck;
      this.discard = [start];
      this.currentSuit = start.suit === 'JOKER' ? 'S' : start.suit;
      this.turn = 0;
      this.dir = 1;
      this.pendingAttack = 0;     // 누적 공격 장수
      this.attackActive = false;  // 공격 진행 중?
      this.winner = null;
      this.log = [];
      this.lastAction = null;     // {type, playerId, card, ...} UI 연출용
      this.seq = 0;               // 액션 시퀀스 (이펙트 중복 방지용)
      this._say(`게임 시작 · 시작 카드 ${this.discard[0] && this.label(this.discard[0])}`);
      return this;
    }

    // ── 조회 헬퍼 ───────────────────────────────────────────────
    top() { return this.discard[this.discard.length - 1]; }
    currentPlayer() { return this.players[this.turn]; }
    handOf(pid) { return this.hands[pid] || []; }
    count(pid) { return this.handOf(pid).length; }

    label(c) {
      if (!c) return '-';
      if (c.suit === 'JOKER') return c.rank === 'BLACK' ? '블랙조커' : '컬러조커';
      const sym = { S: '♠', H: '♥', D: '♦', C: '♣' }[c.suit];
      return sym + c.rank;
    }

    _say(msg) { this.log.push({ t: Date.now(), msg }); if (this.log.length > 200) this.log.shift(); }

    // ── 합법성 ──────────────────────────────────────────────────
    /** 이 카드를 지금 낼 수 있는가 */
    isPlayable(card) {
      const t = this.top();
      // 공격 받는 중 → 반격 카드만
      if (this.attackActive && this.pendingAttack > 0) {
        if (!isAttack(card, this.rules)) return false;
        return canStack(t, card, this.rules);
      }
      // 평상시
      if (isJoker(card)) return true;                       // 조커는 언제나 가능
      if (card.rank === this.rules.wildRank) return true;   // 와일드(7)는 언제나
      if (isJoker(t)) return true;                          // 위가 조커면 무엇이든(무늬는 지정된 currentSuit 따름)
      if (card.suit === this.currentSuit) return true;      // 무늬 일치
      if (card.rank === t.rank) return true;                // 숫자/문자 일치
      return false;
    }

    /** 현재 차례 플레이어가 낼 수 있는 카드 id 목록 */
    playableIds(pid) {
      pid = pid || this.currentPlayer().id;
      if (this.winner || pid !== this.currentPlayer().id) return [];
      return this.handOf(pid).filter(c => this.isPlayable(c)).map(c => c.id);
    }

    /** 지금 반격(공격 카드로 받아치기)이 가능한가 */
    canCounter(pid) {
      pid = pid || this.currentPlayer().id;
      if (!this.attackActive || this.pendingAttack <= 0) return false;
      if (pid !== this.currentPlayer().id) return false;
      return this.handOf(pid).some(c => this.isPlayable(c));
    }

    /** 지금 낼 수 있는 카드가 하나라도 있는가 (제출 가능 여부) */
    canSubmit(pid) {
      return this.playableIds(pid).length > 0;
    }

    // ── 진행 ────────────────────────────────────────────────────
    _advance(steps) {
      const n = this.players.length;
      let i = this.turn;
      for (let s = 0; s < steps; s++) i = (i + this.dir + n) % n;
      this.turn = i;
    }

    _reshuffleIfNeeded() {
      if (this.deck.length > 0) return;
      const t = this.discard.pop();
      this.deck = shuffle(this.discard, this.rng);
      this.discard = [t];
      this._say('덱 소진 → 버린 더미 셔플');
    }

    _draw(pid, k) {
      const drawn = [];
      for (let i = 0; i < k; i++) {
        this._reshuffleIfNeeded();
        if (!this.deck.length) break;
        const c = this.deck.pop();
        this.hands[pid].push(c);
        drawn.push(c);
      }
      return drawn;
    }

    /**
     * 카드 제출
     * @param pid 플레이어
     * @param cardId 낼 카드
     * @param opt { suit } 와일드(7) 사용 시 지정 무늬, 조커 제출 시도 지정 무늬(선택)
     * @returns {ok, error?}
     */
    play(pid, cardId, opt = {}) {
      if (this.winner) return { ok: false, error: '이미 끝난 게임' };
      if (pid !== this.currentPlayer().id) return { ok: false, error: '당신 차례가 아님' };
      const hand = this.hands[pid];
      const idx = hand.findIndex(c => c.id === cardId);
      if (idx < 0) return { ok: false, error: '손에 없는 카드' };
      const card = hand[idx];
      if (!this.isPlayable(card)) return { ok: false, error: '낼 수 없는 카드' };

      const wasUnderAttack = this.attackActive && this.pendingAttack > 0;

      // 손에서 제거 → 버린 더미로
      hand.splice(idx, 1);
      this.discard.push(card);
      this.lastAction = { type: 'play', playerId: pid, card, counter: wasUnderAttack, seq: ++this.seq };

      // 무늬 갱신
      if (isJoker(card)) {
        this.currentSuit = opt.suit && SUITS.includes(opt.suit) ? opt.suit : this.currentSuit;
      } else if (card.rank === this.rules.wildRank) {
        this.currentSuit = (opt.suit && SUITS.includes(opt.suit)) ? opt.suit : card.suit;
      } else {
        this.currentSuit = card.suit;
      }

      const name = this.playerName(pid);
      this._say(`${name} → ${this.label(card)}${(isJoker(card) || card.rank === this.rules.wildRank) ? ` (무늬: ${this.suitName(this.currentSuit)})` : ''}`);

      // 승리 체크
      if (hand.length === 0) {
        this.winner = pid;
        this._say(`🏆 ${name} 승리!`);
        return { ok: true, winner: pid };
      }

      // ── 효과 처리 ─────────────────────────────
      const av = attackValue(card, this.rules);
      if (av > 0) {
        this.pendingAttack += av;
        this.attackActive = true;
        this._say(`⚔ 공격! 누적 ${this.pendingAttack}장`);
        this._advance(1);
        return { ok: true, oneCard: this._oneCardFlag(pid) };
      }

      // (공격 아님) 진행 중이던 공격은 여기서 끝남 — 사실 공격중엔 공격카드만 낼 수 있어 도달X
      let extra = false, skip = false, reversed = false;
      if (card.rank === this.rules.extraTurnRank) extra = true;
      if (card.rank === this.rules.skipRank) skip = true;
      if (card.rank === this.rules.reverseRank) { this.dir *= -1; reversed = true; }

      this.lastAction.effects = { extra, skip, reversed };

      if (extra) {
        this._say(`↻ ${name} 한 번 더`);
        // turn 그대로
      } else {
        this._advance(skip ? 2 : 1);
        if (skip) this._say('⏭ 다음 사람 건너뜀');
        if (reversed) this._say('🔄 방향 전환');
      }
      return { ok: true, oneCard: this._oneCardFlag(pid) };
    }

    _oneCardFlag(pid) {
      const one = this.count(pid) === 1;
      if (one && this.rules.mustDeclareOneCard) this._say(`❗ ${this.playerName(pid)} 원카드!`);
      return one;
    }

    /**
     * 카드 못 냄 → 뽑기 (공격중이면 누적분, 아니면 1장)
     */
    drawAndPass(pid) {
      if (this.winner) return { ok: false, error: '이미 끝난 게임' };
      if (pid !== this.currentPlayer().id) return { ok: false, error: '당신 차례가 아님' };

      let k = 1, wasAttack = false;
      if (this.attackActive && this.pendingAttack > 0) {
        k = this.pendingAttack;
        wasAttack = true;
      }
      const drawn = this._draw(pid, k);
      this.lastAction = { type: 'draw', playerId: pid, count: drawn.length, wasAttack, seq: ++this.seq };
      this._say(`${this.playerName(pid)} ${wasAttack ? `공격 ${drawn.length}장 받음` : `1장 뽑기`}`);

      if (wasAttack) { this.pendingAttack = 0; this.attackActive = false; }
      this._advance(1);
      return { ok: true, drawn: drawn.length };
    }

    playerName(pid) { const p = this.players.find(x => x.id === pid); return p ? p.name : pid; }
    suitName(s) { return { S: '스페이드', H: '하트', D: '다이아', C: '클로버' }[s] || s; }

    // ── 공개 스냅샷 (네트워크 동기화용; 손패는 장수만) ──────────
    publicState() {
      return {
        players: this.players.map(p => ({ id: p.id, name: p.name, count: this.count(p.id) })),
        top: this.top(),
        currentSuit: this.currentSuit,
        turn: this.turn,
        turnPlayerId: this.currentPlayer().id,
        dir: this.dir,
        pendingAttack: this.pendingAttack,
        attackActive: this.attackActive,
        deckCount: this.deck.length,
        winner: this.winner,
        log: this.log.slice(-30),
        lastAction: this.lastAction,
        startCards: this.startCards,
        useJokers: this.useJokers,
        rules: this.rules,
      };
    }
  }

  const api = {
    OneCardGame, buildDeck, shuffle, defaultRules,
    attackValue, isAttack, isJoker, isRed, SUITS, RANKS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OneCard = api;

})(typeof window !== 'undefined' ? window : globalThis);
