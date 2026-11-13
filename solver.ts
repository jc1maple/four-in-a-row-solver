// Four-in-a-row perfect solver (7x6), bitboard negamax with transposition table.
// Bit index = col*7 + row (row 0 = bottom); one spare bit on top of each column.

const WIDTH: i32 = 7;
const HEIGHT: i32 = 6;
const MIN_SCORE: i32 = -18;
const MAX_SCORE: i32 = 18;

const BOTTOM: u64 =
  (1 as u64) | ((1 as u64) << 7) | ((1 as u64) << 14) | ((1 as u64) << 21) |
  ((1 as u64) << 28) | ((1 as u64) << 35) | ((1 as u64) << 42);
const BOARD: u64 = BOTTOM * 63;

// game state: `cur` = stones of the player to move, `mask` = all stones
let cur: u64 = 0;
let mask: u64 = 0;
let moves: i32 = 0;

let ttSize: u32 = 0;
let ttKeys: StaticArray<u32> = new StaticArray<u32>(1);
let ttVals: StaticArray<u8> = new StaticArray<u8>(1);

const moveBuf: StaticArray<u64> = new StaticArray<u64>(44 * 7);
const scoreBuf: StaticArray<i32> = new StaticArray<i32>(44 * 7);
const ORDER: StaticArray<i32> = [3, 2, 4, 1, 5, 0, 6];

let nodes: f64 = 0;

@inline function colMask(col: i32): u64 { return ((1 as u64 << HEIGHT) - 1) << (col * 7); }
@inline function topMask(col: i32): u64 { return (1 as u64) << (HEIGHT - 1 + col * 7); }
@inline function bottomMask(col: i32): u64 { return (1 as u64) << (col * 7); }

function winning(p: u64, m: u64): u64 {
  // vertical
  let r: u64 = (p << 1) & (p << 2) & (p << 3);
  // horizontal
  let q: u64 = (p << 7) & (p << 14);
  r |= q & (p << 21);
  r |= q & (p >> 7);
  q = (p >> 7) & (p >> 14);
  r |= q & (p << 7);
  r |= q & (p >> 21);
  // diagonal 1
  q = (p << 6) & (p << 12);
  r |= q & (p << 18);
  r |= q & (p >> 6);
  q = (p >> 6) & (p >> 12);
  r |= q & (p << 6);
  r |= q & (p >> 18);
  // diagonal 2
  q = (p << 8) & (p << 16);
  r |= q & (p << 24);
  r |= q & (p >> 8);
  q = (p >> 8) & (p >> 16);
  r |= q & (p << 8);
  r |= q & (p >> 24);
  return r & (BOARD ^ m);
}

@inline function possibleOf(m: u64): u64 { return (m + BOTTOM) & BOARD; }

function nonLosing(c: u64, m: u64): u64 {
  let possible = possibleOf(m);
  const oppWin = winning(c ^ m, m);
  const forced = possible & oppWin;
  if (forced != 0) {
    if ((forced & (forced - 1)) != 0) return 0;
    possible = forced;
  }
  return possible & ~(oppWin >> 1);
}

