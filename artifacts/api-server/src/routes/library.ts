import { Router } from "express";
import { getDb, isDbConfigured } from "../db";
import { users, librarySync } from "../schema";
import { eq } from "drizzle-orm";

const router = Router();

// All routes require an authenticated session from Google OAuth
function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  next();
}

// GET /api/library/sync — fetch stored library from DB
router.get("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Database not configured" });
    return;
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
// Body: { library: Record<string, SavedManga>, strategy: "upload" | "merge" }
router.post("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Database not configured" });
    return;
  }
  try {
    const db = getDb();
    const userId = (req.user as any).id as string;
    const { library: incoming, strategy = "merge" } = req.body as {
      library: Record<string, any>;
      strategy?: "upload" | "merge";
    };

    if (!incoming || typeof incoming !== "object") {
      res.status(400).json({ error: "library must be an object" });
      return;
    }

    // Ensure user row exists
    await db.insert(users).values({
      id: userId,
      displayName: (req.user as any).displayName,
      email: (req.user as any).email,
      photo: (req.user as any).photo ?? "",
    }).onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: (req.user as any).displayName,
        email: (req.user as any).email,
        photo: (req.user as any).photo ?? "",
      },
    });

    let finalLibrary: Record<string, any>;

    if (strategy === "upload") {
      // Client wins — overwrite entirely
      finalLibrary = incoming;
    } else {
      // Merge — newer addedAt wins per entry
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

    await db.insert(librarySync).values({
      userId,
      data: finalLibrary,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: librarySync.userId,
      set: { data: finalLibrary, updatedAt: new Date() },
    });

    res.json({ ok: true, count: Object.keys(finalLibrary).length });
  } catch (err) {
    console.error("library sync POST failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET /api/library/status — tells frontend whether DB is available
router.get("/status", (_req, res) => {
  res.json({ dbConfigured: isDbConfigured() });
});

export default router;
