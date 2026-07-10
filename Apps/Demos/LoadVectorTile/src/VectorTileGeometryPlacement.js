import { evaluateVectorStyleFilter } from "./VectorTileStyleExpression.js";

const SYMBOL_PLACEMENT_POINT = "point";
const SYMBOL_PLACEMENT_POLYGON_CENTER = "polygon-center";

const GEOMETRY_TYPES_BY_STYLE_RULE = Object.freeze({
  circle: Object.freeze([1]),
  fill: Object.freeze([2, 3]),
  line: Object.freeze([2, 3]),
  symbolPoint: Object.freeze([1]),
  symbolPolygonCenter: Object.freeze([3]),
});

export function normalizeSymbolPlacement(value) {
  return value === SYMBOL_PLACEMENT_POLYGON_CENTER
    ? SYMBOL_PLACEMENT_POLYGON_CENTER
    : SYMBOL_PLACEMENT_POINT;
}

export function getStyleRuleSymbolPlacement(styleRule) {
  return normalizeSymbolPlacement(styleRule?.layout?.["symbol-placement"]);
}

export function getStyleRuleGeometryTypes(styleRule) {
  if (!styleRule) {
    return [];
  }

  if (styleRule.type === "fill") {
    return GEOMETRY_TYPES_BY_STYLE_RULE.fill;
  }

  if (styleRule.type === "circle") {
    return GEOMETRY_TYPES_BY_STYLE_RULE.circle;
  }

  if (styleRule.type === "line") {
    return GEOMETRY_TYPES_BY_STYLE_RULE.line;
  }

  if (styleRule.type === "symbol") {
    return getStyleRuleSymbolPlacement(styleRule) ===
      SYMBOL_PLACEMENT_POLYGON_CENTER
      ? GEOMETRY_TYPES_BY_STYLE_RULE.symbolPolygonCenter
      : GEOMETRY_TYPES_BY_STYLE_RULE.symbolPoint;
  }

  return [];
}

export function doesStyleRuleUseGeometryType(styleRule, geometryType) {
  return getStyleRuleGeometryTypes(styleRule).includes(geometryType);
}

export function doesFeatureMatchAnyStyleRule(
  feature,
  geometryType,
  styleRules,
  context = {},
) {
  for (let i = 0; i < styleRules.length; ++i) {
    const styleRule = styleRules[i];
    if (!doesStyleRuleUseGeometryType(styleRule, geometryType)) {
      continue;
    }
    if (evaluateVectorStyleFilter(styleRule.filter, feature, context)) {
      return true;
    }
  }
  return false;
}

export function filterPackedLayerByStyleRules(
  packedLayer,
  styleRules,
  zoom,
  diagnostics,
) {
  const points = filterPoints(packedLayer.points, styleRules, zoom);
  const lines = filterLines(packedLayer.lines, styleRules, zoom);
  const polygons = filterPolygons(packedLayer.polygons, styleRules, zoom);
  const positionCount =
    points.positions.length / 2 +
    lines.positions.length / 2 +
    polygons.positions.length / 2;
  const featureCount =
    points.metadata.length + lines.metadata.length + polygons.metadata.length;
  const styleFilteredFeatureCount = Math.max(
    0,
    (packedLayer.featureCount ?? 0) - featureCount,
  );

  if (styleFilteredFeatureCount > 0) {
    diagnostics?.increment("mainThreadStyleFilteredFeatures");
  }

  return {
    ...packedLayer,
    featureCount,
    positionCount,
    styleFilteredFeatureCount:
      (packedLayer.styleFilteredFeatureCount ?? 0) + styleFilteredFeatureCount,
    points,
    lines,
    polygons,
  };
}

export function createPolygonCenterPoints(polygons) {
  const positions = [];
  const metadata = [];
  const polygonOffsets = polygons?.polygonOffsets ?? [];

  for (let i = 0; i + 1 < polygonOffsets.length; ++i) {
    const center = computePolygonCenter(polygons, i);
    if (!center) {
      continue;
    }

    positions.push(center.longitude, center.latitude);
    metadata.push(polygons.metadata?.[i]);
  }

  return {
    positions: new Float64Array(positions),
    metadata,
  };
}

function filterPoints(points, styleRules, zoom) {
  const metadata = points.metadata ?? [];
  if (metadata.length === 0 && points.positions.length > 0) {
    return points;
  }

  const positions = [];
  const filteredMetadata = [];
  for (let i = 0; i < points.positions.length / 2; ++i) {
    if (
      !doesFeatureMatchAnyStyleRule(metadata[i], 1, styleRules, {
        zoom,
        level: zoom,
      })
    ) {
      continue;
    }
    positions.push(points.positions[i * 2], points.positions[i * 2 + 1]);
    filteredMetadata.push(metadata[i]);
  }
  return {
    positions: new Float64Array(positions),
    metadata: filteredMetadata,
  };
}

