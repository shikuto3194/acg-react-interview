// public/images/ 配下の PNG / JPG を WebP に変換する。
// 同名 .webp が元画像より新しい場合はスキップ（--force で強制再変換）。
// 元の PNG/JPG は保持する（後方互換と WebP 非対応環境のため）。
//
// 使い方:
//   node scripts/convert-images-to-webp.mjs [--force] [--quality=82]

import { readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const imagesDir = resolve(projectRoot, 'public', 'images');

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const qualityArg = process.argv.find((a) => a.startsWith('--quality='));
const QUALITY = qualityArg ? Number(qualityArg.split('=')[1]) : 82;

const CONCURRENCY = 6;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.isFile()) files.push(full);
  }
  return files;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

export async function needsWebpConversion(src, dst) {
  const source = await stat(src);
  const target = await stat(dst).catch(() => null);
  return !target?.size || source.mtimeMs > target.mtimeMs;
}

async function main() {
  if (!(await exists(imagesDir))) {
    console.log(`[webp] no images dir: ${imagesDir}`);
    return;
  }

  const files = await walk(imagesDir);
  const targets = files.filter((f) => /\.(png|jpe?g)$/i.test(f));
  console.log(`[webp] candidates: ${targets.length} (quality=${QUALITY})`);

  let converted = 0;
  let skipped = 0;
  let failed = 0;
  let savedBytes = 0;

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const my = idx++;
      const src = targets[my];
      const dst = src.replace(/\.(png|jpe?g)$/i, '.webp');
      if (!FORCE && !(await needsWebpConversion(src, dst))) { skipped++; continue; }
      try {
        const buf = await readFile(src);
        const out = await sharp(buf).webp({ quality: QUALITY }).toBuffer();
        await writeFile(dst, out);
        converted++;
        savedBytes += Math.max(0, buf.length - out.length);
        if (converted % 50 === 0) {
          console.log(`  [${converted}/${targets.length - skipped}] ${src.split(/[\\/]/).pop()}`);
        }
      } catch (err) {
        failed++;
        console.warn(`FAIL ${src}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('[webp] --- summary ---');
  console.log(`[webp] converted: ${converted}`);
  console.log(`[webp] skipped (already exists): ${skipped}`);
  console.log(`[webp] failed: ${failed}`);
  console.log(`[webp] bytes saved: ${(savedBytes / 1024 / 1024).toFixed(1)} MB`);
  if (failed) throw new Error(`${failed} 件の画像変換に失敗しました`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[webp] failed:', err);
    process.exit(1);
  });
}
