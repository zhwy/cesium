import { defined } from "../../../../Build/CesiumUnminified/index.js";
import VectorTileProvider from "./VectorTileProvider.js";

/**
 * 基于 WMTS URL 模板请求 MVT 瓦片的 provider。
 *
 * 构造参数继承自 `VectorTileProvider`，并额外支持：
 * `options.tileMatrixSetID`、`options.tileMatrixLabels`、`options.subdomains`。
 */
export default class WMTSVectorTileProvider extends VectorTileProvider {
  getTileResource(tile) {
    const labels = this._options.tileMatrixLabels;
    const tileMatrix = defined(labels)
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
