import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";
import { VectorTilePrimitiveBucket } from "./VectorTileBucketFactory.js";
import {
  createCartesianRing,
  createGroundPolylinePrimitive,
  createOutlineCartesianLines,
  createPrimitive,
  doesStyleRuleMatchMetadata,
  evaluateColorStyleValue,
  evaluateFiniteStyleNumber,
  getStyleRuleHeightOffset,
  isVectorStyleExpression,
  parseCesiumColor,
  requiresGroundHeightOffsetFallback,
  shouldUseGroundPath,
} from "./VectorTileBucketUtils.js";

const Cesium = globalThis.Cesium ?? CesiumModule;

export default class VectorTileFillBucket extends VectorTilePrimitiveBucket {
  constructor(styleRule, options = {}) {
    super(styleRule);
    this._allowPicking = options.allowPicking ?? false;
    this._diagnostics = options.diagnostics;
    this._shadows = options.shadows;
    this._asynchronous = options.asynchronous ?? true;
  }

  build(polygons, zoom, tileContext = {}) {
    if (requiresGroundHeightOffsetFallback(this.styleRule)) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }

    const fillPolygons = createFillPolygonsFromLines(
      polygons,
      tileContext.lines,
    );
    const useGroundPath = shouldUseGroundPath(this.styleRule);
    const polygonInstances = this._createPolygonGeometryInstances(
      fillPolygons,
      zoom,
      useGroundPath,
    );
    if (polygonInstances.length > 0) {
      this.addPrimitive(
        createPrimitive(
          polygonInstances,
          "polygon",
          {
            fillColor: this.styleRule.paint?.["fill-color"] ?? "#ff000077",
            translucent: isFillStyleTranslucent(this.styleRule),
            groundPrimitive: useGroundPath,
          },
          {
            allowPicking: this._allowPicking,
            asynchronous: this._asynchronous,
            diagnostics: this._diagnostics,
            shadows: this._shadows,
          },
        ),
      );
    }

    const outlineInstances = this._createFillOutlineGeometryInstances(
      fillPolygons,
      zoom,
      useGroundPath,
      tileContext.tileBounds,
    );
    if (outlineInstances.length > 0) {
      this.addPrimitive(
        useGroundPath
          ? createGroundPolylinePrimitive(outlineInstances, {
              allowPicking: this._allowPicking,
              diagnostics: this._diagnostics,
            })
          : createPrimitive(
              outlineInstances,
              "line",
              {},
              {
                allowPicking: this._allowPicking,
                asynchronous: this._asynchronous,
                diagnostics: this._diagnostics,
                shadows: this._shadows,
              },
            ),
      );
    }

    return this;
  }

  _createPolygonGeometryInstances(polygons, zoom, useGroundPath) {
    const instances = [];
    const height = useGroundPath
      ? 0.0
      : getStyleRuleHeightOffset(this.styleRule);

    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = polygons.metadata?.[i];
      if (
        !doesStyleRuleMatchMetadata(metadata, 3, this.styleRule, zoom, {
          ignoreZoomRange: true,
        })
      ) {
        continue;
      }

      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      if (firstRing >= lastRing) {
        continue;
      }

      const outerRing = createCartesianRing(polygons, firstRing, height);
      if (outerRing.length < 3) {
        continue;
      }

      const holes = [];
      for (let ringIndex = firstRing + 1; ringIndex < lastRing; ++ringIndex) {
        const hole = createCartesianRing(polygons, ringIndex, height);
        if (hole.length >= 3) {
          holes.push(new Cesium.PolygonHierarchy(hole));
        }
      }

      const polygonOptions = {
        polygonHierarchy: new Cesium.PolygonHierarchy(outerRing, holes),
      };
      if (!useGroundPath) {
        polygonOptions.height = height;
      }

      instances.push(
        new Cesium.GeometryInstance({
          id: this._allowPicking
            ? { ...metadata, layerId: this.styleRule.id }
            : undefined,
          geometry: new Cesium.PolygonGeometry(polygonOptions),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorStyleValue(
                this.styleRule.paint?.["fill-color"],
                metadata,
                zoom,
                "#ff000077",
              ),
            ),
          },
        }),
      );
    }

    return instances;
  }

  _createFillOutlineGeometryInstances(
    polygons,
    zoom,
    useGroundPath,
    tileBounds,
  ) {
    if (
      !this.styleRule.paint ||
      !("fill-outline-color" in this.styleRule.paint)
    ) {
      return [];
    }

    const lineInstances = [];
    const height = useGroundPath
      ? 0.0
      : getStyleRuleHeightOffset(this.styleRule);
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = polygons.metadata?.[i];
      if (
        !doesStyleRuleMatchMetadata(metadata, 3, this.styleRule, zoom, {
          ignoreZoomRange: true,
        })
      ) {
        continue;
      }

      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      for (let ringIndex = firstRing; ringIndex < lastRing; ++ringIndex) {
        const outlineLines = createOutlineCartesianLines(
          polygons,
          ringIndex,
          height,
          tileBounds,
        );
        for (let lineIndex = 0; lineIndex < outlineLines.length; ++lineIndex) {
          const ring = outlineLines[lineIndex];
          if (ring.length < 2) {
            continue;
          }

          const polylineOptions = {
            positions: ring,
            width: evaluateFiniteStyleNumber(
              this.styleRule.paint?.["fill-outline-width"],
              metadata,
              zoom,
              1,
            ),
            arcType: this.styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
          };
          const polyline = useGroundPath
            ? new Cesium.GroundPolylineGeometry(polylineOptions)
            : new Cesium.PolylineGeometry(polylineOptions);
          lineInstances.push(
            new Cesium.GeometryInstance({
              id: this._allowPicking
                ? { ...metadata, layerId: this.styleRule.id }
                : undefined,
              geometry: polyline,
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  evaluateColorStyleValue(
                    this.styleRule.paint?.["fill-outline-color"],
                    metadata,
                    zoom,
                    "#ffffffff",
                  ),
                ),
              },
            }),
          );
        }
      }
    }

    return lineInstances;
  }
}

