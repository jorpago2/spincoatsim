import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the SpinCoatSim application", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>SpinCoatSim/);
  assert.match(html, /See where the/);
  assert.match(html, /LIVE CROSS-SECTION/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});
