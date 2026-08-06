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
        console.error("Missing Supabase URL or Key");
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

  if (typeof req.isAuthenticated === "function" && req.isAuthenticated() && req.user) {
    return next();
  }

  return res.status(401).json({ error: "Missing auth token" });
}

// GET /api/library/sync
router.get("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database not configured" });
  
  try {
    const db = getDb();
    const userId = (req.user as any).id as string;
    const rows = await db.select().from(librarySync).where(eq(librarySync.userId, userId));
    
    // ✅ Fix: Return the entire data payload, not just the library object
    const data = rows[0]?.data ?? {};
    res.json({ data, updatedAt: rows[0]?.updatedAt ?? null });
  } catch (err) {
    console.error("library sync GET failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// POST /api/library/sync
router.post("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database not configured" });
  
  try {
    const db = getDb();
    const userId = (req.user as any).id as string;
    
    // ✅ Fix: Accept library, categories, and installedSources
    const { library: incomingLib, categories: incomingCats, installedSources: incomingSrcs, strategy = "merge" } = req.body as any;

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
      console.warn("⚠️ User upsert skipped — real cause:", userErr.cause?.message ?? userErr.message);
    }

    let finalData: any = {};

    if (strategy === "upload") {
      finalData = { library: incomingLib, categories: incomingCats, installedSources: incomingSrcs };
    } else {
      const existing = await db.select().from(librarySync).where(eq(librarySync.userId, userId));
      const rawStored = (existing[0]?.data ?? {}) as any;
      
      // Backwards compatibility for old accounts that only saved the library object
      const storedLib = rawStored.library ? rawStored.library : rawStored;
      const storedCats = rawStored.categories || [];
      const storedSrcs = rawStored.installedSources || {};

      // Merge Library — use the highest of addedAt/updatedAt so that mutations
      // like category changes (which bump updatedAt but not addedAt) always win
      // over older pushes carrying a stale snapshot of the same entry.
      const effectiveTs = (e: any) =>
        Math.max((e.addedAt ?? 0), (e.updatedAt ?? 0));

      const finalLibrary = { ...storedLib };
      if (incomingLib) {
        for (const [id, entry] of Object.entries(incomingLib)) {
          const current = storedLib[id];
          if (!current || effectiveTs(entry) >= effectiveTs(current)) {
            finalLibrary[id] = entry;
          }
        }
      }

      // Merge Categories (Keep existing, add any new ones)
      const finalCategories = [...storedCats];
      if (incomingCats) {
        for (const cat of incomingCats) {
          if (!finalCategories.find((c: any) => c.id === cat.id)) finalCategories.push(cat);
        }
      }

      // Merge Extensions (Local overwrites if conflict)
      const finalSources = { ...storedSrcs, ...(incomingSrcs || {}) };

      finalData = { library: finalLibrary, categories: finalCategories, installedSources: finalSources };
    }

    try {
      await db.insert(librarySync).values({
        userId,
        data: finalData,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: librarySync.userId,
        set: { data: finalData, updatedAt: new Date() },
      });
      res.json({ ok: true, count: Object.keys(finalData.library || {}).length });
    } catch (libErr: any) {
      console.error("⚠️ Library save failed — real cause:", libErr.cause?.message ?? libErr.message);
      res.json({ ok: false, count: 0, warning: "Could not save — database issue." });
    }

  } catch (err) {
    console.error("library sync POST failed:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
