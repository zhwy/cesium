import HeightReference from "../../../../packages/engine/Source/Scene/HeightReference.js";

/**
 * 只保留本帧已登记的集合再烘焙。VectorProvider 的 map 里还留着上一帧登记、本帧已不再提交的
 * 旧集合（下一帧才剔除），补烘焙的瓦片若带上它们，LOD 交接时新旧会叠加或闪出旧内容。
 */
function bakeWithMarkedCollections(vectorProvider, bake) {
  const all = vectorProvider._heightReferenceByCollection;
  const marked = vectorProvider._markedThisFrame;
  if (!all || !marked) {
    return bake();
  }
  const current = new Map();
  for (const [collection, heightReference] of all) {
    if (marked.has(collection)) {
      current.set(collection, heightReference);
    }
  }
  vectorProvider._heightReferenceByCollection = current;
  try {
    return bake();
  } finally {
    vectorProvider._heightReferenceByCollection = all;
  }
}

/**
 * 引擎只给“上一帧渲染过”的地形瓦片烘焙贴地矢量数据，相机移动或 LOD 切换时刚选中的瓦片
 * 会有一帧没有贴地面，表现为闪烁（远离地面、瓦片大时最明显）。
 * 这里在瓦片被选中显示时按需补烘焙，不修改引擎源码。依赖 `globe._surface` 这个私有字段，
 * 取不到时安全地不做任何事。
 *
 * @param {Scene} scene
 * @returns {Function} 卸载函数。
 */
function installTerrainVectorDataPrefetch(scene) {
  const tileProvider = scene.globe?._surface?.tileProvider;
  const vectorProvider = scene.vectorProvider;
  if (
    !vectorProvider ||
    typeof tileProvider?.showTileThisFrame !== "function" ||
    Object.hasOwn(tileProvider, "showTileThisFrame")
  ) {
    return () => {};
  }
  const patched = function (tile, frameState) {
    const surfaceTile = tile.data;
    if (surfaceTile && !surfaceTile.vectorData) {
      surfaceTile.vectorData = bakeWithMarkedCollections(vectorProvider, () =>
        vectorProvider.requestTileData(
          tile.x,
          tile.y,
          tile.level,
          frameState.context,
          HeightReference.CLAMP_TO_TERRAIN,
        ),
      );
    }
    return Object.getPrototypeOf(this).showTileThisFrame.call(
      this,
      tile,
      frameState,
    );
  };
  tileProvider.showTileThisFrame = patched;
  return () => {
    if (tileProvider.showTileThisFrame === patched) {
      delete tileProvider.showTileThisFrame;
    }
  };
}

export default installTerrainVectorDataPrefetch;
