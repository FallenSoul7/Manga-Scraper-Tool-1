import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
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
 * Installers are served from the ComiHub domain itself. GitHub release links
 * were unusable on phones because this repository is private, which produced
 * 404 pages for anyone not signed in to GitHub.
 */
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
    href: "/ComiHub-android.apk",
    button: "Download Android APK",
  },
  {
    name: "iOS",
    icon: Smartphone,
    detail: "Download the IPA, import it into SideStore, AltStore, or Sideloadly, and let your own Apple ID sign it before installing.",
    href: "/installers/ComiHub-ios.ipa",
    button: "Download iOS IPA",
  },
  {
    name: "Windows",
    icon: Monitor,
    detail: "Download and run the Windows setup file to install ComiHub on your PC.",
    href: "/installers/ComiHub-windows-x64-setup.exe",
    button: "Download Windows installer",
  },
  {
    name: "Linux",
    icon: Terminal,
    detail: "Download the Debian package and open it with your software installer, or run: sudo apt install ./ComiHub-linux-x64.deb",
    href: "/installers/ComiHub-linux-x64.deb",
    button: "Download Linux package",
  },
];

type Availability = "checking" | "ready" | "missing";

export default function InstallComihubPage() {
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const currentPlatform = detectPlatform();

  // Never send a visitor to a dead download link: each installer is probed once
  // and the card reports a pending build instead of a 404 page.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void Promise.all(
      targets.map(async target => {
        try {
          const response = await fetch(target.href, {
            method: "HEAD",
            signal: controller.signal,
          });
          const contentType = response.headers.get("content-type") ?? "";
          // The SPA fallback answers 200 with HTML for unknown paths.
          const isReal = response.ok && !contentType.includes("text/html");
          if (!cancelled) setAvailability(current => ({ ...current, [target.name]: isReal ? "ready" : "missing" }));
        } catch {
          if (!cancelled) setAvailability(current => ({ ...current, [target.name]: "missing" }));
        }
      }),
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

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
          const state: Availability = availability[target.name] ?? "checking";
          const isReady = state === "ready";

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
                      {state === "checking" && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" /> Checking build
                        </>
                      )}
                      {isReady && (
                        <>
                          <CheckCircle2 className="h-3 w-3" /> Installer available
                        </>
                      )}
                      {state === "missing" && <span className="text-muted-foreground">Build pending</span>}
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

              {isReady ? (
                <Button asChild className="w-full">
                  <a
                    href={target.href}
                    download={target.href.split("/").pop()}
                    data-testid={`download-${target.name.toLowerCase()}`}
                  >
                    <Download className="mr-2 h-4 w-4" /> {target.button}
                  </a>
                </Button>
              ) : (
                <Button disabled className="w-full">
                  {state === "checking" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" /> Build pending
                    </>
                  )}
                </Button>
              )}
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
