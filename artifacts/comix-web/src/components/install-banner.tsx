import { useState, useEffect } from "react";
import { X, AppWindow, Share } from "lucide-react";
import { usePwa } from "@/lib/pwa-context";

const DISMISSED_KEY = "comihub-install-dismissed";

export function InstallBanner() {
  const { deferredPrompt, isInstalled, isIOS, promptInstall } = usePwa();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(DISMISSED_KEY);
    if (!saved) setDismissed(false);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  const handleInstall = async () => {
    const result = await promptInstall();
    if (result === "accepted") handleDismiss();
  };

  if (isInstalled || dismissed) return null;
  if (!deferredPrompt && !isIOS) return null;

  return (
    <div className="w-full bg-primary/10 border-b border-primary/20 px-4 py-2.5 flex items-center gap-3 text-sm animate-in slide-in-from-top-2 duration-200">
      <div className="h-8 w-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
        {isIOS ? <Share className="h-4 w-4" /> : <AppWindow className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        {isIOS ? (
          <p className="text-foreground leading-tight">
            <span className="font-semibold">Install ComiHub</span>
            {" — tap "}<strong>Share</strong>{" → "}<strong>Add to Home Screen</strong>
          </p>
        ) : (
          <p className="text-foreground leading-tight">
            <span className="font-semibold">Install ComiHub</span>{" for offline reading"}
          </p>
        )}
      </div>
      {!isIOS && deferredPrompt && (
        <button
          onClick={handleInstall}
          className="shrink-0 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          Install
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
