// acgtcg.com/QA.html を取得・解析して src/qaData.generated.js を生成する。
// build-card-data.mjs と同様のキャッシュ機構（tmp_acg_html/QA.html）を持つ。
//
// 使い方:
//   node scripts/build-qa-data.mjs [--offline]
//     --offline : tmp_acg_html/QA.html が存在すればそれを使う

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQaHtml } from '../src/qaParser.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const outFile = resolve(projectRoot, 'src', 'qaData.generated.js');
const cacheDir = resolve(projectRoot, 'tmp_acg_html');
const cacheFile = resolve(cacheDir, 'QA.html');

const OFFLINE = process.argv.includes('--offline');
const URL = 'https://acgtcg.com/QA.html';

async function loadHtml() {
  if (OFFLINE) {
    try {
      const cached = await readFile(cacheFile, 'utf8');
      console.log(`[qa] offline: using cached ${cacheFile}`);
      return { html: cached, source: 'cache', lastModified: '' };
    } catch {
      console.log('[qa] offline: cache miss → falling through to network');
    }
  }
  const r = await fetch(URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (acg-react qadata builder)' },
  });
  if (!r.ok) throw new Error(`${URL} -> ${r.status}`);
  const html = await r.text();
  const lastModified = r.headers.get('last-modified') || '';
  await mkdir(cacheDir, { recursive: true }).catch(() => {});
  await writeFile(cacheFile, html).catch(() => {});
  return { html, source: 'network', lastModified };
}

function summarize(parsed) {
  const total = parsed.sections.reduce((acc, s) => acc + s.entries.length, 0);
  console.log(`[qa] ${parsed.sections.length} sections / ${total} entries`);
  for (const s of parsed.sections) {
    console.log(`     - ${s.title}: ${s.entries.length} entries (公開=${s.publishedAt || '?'}, 更新=${s.updatedAt || '-'})`);
  }
}

async function main() {
  const { html, source, lastModified } = await loadHtml();
  const parsed = parseQaHtml(html);
  summarize(parsed);
  if (parsed.sections.length === 0) {
    throw new Error('[qa] parser produced zero sections — refusing to write');
  }
  const meta = {
    source,
    lastModified,
    fetchedAt: parsed.fetchedAt,
    sourceUrl: URL,
  };
  // qaFlat / default は使用されないので出力しない（バンドルサイズ半減）。
  // インデントも省いてさらに圧縮（gzip 効果は小さいがパース時間に効く）。
  const content =
    '// 自動生成ファイル。scripts/build-qa-data.mjs が acgtcg.com/QA.html から生成する。\n' +
    '// 手で編集しないこと。\n' +
    `export const qaMeta = ${JSON.stringify(meta)};\n` +
    `export const qaSections = ${JSON.stringify(parsed.sections)};\n`;
  await writeFile(outFile, content, 'utf8');
  console.log(`[qa] wrote ${outFile} (${content.length.toLocaleString()} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
