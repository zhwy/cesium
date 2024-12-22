import MvtTileLoader from "./MvtTileLoader.js";
import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";

export default class VectorTileProvider {
  constructor(options = {}) {
    this._options = options;

    this._tilingScheme = Cesium.defaultValue(
      options.tilingScheme,
      new Cesium.WebMercatorTilingScheme(),
    );
    this._minimumLevel = Cesium.defaultValue(options.minimumLevel, 0);
    this._maximumLevel = Cesium.defaultValue(options.maximumLevel, 18);

    this._resource = new Cesium.Resource({
      url: options.url,
    });
  }
}

Object.defineProperties(VectorTileProvider.prototype, {
  minimumLevel: {
    get: function () {
      return this._minimumLevel;
    },
  },
  maximumLevel: {
    get: function () {
      return this._maximumLevel;
    },
  },
  tilingScheme: {
    get: function () {
      return this._tilingScheme;
    },
  },
  resource: {
    get: function () {
      return this._resource;
    },
    set: function (val) {
      this._resource = val;
    },
  },
});

/**
 * 子类需实现此方法
 * @param {*} tile
 */
VectorTileProvider.prototype.getTileResource = function (tile) {};

VectorTileProvider.prototype.requestTile = function (tile) {
  if (tile.level < this._minimumLevel || tile.level > this._maximumLevel) {
    return;
  }

  const resource = this.getTileResource(tile);
  if (Cesium.defined(resource)) {
    return new Promise((resolve, reject) => {
      MvtTileLoader.instance()
        .load(resource, false)
        .then((arrayBuffer) => {
          if (arrayBuffer.byteLength > 0) {
            resolve(arrayBuffer);
          }
        }, reject);
    });
  }
};

VectorTileProvider.readVectorTile = function (tile, vectorTile) {
  const layerFeatures = {};
  for (const layer in vectorTile.layers) {
    if (vectorTile.layers.hasOwnProperty(layer)) {
      const vectorTileLayer = vectorTile.layers[layer];
      if (vectorTileLayer) {
        layerFeatures[layer] = vectorTileLayer._features.map((f, i) =>
          vectorTileLayer.feature(i).toGeoJSON(tile.x, tile.y, tile.level),
        );
      }
    }
  }
  return layerFeatures;
};
