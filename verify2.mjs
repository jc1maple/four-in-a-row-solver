// End-to-end check of the coaching (human-first) mode in the built HTML.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('./four-in-a-row.html', import.meta.url), 'utf8');
const BOOK2_MAX = +/const BOOK2_MAX = (\d+);/.exec(html)[1];
const BOOK2_STR = /const BOOK2_STR = "([^"]*)";/.exec(html)[1];
const wasm = Buffer.from(/const WASM_B64 = "([^"]*)";/.exec(html)[1], 'base64');
const ORDER = [3, 2, 4, 1, 5, 0, 6];

const book2 = new Map();
{ let i = 0;
  const node = seq => {
    const vals = [], replies = [], kids = [];
    for (let c = 0; c < 7; c++) {
      const code = BOOK2_STR.charCodeAt(i++) - 48;
      if (code === 42) { vals.push(null); replies.push(null); }
      else if (code === 43) { vals.push(2); replies.push(null); }
      else {
        const rank = Math.floor(code / 14), reply = (code % 14) >> 1, term = code & 1;
        vals.push(rank); replies.push(reply);
        if (!term) kids.push(seq + (c + 1) + (reply + 1));
      }
    }
    book2.set(seq, { vals, replies });
    if (seq.length >= BOOK2_MAX) return;
    for (const k of kids) node(k);
  };
  node('');
  if (i !== BOOK2_STR.length) throw new Error('book2 decode length mismatch');
}
console.log('coach book entries', book2.size, 'BOOK2_MAX', BOOK2_MAX);
console.log('root values (cols 1-7):', book2.get('').vals.map(v => ['L', 'D', 'W'][v]).join(' '));

const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
const S = instance.exports; S.init(8388617);
const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };

// same logic as the page's worker
function analyze(seq) {
  const scores = [];
  for (let c = 0; c < 7; c++) {
    setup(seq);
    if (!S.canPlay(c)) { scores.push(null); continue; }
    if (S.isWinningMove(c)) { scores.push((43 - seq.length) >> 1); continue; }
    S.play(c);
    scores.push(S.getMoves() === 42 ? 0 : -S.solve(false));
  }
  return scores;
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
  for (const c of ORDER) { setup(seq); if (S.canPlay(c)) return c; }
}
const rankOf = v => v == null ? null : v > 0 ? 2 : v < 0 ? 0 : 1;

let seed = 24680;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// 1) book values must agree with a direct solve (sampled, positions with >= 6 stones to keep it fast)
{
  const keys = [...book2.keys()].filter(k => k.length >= 6);
  let n = 0;
  for (let t = 0; t < 4000; t++) {
    const P = keys[Math.floor(rnd() * keys.length)];
    const direct = analyze(P).map(rankOf), b = book2.get(P).vals;
    for (let c = 0; c < 7; c++) if (direct[c] !== b[c]) throw new Error(`value mismatch at ${P} col ${c + 1}: book ${b[c]} direct ${direct[c]}`);
    n++;
  }
  console.log('book values vs direct solve: OK on', n, 'sampled positions');
}

// 2) play games: `errors` random human moves first, then the human follows the coach's best column.
//    The final result must equal the worst rank the coach reported along the way.
function playGame(randomMoves) {
  let seq = '', floor = 2, maxLive = 0, mistakes = 0;
  for (let hm = 0; ; hm++) {
    let vals, replies = null;
    const b = book2.get(seq);
    if (b) { vals = b.vals; replies = b.replies; }
    else { const t = Date.now(); vals = analyze(seq).map(rankOf); maxLive = Math.max(maxLive, Date.now() - t); }
    const legal = [0, 1, 2, 3, 4, 5, 6].filter(c => vals[c] != null);
    const best = Math.max(...legal.map(c => vals[c]));
    if (best !== floor) throw new Error(`position value ${best} != expected ${floor} at ${seq}`);
    const c = hm < randomMoves ? legal[Math.floor(rnd() * legal.length)] : legal.find(x => vals[x] === best);
    if (vals[c] < best) mistakes++;
    floor = vals[c];
    setup(seq);
    const hwin = S.isWinningMove(c);
    seq += (c + 1);
    if (hwin) return { result: 2, floor, seq, maxLive, mistakes };
    if (seq.length === 42) return { result: 1, floor, seq, maxLive, mistakes };
    let r;
    if (replies) r = replies[c]; else { const t = Date.now(); r = aiLive(seq); maxLive = Math.max(maxLive, Date.now() - t); }
    setup(seq);
    if (!S.canPlay(r)) throw new Error('illegal AI reply at ' + seq);
    const awin = S.isWinningMove(r);
    seq += (r + 1);
    if (awin) return { result: 0, floor, seq, maxLive, mistakes };
    if (seq.length === 42) return { result: 1, floor, seq, maxLive, mistakes };
  }
}
for (const [k, n] of [[0, 1], [1, 3000], [2, 3000], [4, 3000], [8, 3000], [30, 3000]]) {
  const t = Date.now(); const tally = [0, 0, 0]; let maxLive = 0, longest = 0;
  for (let g = 0; g < n; g++) {
    const r = playGame(k);
    if (r.result !== r.floor) throw new Error(`outcome ${r.result} != coach value ${r.floor} in game ${r.seq}`);
    tally[r.result]++; maxLive = Math.max(maxLive, r.maxLive); longest = Math.max(longest, r.seq.length);
  }
  console.log(`${k} random human moves then best play: ${n} games, human W/D/L = ${tally[2]}/${tally[1]}/${tally[0]}, outcome always matched the coach; slowest live step ${maxLive} ms, longest ${longest} stones, ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
