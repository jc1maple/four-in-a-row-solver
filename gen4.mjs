// Value table for the two-player mode: the game-theoretic value (for the side to move) of EVERY reachable
// position with at most LMAX stones. Level LMAX is solved directly; shallower levels follow by minimax.
// Output: book4.json { n, segLen, seed, lmax, data(base64, 2 bits per cell) } - a static "xor function"
// mapping position key -> value (0 lost, 1 draw, 2 won) without storing the keys.
import fs from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

if (!isMainThread) {
  const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  const S = instance.exports;
  S.init(8388617);
  parentPort.on('message', batch => {
    const out = new Int8Array(batch.length);
    for (let i = 0; i < batch.length; i++) {
      const seq = batch[i];
      S.reset(); for (let k = 0; k < seq.length; k++) S.play(seq.charCodeAt(k) - 49);
      out[i] = Math.sign(S.solve(true)) + 1;
    }
    parentPort.postMessage(out);
  });
  parentPort.postMessage('ready');
} else {
  const LMAX = +process.argv[2] || 10, NW = 22, BATCH = 100;
  const P128 = [1, 128, 16384, 2097152, 268435456, 34359738368, 4398046511104];

  // board helpers on a sequence string
  function board(seq) {
    const cols = [[], [], [], [], [], [], []];
    for (let i = 0; i < seq.length; i++) cols[seq.charCodeAt(i) - 49].push(i & 1);
    return cols;
  }
  function keyOf(cols, mover) {               // canonical (mirror-reduced) key
    let a = 0, b = 0;
    for (let c = 0; c < 7; c++) {
      const col = cols[c]; let code = 1 << col.length;
      for (let r = 0; r < col.length; r++) if (col[r] === mover) code |= 1 << r;
      a += code * P128[c]; b += code * P128[6 - c];
    }
    return a < b ? a : b;
  }
  function wins(cols, c, p) {                 // would player p win by dropping in column c?
    const r = cols[c].length;
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let k = 1;
      for (const s of [-1, 1]) {
        let x = c + s * dc, y = r + s * dr;
        while (x >= 0 && x < 7 && y >= 0 && y < 6 && cols[x][y] === p) { k++; x += s * dc; y += s * dr; }
      }
      if (k >= 4) return true;
    }
    return false;
  }

  // 1) enumerate all reachable positions level by level
  const levels = [new Map([[keyOf(board(''), 0), '']])];
  for (let n = 0; n < LMAX; n++) {
    const next = new Map(), p = n & 1;
    for (const seq of levels[n].values()) {
      const cols = board(seq);
      for (let c = 0; c < 7; c++) {
        if (cols[c].length >= 6 || wins(cols, c, p)) continue;
        cols[c].push(p);
        const k = keyOf(cols, 1 - p);
        if (!next.has(k)) next.set(k, seq + (c + 1));
        cols[c].pop();
      }
    }
    levels.push(next);
    console.log('level', n + 1, 'positions', next.size);
  }

  // 2) solve the deepest level
  const workers = [];
  for (let i = 0; i < NW; i++) workers.push(new Worker(new URL(import.meta.url)));
  await Promise.all(workers.map(w => new Promise(r => w.once('message', r))));
  const deepKeys = [...levels[LMAX].keys()], deepSeqs = [...levels[LMAX].values()];
  const deepVals = new Int8Array(deepSeqs.length);
  const t0 = Date.now();
  await new Promise(resolve => {
    let next = 0, done = 0, lastLog = Date.now();
    const feed = w => {
      if (next >= deepSeqs.length) return;
      const start = next; next += BATCH;
      w.removeAllListeners('message');
      w.once('message', out => {
        deepVals.set(out, start); done += out.length;
        if (Date.now() - lastLog > 30000) { lastLog = Date.now(); console.log('solved', done, '/', deepSeqs.length, ((Date.now() - t0) / 1000).toFixed(0) + 's'); }
        if (done === deepSeqs.length) resolve(); else feed(w);
      });
      w.postMessage(deepSeqs.slice(start, start + BATCH));
    };
    for (const w of workers) feed(w);
  });
  for (const w of workers) w.terminate();
  console.log('deepest level solved in', ((Date.now() - t0) / 1000).toFixed(0) + 's');

  // 3) minimax upwards
  const vals = [];
  vals[LMAX] = new Map(); for (let i = 0; i < deepKeys.length; i++) vals[LMAX].set(deepKeys[i], deepVals[i]);
  for (let n = LMAX - 1; n >= 0; n--) {
    const m = new Map(), p = n & 1;
    for (const [k, seq] of levels[n]) {
      const cols = board(seq); let best = -1;
      for (let c = 0; c < 7 && best < 2; c++) {
        if (cols[c].length >= 6) continue;
        if (wins(cols, c, p)) { best = 2; break; }
        cols[c].push(p);
        const v = 2 - vals[n + 1].get(keyOf(cols, 1 - p));
        cols[c].pop();
        if (v > best) best = v;
      }
      m.set(k, best);
    }
    vals[n] = m;
  }
  console.log('root value', vals[0].get(keyOf(board(''), 0)), '(2 = first player wins)');
  const tally = [0, 0, 0]; for (const v of vals[LMAX].values()) tally[v]++;
  console.log('level', LMAX, 'L/D/W for side to move:', tally.join(' / '));

  // 4) static xor function over all keys
  const keys = [], vv = [];
  for (let n = 0; n <= LMAX; n++) for (const [k, v] of vals[n]) { keys.push(k); vv.push(v); }
  const N = keys.length, segLen = Math.ceil(1.23 * N / 3) + 16, M = 3 * segLen;
  const mix = (lo, hi, seed) => {
    let h = seed ^ Math.imul(lo, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
    h ^= Math.imul((hi + 0x7F4A7C15) | 0, 0xC2B2AE35);
    h = Math.imul(h ^ (h >>> 13), 0x27D4EB2F);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const cellsOf = (key, seed, out) => {
    const lo = key % 67108864, hi = Math.floor(key / 67108864);
    for (let i = 0; i < 3; i++) out[i] = mix(lo, hi, (seed + Math.imul(i, 0x632BE5AB)) | 0) % segLen + i * segLen;
  };
  let T = null, seed = 0;
  for (seed = 1; seed < 50 && !T; seed++) {
    const cnt = new Int32Array(M), acc = new Int32Array(M), h = [0, 0, 0];
    for (let i = 0; i < N; i++) { cellsOf(keys[i], seed, h); for (const x of h) { cnt[x]++; acc[x] ^= i; } }
    const stackCell = new Int32Array(N), stackKey = new Int32Array(N); let sp = 0;
    const queue = []; for (let x = 0; x < M; x++) if (cnt[x] === 1) queue.push(x);
    while (queue.length) {
      const x = queue.pop();
      if (cnt[x] !== 1) continue;
      const i = acc[x];
      stackCell[sp] = x; stackKey[sp++] = i;
      cellsOf(keys[i], seed, h);
      for (const y of h) { cnt[y]--; acc[y] ^= i; if (cnt[y] === 1) queue.push(y); }
    }
    if (sp !== N) { console.log('seed', seed, 'failed, peeled', sp, 'of', N); continue; }
    T = new Uint8Array(M);
    for (let s = N - 1; s >= 0; s--) {
      const i = stackKey[s]; cellsOf(keys[i], seed, h);
      T[stackCell[s]] = vv[i] ^ T[h[0]] ^ T[h[1]] ^ T[h[2]];
    }
    // full self-check
    for (let i = 0; i < N; i++) { cellsOf(keys[i], seed, h); if ((T[h[0]] ^ T[h[1]] ^ T[h[2]]) !== vv[i]) throw new Error('self-check failed'); }
    break;
  }
  if (!T) throw new Error('could not build table');
  const packed = new Uint8Array(Math.ceil(M / 4));
  for (let x = 0; x < M; x++) packed[x >> 2] |= T[x] << ((x & 3) * 2);
  fs.writeFileSync(new URL('./book4.json', import.meta.url), JSON.stringify({ n: N, segLen, seed, lmax: LMAX, data: Buffer.from(packed).toString('base64') }));
  // sample for independent verification: random positions with their propagated values
  const sample = [];
  for (let n = 5; n < LMAX; n++) { const arr = [...levels[n]]; for (let t = 0; t < 150; t++) { const [k, seq] = arr[Math.floor(Math.random() * arr.length)]; sample.push([seq, vals[n].get(k)]); } }
  fs.writeFileSync(new URL('./book4_sample.json', import.meta.url), JSON.stringify(sample));
  console.log('keys', N, 'cells', M, 'bytes', packed.length, 'seed', seed);
}
