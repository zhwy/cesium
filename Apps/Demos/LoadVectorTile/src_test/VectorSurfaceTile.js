import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";

export default class VectorSurfaceTile extends Cesium.GlobeSurfaceTile {
  constructor() {
    super();
    /**
     * The {@link TileVectorTile} attached to this tile.
     * @type {TileVectorTile[]}
     * @default []
     */
    this.tileVectorTiles = [];
  }

  freeResources() {
    this.tileVectorTiles.forEach((tile) => {
      tile.freeResources();
    });
    this.tileVectorTiles.length = 0;
  }

  processVectorTile(tile, frameState, skipLoading) {
    const surfaceTile = tile.data;
    let isUpsampledOnly = tile.upsampledFromParent;
    let isAnyTileLoaded = false;
    let isDoneLoading = true;

    // Transition imagery states
    const tileVectorTiles = surfaceTile.tileVectorTiles;
    let i, len;
    for (i = 0, len = tileVectorTiles.length; i < len; ++i) {
      const tileVectorTile = tileVectorTiles[i];
      if (!Cesium.defined(tileVectorTile.loadingVectorTile)) {
        isUpsampledOnly = false;
        continue;
      }

      const thisTileDoneLoading = tileVectorTile.processStateMachine(
        tile,
        frameState,
        skipLoading,
      );
      isDoneLoading = isDoneLoading && thisTileDoneLoading;

      // The imagery is renderable as soon as we have any renderable imagery for this region.
      isAnyTileLoaded =
        isAnyTileLoaded ||
        thisTileDoneLoading ||
        Cesium.defined(tileVectorTile.readyVectorTile);

      isUpsampledOnly =
        isUpsampledOnly &&
        Cesium.defined(tileVectorTile.loadingVectorTile) &&
        (tileVectorTile.loadingVectorTile.state ===
          Cesium.ImageryState.FAILED ||
          tileVectorTile.loadingVectorTile.state ===
            Cesium.ImageryState.INVALID);
    }

    tile.upsampledFromParent = isUpsampledOnly;

    // Allow rendering if any available layers are loaded
    tile.renderable = tile.renderable && (isAnyTileLoaded || isDoneLoading);

    return isDoneLoading;
  }

  static initialize(tile, vectorTileLayerCollection) {
    let surfaceTile = tile.data;
    if (!Cesium.defined(surfaceTile)) {
      surfaceTile = tile.data = new VectorSurfaceTile();
    }

    if (tile.state === Cesium.QuadtreeTileLoadState.START) {
      for (let i = 0, len = vectorTileLayerCollection.length; i < len; ++i) {
        const layer = vectorTileLayerCollection.get(i);
        if (layer.show) {
          layer._bindQuadtreeTile(tile);
        }
      }
      tile.state = Cesium.QuadtreeTileLoadState.LOADING;
    }
  }

  static processStateMachine(tile, frameState, vectorTileLayerCollection) {
    VectorSurfaceTile.initialize(tile, vectorTileLayerCollection);
    const surfaceTile = tile.data;
    const isVectorTileDoneLoading = surfaceTile.processVectorTile(
      tile,
      frameState,
    );
    if (isVectorTileDoneLoading) {
      tile.state = Cesium.QuadtreeTileLoadState.DONE;
    }
    tile.renderable = true;
  }
}
