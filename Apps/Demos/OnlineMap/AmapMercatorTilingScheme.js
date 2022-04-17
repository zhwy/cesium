import * as Cesium from "../../../Source/Cesium.js";
import CoordTransform from "./CoordTransform.js";

class AmapMercatorTilingScheme extends Cesium.WebMercatorTilingScheme {
  constructor() {
    super();

    const projection = new Cesium.WebMercatorProjection();

    this._projection.project = (cartographic, result) => {
      result = CoordTransform.WGS84ToGCJ02(
        Cesium.Math.toDegrees(cartographic.longitude),
        Cesium.Math.toDegrees(cartographic.latitude)
      );
      result = projection.project(
        Cesium.Cartographic.fromDegrees(result[0], result[1])
      );
      return new Cesium.Cartesian2(result.x, result.y);
    };

    this._projection.unproject = (cartesian, result) => {
      const cartographic = projection.unproject(cartesian);
      result = CoordTransform.GCJ02ToWGS84(
        Cesium.Math.toDegrees(cartographic.longitude),
        Cesium.Math.toDegrees(cartographic.latitude)
      );
      return Cesium.Cartographic.fromDegrees(result[0], result[1]);
    };
  }
}

export default AmapMercatorTilingScheme;
