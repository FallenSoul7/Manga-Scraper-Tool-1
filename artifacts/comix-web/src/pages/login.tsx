import { useState } from "react";
import { useLocation } from "wouter";
// ✅ FIX: Import Zustand store so we can update it in-memory after login
//         Writing only to localStorage doesn't re-render the UI.
import { useStore, storeActions } from "@/lib/storage";

const API = "https://comihub-backend.onrender.com";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"email" | "details" | "verify">("email");
  const [isLoginMode, setIsLoginMode] = useState(false);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // ✅ FIX: Read the current local library from Zustand directly — this is the
  //         pre-login library the user had. No localStorage hacks needed.
  const localLibrary = useStore(s => s.library);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.includes("@")) {
      setError("Please enter a valid email");
      return;
    }
    setStep("details");
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const endpoint = isLoginMode ? "/api/auth/login" : "/api/auth/register";

      const bodyData = isLoginMode
        ? { email, password }
        : { email, username, password };

      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");

      if (isLoginMode) {
        // accessToken comes from the fixed auth.ts login response
        const accessToken: string = data.accessToken ?? "";

        if (accessToken) {
          // Step 1: Push local (pre-login) library up so it merges with server data
          // We don't await or error on this — even if it fails (DB issue) we continue
          fetch(`${API}/api/library/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ library: localLibrary, strategy: "merge" }),
          }).catch(() => {});

          // Step 2: Pull the merged result back from the server
          try {
            const getRes = await fetch(`${API}/api/library/sync`, {
              headers: { "Authorization": `Bearer ${accessToken}` },
            });

            if (getRes.ok) {
              const syncData = await getRes.json();
              const serverLibrary: Record<string, any> = syncData.library ?? {};

              // Step 3: Merge server data with local data
              // Server is the base; keep local items that are newer or not on server
              const merged: Record<string, any> = { ...serverLibrary };
              for (const [id, localItem] of Object.entries(localLibrary)) {
                const serverItem = serverLibrary[id];
                if (!serverItem || (localItem.addedAt ?? 0) > (serverItem.addedAt ?? 0)) {
                  merged[id] = localItem;
                }
              }

              // ✅ FIX: Update Zustand store directly — this triggers an immediate
              //         re-render on all subscribers (LibraryPage etc) AND persists
              //         to localStorage via Zustand's persist middleware.
              //         Previously setLocalLibrary() only wrote localStorage, so the
              //         UI never updated without a page refresh.
              storeActions.setLibrary(merged);
            }
          } catch (downloadErr) {
            console.warn("Library restore skipped:", downloadErr);
          }
        }

        setLocation("/");
      } else {
        setStep("verify");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-background overflow-hidden shadow-2xl">
        <button
          onClick={() => setLocation("/system")}
          className="absolute right-4 top-4 z-10 p-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          ✕
        </button>

        <div className="h-24 bg-gradient-to-br from-blue-600/20 via-blue-400/10 to-background flex items-center justify-center">
          <h2 className="text-2xl font-bold">{isLoginMode ? "Welcome Back" : "Join ComiHub"}</h2>
        </div>

        <div className="px-6 pb-8 pt-2">
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
              {error}
            </div>
          )}

          {step === "email" && (
            <form onSubmit={handleEmailSubmit} noValidate className="space-y-4">
              <input
                type="email"
                required
                placeholder="Email address"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground hover:opacity-90">
                Continue
              </button>
              <button
                type="button"
                onClick={() => setIsLoginMode(!isLoginMode)}
                className="w-full text-sm text-muted-foreground hover:text-primary mt-2"
              >
                {isLoginMode ? "Need an account? Sign up" : "Already have an account? Log in"}
              </button>
            </form>
          )}

          {step === "details" && (
            <form onSubmit={handleAuthSubmit} noValidate className="space-y-4">
              {!isLoginMode && (
                <input
                  type="text"
                  required
                  placeholder="Username"
                  className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}
              <input
                type="password"
                required
                placeholder="Password"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isLoading
                  ? (isLoginMode ? "Logging in..." : "Creating...")
                  : (isLoginMode ? "Log In" : "Sign Up")}
              </button>
            </form>
          )}

          {step === "verify" && (
            <div className="text-center space-y-4">
              <h3 className="text-lg font-semibold">Check your email!</h3>
              <p className="text-sm text-muted-foreground">We sent a verification link to {email}.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
