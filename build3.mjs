// Packs both coaching books + solver.wasm into one self-contained HTML file.
// usage: node build3.mjs <humanFirstBookMaxStones> <aiFirstBookMaxStones>
import fs from 'node:fs';
const BOOK2_MAX = +process.argv[2], BOOK3_MAX = +process.argv[3];
const here = p => new URL(p, import.meta.url);
const read = p => fs.readFileSync(here(p), 'utf8');
const book2 = JSON.parse(read('./book2.json'));
const book3 = JSON.parse(read('./book3.json'));
const wasm = fs.readFileSync(here('./solver.wasm'));

// human-first book: one char per column, code = rank*14 + reply*2 + terminal; 42 illegal; 43 human wins now
const RANK = { l: 0, d: 1, w: 2 };
const parts2 = [];
(function node2(seq) {
  const e = book2[seq];
  if (!e) throw new Error('book2 is missing ' + seq);
  let s = ''; const kids = [];
  for (let c = 0; c < 7; c++) {
    const x = e[c];
    let code;
    if (x === 'x') code = 42;
    else if (x === 'W') code = 43;
    else {
      const term = x.endsWith('!') ? 1 : 0;
      code = RANK[x[0]] * 14 + (+x[1] - 1) * 2 + term;
      if (!term) kids.push(seq + (c + 1) + x[1]);
    }
    s += String.fromCharCode(48 + code);
  }
  parts2.push(s);
  if (seq.length >= BOOK2_MAX) return;
  for (const k of kids) node2(k);
})('');

// AI-first book: two chars per column: (48 + j, 0 = illegal), (48 + reply*2 + terminal)
const parts3 = [];
(function node3(seq) {
  const e = book3[seq];
  if (!e) throw new Error('book3 is missing ' + seq);
  let s = ''; const kids = [];
  for (let c = 0; c < 7; c++) {
    const x = e[c];
    if (x === 'x') { s += '00'; continue; }
    const term = x.endsWith('!') ? 1 : 0;
    const [j, r] = x.replace('!', '').split(':').map(Number);
    if (!(j >= 1 && j <= 21 && r >= 1 && r <= 7)) throw new Error('bad entry ' + x + ' at ' + seq);
    s += String.fromCharCode(48 + j) + String.fromCharCode(48 + (r - 1) * 2 + term);
    if (!term) kids.push(seq + (c + 1) + r);
  }
  parts3.push(s);
  if (seq.length >= BOOK3_MAX) return;
  for (const k of kids) node3(k);
})('4');

const out2 = parts2.join(''), out3 = parts3.join('');
for (const o of [out2, out3]) if (o.includes('"') || o.includes('\\') || o.includes('/')) throw new Error('unsafe char in book encoding');

let html = read('./part_head.html') + read('./part_body3.html') + read('./part_worker.html') + read('./part_script3.html');
const put = (k, v) => { if (!html.includes(k)) throw new Error('placeholder missing ' + k); html = html.replace(k, () => v); };
put('/*BOOK2_MAX*/0', String(BOOK2_MAX));
put('/*BOOK2*/', out2);
put('/*BOOK3_MAX*/0', String(BOOK3_MAX));
put('/*BOOK3*/', out3);
put('/*WASM*/', wasm.toString('base64'));
fs.writeFileSync(here('./four-in-a-row.html'), html);
console.log('human-first nodes', parts2.length, 'ai-first nodes', parts3.length, 'html bytes', html.length);
