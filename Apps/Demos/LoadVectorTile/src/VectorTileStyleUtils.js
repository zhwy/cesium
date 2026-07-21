import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";
import CommonUtils from "./CommonUtils.js";
import VectorTileFeatureStateUtils from "./VectorTileFeatureStateUtils.js";
import VectorTileGeometryPlacementUtils from "./VectorTileGeometryPlacementUtils.js";
import VectorTileStyleUpdateType from "./VectorTileStyleUpdateType.js";

const VALID_LAYER_TYPES = new Set(["fill", "line", "symbol", "circle"]);
const SUPPORTED_COLOR_PROPERTIES = Object.freeze({
  line: new Set(["line-color"]),
  fill: new Set(["fill-color", "fill-outline-color"]),
  circle: new Set(["circle-color", "circle-outline-color"]),
  symbol: new Set(["text-color", "text-halo-color", "text-background-color"]),
});
const DEFAULT_STYLE_ZOOM_TILE_WIDTH = 512;
const WEB_MERCATOR_EQUATORIAL_RADIUS = 6378137.0;
const WEB_MERCATOR_CIRCUMFERENCE =
  2.0 * Math.PI * WEB_MERCATOR_EQUATORIAL_RADIUS;

class VectorTileStyleUtils {
  /**
   * 规范化并校验外部矢量瓦片样式文档。
   * 文档层仍保留类似 Mapbox 的 `sources` / `layers` 字段命名，便于配置迁移；
   * 运行时则会把这些定义映射到偏 Cesium 的 provider、style rule 与 primitive bucket 概念上。
   *
   * @param {object} styleDocument
   * @returns {object}
   */
  static normalizeStyleDocument(styleDocument) {
    if (!CommonUtils.isPlainObject(styleDocument)) {
      throw new Error("styleDocument must be an object.");
    }

    const sources = normalizeSources(styleDocument.sources);
    const layers = normalizeLayers(styleDocument.layers, sources);

    return {
      version: styleDocument.version ?? 1,
      sources,
      layers,
      metadata: CommonUtils.cloneValue(styleDocument.metadata ?? {}),
    };
  }

  static createVectorTileStyleUpdatePlan(
    previousLayer,
    nextLayer,
    options = {},
  ) {
    const changedPaths = collectChangedPaths(previousLayer, nextLayer);
    if (changedPaths.length === 0) {
      return {
        type: VectorTileStyleUpdateType.NO_OP,
        changedPaths,
      };
    }

    const colorProperties = SUPPORTED_COLOR_PROPERTIES[nextLayer?.type];
    const supportsInPlace =
      previousLayer?.type === nextLayer?.type &&
      changedPaths.every(
        (path) =>
          path === "visibility" ||
          (path.startsWith("paint.") &&
            colorProperties?.has(path.slice("paint.".length))),
      );
    if (!supportsInPlace) {
      return {
        type: VectorTileStyleUpdateType.REBUILD_SOURCE,
        changedPaths,
        reason: "STRUCTURAL_STYLE_CHANGE",
      };
    }

    if (options.bucketRebuildReason) {
      return {
        type: VectorTileStyleUpdateType.REBUILD_BUCKET,
        changedPaths,
        reason: options.bucketRebuildReason,
      };
    }

    return {
      type: VectorTileStyleUpdateType.IN_PLACE_APPEARANCE,
      changedPaths,
    };
  }

  /**
   * 根据相机高度计算当前帧统一使用的样式缩放级别。
   * 该值不依赖具体数据瓦片或回退瓦片的 LOD，因此同一帧中远近瓦片的图层可见性保持一致。
   *
   * @param {object} frameState Cesium 的 `frameState`。
   * @param {object} [options]
   * @param {number} [options.tileSize=512] 地图库风格使用的瓦片宽度。
   * @param {object} [options.scene] Cesium 场景，用于查询地形高度。
   * @returns {number}
   */
  static computeCameraVectorTileStyleZoom(frameState, options = {}) {
    const camera = frameState?.camera;
    const cartographic = camera?.positionCartographic;
    if (!camera || !cartographic) {
      return 0;
    }

    const height = getCameraHeightAboveGround(cartographic, options);
    const viewportHeight = getViewportHeight(frameState);
    const metersPerPixel = getMetersPerPixel(
      camera.frustum,
      height,
      viewportHeight,
    );
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
      return 0;
    }

