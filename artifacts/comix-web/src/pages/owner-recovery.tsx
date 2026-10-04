import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiUrl } from "@/lib/api-url";

type Owner = { id: string; email: string };

export default function OwnerRecoveryPage() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(apiUrl("/api/auth/owner-recovery/users"), { credentials: "include" })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Owner access required.");
        setOwners(data.users ?? []);
      })
      .catch(err => setError(err instanceof Error ? err.message : "Unable to load owner accounts."));
  }, []);

  async function reset(owner: Owner) {
    const password = passwords[owner.id] ?? "";
    setError("");
    setStatus(current => ({ ...current, [owner.id]: "" }));
    if (password.length < 8) {
      setStatus(current => ({ ...current, [owner.id]: "Use at least 8 characters." }));
      return;
    }
    const response = await fetch(apiUrl("/api/auth/owner-recovery/reset"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: owner.id, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(current => ({ ...current, [owner.id]: data.error || "Unable to update password." }));
      return;
    }
    setPasswords(current => ({ ...current, [owner.id]: "" }));
    setStatus(current => ({ ...current, [owner.id]: "Password updated and existing sessions signed out." }));
  }

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 py-10">
      <Link href="/system" className="text-sm text-primary underline">Back to System</Link>
      <section className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Owner password recovery</h1>
        <p className="mt-2 text-sm text-muted-foreground">Set a new password privately for an owner account. Passwords are sent directly to Supabase Auth, never stored by ComiHub, and never shown after submission.</p>
        {error && <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
        <div className="mt-6 space-y-4">
          {owners.map(owner => (
            <div key={owner.id} className="rounded-xl border p-4">
              <p className="font-medium">{owner.email}</p>
              <div className="mt-3 flex gap-2">
                <input type="password" autoComplete="new-password" placeholder="New password" value={passwords[owner.id] ?? ""} onChange={event => setPasswords(current => ({ ...current, [owner.id]: event.target.value }))} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary" />
                <button type="button" onClick={() => reset(owner)} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Set password</button>
              </div>
              {status[owner.id] && <p className="mt-2 text-xs text-muted-foreground">{status[owner.id]}</p>}
            </div>
          ))}
          {!error && owners.length === 0 && <p className="text-sm text-muted-foreground">Loading owner accounts...</p>}
        </div>
      </section>
    </main>
  );
}
