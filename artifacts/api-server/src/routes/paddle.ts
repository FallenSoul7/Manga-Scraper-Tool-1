import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db";
import { subscriptions } from "../schema";
import { logger } from "../lib/logger";

const router = Router();
const PLAN_KEYS = ["weekly_1", "weekly_2", "monthly", "quarterly"] as const;
type PlanKey = (typeof PLAN_KEYS)[number];
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function priceId(plan: PlanKey) {
  return process.env[
    {
      weekly_1: "PADDLE_PRICE_WEEKLY_1",
      weekly_2: "PADDLE_PRICE_WEEKLY_2",
      monthly: "PADDLE_PRICE_MONTHLY",
      quarterly: "PADDLE_PRICE_QUARTERLY",
    }[plan]
  ] ?? "";
}

function paddleConfigured() {
  return !!process.env.PADDLE_WEBHOOK_SECRET && !!process.env.PADDLE_CLIENT_TOKEN;
}

function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated?.() && req.user?.id) return next();
  const auth = String(req.headers.authorization ?? "");
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage a subscription." });
  const token = auth.slice(7);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: "Authentication is not configured." });
  fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: key } })
    .then(async response => {
      if (!response.ok) return res.status(401).json({ error: "Invalid or expired session." });
      req.user = await response.json();
      next();
    })
    .catch(() => res.status(401).json({ error: "Authentication failed." }));
}

function verifySignature(rawBody: Buffer, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  }));
  if (!parts.ts || !parts.h1) return false;
  const age = Math.abs(Date.now() - Number(parts.ts) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${parts.ts}:${rawBody.toString("utf8")}`).digest("hex");
  const received = Buffer.from(parts.h1, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
}

function planForPrice(id: string) {
  return PLAN_KEYS.find(key => priceId(key) === id) ?? null;
}

router.get("/config", (_req, res) => {
  res.json({
    configured: paddleConfigured() && PLAN_KEYS.every(key => !!priceId(key)),
    environment: process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox",
    plans: Object.fromEntries(PLAN_KEYS.map(key => [key, { configured: !!priceId(key), priceId: priceId(key) || null }])),
  });
});

router.get("/status", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database is not configured." });
  const userId = String((req.user as any).id);
  const rows = await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const row = rows[0];
  const active = !!row && ACTIVE_STATUSES.has(row.status.toLowerCase()) && (!row.expiresAt || new Date(row.expiresAt) > new Date());
  return res.json({ active, plan: active ? row?.planKey : null, expiresAt: active ? row?.expiresAt : null, status: row?.status ?? null });
});

router.post("/cancel", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database is not configured." });
  const userId = String((req.user as any).id);
  await getDb().update(subscriptions).set({ status: "CANCEL_REQUESTED", updatedAt: new Date(), lastEvent: "customer.cancel_requested" }).where(eq(subscriptions.userId, userId));
  return res.json({ ok: true, message: "Your subscription remains active until the current billing period ends. Manage final cancellation in Paddle's customer portal." });
});

router.post("/webhook", async (req, res) => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = String(req.headers["paddle-signature"] ?? "");
  if (!secret || !rawBody || !verifySignature(rawBody, signature, secret)) return res.status(400).send("Invalid webhook signature");
  if (!isDbConfigured()) return res.status(204).end();

  try {
    const event = String(req.body?.event_type ?? "");
    const data = req.body?.data ?? {};
    const customData = data.custom_data ?? {};
    const userId = String(customData.userId ?? customData.user_id ?? "");
    const subscriptionId = String(data.id ?? data.subscription_id ?? "");
    if (!userId && !subscriptionId) return res.status(204).end();

    const eventStatus: Record<string, string> = {
      "subscription.activated": "active",
      "subscription.resumed": "active",
      "subscription.created": String(data.status ?? "trialing"),
      "subscription.updated": String(data.status ?? "active"),
      "subscription.canceled": "canceled",
      "subscription.paused": "paused",
      "subscription.past_due": "past_due",
      "transaction.completed": "active",
      "transaction.paid": "active",
      "transaction.billed": "active",
      "transaction.canceled": "past_due",
    };
    const status = eventStatus[event];
    if (!status) return res.status(204).end();
    const planKey = String(customData.planKey ?? customData.plan_key ?? "") || planForPrice(String(data.items?.[0]?.price?.id ?? data.items?.[0]?.price_id ?? "")) || "monthly";
    const expiresAt = data.next_billed_at || data.next_billing_at || null;
    const db = getDb();
    if (userId) {
      await db.insert(subscriptions).values({
        userId,
        planKey,
        paddleSubscriptionId: subscriptionId || `event_${Date.now()}`,
        status,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        lastEvent: event,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: subscriptions.userId,
        set: { planKey, paddleSubscriptionId: subscriptionId || undefined, status, expiresAt: expiresAt ? new Date(expiresAt) : undefined, lastEvent: event, updatedAt: new Date() },
      });
    } else if (subscriptionId) {
      await db.update(subscriptions).set({ status, expiresAt: expiresAt ? new Date(expiresAt) : undefined, lastEvent: event, updatedAt: new Date() }).where(eq(subscriptions.paddleSubscriptionId, subscriptionId));
    }
    return res.status(204).end();
  } catch (error) {
    logger.error({ error }, "Paddle webhook handling failed");
    return res.status(500).send("Webhook processing failed");
  }
});

export default router;
