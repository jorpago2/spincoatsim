"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Column,
  ComboBox,
  FileUploaderButton,
  Grid,
  IconButton,
  InlineNotification,
  Link,
  Modal,
  NumberInput,
  ProgressBar,
  Select,
  SelectItem,
  Slider,
  Tag,
  TextInput,
  Tile,
} from "@carbon/react";
import { Add, Chemistry, Document, Layers, TrashCan } from "@carbon/react/icons";
import { ExportReceipt, ScientificAppShell, ScientificAutosaveStatus, ScientificEmptyState, ScientificHeader, ScientificHeaderAction, ScientificOutcomeSummary, ScientificRecoveryNotice, ScientificStatusBar, ScientificTaskPanel, ScientificToolRail, ScientificValidationSummary, useScientificAutosave, useScientificResultTransition } from "@jorpago2/scientific-ui";
import { SpinCoatCanvas } from "./components/SpinCoatCanvas";
import {
  cancelGdsImport,
  flattenPendingGds,
  importGdsFile,
  type GdsCompleteResult,
  type GdsProgress,
  type GdsShape,
} from "./workers/gdsClient";
import { filterMetalOxides, METAL_OXIDE_FAMILIES, METAL_OXIDE_PRESETS } from "@/lib/metal-oxides.js";
import { filterPhotoresists, PHOTORESIST_EXPOSURE_WAVELENGTHS, PHOTORESIST_MANUFACTURERS, PHOTORESIST_POLARITIES, PHOTORESIST_PRESETS } from "@/lib/photoresists.js";
import {
  buildMaterialColumns,
  buildSpinFilm,
  calibratedThickness,
  polygonIntervalsAtY,
  sampleIntervals,
} from "@/lib/spincoat.js";
import type { CalibrationField, CalibrationState, CoatingReference, ExportNotice, LayerMode, PendingGds, Provenance, SectionResult, SpinSession, StackLayer, ToolPanel } from "./spincoatTypes";


const DEMO_SHAPES: GdsShape[] = [
  { kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: -42, y: -15 }, { x: -18, y: -15 }, { x: -18, y: 15 }, { x: -42, y: 15 }] },
  { kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: -8, y: -15 }, { x: 8, y: -15 }, { x: 8, y: 15 }, { x: -8, y: 15 }] },
  { kind: "polygon", layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: 20, y: -15 }, { x: 38, y: -15 }, { x: 38, y: 15 }, { x: 20, y: 15 }] },
  { kind: "polygon", layer: 2, datatype: 0, width: 0, pathType: 0, points: [{ x: -28, y: -15 }, { x: -4, y: -15 }, { x: -4, y: 15 }, { x: -28, y: 15 }] },
  { kind: "polygon", layer: 2, datatype: 0, width: 0, pathType: 0, points: [{ x: 13, y: -15 }, { x: 30, y: -15 }, { x: 30, y: 15 }, { x: 13, y: 15 }] },
];

const COLORS = ["#f0b84a", "#75b9c8", "#a28fe0", "#e67f65", "#93ba72", "#d986b5"];
const RESOLUTION = 480;
const MAX_GDS_BYTES = 25 * 1024 * 1024;
const GDS_EXPANSION_LIMITS = { maxShapes: 250_000, maxInstances: 250_000, maxPoints: 2_000_000 };
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

