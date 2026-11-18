import { spawnSync } from 'node:child_process';

const env = { ...process.env, INTERVIEW_BUILD: 'true' };
const nodeResult = spawnSync(
  process.execPath,
  ['scripts/validate-interview-env.mjs'],
  { env, stdio: 'inherit' },
);

if (nodeResult.status !== 0) {
  process.exit(nodeResult.status ?? 1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildResult = spawnSync(npmCommand, ['run', 'build'], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (buildResult.error) {
  console.error(`Interview build could not start: ${buildResult.error.message}`);
  process.exit(1);
}

process.exit(buildResult.status ?? 1);
