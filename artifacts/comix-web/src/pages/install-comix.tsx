import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type PlatformName = "Android" | "iOS" | "Windows" | "Linux";

function detectPlatform(): PlatformName | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

/**
 * Release binaries are published as GitHub Release assets, keeping Vercel
 * deployments focused on the frontend and lightweight web assets.
 */
const RELEASE_DOWNLOAD_BASE = "https://github.com/FallenSoul7/Manga-Scraper-Tool-1/releases/latest/download";
const targets: {
  name: PlatformName;
  icon: typeof Smartphone;
  detail: string;
  href: string;
  button: string;
}[] = [
  {
    name: "Android",
    icon: Smartphone,
    detail: "Download the APK, open it on your device, and approve Android's install-from-this-source prompt if asked. The app updates itself automatically after install.",
    href: `${RELEASE_DOWNLOAD_BASE}/ComiHub-android.apk`,
    button: "Download Android APK",
  },
  {
    name: "iOS",
    icon: Smartphone,
    detail: "Download the IPA, import it into SideStore, AltStore, or Sideloadly, and let your own Apple ID sign it before installing.",
    href: `${RELEASE_DOWNLOAD_BASE}/ComiHub-ios.ipa`,
    button: "Download iOS IPA",
  },
  {
    name: "Windows",
    icon: Monitor,
    detail: "Download and run the Windows setup file to install ComiHub on your PC.",
    href: `${RELEASE_DOWNLOAD_BASE}/ComiHub-windows-x64-setup.exe`,
    button: "Download Windows installer",
  },
  {
    name: "Linux",
    icon: Terminal,
    detail: "Download the Debian package and open it with your software installer, or run: sudo apt install ./ComiHub-linux-x64.deb",
    href: `${RELEASE_DOWNLOAD_BASE}/ComiHub-linux-x64.deb`,
    button: "Download Linux package",
  },
];

export default function InstallComihubPage() {
  const currentPlatform = detectPlatform();

  return (
    <main className="container mx-auto max-w-3xl px-4 py-8 sm:py-12 animate-in fade-in duration-500">
      <Link href="/system" className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>

      <header className="mb-8">
        <h1 className="mb-2 text-3xl font-serif font-bold text-foreground sm:text-4xl">Install ComiHub</h1>
        <p className="max-w-2xl text-muted-foreground">
          Choose your platform to get the ComiHub app. Mobile builds update themselves to the newest release automatically.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {targets.map(target => {
          const Icon = target.icon;
          const isCurrent = currentPlatform === target.name;

          return (
            <section key={target.name} className="flex flex-col rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground">{target.name}</h2>
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="h-3 w-3" /> GitHub Release available
                    </span>
                  </div>
                </div>
                {isCurrent && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    This device
                  </span>
                )}
              </div>

              <p className="mb-5 flex-1 text-sm leading-relaxed text-muted-foreground">{target.detail}</p>

              <Button asChild className="w-full">
                <a href={target.href} download={target.href.split("/").pop()} data-testid={`download-${target.name.toLowerCase()}`}>
                  <Download className="mr-2 h-4 w-4" /> {target.button}
                </a>
              </Button>
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Need browser-based Home Screen instructions?{" "}
        <Link href="/install" className="font-medium text-primary hover:underline">Open Add to Home Screen</Link>.
      </p>
    </main>
  );
}
