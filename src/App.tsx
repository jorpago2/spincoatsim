"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Column,
  ComboBox,
  FileUploaderButton,
  Grid,
  IconButton,
  Link,
  NumberInput,
  Select,
  SelectItem,
  Tag,
  TextInput,
  Tile,
} from "@carbon/react";
import { Add, Chemistry, Document, Layers, TrashCan } from "@carbon/react/icons";
import { ExportReceipt, ScientificAppShell, ScientificEmptyState, ScientificHeader, ScientificHeaderAction, ScientificOutcomeSummary, ScientificStatusBar, ScientificTaskPanel, ScientificToolRail, ScientificValidationSummary, useScientificPlotTheme, useScientificResultTransition } from "@jorpago2/scientific-ui";
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
type Provenance = "Reference" | "Edited" | "Model default" | "Custom";
type CalibrationState = {
  referenceThickness: number;
  referenceRpm: number;
  rpm: number;
  exponent: number;
  shrinkage: number;
};
type CalibrationField = keyof CalibrationState;
type CoatingReference = {
  id: string;
  label: string;
  name: string;
  detail: string;
  referenceThicknessNm: number;
  referenceRpm: number;
  sourceUrl: string;
};
type ExportNotice = { fileName: string; context: string };
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
const INITIAL_CUSTOM_CALIBRATION: CalibrationState = {
  referenceThickness: 180,
  referenceRpm: 3000,
  rpm: 3000,
  exponent: 0.5,
  shrinkage: 25,
};

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
  provenance?: Provenance;
  onValue: (value: number) => void;
};

const provenanceTagType: Record<Provenance, "teal" | "purple" | "warm-gray" | "gray"> = {
  Reference: "teal",
  Edited: "purple",
  "Model default": "warm-gray",
  Custom: "gray",
};

