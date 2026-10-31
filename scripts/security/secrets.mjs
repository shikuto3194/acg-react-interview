import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureGitleaks } from "./gitleaks.mjs";

const objectId = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const zeroId = /^0+$/;
function git(root, args, allowMissing = false) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  if (result.error || (result.status !== 0 && !allowMissing)) throw new Error("Git inspection failed; secret scan cannot be skipped.");
  return result;
}

export function pushRanges(input, root) {
  const ranges = [];
  for (const line of input.split(/\r?\n/).filter((value) => value.trim())) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !objectId.test(fields[1]) || !objectId.test(fields[3])) throw new Error("Invalid pre-push input; push is blocked.");
    const [, local, , remote] = fields;
    if (zeroId.test(local)) continue;
    git(root, ["cat-file", "-e", `${local}^{commit}`]);
    const knownRemote = !zeroId.test(remote) && git(root, ["cat-file", "-e", `${remote}^{commit}`], true).status === 0;
    ranges.push(knownRemote ? `${remote}..${local}` : local);
  }
  return [...new Set(ranges)];
}

export async function scan({ root = process.cwd(), mode = "history", input = "" } = {}) {
  root = resolve(root);
  git(root, ["rev-parse", "--show-toplevel"]);
  if (!["history", "staged", "pre-push"].includes(mode)) throw new Error("Use history, staged or pre-push.");
  const ranges = mode === "pre-push" ? pushRanges(input, root) : [];
  if (mode === "pre-push" && ranges.length === 0) return { findings: [], skipped: "no updated refs" };
  if (!existsSync(join(root, ".gitleaks.toml"))) throw new Error("Secret scanner failed: repository configuration is missing; push is blocked.");
  const binary = await ensureGitleaks();
  const temporary = mkdtempSync(join(tmpdir(), "repository-secret-scan-"));
  try {
    const report = join(temporary, "redacted.json");
    const args = ["git", root, "--config", join(root, ".gitleaks.toml"), "--gitleaks-ignore-path", temporary, "--ignore-gitleaks-allow", "--redact=100", "--no-banner", "--no-color", "--report-format=json", "--report-path", report];
    if (mode === "staged") args.push("--staged");
    else args.push(`--log-opts=--full-history -m ${mode === "history" ? "--all" : ranges.join(" ")}`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GITLEAKS_")));
    const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    // Child output may contain commit messages or user data; only selected report coordinates leave this process.
    if (result.error || ![0, 1].includes(result.status)) throw new Error("Secret scanner failed; push is blocked. Check Git and Gitleaks configuration.");
    let findings;
    try { findings = JSON.parse(readFileSync(report, "utf8")); }
    catch { throw new Error("Secret scanner failed: no valid report; push is blocked."); }
    if (!Array.isArray(findings) || (result.status === 1 && findings.length === 0)) throw new Error("Invalid scanner report; push is blocked.");
    return { findings: findings.map((row) => ({ rule: row.RuleID, file: row.File, line: row.StartLine, commit: row.Commit })) };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2] || "history";
    const result = await scan({ mode, input: mode === "pre-push" ? readFileSync(0, "utf8") : "" });
    if (result.findings.length) {
      console.error(JSON.stringify({ status: "blocked", findings: result.findings }, null, 2));
      process.exitCode = 1;
    } else console.log(`[secrets] passed (${mode})`);
  } catch (error) {
    console.error(`[secrets] ${error.message}`);
    process.exitCode = 2;
  }
}
