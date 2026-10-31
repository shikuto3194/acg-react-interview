import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import sharp from 'sharp';

const hash = buffer => createHash('sha256').update(buffer).digest('hex');
async function pixels(buffer) {
  const result = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < result.data.length; i += 4) if (result.data[i + 3] === 0) result.data.fill(0, i, i + 3);
  return result;
}
export async function losslessImage(source) {
  const output = await sharp(source).webp({ lossless: true, effort: 6 }).toBuffer();
  const [a, b] = await Promise.all([pixels(source), pixels(output)]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || !a.data.equals(b.data)) throw new Error('WebP pixel verification failed');
  return output;
}
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}
export function optimizedImages({ sourceDir = 'images', preferExisting = false } = {}) {
  let root, assets, entries, publicAssets;
  return {
    name: 'verified-distribution-images', apply: 'build', enforce: 'pre',
    config() { if (preferExisting) return { publicDir: false }; },
    configResolved(config) { root = config.root; },
    async buildStart() {
      assets = []; entries = {};
      publicAssets=[];
      if(preferExisting){
        const publicRoot=resolve(root,'public');
        for(const file of await walk(publicRoot)) {
          const path=relative(publicRoot,file).replaceAll('\\','/');
          if(!path.startsWith('images/'))publicAssets.push({path,output:await readFile(file)});
        }
      }
      const sourceRoot = resolve(root, sourceDir);
      if (!(await stat(sourceRoot).catch(() => null))?.isDirectory()) throw new Error(`Missing images: ${sourceRoot}`);
      const files = (await walk(sourceRoot)).filter(file => /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file) && !relative(sourceRoot,file).replaceAll('\\','/').startsWith('toliming temp/'));
      let cursor = 0, sourceBytes = 0, outputBytes = 0;
      const worker = async () => {
        while (cursor < files.length) {
          const file = files[cursor++], source = await readFile(file);
          const key = relative(sourceRoot, file).replaceAll('\\', '/');
          let output = source, path = key;
          if(preferExisting) assets.push({path:key,output:source}); // Preserve existing direct image URLs.
          if (preferExisting && /\.(png|jpe?g)$/i.test(file)) {
            const candidatePath=file.replace(/\.(png|jpe?g)$/i,'.webp');
            const candidate=await readFile(candidatePath).catch(()=>null);
            if(candidate && candidate.length<source.length){
              const [a,b]=await Promise.all([sharp(source).metadata(),sharp(candidate).metadata()]);
              if(b.format!=='webp'||a.width!==b.width||a.height!==b.height)throw new Error(`Invalid WebP: ${candidatePath}`);
              output=candidate;path=relative(sourceRoot,candidatePath).replaceAll('\\','/');
            }
          } else if (/\.png$/i.test(file)) {
            const cache = resolve(root, '.codex-temp/image-cache', `${hash(source)}-lossless-v1.webp`);
            const cached = await readFile(cache).catch(() => null);
            // Cache receipt includes the output hash; corrupt cache entries are rebuilt.
            const receipt = await readFile(`${cache}.sha256`, 'utf8').catch(() => '');
            const converted = cached && hash(cached) === receipt ? cached : await losslessImage(source);
            if (!cached || hash(cached) !== receipt) {
              await mkdir(dirname(cache), { recursive: true });
              await writeFile(cache, converted); await writeFile(`${cache}.sha256`, hash(converted));
            }
            if (converted.length < source.length) { output = converted; path = `${key}.webp`; }
          }
          entries[key] = { path, hash: hash(output).slice(0, 16), bytes: output.length };
          assets.push({ path, output }); sourceBytes += source.length; outputBytes += output.length;
        }
      };
      await Promise.all([worker(), worker()]);
      entries = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
      console.log(`[images] ${files.length} files: ${sourceBytes} -> ${outputBytes} bytes (${preferExisting?'existing WebP dimensions verified':'lossless pixels verified'})`);
    },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/imageUrl.js')) return;
      return { code: code.replace("import manifest from './imagesManifest.generated.js';", `const manifest = ${JSON.stringify(entries)};`), map: null };
    },
    generateBundle() {
      const emitted = new Set();
      for (const { path, output } of assets) if (!emitted.has(path)) {
        this.emitFile({ type: 'asset', fileName: `images/${path}`, source: output }); emitted.add(path);
      }
      this.emitFile({ type: 'asset', fileName: 'image-assets.json', source: JSON.stringify(entries) });
      for(const {path,output} of publicAssets) this.emitFile({type:'asset',fileName:path,source:output});
    },
  };
}
