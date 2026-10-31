import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const git = (args) => spawnSync("git", args, { encoding: "utf8", windowsHide: true });
const inside = git(["rev-parse", "--show-toplevel"]);
if (inside.status !== 0) throw new Error("Install hooks from a Git checkout.");
const root = inside.stdout.trim();
const current = git(["config", "--get", "core.hooksPath"]);
if (current.status !== 0 && current.status !== 1) throw new Error("Cannot inspect existing hook configuration.");
if (current.stdout.trim() && current.stdout.trim() !== ".githooks") throw new Error("Existing hooksPath preserved. Add the security pre-push entry to that hook before installation.");
const defaultHooks = git(["rev-parse", "--git-path", "hooks"]);
if (defaultHooks.status !== 0) throw new Error("Cannot inspect existing hooks.");
const hooksDirectory = resolve(defaultHooks.stdout.trim());
if (!current.stdout.trim() && existsSync(hooksDirectory) && readdirSync(hooksDirectory).some((name) => !name.endsWith(".sample"))) throw new Error("Existing Git hooks preserved. Integrate them before selecting .githooks.");
if (!existsSync(resolve(root, ".githooks/pre-push"))) throw new Error("Missing tracked security hook.");
if (git(["config", "--local", "core.hooksPath", ".githooks"]).status !== 0) throw new Error("Could not install security hook.");
console.log("[secrets] pre-push hook installed; scanner setup is checked on the first push.");
