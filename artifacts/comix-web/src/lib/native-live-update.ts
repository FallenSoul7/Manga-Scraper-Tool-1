import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";

const UPDATE_MANIFEST_URL = "https://www.comihub.top/native-updates/latest.json";
// Avoid repeated downloads after a transient network or signature failure.
const RETRY_INTERVAL_MS = 60 * 60 * 1000;
const LAST_FAILURE_KEY = "comihub.native-update.last-failure";
const UPDATE_CHECK_TIMEOUT_MS = 5_000;
let updateCheckInFlight: Promise<void> | null = null;

interface UpdateManifest {
  bundleId: string;
  url: string;
  checksum: string;
  signature: string;
  appVersion: string;
  minimumVersionCode: number;
}

function isNativeUpdatePlatform(): boolean {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === "android" || platform === "ios");
}

function parseManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Partial<UpdateManifest>;
  if (
    typeof manifest.bundleId !== "string" || !/^[a-f0-9]{12,64}$/i.test(manifest.bundleId) ||
    typeof manifest.url !== "string" || !manifest.url.startsWith("https://www.comihub.top/native-updates/") ||
    typeof manifest.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.checksum) ||
    typeof manifest.signature !== "string" || manifest.signature.length < 32 ||
    typeof manifest.appVersion !== "string" ||
    typeof manifest.minimumVersionCode !== "number" || !Number.isSafeInteger(manifest.minimumVersionCode)
  ) return null;
  return manifest as UpdateManifest;
}

/** Confirm the embedded/current bundle works before permitting a pending OTA rollback timer. */
export async function markNativeBundleReady(): Promise<void> {
  if (!isNativeUpdatePlatform()) return;
  try {
    await LiveUpdate.ready();
  } catch (error) {
    console.warn("ComiHub native update readiness check failed", error);
  }
}

/** Check for a signed, binary-compatible web bundle; native code changes still require a new APK/IPA. */
export function checkForNativeUpdate(): Promise<void> {
  if (!isNativeUpdatePlatform()) return Promise.resolve();
  if (updateCheckInFlight) return updateCheckInFlight;

  updateCheckInFlight = (async () => {
    try {
      const version = await LiveUpdate.getVersionCode();
      const appVersionCode = Number(version.versionCode);
      if (!Number.isFinite(appVersionCode)) return;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(UPDATE_MANIFEST_URL, {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) return;

      const manifest = parseManifest(await response.json());
      if (!manifest || appVersionCode < manifest.minimumVersionCode) return;

      if (manifest.bundleId === localStorage.getItem("comihub.native-update.bundle-id")) return;
      if (Date.now() - Number(localStorage.getItem(LAST_FAILURE_KEY) ?? 0) < RETRY_INTERVAL_MS) return;

      await LiveUpdate.downloadBundle({
        artifactType: "zip",
        bundleId: manifest.bundleId,
        url: manifest.url,
        checksum: manifest.checksum,
        signature: manifest.signature,
      });
      await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
      localStorage.setItem("comihub.native-update.bundle-id", manifest.bundleId);
      localStorage.removeItem(LAST_FAILURE_KEY);
      // Keep this version running now. Capawesome applies the staged bundle next time
      // the app is opened, allowing its rollback timer to protect startup.
    } catch (error) {
      // OTA is opportunistic: network, signing, or compatibility errors must never
      // block the bundled app or its normal backend loading.
      try {
        localStorage.setItem(LAST_FAILURE_KEY, String(Date.now()));
      } catch {
        /* storage may be unavailable */
      }
      console.warn("ComiHub native update check skipped", error);
    } finally {
      updateCheckInFlight = null;
    }
  })();

  return updateCheckInFlight;
}
