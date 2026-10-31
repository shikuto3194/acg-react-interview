import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureGitleaks } from "./gitleaks.mjs";
import { pushRanges, scan } from "./secrets.mjs";

const source = process.cwd();
const binary = await ensureGitleaks();
process.env.GITLEAKS_BINARY = binary;
const temporary = mkdtempSync(join(tmpdir(), "secret-guard-test-"));
const root = join(temporary, "fixture");
const remote = join(temporary, "remote.git");
const config = readFileSync(join(source, ".gitleaks.toml"), "utf8");
const zero = "0".repeat(40);
const secret = "gh" + "p_" + randomBytes(20).toString("hex").slice(0, 36);
let assertions = 0;
function run(args, options = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw new Error(`Fixture Git operation failed: ${args[0]}`);
  return result.stdout.trim();
}
function put(file, content) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
function commit() {
  run(["add", "."]);
  run(["commit", "-qm", "fixture"]);
  return run(["rev-parse", "HEAD"]);
}
function expect(condition, label) {
  assert.ok(condition, label);
  assertions++;
}
try {
  mkdirSync(root);
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.name", "Secret guard test"]);
  run(["config", "user.email", "secret-guard@example.invalid"]);
  run(["config", "commit.gpgsign", "false"]);
  // Never run hooks inherited from the developer's global configuration.
  run(["config", "core.hooksPath", ".fixture-hooks"]);
  put(".gitleaks.toml", config);
  put("safe.txt", "safe\n");
  const base = commit();
  expect((await scan({ root })).findings.length === 0, "clean history passes");
  const allowedPath = config.includes("supabaseClient\\.js") ? "src/supabaseClient.js" : "apps/playground-web/src/supabaseClient.ts";
  const publicKey = "sb_" + "publishable_" + createHash("sha256").update("public-key-fixture-20261030").digest("hex");
  put(allowedPath, `const api_key = '${publicKey}';\n`);
  commit();
  expect((await scan({ root })).findings.length === 0, "public key allowed only in reviewed paths");
  put("unexpected.js", `const api_key = '${publicKey}';\n`);
  run(["add", "."]);
  expect((await scan({ root, mode: "staged" })).findings.length > 0, "public key elsewhere requires review");
  rmSync(join(root, "unexpected.js"));
  run(["add", "."]);
  put(allowedPath, `const api_key = '${secret}'; // gitleaks:allow\n`);
  const leaked = commit();
  put(allowedPath, "// removed\n");
  const deleted = commit();
  const history = await scan({ root });
  expect(history.findings.some((row) => row.commit === leaked), "deleted secret remains detected in history");
  expect(!JSON.stringify(history).includes(secret), "findings expose coordinates only");
  expect((await scan({ root, mode: "pre-push", input: `refs/heads/main ${deleted} refs/heads/main ${base}\n` })).findings.length > 0, "range includes intermediate commits and ignores allow comments");
  run(["branch", "leaky", deleted]);
  run(["reset", "--hard", base]);
  expect((await scan({ root, mode: "pre-push", input: `refs/heads/leaky ${deleted} refs/heads/leaky ${zero}\n` })).findings.length > 0, "pushed non-HEAD branch is checked");
  expect((await scan({ root, mode: "pre-push", input: `refs/heads/leaky ${deleted} refs/heads/leaky ${"f".repeat(40)}\n` })).findings.length > 0, "unknown remote base scans full pushed history");
  expect(pushRanges(`(delete) ${zero} refs/heads/leaky ${deleted}`, root).length === 0, "branch deletion has no new content");
  assert.throws(() => pushRanges("invalid", root)); assertions++;
  const saved = readFileSync(join(root, ".gitleaks.toml"));
  rmSync(join(root, ".gitleaks.toml"));
  await assert.rejects(scan({ root }), /scanner failed/); assertions++;
  writeFileSync(join(root, ".gitleaks.toml"), saved);
  if (config.includes("revealed-target-ui-raw-audit")) {
    const fixture = "packages/rules-core/test/fixtures/revealed-target-ui-raw-audit.json";
    put(fixture, JSON.stringify({ supportingSourceHashes: { "packages/rules-core/src/effect/card-access-rules.ts": randomBytes(32).toString("hex") } }, null, 2));
    run(["add", "."]);
    expect((await scan({ root, mode: "staged" })).findings.length === 0, "reviewed source checksum is allowed");
    put(fixture, JSON.stringify({ api_key: secret }, null, 2));
    run(["add", "."]);
    expect((await scan({ root, mode: "staged" })).findings.length > 0, "secret in checksum fixture is blocked");
    run(["reset", "--hard", base]);
  }
  // Exercise the actual checked-in pre-push entrypoint against a disposable local remote.
  mkdirSync(join(root, "scripts/security"), { recursive: true });
  for (const name of ["gitleaks.mjs", "secrets.mjs"]) copyFileSync(join(source, "scripts/security", name), join(root, "scripts/security", name));
  const hook = existsSync(join(source, ".husky/pre-push")) ? ".husky/pre-push" : ".githooks/pre-push";
  put(".fixture-hooks/pre-push", readFileSync(join(source, hook), "utf8"));
  chmodSync(join(root, ".fixture-hooks/pre-push"), 0o755);
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  // Existing simulator validation is outside this fixture; prove its stdin is preserved.
  writeFileSync(join(bin, "pnpm"), '#!/bin/sh\ncat > "$SECRET_GUARD_HOOK_INPUT"\n');
  chmodSync(join(bin, "pnpm"), 0o755);
  const inputFile = join(temporary, "hook-input");
  const env = { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`, SECRET_GUARD_HOOK_INPUT: inputFile };
  run(["init", "--bare", "-q", remote]);
  run(["remote", "add", "origin", remote]);
  run(["push", "-q", "origin", "main"], { env });
  if (hook.startsWith(".husky")) expect(readFileSync(inputFile, "utf8").includes(base), "existing push validator receives original ref input");
  const result = spawnSync("git", ["push", "origin", "leaky"], { cwd: root, env, encoding: "utf8", windowsHide: true });
  expect(result.status !== 0, "real hook blocks secret before remote update");
  expect(!`${result.stdout}${result.stderr}`.includes(secret), "hook output redacts secret");
  expect(run(["ls-remote", "origin", "refs/heads/leaky"]) === "", "blocked ref did not reach remote");
  const installer = join(source, "scripts/security/install-hooks.mjs");
  if (existsSync(installer)) {
    put(".githooks/pre-push", readFileSync(join(source, hook), "utf8"));
    put(".gitattributes", readFileSync(join(source, ".gitattributes"), "utf8"));
    run(["config", "core.autocrlf", "true"]);
    run(["add", ".gitattributes", ".githooks/pre-push"]);
    rmSync(join(root, ".githooks/pre-push"));
    run(["checkout-index", "--force", ".githooks/pre-push"]);
    expect(!readFileSync(join(root, ".githooks/pre-push"), "utf8").includes("\r"), "hook checkout retains LF on Windows");
    const install = () => spawnSync(process.execPath, [installer], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_CONFIG_GLOBAL: join(temporary, "empty-global-config"), GIT_CONFIG_NOSYSTEM: "1" } });
    expect(install().status !== 0 && run(["config", "--get", "core.hooksPath"]) === ".fixture-hooks", "installer preserves custom hooksPath");
    run(["config", "--unset", "core.hooksPath"]);
    put(".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n");
    expect(install().status !== 0, "installer preserves other existing hooks");
    rmSync(join(root, ".git/hooks/pre-commit"));
    expect(install().status === 0 && run(["config", "--get", "core.hooksPath"]) === ".githooks", "installer enables hook for fresh checkout");
  }
  console.log(`[secrets:test] ${assertions} assertions passed`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
