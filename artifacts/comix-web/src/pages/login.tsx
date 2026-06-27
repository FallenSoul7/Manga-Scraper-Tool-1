import { useState } from "react";
import { useLocation } from "wouter";

const API = "https://comihub-backend.onrender.com";

// ✅ FIX: Reads local library from window state OR localStorage.
//         Adjust the localStorage key below to match your Zustand persist key.
function getLocalLibrary(): Record<string, any> {
  try {
    if ((window as any).mangaLibrary && typeof (window as any).mangaLibrary === "object") {
      return (window as any).mangaLibrary;
    }
    // ⚠️ Change "comihub-library" to whatever key your Zustand store uses
    const raw = localStorage.getItem("comihub-library");
    if (raw) {
      const parsed = JSON.parse(raw);
      // Handle Zustand's wrapped format: { state: { library: {...} } }
      return parsed?.state?.library ?? parsed?.library ?? parsed ?? {};
    }
  } catch {}
  return {};
}

// ✅ FIX: Writes merged library back to both window state and localStorage.
function setLocalLibrary(library: Record<string, any>) {
  try {
    (window as any).mangaLibrary = library;
    // ⚠️ Change "comihub-library" to whatever key your Zustand store uses
    const raw = localStorage.getItem("comihub-library");
    if (raw) {
      const parsed = JSON.parse(raw);
      // Preserve Zustand's wrapper structure if it exists
      if (parsed?.state) {
        parsed.state.library = library;
        localStorage.setItem("comihub-library", JSON.stringify(parsed));
      } else {
        localStorage.setItem("comihub-library", JSON.stringify(library));
      }
    } else {
      localStorage.setItem("comihub-library", JSON.stringify(library));
    }
  } catch {}
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"email" | "details" | "verify">("email");
  const [isLoginMode, setIsLoginMode] = useState(false);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
        // ✅ FIX: accessToken now comes from the fixed auth.ts login response
        const accessToken: string = data.accessToken ?? "";

        if (accessToken) {
          // Step 1: Snapshot whatever the user had locally before logging in
          const localLibrary = getLocalLibrary();

          // Step 2: Push local library up to server (merges with any existing server data)
          try {
            await fetch(`${API}/api/library/sync`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ library: localLibrary, strategy: "merge" }),
            });
          } catch (uploadErr) {
            console.warn("Library upload skipped:", uploadErr);
          }

          // Step 3: Pull the fully merged result back from the server
          try {
            const getRes = await fetch(`${API}/api/library/sync`, {
              headers: { "Authorization": `Bearer ${accessToken}` },
            });

            if (getRes.ok) {
              const syncData = await getRes.json();
              const mergedLibrary: Record<string, any> = syncData.library ?? {};
              // Step 4: Restore merged library locally so the app sees it immediately
              setLocalLibrary(mergedLibrary);
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
