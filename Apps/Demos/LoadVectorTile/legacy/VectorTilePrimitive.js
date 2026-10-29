import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileQuadtreePrimitive from "./VectorTileQuadtreePrimitive.js";
import VectorTileQuadtreeProvider from "./VectorTileQuadtreeProvider.js";
import VectorTileLayer from "./VectorTileLayer.js";
import createProvider from "./createProvider.js";

export default class VectorTilePrimitive {
  get quadtreePrimitive() {
    return this._quadtreePrimitive;
  }

  get tilingScheme() {
    return this._tilingScheme;
  }

  constructor(options = {}) {
    this._tilingScheme = new Cesium[
      options.tilingScheme || "WebMercatorTilingScheme"
    ]();

    const copyOptions = { ...options, tilingScheme: this._tilingScheme };

    this._vectorTileProvider = createProvider(copyOptions);
    this._vectorTileLayer = new VectorTileLayer(
      this._vectorTileProvider,
      copyOptions,
    );

    this._quadtreePrimitive = new VectorTileQuadtreePrimitive({
      tileProvider: new VectorTileQuadtreeProvider({
        tilingScheme: this._tilingScheme,
        vectorTileProvider: this._vectorTileProvider,
      }),
    });
    this._quadtreePrimitive._visualizer = this;
  }

  addToScene(scene) {
    scene.primitives.add(this.quadtreePrimitive);
  }

  removeFromScene(scene) {
    scene.primitives.remove(this.quadtreePrimitive);
  }

  renderTiles(tiles, frameState) {
    tiles.forEach((tile) => {
      this._vectorTileLayer.renderTile(tile, frameState);
    });
  }
}
