import assert from "node:assert/strict";
import test from "node:test";
import { PHOTORESIST_PRESETS } from "../lib/photoresists.js";
import { buildMaterialColumns, buildSpinFilm, calibratedThickness, polygonIntervalsAtY, sampleIntervals } from "../lib/spincoat.js";

test("photoresist references are complete and physically valid", () => {
  assert.ok(PHOTORESIST_PRESETS.length >= 10);
  assert.equal(new Set(PHOTORESIST_PRESETS.map(({ id }) => id)).size, PHOTORESIST_PRESETS.length);
  for (const preset of PHOTORESIST_PRESETS) {
    assert.ok(preset.referenceThicknessNm > 0);
    assert.ok(preset.referenceRpm > 0);
    assert.match(preset.sourceUrl, /^https:\/\//);
  }
});

test("builds an area-conserving coated cross-section from a GDS slice", () => {
  assert.equal(calibratedThickness(200, 1000, 4000, 0.5), 100);
  const shape = { kind: "polygon", layer: 1, points: [{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: -2, y: 1 }] };
  const { intervals } = polygonIntervalsAtY([shape], 1, 0);
  assert.deepEqual(intervals, [[-2, 2]]);
  const mask = sampleIntervals(intervals, -4, 4, 8);
  assert.deepEqual(mask, [false, false, true, true, true, true, false, false]);

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
