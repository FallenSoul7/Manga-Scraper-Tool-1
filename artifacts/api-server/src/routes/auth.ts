import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import { getSupabaseAdmin, isSupabaseConfigured } from "../lib/supabase";

const router = Router();

const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "comihub-dev-secret-change-in-prod";

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

// ── User type (matches comihub_users table) ───────────────────────────────────
export interface GoogleUser {
  id: string;
  displayName: string;
  username: string;   // custom app username, defaults to displayName on first login
  email: string;
  photo: string;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function upsertUser(user: GoogleUser): Promise<GoogleUser> {
  const sb = getSupabaseAdmin();
  if (!sb) return user;

  // Check if a user with this email already exists (returning user)
  const { data: existing } = await sb
    .from("comihub_users")
    .select("id, username")
    .eq("email", user.email)
    .maybeSingle();

  // Preserve custom username if they've set one before
  const username = (existing as any)?.username ?? user.displayName;

  const { error } = await sb.from("comihub_users").upsert(
    {
      id: user.id,
      display_name: user.displayName,
      username,
      email: user.email,
      photo: user.photo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) console.error("Supabase upsert error:", error.message);
  return { ...user, username };
}

async function loadUserById(id: string): Promise<GoogleUser | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("comihub_users")
    .select("id, display_name, username, email, photo")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  const row = data as Record<string, string>;
  return {
    id: row["id"],
    displayName: row["display_name"],
    username: row["username"] ?? row["display_name"],
    email: row["email"],
    photo: row["photo"] ?? "",
  };
}

// ── In-memory cache (avoids a DB round-trip per request on same process) ─────
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

// ── Session ───────────────────────────────────────────────────────────────────
router.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: process.env["NODE_ENV"] === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 3600 * 1000,
    },
  }),
);

// ── Passport ──────────────────────────────────────────────────────────────────
let strategyRegistered = false;
function ensureStrategy() {
  if (strategyRegistered) return;
  const { clientID, clientSecret } = getGoogleCreds();
  if (!clientID || !clientSecret) return;

  const callbackURL =
    process.env["NODE_ENV"] === "production"
      ? `${process.env["API_BASE_URL"] ?? ""}/api/auth/google/callback`
      : process.env["REPLIT_DEV_DOMAIN"]
        ? `https://${process.env["REPLIT_DEV_DOMAIN"]}/api/auth/google/callback`
        : "http://localhost:8080/api/auth/google/callback";

  passport.use(
    new GoogleStrategy({ clientID, clientSecret, callbackURL }, async (_at, _rt, profile, done) => {
      const raw: GoogleUser = {
        id: profile.id,
        displayName: profile.displayName,
        username: profile.displayName, // will be overwritten by upsertUser if returning user
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

router.use(passport.initialize());
router.use(passport.session());

// ── Routes ────────────────────────────────────────────────────────────────────

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

// Update custom username (profile edit)
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

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error } = await sb
      .from("comihub_users")
      .update({ username: trimmed, updated_at: new Date().toISOString() })
      .eq("id", currentUser.id);
    if (error) {
      res.status(500).json({ error: "Failed to update username" });
      return;
    }
  }

  // Update memory cache + session
  const updated: GoogleUser = { ...currentUser, username: trimmed };
  memUsers.set(updated.id, updated);
  (req.user as any).username = trimmed;

  res.json({ ok: true, user: updated });
});

router.post("/logout", (req, res) => {
  const id = (req.user as GoogleUser | undefined)?.id;
  if (id) memUsers.delete(id);
  req.logout(() => res.json({ ok: true }));
});

router.get("/google", (req, res, next) => {
  if (!isConfigured()) {
    res.status(503).json({ error: "Google OAuth not configured." });
    return;
  }
  ensureStrategy();
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

router.get("/google/callback", (req, res, next) => {
  const frontendURL = getFrontendURL();
  passport.authenticate("google", {
    failureRedirect: `${frontendURL}/?auth=error`,
  })(req, res, () => {
    res.redirect(`${frontendURL}/?auth=success`);
  });
});

export default router;