function isFillStyleTranslucent(styleRule) {
  const fillColor = styleRule.paint?.["fill-color"];
  if (isVectorStyleExpression(fillColor)) {
    return true;
  }
  return parseCesiumColor(fillColor ?? "#ff000077", "#ff000077").alpha < 1.0;
}

function createFillPolygonsFromLines(polygons, lines) {
  const lineRingCount = countLineRings(lines);
  if (lineRingCount === 0) {
    return polygons;
  }

  const polygonPositionCount = polygons?.positions?.length ?? 0;
  const polygonRingCount = Math.max(
    0,
    (polygons?.ringOffsets?.length ?? 0) - 1,
  );
  const polygonCount = Math.max(0, (polygons?.polygonOffsets?.length ?? 0) - 1);
  const linePositionCount = countLineRingPositionValues(lines);
  const positions = new Float64Array(polygonPositionCount + linePositionCount);
  const ringOffsets = new Uint32Array(polygonRingCount + lineRingCount + 1);
  const polygonOffsets = new Uint32Array(polygonCount + lineRingCount + 1);
  const metadata = [];

  if (polygonPositionCount > 0) {
    positions.set(polygons.positions);
  }
  for (let i = 0; i < polygonRingCount; ++i) {
    ringOffsets[i] = polygons.ringOffsets[i];
  }
  ringOffsets[polygonRingCount] =
    polygons?.ringOffsets?.[polygonRingCount] ?? polygonPositionCount / 2;
  for (let i = 0; i < polygonCount; ++i) {
    polygonOffsets[i] = polygons.polygonOffsets[i];
    metadata.push(polygons.metadata?.[i]);
  }
  polygonOffsets[polygonCount] =
    polygons?.polygonOffsets?.[polygonCount] ?? polygonRingCount;

  let positionCursor = polygonPositionCount;
  let ringCursor = polygonRingCount;
  let polygonCursor = polygonCount;
  for (let i = 0; i + 1 < lines.offsets.length; ++i) {
    const linePositionValueCount = getLineRingPositionValueCount(lines, i);
    if (linePositionValueCount === 0) {
      continue;
    }

    const start = lines.offsets[i];
    const end = lines.offsets[i + 1];
    polygonOffsets[polygonCursor] = ringCursor;
    ringOffsets[ringCursor] = positionCursor / 2;
    positions.set(lines.positions.subarray(start * 2, end * 2), positionCursor);
    positionCursor += (end - start) * 2;
    if (!isLineClosed(lines, i)) {
      positions[positionCursor] = lines.positions[start * 2];
      positions[positionCursor + 1] = lines.positions[start * 2 + 1];
      positionCursor += 2;
    }
    ringCursor++;
    polygonCursor++;
    polygonOffsets[polygonCursor] = ringCursor;
    ringOffsets[ringCursor] = positionCursor / 2;
    metadata.push(lines.metadata?.[i]);
  }

  return {
    positions,
    ringOffsets,
    polygonOffsets,
    metadata,
  };
}

function countLineRings(lines) {
  let count = 0;
  for (let i = 0; i + 1 < (lines?.offsets?.length ?? 0); ++i) {
    if (getLineRingPositionValueCount(lines, i) > 0) {
      count++;
    }
  }
  return count;
}

function countLineRingPositionValues(lines) {
  let count = 0;
  for (let i = 0; i + 1 < (lines?.offsets?.length ?? 0); ++i) {
    count += getLineRingPositionValueCount(lines, i);
  }
  return count;
}

function getLineRingPositionValueCount(lines, lineIndex) {
  const start = lines?.offsets?.[lineIndex];
  const end = lines?.offsets?.[lineIndex + 1];
  if (start === undefined || end === undefined) {
    return 0;
  }

  const pointCount = end - start;
  if (isLineClosed(lines, lineIndex)) {
    return pointCount >= 4 ? pointCount * 2 : 0;
  }
  return pointCount >= 3 ? (pointCount + 1) * 2 : 0;
}

function isLineClosed(lines, lineIndex) {
  const start = lines?.offsets?.[lineIndex];
  const end = lines?.offsets?.[lineIndex + 1];
  if (start === undefined || end === undefined || end <= start) {
    return false;
  }
  const firstIndex = start * 2;
  const lastIndex = (end - 1) * 2;
  return (
    lines.positions[firstIndex] === lines.positions[lastIndex] &&
    lines.positions[firstIndex + 1] === lines.positions[lastIndex + 1]
  );
}
