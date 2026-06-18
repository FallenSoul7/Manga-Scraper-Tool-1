import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { LogOut, User, CloudUpload, CloudDownload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";
import { useLibrarySync } from "@/hooks/use-library-sync";
import { useStore } from "@/lib/storage";

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
  const libraryCount = useStore(s => Object.keys(s.library).length);

  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [dbConfigured, setDbConfigured] = useState(false);

  const { state: syncState, message: syncMessage, uploadLibrary, downloadLibrary } = useLibrarySync();

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/auth/me"), { credentials: "include" }).then(r => r.json()).catch(() => ({ user: null })),
      fetch(apiUrl("/api/auth/status"), { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch(apiUrl("/api/library/status"), { credentials: "include" }).then(r => r.json()).catch(() => ({ dbConfigured: false })),
    ]).then(([meData, statusData, libStatus]) => {
      setUser(meData.user ?? null);
      // Only mark as not configured if the API explicitly says so — don't assume on failure
      if (statusData !== null) {
        setGoogleConfigured(statusData.googleConfigured ?? true);
      }
      setDbConfigured(libStatus.dbConfigured ?? false);
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

  const isSyncing = syncState === "uploading" || syncState === "downloading";

  return (
    <main className="flex flex-col items-center px-4 pt-10 pb-8 max-w-sm mx-auto">
      {loading ? (
        <div className="flex flex-col items-center gap-3 pt-8">
          <div className="w-16 h-16 rounded-full bg-muted animate-pulse" />
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        </div>
      ) : user ? (
        <div className="w-full">
          {/* Already logged in banner */}
          <div className="w-full rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 border border-green-500/20">
              {user.photo ? (
                <img src={user.photo} alt={user.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full bg-primary flex items-center justify-center">
                  <User className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-green-700 dark:text-green-400 leading-tight">You're already logged in</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 ml-auto" />
          </div>

          {/* Library sync */}
          {dbConfigured ? (
            <div className="rounded-xl border border-border bg-card p-4 mb-4">
              <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-3">Library Sync</p>
              <p className="text-sm text-muted-foreground mb-3">
                You have <span className="font-semibold text-foreground">{libraryCount} titles</span> saved locally.
              </p>

              {syncState === "done" && (
                <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 rounded-lg px-3 py-2 mb-3">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  {syncMessage}
                </div>
              )}
              {syncState === "error" && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-3">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {syncMessage}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={uploadLibrary}
                  disabled={isSyncing}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {syncState === "uploading"
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CloudUpload className="h-4 w-4" />}
                  Save to cloud
                </button>
                <button
                  onClick={downloadLibrary}
                  disabled={isSyncing}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {syncState === "downloading"
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CloudDownload className="h-4 w-4" />}
                  Restore
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 mb-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Library sync not set up</p>
              <p>Add a <code className="text-xs bg-muted px-1 py-0.5 rounded">DATABASE_URL</code> from Neon to Render to enable cloud backup.</p>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 border border-border rounded-xl py-3 text-base font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : (
        <div className="w-full text-center pt-4">
          <div className="w-16 h-16 rounded-full bg-white shadow-md border border-border flex items-center justify-center mx-auto mb-5">
            <GoogleIcon />
          </div>
          <h2 className="text-xl font-bold mb-2">Sign in to ComiHub</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Back up your library and reading history across all your devices.
          </p>

          {!googleConfigured ? (
            <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              Google sign-in isn't enabled yet.{" "}
              <span className="font-medium text-foreground">
                Follow the setup guide in System → Login.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <a
                href={apiUrl("/api/auth/google")}
                className="w-full flex items-center justify-center gap-3 bg-primary text-primary-foreground rounded-xl py-3.5 font-semibold text-base hover:bg-primary/90 transition-colors"
              >
                <GoogleIcon />
                Sign up with Google
              </a>
              <a
                href={apiUrl("/api/auth/google")}
                className="w-full flex items-center justify-center gap-3 border border-border rounded-xl py-3.5 font-semibold text-base hover:bg-muted transition-colors"
              >
                <GoogleIcon />
                Sign in with Google
              </a>
            </div>
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
