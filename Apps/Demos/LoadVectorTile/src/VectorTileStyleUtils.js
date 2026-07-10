import { validateVectorStyleFilter } from "./VectorTileStyleExpression.js";
import { normalizeSymbolPlacement } from "./VectorTileGeometryPlacement.js";

const VALID_LAYER_TYPES = new Set(["fill", "line", "symbol", "circle"]);

const CESIUM_STYLE_IMPLEMENTATION_TERMS = Object.freeze([
  "VectorTileProvider",
  "VectorTileStyleRule",
  "VectorTilePrimitiveBucket",
  "VectorTileSymbolBucket",
  "VectorTileCircleBucket",
]);

/**
 * Normalizes and validates the external vector tile style document.  The
 * document intentionally keeps Mapbox-like `sources` / `layers` field names for
 * configuration familiarity, while the runtime implementation maps those
 * entries onto Cesium-oriented provider, style-rule, and primitive-bucket
 * concepts.
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

export { CESIUM_STYLE_IMPLEMENTATION_TERMS };

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
    result[sourceId] = {
      ...cloneValue(source),
      type,
    };
  });
  return result;
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

    const layout = cloneValue(layer.layout ?? {});
    if (type === "symbol") {
      layout["symbol-placement"] = normalizeSymbolPlacement(
        layout["symbol-placement"],
      );
    }

    return {
      id,
      type,
      source: layer.source,
      sourceLayer: layer.sourceLayer,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      filter: cloneValue(layer.filter),
      layout,
      paint: cloneValue(layer.paint ?? {}),
      terrain: {
        clampToGround: layer.terrain?.clampToGround ?? false,
        heightOffset: layer.terrain?.heightOffset ?? 0.0,
        ...cloneValue(layer.terrain ?? {}),
      },
      visibility: layer.visibility ?? layer.layout?.visibility ?? true,
      metadata: cloneValue(layer.metadata ?? {}),
    };
  });
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
