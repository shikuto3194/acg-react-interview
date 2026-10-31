import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rmdir, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { parseCardlistNav, discoverSources } from './acg-cardlists.mjs';
import { mergeCardSources } from './acg-card-images.mjs';
import { createPageReader, fetchContent } from './acg-fetch.mjs';
import { assertSafeCardUpdate, resolveReprint, selectCardImages } from './acg-import-validation.mjs';
import { parseDetailPage } from './build-card-data.mjs';
import { downloadCardImages } from './fetch-acg-images.mjs';
import { needsWebpConversion } from './convert-images-to-webp.mjs';

const quiet = () => {};
const placeholder = cardNumber => ({ cardNumber, name: cardNumber, effectPending: true });
async function tempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'acg-card-sync-test-'));
  t.after(async () => {
    for (const file of await readdir(directory)) await unlink(join(directory, file));
    await rmdir(directory);
  });
  return directory;
}

test('カードリストのクエリ・アンカーを正規化し外部リンクを除外、一部ナビでも既知弾を残す', async () => {
  const html = `<a href="/cardlist_BP7.html?v=2#cards">第7弾</a>
    <a href="https://acgtcg.com/cardlist_BP7.html">重複</a>
    <a href="https://example.com/cardlist_BP8.html">外部</a>`;
  assert.deepEqual(parseCardlistNav(html), [{ page: 'cardlist_BP7.html', prefix: 'BP7', text: '第7弾' }]);
  const sources = await discoverSources(async page => page === '_cardlist.html' ? html : '', { log: quiet });
  assert.ok(sources.packPages.includes('cardlist_BP7.html'));
  assert.ok(sources.packPages.includes('cardlist_BP1.html'));
  assert.ok(sources.packPages.includes('cardlist_SD2.html'));
});

test('詳細HTMLの属性順・追加クラス・半角括弧を許容し名前と本文を分離する', () => {
  const cards = parseDetailPage(`<div id="card" class="extra cardlist_flex">
    <div><p class="body"><font title="name" class="extra cardlist_name">新カード(BP7-001)</font><br>
    ［コスト：3］［条件：水水］［タイプ：動物］［種属：海洋］<br><br>効果本文</p></div></div><hr>`);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].cardNumber, 'BP7-001');
  assert.equal(cards[0].name, '新カード');
  assert.equal(cards[0].effect, '効果本文');
  assert.equal(cards[0].cost, 3);
});

test('再録の方に訂正版・詳細があっても既存カードの採用番号を維持する', () => {
  const original = { cardNumber: 'BP7-001', name: '同じ名前', effectPending: true };
  const reprint = { cardNumber: 'BP8-080_T', name: '同じ名前', effect: '公開済み本文' };
  const reprints = new Map();
  const first = mergeCardSources([reprint, original], [], placeholder, { reprints, previousCards: [original] });
  assert.deepEqual([...first.keys()], ['BP7-001']);
  assert.equal(reprints.get('BP8-080'), 'BP7-001');
  // 次回、名前表記が変わったり画像だけになっても判定済みの再録を復活させない。
  const second = mergeCardSources([original, { ...reprint, name: '表記が変わった名前' }], ['BP8-080.png'], placeholder, { reprints });
  assert.deepEqual([...second.keys()], ['BP7-001']);
});

test('名前未確認の画像は再録判定まで保留し、名前確認後に自動照合する', () => {
  const deferred = [];
  const original = { cardNumber: 'BP7-001', name: '元カード' };
  const cards = mergeCardSources([original], ['BP8-001.png', 'BP8-001_T.png', 'BP8-002.png'], number =>
    number === 'BP8-002' ? { cardNumber: number, name: '確認済み新規' } : placeholder(number),
  { requireName: true, onDeferred: number => deferred.push(number) });
  assert.deepEqual(deferred, ['BP8-001_T']);
  assert.deepEqual([...cards.keys()], ['BP7-001', 'BP8-002']);
  const reprints = new Map();
  const confirmed = mergeCardSources([original, { cardNumber: 'BP8-001', name: '元カード' }], [], placeholder, { requireName: true, reprints });
  assert.equal(confirmed.size, 1);
  assert.equal(reprints.get('BP8-001'), 'BP7-001');
});

test('既存カードの欠落・詳細の退行・訂正版の欠落を拒否し、再録統合は許可する', () => {
  const original = { cardNumber: 'BP7-001_T', name: '元カード', effect: '本文' };
  assert.throws(() => assertSafeCardUpdate([original], [], new Map()), /欠落/);
  assert.throws(() => assertSafeCardUpdate([original], [{ ...original, cardNumber: 'BP7-001' }], new Map()), /訂正版/);
  assert.throws(() => assertSafeCardUpdate([original], [{ ...original, effectPending: true }], new Map()), /詳細テキスト/);
  assert.throws(() => assertSafeCardUpdate([original], [{ ...original, effect: '' }], new Map()), /詳細テキスト/);
  assert.doesNotThrow(() => assertSafeCardUpdate([original, { cardNumber: 'BP8-001' }], [original], new Map([['BP8-001', 'BP7-001']])));
  assert.throws(() => resolveReprint('BP7-001', new Map([['BP7-001', 'BP8-001'], ['BP8-001', 'BP7-001']])), /循環/);
});

