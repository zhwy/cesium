import {
  defined,
  Cartesian3,
  Color,
  GroundPolylinePrimitive,
  GroundPrimitive,
  PerInstanceColorAppearance,
  PolylineColorAppearance,
  Primitive,
} from "../../../../Build/CesiumUnminified/index.js";
import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";
import VectorTileGeometryPlacementUtils from "./VectorTileGeometryPlacementUtils.js";
import VectorTileGeometryUtils from "./VectorTileGeometryUtils.js";

function isVectorStyleExpression(value) {
  return Array.isArray(value) && typeof value[0] === "string";
}

function getGeometryFeature(featureTable, geometry, index) {
  const featureIndex = geometry?.featureIndices?.[index];
  if (featureIndex !== undefined) {
    return featureTable?.[featureIndex];
  }
  return geometry?.metadata?.[index];
}

function getGeometryFeatureIndex(geometry, index) {
  return geometry?.featureIndices?.[index] ?? index;
}

function evaluateStyleValue(value, metadata, zoom, fallback, options = {}) {
  if (!defined(value)) {
    return fallback;
  }

  const result = isVectorStyleExpression(value)
    ? VectorTileStyleExpressionUtils.evaluateVectorStyleExpression(value, {
        properties: metadata?.properties ?? {},
        state: options.state ?? {},
        id: metadata?.id,
        zoom,
        level: zoom,
      })
    : value;
  return defined(result) ? result : fallback;
}

function evaluateFiniteStyleNumber(
  value,
  metadata,
  zoom,
  fallback,
  options = {},
) {
  const result = evaluateStyleValue(value, metadata, zoom, fallback, options);
  if (!defined(result)) {
    return fallback;
  }

  const numeric = Number(result);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseCesiumColor(value, fallback) {
  if (typeof value !== "string") {
    return Color.fromCssColorString(fallback);
  }
  return Color.fromCssColorString(value) ?? Color.fromCssColorString(fallback);
}

function evaluateColorStyleValue(
  value,
  metadata,
  zoom,
  fallback,
  options = {},
) {
  return parseCesiumColor(
    evaluateStyleValue(value, metadata, zoom, fallback, options),
    fallback,
  );
}

function doesStyleRuleMatchMetadata(
  metadata,
  geometryType,
  styleRule,
  zoom,
  options = {},
) {
  return (
    VectorTileGeometryPlacementUtils.doesStyleRuleUseGeometryType(
      styleRule,
      geometryType,
    ) &&
    (options.ignoreZoomRange || isZoomInRange(zoom, styleRule)) &&
    VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(
      styleRule.filter,
      metadata,
      {
        zoom,
        level: zoom,
      },
    )
  );
}

function isZoomInRange(zoom, styleRule) {
  return (
    (styleRule.minzoom === undefined || zoom >= styleRule.minzoom) &&
    (styleRule.maxzoom === undefined || zoom < styleRule.maxzoom)
  );
}

function getStyleRuleHeightOffset(styleRule) {
  const heightOffset = Number(styleRule.terrain?.heightOffset ?? 0.0);
  return Number.isFinite(heightOffset) ? heightOffset : 0.0;
}

function shouldUseGroundPath(styleRule) {
  return (
    styleRule.terrain?.clampToGround === true &&
    getStyleRuleHeightOffset(styleRule) === 0.0
  );
}

function requiresGroundHeightOffsetFallback(styleRule) {
  return (
    styleRule.terrain?.clampToGround === true &&
    getStyleRuleHeightOffset(styleRule) !== 0.0
  );
}

function createPrimitive(geometryInstances, geometryType, style, options = {}) {
  options.diagnostics?.increment(
    "createdGeometryInstances",
    geometryInstances.length,
  );

  const primitive = style.groundPrimitive
    ? new GroundPrimitive({
        geometryInstances,
        appearance: createAppearance(geometryType, style),
        shadows: options.shadows,
        allowPicking: options.allowPicking,
        asynchronous: true,
        releaseGeometryInstances: true,
      })
    : new Primitive({
        geometryInstances,
        appearance: createAppearance(geometryType, style),
        shadows: options.shadows,
        allowPicking: options.allowPicking,
        asynchronous: options.asynchronous,
        releaseGeometryInstances: true,
        compressVertices: true,
      });

  if (style.groundPrimitive) {
    options.diagnostics?.increment("createdGroundPrimitives");
  }
  options.diagnostics?.increment("createdPrimitives");
  return primitive;
}

function createGroundPolylinePrimitive(geometryInstances, options = {}) {
  const createGroundPolyline =
    options.createGroundPolylinePrimitive ??
    ((primitiveOptions) => new GroundPolylinePrimitive(primitiveOptions));
  const primitive = createGroundPolyline({
    geometryInstances,
    appearance: new PolylineColorAppearance(),
    allowPicking: options.allowPicking,
    asynchronous: true,
    releaseGeometryInstances: true,
  });
  options.diagnostics?.increment("createdGroundPolylinePrimitives");
  options.diagnostics?.increment("createdPrimitives");
  return primitive;
}

function createCartesianLine(lines, lineIndex, height = 0.0) {
  const start = lines.offsets[lineIndex];
  const end = lines.offsets[lineIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cartesian3.fromDegrees(
      lines.positions[i * 2],
      lines.positions[i * 2 + 1],
      height,
    );
  }
  return positions;
}

function createCartesianRing(polygons, ringIndex, height = 0.0) {
  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cartesian3.fromDegrees(
      polygons.positions[i * 2],
      polygons.positions[i * 2 + 1],
      height,
    );
  }
  return positions;
}