    const latitudeScale = Math.max(0.01, Math.cos(cartographic.latitude ?? 0));
    const tileWidth = getTileSize(options.tileSize);
    return Math.max(
      0,
      Math.log2(
        (WEB_MERCATOR_CIRCUMFERENCE * latitudeScale) /
          (tileWidth * metersPerPixel),
      ),
    );
  }
}

function normalizeSources(sources) {
  if (!CommonUtils.isPlainObject(sources)) {
    throw new Error("styleDocument.sources must be an object.");
  }

  const ids = Object.keys(sources);
  if (ids.length === 0) {
    throw new Error("styleDocument.sources must contain at least one source.");
  }

  const result = {};
  ids.forEach((sourceId) => {
    const source = sources[sourceId];
    if (!CommonUtils.isPlainObject(source)) {
      throw new Error(`source "${sourceId}" must be an object.`);
    }
    const type = source.type ?? "vector";
    if (type !== "vector") {
      throw new Error(`source "${sourceId}" type must be "vector".`);
    }
    validatePickProperties(source.pickProperties, sourceId);
    const promoteId = VectorTileFeatureStateUtils.normalizePromoteId(
      source.promoteId,
      sourceId,
    );
    result[sourceId] = {
      ...CommonUtils.cloneValue(source),
      type,
      ...(promoteId === undefined
        ? {}
        : { promoteId: CommonUtils.cloneValue(promoteId) }),
      pickProperties:
        source.pickProperties === undefined
          ? undefined
          : [...source.pickProperties],
    };
  });
  return result;
}

function validatePickProperties(pickProperties, sourceId) {
  if (pickProperties === undefined) {
    return;
  }
  if (!Array.isArray(pickProperties)) {
    throw new Error(`source "${sourceId}" pickProperties must be an array.`);
  }

  const names = new Set();
  pickProperties.forEach((propertyName, index) => {
    if (!CommonUtils.isNonEmptyString(propertyName)) {
      throw new Error(
        `source "${sourceId}" pickProperties[${index}] must be a non-empty string.`,
      );
    }
    if (names.has(propertyName)) {
      throw new Error(
        `source "${sourceId}" pickProperties must not contain duplicate property "${propertyName}".`,
      );
    }
    names.add(propertyName);
  });
}

function normalizeLayers(layers, sources) {
  if (!Array.isArray(layers)) {
    throw new Error("styleDocument.layers must be an array.");
  }

  const ids = new Set();
  return layers.map((layer, index) => {
    if (!CommonUtils.isPlainObject(layer)) {
      throw new Error(`layer at index ${index} must be an object.`);
    }

    const id = layer.id;
    if (!CommonUtils.isNonEmptyString(id)) {
      throw new Error(`layer at index ${index} must have a non-empty id.`);
    }
    if (ids.has(id)) {
      throw new Error(`layer id "${id}" must be unique.`);
    }
    ids.add(id);

    const type = layer.type;
    if (!VALID_LAYER_TYPES.has(type)) {
      throw new Error(
        `layer "${id}" type must be one of: ${[...VALID_LAYER_TYPES].join(", ")}.`,
      );
    }

    if (!CommonUtils.isNonEmptyString(layer.source)) {
      throw new Error(`layer "${id}" must reference a source.`);
    }
    if (!Object.prototype.hasOwnProperty.call(sources, layer.source)) {
      throw new Error(
        `layer "${id}" references missing source "${layer.source}".`,
      );
    }

    if (!CommonUtils.isNonEmptyString(layer.sourceLayer)) {
      throw new Error(`layer "${id}" must define sourceLayer.`);
    }

    VectorTileStyleExpressionUtils.validateVectorStyleFilter(
      layer.filter,
      `layer "${id}" filter`,
    );
    validateNoFeatureState(layer.filter, `layer "${id}" filter`, id, "filter");

    const layout = CommonUtils.cloneValue(layer.layout ?? {});
    validateStyleObjectFeatureStateUsage(layout, id, "layout", type);
    if (type === "symbol") {
      layout["symbol-placement"] =
        VectorTileGeometryPlacementUtils.normalizeSymbolPlacement(
          layout["symbol-placement"],
        );
    }
    const paint = CommonUtils.cloneValue(layer.paint ?? {});
    validateStyleObjectFeatureStateUsage(paint, id, "paint", type);

    return {
      id,
      type,
      source: layer.source,
      sourceLayer: layer.sourceLayer,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      filter: CommonUtils.cloneValue(layer.filter),
      layout,
      paint,
      terrain: {
        clampToGround: layer.terrain?.clampToGround ?? false,
        heightOffset: layer.terrain?.heightOffset ?? 0.0,
        ...CommonUtils.cloneValue(layer.terrain ?? {}),
      },
      visibility: normalizeLayerVisibility(layer, id),
      metadata: CommonUtils.cloneValue(layer.metadata ?? {}),
    };
  });
}

