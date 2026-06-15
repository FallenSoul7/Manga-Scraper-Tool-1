import { createHash } from "node:crypto";

const COMIX_SECRET = "c7e41b33a16f3b2e4f47e7aab6be0d3c";

export function generateHash(path: string, seed: number, time: number): string {
  const raw = `${path}&${time}&${COMIX_SECRET}`;
  return createHash("md5").update(raw).digest("hex");
}
