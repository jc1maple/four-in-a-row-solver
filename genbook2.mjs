// Coaching book for the "human moves first" mode.
// For every position P where the human is to move (even stone count, up to MAX_STONES) and every
// column m, stores the game-theoretic value of playing m for the human (w/d/l) and the AI's reply.
// The tree follows the AI's stored reply, so it has at most 7 children per node.
// Entry format per column: 'x' illegal | 'W' human wins on the spot |
//   <w|d|l><reply digit 1-7>[!]   ('!' = the reply ends the game)
import fs from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const ORDER = [3, 2, 4, 1, 5, 0, 6];

if (!isMainThread) {
  const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  const S = instance.exports;
  S.init(8388617);
  const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };
  const solveTask = (P, m) => {
    setup(P);
    if (!S.canPlay(m)) return 'x';
    if (S.isWinningMove(m)) return 'W';
    const Q = P + (m + 1);
    setup(Q);
    for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return 'l' + (c + 1) + '!';
    const w = S.solve(true);                       // value for the AI (side to move at Q)
    const last = Q.length === 41;
    if (w > 0 || w === 0) {
      for (const c of ORDER) {
        setup(Q);
        if (!S.canPlay(c)) continue;
        S.play(c);
        if (S.getMoves() === 42) { if (w === 0) return 'd' + (c + 1) + '!'; continue; }
        if (S.canWinNext()) continue;
        const ok = w > 0 ? S.search(-1, 0) <= -1 : S.search(0, 1) <= 0;
        if (ok) return (w > 0 ? 'l' : 'd') + (c + 1);
      }
      throw new Error('no reply found at ' + Q + ' w=' + w);
    }
    // AI is lost: put up the longest possible resistance (exact solve)
    setup(Q);
    const sc = S.solve(false);
    let fallback = -1;
    for (const c of ORDER) {
      setup(Q);
      if (!S.canPlay(c)) continue;
      if (fallback < 0) fallback = c;
      S.play(c);
      if (S.canWinNext()) continue;
      if (S.search(-sc, -sc + 1) <= -sc) return 'w' + (c + 1);
    }
    return 'w' + (fallback + 1);
  };
  parentPort.on('message', ({ P, m }) => {
    const t = Date.now();
    parentPort.postMessage({ P, m, r: solveTask(P, m), ms: Date.now() - t });
  });
  parentPort.postMessage({ ready: true });
} else {
  const MAX_STONES = +process.argv[2] || 12;
  const NW = +process.argv[3] || 22;
  const bookFile = new URL('./book2.json', import.meta.url);
  const oldFile = new URL('./book2_weak.json', import.meta.url);
  const old = fs.existsSync(oldFile) ? JSON.parse(fs.readFileSync(oldFile, 'utf8')) : {};
  const book = {};

  const workers = [];
  for (let i = 0; i < NW; i++) workers.push(new Worker(new URL(import.meta.url)));
  await Promise.all(workers.map(w => new Promise(r => w.once('message', r))));

  const runTasks = tasks => new Promise(resolve => {
    const results = []; let next = 0, done = 0;
    if (!tasks.length) return resolve(results);
    const feed = w => { if (next < tasks.length) w.postMessage(tasks[next++]); };
    for (const w of workers) {
      w.removeAllListeners('message');
      w.on('message', msg => {
        results.push(msg); done++;
        if (done === tasks.length) resolve(results); else feed(w);
      });
      feed(w);
    }
  });

  let level = [''];
  for (let stones = 0; stones <= MAX_STONES; stones += 2) {
    const t0 = Date.now();
    const tasks = [];
    const tmp = {};
    for (const P of level) for (let m = 0; m < 7; m++) {
      const o = old[P] && old[P][m];
      if (o && o[0] !== 'w') (tmp[P] ||= [])[m] = o; else tasks.push({ P, m });
    }
    const res = await runTasks(tasks);
    let maxMs = 0;
    for (const r of res) { (tmp[r.P] ||= [])[r.m] = r.r; maxMs = Math.max(maxMs, r.ms); }
    for (const P in tmp) book[P] = tmp[P];
    fs.writeFileSync(bookFile, JSON.stringify(book));
    console.log(`stones=${stones} nodes=${level.length} tasks=${tasks.length} wall=${((Date.now() - t0) / 1000).toFixed(1)}s maxMs=${maxMs}`);
    const nextLevel = [];
    for (const P of level) for (let m = 0; m < 7; m++) {
      const e = book[P][m];
      if (e === 'x' || e === 'W' || e.endsWith('!')) continue;
      nextLevel.push(P + (m + 1) + e[1]);
    }
    level = nextLevel;
  }
  for (const w of workers) w.terminate();
}
