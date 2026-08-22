import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the SpinCoatSim application", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const canvas = await readFile(new URL("../src/components/SpinCoatCanvas.tsx", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../src/entry-server.tsx", import.meta.url), "utf8");
  const gdsClient = await readFile(new URL("../src/workers/gdsClient.ts", import.meta.url), "utf8");
  const gdsProtocol = await readFile(new URL("../src/workers/gdsProtocol.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../tokens.css", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(html, /<title>SpinCoatSim/);
  assert.match(html, /favicon\.svg/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /theme-color" content="#f4f4f4"/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  for (const metadata of ["theme-color", "canonical", "og:site_name", "og:url", "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt"]) {
    assert.match(html, new RegExp(metadata));
  }
  assert.match(html, /aria-label="Spin coating workflow"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="spin-tool-panel"/);
  for (const tool of ["Input", "Process stack", "Film model", "Results"]) assert.match(html, new RegExp(`>${tool}<`));
  assert.match(html, /No coating profile yet/);
  assert.match(html, /Load example/);
  assert.match(html, /href="#spin-workspace"/);
  assert.match(html, /id="spin-workspace"/);
  assert.match(html, /href="https:\/\/jorpago2\.github\.io\/"/);
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
  assert.match(source, /<ScientificToolRail/);
  assert.match(source, /className="spin-navigation"/);
  assert.match(source, /primaryAction=\{<ScientificHeaderAction kind="primary" label="Load example"/);
  assert.equal(source.match(/onClick=\{loadDemo\}/g)?.length, 2);
  assert.match(source, /activeId=\{activePanel \?\? "results"\}/);
  assert.match(source, /expandedId=\{activePanel\}/);
  assert.match(source, /registerItemRef=/);
  assert.doesNotMatch(styles, /--scientific-ui-rail-inline-size/);
  assert.match(source, /useScientificResultTransition\(\{/);
  assert.match(source, /resultRef: resultHeading/);
  assert.match(canvas, /aria-describedby="spin-readout spin-profile-description"/);
  assert.match(canvas, /scientific-render-surface--dark/);
  assert.match(canvas, /event\.key !== 'ArrowLeft'/);
  assert.match(styles, /macrostructure: Workbench/);
  const carbon = await readFile(new URL("../src/carbon.scss", import.meta.url), "utf8");
  assert.match(carbon, /@use ["']@carbon\/react["']/);
  assert.doesNotMatch(styles, /tailwindcss|@theme inline/);
  for (const component of ["Grid", "NumberInput", "Select", "ComboBox", "Accordion", "FileUploaderButton", "InlineNotification", "Modal", "ProgressBar", "Slider", "ExportReceipt", "ScientificEmptyState", "ScientificStatusBar"]) {
    assert.match(source, new RegExp(`<${component}`));
  }
  assert.match(source, /restoreCustomCalibration/);
  assert.match(source, /<ScientificOutcomeSummary\b/);
  assert.match(source, /Inputs and profile up to date/);
  assert.match(source, /importGdsFile/);
  assert.match(source, /Calibration law/);
  assert.match(source, /Reference process comparison/);
  assert.match(source, /provenance: parameterProvenance/);
  assert.match(source, /fileName=\{exportNotice\.fileName\}/);
  assert.match(source, /<ScientificAppShell/);
  assert.match(source, /<SpinCoatCanvas/);
  assert.doesNotMatch(source, /miniPreview|mini-preview/);
  assert.doesNotMatch(source, /document\.(?:addEventListener|getElementById|querySelector)/);
  assert.doesNotMatch(canvas, /addEventListener\(/);
  assert.match(main, /hydrateRoot/);
  assert.match(main, /createRoot/);
  assert.match(server, /<ScientificUiProvider><App \/><\/ScientificUiProvider>/);
  assert.match(gdsProtocol, /type GdsWorkerResponse/);
  assert.doesNotMatch(gdsClient, /Record<string, unknown>|as unknown as/);
  assert.match(styles, /overflow-x: clip/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(|100vw|transition:\s*all/i);
  assert.match(tokens, /--color-plot-background:\s*var\(--color-viewer-deep\)/);
  assert.doesNotMatch(tokens, /--color-viewer:/);
  assert.match(tokens, /--color-plot-cursor:\s*var\(--color-viewer-grid\)/);
  assert.doesNotMatch(tokens, /--cds-background\s*:/);
  assert.match(canvas, /--color-plot-film/);
  assert.doesNotMatch(`${source}\n${canvas}`, /#ff5a1f/);
  assert.match(favicon, /#75b9c8/);
  assert.match(favicon, /#f0b84a/);
  assert.match(favicon, /#eb3f00/);
  for (const legacyToken of ["font-display", "radius-input", "radius-card", "radius-pill", "shadow-raised", "ease-out", "ease-in", "ease-in-out", "dur-micro", "dur-short", "dur-long", "space-2xl", "space-3xl", "text-2xl", "text-display"]) {
    assert.doesNotMatch(tokens, new RegExp(`--${legacyToken}:`));
  }
  for (const replacedSurfaceToken of ["color-paper", "color-surface", "color-ink", "color-accent", "color-success", "color-danger", "color-warning", "color-overlay"]) {
    assert.doesNotMatch(tokens, new RegExp(`--${replacedSurfaceToken}(?:-|:)`));
  }
});
