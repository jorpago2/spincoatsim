"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, flattenGds, parseGds } from "@/lib/gds.js";
import { PHOTORESIST_PRESETS } from "@/lib/photoresists.js";
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
  const [shapes, setShapes] = useState<GdsShape[]>(DEMO_SHAPES);
  const [fileName, setFileName] = useState("demo-topography.gds");
  const [topCell, setTopCell] = useState("DEMO");
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
  const [photoresistPresetId, setPhotoresistPresetId] = useState("");
  const [shrinkage, setShrinkage] = useState(25);
  const [levelingStrength, setLevelingStrength] = useState(65);
  const [levelingLength, setLevelingLength] = useState(8);
  const [cursorIndex, setCursorIndex] = useState(Math.floor(RESOLUTION / 2));
  const [canvasCssWidth, setCanvasCssWidth] = useState(1200);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setCanvasCssWidth(Math.max(1, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const availableLayers = useMemo(() => [...new Set(shapes.map((shape) => shape.layer))].sort((a, b) => a - b), [shapes]);
  const photoresistPreset = PHOTORESIST_PRESETS.find((preset) => preset.id === photoresistPresetId);
  const xMin = centreX - viewWidth / 2;
  const xMax = centreX + viewWidth / 2;
  const dryThickness = calibratedThickness(referenceThickness, referenceRpm, rpm, exponent);
  const finalThickness = dryThickness * (1 - shrinkage / 100);

  const section = useMemo<SectionResult>(() => {
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
    if (!element) return;
    const width = canvasCssWidth;
    const height = Math.round(width * 650 / 1200);
    const pixelRatio = window.devicePixelRatio || 1;
    element.width = Math.round(width * pixelRatio);
    element.height = Math.round(height * pixelRatio);
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#07100d";
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

    context.strokeStyle = "rgba(217,255,67,.12)";
    context.lineWidth = 1;
    context.font = `${compact ? 9 : 12}px monospace`;
    context.fillStyle = "#87928a";
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
      context.fillStyle = "rgba(255,90,31,.82)";
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
    strokeProfile(section.film.surface, "#dce8e2", 1);
    strokeProfile(section.film.top, "#ffb08f", 2);

    const cursorCanvasX = margin.left + (cursorIndex + 0.5) * columnWidth;
    const cursorSurfaceY = mapY(section.film.surface[cursorIndex]);
    const cursorTopY = mapY(section.film.top[cursorIndex]);
    context.strokeStyle = "#d9ff43";
    context.setLineDash([6, 5]);
    context.beginPath(); context.moveTo(cursorCanvasX, margin.top); context.lineTo(cursorCanvasX, height - margin.bottom); context.stroke();
    context.setLineDash([]);
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(cursorCanvasX, cursorTopY); context.lineTo(cursorCanvasX, cursorSurfaceY); context.stroke();
    context.fillStyle = "#d9ff43";
    for (const y of [cursorTopY, cursorSurfaceY]) {
      context.beginPath(); context.arc(cursorCanvasX, y, compact ? 2 : 3, 0, 2 * Math.PI); context.fill();
    }
    const labelWidth = compact ? 70 : 88;
    const labelX = cursorCanvasX + labelWidth + 10 > width - margin.right ? cursorCanvasX - labelWidth - 8 : cursorCanvasX + 8;
    const labelY = Math.max(margin.top + 5, cursorTopY - 23);
    context.fillStyle = "rgba(7,16,13,.9)";
    context.fillRect(labelX, labelY, labelWidth, compact ? 16 : 20);
    context.fillStyle = "#d9ff43";
    context.fillText(`${section.film.localThickness[cursorIndex].toFixed(1)} nm`, labelX + 5, labelY + (compact ? 11 : 14));

    context.fillStyle = "#87928a";
    context.textAlign = "center";
    const horizontalTicks = compact ? 2 : 4;
    for (let tick = 0; tick <= horizontalTicks; tick += 1) {
      const x = margin.left + (tick / horizontalTicks) * plotWidth;
      context.fillText(`${(xMin + (tick / horizontalTicks) * viewWidth).toFixed(1)}`, x, height - (compact ? 15 : 23));
    }
    context.textAlign = "left";
    context.fillStyle = "#87928a";
    context.fillText("z (nm)", 8, margin.top - 10);
    context.textAlign = "right";
    context.fillText("x (µm)", width - margin.right, height - 4);
    context.textAlign = "left";
    context.fillStyle = "#d9ff43";
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The GDS could not be read.");
    } finally {
      event.target.value = "";
    }
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

  function applyPhotoresistPreset(event: ChangeEvent<HTMLSelectElement>) {
    const preset = PHOTORESIST_PRESETS.find((item) => item.id === event.target.value);
    setPhotoresistPresetId(event.target.value);
    if (!preset) return;
    setReferenceThickness(preset.referenceThicknessNm);
    setReferenceRpm(preset.referenceRpm);
    setRpm(preset.referenceRpm);
    setExponent(0.5);
    setShrinkage(0);
  }

  function exportModel() {
    const data = {
      schema: "spincoatsim-model/v2",
      source: { fileName, topCell, sliceYMicrometers: sliceY, centreXMicrometers: centreX, widthMicrometers: viewWidth },
      stack: { substrateThicknessNm: substrateThickness, layers },
      coating: { referencePreset: photoresistPreset ? { id: photoresistPreset.id, manufacturer: photoresistPreset.manufacturer, name: photoresistPreset.name, sourceUrl: photoresistPreset.sourceUrl } : null, referenceThicknessNm: referenceThickness, referenceRpm, rpm, exponent, shrinkagePercent: shrinkage, levelingStrengthPercent: levelingStrength, levelingLengthMicrometers: levelingLength, predictedFinalThicknessNm: finalThickness },
      result: { minimumThicknessNm: section.film.minimumThicknessNm, meanThicknessNm: section.film.meanThicknessNm, maximumThicknessNm: section.film.maximumThicknessNm, degreeOfPlanarizationPercent: section.film.degreeOfPlanarizationPercent, thicknessNonUniformityPercent: section.film.thicknessNonUniformityPercent },
    };
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "spincoat-model.json");
  }

  function exportPng() {
    canvas.current?.toBlob((blob) => { if (blob) saveBlob(blob, "spincoat-section.png"); }, "image/png");
  }

  const localThickness = section.film.localThickness[Math.max(0, Math.min(RESOLUTION - 1, cursorIndex))];
  const cursorX = xMin + ((cursorIndex + 0.5) / RESOLUTION) * viewWidth;

  return (
    <main className="spin-app">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="SpinCoatSim home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          SPINCOAT<span>SIM</span>
        </Link>
        <p>GDS cross-section · calibrated geometric model</p>
        <span className="device-pill"><span />Local processing</span>
      </header>

      <section className="spin-hero">
        <div>
          <p className="eyebrow">PROCESS EMULATION / SOL–GEL</p>
          <h1>See where the <em>coating</em> goes.</h1>
        </div>
        <p>Import a GDS, define the existing stack and inspect a section after spin coating. Thickness follows your measured RPM calibration; topography redistribution is an area-conserving geometric approximation.</p>
      </section>

      <section className="spin-workspace">
        <aside className="spin-controls">
          <section className="spin-control-section">
            <div className="step-heading"><span>01</span><div><p>GEOMETRY</p><h2>GDS section</h2></div></div>
            <button className="spin-upload" onClick={() => fileInput.current?.click()}>
              <b>{fileName}</b><span>Choose a local .gds file</span>
            </button>
            <input ref={fileInput} type="file" accept=".gds,.gdsii" hidden onChange={loadGds} />
            {error && <p className="spin-error" role="alert">{error}</p>}
            <div className="settings-grid spin-fields">
              <label>Section Y <span>µm</span><input type="number" value={sliceY} step="0.1" onChange={(event) => setSliceY(Number(event.target.value))} /></label>
              <label>Centre X <span>µm</span><input type="number" value={centreX} step="0.1" onChange={(event) => setCentreX(Number(event.target.value))} /></label>
              <label className="full-width">Displayed width <span>µm</span><input type="number" value={viewWidth} min="0.1" onChange={(event) => setViewWidth(bounded(Number(event.target.value), viewWidth, 0.1, 1e6))} /></label>
            </div>
            <p className="spin-note">Cell {topCell} · layers {availableLayers.join(", ") || "none"}. The section currently intersects polygon geometry.</p>
          </section>

          <section className="spin-control-section">
            <div className="step-heading"><span>02</span><div><p>STACK</p><h2>Existing materials</h2></div></div>
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
          </section>

          <section className="spin-control-section">
            <div className="step-heading"><span>03</span><div><p>SPIN COATING</p><h2>Calibrated film</h2></div></div>
            <div className="settings-grid spin-fields">
              <label className="full-width">Photoresist reference<select value={photoresistPresetId} onChange={applyPhotoresistPreset}><option value="">Custom calibration</option>{PHOTORESIST_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.manufacturer} · {preset.name} · {preset.referenceThicknessNm / 1000} µm @ {preset.referenceRpm} rpm</option>)}</select></label>
              <label>Film thickness <span>nm</span><input type="number" min="1" value={referenceThickness} onChange={(event) => setReferenceThickness(bounded(Number(event.target.value), referenceThickness, 1, 1e6))} /></label>
              <label>Reference speed <span>rpm</span><input type="number" min="1" value={referenceRpm} onChange={(event) => setReferenceRpm(bounded(Number(event.target.value), referenceRpm, 1, 100000))} /></label>
              <label>Simulated speed <span>rpm</span><input type="number" min="1" value={rpm} onChange={(event) => setRpm(bounded(Number(event.target.value), rpm, 1, 100000))} /></label>
              <label>Exponent n<input type="number" min="0" max="2" step="0.05" value={exponent} onChange={(event) => setExponent(bounded(Number(event.target.value), exponent, 0, 2))} /></label>
              <label>Shrinkage <span>%</span><input type="number" min="0" max="95" value={shrinkage} onChange={(event) => setShrinkage(bounded(Number(event.target.value), shrinkage, 0, 95))} /></label>
              <label>Leveling strength <span>{levelingStrength}%</span><input className="spin-range" type="range" min="0" max="100" value={levelingStrength} onChange={(event) => setLevelingStrength(Number(event.target.value))} /></label>
              <label className="full-width">Lateral leveling length <span>µm</span><input type="number" min="0" step="0.5" value={levelingLength} onChange={(event) => setLevelingLength(bounded(Number(event.target.value), levelingLength, 0, 1e6))} /></label>
            </div>
            {photoresistPreset && <aside className="spin-reference" aria-live="polite"><b>{photoresistPreset.name} · {photoresistPreset.tone}</b><span>{photoresistPreset.evidence}. Loaded with generic n = 0.5 and 0% additional shrinkage.</span><a href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a></aside>}
            <p className="spin-equation">h = {referenceThickness} · ({rpm}/{referenceRpm})<sup>−{exponent}</sup> · (1 − {shrinkage}/100)</p>
            <p className="spin-note">Library values are starting points, not guaranteed recipes. Refit thickness, exponent and leveling to your spinner, substrate and ambient conditions.</p>
          </section>
        </aside>

        <section className="spin-preview">
          <div className="spin-preview-head">
            <div><p>LIVE CROSS-SECTION</p><h2>{fileName}</h2></div>
            <div className="spin-actions"><button onClick={exportPng}>Export PNG</button><button onClick={exportModel}>Export JSON</button></div>
          </div>
          <canvas
            ref={canvas}
            width={1200}
            height={650}
            className="spin-canvas"
            aria-label="Simulated material stack cross-section and spin-coated film"
            onMouseMove={(event) => {
              const rectangle = event.currentTarget.getBoundingClientRect();
              setCursorIndex(Math.max(0, Math.min(RESOLUTION - 1, Math.floor(((event.clientX - rectangle.left) / rectangle.width) * RESOLUTION))));
            }}
          />
          <div className="spin-readout"><span>x = {cursorX.toFixed(2)} µm</span><strong>{localThickness.toFixed(1)} nm local coating</strong></div>

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
            <span><i style={{ background: "#ff5a1f" }} />Spin-coated sol–gel</span>
          </div>

          <aside className="spin-validity">
            <b>Model boundary</b>
            <p>RPM scaling is empirical and should be fitted to your sol. The profile applies finite-range Gaussian leveling and conserves coating area; it is a reduced geometric surrogate, not a solution of centrifugal flow, capillarity, solvent evaporation, edge bead, dewetting or gel chemistry.</p>
            {section.ignoredPaths > 0 && <p className="spin-warning">{section.ignoredPaths} PATH element(s) cross the selected process layers and are omitted from this section.</p>}
          </aside>
        </section>
      </section>
    </main>
  );
}
