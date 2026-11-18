import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const version = "8.30.1";
const releases = {
  "win32-x64": ["windows_x64.zip", "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e"],
  "linux-x64": ["linux_x64.tar.gz", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"],
};
const digest = (data) => createHash("sha256").update(data).digest("hex");

export async function ensureGitleaks() {
  if (process.env.GITLEAKS_BINARY) {
    const binary = resolve(process.env.GITLEAKS_BINARY);
    assertVersion(binary);
    return binary;
  }
  const release = releases[`${process.platform}-${process.arch}`];
  if (!release) throw new Error("Unsupported platform: install Gitleaks 8.30.1 and set GITLEAKS_BINARY.");
  const cache = join(tmpdir(), `repository-gitleaks-${version}-${process.platform}-${process.arch}`);
  const binary = join(cache, process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  const stamp = join(cache, "binary.sha256");
  if (existsSync(binary) && existsSync(stamp) && digest(readFileSync(binary)) === readFileSync(stamp, "utf8").trim()) {
    assertVersion(binary);
    return binary;
  }
  mkdirSync(cache, { recursive: true });
  const stage = mkdtempSync(join(cache, "install-"));
  try {
    const file = `gitleaks_${version}_${release[0]}`;
    const response = await globalThis.fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/${file}`, { signal: globalThis.AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("Gitleaks download failed; push is blocked.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== release[1]) throw new Error("Gitleaks archive checksum mismatch; push is blocked.");
    const archive = join(stage, file);
    writeFileSync(archive, bytes);
    const unpack = process.platform === "win32"
      ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:SECURITY_ARCHIVE -DestinationPath $env:SECURITY_CACHE -Force"], { env: { ...process.env, SECURITY_ARCHIVE: archive, SECURITY_CACHE: cache }, windowsHide: true, stdio: "pipe" })
      : spawnSync("tar", ["-xzf", archive, "-C", cache, "gitleaks"], { windowsHide: true, stdio: "pipe" });
    if (unpack.error || unpack.status !== 0) throw new Error("Gitleaks extraction failed; push is blocked.");
    if (process.platform !== "win32") chmodSync(binary, 0o755);
    assertVersion(binary);
    writeFileSync(stamp, digest(readFileSync(binary)) + "\n");
    return binary;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function assertVersion(binary) {
  const result = spawnSync(binary, ["version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0 || result.stdout.trim() !== version) throw new Error("Gitleaks 8.30.1 is required; push is blocked.");
}
