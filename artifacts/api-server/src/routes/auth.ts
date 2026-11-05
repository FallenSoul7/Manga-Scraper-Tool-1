import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import postgres from "postgres";

import { getSupabaseAdmin, isSupabaseConfigured } from "../lib/supabase";
import { getDb, isDbConfigured } from "../db";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rate-limit";

const router = Router();

const configuredSessionSecret = process.env["SESSION_SECRET"]?.trim();
if (process.env["NODE_ENV"] === "production" && (!configuredSessionSecret || configuredSessionSecret.length < 32)) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters in production");
}
const SESSION_SECRET = configuredSessionSecret ?? randomBytes(32).toString("hex");
const SESSION_MAX_AGE = 90 * 24 * 3600 * 1000;

function getFrontendURL() {
  return (process.env["FRONTEND_URL"] ?? "").replace(/\/+$/, "");
}
function getOwnerEmails() {
  return new Set((process.env["OWNER_EMAILS"] ?? "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
}
function isOwner(req: any) {
  return !!req.isAuthenticated?.() && getOwnerEmails().has(String(req.user?.email ?? "").toLowerCase());
}
function getGoogleCreds() {
  return {
    clientID: process.env["GOOGLE_CLIENT_ID"] ?? "",
    clientSecret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
  };
}
function isConfigured() {
  const { clientID, clientSecret } = getGoogleCreds();
  return !!(clientID && clientSecret);
}

export interface GoogleUser {
  id: string;
  displayName: string;
  username: string;
  email: string;
  photo: string;
}

async function upsertUser(user: GoogleUser): Promise<GoogleUser> {
  try {
    const db = getDb();
    const username = user.username || user.displayName || user.email.split("@")[0];
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: username,
    }).onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email,
        username: username,
      },
    });
    return { ...user, username };
  } catch {
    logger.error("User upsert failed");
    return user;
  }
}

async function loadUserById(id: string): Promise<GoogleUser | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id));
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      displayName: row.username || "Reader",
      username: row.username || "Reader",
      email: row.email,
      photo: "",
    };
  } catch {
    logger.error("User lookup failed");
    return null;
  }
}

const memUsers = new Map<string, GoogleUser>();

async function saveUser(user: GoogleUser): Promise<GoogleUser> {
  const saved = await upsertUser(user);
  memUsers.set(saved.id, saved);
  return saved;
}

async function loadUser(id: string): Promise<GoogleUser | null> {
  if (memUsers.has(id)) return memUsers.get(id)!;
  const fromDb = await loadUserById(id);
  if (fromDb) memUsers.set(fromDb.id, fromDb);
  return fromDb;
}

class SupabaseSessionStore extends session.Store {
  private tableReady = false;
  private sql: ReturnType<typeof postgres> | null = null;

  private getSql() {
    if (!this.sql && process.env["DATABASE_URL"]) {
      this.sql = postgres(process.env["DATABASE_URL"], { ssl: "require", max: 5 });
    }
    return this.sql;
  }

