// Packs book.json + solver.wasm into a single self-contained HTML file.
// usage: node build.mjs <bookMaxStones>
import fs from 'node:fs';
const BOOK_MAX = +process.argv[2];
const book = JSON.parse(fs.readFileSync(new URL('./book.json', import.meta.url), 'utf8'));
const wasm = fs.readFileSync(new URL('./solver.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, { env: { abort() { throw new Error('abort'); } } });
const S = instance.exports; S.init(1009);

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
let html = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8');
html = html.replace('/*BOOK_MAX*/0', String(BOOK_MAX)).replace('/*BOOK*/', out).replace('/*WASM*/', wasm.toString('base64'));
fs.writeFileSync(new URL('./four-in-a-row.html', import.meta.url), html);
console.log('book entries', count, 'encoded chars', out.length, 'html bytes', html.length);
