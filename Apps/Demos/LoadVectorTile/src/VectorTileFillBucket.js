import * as CesiumModule from "../../../../Build/CesiumUnminified/index.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import {
  createCartesianRing,
  createGroundPolylinePrimitive,
  createOutlineCartesianLines,
  createPrimitive,
  doesStyleRuleMatchMetadata,
  evaluateColorStyleValue,
  evaluateFiniteStyleNumber,
  getStyleRuleHeightOffset,
  getGeometryFeature,
  getGeometryFeatureIndex,
  requiresGroundHeightOffsetFallback,
  shouldUseGroundPath,
} from "./VectorTileBucketUtils.js";

const Cesium = globalThis.Cesium ?? CesiumModule;

/**
 * 为 `fill` 类型样式规则构建面与边界图元。
 *
 * @param {object} styleRule 当前桶对应的样式规则。
 * @param {object} [options={}] 构造参数。
 * @param {boolean} [options.allowPicking=false] 是否为生成的图元启用拾取。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器，用于记录面要素构建指标。
 * @param {Cesium.ShadowMode} [options.shadows] Cesium 阴影模式配置。
 * @param {boolean} [options.asynchronous=true] 是否启用 Cesium 异步几何构建。
 */
export default class VectorTileFillBucket extends VectorTilePrimitiveBucket {
  constructor(styleRule, options = {}) {
    super(styleRule, options);
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
    const polygonBatches = this._createPolygonGeometryInstances(
      fillPolygons,
      zoom,
      useGroundPath,
    );
    // 贴地分类（GroundPrimitive）同一批次共享 stencil，颜色/拾取 pass 只按
    // 实例的包围矩形裁剪片元，包围矩形重叠的实例会互相“抢色”并导致拾取
    // 错误，因此重叠的实例必须拆到不同批次；半透明与不透明也分开成批。
    for (const batch of polygonBatches) {
      if (batch.instances.length === 0) {
        continue;
      }
      this.addPrimitive(
        createPrimitive(
          batch.instances,
          "polygon",
          {
            fillColor: this.styleRule.paint?.["fill-color"] ?? "#ff000077",
            translucent: batch.translucent,
            groundPrimitive: useGroundPath,
          },
          {
            allowPicking: this._allowPicking,
            asynchronous: this._asynchronous,
            diagnostics: this._diagnostics,
            shadows: this._shadows,
          },
        ),
        "fill",
        batch.featureIndices,
      );
    }

    const outlineResult = this._createFillOutlineGeometryInstances(
      fillPolygons,
      zoom,
      useGroundPath,
      tileContext.tileBounds,
    );
    if (outlineResult.instances.length > 0) {
      this.addPrimitive(
        useGroundPath
          ? createGroundPolylinePrimitive(outlineResult.instances, {
              allowPicking: this._allowPicking,
              diagnostics: this._diagnostics,
            })
          : createPrimitive(
              outlineResult.instances,
              "line",
              {},
              {
                allowPicking: this._allowPicking,
                asynchronous: this._asynchronous,
                diagnostics: this._diagnostics,
                shadows: this._shadows,
              },
            ),
        "fill-outline",
        outlineResult.featureIndices,
      );
    }

    return this;
  }

  _createPolygonGeometryInstances(polygons, zoom, useGroundPath) {
    const batches = [];
    const height = useGroundPath
      ? 0.0
      : getStyleRuleHeightOffset(this.styleRule);

    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = getGeometryFeature(this._featureTable, polygons, i);
      const featureIndex = getGeometryFeatureIndex(polygons, i);
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

      const color = evaluateColorStyleValue(
        this.styleRule.paint?.["fill-color"],
        metadata,
        zoom,
        "#ff000077",
        {
          state: this._getFeatureStateForFeature(metadata),
        },
      );
      const translucent = color.alpha < 1.0;
      const bounds = useGroundPath
        ? computeRingDegreesBounds(polygons, firstRing)
        : undefined;
      const batch = findBatchForInstance(batches, translucent, bounds);
      batch.instances.push(
        new Cesium.GeometryInstance({
          id: batch.instances.length,
          geometry: new Cesium.PolygonGeometry(polygonOptions),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
      );
      batch.featureIndices.push(featureIndex);
      if (bounds !== undefined) {
        batch.bounds.push(bounds);
      }
    }

    return batches;
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
      return { instances: [], featureIndices: [] };
    }

    const lineInstances = [];
    const instanceFeatureIndices = [];
    const height = useGroundPath
      ? 0.0
      : getStyleRuleHeightOffset(this.styleRule);
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = getGeometryFeature(this._featureTable, polygons, i);
      const featureIndex = getGeometryFeatureIndex(polygons, i);
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
              id: lineInstances.length,
              geometry: polyline,
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  evaluateColorStyleValue(
                    this.styleRule.paint?.["fill-outline-color"],
                    metadata,
                    zoom,
                    "#ffffffff",
                    {
                      state: this._getFeatureStateForFeature(metadata),
                    },
                  ),
                ),
              },
            }),
          );
          instanceFeatureIndices.push(featureIndex);
        }
      }
    }

    return { instances: lineInstances, featureIndices: instanceFeatureIndices };
  }
}

// 为一个实例挑选可容纳它的批次：半透明性一致，且（贴地时）包围矩形
// 与批内已有实例均不重叠；找不到则新建批次。
function findBatchForInstance(batches, translucent, bounds) {
  for (const batch of batches) {
    if (batch.translucent !== translucent) {
      continue;
    }
    if (
      bounds === undefined ||
      !batch.bounds.some((existing) => doBoundsIntersect(existing, bounds))
    ) {
      return batch;
    }
  }

  const batch = {
    instances: [],
    featureIndices: [],
    bounds: [],
    translucent,
  };
  batches.push(batch);
  return batch;
}

function computeRingDegreesBounds(polygons, ringIndex) {
  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = start; i < end; ++i) {
    const longitude = polygons.positions[i * 2];
    const latitude = polygons.positions[i * 2 + 1];
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return { west, south, east, north };
}

function doBoundsIntersect(a, b) {
  return (
    a.west <= b.east &&
    b.west <= a.east &&
    a.south <= b.north &&
    b.south <= a.north
  );
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
  const featureIndices = new Uint32Array(polygonCount + lineRingCount);
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
    featureIndices[i] = getGeometryFeatureIndex(polygons, i);
    if (polygons.metadata) {
      metadata.push(polygons.metadata[i]);
    }
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
    featureIndices[polygonCursor - 1] = getGeometryFeatureIndex(lines, i);
    if (lines.metadata) {
      metadata.push(lines.metadata[i]);
    }
  }

  return {
    positions,
    ringOffsets,
    polygonOffsets,
    featureIndices,
    ...(metadata.length > 0 ? { metadata } : {}),
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
