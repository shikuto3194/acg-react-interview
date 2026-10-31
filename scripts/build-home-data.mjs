// acgtcg.com/index.html と /index_event.html を取得・解析して
// src/homeData.generated.js を生成する。build-qa-data.mjs と同じ仕組み。
//
// 使い方:
//   node scripts/build-home-data.mjs [--offline]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHomeHtml, parseEventsHtml } from '../src/homeParser.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const outFile = resolve(projectRoot, 'src', 'homeData.generated.js');
const cacheDir = resolve(projectRoot, 'tmp_acg_html');
const cacheIndex = resolve(cacheDir, 'index.html');
const cacheEvent = resolve(cacheDir, 'index_event.html');

const OFFLINE = process.argv.includes('--offline');
const HOME_URL = 'https://acgtcg.com/';
const EVENT_URL = 'https://acgtcg.com/index_event.html';

async function loadHtml(url, cacheFile, label) {
  if (OFFLINE) {
    try {
      const cached = await readFile(cacheFile, 'utf8');
      console.log(`[${label}] offline: using cached ${cacheFile}`);
      return { html: cached, source: 'cache', lastModified: '' };
    } catch {
      console.log(`[${label}] offline: cache miss → falling through to network`);
    }
  }
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (acg-react homedata builder)' },
  });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const html = await r.text();
  const lastModified = r.headers.get('last-modified') || '';
  await mkdir(cacheDir, { recursive: true }).catch(() => {});
  await writeFile(cacheFile, html).catch(() => {});
  return { html, source: 'network', lastModified };
}

async function main() {
  const { html, source, lastModified } = await loadHtml(HOME_URL, cacheIndex, 'home');
  const parsed = parseHomeHtml(html);
  console.log(`[home] news=${parsed.news.length} products=${parsed.products.length}`);
  if (parsed.news.length === 0 && parsed.products.length === 0) {
    throw new Error('[home] parser produced zero items — refusing to write');
  }

  // イベント一覧は取得失敗しても致命的ではないので、空で続行する。
  let events = [];
  let eventsMeta = { source: 'none', lastModified: '', sourceUrl: EVENT_URL };
  try {
    const { html: eHtml, source: eSource, lastModified: eLM } =
      await loadHtml(EVENT_URL, cacheEvent, 'events');
    const eParsed = parseEventsHtml(eHtml);
    events = eParsed.events;
    eventsMeta = { source: eSource, lastModified: eLM, sourceUrl: EVENT_URL };
    console.log(`[events] events=${events.length}`);
  } catch (e) {
    console.warn(`[events] failed: ${e.message} — continuing with empty events list`);
  }

  const meta = {
    source,
    lastModified,
    fetchedAt: parsed.fetchedAt,
    sourceUrl: HOME_URL,
    events: eventsMeta,
  };
  const content =
    '// 自動生成ファイル。scripts/build-home-data.mjs が acgtcg.com/ から生成する。\n' +
    '// 手で編集しないこと。\n' +
    `export const homeMeta = ${JSON.stringify(meta, null, 2)};\n\n` +
    `export const homeNews = ${JSON.stringify(parsed.news, null, 2)};\n\n` +
    `export const homeProducts = ${JSON.stringify(parsed.products, null, 2)};\n\n` +
    `export const homeEvents = ${JSON.stringify(events, null, 2)};\n`;
  await writeFile(outFile, content, 'utf8');
  console.log(`[home] wrote ${outFile} (${content.length.toLocaleString()} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
