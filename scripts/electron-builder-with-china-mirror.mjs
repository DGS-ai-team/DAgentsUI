/**
 * 在未设置 ELECTRON_BUILDER_BINARIES_MIRROR 时，默认使用 npmmirror，
 * 避免本机构建卡在 DownloadWinCodeSign（需从 GitHub 拉取 7z）时超时。
 * 若需直连官方源：先取消环境变量再执行，例如 PowerShell 中
 *   Remove-Item Env:ELECTRON_BUILDER_BINARIES_MIRROR -ErrorAction SilentlyContinue
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR?.trim()) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
    "https://npmmirror.com/mirrors/electron-builder-binaries/";
}

const args = process.argv.slice(2);
const r = spawnSync("pnpm", ["exec", "electron-builder", ...args], {
  stdio: "inherit",
  env: process.env,
  shell: true,
  cwd: root,
});

process.exit(r.status ?? 1);
