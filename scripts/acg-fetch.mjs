import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BASE } from './acg-cardlists.mjs';

// 本文受信もタイムアウトの対象にする。404 等は再試行しない。
export async function fetchContent(url, {
  binary = false, fetchImpl = fetch, timeoutMs = 15000, attempts = 3,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable = true;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 (acg-react card sync)' },
      });
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        throw new Error(`${url} -> ${response.status}`);
      }
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
    } catch (error) {
      if (!retryable || attempt === attempts) throw error;
      await delay(250 * attempt);
    }
  }
}

export function createPageReader({ cacheDir, offline = false, fetchImpl = fetch, log = console.warn }) {
  const pages = new Map();
  return async function readPage(page) {
    if (pages.has(page)) return pages.get(page);
    // 発見したページ名だけをキャッシュへ保存する。
    if (!/^[a-z0-9_]+\.html$/i.test(page)) throw new Error(`Invalid page: ${page}`);
    const cached = resolve(cacheDir, page);
    let html;
    if (offline) {
      html = await readFile(cached, 'utf8');
    } else {
      try {
        html = await fetchContent(new URL(page, BASE).href, { fetchImpl });
        if (!html.trim()) throw new Error(`Empty page: ${page}`);
        await mkdir(cacheDir, { recursive: true });
        await writeFile(cached, html);
      } catch (error) {
        try {
          html = await readFile(cached, 'utf8');
          log(`[cache] ${page}: 取得失敗 → 保存済みHTMLを使用 (${error.message})`);
        } catch {
          throw error;
        }
      }
    }
    pages.set(page, html);
    return html;
  };
}
