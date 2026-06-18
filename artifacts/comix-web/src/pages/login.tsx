import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { X, LogOut, CheckCircle2, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api-url";
import { getCachedUser, setCachedUser, clearCachedUser, type CachedUser } from "@/lib/auth-cache";

function GoogleIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function LoginPage() {
  const searchString = useSearch();
  const authResult = new URLSearchParams(searchString).get("auth");
  const [, setLocation] = useLocation();

  // Show immediately from cache — no flicker, no waiting
  const [user, setUser] = useState<CachedUser | null>(() => getCachedUser());
  const [verifying, setVerifying] = useState(true);
  // Default true — only flip to false if server explicitly says so (not on network errors)
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [serverReached, setServerReached] = useState(false);
  const [showSuccess, setShowSuccess] = useState(authResult === "success");

  useEffect(() => {
    // When coming back from OAuth with ?auth=success, fetch & cache the real user
    const fetchAndCache = async () => {
      try {
        const [meRes, statusRes] = await Promise.all([
          fetch(apiUrl("/api/auth/me"), { credentials: "include" }).then(r => r.json()).catch(() => ({ user: null })),
          fetch(apiUrl("/api/auth/status"), { credentials: "include" }).then(r => r.json()).catch(() => null),
        ]);

        if (meRes?.user) {
          setCachedUser(meRes.user);
          setUser(meRes.user);
        } else if (authResult !== "success") {
          // Only clear cache if this is NOT a fresh login — server confirmed no session
          const cached = getCachedUser();
          if (cached) setUser(cached); // keep showing cache; server might just have CORS issues
        }

        if (statusRes !== null) {
          setServerReached(true);
          setGoogleConfigured(statusRes.googleConfigured ?? true);
        }
      } finally {
        setVerifying(false);
      }
    };

    fetchAndCache();
  }, []);

  useEffect(() => {
    if (showSuccess) {
      const t = setTimeout(() => setShowSuccess(false), 1500);
      return () => clearTimeout(t);
    }
  }, [showSuccess]);

  async function handleLogout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" }).catch(() => {});
    clearCachedUser();
    setUser(null);
  }

  const isLoggedIn = !!user;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">

      {/* Green success flash */}
      {showSuccess && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="bg-green-500 text-white rounded-2xl px-6 py-5 flex items-center gap-3 text-base font-semibold shadow-2xl">
            <CheckCircle2 className="h-6 w-6 flex-shrink-0" />
            Signed in successfully!
          </div>
        </div>
      )}

      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-background overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">

        {/* Close button → back to system */}
        <button
          onClick={() => setLocation("/system")}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {isLoggedIn ? (
          /* ─── LOGGED IN ─── */
          <>
            {/* Profile header */}
            <div className="h-40 bg-gradient-to-br from-green-500/15 via-emerald-400/10 to-background flex flex-col items-center justify-center gap-2 pt-4">
              {user.photo ? (
                <img
                  src={user.photo}
                  alt={user.displayName}
                  className="w-16 h-16 rounded-full shadow-lg border-2 border-background"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center shadow-lg">
                  <span className="text-2xl font-bold text-primary-foreground">
                    {user.displayName?.[0]?.toUpperCase() ?? "?"}
                  </span>
                </div>
              )}
              <span className="text-xs font-semibold text-green-500 uppercase tracking-widest">Logged in</span>
            </div>

            <div className="px-6 pb-6 pt-3 text-center space-y-4">
              {/* Real name & email from Google */}
              <div>
                <p className="text-lg font-bold leading-tight">{user.displayName}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
              </div>

              {verifying && (
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Verifying session…
                </p>
              )}

              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 border border-border rounded-xl py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </>
        ) : (
          /* ─── NOT LOGGED IN ─── */
          <>
            <div className="h-36 bg-gradient-to-br from-blue-500/20 via-blue-400/10 to-background flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-white shadow-md flex items-center justify-center">
                <GoogleIcon size={28} />
              </div>
            </div>

            <div className="px-6 pb-6 pt-4 text-center space-y-5">
              <div>
                <h2 className="text-xl font-bold mb-1">Sign in to ComiHub</h2>
                <p className="text-sm text-muted-foreground">
                  Back up your library and reading history across all your devices.
                </p>
              </div>

              {serverReached && !googleConfigured ? (
                <p className="text-xs text-muted-foreground bg-muted rounded-xl p-3">
                  Google sign-in isn't configured yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={apiUrl("/api/auth/google")}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 hover:bg-muted transition-colors"
                  >
                    <GoogleIcon size={18} />
                    <span className="flex-1 text-sm font-medium">Google</span>
                    <span className="text-xs text-muted-foreground">Sign up</span>
                  </a>
                  <a
                    href={apiUrl("/api/auth/google")}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 hover:bg-muted transition-colors"
                  >
                    <GoogleIcon size={18} />
                    <span className="flex-1 text-sm font-medium">Google</span>
                    <span className="text-xs text-muted-foreground">Sign in</span>
                  </a>
                </div>
              )}

              <button
                onClick={() => setLocation("/system")}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Maybe later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
