// End-to-end check of the built HTML: decode its embedded book + wasm, replay the page's AI logic,
// and play many games against random and best-defence opponents.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('./four-in-a-row.html', import.meta.url), 'utf8');
const BOOK_MAX = +/const BOOK_MAX = (\d+);/.exec(html)[1];
const BOOK_STR = /const BOOK_STR = "([^"]*)";/.exec(html)[1];
const wasm = Buffer.from(/const WASM_B64 = "([^"]*)";/.exec(html)[1], 'base64');
const ORDER = [3, 2, 4, 1, 5, 0, 6];

const book = new Map();
{ let i = 0;
  const node = seq => {
    const mv = BOOK_STR[i++]; book.set(seq, +mv - 1);
    if (BOOK_STR[i] === 'W') { i++; return; }
    if (seq.length >= BOOK_MAX) return;
    for (let c = 1; c <= 7; c++) { if (BOOK_STR[i] === '-') { i++; continue; } node(seq + mv + c); }
  };
  node('');
  if (i !== BOOK_STR.length) throw new Error('book decode length mismatch');
}
console.log('book entries', book.size, 'BOOK_MAX', BOOK_MAX);

async function newSolver() {
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  instance.exports.init(8388617); return instance.exports;
}
let S = await newSolver();
const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };

function aiLive(seq) {           // same logic as the page's worker
  setup(seq);
  for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return { col: c, win: true };
  const s = S.solve(false);
  if (s <= 0) throw new Error('AI not winning at ' + seq + ' score ' + s);
  for (const c of ORDER) {
    if (!S.canPlay(c)) continue;
    setup(seq); S.play(c);
    if (S.canWinNext()) continue;
    if (S.search(-s, -s + 1) <= -s) return { col: c, win: false };
  }
  throw new Error('no move found at ' + seq);
}

let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// opponent policies
const randomOpp = seq => { setup(seq); const cs = ORDER.filter(c => S.canPlay(c)); return cs[Math.floor(rnd() * cs.length)]; };
const greedyOpp = seq => {       // win if possible, otherwise random
  setup(seq); for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return c; return randomOpp(seq);
};
const smartOpp = seq => {
  setup(seq); for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return c;
  const ok = [];
  for (const c of ORDER) { setup(seq); if (!S.canPlay(c)) continue; S.play(c); if (!S.canWinNext()) ok.push(c); }
  if (!ok.length) return randomOpp(seq);
  return ok[Math.floor(rnd() * ok.length)];
};
const bestDefence = seq => {     // out of book: longest resistance by exact solving; in book: random
  if (seq.length < BOOK_MAX + 1) return smartOpp(seq);
  setup(seq); for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return c;
  let best = -1, bestScore = -99;
  for (const c of ORDER) {
    setup(seq); if (!S.canPlay(c)) continue; S.play(c);
    const sc = -S.solve(false);
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best;
};

function playGame(opp) {
  let seq = '', maxLive = 0, liveMoves = 0;
  for (;;) {
    let col, win = false;
    setup(seq);
    if (book.has(seq)) { col = book.get(seq); win = S.isWinningMove(col); }
    else { const t = Date.now(); ({ col, win } = aiLive(seq)); maxLive = Math.max(maxLive, Date.now() - t); liveMoves++; }
    setup(seq);
    if (!S.canPlay(col)) throw new Error('illegal AI move at ' + seq);
    const really = S.isWinningMove(col);
    seq += (col + 1);
    if (really) return { seq, maxLive };
    if (win) throw new Error('claimed win that is not a win at ' + seq);
    if (seq.length >= 42) throw new Error('DRAW at ' + seq);
    const oc = opp(seq);
    setup(seq);
    if (S.isWinningMove(oc)) throw new Error('OPPONENT WON at ' + seq + (oc + 1));
    seq += (oc + 1);
    if (seq.length >= 42) throw new Error('DRAW at ' + seq);
  }
}

for (const [name, opp, n] of [['random', randomOpp, 20000], ['greedy', greedyOpp, 20000], ['smart', smartOpp, 20000], ['best-defence', bestDefence, 2000]]) {
  const t = Date.now(); let maxLen = 0, maxLive = 0, sumLen = 0;
  for (let g = 0; g < n; g++) { const r = playGame(opp); maxLen = Math.max(maxLen, r.seq.length); sumLen += r.seq.length; maxLive = Math.max(maxLive, r.maxLive); }
  console.log(`${name}: ${n} games, AI won all; avg length ${(sumLen / n).toFixed(1)}, longest ${maxLen} stones, slowest live move ${maxLive} ms, total ${((Date.now() - t) / 1000).toFixed(0)}s`);
}

// cold-start timing: first out-of-book move with an empty transposition table
let worst = 0, worstSeq = '', tot = 0; const N = 400;
for (let g = 0; g < N; g++) {
  let seq = '', ended = false;
  while (book.has(seq)) {
    const mv = book.get(seq); setup(seq);
    if (S.isWinningMove(mv)) { ended = true; break; }
    seq += (mv + 1);
    seq += (smartOpp(seq) + 1);
  }
  if (ended) { g--; continue; }
  if (seq.length % 2) { g--; continue; }
  setup(seq); if (S.canWinNext()) { g--; continue; }
  S = await newSolver();
  const t = Date.now(); aiLive(seq); const ms = Date.now() - t; tot += ms;
  if (ms > worst) { worst = ms; worstSeq = seq; }
}
console.log(`cold first live move over ${N} samples: avg ${(tot / N).toFixed(0)} ms, worst ${worst} ms at ${worstSeq}`);
