import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { getCachedUser } from "@/lib/auth-cache";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"email" | "details" | "verify">("email");
  
  // Form State
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (getCachedUser()) {
      setLocation("/system");
    }
  }, [setLocation]);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setStep("details");
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // We will connect this to your backend/Supabase next
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });

      if (res.ok) {
        setStep("verify");
      } else {
        // Handle error (e.g., email already exists)
        console.error("Registration failed");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (getCachedUser()) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-background overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="h-24 bg-gradient-to-br from-blue-600/20 via-blue-400/10 to-background flex items-center justify-center">
          <h2 className="text-2xl font-bold tracking-tight">ComiHub</h2>
        </div>

        <div className="px-6 pb-8 pt-2">
          
          {/* STEP 1: Email */}
          {step === "email" && (
            <form onSubmit={handleEmailSubmit} className="space-y-4 animate-in slide-in-from-right-4">
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold">Welcome</h3>
                <p className="text-sm text-muted-foreground">Enter your email to continue</p>
              </div>
              <input
                type="email"
                required
                placeholder="name@example.com"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 font-medium hover:bg-primary/90 transition-colors"
              >
                Continue
              </button>
            </form>
          )}

          {/* STEP 2: Details & Password */}
          {step === "details" && (
            <form onSubmit={handleRegisterSubmit} className="space-y-4 animate-in slide-in-from-right-4">
               <div className="text-center mb-6">
                <h3 className="text-lg font-semibold">Create Account</h3>
                <p className="text-sm text-muted-foreground">{email}</p>
              </div>
              
              <input
                type="text"
                required
                placeholder="Username"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              
              <div className="space-y-2">
                <input
                  type="password"
                  required
                  placeholder="Password"
                  className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {/* Password Warning Box */}
                <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3">
                  <p className="text-xs text-orange-400 font-medium text-center">
                    ⚠️ Please remember your password! We are still setting up password recovery.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="w-1/3 rounded-xl border border-border bg-transparent px-4 py-3 font-medium hover:bg-muted transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-2/3 rounded-xl bg-primary text-primary-foreground px-4 py-3 font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Creating..." : "Sign Up"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: Verification Sent */}
          {step === "verify" && (
            <div className="text-center space-y-4 animate-in zoom-in-95">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <span className="text-2xl">✉️</span>
              </div>
              <h3 className="text-lg font-semibold">Check your email!</h3>
              <p className="text-sm text-muted-foreground">
                We sent a verification link to <br/>
                <span className="font-medium text-foreground">{email}</span>
              </p>
              <p className="text-xs text-muted-foreground pt-4">
                Click "Yes, it's me" in the email to finish logging in.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
