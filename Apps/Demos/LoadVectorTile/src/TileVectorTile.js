import defined from "../../../../packages/engine/Source/Core/defined.js";
import ImageryState from "../../../../packages/engine/Source/Scene/ImageryState.js";
import VectorTileCoverageState from "./VectorTileCoverageState.js";

/**
 * 矢量瓦片栈中与 Cesium `TileImagery` 对应的关联对象，
 * 用于把一个地形四叉树瓦片与其当前使用的矢量瓦片连接起来。
 */
function TileVectorTile(vectorTile) {
  this.readyVectorTile = undefined;
  this.loadingVectorTile = vectorTile;
}

/**
 * 释放当前实例持有的资源引用。
 */
TileVectorTile.prototype.freeResources = function () {
  if (defined(this.readyVectorTile)) {
    this.readyVectorTile.releaseReference();
  }

  if (defined(this.loadingVectorTile)) {
    this.loadingVectorTile.releaseReference();
  }
};

/**
 * 推进当前实例的加载状态机。
 *
 * @param {Tile} tile 当前实例所属的四叉树瓦片。
 * @param {FrameState} frameState 当前帧状态。
 * @param {boolean} skipLoading 是否跳过新的加载动作，例如发起请求或创建纹理。
 *                  即使为 `true`，也仍会同步推进那些已经基本就绪的祖先瓦片状态。
 * @returns {boolean} 若当前实例已完成加载则返回 `true`，否则返回 `false`。
 */
TileVectorTile.prototype.processStateMachine = function (
  tile,
  frameState,
  skipLoading,
) {
  const loadingVectorTile = this.loadingVectorTile;

  loadingVectorTile.processStateMachine(
    frameState,
    skipLoading,
    tile._loadPriority ?? tile._distance ?? 0,
  );

  if (
    loadingVectorTile.state === ImageryState.READY &&
    loadingVectorTile.coverageState === VectorTileCoverageState.READY_EMPTY
  ) {
    const readyAncestor = findReadyAncestor(loadingVectorTile);
    if (defined(readyAncestor)) {
      if (this.readyVectorTile !== readyAncestor) {
        if (defined(this.readyVectorTile)) {
          this.readyVectorTile.releaseReference();
        }
        this.readyVectorTile = readyAncestor;
        readyAncestor.addReference();
      }
      return true; // 精确瓦片已经完成，但继续沿用父级回退结果进行绘制。
    }
  }

  if (loadingVectorTile.state === ImageryState.READY) {
    if (defined(this.readyVectorTile)) {
      this.readyVectorTile.releaseReference();
    }
    this.readyVectorTile = this.loadingVectorTile;
    this.loadingVectorTile = undefined;
    return true; // 加载完成。
  }

  // 当前瓦片尚未完成时，尝试查找可用于回退显示的祖先瓦片。
  let ancestor = loadingVectorTile.parent;
  let closestAncestorThatNeedsLoading;
  while (defined(ancestor) && ancestor.state !== ImageryState.READY) {
    if (
      ancestor.state !== ImageryState.FAILED &&
      ancestor.state !== ImageryState.INVALID
    ) {
      // 该祖先瓦片仍在加载中。
      closestAncestorThatNeedsLoading =
        closestAncestorThatNeedsLoading || ancestor;
    }
    ancestor = ancestor.parent;
  }

  if (this.readyVectorTile !== ancestor) {
    if (defined(this.readyVectorTile)) {
      this.readyVectorTile.releaseReference();
    }

    this.readyVectorTile = ancestor;

    if (defined(ancestor)) {
      ancestor.addReference();
    }
  }

  if (
    loadingVectorTile.state === ImageryState.FAILED ||
    loadingVectorTile.state === ImageryState.INVALID
  ) {
    // 当前瓦片失败或无效时，优先回退到可用的祖先瓦片。
    if (defined(closestAncestorThatNeedsLoading)) {
      // 继续推进祖先瓦片的加载流程。某些祖先影像瓦片可能并未直接挂到地形瓦片上，
      // 如果这里不主动推进，它们可能永远不会进入完成状态。
      closestAncestorThatNeedsLoading.processStateMachine(
        frameState,
        skipLoading,
      );
      return false; // 尚未完成加载。
    }
    // 当前瓦片失败或无效，但已经找到了当前能提供的最佳替代结果。
    return true; // 加载完成。
  }

  return false; // 尚未完成加载。
};

function findReadyAncestor(vectorTile) {
  let ancestor = vectorTile.parent;
  while (defined(ancestor)) {
    if (
      ancestor.state === ImageryState.READY &&
      ancestor.coverageState !== VectorTileCoverageState.READY_EMPTY
    ) {
      return ancestor;
    }
    ancestor = ancestor.parent;
  }
  return undefined;
}

export default TileVectorTile;
