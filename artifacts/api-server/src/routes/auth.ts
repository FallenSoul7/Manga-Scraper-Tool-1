import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";

const router = Router();

const GOOGLE_CLIENT_ID     = process.env["GOOGLE_CLIENT_ID"] ?? "";
const GOOGLE_CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";
const SESSION_SECRET        = process.env["SESSION_SECRET"] ?? "comihub-dev-secret-change-in-prod";
const isConfigured = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

// ── In-memory user store (swap for DB later) ────────────────────────────────
interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  photo: string;
}
const users = new Map<string, GoogleUser>();

// ── Session + Passport middleware (applied only on this router) ─────────────
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

passport.serializeUser((user, done) => done(null, (user as GoogleUser).id));
passport.deserializeUser((id: string, done) => done(null, users.get(id) ?? null));

if (isConfigured) {
  const callbackURL =
    process.env["NODE_ENV"] === "production"
      ? `${process.env["API_BASE_URL"] ?? ""}/api/auth/google/callback`
      : "http://localhost:8080/api/auth/google/callback";

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL,
      },
      (_accessToken, _refreshToken, profile, done) => {
        const user: GoogleUser = {
          id: profile.id,
          displayName: profile.displayName,
          email: profile.emails?.[0]?.value ?? "",
          photo: profile.photos?.[0]?.value ?? "",
        };
        users.set(user.id, user);
        return done(null, user);
      },
    ),
  );
}

router.use(passport.initialize());
router.use(passport.session());

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/me", (req, res) => {
  if (req.isAuthenticated() && req.user) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

router.post("/logout", (req, res) => {
  req.logout(() => {
    res.json({ ok: true });
  });
});

if (isConfigured) {
  router.get(
    "/google",
    passport.authenticate("google", { scope: ["profile", "email"] }),
  );

  router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth=error" }),
    (_req, res) => {
      res.redirect("/?auth=success");
    },
  );
} else {
  router.get("/google", (_req, res) => {
    res.status(503).json({
      error: "Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment.",
    });
  });
}

router.get("/status", (_req, res) => {
  res.json({ googleConfigured: isConfigured });
});

export default router;
