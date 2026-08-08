import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the SpinCoatSim application", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../tokens.css", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(html, /<title>SpinCoatSim/);
  assert.match(html, /favicon\.svg/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /theme-color" content="#faf4ec"/);
  assert.doesNotMatch(html, /#f4f4f4/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  for (const metadata of ["theme-color", "canonical", "og:site_name", "og:url", "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt"]) {
    assert.match(html, new RegExp(metadata));
  }
  assert.match(html, /aria-label="Configuration tools"/);
  assert.match(html, /aria-expanded="false"/);
  for (const tool of ["Input", "Stack", "Coating"]) assert.match(html, new RegExp(`>${tool}<`));
  assert.match(html, /No coating profile yet/);
  assert.match(html, /Load example/);
  assert.match(html, /href="#spin-workspace"/);
  assert.match(html, /id="spin-workspace"/);
  assert.match(html, /href="https:\/\/jorpago2\.github\.io\/"/);
  assert.match(html, /No profile yet/);
  assert.match(source, /Capabilities and model scope/);
  assert.match(source, /Metal oxides/);
  assert.match(source, /All polarities/);
  assert.match(source, /All brands/);
  assert.match(source, /All wavelengths/);
  assert.match(source, /h-line/);
  assert.match(source, /SiO₂/);
  assert.match(source, /µm/);
  assert.doesNotMatch(html, /Â|Ã|â/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview/);
  assert.match(source, /useState<GdsShape\[]>\(\[\]\)/);
  assert.match(source, /<nav className="spin-navigation"/);
  assert.match(source, /resultHeading\.current\?\.focus\(\)/);
  assert.match(source, /aria-describedby="spin-readout"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(styles, /macrostructure: Workbench/);
  const carbon = await readFile(new URL("../src/carbon.scss", import.meta.url), "utf8");
  assert.match(carbon, /@use ["']@carbon\/react["']/);
  assert.doesNotMatch(styles, /tailwindcss|@theme inline/);
  for (const component of ["Grid", "NumberInput", "Select", "Slider", "Accordion", "FileUploaderButton"]) {
    assert.match(source, new RegExp(`<${component}`));
  }
  assert.match(source, /<Grid as="main"/);
  assert.match(styles, /overflow-x: clip/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(|100vw|transition:\s*all/i);
  assert.match(tokens, /--color-accent: oklch\(/);
  assert.match(tokens, /--color-plot-background:\s*var\(--color-viewer-deep\)/);
  assert.match(tokens, /--color-plot-cursor:\s*var\(--color-viewer-grid\)/);
  assert.match(tokens, /:root,\s*\.cds--g10\s*\{[\s\S]*--cds-background:\s*var\(--color-paper\)/);
  assert.match(tokens, /--cds-button-primary:\s*var\(--color-accent-strong\)/);
  assert.match(tokens, /--cds-support-success:\s*var\(--color-success\)/);
  assert.match(tokens, /--cds-layer-selected-inverse:\s*var\(--color-ink\)/);
  assert.match(tokens, /\.cds--layer-two\s*\{\s*--cds-layer-background:\s*var\(--color-surface\)/);
  assert.match(source, /var\(--color-plot-film\)/);
  assert.doesNotMatch(source, /#ff5a1f/);
  assert.match(favicon, /#75b9c8/);
  assert.match(favicon, /#f0b84a/);
  assert.match(favicon, /#eb3f00/);
  for (const legacyToken of ["font-display", "radius-input", "radius-card", "radius-pill", "shadow-raised", "ease-out", "ease-in", "ease-in-out", "dur-micro", "dur-short", "dur-long", "space-2xl", "space-3xl", "text-2xl", "text-display"]) {
    assert.doesNotMatch(tokens, new RegExp(`--${legacyToken}:`));
  }
});
