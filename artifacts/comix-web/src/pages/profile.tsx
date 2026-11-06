import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Check, AlertCircle, Pencil, UserRound, Upload } from "lucide-react";
import { getCachedUser, setCachedUser, clearCachedUser, onAuthChanged, type CachedUser } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/api-url";

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function makeAvatarWebp(file: File): Promise<Blob> {
  if (file.size > MAX_AVATAR_BYTES) throw new Error("Choose an image no larger than 4 MiB.");
  if (!ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new Error("Use a JPEG, PNG, or WebP image. SVG and other file types are not allowed.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 12_000 || bitmap.height > 12_000 || bitmap.width * bitmap.height > 36_000_000) {
      throw new Error("That image is too large to process safely.");
    }
    const canvas = document.createElement("canvas");
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable in this browser.");

    context.fillStyle = "#e7e1d8";
    context.fillRect(0, 0, size, size);
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);

    const result = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not process this image.")), "image/webp", 0.86);
    });
    if (result.size > MAX_AVATAR_BYTES) throw new Error("The processed image exceeds the 4 MiB limit.");
    return result;
  } finally {
    bitmap.close();
  }
}

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const [user, setUser] = useState<CachedUser | null>(() => getCachedUser());
  const [username, setUsername] = useState(getCachedUser()?.username ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [avatarStatus, setAvatarStatus] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [avatarMessage, setAvatarMessage] = useState("");
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [avatarRevision, setAvatarRevision] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then(res => res.ok ? res.json() : Promise.reject(new Error("Profile check failed")))
      .then(data => {
        if (!active) return;
        if (data?.user) {
          const next = data.user as CachedUser;
          setCachedUser(next);
          setUser(next);
          setUsername(next.username ?? next.displayName ?? "");
        } else {
          clearCachedUser();
          setUser(null);
          setUsername("");
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => onAuthChanged(() => {
    const next = getCachedUser();
    setUser(next);
    setUsername(next?.username ?? next?.displayName ?? "");
  }), []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setAvatarSrc(null);
    if (!userId) return () => { active = false; };

    fetch(apiUrl("/api/auth/profile/avatar"), { credentials: "include" })
      .then(async res => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("Could not load profile picture.");
        return res.blob();
      })
      .then(blob => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarSrc(objectUrl);
      })
      .catch(() => { if (active) setAvatarSrc(null); });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, avatarRevision]);

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
      if (!res.ok) throw new Error("Failed to save username.");
      const data = await res.json();
      const updated: CachedUser = { ...user, username: data.user.username };
      setCachedUser(updated);
      setUser(updated);
      setUsername(updated.username);
      setStatus("saved");
      setEditing(false);
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !user) return;
    setAvatarStatus("busy");
    setAvatarMessage("");
    try {
      const webp = await makeAvatarWebp(file);
      const res = await fetch(apiUrl("/api/auth/profile/avatar"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "image/webp" },
        body: webp,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Profile picture could not be saved.");
      setAvatarStatus("saved");
      setAvatarMessage("Picture saved.");
      setAvatarRevision(value => value + 1);
    } catch (error) {
      setAvatarStatus("error");
      setAvatarMessage(error instanceof Error ? error.message : "Profile picture could not be saved.");
    }
  }

  async function handleLogout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" }).catch(() => {});
    clearCachedUser();
    setUser(null);
    setLocation("/system");
  }

  if (!user && !authChecked) {
    return (
      <main className="container mx-auto px-4 pt-4 max-w-md animate-in fade-in duration-300">
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Checking sign-in…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container mx-auto px-4 pt-4 max-w-md animate-in fade-in duration-300">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-10 text-center">
          <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border-4 border-background bg-muted text-muted-foreground shadow-sm">
            <UserRound className="h-12 w-12" />
          </div>
          <p className="text-lg font-semibold text-foreground">Not logged in</p>
          <p className="mt-2 mb-5 text-sm text-muted-foreground">Sign in to view and personalize your profile.</p>
          <button onClick={() => setLocation("/login")} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 pt-4 max-w-md animate-in fade-in duration-300">
      <div className="rounded-2xl border border-primary/30 bg-card overflow-hidden shadow-sm">
        <div className="flex flex-col items-center px-6 pt-6 pb-5">
          <p className="mb-4 text-center text-sm font-semibold text-primary">Logged in</p>
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-muted text-muted-foreground shadow-md">
            {avatarSrc ? <img src={avatarSrc} alt="Profile picture" className="h-full w-full object-cover" /> : <UserRound className="h-14 w-14" />}
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarStatus === "busy"}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            {avatarStatus === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {avatarStatus === "busy" ? "Saving picture…" : "Change picture"}
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">JPEG, PNG, or WebP · up to 4 MiB · stored privately in your account</p>
          {avatarMessage && <p className={`mt-2 text-center text-xs ${avatarStatus === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{avatarMessage}</p>}
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Username</label>
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
                <button onClick={handleSave} disabled={saving || !username.trim()} className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-border bg-background/50 px-3 py-2.5">
                <span className="text-sm font-medium">Username: {user.username || user.displayName}</span>
                <button aria-label="Edit username" onClick={() => { setEditing(true); setUsername(user.username || user.displayName); }} className="text-muted-foreground transition-colors hover:text-foreground">
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )}
            {status === "saved" && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-500"><Check className="h-3 w-3" /> Username saved</p>}
            {status === "error" && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="h-3 w-3" /> Failed to save — try again</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
            <div className="rounded-xl border border-border bg-background/50 px-3 py-2.5 text-sm text-muted-foreground">{user.email}</div>
          </div>

          <button onClick={handleLogout} className="w-full rounded-xl border border-destructive/40 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10">
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
