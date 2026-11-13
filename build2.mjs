// Packs both books + solver.wasm into one self-contained HTML file.
// usage: node build2.mjs <aiBookMaxStones> <coachBookMaxStones>
import fs from 'node:fs';
const BOOK_MAX = +process.argv[2], BOOK2_MAX = +process.argv[3];
const here = p => new URL(p, import.meta.url);
const book = JSON.parse(fs.readFileSync(here('./book.json'), 'utf8'));
const book2 = JSON.parse(fs.readFileSync(here('./book2.json'), 'utf8'));
const wasm = fs.readFileSync(here('./solver.wasm'));
const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
const S = instance.exports; S.init(1009);

// AI-first book
let out = '', count = 0;
function node(seq) {
  const e = book[seq];
  if (!e) throw new Error('book is missing ' + seq);
  count++;
  if (e[0] === 'W') { out += e[1] + 'W'; return; }
  out += e;
  if (seq.length >= BOOK_MAX) return;
  for (let c = 1; c <= 7; c++) {
    S.reset(); for (const ch of seq + e) S.play(+ch - 1);
    if (!S.canPlay(c - 1)) { out += '-'; continue; }
    node(seq + e + c);
  }
}
node('');

// coaching book: one char per column, code = rank*14 + reply*2 + terminal; 42 illegal; 43 human wins now
const parts = []; let count2 = 0;
const RANK = { l: 0, d: 1, w: 2 };
function node2(seq) {
  const e = book2[seq];
  if (!e) throw new Error('book2 is missing ' + seq);
  count2++;
  let s = ''; const kids = [];
  for (let c = 0; c < 7; c++) {
    const x = e[c];
    let code;
    if (x === 'x') code = 42;
    else if (x === 'W') code = 43;
    else {
      const term = x.endsWith('!') ? 1 : 0, reply = +x[1] - 1;
      code = RANK[x[0]] * 14 + reply * 2 + term;
      if (!term) kids.push(seq + (c + 1) + x[1]);
    }
    s += String.fromCharCode(48 + code);
  }
  parts.push(s);
  if (seq.length >= BOOK2_MAX) return;
  for (const k of kids) node2(k);
}
node2('');
const out2 = parts.join('');
if (/["\\<]\//.test(out2) || out2.includes('"') || out2.includes('\\')) throw new Error('unsafe char in book2 encoding');

let html = fs.readFileSync(here('./template2.html'), 'utf8');
const put = (k, v) => { if (!html.includes(k)) throw new Error('placeholder missing ' + k); html = html.replace(k, () => v); };
put('/*BOOK_MAX*/0', String(BOOK_MAX));
put('/*BOOK*/', out);
put('/*BOOK2_MAX*/0', String(BOOK2_MAX));
put('/*BOOK2*/', out2);
put('/*WASM*/', wasm.toString('base64'));
fs.writeFileSync(here('./four-in-a-row.html'), html);
console.log('ai book', count, 'coach book', count2, 'html bytes', html.length);
