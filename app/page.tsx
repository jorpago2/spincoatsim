"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, flattenGds, parseGds } from "@/lib/gds.js";
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
    { id: 1, name: "SiOâ‚‚", mode: "uniform", thicknessNm: 300, gdsLayer: 1, color: "#75b9c8" },
    { id: 2, name: "Ti/Au", mode: "patterned", thicknessNm: 120, gdsLayer: 1, color: "#f0b84a" },
  ]);
  const [referenceThickness, setReferenceThickness] = useState(180);
  const [referenceRpm, setReferenceRpm] = useState(3000);
  const [rpm, setRpm] = useState(3000);
  const [exponent, setExponent] = useState(0.5);
  const [shrinkage, setShrinkage] = useState(25);
  const [planarization, setPlanarization] = useState(65);
  const [cursorIndex, setCursorIndex] = useState(Math.floor(RESOLUTION / 2));
  const [error, setError] = useState("");

  useEffect(() => { document.title = "SpinCoatSim Â· GDS cross-section coating model"; }, []);

  const availableLayers = useMemo(() => [...new Set(shapes.map((shape) => shape.layer))].sort((a, b) => a - b), [shapes]);
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
      film: buildSpinFilm(columns, finalThickness, planarization / 100),
      ignoredPaths: slices.reduce((sum, slice) => sum + slice.ignoredPaths, 0),
    };
  }, [shapes, layers, sliceY, xMin, xMax, substrateThickness, finalThickness, planarization]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const width = 1200;
    const height = 650;
    element.width = width;
    element.height = height;
    const context = element.getContext("2d");
    if (!context) return;
    context.fillStyle = "#07100d";
    context.fillRect(0, 0, width, height);

    const margin = { left: 76, right: 30, top: 38, bottom: 55 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const allBottoms = section.columns.flatMap((column) => column.map((segment) => segment.bottom));
    const minZ = Math.min(...allBottoms);
    const maxZ = Math.max(...section.film.top) * 1.12 + 20;
    const mapY = (z: number) => margin.top + ((maxZ - z) / (maxZ - minZ)) * plotHeight;
    const columnWidth = plotWidth / RESOLUTION;

    context.strokeStyle = "rgba(217,255,67,.12)";
    context.lineWidth = 1;
    context.font = "12px monospace";
    context.fillStyle = "#87928a";
    for (let tick = 0; tick <= 5; tick += 1) {
      const y = margin.top + (tick / 5) * plotHeight;
      const z = maxZ - (tick / 5) * (maxZ - minZ);
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke();
      context.fillText(`${Math.round(z)} nm`, 8, y + 4);
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

    context.strokeStyle = "#ffb08f";
    context.lineWidth = 2;
    context.beginPath();
    section.film.top.forEach((z, index) => {
      const x = margin.left + (index + 0.5) * columnWidth;
      if (index === 0) context.moveTo(x, mapY(z)); else context.lineTo(x, mapY(z));
    });
    context.stroke();

    const cursorX = margin.left + (cursorIndex + 0.5) * columnWidth;
    context.strokeStyle = "#d9ff43";
    context.setLineDash([6, 5]);
    context.beginPath(); context.moveTo(cursorX, margin.top); context.lineTo(cursorX, height - margin.bottom); context.stroke();
    context.setLineDash([]);

    context.fillStyle = "#87928a";
    context.textAlign = "center";
    for (let tick = 0; tick <= 4; tick += 1) {
      const x = margin.left + (tick / 4) * plotWidth;
      context.fillText(`${(xMin + (tick / 4) * viewWidth).toFixed(1)} Âµm`, x, height - 23);
    }
    context.textAlign = "left";
    context.fillStyle = "#d9ff43";
    context.fillText(`Vertical scale exaggerated Â· section y = ${sliceY.toFixed(2)} Âµm`, margin.left, 22);
  }, [section, cursorIndex, sliceY, xMin, viewWidth]);

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

  function exportModel() {
    const data = {
      schema: "spincoatsim-model/v1",
      source: { fileName, topCell, sliceYMicrometers: sliceY, centreXMicrometers: centreX, widthMicrometers: viewWidth },
      stack: { substrateThicknessNm: substrateThickness, layers },
      coating: { referenceThicknessNm: referenceThickness, referenceRpm, rpm, exponent, shrinkagePercent: shrinkage, planarizationPercent: planarization, predictedFinalThicknessNm: finalThickness },
      result: { minimumThicknessNm: section.film.minimumThicknessNm, meanThicknessNm: section.film.meanThicknessNm, maximumThicknessNm: section.film.maximumThicknessNm },
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
        <p>GDS cross-section Â· calibrated geometric model</p>
        <span className="device-pill"><span />Local processing</span>
      </header>

      <section className="spin-hero">
        <div>
          <p className="eyebrow">PROCESS EMULATION / SOLâ€“GEL</p>
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
              <label>Section Y <span>Âµm</span><input type="number" value={sliceY} step="0.1" onChange={(event) => setSliceY(Number(event.target.value))} /></label>
              <label>Centre X <span>Âµm</span><input type="number" value={centreX} step="0.1" onChange={(event) => setCentreX(Number(event.target.value))} /></label>
              <label className="full-width">Displayed width <span>Âµm</span><input type="number" value={viewWidth} min="0.1" onChange={(event) => setViewWidth(bounded(Number(event.target.value), viewWidth, 0.1, 1e6))} /></label>
            </div>
            <p className="spin-note">Cell {topCell} Â· layers {availableLayers.join(", ") || "none"}. The section currently intersects polygon geometry.</p>
          </section>

          <section className="spin-control-section">
            <div className="step-heading"><span>02</span><div><p>STACK</p><h2>Existing materials</h2></div></div>
            <label className="spin-single-field">Displayed substrate depth <span>nm</span><input type="number" min="10" value={substrateThickness} onChange={(event) => setSubstrateThickness(bounded(Number(event.target.value), substrateThickness, 10, 1e6))} /></label>
            <div className="spin-layer-list">
              {layers.map((layer, index) => <article className="spin-layer" key={layer.id}>
                <div className="spin-layer-head"><i style={{ background: layer.color }} /><b>{index + 1}</b><input aria-label={`Layer ${index + 1} name`} value={layer.name} onChange={(event) => changeLayer(layer.id, { name: event.target.value })} /><button aria-label={`Remove ${layer.name}`} onClick={() => setLayers((current) => current.filter((item) => item.id !== layer.id))}>Ã—</button></div>
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
              <label>Measured thickness <span>nm</span><input type="number" min="1" value={referenceThickness} onChange={(event) => setReferenceThickness(bounded(Number(event.target.value), referenceThickness, 1, 1e6))} /></label>
              <label>Reference speed <span>rpm</span><input type="number" min="1" value={referenceRpm} onChange={(event) => setReferenceRpm(bounded(Number(event.target.value), referenceRpm, 1, 100000))} /></label>
              <label>Simulated speed <span>rpm</span><input type="number" min="1" value={rpm} onChange={(event) => setRpm(bounded(Number(event.target.value), rpm, 1, 100000))} /></label>
              <label>Exponent n<input type="number" min="0" max="2" step="0.05" value={exponent} onChange={(event) => setExponent(bounded(Number(event.target.value), exponent, 0, 2))} /></label>
              <label>Shrinkage <span>%</span><input type="number" min="0" max="95" value={shrinkage} onChange={(event) => setShrinkage(bounded(Number(event.target.value), shrinkage, 0, 95))} /></label>
              <label>Planarization <span>{planarization}%</span><input className="spin-range" type="range" min="0" max="100" value={planarization} onChange={(event) => setPlanarization(Number(event.target.value))} /></label>
            </div>
            <p className="spin-equation">h = {referenceThickness} Â· ({rpm}/{referenceRpm})<sup>âˆ’{exponent}</sup> Â· (1 âˆ’ {shrinkage}/100)</p>
          </section>
        </aside>

        <section className="spin-preview">
          <div className="spin-preview-head">
            <div><p>LIVE CROSS-SECTION</p><h2>{fileName}</h2></div>
            <div className="spin-actions"><button onClick={exportPng}>Export PNG</button><button onClick={exportModel}>Export JSON</button></div>
          </div>
          <canvas
            ref={canvas}
            className="spin-canvas"
            aria-label="Simulated material stack cross-section and spin-coated film"
            onMouseMove={(event) => {
              const rectangle = event.currentTarget.getBoundingClientRect();
              setCursorIndex(Math.max(0, Math.min(RESOLUTION - 1, Math.floor(((event.clientX - rectangle.left) / rectangle.width) * RESOLUTION))));
            }}
          />
          <div className="spin-readout"><span>x = {cursorX.toFixed(2)} Âµm</span><strong>{localThickness.toFixed(1)} nm local coating</strong></div>

          <div className="spin-metrics">
            <article><p>CALIBRATED DRY FILM</p><strong>{dryThickness.toFixed(1)} nm</strong></article>
            <article><p>AFTER SHRINKAGE</p><strong>{finalThickness.toFixed(1)} nm</strong></article>
            <article><p>LOCAL RANGE</p><strong>{section.film.minimumThicknessNm.toFixed(1)}â€“{section.film.maximumThicknessNm.toFixed(1)} nm</strong></article>
            <article><p>MEAN / MASS CHECK</p><strong>{section.film.meanThicknessNm.toFixed(1)} nm</strong></article>
          </div>

          <div className="spin-legend">
            <span><i style={{ background: "#5c6570" }} />Substrate</span>
            {layers.filter((layer) => layer.mode !== "etch").map((layer) => <span key={layer.id}><i style={{ background: layer.color }} />{layer.name}</span>)}
            <span><i style={{ background: "#ff5a1f" }} />Spin-coated solâ€“gel</span>
          </div>

          <aside className="spin-validity">
            <b>Model boundary</b>
            <p>RPM scaling is empirical and should be fitted to your sol. Planarization interpolates geometrically between conformal coverage and a level free surface while conserving coating area; it does not solve solvent evaporation, capillary edge bead, dewetting or gel chemistry.</p>
            {section.ignoredPaths > 0 && <p className="spin-warning">{section.ignoredPaths} PATH element(s) cross the selected process layers and are omitted from this section.</p>}
          </aside>
        </section>
      </section>
    </main>
  );
}
