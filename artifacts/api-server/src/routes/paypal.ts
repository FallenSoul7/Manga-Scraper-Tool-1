import { Router } from "express";
import axios from "axios";
import { eq, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db";
import { subscriptions } from "../schema";
import { logger } from "../lib/logger";

const router = Router();
const PLAN_KEYS = ["weekly", "monthly", "quarterly"] as const;
type PlanKey = (typeof PLAN_KEYS)[number];

function paypalConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_WEBHOOK_ID);
}
function paypalBase() {
  return process.env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
function planId(key: PlanKey) {
  return process.env[{ weekly: "PAYPAL_WEEKLY_PLAN_ID", monthly: "PAYPAL_MONTHLY_PLAN_ID", quarterly: "PAYPAL_QUARTERLY_PLAN_ID" }[key]] ?? "";
}
async function accessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await axios.post(`${paypalBase()}/v1/oauth2/token`, "grant_type=client_credentials", {
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });
  return response.data.access_token as string;
}
function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated?.() && req.user?.id) return next();
  const auth = String(req.headers.authorization ?? "");
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage a subscription." });
  const token = auth.slice(7);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: "Authentication is not configured." });
  fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: key } }).then(async r => {
    if (!r.ok) return res.status(401).json({ error: "Invalid or expired session." });
    req.user = await r.json(); next();
  }).catch(() => res.status(401).json({ error: "Authentication failed." }));
}

router.get("/config", (_req, res) => {
  res.json({
    configured: paypalConfigured() && PLAN_KEYS.every(k => !!planId(k)),
    mode: process.env.PAYPAL_MODE === "live" ? "live" : "sandbox",
    plans: PLAN_KEYS.reduce((out, key) => ({ ...out, [key]: !!planId(key) }), {}),
  });
});

router.get("/status", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database is not configured." });
  const db = getDb();
  const userId = String((req.user as any).id);
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const row = rows[0];
  const active = !!row && row.status === "ACTIVE" && (!row.expiresAt || new Date(row.expiresAt) > new Date());
  return res.json({ active, plan: active ? row?.planKey : null, expiresAt: active ? row?.expiresAt : null, status: row?.status ?? null });
});

router.post("/create-subscription", requireAuth, async (req, res) => {
  const key = String(req.body?.plan ?? "") as PlanKey;
  if (!PLAN_KEYS.includes(key) || !planId(key)) return res.status(503).json({ error: "This PayPal plan is not configured yet." });
  if (!paypalConfigured()) return res.status(503).json({ error: "PayPal credentials are not configured yet." });
  try {
    const token = await accessToken();
    const userId = String((req.user as any).id);
    const frontend = (process.env.FRONTEND_URL || "https://comihub.vercel.app").replace(/\/$/, "");
    const response = await axios.post(`${paypalBase()}/v1/billing/subscriptions`, {
      plan_id: planId(key),
      custom_id: userId,
      application_context: {
        brand_name: "ComiHub",
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: `${frontend}/subscription?paypal=success`,
        cancel_url: `${frontend}/subscription?paypal=cancelled`,
      },
    }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" }, timeout: 30_000 });
    const approve = response.data.links?.find((link: any) => link.rel === "approve")?.href;
    if (!approve) return res.status(502).json({ error: "PayPal did not return an approval URL." });
    if (isDbConfigured()) {
      const db = getDb();
      await db.insert(subscriptions).values({ userId, planKey: key, paypalSubscriptionId: response.data.id, status: response.data.status || "APPROVAL_PENDING" }).onConflictDoUpdate({ target: subscriptions.userId, set: { planKey: key, paypalSubscriptionId: response.data.id, status: response.data.status || "APPROVAL_PENDING", updatedAt: new Date() } });
    }
    res.json({ approvalUrl: approve, subscriptionId: response.data.id });
    return;
  } catch (error: any) {
    logger.error({ status: error.response?.status, data: error.response?.data }, "PayPal subscription creation failed");
    res.status(502).json({ error: "PayPal checkout could not be started." });
    return;
  }
});

router.post("/cancel", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database is not configured." });
  const userId = String((req.user as any).id);
  const db = getDb();
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const subscription = rows[0];
  if (!subscription?.paypalSubscriptionId) return res.status(404).json({ error: "No active subscription found." });
  try {
    const token = await accessToken();
    await axios.post(`${paypalBase()}/v1/billing/subscriptions/${subscription.paypalSubscriptionId}/cancel`, { reason: "Canceled by customer in ComiHub" }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20_000 });
    await db.update(subscriptions).set({ status: "CANCEL_PENDING", updatedAt: new Date(), lastEvent: "CUSTOMER.CANCEL_REQUESTED" }).where(eq(subscriptions.userId, userId));
    return res.json({ ok: true });
  } catch (error: any) {
    logger.error({ status: error.response?.status, data: error.response?.data }, "PayPal cancellation failed");
    return res.status(502).json({ error: "PayPal cancellation could not be completed." });
  }
});

router.post("/webhook", async (req, res) => {
  if (!paypalConfigured()) return res.status(503).send("PayPal webhook is not configured");
  try {
    const token = await accessToken();
    const headers = req.headers;
    const verification = await axios.post(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: req.body,
    }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20_000 });
    if (verification.data?.verification_status !== "SUCCESS") return res.status(400).send("Invalid webhook signature");
    if (!isDbConfigured()) return res.status(204).end();
    const resource = req.body?.resource ?? {};
    const event = String(req.body?.event_type ?? "");
    const id = resource.id || resource.billing_agreement_id;
    const userId = resource.custom_id || resource.subscriber?.custom_id;
    const activeEvents = ["BILLING.SUBSCRIPTION.ACTIVATED", "BILLING.SUBSCRIPTION.UPDATED", "PAYMENT.SALE.COMPLETED"];
    const inactiveEvents = ["BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.SUSPENDED", "BILLING.SUBSCRIPTION.EXPIRED", "PAYMENT.SALE.DENIED", "PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"];
    if (id || userId) {
      const db = getDb();
      const status = activeEvents.includes(event) ? "ACTIVE" : inactiveEvents.includes(event) ? "INACTIVE" : String(resource.status || "");
      if (status) {
        await db.update(subscriptions).set({ status, updatedAt: new Date(), lastEvent: event, expiresAt: resource.billing_info?.next_billing_time ? new Date(resource.billing_info.next_billing_time) : undefined }).where(userId ? eq(subscriptions.userId, userId) : eq(subscriptions.paypalSubscriptionId, id));
      }
    }
    res.status(204).end();
    return;
  } catch (error: any) {
    logger.error({ status: error.response?.status, data: error.response?.data }, "PayPal webhook handling failed");
    res.status(400).send("Webhook processing failed");
    return;
  }
});

export default router;
