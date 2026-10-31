import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCatalog,
  getSource,
  getSourceOrNull,
  getSourceManifests,
  isSupported,
} from "@fallensoul7/frwilxe-hub-sources";

test("source package exposes the existing backend registry and catalog", () => {
  assert.equal(isSupported("en.comix"), true);
  assert.equal(getSource("en.comix").id, "en.comix");
  assert.ok(getSourceManifests().some(manifest => manifest.id === "en.comix"));
  assert.ok(getCatalog().count > 0);
});

test("source package no longer registers K-Cafe", () => {
  assert.equal(isSupported("local.koofr"), false);
  assert.equal(getSourceOrNull("local.koofr"), null);
  assert.equal(getSourceManifests().some(manifest => manifest.id === "local.koofr"), false);
});
