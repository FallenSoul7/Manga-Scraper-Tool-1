import { Router } from "express";
import { getDb, isDbConfigured } from "../db";
import { users, librarySync } from "../schema";
import { eq } from "drizzle-orm";

const router = Router();

async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];

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

        return res.status(401).json({ error: "Invalid or expired session" });
      } catch (error) {
        return res.status(500).json({ error: "Auth verification failed" });
      }
    }
  }

  // No Bearer token — fall back to Passport session cookie
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

    // Try to upsert the user row — if this fails (RLS / schema mismatch) we warn and continue
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
      // ✅ FIX: Log the real Postgres cause so you can see if it's RLS, FK, schema etc.
      console.warn(
        "⚠️ User upsert skipped — real cause:",
        userErr.cause?.message ?? userErr.cause ?? userErr.message,
        "\nHint: check RLS on the `users` table in Supabase dashboard.",
      );
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
      // ✅ FIX: Log real cause, then fall back to returning existing cloud data
      //         instead of 500 — this keeps the client flow alive so it can still
      //         restore the library from the GET call.
      console.error(
        "⚠️ Library save failed — real cause:",
        libErr.cause?.message ?? libErr.cause ?? libErr.message,
        "\nHint: FK violation means the `users` row doesn't exist. Fix RLS or run drizzle-kit push.",
      );
      try {
        const fallback = await db.select().from(librarySync).where(eq(librarySync.userId, userId));
        const fallbackData = (fallback[0]?.data ?? {}) as Record<string, any>;
        // Return 200 so the client doesn't treat this as a hard failure
        res.json({
          ok: false,
          count: Object.keys(fallbackData).length,
          warning: "Could not save — returning existing cloud library.",
        });
      } catch {
        res.status(500).json({ error: "Failed to save library to database" });
      }
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
