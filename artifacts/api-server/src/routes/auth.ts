import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";

import { getSupabaseAdmin, isSupabaseConfigured } from "../lib/supabase";
import { getDb } from "../db";
import { users } from "../schema";
import { eq } from "drizzle-orm";

const router = Router();

const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "comihub-dev-secret-change-in-prod";
const SESSION_MAX_AGE = 90 * 24 * 3600 * 1000;

function getFrontendURL() {
  return (process.env["FRONTEND_URL"] ?? "").replace(/\/+$/, "");
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
  } catch (error: any) {
    console.error("Drizzle upsert error:", error.message);
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
  } catch (error) {
    console.error("Drizzle load user error:", error);
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

  private async ensureTable() {
    if (this.tableReady) return;
    const sb = getSupabaseAdmin();
    if (!sb) return;
    await sb.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS comihub_sessions (
          sid  TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS comihub_sessions_expires_idx
          ON comihub_sessions (expires_at);
      `,
    }).then(({ error }) => {
      if (error) {
        if (!error.message?.includes("already exists")) {
          console.warn("Sessions table setup warning:", error.message);
        }
      } else {
        this.tableReady = true;
      }
    }).catch(() => {});
    this.tableReady = true;
  }

  get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    const sb = getSupabaseAdmin();
    if (!sb) return callback(null, null);
    this.ensureTable().then(async () => {
      try {
        const { data, error } = await sb
          .from("comihub_sessions")
          .select("data, expires_at")
          .eq("sid", sid)
          .maybeSingle();
        if (error || !data) return callback(null, null);
        if (new Date((data as any).expires_at) < new Date()) {
          await sb.from("comihub_sessions").delete().eq("sid", sid).then(() => {});
          return callback(null, null);
        }
        callback(null, JSON.parse((data as any).data));
      } catch (err) {
        callback(err);
      }
    });
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    const sb = getSupabaseAdmin();
    if (!sb) return callback?.();
    const expiresAt = (sessionData.cookie?.expires instanceof Date)
      ? sessionData.cookie.expires
      : new Date(Date.now() + SESSION_MAX_AGE);
    this.ensureTable().then(async () => {
      try {
        await sb.from("comihub_sessions").upsert(
          { sid, data: JSON.stringify(sessionData), expires_at: expiresAt.toISOString() },
          { onConflict: "sid" },
        );
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    });
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    const sb = getSupabaseAdmin();
    if (!sb) return callback?.();
    getSupabaseAdmin()!
      .from("comihub_sessions")
      .delete()
      .eq("sid", sid)
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    const sb = getSupabaseAdmin();
    if (!sb) return callback?.();
    const expiresAt = (sessionData.cookie?.expires instanceof Date)
      ? sessionData.cookie.expires
      : new Date(Date.now() + SESSION_MAX_AGE);
    sb.from("comihub_sessions")
      .update({ expires_at: expiresAt.toISOString() })
      .eq("sid", sid)
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }
}

const sessionStore = isSupabaseConfigured() ? new SupabaseSessionStore() : undefined;

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

router.post("/register", async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  console.log("--- REGISTRATION ATTEMPT ---");
  console.log("Email:", `"${email}"`, `(Length: ${email.length})`);
  console.log("Username:", `"${username}"`, `(Length: ${username.length})`);
  console.log("Password:", `"${password}"`, `(Length: ${password.length})`);
  console.log("----------------------------");

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
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { username: username } },
    });
    if (error) {
      console.log("❌ SUPABASE REJECTED:", error.message);
      res.status(400).json({ error: error.message });
      return;
    }
    console.log("✅ SUPABASE ACCEPTED!");
    res.status(200).json({
      message: "Check your email to verify your account!",
      user: data.user,
    });
  } catch (err: any) {
    console.error("Register Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const sb = getSupabaseAdmin();
  if (!sb) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      res.status(400).json({ error: error.message });
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
      res.status(200).json({
        message: "Login successful!",
        user,
        accessToken: data.session?.access_token ?? "",
        refreshToken: data.session?.refresh_token ?? "",
        expiresAt: data.session?.expires_at ?? null,
      });
    });
  } catch (err: any) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }
  try {
    const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      res.status(401).json({ error: error?.message ?? "Refresh failed" });
      return;
    }
    res.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    });
  } catch (err: any) {
    console.error("Token refresh error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
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
