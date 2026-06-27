import { Router } from "express";
import { getDb, isDbConfigured } from "../db";
import { users, librarySync } from "../schema";
import { eq } from "drizzle-orm";

const router = Router();

// ✅ FIX: Empty Bearer token no longer causes a 401 — falls through to session.
//         If Bearer token is present AND non-empty, it's verified with Supabase.
//         If absent or empty, falls back to Passport session (Google OAuth / email login).
async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];

    // Only attempt Supabase verification if token is actually present
    if (token) {
      const supabaseUrl = process.env["SUPABASE_URL"];
      const apiKey = process.env["SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_ANON_KEY"] || "";

      if (!supabaseUrl || !apiKey) {
        console.error("Missing Supabase URL or Key in Render environment variables.");
        return res.status(500).json({ error: "Server configuration error" });
      }

      try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "apikey": apiKey,
          },
        });

        if (response.ok) {
          const user = await response.json();
          req.user = user;
          return next();
        }

        // Token was present and non-empty but Supabase rejected it — hard 401
        return res.status(401).json({ error: "Invalid or expired session" });
      } catch (error) {
        return res.status(500).json({ error: "Auth verification failed" });
      }
    }
  }

  // No Bearer token (or empty) — fall back to Passport session
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated() && req.user) {
    return next();
  }

  return res.status(401).json({ error: "Missing auth token" });
}

// GET /api/library/sync — fetch stored library from DB
router.get("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) {
    return res.status(503).json({ error: "Database not configured" });
  }
  try {
    const db = getDb();
    const userId = (req.user as any).id as string;
    const rows = await db.select().from(librarySync).where(eq(librarySync.userId, userId));
    const library = rows[0]?.data ?? {};
    res.json({ library, updatedAt: rows[0]?.updatedAt ?? null });
  } catch (err) {
    console.error("library sync GET failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// POST /api/library/sync — save/merge library to DB
router.post("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) {
    return res.status(503).json({ error: "Database not configured" });
  }
  try {
    const db = getDb();
    const userId = (req.user as any).id as string;
    const { library: incoming, strategy = "merge" } = req.body as {
      library: Record<string, any>;
      strategy?: "upload" | "merge";
    };

    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ error: "library must be an object" });
    }

    try {
      await db.insert(users).values({
        id: userId,
        email: (req.user as any).email || "",
        username: (req.user as any).user_metadata?.username || "Reader",
      }).onConflictDoUpdate({
        target: users.id,
        set: {
          email: (req.user as any).email || "",
          username: (req.user as any).user_metadata?.username || "Reader",
        },
      });
    } catch (userErr: any) {
      console.warn("⚠️ User sync skipped (Check database schema!):", userErr.message);
    }

    let finalLibrary: Record<string, any>;

    if (strategy === "upload") {
      finalLibrary = incoming;
    } else {
      const existing = await db.select().from(librarySync).where(eq(librarySync.userId, userId));
      const stored = (existing[0]?.data ?? {}) as Record<string, any>;
      finalLibrary = { ...stored };
      for (const [id, entry] of Object.entries(incoming)) {
        const current = stored[id];
        if (!current || (entry.addedAt ?? 0) >= (current.addedAt ?? 0)) {
          finalLibrary[id] = entry;
        }
      }
    }

    try {
      await db.insert(librarySync).values({
        userId,
        data: finalLibrary,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: librarySync.userId,
        set: { data: finalLibrary, updatedAt: new Date() },
      });
      res.json({ ok: true, count: Object.keys(finalLibrary).length });
    } catch (libErr: any) {
      console.error("⚠️ Library save failed:", libErr.message);
      res.status(500).json({ error: "Failed to save library to database" });
    }
  } catch (err) {
    console.error("library sync POST failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.get("/status", (_req, res) => {
  res.json({ dbConfigured: isDbConfigured() });
});

export default router;
