import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileTaskScheduler from "./VectorTileTaskScheduler.js";

export const TileType = Object.freeze({
  XYZ: "XYZ",
  WMTS: "WMTS",
});

let mvtLoaderInstance;

function MVTLoader(cacheStore) {
  // this.cacheStore = cacheStore;
  // this.cacheStore.init();
}

MVTLoader.prototype.load = function (resource, scheduler, priority) {
  return scheduler.schedule((context) => {
    const promise = resource.fetchArrayBuffer();
    context.onCancel(() => resource.request.cancel());
    return promise;
  }, priority);
};

MVTLoader.prototype.clearCache = function () {
  // this.cacheStore.reset();
};

MVTLoader.instance = function () {
  if (!mvtLoaderInstance) {
    mvtLoaderInstance = new MVTLoader();
    // new IndexDbKvCacheStore(
    //   "wdvt-cache-store",
    //   window.YJ3D_MVT_CACHE_MAX_SIZE_MB || 512,
    //   calculateSize,
    // ),
  }
  return mvtLoaderInstance;
};

// init
MVTLoader.instance();

export default class VectorTileProvider {
  constructor(options = {}) {
    this._options = options;

    this._tilingScheme =
      options.tilingScheme ?? new Cesium.WebMercatorTilingScheme();
    this._minimumLevel = options.minimumLevel ?? 0;
    this._maximumLevel = options.maximumLevel ?? 18;
    this._networkScheduler =
      options.networkScheduler ?? new VectorTileTaskScheduler(8);

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

VectorTileProvider.prototype.isTileAvailable = function (level) {
  return level >= this._minimumLevel && level <= this._maximumLevel;
};

VectorTileProvider.prototype.requestTile = function (tile) {
  if (!this.isTileAvailable(tile.level)) {
    return;
  }

  const resource = this.getTileResource(tile);
  if (Cesium.defined(resource)) {
    return MVTLoader.instance().load(
      resource,
      this._networkScheduler,
      tile.priority,
    );
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

export class XYZVectorTileProvider extends VectorTileProvider {
  getTileResource(tile) {
    const subdomains = this._options.subdomains || [];
    const x = parseFloat(tile.x);
    const z = parseFloat(tile.level);
    const y = parseFloat(tile.y);
    const reverseY = this.tilingScheme.getNumberOfYTilesAtLevel(z) - y - 1;

    const templateValues = {
      layer: this._options.layer,
      workspace: this._options.workspace,
      z: z.toString(),
      y: y.toString(),
      x: x.toString(),
      "-y": reverseY.toString(),
      s:
        subdomains.length > 0
          ? subdomains[(tile.x + tile.y + tile.level) % subdomains.length]
          : "",
    };
    const resource = this._resource.getDerivedResource({});
    resource._url = resource._url.replace(
      "{s}",
      decodeURIComponent(templateValues.s),
    );

    resource.setTemplateValues(templateValues);
    return resource;
  }
}

XYZVectorTileProvider.prototype.isUndergroundVisible = function () {
  return true;
};

export class WMTSVectorTileProvider extends VectorTileProvider {
  getTileResource(tile) {
    const labels = this._options.tileMatrixLabels;
    const tileMatrix = Cesium.defined(labels)
      ? labels[tile.level]
      : `${this._options.tileMatrixSetID}:${tile.level}`;
    const subdomains = this._options.subdomains || [];
    const reverseY =
      this.tilingScheme.getNumberOfYTilesAtLevel(tile.level) - tile.y - 1;
    const templateValues = {
      TileMatrixSet: this._options.tileMatrixSetID,
      TileMatrix: tileMatrix,
      TileRow: tile.y.toString(),
      TileCol: tile.x.toString(),
      s:
        subdomains.length > 0
          ? subdomains[(tile.x + tile.y + tile.level) % subdomains.length]
          : "",
      x: tile.x.toString(),
      y: tile.y.toString(),
      "-y": reverseY.toString(),
      z: tile.level.toString(),
    };
    const resource = this._resource.getDerivedResource({});
    resource._url = resource._url.replace(
      "{s}",
      decodeURIComponent(templateValues.s),
    );
    resource.setTemplateValues(templateValues);
    return resource;
  }
}

export class WMTSGeoVectorTileProvider extends WMTSVectorTileProvider {
  loadTile(frameState, tile) {
    if (tile.state === Cesium.QuadtreeTileLoadState.START) {
      if (tile.level < this._minimumLevel || tile.level > this._maximumLevel) {
        tile.renderable = true;
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        return;
      }
      const resource = this.getTileResource(tile);
      if (Cesium.defined(resource)) {
        resource
          .fetchJson()
          .then((data) => {
            if (data.features.length > 0) {
              tile.data.features = data.features;
              // 释放资源
              tile.data.freeResources = function () {
                if (tile.data) {
                  tile.data.features = undefined;
                  if (tile.data.primitives) {
                    tile.data.primitives.forEach((primitive) =>
                      primitive.destroy(),
                    );
                  }
                  tile.data.primitives = undefined;
                }
              };
            }
            tile.renderable = true;
            tile.state = Cesium.QuadtreeTileLoadState.DONE;
          })
          .catch(() => {
            tile.renderable = true;
            tile.state = Cesium.QuadtreeTileLoadState.DONE;
          });
        tile.state = Cesium.QuadtreeTileLoadState.LOADING;
      } else {
        tile.renderable = true;
      }
      tile.state = Cesium.QuadtreeTileLoadState.LOADING;
    }
  }
}
