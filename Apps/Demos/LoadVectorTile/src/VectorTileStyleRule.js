/**
 * Cesium-oriented runtime representation of one external style document layer.
 * The external document keeps Mapbox-like `layers`; internally we treat each
 * entry as a style rule that can be attached to a VectorTileProvider.
 */
export default class VectorTileStyleRule {
  constructor(layer) {
    this.id = layer.id;
    this.type = layer.type;
    this.source = layer.source;
    this.sourceLayer = layer.sourceLayer;
    this.minzoom = layer.minzoom;
    this.maxzoom = layer.maxzoom;
    this.filter = cloneValue(layer.filter);
    this.layout = cloneValue(layer.layout ?? {});
    this.paint = cloneValue(layer.paint ?? {});
    this.terrain = cloneValue(layer.terrain ?? {});
    this.visibility = layer.visibility ?? true;
    this.metadata = cloneValue(layer.metadata ?? {});
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      source: this.source,
      sourceLayer: this.sourceLayer,
      minzoom: this.minzoom,
      maxzoom: this.maxzoom,
      filter: cloneValue(this.filter),
      layout: cloneValue(this.layout),
      paint: cloneValue(this.paint),
      terrain: cloneValue(this.terrain),
      visibility: this.visibility,
      metadata: cloneValue(this.metadata),
    };
  }
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

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
