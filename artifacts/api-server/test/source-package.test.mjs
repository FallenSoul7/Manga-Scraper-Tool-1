import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CACHE_ROOT,
  getCatalog,
  getKoofrCover,
  getSource,
  getSourceManifests,
  isProxySafe,
  isSupported,
  koofrStream,
  koofrThumbnail,
} from "@fallensoul7/manga-scraper-sources";

test("source package exposes the existing backend registry and catalog", () => {
  assert.equal(isSupported("en.comix"), true);
  assert.equal(getSource("en.comix").id, "en.comix");
  assert.ok(getSourceManifests().some(manifest => manifest.id === "en.comix"));
  assert.ok(getCatalog().count > 0);
});

test("source package preserves Koofr proxy helpers used by the backend", () => {
  assert.equal(typeof getKoofrCover, "function");
  assert.equal(typeof koofrStream, "function");
  assert.equal(typeof koofrThumbnail, "function");
  assert.equal(typeof isProxySafe, "function");
  assert.equal(CACHE_ROOT, "/tmp/koofr-cache");
});
