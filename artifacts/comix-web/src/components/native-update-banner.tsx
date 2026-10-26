import { useEffect, useState } from "react";
import { Download, Sparkles, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";

/**
 * Web-bundle updates ship signed over the air, but changes to native code
 * (Java, Swift, Gradle, plugin list) can only arrive with a new installer.
 * This banner compares the installed native build against the published one.
 */
const RELEASE_MANIFEST_URL = "https://www.comihub.top/native-updates/native-release.json";
const DISMISSED_KEY = "comihub.native-release.dismissed";
const SITE_ORIGIN = "https://www.comihub.top";

/** The WebView origin is local, so installer links must be absolute. */
function toAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface NativeRelease {
  versionCode: number;
  versionName: string;
  androidUrl: string;
  iosUrl: string;
}

function isMobileShell(): boolean {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === "android" || platform === "ios");
}

function parseRelease(value: unknown): NativeRelease | null {
  if (!value || typeof value !== "object") return null;
  const release = value as Partial<NativeRelease>;
  if (
    typeof release.versionCode !== "number" || !Number.isSafeInteger(release.versionCode) ||
    typeof release.versionName !== "string" ||
    typeof release.androidUrl !== "string" ||
    typeof release.iosUrl !== "string"
  ) return null;
  return release as NativeRelease;
}

export function NativeUpdateBanner() {
  const [release, setRelease] = useState<NativeRelease | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!isMobileShell()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    let cancelled = false;
    void (async () => {
      try {
        const [{ versionCode }, response] = await Promise.all([
          LiveUpdate.getVersionCode(),
          fetch(RELEASE_MANIFEST_URL, { cache: "no-store" }),
        ]);
        if (!response.ok) return;

        const parsed = parseRelease(await response.json());
        if (!parsed || cancelled) return;
        if (Number(versionCode) >= parsed.versionCode) return;
        setRelease(parsed);
        setDismissed(false);
      } catch {
        // A missing manifest must never interrupt reading.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !release) return null;

  const platform = Capacitor.getPlatform();
  const downloadUrl = toAbsolute(platform === "ios" ? release.iosUrl : release.androidUrl);

  return (
    <div className="flex w-full items-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2.5 text-sm animate-in slide-in-from-top-2 duration-200">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="leading-tight text-foreground">
          <span className="font-semibold">ComiHub {release.versionName} is available</span>
          {platform === "ios" ? " — reinstall with your sideloader to get the newest features" : " — install the newest version"}
        </p>
      </div>
      <a
        href={downloadUrl}
        download
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Download className="mr-1 inline h-3 w-3" />
        Get it
      </a>
      <button
        onClick={() => {
          setDismissed(true);
          localStorage.setItem(DISMISSED_KEY, "1");
        }}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
