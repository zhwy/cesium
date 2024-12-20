import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";
import VectorTileProvider from "./VectorTileProvider.js";

export default class WmtsVectorTileProvider extends VectorTileProvider {
  getTileResource(tile) {
    const labels = this._options.tileMatrixLabels;
    const tileMatrix = Cesium.defined(labels)
      ? labels[tile.level]
      : `${this._options.tileMatrixSetID}:${tile.level}`;
    const subdomains = this._options.subdomains || [];
    const templateValues = {
      Layer: this._options.layer,
      Format: this._options.format,
      TileMatrixSet: this._options.tileMatrixSetID,
      TileMatrix: tileMatrix,
      TileRow: tile.y.toString(),
      TileCol: tile.x.toString(),
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
