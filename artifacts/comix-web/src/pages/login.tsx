import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { getCachedUser } from "@/lib/auth-cache";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"email" | "details" | "verify">("email");
  
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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      // 🚀 THE FIX 1: Directing traffic straight to Render
      const res = await fetch("https://comihub-backend.onrender.com/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password }),
      });

      // 🚀 THE FIX 2: Stop Safari from crashing if Render returns an HTML error
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Connection error (${res.status}). Server returned text instead of data.`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Registration failed");
      }

      setStep("verify");
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
          <h2 className="text-2xl font-bold">ComiHub</h2>
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
            </form>
          )}

          {step === "details" && (
            <form onSubmit={handleRegisterSubmit} noValidate className="space-y-4">
              <input
                type="text"
                required
                placeholder="Username"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                type="password"
                required
                placeholder="Password (min 6 chars)"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isLoading ? "Creating..." : "Sign Up"}
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
