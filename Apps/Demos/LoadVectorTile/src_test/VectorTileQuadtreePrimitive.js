import * as Cesium from "../../../../Build/CesiumUnminified/index.js";

export default class VectorTileQuadtreePrimitive extends Cesium.QuadtreePrimitive {
  constructor(options) {
    super(options);
  }

  update(frameState) {
    if (frameState.passes.pick === true) {
      this.renderTiles(frameState);
    } else {
      this.beginFrame(frameState);
      this.render(frameState);
      this.endFrame(frameState);
    }
  }

  render(frameState) {
    super.render(frameState);
    if (frameState.passes.render) {
      this.renderTiles(frameState);
    }
  }

  renderTiles(frameState) {
    const tilesToRender = this._tilesToRender;
    for (let i = 0; i < tilesToRender.length; ++i) {
      const tile = tilesToRender[i];
      if (tile.data) {
        const tileVectorTiles = tile.data.tileVectorTiles;
        for (let j = 0; j < tileVectorTiles.length; ++j) {
          const tileVectorTile = tileVectorTiles[j];
          if (
            tileVectorTile.readyVectorTile?.state === Cesium.ImageryState.READY
          ) {
            const layerPrimitives =
              tileVectorTile.readyVectorTile.primitives || {};
            for (const key in layerPrimitives) {
              if (layerPrimitives.hasOwnProperty(key)) {
                const primitives = layerPrimitives[key];
                primitives.forEach((p) => p.update(frameState));
              }
            }
          }
        }
      }
    }
  }
}
