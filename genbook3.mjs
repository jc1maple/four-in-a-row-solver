// Coaching book for the "AI moves first" mode (AI opens in the centre column).
// For every position H where the human is to move (odd stone count, up to MAX_STONES) and every
// column m: how many more stones the AI needs to connect four after m with best play (j), and the
// AI's fastest winning reply. The tree follows that reply.
// Entry per column: 'x' illegal | '<j>:<reply digit 1-7>[!]'   ('!' = the reply wins on the spot)
import fs from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const ORDER = [3, 2, 4, 1, 5, 0, 6];

if (!isMainThread) {
  const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  const S = instance.exports;
  S.init(8388617);
  const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };
  const solveTask = (H, m) => {
    setup(H);
    if (!S.canPlay(m)) return 'x';
    if (S.isWinningMove(m)) throw new Error('human can win at ' + H + ' col ' + (m + 1));
    const Q = H + (m + 1);
    setup(Q);
    for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) return '1:' + (c + 1) + '!';
    const s = S.solve(false);
    if (s <= 0) throw new Error('AI is not winning at ' + Q + ' score ' + s);
    const j = 22 - s - (H.length + 1) / 2;
    for (const c of ORDER) {
      setup(Q);
      if (!S.canPlay(c)) continue;
      S.play(c);
      if (S.canWinNext()) continue;
      if (S.search(-s, -s + 1) <= -s) return j + ':' + (c + 1);
    }
    throw new Error('no reply found at ' + Q);
  };
  parentPort.on('message', ({ P, m }) => {
    const t = Date.now();
    parentPort.postMessage({ P, m, r: solveTask(P, m), ms: Date.now() - t });
  });
  parentPort.postMessage({ ready: true });
} else {
  const MAX_STONES = +process.argv[2] || 13;
  const NW = +process.argv[3] || 22;
  const bookFile = new URL('./book3.json', import.meta.url);
  const book = fs.existsSync(bookFile) ? JSON.parse(fs.readFileSync(bookFile, 'utf8')) : {};

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

  let level = ['4'];
  for (let stones = 1; stones <= MAX_STONES; stones += 2) {
    const t0 = Date.now();
    const tasks = [];
    for (const P of level) if (!(P in book)) for (let m = 0; m < 7; m++) tasks.push({ P, m });
    const res = await runTasks(tasks);
    let maxMs = 0;
    const tmp = {};
    for (const r of res) { (tmp[r.P] ||= [])[r.m] = r.r; maxMs = Math.max(maxMs, r.ms); }
    for (const P in tmp) book[P] = tmp[P];
    fs.writeFileSync(bookFile, JSON.stringify(book));
    console.log(`stones=${stones} nodes=${level.length} tasks=${tasks.length} wall=${((Date.now() - t0) / 1000).toFixed(1)}s maxMs=${maxMs}`);
    const nextLevel = [];
    for (const P of level) for (let m = 0; m < 7; m++) {
      const e = book[P][m];
      if (e === 'x' || e.endsWith('!')) continue;
      nextLevel.push(P + (m + 1) + e.split(':')[1]);
    }
    level = nextLevel;
  }
  for (const w of workers) w.terminate();
}
