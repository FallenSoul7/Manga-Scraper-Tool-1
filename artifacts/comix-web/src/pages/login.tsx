import { useEffect } from "react";
import { useLocation } from "wouter";
import { getCachedUser, setCachedUser } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/api-url";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export default function LoginPage() {
  const [, setLocation] = useLocation();

  // If already logged in → immediately go back, do nothing
  useEffect(() => {
    if (getCachedUser()) {
      setLocation("/system");
      return;
    }
    // Not cached — ask the server too (handles case where cache was cleared)
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data?.user) {
          setCachedUser(data.user);
          setLocation("/system");
        }
      })
      .catch(() => {});
  }, []);

  // If cached user — render nothing (redirect in progress)
  if (getCachedUser()) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xs mx-4 rounded-2xl bg-background overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="h-32 bg-gradient-to-br from-blue-500/20 via-blue-400/10 to-background flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-white shadow-md flex items-center justify-center">
            <GoogleIcon />
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 text-center space-y-5">
          <div>
            <h2 className="text-xl font-bold mb-1">Sign in to ComiHub</h2>
            <p className="text-sm text-muted-foreground">
              Back up your library and reading history across all your devices.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <a
              href={apiUrl("/api/auth/google")}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 hover:bg-muted transition-colors"
            >
              <GoogleIcon />
              <span className="flex-1 text-sm font-medium">Google</span>
              <span className="text-xs text-muted-foreground">Sign up</span>
            </a>
            <a
              href={apiUrl("/api/auth/google")}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 hover:bg-muted transition-colors"
            >
              <GoogleIcon />
              <span className="flex-1 text-sm font-medium">Google</span>
              <span className="text-xs text-muted-foreground">Sign in</span>
            </a>
          </div>

          <button
            onClick={() => setLocation("/system")}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
