// シェルのワイルドカード展開に依存せず、Windows / Linux で同じテストを実行する。
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTests(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
}

const files = (await findTests(join(root, 'src'))).sort();
if (!files.length) throw new Error('No tests found under src/');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
