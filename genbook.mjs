// Builds the first-player winning strategy book, level by level, with a worker pool.
// A book entry maps the full move sequence (digits 1-7) at a first-player turn -> winning column digit.
import fs from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const ORDER = [3, 2, 4, 1, 5, 0, 6];

if (!isMainThread) {
  const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  const S = instance.exports;
  S.init(8388617);
  const setup = seq => { S.reset(); for (const ch of seq) S.play(+ch - 1); };
  parentPort.on('message', seq => {
    const t = Date.now();
    setup(seq);
    let move = -1, terminal = false;
    for (const c of ORDER) if (S.canPlay(c) && S.isWinningMove(c)) { move = c; terminal = true; break; }
    if (move < 0) {
      for (const c of ORDER) {
        if (!S.canPlay(c)) continue;
        setup(seq); S.play(c);
        if (S.canWinNext()) continue;
        if (S.search(-1, 0) <= -1) { move = c; break; }   // opponent to move is proven lost
      }
    }
    parentPort.postMessage({ seq, move, terminal, ms: Date.now() - t });
  });
  parentPort.postMessage({ ready: true });
} else {
  const MAX_STONES = +process.argv[2] || 12;
  const NW = +process.argv[3] || 22;
  const bookFile = new URL('./book.json', import.meta.url);
  const book = fs.existsSync(bookFile) ? JSON.parse(fs.readFileSync(bookFile, 'utf8')) : {};
  const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
  const S = instance.exports; S.init(1009);
  const legalReplies = seq => {
    S.reset(); for (const ch of seq) S.play(+ch - 1);
    const out = [];
    for (let c = 0; c < 7; c++) if (S.canPlay(c)) {
      if (S.isWinningMove(c)) throw new Error('opponent can win after ' + seq);
      out.push(c);
    }
    return out;
  };

  const workers = [];
  for (let i = 0; i < NW; i++) workers.push(new Worker(new URL(import.meta.url)));
  await Promise.all(workers.map(w => new Promise(r => w.once('message', r))));

  const runLevel = tasks => new Promise(resolve => {
    const results = []; let next = 0, done = 0;
    if (!tasks.length) return resolve(results);
    const feed = w => { if (next < tasks.length) w.postMessage(tasks[next++]); };
    for (const w of workers) {
      w.removeAllListeners('message');
      w.on('message', m => {
        results.push(m); done++;
        if (done === tasks.length) resolve(results); else feed(w);
      });
      feed(w);
    }
  });

  let level = [''];
  for (let stones = 0; stones <= MAX_STONES; stones += 2) {
    const t0 = Date.now();
    const todo = level.filter(s => !(s in book));
    const res = await runLevel(todo);
    let maxMs = 0, sumMs = 0;
    for (const r of res) {
      if (r.move < 0) throw new Error('NO WINNING MOVE at ' + r.seq);
      book[r.seq] = (r.terminal ? 'W' : '') + (r.move + 1);
      maxMs = Math.max(maxMs, r.ms); sumMs += r.ms;
    }
    fs.writeFileSync(bookFile, JSON.stringify(book));
    console.log(`stones=${stones} nodes=${level.length} solved=${res.length} wall=${((Date.now() - t0) / 1000).toFixed(1)}s maxMs=${maxMs} avgMs=${res.length ? (sumMs / res.length).toFixed(0) : 0}`);
    const nextLevel = [];
    for (const s of level) {
      const e = book[s];
      if (e[0] === 'W') continue;
      const s2 = s + e;
      for (const c of legalReplies(s2)) nextLevel.push(s2 + (c + 1));
    }
    level = nextLevel;
  }
  for (const w of workers) w.terminate();
}