function filterLines(lines, styleRules, zoom) {
  const metadata = lines.metadata ?? [];
  if (metadata.length === 0 && lines.positions.length > 0) {
    return lines;
  }

  const positions = [];
  const offsets = [0];
  const filteredMetadata = [];
  for (let i = 0; i + 1 < lines.offsets.length; ++i) {
    if (
      !doesFeatureMatchAnyStyleRule(metadata[i], 2, styleRules, {
        zoom,
        level: zoom,
      })
    ) {
      continue;
    }
    const start = lines.offsets[i];
    const end = lines.offsets[i + 1];
    for (let j = start * 2; j < end * 2; ++j) {
      positions.push(lines.positions[j]);
    }
    offsets.push(positions.length / 2);
    filteredMetadata.push(metadata[i]);
  }
  return {
    positions: new Float64Array(positions),
    offsets: new Uint32Array(offsets),
    metadata: filteredMetadata,
  };
}

function filterPolygons(polygons, styleRules, zoom) {
  const metadata = polygons.metadata ?? [];
  if (metadata.length === 0 && polygons.positions.length > 0) {
    return polygons;
  }

  const positions = [];
  const ringOffsets = [0];
  const polygonOffsets = [0];
  const filteredMetadata = [];
  for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
    if (
      !doesFeatureMatchAnyStyleRule(metadata[i], 3, styleRules, {
        zoom,
        level: zoom,
      })
    ) {
      continue;
    }
    const firstRing = polygons.polygonOffsets[i];
    const lastRing = polygons.polygonOffsets[i + 1];
    for (let ringIndex = firstRing; ringIndex < lastRing; ++ringIndex) {
      const start = polygons.ringOffsets[ringIndex];
      const end = polygons.ringOffsets[ringIndex + 1];
      if (end <= start) {
        continue;
      }
      for (let j = start * 2; j < end * 2; ++j) {
        positions.push(polygons.positions[j]);
      }
      ringOffsets.push(positions.length / 2);
    }
    polygonOffsets.push(ringOffsets.length - 1);
    filteredMetadata.push(metadata[i]);
  }
  return {
    positions: new Float64Array(positions),
    ringOffsets: new Uint32Array(ringOffsets),
    polygonOffsets: new Uint32Array(polygonOffsets),
    metadata: filteredMetadata,
  };
}

function computePolygonCenter(polygons, polygonIndex) {
  const firstRing = polygons.polygonOffsets[polygonIndex];
  const lastRing = polygons.polygonOffsets[polygonIndex + 1];
  if (
    firstRing === undefined ||
    lastRing === undefined ||
    firstRing >= lastRing
  ) {
    return undefined;
  }

  let weightedLongitude = 0.0;
  let weightedLatitude = 0.0;
  let totalArea = 0.0;

  for (let ringIndex = firstRing; ringIndex < lastRing; ++ringIndex) {
    const centroid = computeRingSignedCentroid(polygons, ringIndex);
    if (!centroid) {
      continue;
    }

    weightedLongitude += centroid.longitude * centroid.area;
    weightedLatitude += centroid.latitude * centroid.area;
    totalArea += centroid.area;
  }

  if (
    !Number.isFinite(totalArea) ||
    totalArea === 0.0 ||
    !Number.isFinite(weightedLongitude) ||
    !Number.isFinite(weightedLatitude)
  ) {
    return undefined;
  }

  const longitude = weightedLongitude / totalArea;
  const latitude = weightedLatitude / totalArea;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return undefined;
  }

  return { longitude, latitude };
}

function computeRingSignedCentroid(polygons, ringIndex) {
  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const pointCount = getOpenRingPointCount(polygons, start, end);
  if (pointCount < 3) {
    return undefined;
  }

  let twiceArea = 0.0;
  let centroidLongitude = 0.0;
  let centroidLatitude = 0.0;

  for (let i = 0; i < pointCount; ++i) {
    const currentIndex = start + i;
    const nextIndex = start + ((i + 1) % pointCount);
    const currentLongitude = polygons.positions[currentIndex * 2];
    const currentLatitude = polygons.positions[currentIndex * 2 + 1];
    const nextLongitude = polygons.positions[nextIndex * 2];
    const nextLatitude = polygons.positions[nextIndex * 2 + 1];
    const cross =
      currentLongitude * nextLatitude - nextLongitude * currentLatitude;

    twiceArea += cross;
    centroidLongitude += (currentLongitude + nextLongitude) * cross;
    centroidLatitude += (currentLatitude + nextLatitude) * cross;
  }

  if (!Number.isFinite(twiceArea) || twiceArea === 0.0) {
    return undefined;
  }

  const longitude = centroidLongitude / (3.0 * twiceArea);
  const latitude = centroidLatitude / (3.0 * twiceArea);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return undefined;
  }

  return {
    area: twiceArea / 2.0,
    longitude,
    latitude,
  };
}

function getOpenRingPointCount(polygons, start, end) {
  const pointCount = end - start;
  if (pointCount <= 1) {
    return pointCount;
  }

  const firstLongitude = polygons.positions[start * 2];
  const firstLatitude = polygons.positions[start * 2 + 1];
  const lastLongitude = polygons.positions[(end - 1) * 2];
  const lastLatitude = polygons.positions[(end - 1) * 2 + 1];
  if (firstLongitude === lastLongitude && firstLatitude === lastLatitude) {
    return pointCount - 1;
  }
  return pointCount;
}
