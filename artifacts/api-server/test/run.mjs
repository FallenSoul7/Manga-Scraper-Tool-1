import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [
  path.join(packageDir, "test/source-package.test.mjs"),
  path.join(packageDir, "test/library-sync-schema.test.mjs"),
];
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  cwd: packageDir,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
