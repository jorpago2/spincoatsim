"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { boundsOf, flattenGds, parseGds } from "@/lib/gds.js";
import { filterMetalOxides, METAL_OXIDE_FAMILIES, METAL_OXIDE_PRESETS } from "@/lib/metal-oxides.js";
import { filterPhotoresists, PHOTORESIST_EXPOSURE_WAVELENGTHS, PHOTORESIST_MANUFACTURERS, PHOTORESIST_POLARITIES, PHOTORESIST_PRESETS } from "@/lib/photoresists.js";
import {
  buildMaterialColumns,
  buildSpinFilm,
  calibratedThickness,
  polygonIntervalsAtY,
  sampleIntervals,
} from "@/lib/spincoat.js";

type GdsShape = ReturnType<typeof flattenGds>[number];
type LayerMode = "uniform" | "patterned" | "etch";
type StackLayer = { id: number; name: string; mode: LayerMode; thicknessNm: number; gdsLayer: number; color: string };
type MaterialSegment = { name: string; color: string; bottom: number; top: number };
type SectionResult = {
  columns: MaterialSegment[][];
  film: {
    surface: number[];
    top: number[];
    localThickness: number[];
    minimumThicknessNm: number;
    maximumThicknessNm: number;
    meanThicknessNm: number;
    degreeOfPlanarizationPercent: number;
    thicknessNonUniformityPercent: number;
  };
  ignoredPaths: number;
};

const DEMO_SHAPES: GdsShape[] = [
  { kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: -42, y: -15 }, { x: -18, y: -15 }, { x: -18, y: 15 }, { x: -42, y: 15 }] },
  { kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: -8, y: -15 }, { x: 8, y: -15 }, { x: 8, y: 15 }, { x: -8, y: 15 }] },
  { kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: 20, y: -15 }, { x: 38, y: -15 }, { x: 38, y: 15 }, { x: 20, y: 15 }] },
  { kind: "polygon", layer: 2, datatype: 0, width: 0, pathType: 0, points: [{ x: -28, y: -15 }, { x: -4, y: -15 }, { x: -4, y: 15 }, { x: -28, y: 15 }] },
  { kind: "polygon", layer: 2, datatype: 0, width: 0, pathType: 0, points: [{ x: 13, y: -15 }, { x: 30, y: -15 }, { x: 30, y: 15 }, { x: 13, y: 15 }] },
];

const COLORS = ["#f0b84a", "#75b9c8", "#a28fe0", "#e67f65", "#93ba72", "#d986b5"];
const RESOLUTION = 480;

