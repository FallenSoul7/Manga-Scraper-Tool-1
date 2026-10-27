import { createHash, sign } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const outputDir = path.resolve("dist/public");
const updatesDir = path.join(outputDir, "native-updates");
const privateKey = process.env.COMIHUB_OTA_PRIVATE_KEY;

// Only the web shell belongs in the OTA bundle. Installer binaries are large,
// platform specific, and must never be shipped inside a live update.
const SKIPPED_DIRECTORIES = new Set(["native-updates", "installers"]);
const SKIPPED_FILE_PATTERN = /\.(apk|aab|ipa|exe|msi|appimage|deb|rpm|dmg|map)$/i;

if (!privateKey) {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("COMIHUB_OTA_PRIVATE_KEY must be configured for Vercel production builds.");
  }
  console.log("COMIHUB_OTA_PRIVATE_KEY is not configured; skipping signed native update publication.");
  process.exit(0);
}

async function addDirectory(zip, directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const archivePath = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await addDirectory(zip, absolutePath, archivePath);
    } else if (entry.isFile() && !SKIPPED_FILE_PATTERN.test(entry.name)) {
      zip.file(archivePath, await readFile(absolutePath));
    }
  }
}

const zip = new JSZip();
await addDirectory(zip, outputDir);
const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
const checksum = createHash("sha256").update(archive).digest("hex");
const bundleId = createHash("sha256").update(archive).digest("hex").slice(0, 32);
const signature = sign("sha256", archive, privateKey).toString("base64");
const bundleFile = `${bundleId}.zip`;
const minimumVersionCode = Number(process.env.COMIHUB_NATIVE_MIN_VERSION_CODE ?? "2");
if (!Number.isSafeInteger(minimumVersionCode) || minimumVersionCode < 1) {
  throw new Error("COMIHUB_NATIVE_MIN_VERSION_CODE must be a positive integer.");
}

await mkdir(updatesDir, { recursive: true });
await writeFile(path.join(updatesDir, bundleFile), archive);
await writeFile(
  path.join(updatesDir, "latest.json"),
  `${JSON.stringify({
    bundleId,
    url: `https://www.comihub.top/native-updates/${bundleFile}`,
    checksum,
    signature,
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? "production",
    minimumVersionCode,
  }, null, 2)}\n`,
);
console.log(`Published signed native OTA bundle ${bundleId} (${archive.length} bytes; minimum app version ${minimumVersionCode}).`);
