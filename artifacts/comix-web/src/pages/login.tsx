import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { LogOut, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl, API_BASE } from "@/lib/api-url";

interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}

export default function LoginPage() {
  const searchString = useSearch();
  const authResult = new URLSearchParams(searchString).get("auth");
  const { toast } = useToast();

  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/auth/me"), { credentials: "include" }).then(r => r.json()).catch(() => ({ user: null })),
      fetch(apiUrl("/api/auth/status"), { credentials: "include" }).then(r => r.json()).catch(() => ({ googleConfigured: false })),
    ]).then(([meData, statusData]) => {
      setUser(meData.user ?? null);
      setGoogleConfigured(statusData.googleConfigured ?? false);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (authResult === "success") {
      toast({ title: "Signed in!", description: "You're now signed in with Google." });
    } else if (authResult === "error") {
      toast({ title: "Sign-in failed", description: "Something went wrong. Try again.", variant: "destructive" });
    }
  }, [authResult]);

  async function handleLogout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    setUser(null);
    toast({ title: "Signed out" });
  }

  return (
    <main className="flex flex-col items-center px-4 pt-12 pb-8 min-h-[60vh]">
      {loading ? (
        <div className="w-12 h-12 rounded-full bg-muted animate-pulse" />
      ) : user ? (
        <div className="w-full max-w-sm text-center">
          <div className="relative mx-auto mb-4 w-20 h-20">
            {user.photo ? (
              <img src={user.photo} alt={user.displayName} className="w-20 h-20 rounded-full shadow-md" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center">
                <User className="h-10 w-10 text-primary-foreground" />
              </div>
            )}
            <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-green-500 border-2 border-background" />
          </div>

          <h2 className="text-xl font-bold mb-1">{user.displayName}</h2>
          <p className="text-sm text-muted-foreground mb-8">{user.email}</p>

          <div className="rounded-xl border border-border bg-card p-4 text-left mb-6">
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-2">Account</p>
            <p className="text-sm font-medium">{user.displayName}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 border border-border rounded-xl py-3 text-base font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full bg-white shadow-md border border-border flex items-center justify-center mx-auto mb-5">
            <GoogleIcon />
          </div>
          <h2 className="text-xl font-bold mb-2">Sign in to ComiHub</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Back up your library and reading history across all your devices.
          </p>

          {!googleConfigured ? (
            <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              Google sign-in isn't set up yet.{" "}
              <span className="font-medium text-foreground">Add your Google credentials to Render to enable it.</span>
            </div>
          ) : (
            <a
              href={apiUrl("/api/auth/google")}
              className="w-full flex items-center justify-center gap-3 border border-border rounded-xl py-3.5 font-semibold text-base hover:bg-muted transition-colors"
            >
              <GoogleIcon />
              Sign in with Google
            </a>
          )}
        </div>
      )}
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
