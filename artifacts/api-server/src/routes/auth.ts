import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import { getDb, isDbConfigured } from "../db";
import { users } from "../schema";
import { eq } from "drizzle-orm";

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

// ── DB helpers ────────────────────────────────────────────────────────────────

interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}

// Upsert user into Neon so profile survives Render restarts
async function saveUserToDB(user: GoogleUser) {
  if (!isDbConfigured()) return;
  try {
    const db = getDb();
    await db.insert(users).values({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      photo: user.photo,
    }).onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: user.displayName,
        email: user.email,
        photo: user.photo,
      },
    });
  } catch (err) {
    console.error("Failed to save user to DB:", err);
  }
}

// Load user from Neon by Google ID
async function loadUserFromDB(id: string): Promise<GoogleUser | null> {
  if (!isDbConfigured()) return null;
  try {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id));
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      displayName: rows[0].displayName,
      email: rows[0].email,
      photo: rows[0].photo,
    };
  } catch (err) {
    console.error("Failed to load user from DB:", err);
    return null;
  }
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
      // Persist to Neon so profile survives server restarts
      await saveUserToDB(user);
      return done(null, user);
    }),
  );
  strategyRegistered = true;
}

// serialize: store only the Google ID in the session cookie
passport.serializeUser((user, done) => done(null, (user as GoogleUser).id));

// deserialize: load full profile from Neon (not RAM) so restarts don't break sessions
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await loadUserFromDB(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

router.use(passport.initialize());
router.use(passport.session());

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/status", (_req, res) => {
  res.json({ googleConfigured: isConfigured(), dbConfigured: isDbConfigured() });
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
      error: "Google OAuth not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment.",
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
