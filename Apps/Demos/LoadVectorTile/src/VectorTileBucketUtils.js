import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import { evaluateVectorStyleFilter } from "./VectorStyleFilter.js";
import { evaluateVectorStyleExpression } from "./VectorStyleExpression.js";
import { doesStyleRuleUseGeometryType } from "./VectorTileGeometryPlacement.js";
import { isTileBoundarySegment } from "./VectorTileGeometryUtils.js";

export function isDefined(value) {
  return value !== undefined && value !== null;
}

export function isVectorStyleExpression(value) {
  return Array.isArray(value) && typeof value[0] === "string";
}

export function evaluateStyleValue(value, metadata, zoom, fallback) {
  if (!isDefined(value)) {
    return fallback;
  }

  const result = isVectorStyleExpression(value)
    ? evaluateVectorStyleExpression(value, {
        properties: metadata?.properties ?? {},
        id: metadata?.id,
        zoom,
        level: zoom,
      })
    : value;
  return isDefined(result) ? result : fallback;
}

export function evaluateFiniteStyleNumber(value, metadata, zoom, fallback) {
  const result = evaluateStyleValue(value, metadata, zoom, fallback);
  if (!isDefined(result)) {
    return fallback;
  }

  const numeric = Number(result);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function parseCesiumColor(value, fallback) {
  return (
    Cesium.Color.fromCssColorString(value) ??
    Cesium.Color.fromCssColorString(fallback)
  );
}

export function evaluateColorStyleValue(value, metadata, zoom, fallback) {
  return parseCesiumColor(
    evaluateStyleValue(value, metadata, zoom, fallback),
    fallback,
  );
}

export function doesStyleRuleMatchMetadata(
  metadata,
  geometryType,
  styleRule,
  zoom,
  options = {},
) {
  return (
    doesStyleRuleUseGeometryType(styleRule, geometryType) &&
    (options.ignoreZoomRange || isZoomInRange(zoom, styleRule)) &&
    evaluateVectorStyleFilter(styleRule.filter, metadata, {
      zoom,
      level: zoom,
    })
  );
}

export function isZoomInRange(zoom, styleRule) {
  return (
    (styleRule.minzoom === undefined || zoom >= styleRule.minzoom) &&
    (styleRule.maxzoom === undefined || zoom < styleRule.maxzoom)
  );
}

export function getStyleRuleHeightOffset(styleRule) {
  const heightOffset = Number(styleRule.terrain?.heightOffset ?? 0.0);
  return Number.isFinite(heightOffset) ? heightOffset : 0.0;
}

export function shouldUseGroundPath(styleRule) {
  return (
    styleRule.terrain?.clampToGround === true &&
    getStyleRuleHeightOffset(styleRule) === 0.0
  );
}

export function requiresGroundHeightOffsetFallback(styleRule) {
  return (
    styleRule.terrain?.clampToGround === true &&
    getStyleRuleHeightOffset(styleRule) !== 0.0
  );
}

export function createPrimitive(
  geometryInstances,
  geometryType,
  style,
  options = {},
) {
  options.diagnostics?.increment(
    "createdGeometryInstances",
    geometryInstances.length,
  );

  const primitive = style.groundPrimitive
    ? new Cesium.GroundPrimitive({
        geometryInstances,
        appearance: createAppearance(geometryType, style),
        shadows: options.shadows,
        allowPicking: options.allowPicking,
        asynchronous: true,
        releaseGeometryInstances: true,
      })
    : new Cesium.Primitive({
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

export function createGroundPolylinePrimitive(geometryInstances, options = {}) {
  const primitive = new Cesium.GroundPolylinePrimitive({
    geometryInstances,
    appearance: new Cesium.PolylineColorAppearance(),
    allowPicking: options.allowPicking,
    asynchronous: true,
    releaseGeometryInstances: true,
  });
  options.diagnostics?.increment("createdGroundPolylinePrimitives");
  options.diagnostics?.increment("createdPrimitives");
  return primitive;
}

export function createCartesianLine(lines, lineIndex, height = 0.0) {
  const start = lines.offsets[lineIndex];
  const end = lines.offsets[lineIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cesium.Cartesian3.fromDegrees(
      lines.positions[i * 2],
      lines.positions[i * 2 + 1],
      height,
    );
  }
  return positions;
}

export function createCartesianRing(polygons, ringIndex, height = 0.0) {
  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cesium.Cartesian3.fromDegrees(
      polygons.positions[i * 2],
      polygons.positions[i * 2 + 1],
      height,
    );
  }
  return positions;
}

export function createOutlineCartesianLines(
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
    if (isTileBoundarySegment(currentPoint, nextPoint, tileBounds)) {
      if (currentLine.length >= 2) {
        lines.push(currentLine);
      }
      currentLine = [];
      continue;
    }

    if (currentLine.length === 0) {
      currentLine.push(
        Cesium.Cartesian3.fromDegrees(
          currentPoint.longitude,
          currentPoint.latitude,
          height,
        ),
      );
    }
    currentLine.push(
      Cesium.Cartesian3.fromDegrees(
        nextPoint.longitude,
        nextPoint.latitude,
        height,
      ),
    );
  }

  if (currentLine.length >= 2) {
    lines.push(currentLine);
  }
  return lines;
}

function createAppearance(geometryType, style) {
  if (geometryType === "line") {
    return new Cesium.PolylineColorAppearance();
  }

  if (geometryType === "polygon") {
    const fillColor = parseCesiumColor(
      style.fillColor || "#ff000077",
      "#ff000077",
    );
    return new Cesium.PerInstanceColorAppearance({
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
  if (Cesium.Cartesian3.equals(first, last)) {
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
