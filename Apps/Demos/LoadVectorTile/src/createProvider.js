import WMTSVectorTileProvider from "./WMTSVectorTileProvider.js";
import WMTSGeoVectorTileProvider from "./WMTSGeoVectorTileProvider.js";
import XYZVectorTileProvider from "./XYZVectorTileProvider.js";
import TileType from "./TileType.js";

export default (options) => {
  if (options.tileType === TileType.WMTS) {
    if (options.format === "application/vnd.mapbox-vector-tile") {
      return new WMTSVectorTileProvider({
        ...options,
      });
    } else if (options.format === "application/json;type=geojson") {
      return new WMTSGeoVectorTileProvider({
        ...options,
      });
    }
  } else if (options.tileType === TileType.XYZ) {
    return new XYZVectorTileProvider({
      ...options,
    });
  }
};
