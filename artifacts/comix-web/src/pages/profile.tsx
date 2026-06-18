import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, Check, AlertCircle, Pencil } from "lucide-react";
import { getCachedUser, setCachedUser, clearCachedUser, type CachedUser } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/api-url";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const [user, setUser] = useState<CachedUser | null>(() => getCachedUser());
  const [username, setUsername] = useState(getCachedUser()?.username ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  // Sync with server on mount to get latest username
  useEffect(() => {
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data?.user) {
          setCachedUser(data.user);
          setUser(data.user);
          setUsername(data.user.username ?? data.user.displayName);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    if (!username.trim() || !user) return;
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch(apiUrl("/api/auth/profile"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated: CachedUser = { ...user, username: data.user.username };
        setCachedUser(updated);
        setUser(updated);
        setUsername(updated.username);
        setStatus("saved");
        setEditing(false);
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" }).catch(() => {});
    clearCachedUser();
    setLocation("/system");
  }

  // Not logged in
  if (!user) {
    return (
      <main className="container mx-auto px-4 pt-4 max-w-md animate-in fade-in duration-300">
        <button
          onClick={() => setLocation("/system")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> System
        </button>
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="text-muted-foreground font-medium mb-2">Not signed in</p>
          <p className="text-sm text-muted-foreground mb-4">Sign in with Google to view your profile.</p>
          <button
            onClick={() => setLocation("/login")}
            className="rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 pt-4 max-w-md animate-in fade-in duration-300">
      {/* Back arrow */}
      <button
        onClick={() => setLocation("/system")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> System
      </button>

      <h1 className="text-3xl font-serif font-bold mb-6">Profile</h1>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        {/* Avatar header */}
        <div className="h-32 bg-gradient-to-br from-blue-500/15 via-blue-400/8 to-background flex items-center justify-center">
          {user.photo ? (
            <img
              src={user.photo}
              alt={user.displayName}
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-full border-4 border-background shadow-lg"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center border-4 border-background shadow-lg">
              <span className="text-3xl font-bold text-primary-foreground">
                {(user.username?.[0] ?? user.displayName?.[0] ?? "?").toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Username (editable) */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Username
            </label>
            {editing ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={username}
                  maxLength={32}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setUsername(user.username); } }}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  onClick={handleSave}
                  disabled={saving || !username.trim()}
                  className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-border bg-background/50 px-3 py-2.5">
                <span className="text-sm font-medium">{user.username || user.displayName}</span>
                <button
                  onClick={() => { setEditing(true); setUsername(user.username || user.displayName); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )}
            {status === "saved" && (
              <p className="flex items-center gap-1.5 text-xs text-green-500 mt-1.5">
                <Check className="h-3 w-3" /> Username saved
              </p>
            )}
            {status === "error" && (
              <p className="flex items-center gap-1.5 text-xs text-destructive mt-1.5">
                <AlertCircle className="h-3 w-3" /> Failed to save — try again
              </p>
            )}
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Email
            </label>
            <div className="rounded-xl border border-border bg-background/50 px-3 py-2.5">
              <span className="text-sm text-muted-foreground">{user.email}</span>
            </div>
          </div>

          {/* Google name (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Google name
            </label>
            <div className="rounded-xl border border-border bg-background/50 px-3 py-2.5">
              <span className="text-sm text-muted-foreground">{user.displayName}</span>
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={handleLogout}
            className="w-full rounded-xl border border-destructive/40 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
