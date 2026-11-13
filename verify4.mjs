// Checks the two-player value table embedded in the built HTML.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('./four-in-a-row.html', import.meta.url), 'utf8');
const BOOK4 = JSON.parse(/const BOOK4 = (\{[^\n]*\});/.exec(html)[1]);
const wasm = Buffer.from(/const WASM_B64 = "([^"]*)";/.exec(html)[1], 'base64');
const T4 = Uint8Array.from(Buffer.from(BOOK4.data, 'base64'));
const P128 = [1, 128, 16384, 2097152, 268435456, 34359738368, 4398046511104];
function mix4(lo, hi, seed) {
  let h = seed ^ Math.imul(lo, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
  h ^= Math.imul((hi + 0x7F4A7C15) | 0, 0xC2B2AE35);
  h = Math.imul(h ^ (h >>> 13), 0x27D4EB2F);
  return (h ^ (h >>> 16)) >>> 0;
}
function value4(key) {
  const lo = key % 67108864, hi = Math.floor(key / 67108864);
  let v = 0;
  for (let i = 0; i < 3; i++) {
    const x = mix4(lo, hi, (BOOK4.seed + Math.imul(i, 0x632BE5AB)) | 0) % BOOK4.segLen + i * BOOK4.segLen;
    v ^= (T4[x >> 2] >> ((x & 3) * 2)) & 3;
  }
  return v;
}
// page-style state: grid[c][r] = 1 (first player) / 2, like the two-player mode
function state(seq) {
  const grid = Array.from({ length: 7 }, () => Array(6).fill(0)), heights = Array(7).fill(0);
  for (let i = 0; i < seq.length; i++) { const c = +seq[i] - 1; grid[c][heights[c]++] = i % 2 === 0 ? 1 : 2; }
  return { grid, heights, me: seq.length % 2 === 0 ? 1 : 2 };
}
function key4(st, moverId) {
  let a = 0, b = 0;
  for (let c = 0; c < 7; c++) {
    let code = 1 << st.heights[c];
    for (let r = 0; r < st.heights[c]; r++) if (st.grid[c][r] === moverId) code |= 1 << r;
    a += code * P128[c]; b += code * P128[6 - c];
  }
  return a < b ? a : b;
}
function winsAt(st, c, p) {
  const r = st.heights[c];
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let k = 1;
    for (const s of [-1, 1]) {
      let x = c + s * dc, y = r + s * dr;
      while (x >= 0 && x < 7 && y >= 0 && y < 6 && st.grid[x][y] === p) { k++; x += s * dc; y += s * dr; }
    }
    if (k >= 4) return true;
  }
  return false;
}
function book4Moves(seq) {                    // same as the page
  if (seq.length + 1 > BOOK4.lmax) return null;
  const st = state(seq), me = st.me, opp = 3 - me, m = [];
  for (let c = 0; c < 7; c++) {
    const h = st.heights[c];
    if (h >= 6) { m.push(null); continue; }
    if (winsAt(st, c, me)) { m.push(2); continue; }
    st.grid[c][h] = me; st.heights[c]++;
    m.push(2 - value4(key4(st, opp)));
    st.heights[c]--; st.grid[c][h] = 0;
  }
  return m;
}
console.log('table: keys', BOOK4.n, 'lmax', BOOK4.lmax, 'bytes', T4.length);
console.log('first move, cols 1-7:', book4Moves('').map(v => ['敗', '和', '勝'][v]).join(' '));

// 1) propagated values recorded at build time
const sample = JSON.parse(fs.readFileSync(new URL('./book4_sample.json', import.meta.url), 'utf8'));
for (const [seq, v] of sample) {
  const st = state(seq);
  if (value4(key4(st, st.me)) !== v) throw new Error('table lookup mismatch at ' + seq);
}
console.log('table lookups match the build-time sample:', sample.length, 'positions');

// 2) independent cross-check against the human-first book (computed by separate solves)
const book2 = JSON.parse(fs.readFileSync(new URL('./book2.json', import.meta.url), 'utf8'));
const R = { l: 0, d: 1, w: 2 };
let n2 = 0;
for (const P in book2) {
  const m = book4Moves(P);
  if (!m) continue;
  for (let c = 0; c < 7; c++) {
    const e = book2[P][c], expect = e === 'x' ? null : e === 'W' ? 2 : R[e[0]];
    if (m[c] !== expect) throw new Error(`disagrees with human-first book at "${P}" col ${c + 1}: table ${m[c]} book ${expect}`);
  }
  n2++;
}
console.log('agrees with the human-first book on', n2, 'positions (all 7 columns each)');

// 3) direct solves of random positions (arbitrary play by both sides)
const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
const S = instance.exports; S.init(8388617);
let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let n3 = 0; const t0 = Date.now();
while (n3 < 400 && Date.now() - t0 < 240000) {
  const len = 7 + Math.floor(rnd() * 3);       // 7-9 stones
  let seq = '', ok = true;
  for (let i = 0; i < len && ok; i++) {
    const st = state(seq), cs = [0, 1, 2, 3, 4, 5, 6].filter(c => st.heights[c] < 6 && !winsAt(st, c, st.me));
    if (!cs.length) { ok = false; break; }
    seq += (cs[Math.floor(rnd() * cs.length)] + 1);
  }
  if (!ok) continue;
  const m = book4Moves(seq);
  for (let c = 0; c < 7; c++) {
    if (m[c] == null) continue;
    S.reset(); for (const ch of seq) S.play(+ch - 1);
    let direct;
    if (S.isWinningMove(c)) direct = 2;
    else { S.play(c); direct = 1 - Math.sign(S.solve(true)); }
    if (direct !== m[c]) throw new Error(`direct solve disagrees at "${seq}" col ${c + 1}: table ${m[c]} direct ${direct}`);
  }
  n3++;
}
console.log('agrees with direct solves on', n3, 'random positions (7-9 stones, all columns)');
