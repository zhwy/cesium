import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";

const SYMBOL_PLACEMENT_POINT = "point";
const SYMBOL_PLACEMENT_POLYGON_CENTER = "polygon-center";

const GEOMETRY_TYPES_BY_STYLE_RULE = Object.freeze({
  circle: Object.freeze([1]),
  fill: Object.freeze([2, 3]),
  line: Object.freeze([2, 3]),
  symbolPoint: Object.freeze([1]),
  symbolPolygonCenter: Object.freeze([3]),
});

class VectorTileGeometryPlacementUtils {
  static normalizeSymbolPlacement(value) {
    return normalizeSymbolPlacement(value);
  }

  static getStyleRuleSymbolPlacement(styleRule) {
    return getStyleRuleSymbolPlacement(styleRule);
  }

  static doesStyleRuleUseGeometryType(styleRule, geometryType) {
    return doesStyleRuleUseGeometryType(styleRule, geometryType);
  }

  static doesFeatureMatchAnyStyleRule(
    feature,
    geometryType,
    styleRules,
    context = {},
  ) {
    return doesFeatureMatchAnyStyleRule(
      feature,
      geometryType,
      styleRules,
      context,
    );
  }

  static filterPackedLayerByStyleRules(
    packedLayer,
    styleRules,
    zoom,
    diagnostics,
  ) {
    const points = filterPoints(packedLayer, styleRules, zoom);
    const lines = filterLines(packedLayer, styleRules, zoom);
    const polygons = filterPolygons(packedLayer, styleRules, zoom);
    const positionCount =
      points.positions.length / 2 +
      lines.positions.length / 2 +
      polygons.positions.length / 2;
    const featureCount =
      points.featureIndices.length +
      lines.featureIndices.length +
      polygons.featureIndices.length;
    const styleFilteredFeatureCount = Math.max(
      0,
      (packedLayer.featureCount ?? 0) - featureCount,
    );

    if (styleFilteredFeatureCount > 0) {
      diagnostics?.increment("mainThreadStyleFilteredFeatures");
    }

    return compactPackedLayerFeatures({
      ...packedLayer,
      featureCount,
      positionCount,
      styleFilteredFeatureCount:
        (packedLayer.styleFilteredFeatureCount ?? 0) +
        styleFilteredFeatureCount,
      points,
      lines,
      polygons,
    });
  }

  static createPolygonCenterPoints(polygons) {
    const positions = [];
    const featureIndices = [];
    const polygonOffsets = polygons?.polygonOffsets ?? [];

    for (let i = 0; i + 1 < polygonOffsets.length; ++i) {
      const center = computePolygonCenter(polygons, i);
      if (!center) {
        continue;
      }

      positions.push(center.longitude, center.latitude);
      featureIndices.push(polygons.featureIndices?.[i] ?? 0);
    }

    return {
      positions: new Float64Array(positions),
      featureIndices: new Uint32Array(featureIndices),
    };
  }
}

function normalizeSymbolPlacement(value) {
  return value === SYMBOL_PLACEMENT_POLYGON_CENTER
    ? SYMBOL_PLACEMENT_POLYGON_CENTER
    : SYMBOL_PLACEMENT_POINT;
}

function getStyleRuleSymbolPlacement(styleRule) {
  return normalizeSymbolPlacement(styleRule?.layout?.["symbol-placement"]);
}

function getStyleRuleGeometryTypes(styleRule) {
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

function doesStyleRuleUseGeometryType(styleRule, geometryType) {
  return getStyleRuleGeometryTypes(styleRule).includes(geometryType);
}

function doesFeatureMatchAnyStyleRule(
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
    if (
      VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(
        styleRule.filter,
        feature,
        context,
      )
    ) {
      return true;
    }
  }
  return false;
}

function getPackedLayerFeature(packedLayer, featureIndex) {
  return packedLayer?.features?.[featureIndex];
}

function filterPoints(packedLayer, styleRules, zoom) {
  const points = packedLayer.points;

  const positions = [];
  const featureIndices = [];
  for (let i = 0; i < points.positions.length / 2; ++i) {
    const featureIndex = points.featureIndices[i];
    if (
      !doesFeatureMatchAnyStyleRule(
        getPackedLayerFeature(packedLayer, featureIndex),
        1,
        styleRules,
        {
          zoom,
          level: zoom,
        },
      )
    ) {
      continue;
    }
    positions.push(points.positions[i * 2], points.positions[i * 2 + 1]);
    featureIndices.push(featureIndex);
  }
  return {
    positions: new Float64Array(positions),
    featureIndices: new Uint32Array(featureIndices),
  };
}

function filterLines(packedLayer, styleRules, zoom) {
  const lines = packedLayer.lines;

  const positions = [];
  const offsets = [0];
  const featureIndices = [];
  for (let i = 0; i + 1 < lines.offsets.length; ++i) {
    const featureIndex = lines.featureIndices[i];
    if (
      !doesFeatureMatchAnyStyleRule(
        getPackedLayerFeature(packedLayer, featureIndex),
        2,
        styleRules,
        {
          zoom,
          level: zoom,
        },
      )
    ) {
      continue;
    }
    const start = lines.offsets[i];
    const end = lines.offsets[i + 1];
    for (let j = start * 2; j < end * 2; ++j) {
      positions.push(lines.positions[j]);
    }
    offsets.push(positions.length / 2);
    featureIndices.push(featureIndex);
  }
  return {
    positions: new Float64Array(positions),
    offsets: new Uint32Array(offsets),
    featureIndices: new Uint32Array(featureIndices),
  };
}

function filterPolygons(packedLayer, styleRules, zoom) {
  const polygons = packedLayer.polygons;

  const positions = [];
  const ringOffsets = [0];
  const polygonOffsets = [0];
  const featureIndices = [];
  for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
    const featureIndex = polygons.featureIndices[i];
    if (
      !doesFeatureMatchAnyStyleRule(
        getPackedLayerFeature(packedLayer, featureIndex),
        3,
        styleRules,
        {
          zoom,
          level: zoom,
        },
      )
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
    featureIndices.push(featureIndex);
  }
  return {
    positions: new Float64Array(positions),
    ringOffsets: new Uint32Array(ringOffsets),
    polygonOffsets: new Uint32Array(polygonOffsets),
    featureIndices: new Uint32Array(featureIndices),
  };
}

function compactPackedLayerFeatures(packedLayer) {
  const used = new Set([
    ...packedLayer.points.featureIndices,
    ...packedLayer.lines.featureIndices,
    ...packedLayer.polygons.featureIndices,
  ]);
  const remap = new Map();
  const features = [];
  [...used]
    .sort((left, right) => left - right)
    .forEach((oldIndex) => {
      remap.set(oldIndex, features.length);
      features.push(packedLayer.features[oldIndex]);
    });
  return {
    ...packedLayer,
    features,
    points: remapGeometryFeatureIndices(packedLayer.points, remap),
    lines: remapGeometryFeatureIndices(packedLayer.lines, remap),
    polygons: remapGeometryFeatureIndices(packedLayer.polygons, remap),
  };
}

function remapGeometryFeatureIndices(geometry, remap) {
  return {
    ...geometry,
    featureIndices: Uint32Array.from(geometry.featureIndices, (featureIndex) =>
      remap.get(featureIndex),
    ),
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

export default VectorTileGeometryPlacementUtils;
