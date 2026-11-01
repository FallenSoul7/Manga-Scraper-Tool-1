import { useEffect, useState } from "react";
import { LockKeyhole, Rocket, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { detectHelper } from "@/services/fetcher";

const HIDE_KEY = "hide_extension_modal";
const EXTENSION_ARCHIVE_URL = "https://github.com/FallenSoul7/Manga-Scraper-Tool-1/raw/main/extension/comihub-web-helper.zip";
const EXTENSION_GUIDE_URL = "https://github.com/FallenSoul7/Manga-Scraper-Tool-1/tree/main/extension";

type MobileTarget = "ios-safari" | "android-chrome" | null;

function mobileTarget(): MobileTarget {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  if (isSafari) return "ios-safari";
  const isAndroid = /Android/i.test(ua);
  const isChromeLike = /Chrome|Chromium|CriOS/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
  return isAndroid && isChromeLike ? "android-chrome" : null;
}

export function MobileHelperOnboarding() {
  const [target, setTarget] = useState<MobileTarget>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(HIDE_KEY) === "true") return;
    const detected = mobileTarget();
    if (!detected) return;
    setTarget(detected);
    void detectHelper().then(status => {
      if (status !== "active" && localStorage.getItem(HIDE_KEY) !== "true") setOpen(true);
    });
  }, []);

  const dismiss = () => {
    localStorage.setItem(HIDE_KEY, "true");
    setOpen(false);
  };

  if (!target) return null;
  const ios = target === "ios-safari";
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) dismiss(); }}>
      <DialogContent className="max-w-md overflow-y-auto max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="text-xl">⚡ Unlock 100% On-Device Mode</DialogTitle>
          <DialogDescription>
            Add the optional ComiHub Helper to connect to source sites from your own device.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3 text-sm">
          <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /><span><strong>🛡️ 100% Privacy &amp; Security</strong><br /><span className="text-muted-foreground">All scraping runs directly on your device, with zero server tracking.</span></span></li>
          <li className="flex gap-3"><Rocket className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><span><strong>🚀 Faster Loading</strong><br /><span className="text-muted-foreground">Connect directly using your own device IP.</span></span></li>
          <li className="flex gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><span><strong>🔒 Zero Third-Party Middlemen</strong><br /><span className="text-muted-foreground">Keep source requests between your device and the source.</span></span></li>
        </ul>

        <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
          <p className="font-semibold">{ios ? "Mobile Safari setup" : "Mobile Chrome / Android setup"}</p>
          {ios ? (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>Download and install the Safari Web Extension module.</li>
              <li>Open <strong className="text-foreground">iOS Settings → Safari → Extensions</strong> and switch <strong className="text-foreground">ComiHub Helper</strong> on.</li>
            </ol>
          ) : (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>Download the helper file below.</li>
              <li>Install it in an extension-supported Android browser such as Firefox Mobile, Kiwi, or Edge.</li>
            </ol>
          )}
        </div>

        <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
          <Button asChild className="w-full">
            <a href={ios ? EXTENSION_GUIDE_URL : EXTENSION_ARCHIVE_URL} target="_blank" rel="noreferrer">
              Install Helper Extension
            </a>
          </Button>
          <Button variant="ghost" className="w-full" onClick={dismiss}>
            Continue with Standard Web Mode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