function validateStyleObjectFeatureStateUsage(
  styleObject,
  layerId,
  scope,
  type,
) {
  Object.entries(styleObject ?? {}).forEach(([field, value]) => {
    if (Array.isArray(value) && typeof value[0] === "string") {
      VectorTileStyleExpressionUtils.validateVectorStyleExpression(
        value,
        `layer "${layerId}" ${scope}.${field}`,
      );
    }
    if (
      !VectorTileStyleExpressionUtils.hasVectorStyleFeatureStateDependency(
        value,
      )
    ) {
      return;
    }
    if (scope !== "paint" || !isFeatureStatePaintFieldAllowed(type, field)) {
      throw new Error(
        `layer "${layerId}" ${scope}.${field} cannot use feature-state; feature-state is only supported in line-color, fill-color, and fill-outline-color paint fields.`,
      );
    }
  });
}

function validateNoFeatureState(value, path, layerId, field) {
  if (
    !VectorTileStyleExpressionUtils.hasVectorStyleFeatureStateDependency(value)
  ) {
    return;
  }
  throw new Error(
    `${path} cannot use feature-state; layer "${layerId}" ${field} is not a supported feature-state color field.`,
  );
}

function isFeatureStatePaintFieldAllowed(type, field) {
  return (
    (type === "line" && field === "line-color") ||
    (type === "fill" &&
      (field === "fill-color" || field === "fill-outline-color"))
  );
}

function normalizeLayerVisibility(layer, layerId) {
  const value = layer.visibility ?? layer.layout?.visibility;
  if (value === undefined || value === true || value === "visible") {
    return true;
  }
  if (value === false || value === "none") {
    return false;
  }
  throw new Error(
    `layer "${layerId}" visibility must be true, false, "visible", or "none".`,
  );
}

function collectChangedPaths(previousValue, nextValue, path = "") {
  if (areStyleValuesEqual(previousValue, nextValue)) {
    return [];
  }

  if (
    !CommonUtils.isPlainObject(previousValue) ||
    !CommonUtils.isPlainObject(nextValue)
  ) {
    return [path];
  }

  const paths = [];
  const keys = new Set([
    ...Object.keys(previousValue),
    ...Object.keys(nextValue),
  ]);
  for (const key of keys) {
    const childPath = path ? `${path}.${key}` : key;
    paths.push(
      ...collectChangedPaths(previousValue[key], nextValue[key], childPath),
    );
  }
  return paths.sort();
}

function areStyleValuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areStyleValuesEqual(value, right[index]))
    );
  }
  if (!CommonUtils.isPlainObject(left) || !CommonUtils.isPlainObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        areStyleValuesEqual(left[key], right[key]),
    )
  );
}

function getCameraHeightAboveGround(cartographic, options) {
  const ellipsoidHeight = Number(cartographic.height);
  let terrainHeight = 0.0;
  const globe = options.scene?.globe ?? options.globe;
  if (globe?.getHeight) {
    const height = globe.getHeight(cartographic);
    if (Number.isFinite(height)) {
      terrainHeight = height;
    }
  }
  return Math.max(1.0, ellipsoidHeight - terrainHeight);
}

function getViewportHeight(frameState) {
  const context = frameState?.context;
  const height =
    context?.drawingBufferHeight ??
    context?.canvas?.height ??
    context?.canvas?.clientHeight ??
    1;
  return Math.max(1, height);
}

function getMetersPerPixel(frustum, height, viewportHeight) {
  if (Number.isFinite(frustum?.fovy)) {
    return (2.0 * height * Math.tan(frustum.fovy * 0.5)) / viewportHeight;
  }

  if (Number.isFinite(frustum?.top) && Number.isFinite(frustum?.bottom)) {
    return Math.abs(frustum.top - frustum.bottom) / viewportHeight;
  }

  return undefined;
}

function getTileSize(tileSize) {
  return Number.isFinite(tileSize) && tileSize > 0
    ? tileSize
    : DEFAULT_STYLE_ZOOM_TILE_WIDTH;
}

export default VectorTileStyleUtils;
