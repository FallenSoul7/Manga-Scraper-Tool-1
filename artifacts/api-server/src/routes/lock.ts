import { Router } from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb, isDbConfigured } from "../db";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { getSupabaseAdmin, isSupabaseConfigured } from "../lib/supabase";

const router = Router();

const PIN_PATTERN = /^\d{6}$/;
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function getFrontendURL() {
  return (process.env["FRONTEND_URL"] ?? "").replace(/\/+$/, "");
}

/** scrypt hash with a per-user random salt: `scrypt$<saltHex>$<hashHex>`. Never plaintext. */
function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const buf = scryptSync(pin, salt, SCRYPT_KEYLEN, SCRYPT_OPTS) as Buffer;
  return `scrypt$${salt}$${buf.toString("hex")}`;
}

function verifyPinHash(pin: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = scryptSync(pin, salt, expected.length, SCRYPT_OPTS);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Mirror of the requireAuth middleware in routes/library.ts. */
async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];

    if (token) {
      const supabaseUrl = process.env["SUPABASE_URL"];
      const apiKey = process.env["SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_ANON_KEY"] || "";

      if (!supabaseUrl || !apiKey) {
        console.error("Missing Supabase URL or Key");
        return res.status(500).json({ error: "Server configuration error" });
      }

      try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { Authorization: `Bearer ${token}`, apikey: apiKey },
        });

        if (response.ok) {
          const user = await response.json();
          req.user = user;
          return next();
        }
        return res.status(401).json({ error: "Invalid or expired session" });
      } catch (error) {
        return res.status(500).json({ error: "Auth verification failed" });
      }
    }
  }

  if (typeof req.isAuthenticated === "function" && req.isAuthenticated() && req.user) {
    return next();
  }

  return res.status(401).json({ error: "Missing auth token" });
}

async function ensureUserRow(req: any, res: any): Promise<{ userId: string; email: string } | null> {
  const userId = (req.user as any)?.id as string | undefined;
  const email = ((req.user as any)?.email || (req.user as any)?.user_metadata?.email || "") as string;
  if (!userId) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Database not configured" });
    return null;
  }
  try {
    const db = getDb();
    await db.insert(users).values({
      id: userId,
      email: email || "unknown@local",
      username: (req.user as any)?.user_metadata?.username || "Reader",
    }).onConflictDoUpdate({
      target: users.id,
      set: { email: email || "unknown@local" },
    }).catch(() => {});
    return { userId, email };
  } catch {
    res.status(500).json({ error: "Database error" });
    return null;
  }
}

// PUT /api/auth/lock-pin — set or change the PIN (server-side scrypt hash only)
router.put("/lock-pin", requireAuth, async (req, res) => {
  const ctx = await ensureUserRow(req, res);
  if (!ctx) return;

  const { pin } = (req.body ?? {}) as { pin?: unknown };
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 6 digits" });
    return;
  }

  try {
    const db = getDb();
    await db.update(users)
      .set({ lockPinHash: hashPin(pin), lockPinUpdatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    res.json({ ok: true });
  } catch (err) {
    console.error("lock-pin PUT failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// DELETE /api/auth/lock-pin — remove the PIN
router.delete("/lock-pin", requireAuth, async (req, res) => {
  const ctx = await ensureUserRow(req, res);
  if (!ctx) return;

  try {
    const db = getDb();
    await db.update(users)
      .set({ lockPinHash: null, lockPinUpdatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    res.json({ ok: true });
  } catch (err) {
    console.error("lock-pin DELETE failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET /api/auth/lock-pin-status — presence only, never returns the hash
router.get("/lock-pin-status", requireAuth, async (req, res) => {
  const ctx = await ensureUserRow(req, res);
  if (!ctx) return;

  try {
    const db = getDb();
    const rows = await db.select({ lockPinHash: users.lockPinHash }).from(users).where(eq(users.id, ctx.userId));
    const hash = rows[0]?.lockPinHash ?? null;
    res.json({ hasPin: !!hash && hash.length > 0 });
  } catch (err) {
    console.error("lock-pin-status GET failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// POST /api/auth/lock-pin-verify — verify an entered PIN against the stored scrypt hash.
// Needed so a logged-in user on a fresh device (no local cache) can unlock by
// checking against their Supabase-stored PIN.
router.post("/lock-pin-verify", requireAuth, async (req, res) => {
  const ctx = await ensureUserRow(req, res);
  if (!ctx) return;

  const { pin } = (req.body ?? {}) as { pin?: unknown };
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    res.status(400).json({ error: "PIN must be exactly 6 digits" });
    return;
  }

  try {
    const db = getDb();
    const rows = await db.select({ lockPinHash: users.lockPinHash }).from(users).where(eq(users.id, ctx.userId));
    const hash = rows[0]?.lockPinHash ?? null;
    if (!hash) {
      res.json({ ok: false, hasPin: false });
      return;
    }
    res.json({ ok: verifyPinHash(pin, hash), hasPin: true });
  } catch (err) {
    console.error("lock-pin-verify POST failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// POST /api/auth/lock-reset-email — email a reset code/magic link (same Supabase
// email mechanism used for account registration) redirecting back to /lock.
router.post("/lock-reset-email", requireAuth, async (req, res) => {
  const ctx = await ensureUserRow(req, res);
  if (!ctx) return;

  const sb = getSupabaseAdmin();
  if (!sb || !isSupabaseConfigured()) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }
  if (!ctx.email || ctx.email === "unknown@local") {
    res.status(400).json({ error: "No email address on your account" });
    return;
  }

  const frontendURL = getFrontendURL();
  const emailRedirectTo = frontendURL ? `${frontendURL}/lock` : undefined;

  try {
    const { error } = await sb.auth.signInWithOtp({
      email: ctx.email,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    });
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.json({ ok: true, message: "Check your email for a reset code." });
  } catch (err) {
    console.error("lock-reset-email POST failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/lock-verify-email — verify the emailed code via GoTrue, then
// clear the stored PIN so the user can set a new one.
router.post("/lock-verify-email", async (req, res) => {
  const { email, token } = (req.body ?? {}) as { email?: unknown; token?: unknown };
  if (typeof email !== "string" || !email.includes("@") || typeof token !== "string" || !token) {
    res.status(400).json({ error: "email and token are required" });
    return;
  }

  const supabaseUrl = process.env["SUPABASE_URL"];
  const apiKey = process.env["SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_ANON_KEY"] || "";
  if (!supabaseUrl || !apiKey) {
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ type: "email", email, token }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      res.status(400).json({ error: (body as any)?.msg ?? (body as any)?.error_description ?? "Invalid or expired code" });
      return;
    }

    // Code verified — clear the stored PIN for this email so the user can set a new one.
    const normalized = email.trim().toLowerCase();
    const db = getDb();
    await db.update(users)
      .set({ lockPinHash: null, lockPinUpdatedAt: new Date() })
      .where(eq(users.email, normalized))
      .catch(() => {});
    res.json({ ok: true, message: "PIN removed. You can now set a new one." });
  } catch (err) {
    console.error("lock-verify-email POST failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;