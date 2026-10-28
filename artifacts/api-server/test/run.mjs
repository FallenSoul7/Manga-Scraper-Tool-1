import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "comixhub-api-tests-"));
const bundlePath = path.join(tempDir, "sdk.test.mjs");

try {
  await build({
    entryPoints: [path.join(packageDir, "src/extensions/sdk.test.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: bundlePath,
    logLevel: "silent",
  });
  const result = spawnSync(process.execPath, ["--test", bundlePath], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
