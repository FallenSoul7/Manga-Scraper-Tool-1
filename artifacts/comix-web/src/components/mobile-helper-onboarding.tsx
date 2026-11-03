import { useEffect, useState } from "react";
import { CheckCircle2, LockKeyhole, Rocket } from "lucide-react";
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
const EXTENSION_ARCHIVE_URL = "https://github.com/FallenSoul7/Manga-Scraper-Tool-1/releases/latest/download/comihub-web-helper.zip";

type MobileTarget = "ios-safari" | "android-chrome" | null;
const MOBILE_BROWSER_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export function isMobileWebBrowser(userAgent: string, viewportWidth?: number): boolean {
  return MOBILE_BROWSER_RE.test(userAgent) || (viewportWidth ?? Infinity) <= 768;
}

export function detectMobileTarget(userAgent: string, platform = "", maxTouchPoints = 0): MobileTarget {
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  const isSafari = isIOS && /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  if (isSafari) return "ios-safari";
  const isAndroid = /Android/i.test(userAgent);
  const isChromeLike = /Chrome|Chromium|CriOS/i.test(userAgent) && !/EdgA|OPR|SamsungBrowser/i.test(userAgent);
  return isAndroid && isChromeLike ? "android-chrome" : null;
}

function mobileTarget(): MobileTarget {
  if (typeof navigator === "undefined") return null;
  return detectMobileTarget(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

export function MobileHelperOnboarding() {
  const [target, setTarget] = useState<MobileTarget>(null);
  const [open, setOpen] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(HIDE_KEY) === "true") return;
    if (isMobileWebBrowser(navigator.userAgent, window.innerWidth)) return;
    const detected = mobileTarget();
    if (!detected || detected === "ios-safari") return;
    setTarget(detected);
    setOpen(true);
    void detectHelper().then(status => {
      if (status === "active" || localStorage.getItem(HIDE_KEY) === "true") setOpen(false);
    });
  }, []);

  const dismiss = () => {
    localStorage.setItem(HIDE_KEY, "true");
    setOpen(false);
  };

  const chooseStandardMode = () => {
    localStorage.setItem(HIDE_KEY, "true");
    localStorage.setItem("comihub-helper-enabled", "false");
    setOpen(false);
  };

  const openInstallGuide = () => setShowInstallGuide(true);

  if (!target) return null;
  const ios = target === "ios-safari";
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) dismiss(); }}>
      <DialogContent className="w-[70vw] max-w-[20rem] max-h-[70dvh] gap-3 overflow-y-auto p-4">
        {showInstallGuide ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">Install ComiHub Helper</DialogTitle>
              <DialogDescription className="text-xs">The download stays in this popup; no GitHub page is opened.</DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-2.5 text-xs">
              <p className="font-semibold">{ios ? "Mobile Safari" : "Android browser"}</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
                {ios ? (
                  <li>iOS Safari cannot install a raw ZIP. A signed ComiHub Safari Web Extension app from the App Store or TestFlight is required before it can appear in <strong className="text-foreground">Settings → Safari → Extensions</strong>.</li>
                ) : (
                  <>
                    <li><a className="font-medium text-primary underline" href={EXTENSION_ARCHIVE_URL} download="comihub-web-helper.zip">Download the helper extension file</a>.</li>
                    <li>Open the file in an extension-supported browser such as Firefox Mobile, Kiwi, or Edge.</li>
                  </>
                )}
              </ol>
            </div>
            <DialogFooter className="gap-1.5 sm:flex-col sm:space-x-0">
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setShowInstallGuide(false)}>Back</Button>
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={chooseStandardMode}>Continue with Standard Web Mode</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">Unlock 100% On-Device Mode</DialogTitle>
              <DialogDescription className="text-xs">
                Add the optional ComiHub Helper to connect to source sites from your own device.
              </DialogDescription>
            </DialogHeader>

            <ul className="space-y-2 text-xs">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span><strong>100% Privacy &amp; Security</strong><br /><span className="text-muted-foreground">All scraping runs directly on your device, with zero server tracking.</span></span></li>
          <li className="flex gap-2"><Rocket className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" /><span><strong>Faster Loading</strong><br /><span className="text-muted-foreground">Connect directly using your own device IP.</span></span></li>
          <li className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" /><span><strong>Zero Third-Party Middlemen</strong><br /><span className="text-muted-foreground">Keep source requests between your device and the source.</span></span></li>
            </ul>

            <div className="rounded-xl border border-border/70 bg-muted/30 p-2.5 text-xs">
          <p className="font-semibold">{ios ? "Mobile Safari setup" : "Mobile Chrome / Android setup"}</p>
          {ios ? (
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>Wait for a signed ComiHub Safari Web Extension app to be distributed through the App Store or TestFlight.</li>
              <li>Open <strong className="text-foreground">iOS Settings → Safari → Extensions</strong> and switch <strong className="text-foreground">ComiHub Helper</strong> on.</li>
            </ol>
          ) : (
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>Download the helper file below.</li>
              <li>Install it in an extension-supported Android browser such as Firefox Mobile, Kiwi, or Edge.</li>
            </ol>
          )}
            </div>

            <DialogFooter className="gap-1.5 sm:flex-col sm:space-x-0">
              <Button size="sm" className="w-full text-xs" onClick={openInstallGuide}>Install Helper Extension</Button>
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={chooseStandardMode}>Continue with Standard Web Mode</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
