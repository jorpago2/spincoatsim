"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Column,
  FileUploaderButton,
  Grid,
  Header,
  HeaderName,
  IconButton,
  Layer,
  Link,
  NumberInput,
  Select,
  SelectItem,
  Slider,
  TextInput,
  Tile,
} from "@carbon/react";
import { Add, Chemistry, Close, Document, Layers, TrashCan } from "@carbon/react/icons";
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
type ToolPanel = "input" | "stack" | "coating";
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

type NumberFieldProps = {
  id: string;
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValue: (value: number) => void;
};

function NumberField({ id, label, unit, value, min, max, step, onValue }: NumberFieldProps) {
  return <NumberInput
    id={id}
    label={`${label}${unit ? ` (${unit})` : ""}`}
    value={value}
    min={min}
    max={max}
    step={step}
    size="md"
    disableWheel
    onChange={(_, state) => onValue(Number(state.value))}
  />;
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
  const [activePanel, setActivePanel] = useState<ToolPanel | null>(null);

  const revealResults = () => {
    setActivePanel(null);
    requestAnimationFrame(() => {
      resultHeading.current?.focus();
    });
  };

  const closePanel = () => {
    const panel = activePanel;
    setActivePanel(null);
    requestAnimationFrame(() => document.getElementById(`spin-nav-${panel}`)?.focus());
  };

  const togglePanel = (panel: ToolPanel) => setActivePanel((current) => current === panel ? null : panel);

  useEffect(() => {
    if (!activePanel) return;
    const panel = activePanel;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActivePanel(null);
      requestAnimationFrame(() => document.getElementById(`spin-nav-${panel}`)?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [activePanel]);

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
    <Grid as="main" fullWidth condensed className="spin-app">
      <Column sm={4} md={8} lg={16} className="spin-app-column">
      <a className="skip-link" href="#spin-workspace">Skip to coating workspace</a>
      <Header className="topbar" aria-label="SpinCoatSim">
        <HeaderName className="brand" prefix="" href="/spincoatsim/">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          SPINCOAT<span>SIM</span>
        </HeaderName>
        <div className="spin-header-context" aria-label="Current model"><p>{fileName || "No GDS loaded"}</p></div>
        <div className="spin-header-actions"><Link className="suite-link" href="https://jorpago2.github.io/">All tools</Link></div>
      </Header>
      <h1 className="visually-hidden">SpinCoatSim spin-coating cross-section simulator</h1>

      <nav className="spin-navigation" aria-label="Configuration tools">
        <Button id="spin-nav-input" kind="ghost" size="lg" renderIcon={Document} aria-controls="spin-tool-panel" aria-expanded={activePanel === "input"} className={activePanel === "input" ? "active" : ""} onClick={() => togglePanel("input")}>Input</Button>
        <Button id="spin-nav-stack" kind="ghost" size="lg" renderIcon={Layers} aria-controls="spin-tool-panel" aria-expanded={activePanel === "stack"} className={activePanel === "stack" ? "active" : ""} onClick={() => togglePanel("stack")}>Stack</Button>
        <Button id="spin-nav-coating" kind="ghost" size="lg" renderIcon={Chemistry} aria-controls="spin-tool-panel" aria-expanded={activePanel === "coating"} className={activePanel === "coating" ? "active" : ""} onClick={() => togglePanel("coating")}>Coating</Button>
      </nav>

      <section className="spin-workspace" id="spin-workspace" tabIndex={-1} data-panel-open={Boolean(activePanel)}>
        {activePanel && <><div className="spin-panel-scrim" aria-hidden="true" /><Layer as="aside" withBackground className="spin-controls" id="spin-tool-panel" aria-labelledby="spin-panel-title">
          <div className="spin-panel-head">
            <div><p>Configuration</p><h2 id="spin-panel-title">{activePanel === "input" ? "GDS section" : activePanel === "stack" ? "Existing materials" : "Calibrated film"}</h2></div>
            <IconButton className="spin-panel-close" kind="ghost" size="lg" label="Close configuration panel" onClick={closePanel}><Close size={20} /></IconButton>
          </div>
          <div className={`spin-panel-body${activePanel === "stack" ? " spin-panel-body--stack" : ""}`} key={activePanel}>
          {activePanel === "input" && <section className="spin-control-section">
            <Tile className="spin-file-status" aria-live="polite">{fileName || "No GDS loaded"}</Tile>
            <FileUploaderButton id="spin-gds-upload" className="spin-upload" accept={[".gds", ".gdsii"]} buttonKind="tertiary" size="md" labelText="Choose a local .gds file" onChange={loadGds} />
            <Button className="spin-example" kind="secondary" size="md" onClick={loadDemo}>Load example</Button>
            {error && <p className="spin-error" role="alert">{error}</p>}
            <Grid condensed className="spin-fields">
              <Column sm={4} md={4} lg={8}><NumberField id="section-y" label="Section Y" unit="µm" value={sliceY} min={-1e6} max={1e6} step={0.1} onValue={setSliceY} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="centre-x" label="Centre X" unit="µm" value={centreX} min={-1e6} max={1e6} step={0.1} onValue={setCentreX} /></Column>
              <Column sm={4} md={8} lg={16}><NumberField id="displayed-width" label="Displayed width" unit="µm" value={viewWidth} min={0.1} max={1e6} step={0.1} onValue={(value) => setViewWidth(bounded(value, viewWidth, 0.1, 1e6))} /></Column>
            </Grid>
            <p className="spin-note">{shapes.length ? `Cell ${topCell} · layers ${availableLayers.join(", ")}. The section currently intersects polygon geometry.` : "Load a GDS or the example to reveal the stack and coating result."}</p>
            <Accordion align="start" size="sm" className="spin-tool-about">
              <AccordionItem title="Capabilities and model scope">
                <p className="spin-hero-flow">GDS <span>→</span> STACK <span>→</span> FILM PROFILE</p>
                <p>Import a GDS, define the existing stack and inspect a section after spin coating. Thickness follows your measured RPM calibration; topography redistribution uses an area-conserving geometric model.</p>
              </AccordionItem>
            </Accordion>
          </section>}

          {activePanel === "stack" && <section className="spin-control-section">
            <NumberField id="substrate-depth" label="Displayed substrate depth" unit="nm" value={substrateThickness} min={10} max={1e6} onValue={(value) => setSubstrateThickness(bounded(value, substrateThickness, 10, 1e6))} />
            <div className="spin-layer-list">
              {layers.map((layer, index) => <Tile className="spin-layer" key={layer.id}>
                <div className="spin-layer-head"><i style={{ background: layer.color }} /><b>{index + 1}</b><TextInput id={`layer-${layer.id}-name`} labelText={`Layer ${index + 1} name`} hideLabel size="sm" value={layer.name} onChange={(event) => changeLayer(layer.id, { name: event.target.value })} /><IconButton kind="ghost" size="sm" label={`Remove ${layer.name}`} onClick={() => setLayers((current) => current.filter((item) => item.id !== layer.id))}><TrashCan size={16} /></IconButton></div>
                <Grid condensed className="spin-layer-fields">
                  <Column sm={4} md={8} lg={16}><Select id={`layer-${layer.id}-operation`} labelText="Operation" size="md" value={layer.mode} onChange={(event) => changeLayer(layer.id, { mode: event.target.value as LayerMode })}><SelectItem value="uniform" text="Uniform deposit" /><SelectItem value="patterned" text="Patterned deposit" /><SelectItem value="etch" text="Etch into stack" /></Select></Column>
                  <Column sm={4} md={4} lg={8}><NumberField id={`layer-${layer.id}-thickness`} label={layer.mode === "etch" ? "Depth" : "Thickness"} unit="nm" value={layer.thicknessNm} min={1} max={1e6} onValue={(value) => changeLayer(layer.id, { thicknessNm: bounded(value, layer.thicknessNm, 1, 1e6) })} /></Column>
                  {layer.mode !== "uniform" && <Column sm={4} md={4} lg={8}><Select id={`layer-${layer.id}-gds`} labelText="GDS layer" size="md" value={layer.gdsLayer} onChange={(event) => changeLayer(layer.id, { gdsLayer: Number(event.target.value) })}>{availableLayers.map((number) => <SelectItem key={number} value={number} text={String(number)} />)}</Select></Column>}
                </Grid>
              </Tile>)}
            </div>
            <Button className="spin-add" kind="tertiary" size="md" renderIcon={Add} onClick={addLayer}>Add process layer</Button>
          </section>}

          {activePanel === "coating" && <section className="spin-control-section">
            <Grid condensed className="spin-fields">
              <Column sm={4} md={8} lg={16}><Select id="coating-library" labelText="Coating library" size="md" value={coatingLibrary} onChange={(event) => { setCoatingLibrary(event.target.value as "photoresist" | "oxide"); setCoatingPresetId(""); }}><SelectItem value="photoresist" text="Photoresists" /><SelectItem value="oxide" text="Metal oxides" /></Select></Column>
              {coatingLibrary === "photoresist" ? <>
                <Column sm={4} md={4} lg={8}><Select id="photoresist-polarity" labelText="Polarity" size="md" value={photoresistPolarity} onChange={(event) => { setPhotoresistPolarity(event.target.value); setCoatingPresetId(""); }}><SelectItem value="" text="All polarities" />{PHOTORESIST_POLARITIES.map((polarity) => <SelectItem key={polarity} value={polarity} text={polarity} />)}</Select></Column>
                <Column sm={4} md={4} lg={8}><Select id="photoresist-brand" labelText="Brand" size="md" value={photoresistManufacturer} onChange={(event) => { setPhotoresistManufacturer(event.target.value); setCoatingPresetId(""); }}><SelectItem value="" text="All brands" />{PHOTORESIST_MANUFACTURERS.map((manufacturer) => <SelectItem key={manufacturer} value={manufacturer} text={manufacturer} />)}</Select></Column>
                <Column sm={4} md={8} lg={16}><Select id="photoresist-exposure" labelText="Exposure" size="md" value={photoresistExposureNm} onChange={(event) => { setPhotoresistExposureNm(event.target.value); setCoatingPresetId(""); }}><SelectItem value="" text="All wavelengths" />{PHOTORESIST_EXPOSURE_WAVELENGTHS.map((wavelength) => <SelectItem key={wavelength} value={wavelength} text={`≈${wavelength} nm (h-line)`} />)}</Select></Column>
              </> : <Column sm={4} md={8} lg={16}><Select id="metal-oxide-family" labelText="Oxide" size="md" value={metalOxideFamily} onChange={(event) => { setMetalOxideFamily(event.target.value); setCoatingPresetId(""); }}><SelectItem value="" text="All oxides" />{METAL_OXIDE_FAMILIES.map((family) => <SelectItem key={family} value={family} text={family} />)}</Select></Column>}
              <Column sm={4} md={8} lg={16}><Select id="reference-process" labelText={`Reference process (${filteredCoatings.length}/${coatingLibrarySize})`} size="md" value={coatingPresetId} onChange={applyCoatingPreset}><SelectItem value="" text="Custom calibration" />{coatingLibrary === "photoresist" ? filteredPhotoresists.map((preset) => <SelectItem key={preset.id} value={preset.id} text={`${preset.name} · ${preset.referenceThicknessNm / 1000} µm`} />) : filteredMetalOxides.map((preset) => <SelectItem key={preset.id} value={preset.id} text={`${preset.family} · ${preset.name} · ${preset.referenceThicknessNm} nm`} />)}</Select></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="film-thickness" label="Film thickness" unit="nm" value={referenceThickness} min={1} max={1e6} onValue={(value) => setReferenceThickness(bounded(value, referenceThickness, 1, 1e6))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="reference-speed" label="Reference speed" unit="rpm" value={referenceRpm} min={1} max={100000} onValue={(value) => setReferenceRpm(bounded(value, referenceRpm, 1, 100000))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="simulated-speed" label="Simulated speed" unit="rpm" value={rpm} min={1} max={100000} onValue={(value) => setRpm(bounded(value, rpm, 1, 100000))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="exponent" label="Exponent n" value={exponent} min={0} max={2} step={0.05} onValue={(value) => setExponent(bounded(value, exponent, 0, 2))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="shrinkage" label="Shrinkage" unit="%" value={shrinkage} min={0} max={95} onValue={(value) => setShrinkage(bounded(value, shrinkage, 0, 95))} /></Column>
              <Column sm={4} md={8} lg={16}><Slider id="leveling-strength" className="spin-range" labelText="Leveling strength (%)" min={0} max={100} hideTextInput formatLabel={(value) => `${value}%`} value={levelingStrength} onChange={({ value }) => setLevelingStrength(Number(value))} /></Column>
              <Column sm={4} md={8} lg={16}><NumberField id="leveling-length" label="Lateral leveling length" unit="µm" value={levelingLength} min={0} max={1e6} step={0.5} onValue={(value) => setLevelingLength(bounded(value, levelingLength, 0, 1e6))} /></Column>
            </Grid>
            {photoresistPreset && <Tile className="spin-reference" aria-live="polite"><b>{photoresistPreset.name} · {photoresistPreset.tone}</b>{photoresistPreset.exposureWavelengthsNm && <span>Verified exposure lines: {photoresistPreset.exposureWavelengthsNm.join(", ")} nm.</span>}<span>{photoresistPreset.evidence}. Loaded with generic n = 0.5 and 0% additional shrinkage.</span><Link href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</Link></Tile>}
            {metalOxidePreset && <Tile className="spin-reference" aria-live="polite"><b>{metalOxidePreset.family} · {metalOxidePreset.name}</b><span>{metalOxidePreset.precursor} on {metalOxidePreset.substrate}. {metalOxidePreset.cycles} coat(s), {metalOxidePreset.spinSeconds} s; {metalOxidePreset.thermalTreatment}. {metalOxidePreset.phase}.</span><span>{metalOxidePreset.evidence}. The loaded value is the published final dry thickness; n = 0.5 remains a generic extrapolation.</span><Link href={metalOxidePreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</Link></Tile>}
            <p className="spin-equation">h = {referenceThickness} · ({rpm}/{referenceRpm})<sup>−{exponent}</sup> · (1 − {shrinkage}/100)</p>
            <p className="spin-note">Library values are starting points, not guaranteed recipes. Refit thickness, exponent and leveling to your spinner, substrate and ambient conditions.</p>
          </section>}
          </div>
        </Layer></>}

        <section className="spin-preview" aria-label="Coating results">
          <div className="spin-preview-head">
            <div aria-live="polite"><h2 ref={resultHeading} tabIndex={-1}>{fileName || "No profile yet"}</h2></div>
            {section && <div className="spin-actions"><Button kind="secondary" size="md" onClick={exportPng}>Export PNG</Button><Button kind="secondary" size="md" onClick={exportModel}>Export JSON</Button></div>}
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
            <Tile><p>CALIBRATED DRY FILM</p><strong>{dryThickness.toFixed(1)} nm</strong></Tile>
            <Tile><p>AFTER SHRINKAGE</p><strong>{finalThickness.toFixed(1)} nm</strong></Tile>
            <Tile><p>LOCAL RANGE</p><strong>{section.film.minimumThicknessNm.toFixed(1)}–{section.film.maximumThicknessNm.toFixed(1)} nm</strong></Tile>
            <Tile><p>MEAN / MASS CHECK</p><strong>{section.film.meanThicknessNm.toFixed(1)} nm</strong></Tile>
            <Tile><p>PLANARIZATION (DOP)</p><strong>{section.film.degreeOfPlanarizationPercent.toFixed(1)}%</strong></Tile>
            <Tile><p>THICKNESS NON-UNIFORMITY</p><strong>{section.film.thicknessNonUniformityPercent.toFixed(1)}%</strong></Tile>
          </div>

          <div className="spin-legend">
            <span><i style={{ background: "#5c6570" }} />Substrate</span>
            {layers.filter((layer) => layer.mode !== "etch").map((layer) => <span key={layer.id}><i style={{ background: layer.color }} />{layer.name}</span>)}
            <span><i style={{ background: "var(--color-plot-film)" }} />Spin-coated {metalOxidePreset?.family ?? "film"}</span>
          </div>

          <Accordion align="start" size="md" className="spin-validity"><AccordionItem title="Model boundary"><p>RPM scaling is empirical and should be fitted to your sol. The profile applies finite-range Gaussian leveling and conserves coating area; it is a reduced geometric surrogate, not a solution of centrifugal flow, capillarity, solvent evaporation, edge bead, dewetting or gel chemistry.</p>{section.ignoredPaths > 0 && <p className="spin-warning">{section.ignoredPaths} PATH element(s) cross the selected process layers and are omitted from this section.</p>}</AccordionItem></Accordion>
          </> : <div className="spin-empty-state"><strong>No coating profile yet</strong><p>Load a GDS file or use the example to calculate and display the cross-section.</p><Button kind="primary" size="md" onClick={loadDemo}>Load example</Button></div>}
        </section>
      </section>
      <footer className="spin-status" data-ready={Boolean(section)} aria-label="Simulation status">
        <p><span aria-hidden="true" />{section ? "Coating profile ready" : "Load a GDS file or the example to begin"}</p>
        <dl>
          <div><dt>Layers</dt><dd>{layers.length}</dd></div>
          <div><dt>Film</dt><dd>{section ? `${finalThickness.toFixed(1)} nm` : "—"}</dd></div>
          <div><dt>Cursor</dt><dd>{section ? `${cursorX.toFixed(2)} µm` : "—"}</dd></div>
        </dl>
      </footer>
      </Column>
    </Grid>
  );
}
