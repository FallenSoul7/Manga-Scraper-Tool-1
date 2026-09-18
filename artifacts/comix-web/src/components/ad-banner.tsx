import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type AdSize = { width?: number | string; height?: number | string };

export interface AdBannerProps {
  slotId: string;
  size?: AdSize;
  scriptSrc?: string;
  className?: string;
  label?: string;
}

/**
 * A provider-neutral ad slot. The reserved dimensions remain in the document
 * when a provider is disabled, blocked, or still loading, which prevents CLS.
 */
export function AdBanner({ slotId, size = { width: "100%", height: 90 }, scriptSrc, className, label = "Advertisement" }: AdBannerProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!scriptSrc || !slotRef.current) return;
    const existing = document.querySelector<HTMLScriptElement>(`script[data-comihub-ad-script="${CSS.escape(scriptSrc)}"]`);
    if (existing) {
      setLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    script.dataset.comihubAdScript = scriptSrc;
    script.onload = () => setLoaded(true);
    script.onerror = () => setLoaded(false);
    document.head.appendChild(script);
    return () => { script.onload = null; script.onerror = null; };
  }, [scriptSrc]);

  const style = { width: size.width ?? "100%", minHeight: size.height ?? 90 };
  return (
    <div ref={slotRef} data-ad-slot={slotId} className={cn("relative flex w-full items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/20", className)} style={style} aria-label={label}>
      {!loaded && <span className="text-xs text-muted-foreground/60">{scriptSrc ? "Loading advertisement" : "Advertisement space"}</span>}
    </div>
  );
}

export default AdBanner;

