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

// ── User profile type ─────────────────────────────────────────────────────────
export interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
// Uses the service key (bypasses RLS) — safe because this only runs on Render.

async function saveUserToSupabase(user: GoogleUser) {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const { error } = await sb.from("comihub_users").upsert(
    {
      id: user.id,
      display_name: user.displayName,
      email: user.email,
      photo: user.photo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) console.error("Supabase upsert error:", error.message);
}

async function loadUserFromSupabase(id: string): Promise<GoogleUser | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("comihub_users")
    .select("id, display_name, email, photo")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return {
    id: data.id as string,
    displayName: data.display_name as string,
    email: data.email as string,
    photo: data.photo as string,
  };
}

// ── In-memory fallback (dev / Supabase not configured) ───────────────────────
const memUsers = new Map<string, GoogleUser>();

async function saveUser(user: GoogleUser) {
  memUsers.set(user.id, user);
  await saveUserToSupabase(user);
}

async function loadUser(id: string): Promise<GoogleUser | null> {
  // Check memory cache first (avoids DB round-trip on same process)
  if (memUsers.has(id)) return memUsers.get(id)!;
  // Fall back to Supabase (survives Render restarts)
  const fromDb = await loadUserFromSupabase(id);
  if (fromDb) memUsers.set(fromDb.id, fromDb); // warm the cache
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
      const user: GoogleUser = {
        id: profile.id,
        displayName: profile.displayName,
        email: profile.emails?.[0]?.value ?? "",
        photo: profile.photos?.[0]?.value ?? "",
      };
      await saveUser(user);
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
  res.json({
    googleConfigured: isConfigured(),
    dbConfigured: isSupabaseConfigured(),
  });
});

router.get("/me", (req, res) => {
  if (req.isAuthenticated() && req.user) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

router.post("/logout", (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

router.get("/google", (req, res, next) => {
  if (!isConfigured()) {
    res.status(503).json({
      error: "Google OAuth not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Render.",
    });
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