function NumberField({ id, label, unit, value, min, max, step, provenance, onValue }: NumberFieldProps) {
  return <div className="spin-number-field">
    <NumberInput
      id={id}
      label={`${label}${unit ? ` (${unit})` : ""}`}
      value={value}
      min={min}
      max={max}
      step={step}
      size="md"
      disableWheel
      onChange={(_, state) => onValue(Number(state.value))}
    />
    {provenance && <Tag className="spin-provenance-tag" size="sm" type={provenanceTagType[provenance]}>{provenance}</Tag>}
  </div>;
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
  const plotTheme = useScientificPlotTheme();
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
  const [referenceThickness, setReferenceThickness] = useState(INITIAL_CUSTOM_CALIBRATION.referenceThickness);
  const [referenceRpm, setReferenceRpm] = useState(INITIAL_CUSTOM_CALIBRATION.referenceRpm);
  const [rpm, setRpm] = useState(INITIAL_CUSTOM_CALIBRATION.rpm);
  const [exponent, setExponent] = useState(INITIAL_CUSTOM_CALIBRATION.exponent);
  const [coatingLibrary, setCoatingLibrary] = useState<"photoresist" | "oxide">("photoresist");
  const [coatingPresetId, setCoatingPresetId] = useState("");
  const [photoresistPolarity, setPhotoresistPolarity] = useState("");
  const [photoresistManufacturer, setPhotoresistManufacturer] = useState("");
  const [photoresistExposureNm, setPhotoresistExposureNm] = useState("");
  const [metalOxideFamily, setMetalOxideFamily] = useState("");
  const [shrinkage, setShrinkage] = useState(INITIAL_CUSTOM_CALIBRATION.shrinkage);
  const [levelingStrength, setLevelingStrength] = useState(65);
  const [levelingLength, setLevelingLength] = useState(8);
  const [cursorIndex, setCursorIndex] = useState(Math.floor(RESOLUTION / 2));
  const [canvasCssWidth, setCanvasCssWidth] = useState(1200);
  const [error, setError] = useState("");
  const [activePanel, setActivePanel] = useState<ToolPanel | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [resultsFresh, setResultsFresh] = useState(false);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);
  const customCalibration = useRef<CalibrationState>({ ...INITIAL_CUSTOM_CALIBRATION });

  const closePanel = () => {
    const panel = activePanel;
    setActivePanel(null);
    requestAnimationFrame(() => document.getElementById(`spin-nav-${panel}`)?.focus());
  };

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
  const coatingReferences = useMemo<CoatingReference[]>(() => coatingLibrary === "photoresist"
    ? filterPhotoresists(photoresistPolarity, photoresistManufacturer, photoresistExposureNm).map((preset) => ({
      id: preset.id,
      label: `${preset.name} · ${preset.referenceThicknessNm / 1000} µm`,
      name: preset.name,
      detail: `${preset.manufacturer} · ${preset.tone}`,
      referenceThicknessNm: preset.referenceThicknessNm,
      referenceRpm: preset.referenceRpm,
      sourceUrl: preset.sourceUrl,
    }))
    : filterMetalOxides(metalOxideFamily).map((preset) => ({
      id: preset.id,
      label: `${preset.family} · ${preset.name} · ${preset.referenceThicknessNm} nm`,
      name: `${preset.family} · ${preset.name}`,
      detail: `${preset.cycles} coat${preset.cycles === 1 ? "" : "s"} · ${preset.substrate}`,
      referenceThicknessNm: preset.referenceThicknessNm,
      referenceRpm: preset.referenceRpm,
      sourceUrl: preset.sourceUrl,
    })), [coatingLibrary, metalOxideFamily, photoresistExposureNm, photoresistManufacturer, photoresistPolarity]);
  const coatingLibrarySize = coatingLibrary === "photoresist" ? PHOTORESIST_PRESETS.length : METAL_OXIDE_PRESETS.length;
  const selectedReference = coatingReferences.find((reference) => reference.id === coatingPresetId) ?? null;
  const comparisonReferences = useMemo(() => {
    if (!selectedReference) return coatingReferences.slice(0, 3);
    const nearby = coatingReferences
      .filter((reference) => reference.id !== selectedReference.id)
      .sort((a, b) => Math.abs(a.referenceThicknessNm - selectedReference.referenceThicknessNm) - Math.abs(b.referenceThicknessNm - selectedReference.referenceThicknessNm));
    return [selectedReference, ...nearby.slice(0, 2)];
  }, [coatingReferences, selectedReference]);
  const xMin = centreX - viewWidth / 2;
  const xMax = centreX + viewWidth / 2;
  const dryThickness = calibratedThickness(referenceThickness, referenceRpm, rpm, exponent);
  const finalThickness = dryThickness * (1 - shrinkage / 100);
  const parameterProvenance = {
    referenceThicknessNm: !coatingPreset ? "Custom" : referenceThickness === coatingPreset.referenceThicknessNm ? "Reference" : "Edited",
    referenceRpm: !coatingPreset ? "Custom" : referenceRpm === coatingPreset.referenceRpm ? "Reference" : "Edited",
    rpm: !coatingPreset ? "Custom" : rpm === coatingPreset.referenceRpm ? "Reference" : "Edited",
    exponent: exponent === 0.5 ? "Model default" : "Edited",
    shrinkagePercent: !coatingPreset ? "Custom" : shrinkage === 0 ? "Model default" : "Edited",
    levelingStrengthPercent: levelingStrength === 65 ? "Model default" : "Edited",
    levelingLengthMicrometers: levelingLength === 8 ? "Model default" : "Edited",
  } satisfies Record<string, Provenance>;
  const hasReferenceEdits = Boolean(coatingPreset) && Object.values(parameterProvenance).includes("Edited");

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

  useScientificResultTransition({
    state: section ? resultsFresh ? "up-to-date" : "modified" : "needs-input",
    resultRef: resultHeading,
    completionKey: lastUpdated,
    onReveal: () => setActivePanel(null),
  });

  useEffect(() => {
    if (!section) return;
    const updateTimer = window.setTimeout(() => {
      setLastUpdated(new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
      setResultsFresh(true);
    }, 0);
    return () => {
      window.clearTimeout(updateTimer);
    };
  }, [section]);

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
  }, [section, cursorIndex, sliceY, xMin, viewWidth, canvasCssWidth, plotTheme]);

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

  function loadDemo() {
    setShapes(DEMO_SHAPES);
    setFileName("demo-topography.gds");
    setTopCell("DEMO");
    setSliceY(0);
    setCentreX(0);
    setViewWidth(100);
    setError("");
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

  function setCalibrationValue(field: CalibrationField, value: number) {
    if (!coatingPresetId) customCalibration.current = { ...customCalibration.current, [field]: value };
    if (field === "referenceThickness") setReferenceThickness(value);
    if (field === "referenceRpm") setReferenceRpm(value);
    if (field === "rpm") setRpm(value);
    if (field === "exponent") setExponent(value);
    if (field === "shrinkage") setShrinkage(value);
  }

  function restoreCustomCalibration() {
    const custom = customCalibration.current;
    setCoatingPresetId("");
    setReferenceThickness(custom.referenceThickness);
    setReferenceRpm(custom.referenceRpm);
    setRpm(custom.rpm);
    setExponent(custom.exponent);
    setShrinkage(custom.shrinkage);
  }

  function applyCoatingReference(reference: CoatingReference | null) {
    if (!reference) {
      restoreCustomCalibration();
      return;
    }
    if (!coatingPresetId) {
      customCalibration.current = { referenceThickness, referenceRpm, rpm, exponent, shrinkage };
    }
    setCoatingPresetId(reference.id);
    setReferenceThickness(reference.referenceThicknessNm);
    setReferenceRpm(reference.referenceRpm);
    setRpm(reference.referenceRpm);
    setExponent(0.5);
    setShrinkage(0);
  }

  function exportModel() {
    if (!section) return;
    const data = {
      schema: "spincoatsim-model/v3",
      source: { fileName, topCell, sliceYMicrometers: sliceY, centreXMicrometers: centreX, widthMicrometers: viewWidth },
      stack: { substrateThicknessNm: substrateThickness, layers },
      coating: { referencePreset: coatingPreset ? { category: coatingLibrary, id: coatingPreset.id, name: coatingPreset.name, sourceUrl: coatingPreset.sourceUrl } : null, referenceThicknessNm: referenceThickness, referenceRpm, rpm, exponent, shrinkagePercent: shrinkage, levelingStrengthPercent: levelingStrength, levelingLengthMicrometers: levelingLength, predictedFinalThicknessNm: finalThickness, provenance: parameterProvenance },
      result: { minimumThicknessNm: section.film.minimumThicknessNm, meanThicknessNm: section.film.meanThicknessNm, maximumThicknessNm: section.film.maximumThicknessNm, degreeOfPlanarizationPercent: section.film.degreeOfPlanarizationPercent, thicknessNonUniformityPercent: section.film.thicknessNonUniformityPercent },
    };
    const exportedFileName = "spincoat-model.json";
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), exportedFileName);
    setExportNotice({ fileName: exportedFileName, context: `${coatingPreset?.name ?? "Custom calibration"} · ${rpm} rpm · ${finalThickness.toFixed(1)} nm predicted` });
  }

  function exportPng() {
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const exportedFileName = "spincoat-section.png";
      saveBlob(blob, exportedFileName);
      setExportNotice({ fileName: exportedFileName, context: `${coatingPreset?.name ?? "Custom calibration"} · ${rpm} rpm · ${finalThickness.toFixed(1)} nm predicted` });
    }, "image/png");
  }

  const localThickness = section?.film.localThickness[Math.max(0, Math.min(RESOLUTION - 1, cursorIndex))] ?? 0;
  const cursorX = xMin + ((cursorIndex + 0.5) / RESOLUTION) * viewWidth;

  return (
    <ScientificAppShell
      className="spin-app"
      panelOpen={Boolean(activePanel)}
      header={<>
        <a className="skip-link" href="#spin-workspace">Skip to coating workspace</a>
        <ScientificHeader
          aria-label="SpinCoatSim"
          product="SpinCoatSim"
          productIcon="spin-coating"
          descriptor="Spin-coating simulator"
          href="/spincoatsim/"
          contextLabel="Current model"
          context={fileName || "No GDS loaded"}
          status={{ state: section ? resultsFresh ? "up-to-date" : "modified" : "needs-input", label: section ? resultsFresh ? "Up to date" : "Modified" : "Needs input" }}
          help={{
            summary: "Load a GDS section, define the existing stack, configure the coating calibration, then inspect and export the predicted profile.",
            shortcuts: [{ keys: ["Esc"], description: "Close the active panel" }],
          }}
          secondaryActions={<>
            <ScientificHeaderAction className="spin-header-example" label="Load example from header" onClick={loadDemo}><Document size={20} aria-hidden={true} /></ScientificHeaderAction>
            <Link className="suite-link" href="https://jorpago2.github.io/">All tools</Link>
          </>}
        />
      </>}
      navigation={<ScientificToolRail className="spin-navigation" label="Configuration tools" activeId={activePanel ?? "input"} expandedId={activePanel} onChange={(id) => setActivePanel(id as ToolPanel | null)} items={[
        { id: "input", triggerId: "spin-nav-input", label: "Input", icon: <Document size={20} />, controlsId: "spin-tool-panel" },
        { id: "stack", triggerId: "spin-nav-stack", label: "Process stack", icon: <Layers size={20} />, controlsId: "spin-tool-panel" },
        { id: "coating", triggerId: "spin-nav-coating", label: "Film model", icon: <Chemistry size={20} />, controlsId: "spin-tool-panel" },
      ]} />}
      panel={activePanel ? <ScientificTaskPanel
          className="spin-controls"
          id="spin-tool-panel"
          titleId="spin-panel-title"
          title={activePanel === "input" ? "GDS section" : activePanel === "stack" ? "Existing materials" : "Calibrated film"}
          eyebrow="Configuration"
          closeLabel="Close"
          onClose={closePanel}
          bodyClassName="spin-panel-body"
          key={activePanel}
        >
          {activePanel === "input" && <section className="spin-control-section">
            <Tile className="spin-file-status" aria-live="polite">{fileName || "No GDS loaded"}</Tile>
            <FileUploaderButton id="spin-gds-upload" className="spin-upload" accept={[".gds", ".gdsii"]} buttonKind="tertiary" size="md" labelText="Choose a local .gds file" onChange={loadGds} />
            <Button className="spin-example" kind="secondary" size="md" aria-label="Load example from Input panel" onClick={loadDemo}>Load example</Button>
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
              <Column sm={4} md={8} lg={16}><Select id="coating-library" labelText="Coating library" size="md" value={coatingLibrary} onChange={(event) => { restoreCustomCalibration(); setCoatingLibrary(event.target.value as "photoresist" | "oxide"); }}><SelectItem value="photoresist" text="Photoresists" /><SelectItem value="oxide" text="Metal oxides" /></Select></Column>
              {coatingLibrary === "photoresist" ? <>
                <Column sm={4} md={4} lg={8}><Select id="photoresist-polarity" labelText="Polarity" size="md" value={photoresistPolarity} onChange={(event) => { restoreCustomCalibration(); setPhotoresistPolarity(event.target.value); }}><SelectItem value="" text="All polarities" />{PHOTORESIST_POLARITIES.map((polarity) => <SelectItem key={polarity} value={polarity} text={polarity} />)}</Select></Column>
                <Column sm={4} md={4} lg={8}><Select id="photoresist-brand" labelText="Brand" size="md" value={photoresistManufacturer} onChange={(event) => { restoreCustomCalibration(); setPhotoresistManufacturer(event.target.value); }}><SelectItem value="" text="All brands" />{PHOTORESIST_MANUFACTURERS.map((manufacturer) => <SelectItem key={manufacturer} value={manufacturer} text={manufacturer} />)}</Select></Column>
                <Column sm={4} md={8} lg={16}><Select id="photoresist-exposure" labelText="Exposure" size="md" value={photoresistExposureNm} onChange={(event) => { restoreCustomCalibration(); setPhotoresistExposureNm(event.target.value); }}><SelectItem value="" text="All wavelengths" />{PHOTORESIST_EXPOSURE_WAVELENGTHS.map((wavelength) => <SelectItem key={wavelength} value={wavelength} text={`≈${wavelength} nm (h-line)`} />)}</Select></Column>
              </> : <Column sm={4} md={8} lg={16}><Select id="metal-oxide-family" labelText="Oxide" size="md" value={metalOxideFamily} onChange={(event) => { restoreCustomCalibration(); setMetalOxideFamily(event.target.value); }}><SelectItem value="" text="All oxides" />{METAL_OXIDE_FAMILIES.map((family) => <SelectItem key={family} value={family} text={family} />)}</Select></Column>}
              <Column sm={4} md={8} lg={16} className="spin-reference-picker">
                <ComboBox
                  id="reference-process"
                  titleText={`Reference process (${coatingReferences.length}/${coatingLibrarySize})`}
                  helperText="Type to search by material, brand or thickness. Clear the selection to restore your custom calibration."
                  placeholder="Custom calibration"
                  size="md"
                  autoAlign
                  items={coatingReferences}
                  selectedItem={selectedReference}
                  itemToString={(reference) => reference?.label ?? ""}
                  shouldFilterItem={({ item, inputValue }) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes((inputValue ?? "").trim().toLocaleLowerCase())}
                  onChange={({ selectedItem }) => applyCoatingReference(selectedItem ?? null)}
                />
                {selectedReference && <Button className="spin-custom-action" kind="ghost" size="sm" onClick={restoreCustomCalibration}>Restore custom calibration</Button>}
                <Accordion align="start" size="sm" className="spin-reference-compare">
                  <AccordionItem title={`Compare ${comparisonReferences.length} recipes`}>
                    <div className="spin-reference-list" aria-label="Reference process comparison">
                      {comparisonReferences.map((reference) => <article className="spin-reference-option" key={reference.id}>
                        <div className="spin-reference-option__heading">
                          <div><strong>{reference.name}</strong><small>{reference.detail}</small></div>
                          <Button kind="ghost" size="sm" disabled={selectedReference?.id === reference.id} onClick={() => applyCoatingReference(reference)}>{selectedReference?.id === reference.id ? "Using" : "Use"}</Button>
                        </div>
                        <dl>
                          <div><dt>Film</dt><dd>{reference.referenceThicknessNm} nm</dd></div>
                          <div><dt>Speed</dt><dd>{reference.referenceRpm} rpm</dd></div>
                        </dl>
                        <Link href={reference.sourceUrl} target="_blank" rel="noreferrer">Source ↗</Link>
                      </article>)}
                    </div>
                  </AccordionItem>
                </Accordion>
              </Column>
              <Column sm={4} md={4} lg={8}><NumberField id="film-thickness" label="Film thickness" unit="nm" value={referenceThickness} min={1} max={1e6} provenance={parameterProvenance.referenceThicknessNm} onValue={(value) => setCalibrationValue("referenceThickness", bounded(value, referenceThickness, 1, 1e6))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="reference-speed" label="Reference speed" unit="rpm" value={referenceRpm} min={1} max={100000} provenance={parameterProvenance.referenceRpm} onValue={(value) => setCalibrationValue("referenceRpm", bounded(value, referenceRpm, 1, 100000))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="simulated-speed" label="Simulated speed" unit="rpm" value={rpm} min={1} max={100000} provenance={parameterProvenance.rpm} onValue={(value) => setCalibrationValue("rpm", bounded(value, rpm, 1, 100000))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="exponent" label="Exponent n" value={exponent} min={0} max={2} step={0.05} provenance={parameterProvenance.exponent} onValue={(value) => setCalibrationValue("exponent", bounded(value, exponent, 0, 2))} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="shrinkage" label="Shrinkage" unit="%" value={shrinkage} min={0} max={95} provenance={parameterProvenance.shrinkagePercent} onValue={(value) => setCalibrationValue("shrinkage", bounded(value, shrinkage, 0, 95))} /></Column>
              <Column sm={4} md={8} lg={16}><NumberField id="leveling-strength" label="Leveling strength" unit="%" value={levelingStrength} min={0} max={100} step={1} provenance={parameterProvenance.levelingStrengthPercent} onValue={(value) => setLevelingStrength(bounded(value, levelingStrength, 0, 100))} /></Column>
              <Column sm={4} md={8} lg={16}><NumberField id="leveling-length" label="Lateral leveling length" unit="µm" value={levelingLength} min={0} max={1e6} step={0.5} provenance={parameterProvenance.levelingLengthMicrometers} onValue={(value) => setLevelingLength(bounded(value, levelingLength, 0, 1e6))} /></Column>
            </Grid>
            {photoresistPreset && <Tile className="spin-reference" aria-live="polite"><b>{photoresistPreset.name} · {photoresistPreset.tone}</b>{photoresistPreset.exposureWavelengthsNm && <span>Verified exposure lines: {photoresistPreset.exposureWavelengthsNm.join(", ")} nm.</span>}<span>{photoresistPreset.evidence}. Loaded with generic n = 0.5 and 0% additional shrinkage.</span><Link href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</Link></Tile>}
            {metalOxidePreset && <Tile className="spin-reference" aria-live="polite"><b>{metalOxidePreset.family} · {metalOxidePreset.name}</b><span>{metalOxidePreset.precursor} on {metalOxidePreset.substrate}. {metalOxidePreset.cycles} coat(s), {metalOxidePreset.spinSeconds} s; {metalOxidePreset.thermalTreatment}. {metalOxidePreset.phase}.</span><span>{metalOxidePreset.evidence}. The loaded value is the published final dry thickness; n = 0.5 remains a generic extrapolation.</span><Link href={metalOxidePreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</Link></Tile>}
            <p className="spin-equation">h = {referenceThickness} · ({rpm}/{referenceRpm})<sup>−{exponent}</sup> · (1 − {shrinkage}/100)</p>
            <p className="spin-note">Library values are starting points, not guaranteed recipes. Refit thickness, exponent and leveling to your spinner, substrate and ambient conditions.</p>
          </section>}
        </ScientificTaskPanel> : undefined}
      statusBar={<ScientificStatusBar className="spin-status" status={{ state: section ? "up-to-date" : "needs-input", label: section ? "Coating profile ready" : "Load a GDS file or the example to begin" }} metadata={<dl>
        <div><dt>Layers</dt><dd>{layers.length}</dd></div>
        <div><dt>Film</dt><dd>{section ? `${finalThickness.toFixed(1)} nm` : "—"}</dd></div>
        <div><dt>Cursor</dt><dd>{section ? `${cursorX.toFixed(2)} µm` : "—"}</dd></div>
      </dl>} />}
    >
        <section className="spin-preview scientific-stage" id="spin-workspace" tabIndex={-1} aria-label="Coating results">
          <h1 className="visually-hidden">SpinCoatSim spin-coating cross-section simulator</h1>
          {section && <ScientificOutcomeSummary
            className="spin-outcome"
            title={fileName || "Coating profile"}
            headingRef={resultHeading}
            status={{ state: resultsFresh ? "up-to-date" : "modified", label: resultsFresh ? "Profile current" : "Parameters modified", detail: lastUpdated ? `Updated ${lastUpdated}` : undefined }}
            summary={`${coatingPreset ? `${coatingPreset.name}${hasReferenceEdits ? " with local edits" : ""}` : "Custom calibration"}. The profile uses the current stack and film model; experimental calibration is still required before process transfer.`}
            metrics={[
              { id: "dry-film", label: "Calibrated dry film", value: dryThickness, unit: "nm", format: { significantDigits: 4 } },
              { id: "local-range", label: "Local thickness range", value: `${section.film.minimumThicknessNm.toFixed(1)}â€“${section.film.maximumThicknessNm.toFixed(1)}`, unit: "nm" },
              { id: "planarization", label: "Planarization", value: section.film.degreeOfPlanarizationPercent, unit: "%", format: { significantDigits: 3 } },
              { id: "nonuniformity", label: "Non-uniformity", value: section.film.thicknessNonUniformityPercent, unit: "%", format: { significantDigits: 3 } },
            ]}
            actions={[
              { id: "export-png", label: "Export PNG", emphasis: "primary", onClick: exportPng },
              { id: "export-json", label: "Export JSON", emphasis: "secondary", collapseAt: "sm", onClick: exportModel },
            ]}
          />}
          {exportNotice && <ExportReceipt className="spin-export-notice" fileName={exportNotice.fileName} format={exportNotice.fileName.endsWith(".png") ? "PNG" : "JSON"} destination={exportNotice.context} onDismiss={() => setExportNotice(null)} />}
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

          <ScientificValidationSummary
            className="spin-validation-summary"
            title="Model checks"
            description="Numerical checks for this reduced coating model. Experimental calibration is still required before process transfer."
            status={{
              state: section.ignoredPaths > 0 || !coatingPreset || hasReferenceEdits ? "warning" : "ready",
              label: section.ignoredPaths > 0 || !coatingPreset || hasReferenceEdits ? "Review model evidence" : "Model checks passed · experimental validation required",
            }}
            checks={[
              { id: "mass", label: "Coating area", state: "passed", value: `${section.film.meanThicknessNm.toFixed(1)} nm mean`, detail: "The leveling surrogate conserves coating cross-sectional area." },
              { id: "geometry", label: "Imported geometry", state: section.ignoredPaths > 0 ? "warning" : "passed", value: section.ignoredPaths > 0 ? `${section.ignoredPaths} path(s) omitted` : "No omitted paths" },
              { id: "calibration", label: "Calibration provenance", state: coatingPreset && !hasReferenceEdits ? "passed" : "warning", detail: coatingPreset && !hasReferenceEdits ? coatingPreset.name : "Custom or edited calibration; verify against measured thickness." },
              { id: "scope", label: "Physical scope", state: "warning", detail: "Flow, evaporation, edge bead, dewetting and chemistry are outside this model." },
            ]}
          />

          <div className="spin-legend">
            <span><i style={{ background: "#5c6570" }} />Substrate</span>
            {layers.filter((layer) => layer.mode !== "etch").map((layer) => <span key={layer.id}><i style={{ background: layer.color }} />{layer.name}</span>)}
            <span><i style={{ background: "var(--color-plot-film)" }} />Spin-coated {metalOxidePreset?.family ?? "film"}</span>
          </div>

          <Accordion align="start" size="md" className="spin-validity"><AccordionItem title="Model boundary"><p>RPM scaling is empirical and should be fitted to your sol. The profile applies finite-range Gaussian leveling and conserves coating area; it is a reduced geometric surrogate, not a solution of centrifugal flow, capillarity, solvent evaporation, edge bead, dewetting or gel chemistry.</p>{section.ignoredPaths > 0 && <p className="spin-warning">{section.ignoredPaths} PATH element(s) cross the selected process layers and are omitted from this section.</p>}</AccordionItem></Accordion>
          </> : <ScientificEmptyState className="spin-empty-state" title="No coating profile yet" description="Load a GDS file or use the example to calculate and display the cross-section." action={<Button kind="primary" size="md" aria-label="Load example from empty results" onClick={loadDemo}>Load example</Button>} />}
        </section>
    </ScientificAppShell>
  );
}