function bounded(value: number, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SpinCoatPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [shapes, setShapes] = useState<GdsShape[]>([]);
  const [fileName, setFileName] = useState("");
  const [topCell, setTopCell] = useState("");
  const [sliceY, setSliceY] = useState(0);
  const [centreX, setCentreX] = useState(0);
  const [viewWidth, setViewWidth] = useState(100);
  const [substrateThickness, setSubstrateThickness] = useState(700);
  const [layers, setLayers] = useState<StackLayer[]>([
    { id: 1, name: "SiO₂", mode: "uniform", thicknessNm: 300, gdsLayer: 1, color: "#75b9c8" },
    { id: 2, name: "Ti/Au", mode: "patterned", thicknessNm: 120, gdsLayer: 1, color: "#f0b84a" },
  ]);
  const [referenceThickness, setReferenceThickness] = useState(180);
  const [referenceRpm, setReferenceRpm] = useState(3000);
  const [rpm, setRpm] = useState(3000);
  const [exponent, setExponent] = useState(0.5);
  const [coatingLibrary, setCoatingLibrary] = useState<"photoresist" | "oxide">("photoresist");
  const [coatingPresetId, setCoatingPresetId] = useState("");
  const [photoresistPolarity, setPhotoresistPolarity] = useState("");
  const [photoresistManufacturer, setPhotoresistManufacturer] = useState("");
  const [photoresistExposureNm, setPhotoresistExposureNm] = useState("");
  const [metalOxideFamily, setMetalOxideFamily] = useState("");
  const [shrinkage, setShrinkage] = useState(25);
  const [levelingStrength, setLevelingStrength] = useState(65);
  const [levelingLength, setLevelingLength] = useState(8);
  const [cursorIndex, setCursorIndex] = useState(Math.floor(RESOLUTION / 2));
  const [canvasCssWidth, setCanvasCssWidth] = useState(1200);
  const [error, setError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"controls" | "results">("controls");

  const revealResults = () => {
    setMobilePanel("results");
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 59.99rem)").matches) resultHeading.current?.focus();
    });
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setCanvasCssWidth(Math.max(1, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [shapes.length]);

  const availableLayers = useMemo(() => [...new Set(shapes.map((shape) => shape.layer))].sort((a, b) => a - b), [shapes]);
  const photoresistPreset = coatingLibrary === "photoresist" ? PHOTORESIST_PRESETS.find((preset) => preset.id === coatingPresetId) : undefined;
  const metalOxidePreset = coatingLibrary === "oxide" ? METAL_OXIDE_PRESETS.find((preset) => preset.id === coatingPresetId) : undefined;
  const coatingPreset = photoresistPreset ?? metalOxidePreset;
  const filteredPhotoresists = filterPhotoresists(photoresistPolarity, photoresistManufacturer, photoresistExposureNm);
  const filteredMetalOxides = filterMetalOxides(metalOxideFamily);
  const filteredCoatings = coatingLibrary === "photoresist" ? filteredPhotoresists : filteredMetalOxides;
  const coatingLibrarySize = coatingLibrary === "photoresist" ? PHOTORESIST_PRESETS.length : METAL_OXIDE_PRESETS.length;
  const xMin = centreX - viewWidth / 2;
  const xMax = centreX + viewWidth / 2;
  const dryThickness = calibratedThickness(referenceThickness, referenceRpm, rpm, exponent);
  const finalThickness = dryThickness * (1 - shrinkage / 100);

  const section = useMemo<SectionResult | null>(() => {
    if (!shapes.length) return null;
    const slices = layers.map((layer) => polygonIntervalsAtY(shapes, layer.gdsLayer, sliceY));
    const preparedLayers = layers.map((layer, index) => ({
      ...layer,
      mask: sampleIntervals(slices[index].intervals, xMin, xMax, RESOLUTION),
    }));
    const columns = buildMaterialColumns({
      count: RESOLUTION,
      substrate: { name: "Substrate", color: "#5c6570", thicknessNm: substrateThickness },
      layers: preparedLayers,
    });
    return {
      columns,
      film: buildSpinFilm(columns, finalThickness, levelingStrength / 100, levelingLength / (viewWidth / RESOLUTION)),
      ignoredPaths: slices.reduce((sum, slice) => sum + slice.ignoredPaths, 0),
    };
  }, [shapes, layers, sliceY, xMin, xMax, substrateThickness, finalThickness, levelingStrength, levelingLength, viewWidth]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !section) return;
    const width = canvasCssWidth;
    const height = Math.round(width * 650 / 1200);
    const pixelRatio = window.devicePixelRatio || 1;
    element.width = Math.round(width * pixelRatio);
    element.height = Math.round(height * pixelRatio);
    const context = element.getContext("2d");
    if (!context) return;
    const styles = getComputedStyle(document.documentElement);
    const color = (token: string) => styles.getPropertyValue(token).trim();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = color("--color-plot-background");
    context.fillRect(0, 0, width, height);

    const compact = width < 600;
    const margin = compact ? { left: 52, right: 14, top: 34, bottom: 43 } : { left: 76, right: 30, top: 38, bottom: 55 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const allBottoms = section.columns.flatMap((column) => column.map((segment) => segment.bottom));
    const minZ = Math.min(...allBottoms);
    const highestFilmPoint = Math.max(...section.film.top);
    const maxZ = highestFilmPoint + Math.max(20, (highestFilmPoint - minZ) * 0.05);
    const zRange = maxZ - minZ;
    const mapY = (z: number) => margin.top + ((maxZ - z) / (maxZ - minZ)) * plotHeight;
    const columnWidth = plotWidth / RESOLUTION;
    const verticalExaggeration = (viewWidth * 1000 / plotWidth) / (zRange / plotHeight);

    context.strokeStyle = color("--color-plot-grid");
    context.lineWidth = 1;
    context.font = `${compact ? 9 : 12}px ${styles.getPropertyValue("--font-mono").trim()}`;
    context.fillStyle = color("--color-plot-axis");
    const verticalTicks = compact ? 3 : 5;
    for (let tick = 0; tick <= verticalTicks; tick += 1) {
      const y = margin.top + (tick / verticalTicks) * plotHeight;
      const z = maxZ - (tick / verticalTicks) * zRange;
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke();
      context.fillText(`${Math.round(z)}`, 8, y + 4);
    }

    section.columns.forEach((column, index) => {
      const x = margin.left + index * columnWidth;
      for (const segment of column) {
        context.fillStyle = segment.color;
        context.fillRect(x, mapY(segment.top), Math.ceil(columnWidth + 0.5), Math.max(1, mapY(segment.bottom) - mapY(segment.top)));
      }
      context.fillStyle = color("--color-plot-film");
      context.fillRect(x, mapY(section.film.top[index]), Math.ceil(columnWidth + 0.5), Math.max(1, mapY(section.film.surface[index]) - mapY(section.film.top[index])));
    });

    const strokeProfile = (values: number[], color: string, lineWidth: number) => {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      values.forEach((z, index) => {
        const x = margin.left + (index + 0.5) * columnWidth;
        if (index === 0) context.moveTo(x, mapY(z)); else context.lineTo(x, mapY(z));
      });
      context.stroke();
    };
    strokeProfile(section.film.surface, color("--color-plot-surface"), 1);
    strokeProfile(section.film.top, color("--color-plot-film"), 2);

    const cursorCanvasX = margin.left + (cursorIndex + 0.5) * columnWidth;
    const cursorSurfaceY = mapY(section.film.surface[cursorIndex]);
    const cursorTopY = mapY(section.film.top[cursorIndex]);
    context.strokeStyle = color("--color-plot-cursor");
    context.setLineDash([6, 5]);
    context.beginPath(); context.moveTo(cursorCanvasX, margin.top); context.lineTo(cursorCanvasX, height - margin.bottom); context.stroke();
    context.setLineDash([]);
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(cursorCanvasX, cursorTopY); context.lineTo(cursorCanvasX, cursorSurfaceY); context.stroke();
    context.fillStyle = color("--color-plot-cursor");
    for (const y of [cursorTopY, cursorSurfaceY]) {
      context.beginPath(); context.arc(cursorCanvasX, y, compact ? 2 : 3, 0, 2 * Math.PI); context.fill();
    }
    const labelWidth = compact ? 70 : 88;
    const labelX = cursorCanvasX + labelWidth + 10 > width - margin.right ? cursorCanvasX - labelWidth - 8 : cursorCanvasX + 8;
    const labelY = Math.max(margin.top + 5, cursorTopY - 23);
    context.fillStyle = color("--color-plot-tooltip");
    context.fillRect(labelX, labelY, labelWidth, compact ? 16 : 20);
    context.fillStyle = color("--color-plot-tooltip-ink");
    context.fillText(`${section.film.localThickness[cursorIndex].toFixed(1)} nm`, labelX + 5, labelY + (compact ? 11 : 14));

    context.fillStyle = color("--color-plot-axis");
    context.textAlign = "center";
    const horizontalTicks = compact ? 2 : 4;
    for (let tick = 0; tick <= horizontalTicks; tick += 1) {
      const x = margin.left + (tick / horizontalTicks) * plotWidth;
      context.fillText(`${(xMin + (tick / horizontalTicks) * viewWidth).toFixed(1)}`, x, height - (compact ? 15 : 23));
    }
    context.textAlign = "left";
    context.fillStyle = color("--color-plot-axis");
    context.fillText("z (nm)", 8, margin.top - 10);
    context.textAlign = "right";
    context.fillText("x (µm)", width - margin.right, height - 4);
    context.textAlign = "left";
    context.fillStyle = color("--color-plot-cursor");
    context.fillText(compact
      ? `y = ${sliceY.toFixed(2)} µm · z ×${verticalExaggeration.toFixed(0)}`
      : `Section y = ${sliceY.toFixed(2)} µm · vertical exaggeration ×${verticalExaggeration.toFixed(0)}`,
    margin.left, 20);
  }, [section, cursorIndex, sliceY, xMin, viewWidth, canvasCssWidth]);

  async function loadGds(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseGds(await file.arrayBuffer());
      const cell = parsed.topCells[0];
      const flattened = flattenGds(parsed, cell);
      const bounds = boundsOf(flattened);
      setTopCell(cell);
      setShapes(flattened);
      setFileName(file.name);
      setCentreX((bounds.minX + bounds.maxX) / 2);
      setSliceY((bounds.minY + bounds.maxY) / 2);
      setViewWidth(Math.max(1, bounds.width));
      const firstLayer = flattened[0].layer;
      setLayers((current) => current.map((layer) => ({ ...layer, gdsLayer: firstLayer })));
      setError("");
      revealResults();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The GDS could not be read.");
    } finally {
      event.target.value = "";
    }
  }

  function loadDemo() {
    setShapes(DEMO_SHAPES);
    setFileName("demo-topography.gds");
    setTopCell("DEMO");
    setSliceY(0);
    setCentreX(0);
    setViewWidth(100);
    setError("");
    revealResults();
  }

  function changeLayer(id: number, patch: Partial<StackLayer>) {
    setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, ...patch } : layer));
  }

  function addLayer() {
    const id = Math.max(0, ...layers.map((layer) => layer.id)) + 1;
    setLayers((current) => [...current, {
      id,
      name: `Layer ${id}`,
      mode: "uniform",
      thicknessNm: 100,
      gdsLayer: availableLayers[0] ?? 1,
      color: COLORS[(id - 1) % COLORS.length],
    }]);
  }

  function applyCoatingPreset(event: ChangeEvent<HTMLSelectElement>) {
    const presets = coatingLibrary === "photoresist" ? PHOTORESIST_PRESETS : METAL_OXIDE_PRESETS;
    const preset = presets.find((item) => item.id === event.target.value);
    setCoatingPresetId(event.target.value);
    if (!preset) return;
    setReferenceThickness(preset.referenceThicknessNm);
    setReferenceRpm(preset.referenceRpm);
    setRpm(preset.referenceRpm);
    setExponent(0.5);
    setShrinkage(0);
  }

  function exportModel() {
    if (!section) return;
    const data = {
      schema: "spincoatsim-model/v2",
      source: { fileName, topCell, sliceYMicrometers: sliceY, centreXMicrometers: centreX, widthMicrometers: viewWidth },
      stack: { substrateThicknessNm: substrateThickness, layers },
      coating: { referencePreset: coatingPreset ? { category: coatingLibrary, id: coatingPreset.id, name: coatingPreset.name, sourceUrl: coatingPreset.sourceUrl } : null, referenceThicknessNm: referenceThickness, referenceRpm, rpm, exponent, shrinkagePercent: shrinkage, levelingStrengthPercent: levelingStrength, levelingLengthMicrometers: levelingLength, predictedFinalThicknessNm: finalThickness },
      result: { minimumThicknessNm: section.film.minimumThicknessNm, meanThicknessNm: section.film.meanThicknessNm, maximumThicknessNm: section.film.maximumThicknessNm, degreeOfPlanarizationPercent: section.film.degreeOfPlanarizationPercent, thicknessNonUniformityPercent: section.film.thicknessNonUniformityPercent },
    };
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "spincoat-model.json");
  }

  function exportPng() {
    canvas.current?.toBlob((blob) => { if (blob) saveBlob(blob, "spincoat-section.png"); }, "image/png");
  }

  const localThickness = section?.film.localThickness[Math.max(0, Math.min(RESOLUTION - 1, cursorIndex))] ?? 0;
  const cursorX = xMin + ((cursorIndex + 0.5) / RESOLUTION) * viewWidth;

  return (
    <main className="spin-app">
      <a className="skip-link" href="#spin-workspace">Skip to coating workspace</a>
      <header className="topbar">
        <a className="brand" href="/spincoatsim/" aria-label="SpinCoatSim home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          SPINCOAT<span>SIM</span>
        </a>
        <p>Spin-coating cross-sections</p>
        <span className="device-pill"><span />Local processing</span>
        <a className="suite-link" href="https://jorpago2.github.io/" aria-label="Online Simulators & Tools">All tools</a>
      </header>

      <section className="spin-tool-heading">
        <div>
          <h1>SpinCoatSim</h1>
          <p>Configure a GDS section, material stack and calibrated coating profile.</p>
        </div>
        <details className="spin-tool-about">
          <summary>Capabilities and model scope</summary>
          <p className="spin-hero-flow">GDS <span>→</span> STACK <span>→</span> FILM PROFILE</p>
          <p>Import a GDS, define the existing stack and inspect a section after spin coating. Thickness follows your measured RPM calibration; topography redistribution uses an area-conserving geometric model.</p>
        </details>
      </section>

      <nav className="spin-mobile-switcher" aria-label="Workspace view">
        <button type="button" aria-pressed={mobilePanel === "controls"} onClick={() => setMobilePanel("controls")}>Configure</button>
        <button type="button" aria-pressed={mobilePanel === "results"} onClick={() => setMobilePanel("results")}>Results</button>
      </nav>

      <section className="spin-workspace" id="spin-workspace" tabIndex={-1} data-mobile-panel={mobilePanel}>
        <aside className="spin-controls">
          <section className="spin-control-section">
            <div className="step-heading"><h2>GDS section</h2></div>
            <p className="spin-file-status" aria-live="polite">{fileName || "No GDS loaded"}</p>
            <button className="spin-upload" onClick={() => fileInput.current?.click()}>Choose a local .gds file</button>
            <button className="spin-example" type="button" onClick={loadDemo}>Load example</button>
            <input ref={fileInput} type="file" accept=".gds,.gdsii" hidden onChange={loadGds} />
            {error && <p className="spin-error" role="alert">{error}</p>}
            <div className="settings-grid spin-fields">
              <label>Section Y <span>µm</span><input type="number" value={sliceY} step="0.1" onChange={(event) => setSliceY(Number(event.target.value))} /></label>
              <label>Centre X <span>µm</span><input type="number" value={centreX} step="0.1" onChange={(event) => setCentreX(Number(event.target.value))} /></label>
              <label className="full-width">Displayed width <span>µm</span><input type="number" value={viewWidth} min="0.1" onChange={(event) => setViewWidth(bounded(Number(event.target.value), viewWidth, 0.1, 1e6))} /></label>
            </div>
            <p className="spin-note">{shapes.length ? `Cell ${topCell} · layers ${availableLayers.join(", ")}. The section currently intersects polygon geometry.` : "Load a GDS or the example to reveal the stack and coating result."}</p>
          </section>

          <details className="spin-control-section spin-disclosure">
            <summary><h2>Existing materials</h2></summary>
            <label className="spin-single-field">Displayed substrate depth <span>nm</span><input type="number" min="10" value={substrateThickness} onChange={(event) => setSubstrateThickness(bounded(Number(event.target.value), substrateThickness, 10, 1e6))} /></label>
            <div className="spin-layer-list">
              {layers.map((layer, index) => <article className="spin-layer" key={layer.id}>
                <div className="spin-layer-head"><i style={{ background: layer.color }} /><b>{index + 1}</b><input aria-label={`Layer ${index + 1} name`} value={layer.name} onChange={(event) => changeLayer(layer.id, { name: event.target.value })} /><button aria-label={`Remove ${layer.name}`} onClick={() => setLayers((current) => current.filter((item) => item.id !== layer.id))}>×</button></div>
                <div className="spin-layer-fields">
                  <label>Operation<select value={layer.mode} onChange={(event) => changeLayer(layer.id, { mode: event.target.value as LayerMode })}><option value="uniform">Uniform deposit</option><option value="patterned">Patterned deposit</option><option value="etch">Etch into stack</option></select></label>
                  <label>{layer.mode === "etch" ? "Depth" : "Thickness"}<input type="number" min="1" value={layer.thicknessNm} onChange={(event) => changeLayer(layer.id, { thicknessNm: bounded(Number(event.target.value), layer.thicknessNm, 1, 1e6) })} /></label>
                  {layer.mode !== "uniform" && <label>GDS layer<select value={layer.gdsLayer} onChange={(event) => changeLayer(layer.id, { gdsLayer: Number(event.target.value) })}>{availableLayers.map((number) => <option key={number} value={number}>{number}</option>)}</select></label>}
                </div>
              </article>)}
            </div>
            <button className="spin-add" onClick={addLayer}>+ Add process layer</button>
          </details>

          <details className="spin-control-section spin-disclosure">
            <summary><h2>Calibrated film</h2></summary>
            <div className="settings-grid spin-fields">
              <label className="full-width">Coating library<select value={coatingLibrary} onChange={(event) => { setCoatingLibrary(event.target.value as "photoresist" | "oxide"); setCoatingPresetId(""); }}><option value="photoresist">Photoresists</option><option value="oxide">Metal oxides</option></select></label>
              {coatingLibrary === "photoresist" ? <>
                <label>Polarity<select value={photoresistPolarity} onChange={(event) => { setPhotoresistPolarity(event.target.value); setCoatingPresetId(""); }}><option value="">All polarities</option>{PHOTORESIST_POLARITIES.map((polarity) => <option key={polarity} value={polarity}>{polarity}</option>)}</select></label>
                <label>Brand<select value={photoresistManufacturer} onChange={(event) => { setPhotoresistManufacturer(event.target.value); setCoatingPresetId(""); }}><option value="">All brands</option>{PHOTORESIST_MANUFACTURERS.map((manufacturer) => <option key={manufacturer} value={manufacturer}>{manufacturer}</option>)}</select></label>
                <label className="full-width">Exposure<select value={photoresistExposureNm} onChange={(event) => { setPhotoresistExposureNm(event.target.value); setCoatingPresetId(""); }}><option value="">All wavelengths</option>{PHOTORESIST_EXPOSURE_WAVELENGTHS.map((wavelength) => <option key={wavelength} value={wavelength}>≈{wavelength} nm (h-line)</option>)}</select></label>
              </> : <label className="full-width">Oxide<select value={metalOxideFamily} onChange={(event) => { setMetalOxideFamily(event.target.value); setCoatingPresetId(""); }}><option value="">All oxides</option>{METAL_OXIDE_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}</select></label>}
              <label className="full-width">Reference process <span>{filteredCoatings.length}/{coatingLibrarySize}</span><select value={coatingPresetId} onChange={applyCoatingPreset}><option value="">Custom calibration</option>{coatingLibrary === "photoresist" ? filteredPhotoresists.map((preset) => <option key={preset.id} value={preset.id}>{preset.manufacturer} · {preset.name} · {preset.referenceThicknessNm / 1000} µm @ {preset.referenceRpm} rpm</option>) : filteredMetalOxides.map((preset) => <option key={preset.id} value={preset.id}>{preset.family} · {preset.name} · {preset.referenceThicknessNm} nm @ {preset.referenceRpm} rpm</option>)}</select></label>
              <label>Film thickness <span>nm</span><input type="number" min="1" value={referenceThickness} onChange={(event) => setReferenceThickness(bounded(Number(event.target.value), referenceThickness, 1, 1e6))} /></label>
              <label>Reference speed <span>rpm</span><input type="number" min="1" value={referenceRpm} onChange={(event) => setReferenceRpm(bounded(Number(event.target.value), referenceRpm, 1, 100000))} /></label>
              <label>Simulated speed <span>rpm</span><input type="number" min="1" value={rpm} onChange={(event) => setRpm(bounded(Number(event.target.value), rpm, 1, 100000))} /></label>
              <label>Exponent n<input type="number" min="0" max="2" step="0.05" value={exponent} onChange={(event) => setExponent(bounded(Number(event.target.value), exponent, 0, 2))} /></label>
              <label>Shrinkage <span>%</span><input type="number" min="0" max="95" value={shrinkage} onChange={(event) => setShrinkage(bounded(Number(event.target.value), shrinkage, 0, 95))} /></label>
              <label>Leveling strength <span>{levelingStrength}%</span><input className="spin-range" type="range" min="0" max="100" value={levelingStrength} onChange={(event) => setLevelingStrength(Number(event.target.value))} /></label>
              <label className="full-width">Lateral leveling length <span>µm</span><input type="number" min="0" step="0.5" value={levelingLength} onChange={(event) => setLevelingLength(bounded(Number(event.target.value), levelingLength, 0, 1e6))} /></label>
            </div>
            {photoresistPreset && <aside className="spin-reference" aria-live="polite"><b>{photoresistPreset.name} · {photoresistPreset.tone}</b>{photoresistPreset.exposureWavelengthsNm && <span>Verified exposure lines: {photoresistPreset.exposureWavelengthsNm.join(", ")} nm.</span>}<span>{photoresistPreset.evidence}. Loaded with generic n = 0.5 and 0% additional shrinkage.</span><a href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a></aside>}
            {metalOxidePreset && <aside className="spin-reference" aria-live="polite"><b>{metalOxidePreset.family} · {metalOxidePreset.name}</b><span>{metalOxidePreset.precursor} on {metalOxidePreset.substrate}. {metalOxidePreset.cycles} coat(s), {metalOxidePreset.spinSeconds} s; {metalOxidePreset.thermalTreatment}. {metalOxidePreset.phase}.</span><span>{metalOxidePreset.evidence}. The loaded value is the published final dry thickness; n = 0.5 remains a generic extrapolation.</span><a href={metalOxidePreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a></aside>}
            <p className="spin-equation">h = {referenceThickness} · ({rpm}/{referenceRpm})<sup>−{exponent}</sup> · (1 − {shrinkage}/100)</p>
            <p className="spin-note">Library values are starting points, not guaranteed recipes. Refit thickness, exponent and leveling to your spinner, substrate and ambient conditions.</p>
          </details>
        </aside>

        <section className="spin-preview" aria-label="Coating results">
          <div className="spin-preview-head">
            <div aria-live="polite"><h2 ref={resultHeading} tabIndex={-1}>{fileName || "No profile yet"}</h2></div>
            {section && <div className="spin-actions"><button onClick={exportPng}>Export PNG</button><button onClick={exportModel}>Export JSON</button></div>}
          </div>
          {section ? <>
          <canvas
            ref={canvas}
            width={1200}
            height={650}
            className="spin-canvas"
            aria-label="Simulated material stack cross-section and spin-coated film"
            aria-describedby="spin-readout"
            tabIndex={0}
            onPointerMove={(event) => {
              const rectangle = event.currentTarget.getBoundingClientRect();
              setCursorIndex(Math.max(0, Math.min(RESOLUTION - 1, Math.floor(((event.clientX - rectangle.left) / rectangle.width) * RESOLUTION))));
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              setCursorIndex((index) => Math.max(0, Math.min(RESOLUTION - 1, index + (event.key === "ArrowLeft" ? -step : step))));
            }}
          />
          <div className="spin-readout" id="spin-readout"><span>x = {cursorX.toFixed(2)} µm</span><strong>{localThickness.toFixed(1)} nm local coating</strong></div>

          <div className="spin-metrics">
            <article><p>CALIBRATED DRY FILM</p><strong>{dryThickness.toFixed(1)} nm</strong></article>
            <article><p>AFTER SHRINKAGE</p><strong>{finalThickness.toFixed(1)} nm</strong></article>
            <article><p>LOCAL RANGE</p><strong>{section.film.minimumThicknessNm.toFixed(1)}–{section.film.maximumThicknessNm.toFixed(1)} nm</strong></article>
            <article><p>MEAN / MASS CHECK</p><strong>{section.film.meanThicknessNm.toFixed(1)} nm</strong></article>
            <article><p>PLANARIZATION (DOP)</p><strong>{section.film.degreeOfPlanarizationPercent.toFixed(1)}%</strong></article>
            <article><p>THICKNESS NON-UNIFORMITY</p><strong>{section.film.thicknessNonUniformityPercent.toFixed(1)}%</strong></article>
          </div>

          <div className="spin-legend">
            <span><i style={{ background: "#5c6570" }} />Substrate</span>
            {layers.filter((layer) => layer.mode !== "etch").map((layer) => <span key={layer.id}><i style={{ background: layer.color }} />{layer.name}</span>)}
            <span><i style={{ background: "#ff5a1f" }} />Spin-coated {metalOxidePreset?.family ?? "film"}</span>
          </div>

          <details className="spin-validity">
            <summary>Model boundary</summary>
            <p>RPM scaling is empirical and should be fitted to your sol. The profile applies finite-range Gaussian leveling and conserves coating area; it is a reduced geometric surrogate, not a solution of centrifugal flow, capillarity, solvent evaporation, edge bead, dewetting or gel chemistry.</p>
            {section.ignoredPaths > 0 && <p className="spin-warning">{section.ignoredPaths} PATH element(s) cross the selected process layers and are omitted from this section.</p>}
          </details>
          </> : <div className="spin-empty-state"><strong>No coating profile yet</strong><p>Load a GDS file or use the example to calculate and display the cross-section.</p><button type="button" onClick={loadDemo}>Load example</button></div>}
        </section>
      </section>
    </main>
  );
}
