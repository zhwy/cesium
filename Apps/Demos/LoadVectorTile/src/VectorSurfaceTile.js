import {
  defined,
  GlobeSurfaceTile,
  ImageryState,
  QuadtreeTileLoadState,
} from "../../../../Build/CesiumUnminified/index.js";

/**
 * 矢量瓦片栈中与 Cesium `GlobeSurfaceTile` 对应的地表瓦片对象，
 * 负责挂接当前四叉树瓦片关联的 `TileVectorTile` 集合并驱动其状态流转。
 */
export default class VectorSurfaceTile extends GlobeSurfaceTile {
  constructor() {
    super();
    /**
     * 当前地表瓦片挂接的 `TileVectorTile` 列表。
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

    // 推进各矢量瓦片的影像状态机。
    const tileVectorTiles = surfaceTile.tileVectorTiles;
    let i, len;
    for (i = 0, len = tileVectorTiles.length; i < len; ++i) {
      const tileVectorTile = tileVectorTiles[i];
      if (!defined(tileVectorTile.loadingVectorTile)) {
        isUpsampledOnly = false;
        continue;
      }

      const thisTileDoneLoading = tileVectorTile.processStateMachine(
        tile,
        frameState,
        skipLoading,
      );
      isDoneLoading = isDoneLoading && thisTileDoneLoading;

      // 只要这个区域内任一图层已有可渲染结果，就允许当前瓦片进入可绘制状态。
      isAnyTileLoaded =
        isAnyTileLoaded ||
        thisTileDoneLoading ||
        defined(tileVectorTile.readyVectorTile);

      isUpsampledOnly =
        isUpsampledOnly &&
        defined(tileVectorTile.loadingVectorTile) &&
        (tileVectorTile.loadingVectorTile.state === ImageryState.FAILED ||
          tileVectorTile.loadingVectorTile.state === ImageryState.INVALID);
    }

    tile.upsampledFromParent = isUpsampledOnly;

    // 只要这个区域的任一图层已完成，或已经没有剩余加载工作，就应视为可渲染。
    // 这里直接赋值，而不是与旧值做 AND；否则初始 `false` 会把瓦片永久锁成
    // 不可渲染状态，进而卡住四叉树加载队列。
    tile.renderable = isAnyTileLoaded || isDoneLoading;

    return isDoneLoading;
  }

  static initialize(tile, vectorTileLayerCollection) {
    const surfaceTile = tile.data;
    if (!defined(surfaceTile)) {
      tile.data = new VectorSurfaceTile();
    }

    if (tile.state === QuadtreeTileLoadState.START) {
      for (let i = 0, len = vectorTileLayerCollection.length; i < len; ++i) {
        const layer = vectorTileLayerCollection.get(i);
        if (layer.show) {
          layer._bindQuadtreeTile(tile);
        }
      }
      tile.state = QuadtreeTileLoadState.LOADING;
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
      tile.state = QuadtreeTileLoadState.DONE;
    }
  }
}
