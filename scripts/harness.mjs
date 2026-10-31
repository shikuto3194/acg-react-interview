import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2] || 'preflight';
if (!['preflight', 'check'].includes(mode)) throw new Error('Use preflight or check');
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} ${args.join(' ')} failed (${result.status})`);
  return result.stdout;
};
const fingerprint = () => {
  const hash = createHash('sha256').update(process.version);
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], true).split('\0').filter(Boolean).sort();
  for (const file of files) hash.update(file).update(existsSync(file) ? readFileSync(file) : '<deleted>');
  return hash.digest('hex');
};
const major = Number(process.versions.node.split('.')[0]);
if (major !== 22 || Number(process.versions.node.split('.')[1]) < 12) throw new Error('Node.js 22.12以降の22系を使用してください。');
for (const file of ['README.md', 'package.json', 'package-lock.json', 'vite.config.js']) if (!existsSync(file)) throw new Error(`Missing ${file}`);
console.log(`Node ${process.version}\n${run('git', ['status', '--short', '--branch'], true)}`);
if (mode === 'check') {
  const before = fingerprint(), started = Date.now();
  const report = { node: process.version, head: run('git', ['rev-parse', 'HEAD'], true).trim(), source: before, startedAt: new Date(started).toISOString(), status: 'failed' };
  try {
    // Invoke npm through its JS entry to avoid shell-dependent Windows quoting.
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('npm run harness:check から実行してください。');
    run(process.execPath, [npm, 'run', 'check']);
    if (fingerprint() !== before) throw new Error('検証中にソースが変更されました。再検証してください。');
    report.status = 'passed';
  } finally {
    report.durationMs = Date.now() - started;
    mkdirSync('.codex-temp/harness', { recursive: true });
    const file = resolve('.codex-temp/harness/latest.json');
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.status}: ${report.durationMs}ms (${file})`);
  }
}
