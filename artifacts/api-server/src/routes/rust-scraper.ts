import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

const router = Router();

const ParseRequestSchema = z.object({
  url: z.string().url().max(2048),
  titleSelector: z.string().max(256).optional(),
  coverSelector: z.string().max(256).optional(),
  chaptersSelector: z.string().max(256).optional(),
}).strict();

const ParseResponseSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  cover: z.string().url().nullable(),
  chapters: z.array(z.object({ title: z.string(), url: z.string().url() }).strict()).max(300),
}).strict();

function scraperEndpoint(): string | null {
  const configured = process.env["RUST_SCRAPER_URL"]?.trim();
  if (!configured) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(configured) ? configured : `http://${configured}`);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/scrape`;
    return url.toString();
  } catch {
    return null;
  }
}

router.post("/scraper/parse", async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Sign in to use the scraper service." });
  const request = ParseRequestSchema.safeParse(req.body);
  if (!request.success) return res.status(400).json({ error: "Invalid scraper request." });

  const endpoint = scraperEndpoint();
  const token = process.env["RUST_SCRAPER_TOKEN"];
  if (!endpoint || !token) return res.status(503).json({ error: "Rust scraper service is not configured." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request.data),
      signal: controller.signal,
    });
    if (!upstream.ok) return res.status(502).json({ error: "Rust scraper request failed." });
    const payload: unknown = await upstream.json();
    const parsed = ParseResponseSchema.safeParse(payload);
    if (!parsed.success) return res.status(502).json({ error: "Rust scraper returned an invalid response." });
    return res.json(parsed.data);
  } catch {
    return res.status(502).json({ error: "Rust scraper service is unavailable." });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
