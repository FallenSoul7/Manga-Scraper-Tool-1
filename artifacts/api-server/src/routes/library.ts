import { Router } from "express";
import { getDb, isDbConfigured } from "../db";
import { users, librarySync } from "../schema";
import { eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// 🚀 Initialize Supabase for verifying user tokens
const supabase = createClient(
  process.env["SUPABASE_URL"] || "",
  process.env["SUPABASE_ANON_KEY"] || ""
);

// 🚀 UPDATED: Checks for Supabase Bearer token instead of Google Cookies
async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const token = authHeader.split(" ")[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  req.user = user; // Attach the verified Supabase user object
  next();
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

    // 🚀 UPDATED: Matches your new Drizzle schema.ts structure (removed photo/displayName)
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

router.get("/status", (_req, res) => {
  res.json({ dbConfigured: isDbConfigured() });
});

export default router;
