import { validateVectorStyleFilter } from "./VectorTileStyleExpression.js";
import { normalizeSymbolPlacement } from "./VectorTileGeometryPlacement.js";

const VALID_LAYER_TYPES = new Set(["fill", "line", "symbol"]);

const CESIUM_STYLE_IMPLEMENTATION_TERMS = Object.freeze([
  "VectorTileDataProvider",
  "VectorTileStyleRule",
  "VectorTilePrimitiveBucket",
  "VectorTileSymbolBucket",
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

/**
 * Creates a style document from the previous `manager.addLayer({ url, styles })`
 * shortcut.  This is a compatibility adapter only; later implementation stages
 * can use the normalized document directly without changing the public entry
 * point.
 *
 * @param {object} options
 * @returns {object}
 */
export function createStyleDocumentFromLegacyOptions(options = {}) {
  const sourceId = getLegacySourceId(options);
  const source = createLegacySource(options);
  const layers = [];
  const styles = options.styles || {};

  Object.keys(styles).forEach((sourceLayer) => {
    const style = styles[sourceLayer] || {};
    const baseId = `${sourceId}-${sourceLayer}`;
    if (hasFillStyle(style)) {
      layers.push({
        id: `${baseId}-fill`,
        type: "fill",
        source: sourceId,
        sourceLayer,
        paint: legacyFillPaint(style),
        terrain: legacyTerrain(style),
      });
    }
    if (hasLineStyle(style)) {
      layers.push({
        id: `${baseId}-line`,
        type: "line",
        source: sourceId,
        sourceLayer,
        paint: legacyLinePaint(style),
        terrain: legacyTerrain(style),
      });
    }
  });

  return normalizeStyleDocument({
    version: 1,
    sources: {
      [sourceId]: source,
    },
    layers,
  });
}

/**
 * Converts the normalized style document back into the current legacy
 * VectorTileLayer options.  This keeps the first implementation step small:
 * users can call `setStyle()` now, while later tasks replace this adapter with
 * shared DataProvider / StyleRule rendering.
 *
 * @param {object} styleDocument
 * @returns {object[]}
 */
export function createLegacyLayerOptionsFromStyleDocument(styleDocument) {
  const normalized = normalizeStyleDocument(styleDocument);
  const bySource = new Map();

  Object.keys(normalized.sources).forEach((sourceId) => {
    bySource.set(sourceId, {
      sourceId,
      source: normalized.sources[sourceId],
      styles: {},
    });
  });

  normalized.layers.forEach((layer) => {
    const entry = bySource.get(layer.source);
    if (!entry || layer.type === "symbol") {
      return;
    }

    let style = entry.styles[layer.sourceLayer];
    if (!style) {
      style = {};
      entry.styles[layer.sourceLayer] = style;
    }

    if (layer.type === "fill") {
      Object.assign(style, fillPaintToLegacyStyle(layer));
    } else if (layer.type === "line") {
      Object.assign(style, linePaintToLegacyStyle(layer));
    }
  });

  return [...bySource.values()]
    .filter((entry) => Object.keys(entry.styles).length > 0)
    .map((entry) => ({
      ...sourceToLegacyOptions(entry.source),
      styles: entry.styles,
      sourceId: entry.sourceId,
      styleSourceId: entry.sourceId,
    }));
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

function getLegacySourceId(options) {
  if (isNonEmptyString(options.sourceId)) {
    return options.sourceId;
  }
  if (isNonEmptyString(options.id)) {
    return options.id;
  }
  if (isNonEmptyString(options.layer)) {
    return options.layer.replace(/(.*:)/g, "");
  }
  return "legacy-source";
}

function createLegacySource(options) {
  const result = {};
  Object.keys(options).forEach((key) => {
    if (
      key === "styles" ||
      key === "styleDocument" ||
      key === "sourceId" ||
      key === "id"
    ) {
      return;
    }
    result[key] = cloneValue(options[key]);
  });
  result.type = "vector";
  return result;
}

function sourceToLegacyOptions(source) {
  const result = {};
  Object.keys(source).forEach((key) => {
    if (key === "type") {
      return;
    }
    result[key] = cloneValue(source[key]);
  });
  return result;
}

function hasFillStyle(style) {
  return (
    style.fill === true ||
    isDefined(style.fillColor) ||
    style.fillOutline === true ||
    isDefined(style.fillOutlineColor) ||
    isDefined(style.fillOutlineWidth)
  );
}

function hasLineStyle(style) {
  return isDefined(style.lineColor) || isDefined(style.lineWidth);
}

function legacyFillPaint(style) {
  const paint = {};
  if (isDefined(style.fillColor)) {
    paint["fill-color"] = cloneValue(style.fillColor);
  }
  if (isDefined(style.fillOutlineColor)) {
    paint["fill-outline-color"] = cloneValue(style.fillOutlineColor);
  }
  if (isDefined(style.fillOutlineWidth)) {
    paint["fill-outline-width"] = cloneValue(style.fillOutlineWidth);
  }
  return paint;
}

function legacyLinePaint(style) {
  const paint = {};
  if (isDefined(style.lineColor)) {
    paint["line-color"] = cloneValue(style.lineColor);
  }
  if (isDefined(style.lineWidth)) {
    paint["line-width"] = cloneValue(style.lineWidth);
  }
  return paint;
}

function legacyTerrain(style) {
  const terrain = {};
  if (isDefined(style.height)) {
    terrain.heightOffset = style.height;
  }
  if (isDefined(style.clampToGround)) {
    terrain.clampToGround = style.clampToGround;
  }
  return terrain;
}

function fillPaintToLegacyStyle(layer) {
  const paint = layer.paint || {};
  const style = {
    fill: true,
  };
  if (isDefined(paint["fill-color"])) {
    style.fillColor = cloneValue(paint["fill-color"]);
  }
  if (isDefined(paint["fill-outline-color"])) {
    style.fillOutline = true;
    style.fillOutlineColor = cloneValue(paint["fill-outline-color"]);
  }
  if (isDefined(paint["fill-outline-width"])) {
    style.fillOutline = true;
    style.fillOutlineWidth = cloneValue(paint["fill-outline-width"]);
  }
  if (isDefined(layer.terrain?.heightOffset)) {
    style.height = layer.terrain.heightOffset;
  }
  return style;
}

function linePaintToLegacyStyle(layer) {
  const paint = layer.paint || {};
  const style = {};
  if (isDefined(paint["line-color"])) {
    style.lineColor = cloneValue(paint["line-color"]);
  }
  if (isDefined(paint["line-width"])) {
    style.lineWidth = cloneValue(paint["line-width"]);
  }
  return style;
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

function isDefined(value) {
  return value !== undefined && value !== null;
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
