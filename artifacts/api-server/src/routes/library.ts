import { Router } from "express";
import { getDb, isDbConfigured } from "../db";
import { users, librarySync } from "../schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { LibrarySyncDataSchema, LibrarySyncPayloadSchema, type LibrarySyncData } from "../lib/library-sync-schema";

const router = Router();

async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];

    if (token) {
      const supabaseUrl = process.env["SUPABASE_URL"];
      const apiKey = process.env["SUPABASE_ANON_KEY"] || process.env["SUPABASE_SERVICE_KEY"] || "";

      if (!supabaseUrl || !apiKey) {
        logger.error("Missing Supabase URL or key");
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
     return res.json({ data, updatedAt: rows[0]?.updatedAt ?? null });
  } catch (err) {
    logger.error("Library sync GET failed");
     return res.status(500).json({ error: "Database error" });
  }
});

// POST /api/library/sync
router.post("/sync", requireAuth, async (req, res) => {
  if (!isDbConfigured()) return res.status(503).json({ error: "Database not configured" });
  
  try {
    const db = getDb();
    const userId = (req.user as any).id as string;
    const validation = LibrarySyncPayloadSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid sync payload. Only bounded text metadata is accepted." });
    }
    const {
      library: incomingLib = {},
      categories: incomingCats = [],
      installedSourceIds: incomingSourceIds = [],
      progress: incomingProgress = {},
      history: incomingHistory = [],
      strategy,
    } = validation.data;

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
      logger.warn("User upsert skipped during library sync");
    }

    let finalData: LibrarySyncData;

    if (strategy === "upload") {
      finalData = {
        library: incomingLib,
        categories: incomingCats,
        installedSourceIds: incomingSourceIds.filter((id) => id !== "local.koofr" && id !== "builtin.universal"),
        progress: incomingProgress,
        history: incomingHistory,
      };
    } else {
      const existing = await db.select().from(librarySync).where(eq(librarySync.userId, userId));
      const rawStored = existing[0]?.data;
      const storedObject = rawStored && typeof rawStored === "object" && !Array.isArray(rawStored)
        ? rawStored as Record<string, unknown>
        : {};
      const isWrapped = ["library", "categories", "installedSourceIds", "installedSources", "progress", "history"]
        .some((key) => Object.prototype.hasOwnProperty.call(storedObject, key));
      const legacySources = storedObject.installedSources && typeof storedObject.installedSources === "object" && !Array.isArray(storedObject.installedSources)
        ? storedObject.installedSources as Record<string, unknown>
        : {};
      const storedValidation = LibrarySyncDataSchema.safeParse({
        library: isWrapped ? storedObject.library ?? {} : storedObject,
        categories: storedObject.categories ?? [],
        installedSourceIds: Array.isArray(storedObject.installedSourceIds)
          ? storedObject.installedSourceIds
          : Object.keys(legacySources),
        progress: storedObject.progress ?? {},
        history: storedObject.history ?? [],
      });
      const stored: LibrarySyncData = storedValidation.success
        ? storedValidation.data
        : { library: {}, categories: [], installedSourceIds: [], progress: {}, history: [] };
      if (!storedValidation.success) logger.warn("Stored library sync data failed metadata validation; invalid fields will be discarded.");

      // Merge Library — use the highest of addedAt/updatedAt so that mutations
      // like category changes (which bump updatedAt but not addedAt) always win
      // over older pushes carrying a stale snapshot of the same entry.
      const effectiveTs = (e: any) =>
        Math.max((e.addedAt ?? 0), (e.updatedAt ?? 0));

      const finalLibrary = { ...stored.library };
      for (const [id, entry] of Object.entries(incomingLib)) {
        const current = stored.library[id];
        if (!current || effectiveTs(entry) >= effectiveTs(current)) {
          finalLibrary[id] = entry;
        }
      }

      // Merge categories, retaining the existing device-independent behavior.
      const finalCategories = [...stored.categories];
      for (const cat of incomingCats) {
        if (!finalCategories.find((current) => current.id === cat.id)) finalCategories.push(cat);
      }

      // Cloud sync stores IDs only; the source manifests and install metadata
      // stay on-device. Removed/hidden sources cannot be restored from cloud.
      const finalSourceIds = Array.from(new Set([...stored.installedSourceIds, ...incomingSourceIds]))
        .filter((id) => id !== "local.koofr" && id !== "builtin.universal");

      // Progress uses its update timestamp; history is most-recent-first locally.
      const finalProgress = { ...stored.progress };
      for (const [key, entry] of Object.entries(incomingProgress)) {
        const current = stored.progress[key];
        if (!current || entry.updatedAt >= current.updatedAt) finalProgress[key] = entry;
      }
      const finalHistory = Array.from(new Set([...incomingHistory, ...stored.history])).slice(0, 200);

      finalData = {
        library: finalLibrary,
        categories: finalCategories,
        installedSourceIds: finalSourceIds,
        progress: finalProgress,
        history: finalHistory,
      };
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
      logger.error("Library save failed during library sync");
      res.json({ ok: false, count: 0, warning: "Could not save — database issue." });
    }

  } catch (err) {
    logger.error("Library sync POST failed");
    res.status(500).json({ error: "Database error" });
  }
  return;
});

export default router;
