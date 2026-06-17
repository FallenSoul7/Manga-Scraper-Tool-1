import { Link } from "wouter";
import { ArrowLeft, AppWindow, Share, Plus, CheckCircle2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwa } from "@/lib/pwa-context";

export default function InstallPage() {
  const { deferredPrompt, isInstalled, isIOS, isAndroid, promptInstall } = usePwa();

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl animate-in fade-in duration-500">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-3 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to System
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Install</h1>
        <p className="text-muted-foreground">Add ComiHub to your home screen for a full-screen offline experience.</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-6">

        {isInstalled && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <p className="text-xl font-semibold text-foreground">Already installed!</p>
              <p className="text-sm text-muted-foreground mt-1">ComiHub is running as a home screen app.</p>
            </div>
          </div>
        )}

        {!isInstalled && isAndroid && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Android / Chrome</p>
                <p className="text-sm text-muted-foreground">
                  {deferredPrompt ? "Tap below to install ComiHub instantly." : "Use Chrome's menu to install."}
                </p>
              </div>
            </div>

            {deferredPrompt ? (
              <Button className="w-full" onClick={promptInstall}>
                <AppWindow className="mr-2 h-4 w-4" /> Install ComiHub
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-border p-4 text-sm text-muted-foreground">
                <p>Open Chrome's menu and follow these steps:</p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Tap the <strong>⋮</strong> menu in the top-right corner.</li>
                  <li>Tap <strong>"Add to Home screen"</strong>.</li>
                  <li>Tap <strong>"Add"</strong> to confirm.</li>
                </ol>
              </div>
            )}
          </div>
        )}

        {!isInstalled && isIOS && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Share className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">iPhone / Safari</p>
                <p className="text-sm text-muted-foreground">Follow these three steps in Safari.</p>
              </div>
            </div>

            <ol className="space-y-4">
              {[
                {
                  icon: <Share className="h-5 w-5" />,
                  text: <>Tap the <strong>Share</strong> icon at the bottom of Safari (the square with an arrow).</>,
                },
                {
                  icon: <Plus className="h-5 w-5" />,
                  text: <>Scroll down and tap <strong>"Add to Home Screen"</strong>.</>,
                },
                {
                  icon: <CheckCircle2 className="h-5 w-5" />,
                  text: <>Tap <strong>"Add"</strong> in the top-right corner.</>,
                },
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-4">
                  <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center shrink-0 text-foreground">
                    {step.icon}
                  </div>
                  <p className="text-sm text-muted-foreground pt-2">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!isInstalled && !isIOS && !isAndroid && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <AppWindow className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Desktop / Chrome or Edge</p>
                <p className="text-sm text-muted-foreground">
                  {deferredPrompt ? "Click below to install ComiHub as a desktop app." : "Use the browser menu to install."}
                </p>
              </div>
            </div>

            {deferredPrompt ? (
              <Button className="w-full" onClick={promptInstall}>
                <AppWindow className="mr-2 h-4 w-4" /> Install ComiHub
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-border p-4 text-sm text-muted-foreground">
                <p>To install in Chrome or Edge:</p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Click the <strong>⋮</strong> menu in the top-right corner.</li>
                  <li>Select <strong>"Save and share"</strong> → <strong>"Install page as app"</strong>.</li>
                  <li>Click <strong>"Install"</strong> to confirm.</li>
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