test('画像は最終カードの番号と拡張子に一致させ、再録・未訂正版をダウンロードしない', () => {
  const refs = ['BP7-001.png', 'BP7-001_T.webp', 'BP8-001.png', 'BP7-002.jpg', 'BP7-002.webp'].map(name => ({ name, url: `https://acgtcg.com/img/${name}` }));
  const selected = selectCardImages([{ cardNumber: 'BP7-001_T' }, { cardNumber: 'BP7-002' }], refs);
  assert.deepEqual([...selected.values()].map(ref => ref.name), ['BP7-001_T.webp', 'BP7-002.jpg']);
  assert.throws(() => selectCardImages([{ cardNumber: 'BP9-001' }], refs), /画像が取得対象にありません/);
});

test('一時的なHTTPエラーは再試行、404は即失敗、再試行数に上限がある', async () => {
  let calls = 0;
  const content = await fetchContent('https://acgtcg.com/index.html', {
    fetchImpl: async () => ++calls < 3 ? new Response('', { status: 503 }) : new Response('ok'),
  });
  assert.equal(content, 'ok');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(fetchContent('https://acgtcg.com/index.html', {
    fetchImpl: async () => { calls++; return new Response('', { status: 404 }); },
  }), /404/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchContent('https://acgtcg.com/index.html', {
    fetchImpl: async () => { calls++; throw new Error('connection reset'); },
  }), /connection reset/);
  assert.equal(calls, 3);
});

test('本文の受信中もタイムアウトで打ち切る', async () => {
  await assert.rejects(fetchContent('https://acgtcg.com/index.html', {
    timeoutMs: 10, attempts: 1,
    fetchImpl: async (_url, { signal }) => ({ ok: true, text: () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('遅延した本文'), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }) }),
  }), { name: 'TimeoutError' });
});

test('失敗時はHTMLキャッシュを使用し、offlineはキャッシュ欠落時も通信しない', async t => {
  const cacheDir = await tempDirectory(t);
  await writeFile(join(cacheDir, 'index.html'), 'cached');
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('network'); };
  const reader = createPageReader({ cacheDir, fetchImpl, log: quiet });
  assert.equal(await reader('index.html'), 'cached');
  assert.equal(await reader('index.html'), 'cached');
  assert.equal(calls, 3);
  const offline = createPageReader({ cacheDir, offline: true, fetchImpl });
  assert.equal(await offline('index.html'), 'cached');
  await assert.rejects(offline('missing.html'), /ENOENT/);
  assert.equal(calls, 3);
});

test('必要画像の失敗・HTML誤応答はビルドを失敗させ、正常画像は一度だけ保存する', async t => {
  const directory = await tempDirectory(t);
  const ref = { name: 'BP7-001.png', url: 'https://acgtcg.com/img/BP7-001.png' };
  await assert.rejects(downloadCardImages([ref], { directory, log: quiet, fetchBytes: async () => { throw new Error('HTTP 503'); } }), /BP7-001.png: HTTP 503/);
  await assert.rejects(downloadCardImages([ref], { directory, log: quiet, fetchBytes: async () => Buffer.from('<html>error</html>') }), /必要なカード画像/);
  assert.deepEqual(await readdir(directory), []);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  let calls = 0;
  const fetchBytes = async () => { calls++; return bytes; };
  assert.deepEqual(await downloadCardImages([ref, ref], { directory, log: quiet, fetchBytes }), { downloaded: 1, skipped: 0 });
  await downloadCardImages([ref], { directory, log: quiet, fetchBytes });
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(join(directory, ref.name)), bytes);
});

test('公式が未掲載のエラータ画像だけは公式の通常カード画像を使う', async t => {
  const directory = await tempDirectory(t);
  const ref = { name: 'BP6-017_T.png', url: 'https://acgtcg.com/img/BP6-017_T.png' };
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  const requests = [];
  const logs = [];
  const fetchBytes = async url => {
    requests.push(url);
    if (url.endsWith('BP6-017_T.png')) throw new Error(`${url} -> 404`);
    return bytes;
  };

  assert.deepEqual(await downloadCardImages([ref], { directory, log: message => logs.push(message), fetchBytes }), { downloaded: 1, skipped: 0 });
  assert.deepEqual(requests, [
    'https://acgtcg.com/img/BP6-017_T.png',
    'https://acgtcg.com/img/BP6-017.png',
  ]);
  assert.ok(logs.some(message => message.includes('using card art BP6-017.png')));
  assert.deepEqual(await readFile(join(directory, ref.name)), bytes);
});

test('offlineで画像が欠けていたら通信せず失敗し、空ファイルも成功扱いしない', async t => {
  const directory = await tempDirectory(t);
  const ref = { name: 'BP7-001.png', url: 'https://acgtcg.com/img/BP7-001.png' };
  await writeFile(join(directory, ref.name), '');
  let called = false;
  await assert.rejects(downloadCardImages([ref], { directory, log: quiet, offline: true, fetchBytes: async () => { called = true; } }), /保存済み画像がありません/);
  assert.equal(called, false);
});

test('元画像が更新されたら古いWebPを再変換する', async t => {
  const directory = await tempDirectory(t);
  const src = join(directory, 'card.png');
  const dst = join(directory, 'card.webp');
  await writeFile(src, 'source');
  assert.equal(await needsWebpConversion(src, dst), true);
  await writeFile(dst, 'webp');
  await utimes(src, 100, 100);
  await utimes(dst, 200, 200);
  assert.equal(await needsWebpConversion(src, dst), false);
  await utimes(src, 300, 300);
  assert.equal(await needsWebpConversion(src, dst), true);
});
