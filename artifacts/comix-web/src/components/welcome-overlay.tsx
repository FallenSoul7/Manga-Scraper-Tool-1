import { useState, useEffect } from "react";
import { X, Download, CheckCircle2, Mail } from "lucide-react";
import { useLocation } from "wouter";
import { usePwa } from "@/lib/pwa-context";
import { apiUrl } from "@/lib/api-url";
import { setCachedUser, getCachedUser } from "@/lib/auth-cache";

const STORAGE_KEY = "comihub-welcome-v1";

type Step = "install" | "login" | "done";

function getInitialStep(): Step {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === "done") return "done";
    if (val === "login") return "login";
  } catch { /* */ }
  return "install";
}

function markStep(step: Step) {
  try {
    localStorage.setItem(STORAGE_KEY, step);
  } catch { /* */ }
}

export function WelcomeOverlay() {
  const [, setLocation] = useLocation();
  const { deferredPrompt, isStandalone } = usePwa();
  const [step, setStep] = useState<Step>(() => getInitialStep());
  const [visible, setVisible] = useState(false);

  // Show green success flash when returning from Google OAuth
  const authResult = new URLSearchParams(window.location.search).get("auth");
  const [showSuccess, setShowSuccess] = useState(authResult === "success");
  useEffect(() => {
    if (showSuccess) {
      const t = setTimeout(() => setShowSuccess(false), 1500);
      return () => clearTimeout(t);
    }
  }, [showSuccess]);

  // Check auth with server — called on mount AND whenever the PWA comes to foreground
  function checkAuth() {
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error("non-ok");
        return r.json();
      })
      .then(data => {
        if (data?.user) {
          setCachedUser(data.user);
          markStep("done");
          setStep("done");
        } else {
          // Server has no session — trust local cache so UI stays logged-in
          if (getCachedUser()) {
            markStep("done");
            setStep("done");
          }
        }
      })
      .catch(() => {
        // Network error / offline — trust local cache
        if (getCachedUser()) {
          markStep("done");
          setStep("done");
        }
      });
  }

  // Run on mount
  useEffect(() => { checkAuth(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-check when PWA comes back to foreground (iOS home screen app re-focus).
  // This is the key fix for "logged out after leaving": when the user returns
  // from Safari (where OAuth completed), we re-check the server session and
  // update the local cache accordingly.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") checkAuth(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== "done") {
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [step]);

  if (step === "done" || !visible) return null;
  if (isStandalone && step === "install") {
    markStep("login");
    setStep("login");
    return null;
  }

  function dismiss() {
    markStep("done");
    setVisible(false);
    setStep("done");
  }

  function advanceToLogin() {
    markStep("login");
    setStep("login");
  }

  async function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        dismiss();
        return;
      }
    }
    advanceToLogin();
  }

  // Show success banner standalone (no overlay card) when returning from OAuth
  if (showSuccess && (step === "done" || !visible)) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
        <div className="bg-green-500 text-white rounded-2xl px-6 py-4 flex items-center gap-3 text-base font-semibold shadow-xl">
          <CheckCircle2 className="h-6 w-6" />
          Signed in successfully!
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">

      {/* Success flash inside overlay */}
      {showSuccess && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-green-500 text-white rounded-2xl px-6 py-4 flex items-center gap-3 text-base font-semibold shadow-xl">
            <CheckCircle2 className="h-6 w-6" />
            Signed in successfully!
          </div>
        </div>
      )}

      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-background overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">

        {/* X close */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {step === "install" && (
          <>
            <div className="relative h-48 bg-gradient-to-br from-primary/30 via-primary/10 to-background flex items-center justify-center">
              <div className="w-24 h-24 rounded-3xl bg-background shadow-lg flex items-center justify-center overflow-hidden border border-border">
                <img src="/icon-source.jpg" alt="ComiHub" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              </div>
            </div>

            <div className="px-6 pb-6 pt-4 text-center">
              <h2 className="text-xl font-bold mb-1">Add ComiHub to your Home Screen</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Read manga offline, get a faster experience, and skip the browser — just like a real app.
              </p>

              <button
                onClick={handleInstall}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-base mb-3 hover:bg-primary/90 transition-colors"
              >
                <Download className="h-5 w-5" />
                Add to Home Screen
              </button>

              <button
                onClick={advanceToLogin}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                Maybe later →
              </button>
            </div>
          </>
        )}

        {step === "login" && (
          <>
            <div className="relative h-36 bg-gradient-to-br from-blue-600/20 via-blue-400/10 to-background flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 shadow flex items-center justify-center">
                <Mail className="h-8 w-8 text-primary" />
              </div>
            </div>

            <div className="px-6 pb-6 pt-4 text-center">
              <h2 className="text-xl font-bold mb-1">Sign in to sync your library</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Back up your library and reading progress across devices with your account.
              </p>

              <button
                onClick={() => { dismiss(); setLocation("/login"); }}
                className="w-full flex items-center justify-center gap-3 bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-base mb-3 hover:bg-primary/90 transition-colors"
              >
                <Mail className="h-5 w-5" />
                Sign in with Email
              </button>

              <button
                onClick={dismiss}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                Skip for now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