function negamax(c: u64, m: u64, n: i32, alpha: i32, beta: i32): i32 {
  nodes += 1;
  const possible = nonLosing(c, m);
  if (possible == 0) return -(WIDTH * HEIGHT - n) / 2;
  if (n >= WIDTH * HEIGHT - 2) return 0;

  let min = -(WIDTH * HEIGHT - 2 - n) / 2;
  if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
  let max = (WIDTH * HEIGHT - 1 - n) / 2;
  if (beta > max) { beta = max; if (alpha >= beta) return beta; }

  const key: u64 = c + m;
  const idx = <i32>(key % <u64>ttSize);
  if (unchecked(ttKeys[idx]) == <u32>key) {
    const val = <i32>unchecked(ttVals[idx]);
    if (val != 0) {
      if (val > MAX_SCORE - MIN_SCORE + 1) {
        min = val + 2 * MIN_SCORE - MAX_SCORE - 2;
        if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
      } else {
        max = val + MIN_SCORE - 1;
        if (beta > max) { beta = max; if (alpha >= beta) return beta; }
      }
    }
  }

  // move ordering: insertion sort by number of created winning spots
  const base = n * 7;
  let cnt = 0;
  for (let i = 0; i < 7; i++) {
    const mv = possible & colMask(unchecked(ORDER[i]));
    if (mv != 0) {
      const sc = <i32>popcnt<u64>(winning(c | mv, m));
      let pos = cnt++;
      while (pos > 0 && unchecked(scoreBuf[base + pos - 1]) < sc) {
        unchecked(scoreBuf[base + pos] = scoreBuf[base + pos - 1]);
        unchecked(moveBuf[base + pos] = moveBuf[base + pos - 1]);
        pos--;
      }
      unchecked(scoreBuf[base + pos] = sc);
      unchecked(moveBuf[base + pos] = mv);
    }
  }

  for (let i = 0; i < cnt; i++) {
    const mv = unchecked(moveBuf[base + i]);
    const score = -negamax(c ^ m, m | mv, n + 1, -beta, -alpha);
    if (score >= beta) {
      unchecked(ttKeys[idx] = <u32>key);
      unchecked(ttVals[idx] = <u8>(score + MAX_SCORE - 2 * MIN_SCORE + 2));
      return score;
    }
    if (score > alpha) alpha = score;
  }
  unchecked(ttKeys[idx] = <u32>key);
  unchecked(ttVals[idx] = <u8>(alpha - MIN_SCORE + 1));
  return alpha;
}

// ---------- exports ----------

export function init(size: u32): void {
  ttSize = size;
  ttKeys = new StaticArray<u32>(size);
  ttVals = new StaticArray<u8>(size);
}

export function reset(): void { cur = 0; mask = 0; moves = 0; }
export function getMoves(): i32 { return moves; }
export function getNodes(): f64 { return nodes; }
export function clearNodes(): void { nodes = 0; }

export function canPlay(col: i32): bool { return (mask & topMask(col)) == 0; }

export function isWinningMove(col: i32): bool {
  return (winning(cur, mask) & possibleOf(mask) & colMask(col)) != 0;
}

export function canWinNext(): bool {
  return (winning(cur, mask) & possibleOf(mask)) != 0;
}

export function play(col: i32): void {
  const mv = (mask + bottomMask(col)) & colMask(col);
  cur ^= mask;
  mask |= mv;
  moves++;
}

// cell owner: 0 empty, 1 first player, 2 second player
export function cell(col: i32, row: i32): i32 {
  const b = (1 as u64) << (col * 7 + row);
  if ((mask & b) == 0) return 0;
  const isCur = (cur & b) != 0;
  const curIsFirst = (moves & 1) == 0;
  return (isCur == curIsFirst) ? 1 : 2;
}

// Null-window test on the current position (side to move must not have an immediate win).
export function search(alpha: i32, beta: i32): i32 {
  return negamax(cur, mask, moves, alpha, beta);
}

// Exact score of the current position for the side to move.
// >0: wins, value = (43 - stones at the moment of the winning move... ) see JS wrapper; 0 draw; <0 loses.
export function solve(weak: bool): i32 {
  if (canWinNext()) return (WIDTH * HEIGHT + 1 - moves) / 2;
  let min = -(WIDTH * HEIGHT - moves) / 2;
  let max = (WIDTH * HEIGHT + 1 - moves) / 2;
  if (weak) { min = -1; max = 1; }
  while (min < max) {
    let med = min + (max - min) / 2;
    if (med <= 0 && min / 2 < med) med = min / 2;
    else if (med >= 0 && max / 2 > med) med = max / 2;
    const r = negamax(cur, mask, moves, med, med + 1);
    if (r <= med) max = r; else min = r;
  }
  return min;
}
