import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { LogOut, CloudUpload, CloudDownload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api-url";
import { useLibrarySync } from "@/hooks/use-library-sync";
import { useStore } from "@/lib/storage";

interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function SuccessBanner() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div style={{
        background: "#22c55e", color: "#fff",
        borderRadius: "1rem", padding: "1.25rem 2rem",
        display: "flex", alignItems: "center", gap: "0.75rem",
        fontSize: "1.1rem", fontWeight: 600,
        boxShadow: "0 8px 32px rgba(34,197,94,0.35)",
        animation: "popIn 0.2s ease",
      }}>
        <CheckCircle2 size={26} />
        Signed in successfully!
      </div>
    </div>
  );
}

export default function LoginPage() {
  const searchString = useSearch();
  const authResult = new URLSearchParams(searchString).get("auth");
  const libraryCount = useStore(s => Object.keys(s.library).length);

  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [dbConfigured, setDbConfigured] = useState(false);
  const [showSuccess, setShowSuccess] = useState(authResult === "success");

  const { state: syncState, message: syncMessage, uploadLibrary, downloadLibrary } = useLibrarySync();

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/auth/me"), { credentials: "include" }).then(r => r.json()).catch(() => ({ user: null })),
      fetch(apiUrl("/api/auth/status"), { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch(apiUrl("/api/library/status"), { credentials: "include" }).then(r => r.json()).catch(() => ({ dbConfigured: false })),
    ]).then(([meData, statusData, libStatus]) => {
      setUser(meData.user ?? null);
      if (statusData !== null) {
        setGoogleConfigured(statusData.googleConfigured ?? true);
      }
      setDbConfigured(libStatus.dbConfigured ?? false);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (showSuccess) {
      const t = setTimeout(() => setShowSuccess(false), 1200);
      return () => clearTimeout(t);
    }
  }, [showSuccess]);

  async function handleLogout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    setUser(null);
  }

  const isSyncing = syncState === "uploading" || syncState === "downloading";

  if (loading) {
    return (
      <main className="flex flex-col items-center px-4 pt-10 pb-8 max-w-sm mx-auto">
        <div className="w-full rounded-2xl border border-border bg-card p-4 animate-pulse">
          <div className="h-4 w-40 bg-muted rounded mb-2" />
          <div className="h-3 w-28 bg-muted rounded" />
        </div>
      </main>
    );
  }

  return (
    <>
      {showSuccess && <SuccessBanner />}

      <main className="flex flex-col gap-4 px-4 pt-6 pb-8 max-w-sm mx-auto">

        {/* Status box — always at top */}
        <div className="w-full rounded-2xl border border-border bg-card px-4 py-4">
          {user ? (
            <div className="flex items-center gap-3">
              {user.photo ? (
                <img src={user.photo} alt="" className="w-10 h-10 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-green-500 uppercase tracking-wide">Already logged in</p>
                <p className="text-sm text-foreground truncate">{user.email}</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 ml-auto" />
            </div>
          ) : (
            <div className="text-center py-1">
              <p className="text-sm font-medium text-muted-foreground">Not signed in</p>
            </div>
          )}
        </div>

        {/* Sign up / Sign in buttons — only when logged out */}
        {!user && (
          <div className="grid grid-cols-2 gap-3">
            {!googleConfigured ? (
              <div className="col-span-2 rounded-xl bg-muted p-4 text-sm text-center text-muted-foreground">
                Google sign-in isn't enabled yet.
              </div>
            ) : (
              <>
                <a
                  href={apiUrl("/api/auth/google")}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 hover:bg-muted transition-colors"
                >
                  <GoogleIcon />
                  <span className="flex-1 text-sm font-medium text-center">Google</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Sign up</span>
                </a>
                <a
                  href={apiUrl("/api/auth/google")}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 hover:bg-muted transition-colors"
                >
                  <GoogleIcon />
                  <span className="flex-1 text-sm font-medium text-center">Google</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Sign in</span>
                </a>
              </>
            )}
          </div>
        )}

        {/* Library sync — only when logged in */}
        {user && (
          dbConfigured ? (
            <div className="rounded-xl border border-border bg-card p-4">
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
                <button onClick={uploadLibrary} disabled={isSyncing} className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                  {syncState === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  Save to cloud
                </button>
                <button onClick={downloadLibrary} disabled={isSyncing} className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                  {syncState === "downloading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                  Restore
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Library sync not set up</p>
              <p>Add a <code className="text-xs bg-muted px-1 py-0.5 rounded">DATABASE_URL</code> to enable cloud backup.</p>
            </div>
          )
        )}

        {/* Sign out — only when logged in */}
        {user && (
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 border border-border rounded-xl py-3 text-base font-medium text-destructive hover:bg-destructive/10 transition-colors">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        )}
      </main>
    </>
  );
}
