/**
 * 构建后把仓库根目录的 .env.example 同步到 dist/env.example，
 * 供 electron-builder extraResources 从「无点号前缀」路径拷贝，避免部分环境下点文件未被纳入产物。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, ".env.example");
const dest = path.join(root, "dist", "env.example");

if (!fs.existsSync(path.join(root, "dist"))) {
  console.error("sync-env-example-to-dist: dist/ missing, run vite build first");
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error("sync-env-example-to-dist: .env.example missing at repo root");
  process.exit(1);
}
fs.copyFileSync(src, dest);
console.log("sync-env-example-to-dist: wrote", dest);