function createOutlineCartesianLines(
  polygons,
  ringIndex,
  height = 0.0,
  tileBounds,
) {
  if (!tileBounds) {
    return [
      closeCartesianRing(createCartesianRing(polygons, ringIndex, height)),
    ];
  }

  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const pointCount = getOpenRingPointCount(polygons, start, end);
  if (pointCount < 2) {
    return [];
  }

  const lines = [];
  let currentLine = [];
  for (let i = 0; i < pointCount; ++i) {
    const currentIndex = start + i;
    const nextIndex = start + ((i + 1) % pointCount);
    const currentPoint = getPackedPolygonPoint(polygons, currentIndex);
    const nextPoint = getPackedPolygonPoint(polygons, nextIndex);
    if (
      VectorTileGeometryUtils.isTileBoundarySegment(
        currentPoint,
        nextPoint,
        tileBounds,
      )
    ) {
      if (currentLine.length >= 2) {
        lines.push(currentLine);
      }
      currentLine = [];
      continue;
    }

    if (currentLine.length === 0) {
      currentLine.push(
        Cartesian3.fromDegrees(
          currentPoint.longitude,
          currentPoint.latitude,
          height,
        ),
      );
    }
    currentLine.push(
      Cartesian3.fromDegrees(nextPoint.longitude, nextPoint.latitude, height),
    );
  }

  if (currentLine.length >= 2) {
    lines.push(currentLine);
  }
  return lines;
}

function createAppearance(geometryType, style) {
  if (geometryType === "line") {
    return new PolylineColorAppearance();
  }

  if (geometryType === "polygon") {
    const fillColor = parseCesiumColor(
      style.fillColor || "#ff000077",
      "#ff000077",
    );
    return new PerInstanceColorAppearance({
      flat: true,
      translucent: style.translucent ?? fillColor.alpha < 1.0,
      closed: false,
    });
  }

  return undefined;
}

function closeCartesianRing(ring) {
  if (ring.length === 0) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Cartesian3.equals(first, last)) {
    return ring;
  }
  return [...ring, first];
}

function getOpenRingPointCount(polygons, start, end) {
  const pointCount = end - start;
  if (pointCount <= 1) {
    return pointCount;
  }

  const first = getPackedPolygonPoint(polygons, start);
  const last = getPackedPolygonPoint(polygons, end - 1);
  if (first.longitude === last.longitude && first.latitude === last.latitude) {
    return pointCount - 1;
  }
  return pointCount;
}

function getPackedPolygonPoint(polygons, index) {
  return {
    longitude: polygons.positions[index * 2],
    latitude: polygons.positions[index * 2 + 1],
  };
}

export default class VectorTileBucketUtils {
  static isVectorStyleExpression(value) {
    return isVectorStyleExpression(value);
  }

  static getGeometryFeature(featureTable, geometry, index) {
    return getGeometryFeature(featureTable, geometry, index);
  }

  static getGeometryFeatureIndex(geometry, index) {
    return getGeometryFeatureIndex(geometry, index);
  }

  static evaluateStyleValue(value, metadata, zoom, fallback, options = {}) {
    return evaluateStyleValue(value, metadata, zoom, fallback, options);
  }

  static evaluateFiniteStyleNumber(
    value,
    metadata,
    zoom,
    fallback,
    options = {},
  ) {
    return evaluateFiniteStyleNumber(value, metadata, zoom, fallback, options);
  }

  static parseCesiumColor(value, fallback) {
    return parseCesiumColor(value, fallback);
  }

  static evaluateColorStyleValue(
    value,
    metadata,
    zoom,
    fallback,
    options = {},
  ) {
    return evaluateColorStyleValue(value, metadata, zoom, fallback, options);
  }

  static doesStyleRuleMatchMetadata(
    metadata,
    geometryType,
    styleRule,
    zoom,
    options = {},
  ) {
    return doesStyleRuleMatchMetadata(
      metadata,
      geometryType,
      styleRule,
      zoom,
      options,
    );
  }

  static isZoomInRange(zoom, styleRule) {
    return isZoomInRange(zoom, styleRule);
  }

  static getStyleRuleHeightOffset(styleRule) {
    return getStyleRuleHeightOffset(styleRule);
  }

  static shouldUseGroundPath(styleRule) {
    return shouldUseGroundPath(styleRule);
  }

  static requiresGroundHeightOffsetFallback(styleRule) {
    return requiresGroundHeightOffsetFallback(styleRule);
  }

  static createPrimitive(geometryInstances, geometryType, style, options = {}) {
    return createPrimitive(geometryInstances, geometryType, style, options);
  }

  static createGroundPolylinePrimitive(geometryInstances, options = {}) {
    return createGroundPolylinePrimitive(geometryInstances, options);
  }

  static createCartesianLine(lines, lineIndex, height = 0.0) {
    return createCartesianLine(lines, lineIndex, height);
  }

  static createCartesianRing(polygons, ringIndex, height = 0.0) {
    return createCartesianRing(polygons, ringIndex, height);
  }

  static createOutlineCartesianLines(
    polygons,
    ringIndex,
    height = 0.0,
    tileBounds,
  ) {
    return createOutlineCartesianLines(polygons, ringIndex, height, tileBounds);
  }
}
