import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const inventory = JSON.parse(await readFile('dist/image-assets.json', 'utf8'));
for (const entry of Object.values(inventory)) {
  const image = await readFile(`dist/images/${entry.path}`);
  assert.equal(image.length, entry.bytes);
  assert.equal(createHash('sha256').update(image).digest('hex').slice(0, 16), entry.hash);
}
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const visited = new Set();
async function check(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const entry = manifest[key];
  assert.ok(entry, `Missing chunk ${key}`);
  assert.ok(!/jspdf|html2canvas|pdf-tools/i.test(key + entry.file), `Eager PDF chunk: ${key}`);
  assert.ok((await stat(`dist/${entry.file}`)).isFile());
  for (const child of entry.imports || []) await check(child);
}
// App can itself be lazy: check its static imports as well as the HTML entry.
for (const [key, entry] of Object.entries(manifest)) if (entry.isEntry || key.endsWith('/App.jsx')) await check(key);
console.log(`[distribution] ${Object.keys(inventory).length} images verified; PDF deferred`);
