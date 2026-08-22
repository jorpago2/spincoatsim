import assert from "node:assert/strict";
import test from "node:test";
import { filterMetalOxides, METAL_OXIDE_PRESETS } from "../lib/metal-oxides.js";
import { filterPhotoresists, PHOTORESIST_EXPOSURE_WAVELENGTHS, PHOTORESIST_PRESETS } from "../lib/photoresists.js";
import { buildMaterialColumns, buildSpinFilm, calibratedThickness, polygonIntervalsAtY, sampleIntervals } from "../lib/spincoat.js";
import { flattenGds, parseGds } from "../lib/gds.js";

test("photoresist references are complete and physically valid", () => {
  assert.ok(PHOTORESIST_PRESETS.length >= 60);
  assert.equal(new Set(PHOTORESIST_PRESETS.map(({ id }) => id)).size, PHOTORESIST_PRESETS.length);
  for (const preset of PHOTORESIST_PRESETS) {
    assert.ok(preset.referenceThicknessNm > 0);
    assert.ok(preset.referenceRpm > 0);
    assert.match(preset.sourceUrl, /^https:\/\//);
  }
  const negativeKayaku = filterPhotoresists("Negative", "Kayaku");
  assert.ok(negativeKayaku.length > 0);
  assert.ok(negativeKayaku.every((preset) => preset.tone.startsWith("Negative") && preset.manufacturer === "Kayaku"));
  assert.deepEqual(filterPhotoresists("Image reversal", "AZ / Merck").map(({ id }) => id), ["az-5214e"]);
  assert.deepEqual(filterPhotoresists("Image reversal", "TI / MicroChemicals").map(({ id }) => id), ["ti-35e"]);
  assert.deepEqual(PHOTORESIST_EXPOSURE_WAVELENGTHS, [405]);
  const resists405nm = filterPhotoresists("", "", 405);
  assert.ok(resists405nm.length >= 20);
  assert.ok(resists405nm.every((preset) => preset.exposureWavelengthsNm.includes(405)));
  assert.deepEqual(filterPhotoresists("Negative", "Allresist", 405).map(({ id }) => id), ["ar-n-4340", "ar-n-4400-10"]);
});

test("metal-oxide references identify a reproducible published process", () => {
  assert.equal(METAL_OXIDE_PRESETS.length, 9);
  assert.equal(new Set(METAL_OXIDE_PRESETS.map(({ id }) => id)).size, METAL_OXIDE_PRESETS.length);
  for (const preset of METAL_OXIDE_PRESETS) {
    assert.ok(preset.referenceThicknessNm > 0);
    assert.ok(preset.referenceRpm > 0);
    assert.ok(preset.spinSeconds > 0);
    assert.ok(preset.cycles > 0);
    assert.match(preset.sourceUrl, /^https:\/\//);
  }
  assert.deepEqual(filterMetalOxides("VO₂").map(({ id }) => id), ["vo2-chae-2006"]);
  assert.deepEqual(filterMetalOxides("In₂O₃").map(({ id }) => id), ["in2o3-kul-2017"]);
  assert.deepEqual(filterMetalOxides("ITO").map(({ id }) => id), ["ito-jafari-2014"]);
});

test("builds an area-conserving coated cross-section from a GDS slice", () => {
  assert.equal(calibratedThickness(200, 1000, 4000, 0.5), 100);
  const shape = { kind: "polygon", layer: 1, points: [{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: -2, y: 1 }] };
  const { intervals } = polygonIntervalsAtY([shape], 1, 0);
  assert.deepEqual(intervals, [[-2, 2]]);
  const mask = sampleIntervals(intervals, -4, 4, 8);
  assert.deepEqual(mask, [0, 0, 1, 1, 1, 1, 0, 0]);

  const columns = buildMaterialColumns({
    count: 8,
    substrate: { name: "Si", color: "gray", thicknessNm: 500 },
    layers: [{ name: "ridge", color: "gold", mode: "patterned", thicknessNm: 100, mask }],
  });
  const film = buildSpinFilm(columns, 200, 0.8);
  assert.ok(Math.abs(film.meanThicknessNm - 200) < 1e-8);
  assert.ok(film.maximumThicknessNm > film.minimumThicknessNm);
  assert.equal(film.surface[3], 100);
  assert.equal(film.surface[0], 0);
});

test("distinguishes a real section crossing from an outside or tangent section", () => {
  const shape = { kind: "polygon", layer: 1, points: [{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: -2, y: 1 }] };
  const inside = polygonIntervalsAtY([shape], 1, 0);
  const tangent = polygonIntervalsAtY([shape], 1, 1);
  const tangentAtLowerBoundary = polygonIntervalsAtY([shape], 1, -1);
  const outside = polygonIntervalsAtY([shape], 1, 1000);
  assert.ok(inside.intervals.length > 0);
  assert.equal(inside.touchesBoundary, false);
  assert.deepEqual(tangent.intervals, []);
  assert.equal(tangent.touchesBoundary, true);
  assert.deepEqual(tangentAtLowerBoundary.intervals, []);
  assert.equal(tangentAtLowerBoundary.touchesBoundary, true);
  assert.deepEqual(outside.intervals, []);
  assert.equal(outside.touchesBoundary, false);
});

test("fractional cells preserve sub-grid feature area under translation", () => {
  const width = 100;
  const count = 480;
  const centered = sampleIntervals([[-0.05, 0.05]], -50, 50, count);
  const shifted = sampleIntervals([[0.05, 0.15]], -50, 50, count);
  const representedWidth = (mask) => mask.reduce((sum, coverage) => sum + coverage, 0) * width / count;
  assert.ok(Math.abs(representedWidth(centered) - 0.1) < 1e-12);
  assert.ok(Math.abs(representedWidth(shifted) - 0.1) < 1e-12);
});

test("rejects an expansive GDS array before materializing it", () => {
  const model = {
    unitMicrometers: 1,
    structures: new Map([
      ["TOP", { elements: [{ kind: 0x0b, sname: "UNIT", rows: 65_535, columns: 65_535, mag: 1, angle: 0, reflect: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] }],
      ["UNIT", { elements: [{ kind: 0x08, layer: 1, datatype: 0, width: 0, pathType: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] }],
    ]),
  };
  assert.throws(() => flattenGds(model, "TOP", { maxInstances: 1_000, maxShapes: 1_000, maxPoints: 10_000 }), /AREF.*safety limit/);
});

test("preserves absolute PATH width through referenced magnification", () => {
  const record = (type, data = new Uint8Array()) => {
    const result = new Uint8Array(4 + data.length);
    new DataView(result.buffer).setUint16(0, result.length, false);
    result[2] = type;
    result.set(data, 4);
    return result;
  };
  const text = (value) => new TextEncoder().encode(`${value}\0`);
  const int32s = (values) => {
    const data = new Uint8Array(values.length * 4);
    const view = new DataView(data.buffer);
    values.forEach((value, index) => view.setInt32(index * 4, value, false));
    return data;
  };
  const int16 = (value) => {
    const data = new Uint8Array(2);
    new DataView(data.buffer).setInt16(0, value, false);
    return data;
  };
  const int32 = (value) => {
    const data = new Uint8Array(4);
    new DataView(data.buffer).setInt32(0, value, false);
    return data;
  };
  const join = (records) => {
    const result = new Uint8Array(records.reduce((size, current) => size + current.length, 0));
    let offset = 0;
    for (const current of records) {
      result.set(current, offset);
      offset += current.length;
    }
    return result.buffer;
  };
  const top = [
    record(0x05), record(0x06, text("TOP")), record(0x0a), record(0x12, text("CHILD")),
    record(0x1b, Uint8Array.from([0x41, 0x20, 0, 0, 0, 0, 0, 0])),
    record(0x10, int32s([0, 0])), record(0x11), record(0x07),
  ];
  const child = [
    record(0x05), record(0x06, text("CHILD")), record(0x09), record(0x0d, int16(1)),
    record(0x0e, int16(0)), record(0x0f, int32(-10)), record(0x10, int32s([0, 0, 100, 0])),
    record(0x11), record(0x07),
  ];
  const model = parseGds(join([...top, ...child]));
  const [shape] = flattenGds(model, "TOP");
  assert.equal(shape.width, 0.01);
});

test("caps etching at the displayed substrate depth", () => {
  const columns = buildMaterialColumns({
    count: 2,
    substrate: { name: "Si", color: "gray", thicknessNm: 500 },
    layers: [{ name: "deep etch", color: "", mode: "etch", thicknessNm: 800, mask: [true, false] }],
  });
  assert.equal(columns[0].at(-1).top, -500);
  assert.equal(columns[1].at(-1).top, 0);
});

test("finite-range leveling conserves area and smooths narrow features more strongly", () => {
  const makeFilm = (ridgeWidth, count = 64) => {
    const start = (count - ridgeWidth) / 2;
    const mask = Array.from({ length: count }, (_, index) => index >= start && index < start + ridgeWidth);
    const columns = buildMaterialColumns({
      count,
      substrate: { name: "Si", color: "gray", thicknessNm: 500 },
      layers: [{ name: "ridge", color: "gold", mode: "patterned", thicknessNm: 100, mask }],
    });
    return buildSpinFilm(columns, 200, 0.8, 6 * count / 64);
  };

  const narrow = makeFilm(4);
  const wide = makeFilm(32);
  const refinedNarrow = makeFilm(8, 128);
  assert.ok(Math.abs(narrow.meanThicknessNm - 200) < 1e-8);
  assert.ok(Math.abs(wide.meanThicknessNm - 200) < 1e-8);
  assert.ok(narrow.degreeOfPlanarizationPercent > wide.degreeOfPlanarizationPercent);
  assert.ok(Math.abs(narrow.degreeOfPlanarizationPercent - refinedNarrow.degreeOfPlanarizationPercent) < 0.5);
});
