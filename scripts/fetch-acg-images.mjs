// カード生成と同じ取得結果から、採用した通常版・訂正版の画像だけを保存する。
// --dry-run: 生成ファイルを更新せず一覧を確認 / --force: 既存画像も再取得
// --offline: 保存済みHTMLと画像のみ使用し、ネットワークに接続しない
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildCardData } from './build-card-data.mjs';
import { fetchContent } from './acg-fetch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = resolve(here, '..', 'public', 'images');

export async function downloadCardImages(refs, {
  directory = imagesDir, force = false, offline = false,
  fetchBytes = url => fetchContent(url, { binary: true }),
  log = console.log,
} = {}) {
  await mkdir(directory, { recursive: true });
  const targets = [...new Map(refs.map(ref => [ref.name, ref])).values()];
  let downloaded = 0;
  let skipped = 0;
  const failures = [];
  let index = 0;
  async function worker() {
    while (index < targets.length) {
      const { name, url } = targets[index++];
      if (!/^[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(name)) {
        failures.push(`${name}: Invalid image filename`);
        continue;
      }
      const out = resolve(directory, name);
      try {
        const existing = await stat(out).catch(() => null);
        if (existing?.size && (!force || offline)) { skipped++; continue; }
        if (offline) throw new Error('保存済み画像がありません');
        let bytes;
        try {
          bytes = await fetchBytes(url);
        } catch (error) {
          // Errata text may be published before an errata-specific image exists.
          // In that case the official card list still provides the same card art.
          const fallbackName = name.replace(/_T(\.(?:png|jpe?g|webp))$/i, '$1');
          if (fallbackName === name || !/-> 404\b/.test(error.message)) throw error;
          const fallbackUrl = new URL(url);
          fallbackUrl.pathname = fallbackUrl.pathname.replace(/_T(\.(?:png|jpe?g|webp))$/i, '$1');
          log(`[images] ${name}: official errata image missing; using card art ${fallbackName}`);
          bytes = await fetchBytes(fallbackUrl.href);
        }
        // HTTP 200 のエラーページや途中で切れた画像をキャッシュしない。
        const metadata = await sharp(bytes).metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('Invalid image format');
        await sharp(bytes).stats();
        const oldBytes = existing?.size ? await readFile(out) : null;
        if (oldBytes?.equals(bytes)) { skipped++; continue; }
        const temp = `${out}.download`;
        await writeFile(temp, bytes);
        await rename(temp, out);
        downloaded++;
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  log(`[images] downloaded: ${downloaded}, cached: ${skipped}, failed: ${failures.length}`);
  if (failures.length) throw new Error(`必要なカード画像を取得できません:\n${failures.join('\n')}`);
  return { downloaded, skipped };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offline = args.has('--offline');
  const dryRun = args.has('--dry-run');
  const { images } = await buildCardData({ offline, write: !dryRun });
  console.log(`[images] canonical targets: ${images.length}`);
  if (dryRun) {
    for (const ref of images) console.log(ref.url);
    return;
  }
  await downloadCardImages(images, { offline, force: args.has('--force') });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
