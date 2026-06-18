import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";

const router = Router();

const SESSION_SECRET = process.env["SESSION_SECRET"] ?? "comihub-dev-secret-change-in-prod";

// Read fresh each request — so Render deploys pick up new env vars immediately
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

// ── In-memory user store (swap for DB later) ─────────────────────────────────
interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}
const users = new Map<string, GoogleUser>();

// ── Session ───────────────────────────────────────────────────────────────────
router.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 30 * 24 * 3600 * 1000,
    },
  }),
);

// ── Passport — lazily configure strategy on first request ────────────────────
let strategyRegistered = false;
function ensureStrategy() {
  if (strategyRegistered) return;
  const { clientID, clientSecret } = getGoogleCreds();
  if (!clientID || !clientSecret) return;

  const callbackURL =
    process.env["NODE_ENV"] === "production"
      ? `${process.env["API_BASE_URL"] ?? ""}/api/auth/google/callback`
      : "http://localhost:8080/api/auth/google/callback";

  passport.use(
    new GoogleStrategy({ clientID, clientSecret, callbackURL }, (_at, _rt, profile, done) => {
      const user: GoogleUser = {
        id: profile.id,
        displayName: profile.displayName,
        email: profile.emails?.[0]?.value ?? "",
        photo: profile.photos?.[0]?.value ?? "",
      };
      users.set(user.id, user);
      return done(null, user);
    }),
  );
  strategyRegistered = true;
}

passport.serializeUser((user, done) => done(null, (user as GoogleUser).id));
passport.deserializeUser((id: string, done) => done(null, users.get(id) ?? null));

router.use(passport.initialize());
router.use(passport.session());

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/status", (_req, res) => {
  res.json({ googleConfigured: isConfigured() });
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
  passport.authenticate("google", { failureRedirect: "/?auth=error" })(req, res, () => {
    res.redirect("/?auth=success");
  });
});

export default router;
