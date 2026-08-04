import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the SpinCoatSim application", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>SpinCoatSim/);
  assert.match(html, /favicon\.svg/);
  assert.match(html, /See where the/);
  assert.match(html, /href="#spin-workspace"/);
  assert.match(html, /id="spin-workspace"/);
  assert.match(html, /LIVE CROSS-SECTION/);
  assert.match(html, /MICROPOSIT S1813/);
  assert.match(html, /SU-8 2002/);
  assert.match(html, /KMPR 1010/);
  assert.match(html, /AZ 4562/);
  assert.match(html, /AZ ECI 3012/);
  assert.match(html, /TI 35E/);
  assert.match(html, /Metal oxides/);
  assert.match(html, /All polarities/);
  assert.match(html, /All brands/);
  assert.match(html, /All wavelengths/);
  assert.match(html, /h-line/);
  assert.match(html, /SiO₂/);
  assert.match(html, /µm/);
  assert.doesNotMatch(html, /Â|Ã|â/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
});
