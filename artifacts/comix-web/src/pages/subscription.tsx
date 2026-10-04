import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Crown, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-url";
import { getCachedUser } from "@/lib/auth-cache";

declare global { interface Window { Paddle?: any } }

type PlanKey = "weekly_1" | "weekly_2" | "monthly" | "quarterly";
const paddleEnvironment = (import.meta.env.VITE_PADDLE_ENVIRONMENT as string | undefined) ?? "sandbox";
const paddleToken = (import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined) ?? "";
const priceIds: Record<PlanKey, string> = {
  weekly_1: (import.meta.env.VITE_PADDLE_PRICE_WEEKLY_1 as string | undefined) ?? "",
  weekly_2: (import.meta.env.VITE_PADDLE_PRICE_WEEKLY_2 as string | undefined) ?? "",
  monthly: (import.meta.env.VITE_PADDLE_PRICE_MONTHLY as string | undefined) ?? "",
  quarterly: (import.meta.env.VITE_PADDLE_PRICE_QUARTERLY as string | undefined) ?? "",
};
const plans: Array<{ key: PlanKey; name: string; price: string; cadence: string; renewal: string; note: string; featured?: boolean }> = [
  { key: "weekly_1", name: "Weekly Starter", price: "$1", cadence: "per week", renewal: "$1/week until canceled", note: "Low-cost access" },
  { key: "weekly_2", name: "Weekly Plus", price: "$2", cadence: "per week", renewal: "$2/week until canceled", note: "More premium value" },
  { key: "monthly", name: "Monthly", price: "$5", cadence: "per month", renewal: "$5/month until canceled", note: "Flexible membership" },
  { key: "quarterly", name: "3 Months", price: "$14", cadence: "every 3 months", renewal: "$14 every 3 months until canceled", note: "Best value", featured: true },
];
const benefits = [
  "No ComiHub ads while your plan is active",
  "Unlimited chapter downloads",
  "Cloud library limit increased from 650 to 1,350 titles",
  "Premium status activated only from verified Paddle webhooks",
];

function loadPaddle(): Promise<any> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://cdn.paddle.com/paddle/v2/paddle.js"]');
    const script = existing ?? document.createElement("script");
    script.onload = () => resolve(window.Paddle);
    script.onerror = () => reject(new Error("Paddle checkout could not be loaded."));
    if (!existing) { script.src = "https://cdn.paddle.com/paddle/v2/paddle.js"; script.async = true; document.head.appendChild(script); }
  });
}

export default function SubscriptionPage() {
  const [busy, setBusy] = useState<PlanKey | null>(null);
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<{ plan: string | null; expiresAt: string | null }>({ plan: null, expiresAt: null });
  const configured = useMemo(() => Object.values(priceIds).every(Boolean), []);

  useEffect(() => {
    fetch(apiUrl("/api/paddle/status"), { credentials: "include" })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (data?.active) setActive({ plan: data.plan, expiresAt: data.expiresAt }); })
      .catch(() => {});
  }, []);

  async function startCheckout(plan: (typeof plans)[number]) {
    const user = getCachedUser();
    if (!user) { setMessage("Sign in before starting a subscription."); return; }
    if (!configured || !priceIds[plan.key]) { setMessage("Premium checkout is being configured. Please try again shortly."); return; }
    setBusy(plan.key); setMessage("");
    try {
      const response = await fetch(apiUrl("/api/paddle/checkout"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.key }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.transactionId) throw new Error(data.error || "Paddle checkout could not be created.");
      const Paddle = await loadPaddle();
      if (paddleEnvironment === "sandbox") Paddle.Environment.set("sandbox");
      Paddle.Initialize({ token: paddleToken });
      Paddle.Checkout.open({
        transactionId: data.transactionId,
        settings: { displayMode: "overlay", theme: "light", locale: "en" },
        successCallback: () => { setBusy(null); setMessage("Payment received. Premium will activate after Paddle confirms the subscription."); setTimeout(() => window.location.reload(), 1800); },
        closeCallback: () => setBusy(null),
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Paddle checkout could not be started."); setBusy(null); }
  }

  return (
    <main className="container mx-auto max-w-5xl px-4 py-6 sm:py-10 animate-in fade-in duration-300">
      <Link href="/system" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"><ArrowLeft className="h-4 w-4" /> System</Link>
      <section className="rounded-3xl border border-primary/25 bg-primary/5 p-5 sm:p-8 mb-6"><div className="flex items-start gap-4"><div className="h-12 w-12 shrink-0 rounded-2xl bg-primary/15 text-primary flex items-center justify-center"><Crown className="h-6 w-6" /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">ComiHub Premium</p><h1 className="mt-1 text-2xl sm:text-3xl font-serif font-bold">Read without limits</h1><p className="mt-2 text-sm text-muted-foreground max-w-2xl">Choose a plan from System whenever you want. ComiHub will not open a subscription offer on first launch or interrupt your reading with a purchase prompt.</p></div></div></section>
      {active.plan && <div className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">Premium is active{active.expiresAt ? ` until ${new Date(active.expiresAt).toLocaleDateString()}` : ""}.</div>}
      {message && <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">{message} {!getCachedUser() && <Link href="/login" className="font-semibold underline">Sign in</Link>}</div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{plans.map(plan => <article key={plan.key} className={`relative rounded-2xl border bg-card p-5 ${plan.featured ? "border-primary shadow-md" : "border-border"}`}>
        {plan.featured && <span className="absolute -top-3 left-4 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">Best value</span>}
        <h2 className="font-serif text-xl font-bold">{plan.name}</h2><div className="mt-4 flex items-baseline gap-1"><span className="text-3xl font-bold">{plan.price}</span><span className="text-sm text-muted-foreground">{plan.cadence}</span></div><p className="mt-2 text-xs font-medium text-primary">{plan.note}</p><p className="mt-3 min-h-10 text-xs text-muted-foreground">{plan.renewal}</p>
        <Button className="mt-5 w-full" variant={plan.featured ? "default" : "outline"} disabled={busy !== null} onClick={() => startCheckout(plan)}>{busy === plan.key ? "Opening checkout…" : "Continue to checkout"}</Button><p className="mt-2 text-center text-[11px] text-muted-foreground">Secure Paddle checkout · cancel anytime</p>
      </article>)}</div>
      <section className="mt-6 rounded-2xl border bg-card p-5 sm:p-6"><h2 className="font-serif text-xl font-bold">Included with every active plan</h2><ul className="mt-4 grid gap-3 sm:grid-cols-2">{benefits.map(benefit => <li key={benefit} className="flex items-start gap-2 text-sm text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>{benefit}</span></li>)}</ul></section>
      <section className="mt-4 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border bg-card p-5"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> Clear billing</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Paddle shows the price, renewal period, next charge, and cancellation terms before payment.</p></div><div className="rounded-2xl border bg-card p-5"><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Secure activation</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Premium access activates only after a verified Paddle webhook. ComiHub never stores payment credentials.</p></div></section>
      <p className="mt-6 text-center text-xs text-muted-foreground">Cancel before the next renewal to avoid the next charge. Terms and availability may vary by country.</p>
    </main>
  );
}
