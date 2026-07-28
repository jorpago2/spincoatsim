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

function gaussianSmooth(values, sigmaSamples) {
  if (!Number.isFinite(sigmaSamples) || sigmaSamples < 0) throw new Error("Leveling length must be non-negative.");
  if (sigmaSamples < 0.25) return [...values];
  const radius = Math.min(values.length - 1, Math.ceil(4 * sigmaSamples));
  const kernel = Array.from({ length: radius + 1 }, (_, offset) => Math.exp(-(offset ** 2) / (2 * sigmaSamples ** 2)));
  const reflect = (index) => index < 0 ? -index - 1 : index >= values.length ? 2 * values.length - index - 1 : index;
  // ponytail: direct convolution is fast at 480 samples; use an FFT only if section resolution grows by orders of magnitude.
  return values.map((_, index) => {
    let weightedSum = kernel[0] * values[index];
    let weightSum = kernel[0];
    for (let offset = 1; offset <= radius; offset += 1) {
      const weight = kernel[offset];
      weightedSum += weight * (values[reflect(index - offset)] + values[reflect(index + offset)]);
      weightSum += 2 * weight;
    }
    return weightedSum / weightSum;
  });
}

function profileRange(values) {
  return Math.max(...values) - Math.min(...values);
}

function conservedTopProfile(surface, nominalThicknessNm, levelingStrength, levelingLengthSamples) {
  const fraction = Math.max(0, Math.min(1, levelingStrength));
  const leveledSurface = gaussianSmooth(surface, levelingLengthSamples);
  const base = surface.map((value, index) => value * (1 - fraction) + leveledSurface[index] * fraction);
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

/** Area-conserving geometric approximation with finite-range lateral leveling. */
export function buildSpinFilm(columns, nominalThicknessNm, levelingStrength = 0.65, levelingLengthSamples = columns.length) {
  finitePositive(nominalThicknessNm, "Spin-coated thickness");
  const surface = columns.map((column) => column.at(-1)?.top ?? 0);
  const top = conservedTopProfile(surface, nominalThicknessNm, levelingStrength, levelingLengthSamples);
  const localThickness = top.map((value, index) => value - surface[index]);
  const surfaceRange = profileRange(surface);
  const topRange = profileRange(top);
  const meanThicknessNm = localThickness.reduce((sum, value) => sum + value, 0) / localThickness.length;
  return {
    surface,
    top,
    localThickness,
    minimumThicknessNm: Math.min(...localThickness),
    maximumThicknessNm: Math.max(...localThickness),
    meanThicknessNm,
    degreeOfPlanarizationPercent: surfaceRange > 1e-9 ? 100 * Math.max(0, Math.min(1, 1 - topRange / surfaceRange)) : 100,
    thicknessNonUniformityPercent: meanThicknessNm > 0 ? 100 * profileRange(localThickness) / meanThicknessNm : 0,
  };
}
