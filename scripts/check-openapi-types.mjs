import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceOpenapi = path.join(repoRoot, "openapi.json");
const generatedTypes = path.join(repoRoot, "src", "api", "types.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dagents-openapi-types-"));
const tempTypes = path.join(tempDir, "types.ts");

try {
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "generate-openapi-types.mjs"),
      "./openapi.json",
      tempTypes,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  const expected = fs.readFileSync(tempTypes, "utf-8");
  const actual = fs.readFileSync(generatedTypes, "utf-8");

  if (actual !== expected) {
    console.error(
      "[openapi-types] src/api/types.ts is stale. Run `pnpm gen:types` and commit the generated file.",
    );
    process.exitCode = 1;
  } else {
    console.log("[openapi-types] src/api/types.ts is up to date.");
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
