// Counts how many distinct positions a first player has to know to follow this page's winning strategy
// (open in the centre, then always the fastest win; ties broken centre-first), against every possible defence.
// Breadth-first over positions with the second player to move, merging move orders that give the same board.
import fs from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const ORDER = [3, 2, 4, 1, 5, 0, 6];

if (!isMainThread) {
  const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
  const book = JSON.parse(fs.readFileSync(new URL('./book3.json', import.meta.url), 'utf8'));
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  const S = instance.exports;
  S.init(8388617);
  const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };
  const one = (H, m) => {                       // -> reply digit, negative if the reply wins at once, 0 if illegal
    setup(H);
    if (!S.canPlay(m)) return 0;
    const Q = H + (m + 1);
    setup(Q);
    for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return -(c + 1);
    const s = S.solve(false);
    for (const c of ORDER) {
      setup(Q);
      if (!S.canPlay(c)) continue;
      S.play(c);
      if (S.canWinNext()) continue;
      if (S.search(-s, -s + 1) <= -s) return c + 1;
    }
    throw new Error('no reply at ' + Q);
  };
  parentPort.on('message', batch => {
    const out = [];
    for (const H of batch) {
      const b = book[H];
      if (b) out.push(b.map(x => x === 'x' ? 0 : (x.endsWith('!') ? -1 : 1) * +x.replace('!', '').split(':')[1]));
      else out.push([0, 1, 2, 3, 4, 5, 6].map(m => one(H, m)));
    }
    parentPort.postMessage(out);
  });
  parentPort.postMessage('ready');
} else {
  const NW = 22, BATCH = 200;
  const workers = [];
  for (let i = 0; i < NW; i++) workers.push(new Worker(new URL(import.meta.url)));
  await Promise.all(workers.map(w => new Promise(r => w.once('message', r))));

  const key = seq => {                          // board identity independent of move order
    const cols = ['', '', '', '', '', '', ''];
    for (let i = 0; i < seq.length; i++) cols[seq.charCodeAt(i) - 49] += (i & 1);
    return cols.join('|');
  };
  const run = level => new Promise(resolve => {
    const res = new Array(level.length); let next = 0, done = 0;
    const feed = w => {
      if (next >= level.length) return;
      const start = next; next += BATCH;
      w.removeAllListeners('message');
      w.once('message', out => {
        for (let i = 0; i < out.length; i++) res[start + i] = out[i];
        done += out.length;
        if (done === level.length) resolve(res); else feed(w);
      });
      w.postMessage(level.slice(start, start + BATCH));
    };
    for (const w of workers) feed(w);
  });

  let level = ['4'], totalDecide = 1, totalNonTrivial = 1, totalLines = 0;   // the opening move counts as one
  console.log('stones  positions-to-know  of-which-not-an-immediate-win');
  console.log('0  1  1');
  for (let stones = 1; level.length; stones += 2) {
    const t0 = Date.now();
    const res = await run(level);
    const seenQ = new Set(), nextSet = new Map();
    let trivial = 0, nonTrivial = 0;
    for (let i = 0; i < level.length; i++) for (let m = 0; m < 7; m++) {
      const r = res[i][m];
      if (r === 0) continue;
      const Q = level[i] + (m + 1), kq = key(Q);
      if (seenQ.has(kq)) continue;
      seenQ.add(kq);
      if (r < 0) { trivial++; totalLines++; continue; }
      nonTrivial++;
      const H2 = Q + r, k2 = key(H2);
      if (!nextSet.has(k2)) nextSet.set(k2, H2);
    }
    totalDecide += trivial + nonTrivial; totalNonTrivial += nonTrivial;
    console.log(`${stones + 1}  ${trivial + nonTrivial}  ${nonTrivial}  (${((Date.now() - t0) / 1000).toFixed(0)}s, running total ${totalDecide} / ${totalNonTrivial})`);
    level = [...nextSet.values()];
    if (level.length > 6_000_000) { console.log('ABORT: level too large', level.length); break; }
  }
  console.log(`TOTAL positions to know: ${totalDecide}; not counting immediate wins: ${totalNonTrivial}`);
  for (const w of workers) w.terminate();
}
