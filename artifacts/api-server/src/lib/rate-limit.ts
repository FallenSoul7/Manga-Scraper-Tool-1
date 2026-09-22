import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

/**
 * Lightweight process-local limiter for low-volume sensitive endpoints.
 * Render can run more than one instance, so this is a first layer only;
 * provider/WAF limits should remain enabled in production as well.
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const message = options.message ?? "Too many requests. Please try again later.";

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = String(req.ip || req.socket.remoteAddress || "unknown");
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;

    bucket.count += 1;
    buckets.set(key, bucket);

    if (buckets.size > 10_000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
    }

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}
