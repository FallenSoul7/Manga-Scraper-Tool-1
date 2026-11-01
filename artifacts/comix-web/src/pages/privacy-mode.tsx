import { ArrowLeft, CheckCircle2, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const EXTENSION_ARCHIVE_URL = "https://github.com/FallenSoul7/Manga-Scraper-Tool-1/raw/main/extension/comihub-web-helper.zip";

type BrowserKind = "ios-safari" | "android-chrome" | "edge" | "chrome" | "firefox" | "safari" | "other";

function detectBrowser(): BrowserKind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return "ios-safari";
  if (/Android/i.test(ua) && /Chrome|Chromium|CriOS/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua)) return "android-chrome";
  if (/Edg\//i.test(ua)) return "edge";
  if (/Chrome|Chromium/i.test(ua) && !/Edg\//i.test(ua)) return "chrome";
  if (/Firefox/i.test(ua)) return "firefox";
  if (/Safari/i.test(ua) && !/Chrome|Chromium/i.test(ua)) return "safari";
  return "other";
}

const browserCopy: Record<BrowserKind, { name: string; steps: string[] }> = {
  "ios-safari": {
    name: "Mobile Safari on iOS",
    steps: ["Download the helper package below and install it as a Safari Web Extension module.", "Open iOS Settings → Safari → Extensions.", "Turn on ComiHub Helper, then allow it on comihub.top in Safari."]
  },
  "android-chrome": {
    name: "Chrome on Android",
    steps: ["Download the helper ZIP below.", "Open it in an extension-supported browser such as Firefox Mobile, Kiwi, or Edge.", "Enable the extension in that browser's Extensions settings."]
  },
  edge: {
    name: "Microsoft Edge",
    steps: ["Download and unzip the helper package.", "Open edge://extensions and enable Developer mode.", "Choose Load unpacked, select the extracted extension folder, and enable ComiHub Helper."]
  },
  chrome: {
    name: "Google Chrome or Chromium",
    steps: ["Download and unzip the helper package.", "Open chrome://extensions and enable Developer mode.", "Choose Load unpacked, select the extracted extension folder, and enable ComiHub Helper."]
  },
  firefox: {
    name: "Firefox",
    steps: ["Download the helper package and unzip it.", "Open about:debugging#/runtime/this-firefox.", "Choose Load Temporary Add-on and select manifest.json. A signed build is required for permanent installation."]
  },
  safari: {
    name: "Safari on macOS",
    steps: ["Download the helper package and use Safari Web Extension Converter or an Xcode Safari Web Extension wrapper.", "Build or install the Safari extension module.", "Open Safari Settings → Extensions and enable ComiHub Helper."]
  },
  other: {
    name: "Your browser",
    steps: ["Download the helper package below.", "Open your browser's Extensions settings and enable Developer mode if required.", "Load the extracted extension folder, then enable ComiHub Helper for comihub.top."]
  },
};

export default function PrivacyModePage() {
  const browser = detectBrowser();
  const copy = browserCopy[browser];

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8 animate-in fade-in duration-300">
      <Link href="/system" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> System
      </Link>

      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Privacy Mode</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the optional helper to make source requests directly from your device.</p>
        </div>
      </div>

      <section className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="text-sm font-semibold">Detected environment: {copy.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">The instructions below are matched to this browser.</p>
        </div>

        <div>
          <h2 className="text-base font-semibold">Enable direct client requests</h2>
          <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
            {copy.steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild className="gap-2">
            <a href={EXTENSION_ARCHIVE_URL} download="comihub-web-helper.zip">
              <Download className="h-4 w-4" /> Download Helper Extension
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/extension-settings"><CheckCircle2 className="h-4 w-4" /> Extension Settings</Link>
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5" /> The helper is optional; Standard Web Mode remains available without installation.
        </p>
      </section>
    </main>
  );
}
