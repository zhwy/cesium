import { createLegacyLayerOptionsFromStyleDocument } from "./VectorTileStyleUtils.js";

/**
 * A Cesium-oriented data-provider wrapper for one external style document
 * source.  It owns the provider used for tile availability and requests, and
 * gathers the style rules that consume this source.
 */
export default class VectorTileDataProvider {
  constructor(options) {
    this.sourceId = options.sourceId;
    this.source = cloneValue(options.source);
    this._provider = options.provider;
    this._styleRules = [];
    this._options = { ...this._provider._options };
    this.setStyleRules(options.styleRules ?? []);
  }

  get minimumLevel() {
    return this._provider.minimumLevel;
  }

  get maximumLevel() {
    return this._provider.maximumLevel;
  }

  get tilingScheme() {
    return this._provider.tilingScheme;
  }

  get resource() {
    return this._provider.resource;
  }

  set resource(value) {
    this._provider.resource = value;
  }

  get styleRules() {
    return this._styleRules;
  }

  isTileAvailable(level) {
    return this._provider.isTileAvailable(level);
  }

  requestTile(tile) {
    return this._provider.requestTile(tile);
  }

  getTileResource(tile) {
    return this._provider.getTileResource(tile);
  }

  isUndergroundVisible() {
    return this._provider.isUndergroundVisible?.() ?? true;
  }

  setStyleRules(styleRules) {
    this._styleRules = styleRules.slice();
    const legacyOptions = createLegacyLayerOptionsFromStyleDocument(
      this.toStyleDocument(),
    )[0];
    this._options = {
      ...this._provider._options,
      ...(legacyOptions ?? {}),
      sourceId: this.sourceId,
      styleSourceId: this.sourceId,
    };
  }

  toStyleDocument() {
    return {
      version: 1,
      sources: {
        [this.sourceId]: cloneValue(this.source),
      },
      layers: this._styleRules.map((styleRule) => styleRule.toJSON()),
      metadata: {},
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
