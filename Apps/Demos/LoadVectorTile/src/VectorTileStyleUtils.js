import {
  hasVectorStyleFeatureStateDependency,
  validateVectorStyleFilter,
  validateVectorStyleExpression,
} from "./VectorTileStyleExpression.js";
import { normalizePromoteId } from "./VectorTileFeatureState.js";
import { normalizeSymbolPlacement } from "./VectorTileGeometryPlacement.js";

const VALID_LAYER_TYPES = new Set(["fill", "line", "symbol", "circle"]);

export const CESIUM_STYLE_IMPLEMENTATION_TERMS = Object.freeze([
  "VectorTileProvider",
  "VectorTileStyleRule",
  "VectorTilePrimitiveBucket",
  "VectorTileSymbolBucket",
  "VectorTileCircleBucket",
]);

/**
 * 规范化并校验外部矢量瓦片样式文档。
 * 文档层仍保留类似 Mapbox 的 `sources` / `layers` 字段命名，便于配置迁移；
 * 运行时则会把这些定义映射到偏 Cesium 的 provider、style rule 与 primitive bucket 概念上。
 *
 * @param {object} styleDocument
 * @returns {object}
 */
export function normalizeStyleDocument(styleDocument) {
  if (!isPlainObject(styleDocument)) {
    throw new Error("styleDocument must be an object.");
  }

  const sources = normalizeSources(styleDocument.sources);
  const layers = normalizeLayers(styleDocument.layers, sources);

  return {
    version: styleDocument.version ?? 1,
    sources,
    layers,
    metadata: cloneValue(styleDocument.metadata ?? {}),
  };
}

function normalizeSources(sources) {
  if (!isPlainObject(sources)) {
    throw new Error("styleDocument.sources must be an object.");
  }

  const ids = Object.keys(sources);
  if (ids.length === 0) {
    throw new Error("styleDocument.sources must contain at least one source.");
  }

  const result = {};
  ids.forEach((sourceId) => {
    const source = sources[sourceId];
    if (!isPlainObject(source)) {
      throw new Error(`source "${sourceId}" must be an object.`);
    }
    const type = source.type ?? "vector";
    if (type !== "vector") {
      throw new Error(`source "${sourceId}" type must be "vector".`);
    }
    validatePickProperties(source.pickProperties, sourceId);
    const promoteId = normalizePromoteId(source.promoteId, sourceId);
    result[sourceId] = {
      ...cloneValue(source),
      type,
      ...(promoteId === undefined ? {} : { promoteId: cloneValue(promoteId) }),
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
    if (!isNonEmptyString(propertyName)) {
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
    if (!isPlainObject(layer)) {
      throw new Error(`layer at index ${index} must be an object.`);
    }

    const id = layer.id;
    if (!isNonEmptyString(id)) {
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

    if (!isNonEmptyString(layer.source)) {
      throw new Error(`layer "${id}" must reference a source.`);
    }
    if (!Object.prototype.hasOwnProperty.call(sources, layer.source)) {
      throw new Error(
        `layer "${id}" references missing source "${layer.source}".`,
      );
    }

    if (!isNonEmptyString(layer.sourceLayer)) {
      throw new Error(`layer "${id}" must define sourceLayer.`);
    }

    validateVectorStyleFilter(layer.filter, `layer "${id}" filter`);
    validateNoFeatureState(layer.filter, `layer "${id}" filter`, id, "filter");

    const layout = cloneValue(layer.layout ?? {});
    validateStyleObjectFeatureStateUsage(layout, id, "layout", type);
    if (type === "symbol") {
      layout["symbol-placement"] = normalizeSymbolPlacement(
        layout["symbol-placement"],
      );
    }
    const paint = cloneValue(layer.paint ?? {});
    validateStyleObjectFeatureStateUsage(paint, id, "paint", type);

    return {
      id,
      type,
      source: layer.source,
      sourceLayer: layer.sourceLayer,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      filter: cloneValue(layer.filter),
      layout,
      paint,
      terrain: {
        clampToGround: layer.terrain?.clampToGround ?? false,
        heightOffset: layer.terrain?.heightOffset ?? 0.0,
        ...cloneValue(layer.terrain ?? {}),
      },
      visibility: normalizeLayerVisibility(layer, id),
      metadata: cloneValue(layer.metadata ?? {}),
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
      validateVectorStyleExpression(
        value,
        `layer "${layerId}" ${scope}.${field}`,
      );
    }
    if (!hasVectorStyleFeatureStateDependency(value)) {
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
  if (!hasVectorStyleFeatureStateDependency(value)) {
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

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isPlainObject(value)) {
    const result = {};
    Object.keys(value).forEach((key) => {
      result[key] = cloneValue(value[key]);
    });
    return result;
  }
  return value;
}
