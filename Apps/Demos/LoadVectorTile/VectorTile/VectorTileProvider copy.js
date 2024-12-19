import { VectorTile } from "https://cdn.jsdelivr.net/npm/@mapbox/vector-tile@2.0.3/+esm";
import Protobuf from "https://cdn.jsdelivr.net/npm/pbf/+esm";
import MvtTileLoader from "./MvtTileLoader.js";
import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";

export default class VectorTileProvider {
  constructor(options = {}) {
    this._tilingScheme =
      options.tilingScheme || new Cesium.WebMercatorTilingScheme();
    this._minimumLevel = options.minimumLevel || 0;
    this._maximumLevel = options.maximumLevel || 20;

    this._options = {
      ...options,
      styleLayer: options.layer.replace(/.*:/g, ""),
    };
    this._resource = new Cesium.Resource({
      url: this._options.url,
    });
    this._freeTile = new Cesium.Event();
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
  freeTile: {
    get: function () {
      return this._freeTile;
    },
  },
});

VectorTileProvider.prototype.getTileResource = function (tile) {};

VectorTileProvider.prototype.requestTile = function (tile) {
  if (tile.level < this._minimumLevel || tile.level > this._maximumLevel) {
    return;
  }

  const resource = this.getTileResource(tile);
  if (Cesium.defined(resource)) {
    MvtTileLoader.instance()
      .load(resource, this._options.enableCache)
      .then((arrayBuffer) => {
        if (arrayBuffer.byteLength > 0) {
          const vectorTile = new VectorTile(new Protobuf(arrayBuffer));
          // 绑定图层数据
          tile.data.layerFeatures = this.readVectorTile(tile, vectorTile);
          // 初始化tile上的primitives
          tile.data.primitives = {};

          // 释放资源
          tile.data.freeResources = () => {
            if (tile.data) {
              try {
                // 广播瓦片销毁事件
                this.freeTile.raiseEvent(tile);
              } catch (e) {
                console.error(e);
              }
              tile.data.layerFeatures = undefined;
              tile.data.freeResources = undefined;
            }
          };
        }
        tile.renderable = true;
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
      });
  }
};

VectorTileProvider.prototype.readVectorTile = function (tile, vectorTile) {
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
