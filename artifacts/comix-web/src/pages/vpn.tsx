import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Shield, ShieldOff, Wifi, WifiOff, Globe, Lock, Server } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const VPN_KEY = "builtin_vpn_enabled";

export function isVpnEnabled(): boolean {
  return localStorage.getItem(VPN_KEY) === "true";
}

export default function VpnPage() {
  const [enabled, setEnabled] = useState<boolean>(() => isVpnEnabled());

  useEffect(() => {
    localStorage.setItem(VPN_KEY, String(enabled));
  }, [enabled]);

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/50 flex items-center gap-3 px-4 h-14">
        <Link href="/system">
          <button className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </button>
        </Link>
        <h1 className="font-serif font-bold text-lg">Built-in VPN</h1>
      </div>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-6">

        {/* Status card */}
        <div
          className={`rounded-2xl border p-6 flex flex-col items-center gap-4 transition-all duration-500 ${
            enabled
              ? "bg-emerald-500/10 border-emerald-500/40"
              : "bg-muted/50 border-dashed"
          }`}
        >
          <div
            className={`h-20 w-20 rounded-full flex items-center justify-center transition-all duration-500 ${
              enabled ? "bg-emerald-500/20" : "bg-muted"
            }`}
          >
            {enabled ? (
              <Shield className="h-10 w-10 text-emerald-500" />
            ) : (
              <ShieldOff className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
          <div className="text-center">
            <p
              className={`text-xl font-bold font-serif transition-colors ${
                enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`}
            >
              {enabled ? "VPN Active" : "VPN Off"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {enabled
                ? "Images are routed through the server proxy"
                : "Images load directly from their source"}
            </p>
          </div>

          {/* Toggle */}
          <div className="flex items-center gap-3 mt-2">
            {enabled ? (
              <Wifi className="h-4 w-4 text-emerald-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-muted-foreground" />
            )}
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              className="scale-125"
            />
          </div>
        </div>

        {/* How it works */}
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">How it works</h2>

          <div className="rounded-xl border bg-card p-4 flex gap-3 items-start">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">Bypass Regional Blocks</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                When VPN is on, manga images are fetched by the server instead of your browser. If a source is blocked in your region, the server can still reach it.
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 flex gap-3 items-start">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Lock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">Referer Header Spoofing</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Some sources (e.g. NineHentai) block images unless the request comes from the right website. The proxy automatically sets the correct headers.
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 flex gap-3 items-start">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Server className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">Server-side Proxy</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                All requests go through <span className="font-mono text-xs bg-muted px-1 rounded">/api/image</span> on the backend. No third-party VPN service — it&apos;s built right in.
              </p>
            </div>
          </div>
        </div>

        {/* Note */}
        <p className="text-xs text-muted-foreground text-center px-2">
          Turning VPN off loads images directly from the source, which may be faster but can fail for blocked or hotlink-protected sites.
        </p>
      </div>
    </div>
  );
}
