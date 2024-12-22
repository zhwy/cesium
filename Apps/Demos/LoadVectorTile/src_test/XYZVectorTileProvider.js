import VectorTileProvider from "./VectorTileProvider.js";

export default class XYZVectorTileProvider extends VectorTileProvider {
  constructor(options = {}) {
    super(options);
  }

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