function ResultMetrics({ dryThickness, section }: { dryThickness: number; section: SectionResult }) {
  return <dl className="spin-summary-metrics" aria-label="Coating profile summary">
    <Tile><dt>Calibrated dry film</dt><dd>{Number(dryThickness.toPrecision(4))} <span>nm</span></dd></Tile>
    <Tile><dt>Local thickness range</dt><dd>{section.film.minimumThicknessNm.toFixed(1)}–{section.film.maximumThicknessNm.toFixed(1)} <span>nm</span></dd></Tile>
    <Tile><dt>Planarization</dt><dd>{Number(section.film.degreeOfPlanarizationPercent.toPrecision(3))} <span>%</span></dd></Tile>
  </dl>;
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
  const [sourceSha256, setSourceSha256] = useState("");
  const [compatibilityWarnings, setCompatibilityWarnings] = useState<string[]>([]);
  const [pendingGds, setPendingGds] = useState<PendingGds | null>(null);
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
  const [error, setError] = useState("");
  const [activePanel, setActivePanel] = useState<ToolPanel | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [gdsProgress, setGdsProgress] = useState<GdsProgress | null>(null);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);
  const [customCalibration, setCustomCalibration] = useState<CalibrationState>({ ...INITIAL_CUSTOM_CALIBRATION });
  const toolTriggerRefs = useRef<Record<ToolPanel, HTMLButtonElement | null>>({ input: null, stack: null, coating: null });
  const returnFocusTo = useRef<ToolPanel | null>(null);
  const importGeneration = useRef(0);

  const closePanel = useCallback(() => {
    if (activePanel) returnFocusTo.current = activePanel;
    setActivePanel(null);
  }, [activePanel]);

  useEffect(() => {
    if (activePanel || !returnFocusTo.current) return;
    toolTriggerRefs.current[returnFocusTo.current]?.focus();
    returnFocusTo.current = null;
  }, [activePanel]);

  useEffect(() => () => cancelGdsImport(), []);

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
    state: section ? "up-to-date" : "needs-input",
    resultRef: resultHeading,
    completionKey: lastUpdated,
    onReveal: () => setActivePanel(null),
  });

  useEffect(() => {
    if (!section) return;
    const updateTimer = window.setTimeout(() => {
      setLastUpdated(new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    }, 0);
    return () => {
      window.clearTimeout(updateTimer);
    };
  }, [section]);

  async function loadGds(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const currentImport = ++importGeneration.current;
    try {
      cancelGdsImport();
      setPendingGds(null);
      if (file.size > MAX_GDS_BYTES) throw new Error(`The GDS is ${(file.size / 1024 / 1024).toFixed(1)} MB; the browser safety limit is ${MAX_GDS_BYTES / 1024 / 1024} MB.`);
      const buffer = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (currentImport !== importGeneration.current) return;
      setGdsProgress({ stage: "Starting worker", completed: 0 });
      const result = await importGdsFile(buffer, GDS_EXPANSION_LIMITS, setGdsProgress);
      if (currentImport !== importGeneration.current) return;
      if (result.kind === "selection-required") {
        setPendingGds({ importId: result.importId, topCells: result.topCells, compatibilityWarnings: result.compatibilityWarnings, fileName: file.name, sha256: hash, selectedCell: result.topCells[0] });
        setError("");
        setGdsProgress(null);
        return;
      }
      applyGdsResult(result, file.name, hash);
    } catch (reason) {
      if (currentImport === importGeneration.current && !(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "The GDS could not be read.");
      }
    } finally {
      if (currentImport === importGeneration.current) setGdsProgress(null);
      event.target.value = "";
    }
  }

  function applyGdsResult(result: GdsCompleteResult, importedFileName: string, hash: string) {
    try {
      setTopCell(result.topCell);
      setShapes(result.shapes);
      setFileName(importedFileName);
      setSourceSha256(hash);
      setCompatibilityWarnings(result.compatibilityWarnings);
      setPendingGds(null);
      setCentreX((result.bounds.minX + result.bounds.maxX) / 2);
      setSliceY((result.bounds.minY + result.bounds.maxY) / 2);
      setViewWidth(Math.max(1, result.bounds.width));
      const firstLayer = result.shapes[0].layer;
      setLayers((current) => current.map((layer) => ({ ...layer, gdsLayer: firstLayer })));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The GDS could not be read.");
    }
  }

  async function applyPendingTopCell() {
    if (!pendingGds) return;
    try {
      setGdsProgress({ stage: "Starting worker", completed: 0 });
      const result = await flattenPendingGds(
        pendingGds.importId,
        pendingGds.selectedCell,
        GDS_EXPANSION_LIMITS,
        setGdsProgress,
      );
      if (result.kind !== "complete") throw new Error("The selected GDS cell was not flattened.");
      applyGdsResult(result, pendingGds.fileName, pendingGds.sha256);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "The GDS could not be read.");
      }
    } finally {
      setGdsProgress(null);
    }
  }

  function cancelActiveGdsImport() {
    importGeneration.current += 1;
    cancelGdsImport();
    setGdsProgress(null);
    setPendingGds(null);
    setError("GDS import cancelled. Select the file again to restart.");
  }

  function loadDemo() {
    importGeneration.current += 1;
    cancelGdsImport();
    setGdsProgress(null);
    setShapes(DEMO_SHAPES);
    setFileName("demo-topography.gds");
    setTopCell("DEMO");
    setSourceSha256("embedded-demo");
    setCompatibilityWarnings([]);
    setPendingGds(null);
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
    if (!coatingPresetId) setCustomCalibration((current) => ({ ...current, [field]: value }));
    if (field === "referenceThickness") setReferenceThickness(value);
    if (field === "referenceRpm") setReferenceRpm(value);
    if (field === "rpm") setRpm(value);
    if (field === "exponent") setExponent(value);
    if (field === "shrinkage") setShrinkage(value);
  }

  function restoreCustomCalibration() {
    const custom = customCalibration;
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
      setCustomCalibration({ referenceThickness, referenceRpm, rpm, exponent, shrinkage });
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
      schema: "spincoatsim-model/v4",
      engine: { id: "spincoatsim-geometric-film", schemaVersion: 4, sectionResolution: RESOLUTION },
      source: { fileName, sha256: sourceSha256, topCell, sliceYMicrometers: sliceY, centreXMicrometers: centreX, widthMicrometers: viewWidth, compatibilityWarnings },
      stack: { substrateThicknessNm: substrateThickness, layers },
      coating: { referencePreset: coatingPreset ? { category: coatingLibrary, id: coatingPreset.id, name: coatingPreset.name, sourceUrl: coatingPreset.sourceUrl } : null, referenceThicknessNm: referenceThickness, referenceRpm, rpm, exponent, shrinkagePercent: shrinkage, levelingStrengthPercent: levelingStrength, levelingLengthMicrometers: levelingLength, predictedFinalThicknessNm: finalThickness, provenance: parameterProvenance },
      grid: { xMicrometers: Array.from({ length: RESOLUTION }, (_, index) => xMin + ((index + 0.5) / RESOLUTION) * viewWidth) },
      result: { ...section.film, columns: section.columns, ignoredPaths: section.ignoredPaths },
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
  const session = useMemo<SpinSession>(() => ({
    fileName, topCell, sourceSha256, compatibilityWarnings, sliceY, centreX, viewWidth, substrateThickness, layers,
    calibration: { referenceThickness, referenceRpm, rpm, exponent, shrinkage },
    coatingLibrary, coatingPresetId, photoresistPolarity, photoresistManufacturer, photoresistExposureNm,
    metalOxideFamily, levelingStrength, levelingLength,
  }), [centreX, coatingLibrary, coatingPresetId, compatibilityWarnings, exponent, fileName, layers, levelingLength, levelingStrength, metalOxideFamily, photoresistExposureNm, photoresistManufacturer, photoresistPolarity, referenceRpm, referenceThickness, rpm, shrinkage, sliceY, sourceSha256, substrateThickness, topCell, viewWidth]);
  const restoreSession = useCallback((saved: SpinSession) => {
    setShapes(saved.shapes ?? []);
    setFileName(saved.fileName);
    setTopCell(saved.topCell);
    setSourceSha256(saved.sourceSha256 ?? "");
    setCompatibilityWarnings(saved.compatibilityWarnings ?? []);
    setSliceY(saved.sliceY);
    setCentreX(saved.centreX);
    setViewWidth(saved.viewWidth);
    setSubstrateThickness(saved.substrateThickness);
    setLayers(saved.layers);
    setReferenceThickness(saved.calibration.referenceThickness);
    setReferenceRpm(saved.calibration.referenceRpm);
    setRpm(saved.calibration.rpm);
    setExponent(saved.calibration.exponent);
    setShrinkage(saved.calibration.shrinkage);
    setCustomCalibration(saved.calibration);
    setCoatingLibrary(saved.coatingLibrary);
    setCoatingPresetId(saved.coatingPresetId);
    setPhotoresistPolarity(saved.photoresistPolarity);
    setPhotoresistManufacturer(saved.photoresistManufacturer);
    setPhotoresistExposureNm(saved.photoresistExposureNm);
    setMetalOxideFamily(saved.metalOxideFamily);
    setLevelingStrength(saved.levelingStrength);
    setLevelingLength(saved.levelingLength);
    setError(saved.shapes?.length || !saved.fileName ? "" : `Reimport ${saved.fileName} to restore its GDS geometry; autosave keeps configuration but not large layout data.`);
  }, []);
  const autosave = useScientificAutosave({
    storageKey: "spincoatsim:session",
    value: session,
    onRestore: restoreSession,
    schemaVersion: 1,
    maxBytes: 3_000_000,
  });

  return (<>
    <ScientificAppShell
      className="spin-app"
      previewStageWhenPanelOpen
      recovery={autosave.recovery && <ScientificRecoveryNotice savedAt={autosave.recovery.savedAt} onRestore={autosave.restore} onDiscard={autosave.discard} />}
      panelOpen={Boolean(activePanel)}
      header={<>
        <a className="skip-link" href="#spin-workspace">Skip to coating workspace</a>
        <ScientificHeader
          aria-label="SpinCoatSim"
          product="SpinCoatSim"
          compactProduct="SpinCoat"
          productIcon="spin-coating"
          descriptor="Spin-coating simulator"
          href="/spincoatsim/"
          contextLabel="Current model"
          context={fileName || "No GDS loaded"}
          status={{ state: section ? "up-to-date" : "needs-input", label: section ? "Up to date" : "Needs input" }}
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
      navigation={<ScientificToolRail className="spin-navigation" label="Configuration tools" activeId={activePanel} expandedId={activePanel} onChange={(id) => setActivePanel(id as ToolPanel | null)} registerItemRef={(id, node) => { toolTriggerRefs.current[id as ToolPanel] = node; }} items={[
        { id: "input", triggerId: "spin-nav-input", label: "Input", icon: <Document size={20} />, controlsId: "spin-tool-panel" },
        { id: "stack", triggerId: "spin-nav-stack", label: "Process stack", icon: <Layers size={20} />, controlsId: "spin-tool-panel" },
        { id: "coating", triggerId: "spin-nav-coating", label: "Film model", icon: <Chemistry size={20} />, controlsId: "spin-tool-panel" },
      ]} />}
      panel={<ScientificTaskPanel
          className="spin-controls"
          id="spin-tool-panel"
          titleId="spin-panel-title"
           title={activePanel === "input" ? "GDS section" : activePanel === "stack" ? "Existing materials" : activePanel === "coating" ? "Calibrated film" : "Configuration"}
          eyebrow="Configuration"
          closeLabel="Close"
          onClose={closePanel}
          bodyClassName="spin-panel-body"
         >
          {activePanel === "input" && <section className="spin-control-section">
            <Tile className="spin-file-status" aria-live="polite">{fileName || "No GDS loaded"}</Tile>
            <FileUploaderButton id="spin-gds-upload" className="spin-upload" accept={[".gds", ".gdsii"]} buttonKind="tertiary" size="md" labelText="Choose a local .gds file" disabled={Boolean(gdsProgress)} onChange={loadGds} />
            {gdsProgress && <div className="spin-import-progress" role="status" aria-live="polite">
              <ProgressBar label={gdsProgress.stage} helperText={`${Math.round(gdsProgress.completed * 100)}% complete`} max={100} value={gdsProgress.completed * 100} />
              <Button className="spin-import-cancel" kind="danger--tertiary" size="sm" onClick={cancelActiveGdsImport}>Cancel import</Button>
            </div>}
            <Button className="spin-example" kind="secondary" size="md" aria-label="Load example from Input panel" onClick={loadDemo}>Load example</Button>
            {error && <InlineNotification className="spin-notification" lowContrast kind="error" title="GDS input" subtitle={error} hideCloseButton />}
            <Grid condensed className="spin-fields">
              <Column sm={4} md={4} lg={8}><NumberField id="section-y" label="Section Y" unit="µm" value={sliceY} min={-1e6} max={1e6} step={0.1} onValue={setSliceY} /></Column>
              <Column sm={4} md={4} lg={8}><NumberField id="centre-x" label="Centre X" unit="µm" value={centreX} min={-1e6} max={1e6} step={0.1} onValue={setCentreX} /></Column>
              <Column sm={4} md={8} lg={16}><NumberField id="displayed-width" label="Displayed width" unit="µm" value={viewWidth} min={0.1} max={1e6} step={0.1} onValue={(value) => setViewWidth(bounded(value, viewWidth, 0.1, 1e6))} /></Column>
            </Grid>
            <p className="spin-note">{shapes.length ? `Cell ${topCell} · layers ${availableLayers.join(", ")}. The section currently intersects polygon geometry.` : "Load a GDS or the example to reveal the stack and coating result."}</p>
            {compatibilityWarnings.length > 0 && <InlineNotification className="spin-notification" lowContrast kind="warning" title="Import compatibility review" subtitle={compatibilityWarnings.join(" ")} hideCloseButton />}
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
              <Column sm={4} md={8} lg={16}><div className="spin-slider-field"><Slider id="leveling-strength" labelText="Leveling strength (%)" value={levelingStrength} min={0} max={100} step={1} onChange={({ value }) => setLevelingStrength(bounded(Number(value), levelingStrength, 0, 100))} /><Tag className="spin-provenance-tag" size="sm" type={provenanceTagType[parameterProvenance.levelingStrengthPercent]}>{parameterProvenance.levelingStrengthPercent}</Tag></div></Column>
              <Column sm={4} md={8} lg={16}><NumberField id="leveling-length" label="Lateral leveling length" unit="µm" value={levelingLength} min={0} max={1e6} step={0.5} provenance={parameterProvenance.levelingLengthMicrometers} onValue={(value) => setLevelingLength(bounded(value, levelingLength, 0, 1e6))} /></Column>
            </Grid>
            {photoresistPreset && <Tile className="spin-reference" aria-live="polite"><b>{photoresistPreset.name} · {photoresistPreset.tone}</b>{photoresistPreset.exposureWavelengthsNm && <span>Verified exposure lines: {photoresistPreset.exposureWavelengthsNm.join(", ")} nm.</span>}<span>{photoresistPreset.evidence}. Loaded with generic n = 0.5 and 0% additional shrinkage.</span><Link href={photoresistPreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</Link></Tile>}
            {metalOxidePreset && <Tile className="spin-reference" aria-live="polite"><b>{metalOxidePreset.family} · {metalOxidePreset.name}</b><span>{metalOxidePreset.precursor} on {metalOxidePreset.substrate}. {metalOxidePreset.cycles} coat(s), {metalOxidePreset.spinSeconds} s; {metalOxidePreset.thermalTreatment}. {metalOxidePreset.phase}.</span><span>{metalOxidePreset.evidence}. The loaded value is the published final dry thickness; n = 0.5 remains a generic extrapolation.</span><Link href={metalOxidePreset.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</Link></Tile>}
            <p className="spin-equation">h = {referenceThickness} · ({rpm}/{referenceRpm})<sup>−{exponent}</sup> · (1 − {shrinkage}/100)</p>
            <p className="spin-note">Library values are starting points, not guaranteed recipes. Refit thickness, exponent and leveling to your spinner, substrate and ambient conditions.</p>
          </section>}
        </ScientificTaskPanel>}
      statusBar={<ScientificStatusBar className="spin-status" status={{ state: section ? "up-to-date" : "needs-input", label: section ? "Coating profile ready" : "Load a GDS file or the example to begin" }} metadata={<><ScientificAutosaveStatus status={autosave.status} savedAt={autosave.lastSavedAt} /><dl>
        <div><dt>Layers</dt><dd>{layers.length}</dd></div>
        <div><dt>Film</dt><dd>{section ? `${finalThickness.toFixed(1)} nm` : "—"}</dd></div>
        <div><dt>Cursor</dt><dd>{section ? `${cursorX.toFixed(2)} µm` : "—"}</dd></div>
      </dl></>} />}
    >
        <section className="spin-preview scientific-stage" id="spin-workspace" tabIndex={-1} aria-label="Coating results">
          <h1 className="visually-hidden">SpinCoatSim spin-coating cross-section simulator</h1>
          {section && <ScientificOutcomeSummary
            className="spin-outcome"
            title={fileName || "Coating profile"}
            headingRef={resultHeading}
            status={{ state: "up-to-date", label: "Profile current", detail: lastUpdated ? `Updated ${lastUpdated}` : undefined }}
            summary={`${coatingPreset ? `${coatingPreset.name}${hasReferenceEdits ? " with local edits" : ""}` : "Custom calibration"}. The profile uses the current stack and film model; experimental calibration is still required before process transfer.`}
            actions={[
              { id: "export-png", label: "Export PNG", emphasis: "primary", onClick: exportPng },
              { id: "export-json", label: "Export JSON", emphasis: "secondary", collapseAt: "sm", onClick: exportModel },
            ]}
          />}
          {section && <ResultMetrics dryThickness={dryThickness} section={section} />}
          {exportNotice && <ExportReceipt className="spin-export-notice" fileName={exportNotice.fileName} format={exportNotice.fileName.endsWith(".png") ? "PNG" : "JSON"} destination={exportNotice.context} onDismiss={() => setExportNotice(null)} />}
          {section ? <>
          <SpinCoatCanvas canvasRef={canvas} section={section} cursorIndex={cursorIndex} setCursorIndex={setCursorIndex} cursorX={cursorX} localThickness={localThickness} sliceY={sliceY} viewWidth={viewWidth} xMin={xMin} />

          <ScientificValidationSummary
            className="spin-validation-summary"
            title="Model checks"
            description="Numerical checks for this reduced coating model. Experimental calibration is still required before process transfer."
            status={{
              state: section.ignoredPaths > 0 || compatibilityWarnings.length > 0 || !coatingPreset || hasReferenceEdits ? "warning" : "ready",
              label: section.ignoredPaths > 0 || compatibilityWarnings.length > 0 || !coatingPreset || hasReferenceEdits ? "Review model evidence" : "Model checks passed · experimental validation required",
            }}
            checks={[
              { id: "mass", label: "Coating area", state: "passed", value: `${section.film.meanThicknessNm.toFixed(1)} nm mean · ${section.film.thicknessNonUniformityPercent.toFixed(1)}% non-uniformity`, detail: "The leveling surrogate conserves coating cross-sectional area." },
              { id: "geometry", label: "Imported geometry", state: section.ignoredPaths > 0 || compatibilityWarnings.length > 0 ? "warning" : "passed", value: section.ignoredPaths > 0 || compatibilityWarnings.length > 0 ? `${section.ignoredPaths + compatibilityWarnings.length} import issue(s)` : "No known omissions", detail: compatibilityWarnings[0] },
              { id: "reference", label: "Reference traceability", state: coatingPreset && !hasReferenceEdits ? "passed" : "warning", detail: coatingPreset && !hasReferenceEdits ? `${coatingPreset.name}; source and reference point retained.` : "Custom or edited reference; verify against measured thickness." },
              { id: "calibration", label: "Calibration law", state: "warning", detail: "The exponent is a generic single-reference-point model, not a validated multipoint calibration with uncertainty." },
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
    <Modal
      open={Boolean(pendingGds)}
      modalHeading="Choose the GDS top cell"
      modalLabel="GDS import"
      primaryButtonText="Use selected cell"
      secondaryButtonText="Cancel import"
      primaryButtonDisabled={Boolean(gdsProgress)}
      onRequestSubmit={() => { void applyPendingTopCell(); }}
      onRequestClose={cancelActiveGdsImport}
    >
      <p className="spin-modal-copy">This layout contains more than one top-level cell. Choose the cell whose hierarchy should be flattened for the section.</p>
      {pendingGds && <Select id="spin-top-cell" labelText="Top cell" size="md" value={pendingGds.selectedCell} onChange={(event) => setPendingGds((current) => current ? { ...current, selectedCell: event.target.value } : current)}>
        {pendingGds.topCells.map((cell) => <SelectItem key={cell} value={cell} text={cell} />)}
      </Select>}
      {gdsProgress && <ProgressBar label={gdsProgress.stage} helperText={`${Math.round(gdsProgress.completed * 100)}% complete`} max={100} value={gdsProgress.completed * 100} />}
    </Modal>
  </>);
}
