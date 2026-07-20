import {
  defined,
  QuadtreeTileLoadState,
} from "../../../../Build/CesiumUnminified/index.js";
import WMTSVectorTileProvider from "./WMTSVectorTileProvider.js";

/**
 * 面向 GeoJSON WMTS 服务的 provider，直接请求并挂接 `features` 数据。
 *
 * 构造参数与 `WMTSVectorTileProvider` 一致。
 */
export default class WMTSGeoVectorTileProvider extends WMTSVectorTileProvider {
  loadTile(frameState, tile) {
    if (tile.state === QuadtreeTileLoadState.START) {
      if (tile.level < this._minimumLevel || tile.level > this._maximumLevel) {
        tile.renderable = true;
        tile.state = QuadtreeTileLoadState.DONE;
        return;
      }
      const resource = this.getTileResource(tile);
      if (defined(resource)) {
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
            tile.state = QuadtreeTileLoadState.DONE;
          })
          .catch(() => {
            tile.renderable = true;
            tile.state = QuadtreeTileLoadState.DONE;
          });
        tile.state = QuadtreeTileLoadState.LOADING;
      } else {
        tile.renderable = true;
      }
      tile.state = QuadtreeTileLoadState.LOADING;
    }
  }
}
