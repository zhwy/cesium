import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileQuadtreePrimitive from "./VectorTileQuadtreePrimitive.js";
import VectorTileQuadtreeProvider from "./VectorTileQuadtreeProvider.js";
import VectorTileLayerCollection from "./VectorTileLayerCollection.js";
import createProvider from "./createProvider.js";
import TileType from "./TileType.js";

export default class VectorTileLayerManager {
  get quadtreePrimitive() {
    return this._quadtreePrimitive;
  }

  get tilingScheme() {
    return this._tilingScheme;
  }

  get vectorTileLayers() {
    return this._vectorTileLayers;
  }

  constructor(options = {}) {
    this._tilingScheme = new Cesium[
      options.tilingScheme || "WebMercatorTilingScheme"
    ]();

    this._vectorTileLayers = new VectorTileLayerCollection();
    this._quadtreePrimitive = new VectorTileQuadtreePrimitive({
      tileProvider: new VectorTileQuadtreeProvider({
        vectorTileLayers: this._vectorTileLayers,
        tilingScheme: this._tilingScheme,
      }),
    });
  }

  addToScene(scene) {
    scene.primitives.add(this.quadtreePrimitive);
  }

  removeFromScene(scene) {
    scene.primitives.remove(this.quadtreePrimitive);
  }

  addLayer(options) {
    const defaultOptions = {
      dataTypeField: "type",
      dataIdField: "id",
      minimumLevel: 0,
      maximumLevel: 20,
      tileType: TileType.XYZ,
      format: "application/vnd.mapbox-vector-tile",
      url: "",
      layer: "",
      colors: {
        DEFAULT: "#FF0000",
      },
    };

    const provider = createProvider({
      ...defaultOptions,
      ...options,
      tilingScheme: this.tilingScheme,
    });

    this._vectorTileLayers.addLayerProvider(provider);
  }
}
