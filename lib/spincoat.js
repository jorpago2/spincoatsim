function finitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

/** Empirical dry-film law fitted to measurements from one sol and one spinner. */
export function calibratedThickness(referenceThicknessNm, referenceRpm, rpm, exponent = 0.5) {
  finitePositive(referenceThicknessNm, "Reference thickness");
  finitePositive(referenceRpm, "Reference speed");
  finitePositive(rpm, "Spin speed");
  if (!Number.isFinite(exponent) || exponent < 0 || exponent > 2) throw new Error("Exponent must be between 0 and 2.");
  return referenceThicknessNm * (rpm / referenceRpm) ** -exponent;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

/** Intersect GDS polygons with a horizontal section line. PATH elements are reported but omitted. */
export function polygonIntervalsAtY(shapes, layer, y) {
  const intervals = [];
  let ignoredPaths = 0;
  for (const shape of shapes) {
    if (shape.layer !== layer) continue;
    if (shape.kind !== "polygon") {
      ignoredPaths += 1;
      continue;
    }
    const crossings = [];
    for (let index = 0; index < shape.points.length; index += 1) {
      const start = shape.points[index];
      const end = shape.points[(index + 1) % shape.points.length];
      if ((start.y <= y && end.y > y) || (end.y <= y && start.y > y)) {
        crossings.push(start.x + ((y - start.y) * (end.x - start.x)) / (end.y - start.y));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) intervals.push([crossings[index], crossings[index + 1]]);
  }
  return { intervals: mergeIntervals(intervals), ignoredPaths };
}

export function sampleIntervals(intervals, minX, maxX, count) {
  if (!Number.isInteger(count) || count < 2) throw new Error("Sample count must be at least 2.");
  if (!(maxX > minX)) throw new Error("Section maximum must exceed its minimum.");
  return Array.from({ length: count }, (_, index) => {
    const x = minX + ((index + 0.5) / count) * (maxX - minX);
    return intervals.some(([start, end]) => x >= start && x <= end);
  });
}

function etchColumn(column, depthNm) {
  let remaining = depthNm;
  while (remaining > 0 && column.length) {
    const top = column.at(-1);
    const thickness = top.top - top.bottom;
    if (thickness <= remaining) {
      if (column.length === 1) {
        top.top = top.bottom;
        return;
      }
      remaining -= thickness;
      column.pop();
    } else {
      top.top -= remaining;
      remaining = 0;
    }
  }
}

/** Build vertical material columns from uniform, patterned and etch operations. */
export function buildMaterialColumns({ count, substrate, layers }) {
  if (!Number.isInteger(count) || count < 2) throw new Error("Column count must be at least 2.");
  const substrateThicknessNm = finitePositive(substrate.thicknessNm, "Displayed substrate thickness");
  const columns = Array.from({ length: count }, () => [{
    name: substrate.name,
    color: substrate.color,
    bottom: -substrateThicknessNm,
    top: 0,
  }]);

  for (const layer of layers) {
    const thicknessNm = finitePositive(layer.thicknessNm, `${layer.name} thickness`);
    if (layer.mode !== "uniform" && (!Array.isArray(layer.mask) || layer.mask.length !== count)) {
      throw new Error(`${layer.name} requires a mask matching the section resolution.`);
    }
    columns.forEach((column, index) => {
      if (layer.mode === "etch") {
        if (layer.mask[index]) etchColumn(column, thicknessNm);
        return;
      }
      if (layer.mode === "patterned" && !layer.mask[index]) return;
      const bottom = column.at(-1)?.top ?? -substrateThicknessNm;
      column.push({ name: layer.name, color: layer.color, bottom, top: bottom + thicknessNm });
    });
  }
  return columns;
}

function conservedTopProfile(surface, nominalThicknessNm, planarization) {
  const fraction = Math.max(0, Math.min(1, planarization));
  const meanSurface = surface.reduce((sum, value) => sum + value, 0) / surface.length;
  const base = surface.map((value) => value * (1 - fraction) + meanSurface * fraction);
  const minimumCoverage = nominalThicknessNm * (1 - fraction);
  const targetArea = nominalThicknessNm * surface.length;
  let low = -Math.max(...surface.map(Math.abs), nominalThicknessNm) * 2;
  let high = Math.max(...surface.map(Math.abs), nominalThicknessNm) * 4 + nominalThicknessNm;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const shift = (low + high) / 2;
    const area = base.reduce((sum, value, index) => sum + Math.max(surface[index] + minimumCoverage, value + shift) - surface[index], 0);
    if (area < targetArea) low = shift;
    else high = shift;
  }
  const shift = (low + high) / 2;
  return base.map((value, index) => Math.max(surface[index] + minimumCoverage, value + shift));
}

/** Area-conserving geometric approximation between conformal and ideally planar coating. */
export function buildSpinFilm(columns, nominalThicknessNm, planarization = 0.65) {
  finitePositive(nominalThicknessNm, "Spin-coated thickness");
  const surface = columns.map((column) => column.at(-1)?.top ?? 0);
  const top = conservedTopProfile(surface, nominalThicknessNm, planarization);
  const localThickness = top.map((value, index) => value - surface[index]);
  return {
    surface,
    top,
    localThickness,
    minimumThicknessNm: Math.min(...localThickness),
    maximumThicknessNm: Math.max(...localThickness),
    meanThicknessNm: localThickness.reduce((sum, value) => sum + value, 0) / localThickness.length,
  };
}


