import { useEffect, useMemo, useState } from "react";
import { Lock, Mail, MessageCircle } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { getCachedUser } from "@/lib/auth-cache";
import {
  verifyPin,
  isLockedOut,
  lockoutRemainingMs,
  getRemainingAttempts,
  requestEmailReset,
  verifyEmailCode,
  LOCK_DISCORD_URL,
} from "@/lib/lock";

type Mode = "locked" | "forgot" | "emailSent" | "emailVerify";

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>("locked");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [lockedOut, setLockedOut] = useState(() => isLockedOut());
  const [remaining, setRemaining] = useState(() => lockoutRemainingMs());
  const [attemptsLeft, setAttemptsLeft] = useState(() => getRemainingAttempts());

  // Live countdown during lockout
  useEffect(() => {
    if (!lockedOut) return;
    const id = setInterval(() => {
      const left = lockoutRemainingMs();
      if (left <= 0) {
        setLockedOut(false);
        setError("");
        setAttemptsLeft(getRemainingAttempts());
        clearInterval(id);
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [lockedOut]);

  const countdownText = useMemo(() => {
    const s = Math.ceil(remaining / 1000);
    return `Try again in ${s}s`;
  }, [remaining]);

  const userEmail = getCachedUser()?.email ?? "";

  async function handlePinComplete(value: string) {
    if (lockedOut) return;
    setError("");
    const ok = await verifyPin(value);
    if (ok) {
      setPin("");
      onUnlocked();
    } else {
      setPin("");
      setLockedOut(isLockedOut());
      setAttemptsLeft(getRemainingAttempts());
      setError(isLockedOut() ? "Too many wrong attempts." : `Wrong PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`);
    }
  }

  async function handleSendCode() {
    setError("");
    if (!userEmail) {
      setError("No email address on your account.");
      return;
    }
    const { ok, message } = await requestEmailReset(userEmail);
    if (!ok) {
      setError(message);
      return;
    }
    setMode("emailVerify");
  }

  async function handleVerifyCode(code: string) {
    setError("");
    if (!userEmail) {
      setError("No email address on your account.");
      return;
    }
    const { ok, message } = await verifyEmailCode(userEmail, code);
    if (ok) {
      setMode("locked");
      setError("PIN cleared — you can set a new one in System → Lock.");
      onUnlocked();
    } else {
      setError(message);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-background overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="h-32 bg-gradient-to-br from-primary/30 via-primary/10 to-background flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-background shadow-lg flex items-center justify-center border border-border">
            <Lock className="h-7 w-7 text-primary" />
          </div>
        </div>

        <div className="px-6 pb-6 pt-3 text-center">
          {mode === "locked" && (
            <>
              <h2 className="text-xl font-bold mb-1">ComiHub is locked</h2>
              <p className="text-sm text-muted-foreground mb-5">Enter your 6-digit PIN to continue.</p>

              {lockedOut ? (
                <div className="py-6">
                  <p className="text-sm font-semibold text-destructive">{countdownText}</p>
                </div>
              ) : (
                <div className="mb-1">
                  <InputOTP
                    maxLength={6}
                    pattern="[0-9]+"
                    value={pin}
                    onChange={(v) => { setPin(v); if (v.length === 6) handlePinComplete(v); }}
                    inputMode="numeric"
                    autoFocus
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot key={i} index={i} className="h-12 w-10 text-base" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
                </div>
              )}

              <button
                onClick={() => setMode("forgot")}
                className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                Forgot your PIN?
              </button>
            </>
          )}

          {mode === "forgot" && (
            <>
              <h2 className="text-xl font-bold mb-1">Forgot your PIN?</h2>
              <p className="text-sm text-muted-foreground mb-5">Choose how to recover access to your account.</p>

              <button
                onClick={handleSendCode}
                disabled={!userEmail}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-base mb-3 hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Mail className="h-5 w-5" />
                {userEmail ? "Email me a code" : "No email on account"}
              </button>

              <a
                href={LOCK_DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-muted text-foreground rounded-xl py-3 font-semibold text-base mb-3 hover:bg-muted/80 transition-colors"
              >
                <MessageCircle className="h-5 w-5" />
                Join Discord for help
              </a>

              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

              <button
                onClick={() => setMode("locked")}
                className="w-full mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Back
              </button>
            </>
          )}

          {mode === "emailVerify" && (
            <>
              <h2 className="text-xl font-bold mb-1">Check your email</h2>
              <p className="text-sm text-muted-foreground mb-5">
                We sent a code to <span className="font-medium text-foreground">{userEmail}</span>. Enter it below to clear your PIN.
              </p>

              <EmailCodeInput onCode={handleVerifyCode} />

              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

              <button
                onClick={() => setMode("forgot")}
                className="w-full mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailCodeInput({ onCode }: { onCode: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handle(v: string) {
    setCode(v);
    if (v.length === 6 && !submitting) {
      setSubmitting(true);
      await onCode(v);
      setCode("");
      setSubmitting(false);
    }
  }

  return (
    <InputOTP
      maxLength={6}
      pattern="[0-9]+"
      value={code}
      onChange={handle}
      inputMode="numeric"
      autoFocus
    >
      <InputOTPGroup>
        {Array.from({ length: 6 }).map((_, i) => (
          <InputOTPSlot key={i} index={i} className="h-12 w-10 text-base" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}