  private async ensureTable() {
    if (this.tableReady) return;
    const sql = this.getSql();
    if (!sql) return;
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS comihub_sessions (
          sid TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS comihub_sessions_expires_idx ON comihub_sessions (expires_at)`;
      this.tableReady = true;
    } catch {
      logger.warn("Session table setup warning");
    }
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    const sql = this.getSql();
    if (!sql) return callback(null, null);
    this.ensureTable().then(async () => {
      try {
        const rows = await sql`SELECT data, expires_at FROM comihub_sessions WHERE sid = ${sid} LIMIT 1`;
        const data = rows[0] as { data: string; expires_at: Date } | undefined;
        if (!data) return callback(null, null);
        if (new Date(data.expires_at) < new Date()) {
          await sql`DELETE FROM comihub_sessions WHERE sid = ${sid}`;
          return callback(null, null);
        }
        callback(null, JSON.parse(data.data));
      } catch (err) {
        callback(err);
      }
    });
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    const sql = this.getSql();
    if (!sql) return callback?.();
    const expiresAt = (sessionData.cookie?.expires instanceof Date)
      ? sessionData.cookie.expires
      : new Date(Date.now() + SESSION_MAX_AGE);
    this.ensureTable().then(async () => {
      try {
        await sql`
          INSERT INTO comihub_sessions (sid, data, expires_at)
          VALUES (${sid}, ${JSON.stringify(sessionData)}, ${expiresAt.toISOString()})
          ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at
        `;
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    });
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    const sql = this.getSql();
    if (!sql) return callback?.();
    sql`DELETE FROM comihub_sessions WHERE sid = ${sid}`
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    const sql = this.getSql();
    if (!sql) return callback?.();
    const expiresAt = (sessionData.cookie?.expires instanceof Date)
      ? sessionData.cookie.expires
      : new Date(Date.now() + SESSION_MAX_AGE);
    sql`UPDATE comihub_sessions SET expires_at = ${expiresAt.toISOString()} WHERE sid = ${sid}`
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }
}

const sessionStore = isDbConfigured() ? new SupabaseSessionStore() : (isSupabaseConfigured() ? new SupabaseSessionStore() : undefined);

export function buildSessionMiddleware() {
  return session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: process.env["NODE_ENV"] === "production" ? "none" : "lax",
      maxAge: SESSION_MAX_AGE,
    },
  });
}

let strategyRegistered = false;
function ensureStrategy() {
  if (strategyRegistered) return;
  const { clientID, clientSecret } = getGoogleCreds();
  if (!clientID || !clientSecret) return;
  const callbackURL =
    process.env["NODE_ENV"] === "production"
      ? `${(process.env["API_BASE_URL"] ?? "").replace(/\/+$/, "")}/api/auth/google/callback`
      : process.env["REPLIT_DEV_DOMAIN"]
        ? `https://${process.env["REPLIT_DEV_DOMAIN"]}/api/auth/google/callback`
        : "http://localhost:8080/api/auth/google/callback";
  passport.use(
    new GoogleStrategy({ clientID, clientSecret, callbackURL }, async (_at, _rt, profile, done) => {
      const raw: GoogleUser = {
        id: profile.id,
        displayName: profile.displayName,
        username: profile.displayName,
        email: profile.emails?.[0]?.value ?? "",
        photo: profile.photos?.[0]?.value ?? "",
      };
      const user = await saveUser(raw);
      return done(null, user);
    }),
  );
  strategyRegistered = true;
}

passport.serializeUser((user, done) => done(null, (user as GoogleUser).id));
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await loadUser(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

router.get("/status", (_req, res) => {
  res.json({ googleConfigured: isConfigured(), dbConfigured: isSupabaseConfigured() });
});

router.get("/me", (req, res) => {
  if (req.isAuthenticated() && req.user) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

router.put("/profile", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  const { username } = req.body as { username?: string };
  if (!username || typeof username !== "string" || !username.trim()) {
    res.status(400).json({ error: "username is required" });
    return;
  }
  const trimmed = username.trim().slice(0, 32);
  const currentUser = req.user as GoogleUser;
  try {
    const db = getDb();
    await db.update(users)
      .set({ username: trimmed })
      .where(eq(users.id, currentUser.id));
    const updated: GoogleUser = { ...currentUser, username: trimmed };
    memUsers.set(updated.id, updated);
    (req.user as any).username = trimmed;
    res.json({ ok: true, user: updated });
  } catch (error) {
    res.status(500).json({ error: "Failed to update username" });
  }
});

router.post("/logout", (req, res) => {
  const id = (req.user as GoogleUser | undefined)?.id;
  if (id) memUsers.delete(id);
  req.logout(() => res.json({ ok: true }));
});

router.post("/register", rateLimit({ windowMs: 15 * 60 * 1000, max: 8 }), async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const consentAccepted = req.body.consentAccepted === true;
  const consentVersion = typeof req.body.consentVersion === "string" ? req.body.consentVersion : "";

  const sb = getSupabaseAdmin();
  if (!sb) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Please provide a valid email address." });
    return;
  }
  if (!consentAccepted || !consentVersion) {
    res.status(400).json({ error: "You must accept the Terms of Service and Privacy Policy before creating an account." });
    return;
  }
  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { username, consentAcceptedAt: new Date().toISOString(), consentVersion } },
    });
    if (error) {
      logger.info("Registration rejected by authentication provider");
      res.status(400).json({ error: "Registration could not be completed." });
      return;
    }
    logger.info("Registration accepted by authentication provider");
    res.status(200).json({
      message: "Check your email to verify your account!",
      user: data.user,
    });
  } catch {
    logger.error("Registration request failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  const { email, password } = req.body;
  const sb = getSupabaseAdmin();
  if (!sb) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    const rawUser: GoogleUser = {
      id: data.user.id,
      displayName: data.user.user_metadata?.username || email.split("@")[0],
      username: data.user.user_metadata?.username || email.split("@")[0],
      email: email,
      photo: "",
    };
    const user = await saveUser(rawUser);
    req.login(user, (err) => {
      if (err) {
        res.status(500).json({ error: "Session creation failed" });
        return;
      }
      res.status(200).json({ message: "Login successful!", user });
    });
  } catch {
    logger.error("Login failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/password-reset-request", rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const sb = getSupabaseAdmin();
  if (!sb) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Please provide a valid email address." });
    return;
  }
  try {
    const redirectTo = `${getFrontendURL() || "https://www.comihub.top"}/reset-password`;
    await sb.auth.resetPasswordForEmail(email, { redirectTo });
  } catch {
    // Keep this response generic so the endpoint cannot be used to enumerate accounts.
  }
  res.json({ message: "If an account exists for that email, a password reset link has been sent." });
});

