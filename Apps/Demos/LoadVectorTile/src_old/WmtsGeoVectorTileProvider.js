import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";
import WMTSVectorTileProvider from "./WMTSGeoVectorTileProvider";

export default class WMTSGeoVectorTileProvider extends WMTSVectorTileProvider {
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
          .catch((err) => {
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
