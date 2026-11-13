// End-to-end check of the AI-first coaching mode in the built HTML.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('./four-in-a-row.html', import.meta.url), 'utf8');
const BOOK3_MAX = +/const BOOK3_MAX = (\d+);/.exec(html)[1];
const BOOK3_STR = /const BOOK3_STR = "([^"]*)";/.exec(html)[1];
const wasm = Buffer.from(/const WASM_B64 = "([^"]*)";/.exec(html)[1], 'base64');
const ORDER = [3, 2, 4, 1, 5, 0, 6], ALL = [0, 1, 2, 3, 4, 5, 6];

const book3 = new Map();
{ let i = 0;
  const node = seq => {
    const m = [], replies = [], kids = [];
    for (let c = 0; c < 7; c++) {
      const a = BOOK3_STR.charCodeAt(i++) - 48, b = BOOK3_STR.charCodeAt(i++) - 48;
      if (a === 0) { m.push(null); replies.push(null); continue; }
      m.push(a); replies.push(b >> 1);
      if (!(b & 1)) kids.push(seq + (c + 1) + ((b >> 1) + 1));
    }
    book3.set(seq, { m, replies });
    if (seq.length >= BOOK3_MAX) return;
    for (const k of kids) node(k);
  };
  node('4');
  if (i !== BOOK3_STR.length) throw new Error('book3 decode length mismatch');
}
console.log('ai-first book entries', book3.size, 'BOOK3_MAX', BOOK3_MAX);
console.log('after AI opens in col 4, AI needs (cols 1-7):', book3.get('4').m.join(' '), 'more stones');

const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
const S = instance.exports; S.init(8388617);
const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };

function analyzeDist(seq) {          // same as the page: worker scores -> distance
  const have = (seq.length + 1) / 2, out = [];
  for (let c = 0; c < 7; c++) {
    setup(seq);
    if (!S.canPlay(c)) { out.push(null); continue; }
    if (S.isWinningMove(c)) throw new Error('human can win at ' + seq);
    S.play(c);
    const v = S.getMoves() === 42 ? 0 : -S.solve(false);
    if (v >= 0) throw new Error('AI not winning at ' + seq + (c + 1));
    out.push(22 + v - have);
  }
  return out;
}
function aiLive(seq) {
  setup(seq);
  for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return c;
  const s = S.solve(false);
  for (const c of ORDER) {
    setup(seq);
    if (!S.canPlay(c)) continue;
    S.play(c);
    if (S.getMoves() === 42) { if (s === 0) return c; continue; }
    if (S.canWinNext()) continue;
    if (S.search(-s, -s + 1) <= -s) return c;
  }
  throw new Error('no move at ' + seq);
}

let seed = 13579;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// 1) book distances must agree with a direct solve (sampled among positions with >= 7 stones)
{
  const keys = [...book3.keys()].filter(k => k.length >= 7);
  for (let t = 0; t < 3000; t++) {
    const H = keys[Math.floor(rnd() * keys.length)];
    const d = analyzeDist(H), b = book3.get(H).m;
    for (let c = 0; c < 7; c++) if (d[c] !== b[c]) throw new Error(`distance mismatch at ${H} col ${c + 1}: book ${b[c]} direct ${d[c]}`);
  }
  console.log('book distances vs direct solve: OK on 3000 sampled positions');
}

// 2) games. After each human move the coach announced j = stones the AI still needs.
//    The AI must win within j stones; with best defence from then on, in exactly j.
function playGame(policy) {
  let seq = '4', aiStones = 1, maxLive = 0;
  const promises = [];                     // [aiStonesAtAnnouncement, j, wasBestFromHereOn]
  for (;;) {
    let m, replies = null;
    const b = book3.get(seq);
    if (b) { m = b.m; replies = b.replies; }
    else { const t = Date.now(); m = analyzeDist(seq); maxLive = Math.max(maxLive, Date.now() - t); }
    const legal = ALL.filter(c => m[c] != null);
    const best = Math.max(...legal.map(c => m[c]));
    const useBest = policy === 'best' || (typeof policy === 'number' && promises.length >= policy);
    const c = useBest ? legal.find(x => m[x] === best) : legal[Math.floor(rnd() * legal.length)];
    if (m[c] < best) for (const p of promises) p.exact = false;
    promises.push({ at: aiStones, j: m[c], exact: true });
    seq += (c + 1);
    let r;
    if (replies) r = replies[c]; else { const t = Date.now(); r = aiLive(seq); maxLive = Math.max(maxLive, Date.now() - t); }
    setup(seq);
    if (!S.canPlay(r)) throw new Error('illegal AI reply at ' + seq);
    const win = S.isWinningMove(r);
    seq += (r + 1); aiStones++;
    if (win) {
      for (const p of promises) {
        const used = aiStones - p.at;
        if (used > p.j || (p.exact && used !== p.j)) throw new Error(`announced ${p.j}, AI used ${used} (exact=${p.exact}) in ${seq}`);
      }
      return { seq, maxLive };
    }
    if (seq.length >= 42) throw new Error('no AI win in ' + seq);
  }
}
for (const [policy, n] of [['best', 1], ['random', 20000]]) {
  const t = Date.now(); let maxLive = 0, longest = 0;
  for (let g = 0; g < n; g++) { const r = playGame(policy); maxLive = Math.max(maxLive, r.maxLive); longest = Math.max(longest, r.seq.length); }
  console.log(`human plays ${policy}: ${n} games, AI won all and never took longer than the coach announced; longest ${longest} stones, slowest live step ${maxLive} ms, ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
// mixed: random for the first k human moves, then best defence -> later announcements must match exactly
for (const k of [1, 3, 6]) {
  const t = Date.now(); let longest = 0, maxLive = 0;
  for (let g = 0; g < 3000; g++) { const r = playGame(k); longest = Math.max(longest, r.seq.length); maxLive = Math.max(maxLive, r.maxLive); }
  console.log('human random for ' + k + ' moves then best defence: 3000 games OK; longest ' + longest + ' stones, slowest live step ' + maxLive + ' ms, ' + ((Date.now() - t) / 1000).toFixed(0) + 's');
}
