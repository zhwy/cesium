import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";

import WmtsVectorTileProvider from "./WmtsVectorTileProvider.js";
import WmtsGeoVectorTileProvider from "./WmtsGeoVectorTileProvider.js";
import XYZVectorTileProvider from "./XYZVectorTileProvider.js";
import TileType from "../TileType.js";

export default (options) => {
  if (options.tileType === TileType.WMTS) {
    if (options.format === "application/vnd.mapbox-vector-tile") {
      return new WmtsVectorTileProvider({
        ...options,
        tilingScheme: new Cesium[options.tilingScheme](),
      });
    } else if (options.format === "application/json;type=geojson") {
      return new WmtsGeoVectorTileProvider({
        ...options,
        tilingScheme: new Cesium[options.tilingScheme](),
      });
    }
  } else if (options.tileType === TileType.XYZ) {
    return new XYZVectorTileProvider({
      ...options,
      tilingScheme: new Cesium[options.tilingScheme](),
    });
  }
};
