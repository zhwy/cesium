import VectorTileProvider from "./VectorTileProvider.js";

/**
 * 基于 XYZ URL 模板请求矢量瓦片的 provider。
 *
 * 构造参数继承自 `VectorTileProvider`，并额外支持：
 * `options.subdomains`、`options.layer`、`options.workspace`。
 */
export default class XYZVectorTileProvider extends VectorTileProvider {
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
