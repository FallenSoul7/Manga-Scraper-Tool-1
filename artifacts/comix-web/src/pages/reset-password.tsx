import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { apiUrl } from "@/lib/api-url";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [accessToken, setAccessToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("access_token") ?? "";
    const type = params.get("type");
    if (token && type === "recovery") setAccessToken(token);
    else setError("This password-reset link is missing or expired. Request a new one from the login page.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!accessToken) {
      setError("This password-reset link is missing or expired.");
      return;
    }
    if (password.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    if (!supabaseUrl || !supabaseKey) {
      setError("Password recovery is not configured on this deployment.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.msg || data.error_description || "The reset link may have expired. Please request a new one.");
      }
      setMessage("Password updated. You can now sign in with your new password.");
      setTimeout(() => setLocation("/login"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose a new password for your ComiHub account. Your old password cannot be recovered.</p>
        {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
        {message && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600">{message}</div>}
        {!message && (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <input type="password" required minLength={8} autoComplete="new-password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
            <input type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm new password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
            <button type="submit" disabled={busy || !accessToken} className="w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground disabled:opacity-50">{busy ? "Updating..." : "Update password"}</button>
          </form>
        )}
        <Link href="/login" className="mt-5 block text-center text-sm text-primary underline">Back to login</Link>
      </div>
    </div>
  );
}