router.get("/owner-recovery/users", async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: "Owner access required." });
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(500).json({ error: "Database not configured" });
  const accounts: Array<{ id: string; email: string | null; phone: string | null }> = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return res.status(502).json({ error: "Unable to load accounts." });
    accounts.push(...data.users.map(user => ({ id: user.id, email: user.email ?? null, phone: user.phone ?? null })));
    if (data.users.length < 1000) break;
  }
  return res.json({ users: accounts });
});

router.post("/owner-recovery/reset", async (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: "Owner access required." });
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!userId || password.length < 8) return res.status(400).json({ error: "A user and a password of at least 8 characters are required." });
  const sb = getSupabaseAdmin();
  if (!sb) return res.status(500).json({ error: "Database not configured" });
  const { data: target, error: lookupError } = await sb.auth.admin.getUserById(userId);
  if (lookupError || !target.user) return res.status(404).json({ error: "Account not found." });
  const { error } = await sb.auth.admin.updateUserById(userId, { password });
  if (error) return res.status(502).json({ error: "Unable to update the password." });
  try { await sb.auth.admin.signOut(userId, "global"); } catch { /* password update already succeeded */ }
  return res.json({ ok: true, message: "Password updated. Existing sessions were signed out." });
});

router.post("/refresh", (_req, res) => {
  res.status(410).json({ error: "Token refresh endpoint retired; sign in again." });
});

router.get("/google", (req, res, next) => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Google OAuth not configured." });
    return;
  }
  ensureStrategy();
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

function authRelayPage(status: "success" | "error", frontendURL: string): string {
  const dest = frontendURL ? `${frontendURL}/?auth=${status}` : null;
  const redirectScript = dest ? `<script>window.location.replace(${JSON.stringify(dest)});</script>` : `<script>if(window.history.length>1){window.history.back();}</script>`;
  const buttonHTML = dest ? `<a href="${dest}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;">Return to ComiHub</a>` : `<p style="color:#888;margin-top:16px;">Please close this tab and return to the app.</p>`;
  const isError = status === "error";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${isError ? "Sign In Failed" : "Signed In"} — ComiHub</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#121212;color:#f5f5f5;font-family:system-ui,sans-serif;padding:24px;text-align:center}
    .card{background:#1e1e1e;border:1px solid #333;border-radius:20px;padding:40px 32px;max-width:380px;width:100%}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-size:22px;font-weight:700;margin-bottom:8px}
    p{color:#aaa;font-size:15px;line-height:1.5}
  </style>
  ${redirectScript}
</head>
<body>
  <div class="card">
    <div class="icon">${isError ? "⚠️" : "✅"}</div>
    <h1>${isError ? "Sign In Failed" : "Signed In!"}</h1>
    <p>${isError ? "Something went wrong. Please try again." : "You're signed in to ComiHub. Tap below to return to the app."}</p>
    ${buttonHTML}
  </div>
</body>
</html>`;
}

router.get("/google/callback", (req, res, next) => {
  const frontendURL = getFrontendURL();
  passport.authenticate("google", { failureMessage: true })(req, res, (err: any) => {
    if (err || !req.user) {
      res.status(200).send(authRelayPage("error", frontendURL));
      return;
    }
    res.status(200).send(authRelayPage("success", frontendURL));
  });
});

export default router;
