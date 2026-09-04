import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Shield, Smartphone, Mail, MessageCircle, Trash2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { getCachedUser } from "@/lib/auth-cache";
import {
  hasAnyPin,
  setPin as savePin,
  clearPin,
  getLockModes,
  setLockModes,
  type LockModes,
  requestEmailReset,
  verifyEmailCode,
  LOCK_DISCORD_URL,
} from "@/lib/lock";

type View = "main" | "set" | "change" | "remove" | "forgot" | "emailVerify";

function LockModeToggle({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className="w-full flex items-center gap-3 text-left rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors"
    >
      <span
        aria-hidden="true"
        className={`relative shrink-0 h-6 w-11 rounded-full transition-colors ${
          enabled ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export default function LockPage() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>("main");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [pin, setPinInput] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(() => hasAnyPin());
  const [lockModes, setLockModesState] = useState<LockModes>(() => getLockModes());

  const [code, setCode] = useState("");

  const isLoggedIn = !!getCachedUser();
  const hasPin = pinConfigured;

  async function handleSetPin(value: string, okMessage = "PIN set. The app will lock when you leave and come back.") {
    if (busy) return;
    if (!confirmStep) {
      setPinInput(value);
      setConfirmStep(true);
      setMessage(null);
      return;
    }
    if (value !== pin) {
      setPinInput("");
      setConfirmStep(false);
      setMessage({ type: "err", text: "PINs don't match. Try again." });
      return;
    }
    setBusy(true);
    const err = await savePin(value);
    setBusy(false);
    if (err) {
      setMessage({ type: "err", text: err });
    } else {
      setPinConfigured(true);
      setMessage({ type: "ok", text: okMessage });
      setView("main");
    }
    setPinInput("");
    setConfirmStep(false);
  }

  async function handleChangePin(value: string) {
    // Same entered-twice flow; changing replaces the old PIN.
    await handleSetPin(value, "PIN changed.");
  }

  async function handleRemove() {
    setBusy(true);
    const err = await clearPin();
    setBusy(false);
    if (!err) setPinConfigured(false);
    setMessage(err ? { type: "err", text: err } : { type: "ok", text: "PIN removed." });
    setView("main");
  }

  async function handleSendCode() {
    const email = getCachedUser()?.email ?? "";
    setMessage(null);
    if (!email) {
      setMessage({ type: "err", text: "No email address on your account." });
      return;
    }
    const { ok, message: m } = await requestEmailReset(email);
    if (!ok) {
      setMessage({ type: "err", text: m });
      return;
    }
    setView("emailVerify");
    setMessage(null);
  }

  async function handleVerifyCode(v: string) {
    const email = getCachedUser()?.email ?? "";
    if (!email) return;
    const { ok, message: m } = await verifyEmailCode(email, v);
    if (ok) {
      setPinConfigured(false);
      setLockModesState(getLockModes());
      setMessage({ type: "ok", text: "Code verified — PIN cleared. Set a new one below." });
      setCode("");
      setView("main");
    } else {
      setMessage({ type: "err", text: m });
      setCode("");
    }
  }

  const storageNote = isLoggedIn
    ? "Saved to your account, so it follows you across devices (and after re-installing the app)."
    : "Saved on this device only. Removing the app or clearing browser data will forget it.";

  function toggleLockMode(mode: keyof LockModes) {
    const next = { ...lockModes, [mode]: !lockModes[mode] };
    setLockModesState(next);
    setLockModes(next);
    setMessage({
      type: "ok",
      text: next.browser || next.standalone
        ? "Lock preference updated."
        : "Automatic locking is off. Your PIN is still saved.",
    });
  }

  function PinEntry({ label, onDone }: { label: string; onDone: (v: string) => void }) {
    const [value, setValue] = useState("");
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <InputOTP
          maxLength={6}
          pattern="[0-9]+"
          value={value}
          onChange={(v) => { setValue(v); if (v.length === 6) onDone(v); }}
          inputMode="numeric"
          autoFocus
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }).map((_, i) => (
              <InputOTPSlot key={i} index={i} className="h-12 w-10 text-base" />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-background border border-border overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
        <button
          onClick={() => setLocation("/system")}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 w-8 h-8 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ✕
        </button>

        <div className="h-24 bg-gradient-to-br from-primary/30 via-primary/10 to-background flex items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-background shadow-lg flex items-center justify-center border border-border">
            <Lock className="h-6 w-6 text-primary" />
          </div>
        </div>

        <div className="px-6 pb-7 pt-3">
          <h2 className="text-xl font-bold text-center mb-1">Lock</h2>
          <p className="text-sm text-muted-foreground text-center mb-5">
            Protect your library with a 6-digit PIN.
          </p>

          {message && (
            <div className={`mb-4 p-3 rounded-xl text-sm text-center ${message.type === "ok" ? "bg-green-500/10 border border-green-500/20 text-green-600" : "bg-red-500/10 border border-red-500/20 text-red-500"}`}>
              {message.text}
            </div>
          )}

          {/* Storage note */}
          <div className={`mb-5 p-3 rounded-xl flex items-start gap-2 ${isLoggedIn ? "bg-primary/5" : "bg-muted/50"}`}>
            {isLoggedIn ? <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" /> : <Smartphone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
            <p className="text-xs text-muted-foreground leading-relaxed">{storageNote}</p>
          </div>

          {view === "main" && (
            <div className="space-y-3">
              {!hasPin ? (
                  <button
                    onClick={() => { setView("set"); setMessage(null); }}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-base hover:bg-primary/90 transition-colors"
                >
                  <Lock className="h-5 w-5" /> Set a PIN
                </button>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-muted/20 p-3 text-left space-y-2.5">
                    <div>
                      <p className="text-sm font-semibold">Automatic locking</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Choose where ComiHub should ask for your PIN.
                      </p>
                    </div>
                    <LockModeToggle
                      label="Website"
                      description="When opened in a browser tab"
                      enabled={lockModes.browser}
                      onToggle={() => toggleLockMode("browser")}
                    />
                    <LockModeToggle
                      label="Home screen app"
                      description="When opened as an installed app"
                      enabled={lockModes.standalone}
                      onToggle={() => toggleLockMode("standalone")}
                    />
                  </div>
                  <button
                    onClick={() => { setView("change"); setMessage(null); }}
                    className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-base hover:bg-primary/90 transition-colors"
                  >
                    <Lock className="h-5 w-5" /> Change PIN
                  </button>
                  <button
                    onClick={handleRemove}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 bg-muted text-foreground rounded-xl py-3 font-semibold text-base hover:bg-muted/80 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-5 w-5" /> Remove PIN
                  </button>
                  <button
                    onClick={() => { setView("forgot"); setMessage(null); }}
                    className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    Forgot your PIN?
                  </button>
                </>
              )}
            </div>
          )}

          {view === "set" && (
            <div className="space-y-4">
              {!confirmStep ? (
                <PinEntry label="Enter a 6-digit PIN" onDone={handleSetPin} />
              ) : (
                <PinEntry label="Confirm your PIN" onDone={handleSetPin} />
              )}
              <button
                onClick={() => { setView("main"); setConfirmStep(false); setPinInput(""); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Back
              </button>
            </div>
          )}

          {view === "change" && (
            <div className="space-y-4">
              {!confirmStep ? (
                <PinEntry label="Enter your new 6-digit PIN" onDone={handleChangePin} />
              ) : (
                <PinEntry label="Confirm your new PIN" onDone={handleChangePin} />
              )}
              <button
                onClick={() => { setView("main"); setConfirmStep(false); setPinInput(""); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Back
              </button>
            </div>
          )}

          {view === "forgot" && (
            <div className="space-y-3">
              <button
                onClick={handleSendCode}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-base hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Mail className="h-5 w-5" /> Email me a code
              </button>
              <a
                href={LOCK_DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-muted text-foreground rounded-xl py-3 font-semibold text-base hover:bg-muted/80 transition-colors"
              >
                <MessageCircle className="h-5 w-5" /> Join Discord for help
              </a>
              <button
                onClick={() => { setView("main"); setMessage(null); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Back
              </button>
            </div>
          )}

          {view === "emailVerify" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Enter the code we emailed to {getCachedUser()?.email}.
              </p>
              <InputOTP
                maxLength={6}
                pattern="[0-9]+"
                value={code}
                onChange={(v) => { setCode(v); if (v.length === 6) handleVerifyCode(v); }}
                inputMode="numeric"
                autoFocus
              >
                <InputOTPGroup>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} className="h-12 w-10 text-base" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <button
                onClick={() => { setView("forgot"); setMessage(null); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}