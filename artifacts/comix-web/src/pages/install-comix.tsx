import { Link } from "wouter";
import {
  ArrowLeft,
  Clock3,
  Download,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function detectPlatform(): "Android" | "iOS" | "Windows" | "Linux" | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

const targets = [
  {
    name: "Android" as const,
    icon: Smartphone,
    detail: "Download the APK, open it on your device, and approve Android's install-from-this-source prompt if asked.",
    asset: "ComiHub-android.apk",
    button: "Download Android APK",
  },
  {
    name: "iOS" as const,
    icon: Smartphone,
    detail: "A sideloadable iOS package is coming soon. For now, add the web app from Safari to your Home Screen.",
  },
  {
    name: "Windows" as const,
    icon: Monitor,
    detail: "Download and run the Windows setup file to install ComiHub on your PC.",
    asset: "ComiHub-windows-x64-setup.exe",
    button: "Download Windows installer",
  },
  {
    name: "Linux" as const,
    icon: Terminal,
    detail: "Download the AppImage, mark it executable in file properties, then launch it.",
    asset: "ComiHub-linux-x64.AppImage",
    button: "Download Linux AppImage",
  },
];

const releasesBase = "https://github.com/FallenSoul7/Manga-Scraper-Tool-1/releases/latest/download";

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
          Choose your platform to get the ComiHub app. Each download is served from the latest GitHub release.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {targets.map(target => {
          const Icon = target.icon;
          const isCurrent = currentPlatform === target.name;
          const comingSoon = target.name === "iOS";

          return (
            <section key={target.name} className="flex flex-col rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground">{target.name}</h2>
                    <span className={`text-xs ${comingSoon ? "text-muted-foreground" : "text-primary"}`}>
                      {comingSoon ? "Native app coming soon" : "Installer available"}
                    </span>
                  </div>
                </div>
                {isCurrent && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">This device</span>}
              </div>

              <p className="mb-5 flex-1 text-sm leading-relaxed text-muted-foreground">{target.detail}</p>

              {comingSoon ? (
                <div className="space-y-3">
                  <Button variant="outline" className="w-full" disabled>
                    <Clock3 className="mr-2 h-4 w-4" /> iOS — Coming soon
                  </Button>
                  <Link href="/install" className="inline-flex text-sm font-medium text-primary hover:underline">
                    Add the web app to Home Screen instead
                  </Link>
                </div>
              ) : (
                <Button asChild className="w-full">
                  <a href={`${releasesBase}/${target.asset}`}>
                    <Download className="mr-2 h-4 w-4" /> {target.button}
                  </a>
                </Button>
              )}
            </section>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Need browser-based Home Screen instructions? <Link href="/install" className="font-medium text-primary hover:underline">Open Add to Home Screen</Link>.
      </p>
    </main>
  );
}
