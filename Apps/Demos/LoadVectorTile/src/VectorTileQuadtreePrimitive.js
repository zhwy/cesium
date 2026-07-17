import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import {
  selectByCoverage,
  isAncestorOrSame,
} from "./VectorTileLodSelection.js";
import { createSharedPointEntryKey } from "./SharedPointCollections.js";

/**
 * 判断一个瓦片上的所有图元是否都能在当前帧真正出图。
 * 当 `asynchronous: true` 时，Cesium Primitive 在刚创建后的若干帧里可能仍在
 * Worker 中处理几何，此时虽然 `ImageryState.READY` 已经成立，但还不会产生绘制命令。
 * 如果把这种瓦片直接当成有效覆盖，会过早把父瓦片替换掉，导致子瓦片尚未可绘制时出现空洞。
 *
 * @param {object} tile
 * @returns {boolean}
 */
function arePrimitivesReady(tile) {
  const layerPrimitives = tile.primitives;
  if (!layerPrimitives) {
    return true; // READY_EMPTY 没有任何可绘制内容，因此天然可视为可出图。
  }
  const keys = Object.keys(layerPrimitives);
  for (let ki = 0; ki < keys.length; ++ki) {
    const primitives = layerPrimitives[keys[ki]];
    for (let pi = 0; pi < primitives.length; ++pi) {
      if (primitives[pi].show !== false && !primitives[pi].ready) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 基于 Cesium 四叉树的矢量瓦片渲染 primitive，负责 LOD 选择、回退保留、
 * 提交绘制命令以及共享点集合的同步。
 *
 * @param {object} options 构造参数。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器。
 * @param {number} [options.warmupTilesPerFrame=4] 每帧允许预热但不直接显示的瓦片数量上限。
 * @param {number} [options.tileCacheSize] 继续透传给 `Cesium.QuadtreePrimitive` 的缓存大小参数。
 * @param {number} [options.maximumScreenSpaceError] 继续透传给 `Cesium.QuadtreePrimitive` 的屏幕误差阈值。
 */
export default class VectorTileQuadtreePrimitive
  extends Cesium.QuadtreePrimitive
{
  constructor(options) {
    super(options);
    this._diagnostics = options.diagnostics;
    /**
     * 每帧允许预热的最大瓦片数。预热会推进 Cesium 异步几何流水线，
     * 从而限制视口整体跨越 LOD 阈值时批量建表、Worker 调度和顶点数组上传的峰值。
     * 超出预算的瓦片会继续显示已保留的父瓦片，直到预热完成。
     */
    this._warmupTilesPerFrame = options.warmupTilesPerFrame ?? 4;
    /**
     * 每个图层对应一份稳定的渲染状态。每项包含：
     *   committedRenderSet：当前真正参与绘制的 `VectorTile` 集合；成员会额外持有
     *     一个引用，避免仍在屏幕上时被缓存回收。
     *   committedPointEntries：当前已同步到图层共享点集合中的点要素条目映射。
     */
    this._layerRenderStates = new Map();
  }

  /**
   * 清空某个图层已提交的渲染集合，但保留其状态对象本身。
   * 图层被隐藏时调用。
   * @param {object} layer
   */
  clearLayerRenderState(layer) {
    const state = this._layerRenderStates.get(layer);
    if (state) {
      this._clearCommittedPointEntries(layer, state);
      for (const tile of state.committedRenderSet) {
        tile.releaseReference?.();
      }
      state.committedRenderSet = new Set();
    }
  }

  /**
   * 完整移除某个图层的渲染状态条目。
   * 图层被删除或销毁时调用。
   * @param {object} layer
   */
  removeLayerRenderState(layer) {
    const state = this._layerRenderStates.get(layer);
    if (state) {
      this._clearCommittedPointEntries(layer, state);
      for (const tile of state.committedRenderSet) {
        tile.releaseReference?.();
      }
    }
    this._layerRenderStates.delete(layer);
  }

  /**
   * 替换图层的 `committedRenderSet`，并同步维护引用计数，
   * 以免某个仍在作为 LOD 回退结果显示的瓦片被缓存提前驱逐并销毁图元。
   * 新提交的瓦片会增加引用，移出集合的瓦片会释放引用。
   * @param {object} state
   * @param {Iterable<object>} tiles
   * @param {Function} [beforeRelease]
   */
  _commitRenderSet(state, tiles, beforeRelease) {
    const next = new Set(tiles);
    const prev = state.committedRenderSet;
    for (const tile of next) {
      if (!prev.has(tile)) {
        tile.addReference?.();
      }
    }
    state.committedRenderSet = next;
    beforeRelease?.();
    for (const tile of prev) {
      if (!next.has(tile)) {
        tile.releaseReference?.();
      }
    }
  }

  _getOrCreateLayerState(layer) {
    let state = this._layerRenderStates.get(layer);
    if (!state) {
      state = {
        committedRenderSet: new Set(),
        committedPointEntries: new Map(),
      };
      this._layerRenderStates.set(layer, state);
    }
    return state;
  }

  _clearCommittedPointEntries(layer, state) {
    const sharedPointCollections = layer.sharedPointCollections;
    if (!sharedPointCollections) {
      state.committedPointEntries = new Map();
      return;
    }
    for (const pointKey of state.committedPointEntries.keys()) {
      sharedPointCollections.removeTileEntries(pointKey);
    }
    state.committedPointEntries = new Map();
  }

  _syncLayerPointCollections(layer, state) {
    const sharedPointCollections = layer.sharedPointCollections;
    if (!sharedPointCollections) {
      state.committedPointEntries = new Map();
      return;
    }

    const nextPointEntries = new Map();
    for (const tile of state.committedRenderSet) {
      const pointBuckets = tile.pointBuckets || {};
      const bucketIds = Object.keys(pointBuckets);
      for (let i = 0; i < bucketIds.length; ++i) {
        const bucketId = bucketIds[i];
        const pointBucket = pointBuckets[bucketId];
        const pointKey = createSharedPointEntryKey(tile, bucketId);
        nextPointEntries.set(pointKey, {
          pointBucket,
          styleRevision: pointBucket.styleRevision ?? 0,
        });
      }
    }

    for (const [pointKey, pointEntry] of nextPointEntries) {
      const { pointBucket, styleRevision } = pointEntry;
      const committedEntry = state.committedPointEntries.get(pointKey);
      if (!committedEntry || !sharedPointCollections.hasTileEntries(pointKey)) {
        sharedPointCollections.addTileEntries(
          pointKey,
          pointBucket.descriptors,
          pointBucket.pickContext,
        );
      } else if (committedEntry.pointBucket !== pointBucket) {
        sharedPointCollections.removeTileEntries(pointKey);
        sharedPointCollections.addTileEntries(
          pointKey,
          pointBucket.descriptors,
          pointBucket.pickContext,
        );
      } else if (committedEntry.styleRevision !== styleRevision) {
        sharedPointCollections.updateTileEntries?.(
          pointKey,
          pointBucket.descriptors,
          pointBucket.updateProperties,
        );
      }
    }

    for (const pointKey of state.committedPointEntries.keys()) {
      if (!nextPointEntries.has(pointKey)) {
        sharedPointCollections.removeTileEntries(pointKey);
      }
    }

    state.committedPointEntries = nextPointEntries;
  }

  applyStyleLayerUpdate(layer, layerId, plan) {
    const state = this._layerRenderStates.get(layer);
    if (!state) {
      return;
    }
    for (const tile of state.committedRenderSet) {
      layer.applyStyleLayerToTile?.(tile, layerId, plan);
    }
    this._syncLayerPointCollections(layer, state);
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
      this._cancelStaleRequests(frameState);
    }
  }

  /**
   * 取消四叉树已不再需要的瓦片请求，给当前可见瓦片释放调度器槽位。
   */
  _cancelStaleRequests(frameState) {
    const layers = this._tileProvider.vectorTileLayers;
    if (!layers) {
      return;
    }
    for (let i = 0; i < layers.length; ++i) {
      layers.get(i).cancelStaleRequests(frameState.frameNumber);
    }
  }

  renderTiles(frameState) {
    const startTime = this._diagnostics?.startTimer();
    const tilesToRender = this._tilesToRender;
    const isRenderPass = frameState.passes.render === true;

    if (isRenderPass) {
      this._diagnostics?.setGauge("sharedPointAddsThisFrame", 0);
      this._diagnostics?.setGauge("sharedPointRemovesThisFrame", 0);
    }

    // ----------------------------------------------------------------
    // 阶段 1（仅渲染通道）：
    // 以图层为单位，从 `_tilesToRender` 中收集：
    //   - candidates：状态为 READY 的矢量瓦片。`readyVectorTile`
    //     在精确瓦片加载期间会自动解析到最近的 READY 祖先，因此天然支持祖先回退。
    //   - regions：每个可见四叉树瓦片理想上希望拿到的精确瓦片坐标，
    //     供后续按区域检查覆盖情况。
    // ----------------------------------------------------------------
    let idealTileCount = 0;
    let suppressedLodVectorTiles = 0;
    let retainedTileCount = 0;
    let refreshRetainedTileCount = 0;
    const warmupTiles = new Set();

    if (isRenderPass) {
      const layerEntries = new Map();

      for (let i = 0; i < tilesToRender.length; ++i) {
        const tile = tilesToRender[i];
        if (!tile.data) {
          continue;
        }
        const tileVectorTiles = tile.data.tileVectorTiles;
        for (let j = 0; j < tileVectorTiles.length; ++j) {
          const tileVectorTile = tileVectorTiles[j];
          // 当前区域真正想要的精确瓦片；`readyVectorTile` 可能是祖先回退结果，
          // `loadingVectorTile` 始终指向精确瓦片。
          const exact =
            tileVectorTile.loadingVectorTile ?? tileVectorTile.readyVectorTile;
          if (!exact) {
            continue;
          }
          // 在这里续租请求，而不是依赖加载队列那 5ms 的时间片；
          // 否则在高压加载场景下，可见瓦片可能拿不到时间片，导致无意义的取消与重请求抖动。
          exact.lastNeededFrame = frameState.frameNumber;
          const layer = exact.vectorTileLayer;
          layer.processBucketRebuilds?.(exact, frameState);

          let entry = layerEntries.get(layer);
          if (!entry) {
            entry = {
              candidates: new Set(),
              regions: [],
              regionKeys: new Set(),
            };
            layerEntries.set(layer, entry);
          }

          const regionKey = `${exact.level}/${exact.x}/${exact.y}`;
          if (!entry.regionKeys.has(regionKey)) {
            entry.regionKeys.add(regionKey);
            entry.regions.push(exact);
          }

          // 即便 `readyVectorTile` 仍指向可绘制的祖先回退结果，
          // `READY_EMPTY` 的精确瓦片也应视为已完成覆盖。
          const exactCoverage =
            exact.state === Cesium.ImageryState.READY && exact.coverageComplete
              ? exact
              : undefined;
          const vt = exactCoverage ?? tileVectorTile.readyVectorTile;
          layer.processBucketRebuilds?.(vt, frameState);
          layer.applyPendingStyleUpdates?.(vt);
          if (
            vt?.state === Cesium.ImageryState.READY &&
            layer.isCurrentContentRevision?.(vt) !== false &&
            !warmupTiles.has(vt)
          ) {
            if (entry.candidates.has(vt)) {
              continue;
            }
            if (arePrimitivesReady(vt)) {
              entry.candidates.add(vt);
              idealTileCount++;
            } else {
              // 图元已经构建，但 GPU 资源尚未就绪：稍后在隐藏状态下预热。
              // 在此之前它负责的区域仍视为未覆盖，因此保留旧瓦片继续显示。
              warmupTiles.add(vt);
            }
          }
        }
      }

      // ----------------------------------------------------------------
      // 阶段 2（仅渲染通道）：
      // 对每个图层执行覆盖树分析，解析出当前帧应提交的渲染集合。
      // 如果某些区域在本帧还没有任何覆盖，则按区域从上一次已提交集合中回填，
      // 这样平移或缩放到尚未加载完成的区域时，会继续显示上一帧瓦片而不是闪洞。
      // 父子去重会保证合并后的结果不存在重叠：只要旧父瓦片仍在屏幕上，
      // 部分就绪的新子瓦片就会被压制，直到整块区域可以一次性替换。
      // ----------------------------------------------------------------
      for (const [layer, entry] of layerEntries) {
        const state = this._getOrCreateLayerState(layer);
        const { candidates, regions } = entry;

        const selected = selectByCoverage(candidates);
        suppressedLodVectorTiles += candidates.size - selected.length;

        // 统计本帧仍未被 READY 瓦片覆盖的区域。
        const uncovered = regions.filter(
          (region) => !selected.some((s) => isAncestorOrSame(s, region)),
        );

        // 从上一次已提交集合中回填未覆盖区域：
        // 只要旧瓦片覆盖该区域，或本身位于该区域内部，就保留下来。
        let retained = [];
        if (uncovered.length > 0 && state.committedRenderSet.size > 0) {
          for (const old of state.committedRenderSet) {
            if (
              uncovered.some(
                (region) =>
                  isAncestorOrSame(old, region) ||
                  isAncestorOrSame(region, old),
              )
            ) {
              retained.push(old);
            }
          }
          // 移除那些已被新选中瓦片完全覆盖的保留瓦片。
          retained = retained.filter(
            (old) => !selected.some((s) => isAncestorOrSame(s, old)),
          );
        }

        // 如果新选中的瓦片仍位于保留父瓦片之下，则暂时丢弃它们，避免透明叠加。
        // 只有当父瓦片整块区域都被覆盖后，子瓦片才会一次性接管。
        const merged =
          retained.length === 0
            ? selected
            : selected.filter(
                (s) => !retained.some((old) => isAncestorOrSame(old, s)),
              );

        retainedTileCount += retained.length;
        refreshRetainedTileCount += retained.filter(
          (tile) => layer.isCurrentContentRevision?.(tile) === false,
        ).length;
        this._commitRenderSet(state, [...merged, ...retained], () =>
          this._syncLayerPointCollections(layer, state),
        );
      }

      // 诊断仪表盘统计（仅渲染通道）。
      let committedTileCount = 0;
      let retiredResidentTiles = 0;
      let staleResidentTiles = 0;
      let currentContentRevision = 0;
      for (const state of this._layerRenderStates.values()) {
        committedTileCount += state.committedRenderSet.size;
      }
      const layers = this._tileProvider.vectorTileLayers;
      if (layers) {
        for (let i = 0; i < layers.length; ++i) {
          const layer = layers.get(i);
          const statistics = layer.getCacheStatistics?.();
          retiredResidentTiles += statistics?.retiredTiles ?? 0;
          staleResidentTiles += statistics?.staleTiles ?? 0;
          currentContentRevision = Math.max(
            currentContentRevision,
            layer.contentRevision ?? 0,
          );
        }
      }
      this._diagnostics?.setGauge("idealTiles", idealTileCount);
      this._diagnostics?.setGauge("committedRenderTiles", committedTileCount);
      this._diagnostics?.setGauge("ancestorFallbackTiles", retainedTileCount);
      this._diagnostics?.setGauge(
        "refreshRetainedTiles",
        refreshRetainedTileCount,
      );
      this._diagnostics?.setGauge("retiredResidentTiles", retiredResidentTiles);
      this._diagnostics?.setGauge("staleResidentTiles", staleResidentTiles);
      this._diagnostics?.setGauge(
        "currentContentRevision",
        currentContentRevision,
      );
      this._diagnostics?.setGauge("warmingUpTiles", warmupTiles.size);
    }

    // ----------------------------------------------------------------
    // 阶段 3（渲染通道 + 选取通道）：
    // 从 `committedRenderSet` 中提交图元。选取通道沿用上一次渲染通道
    // 已提交的集合，以保证二者结果一致。
    // ----------------------------------------------------------------
    const submittedPrimitives = new Set();
    let primitiveCandidates = 0;
    let preventedDuplicatePrimitives = 0;

    for (const [layer, state] of this._layerRenderStates) {
      if (!layer._show || state.committedRenderSet.size === 0) {
        continue;
      }
      const sharedPrimitives =
        layer.sharedPointCollections?.getPrimitives() ?? [];
      for (let i = 0; i < sharedPrimitives.length; ++i) {
        const primitive = sharedPrimitives[i];
        primitiveCandidates++;
        if (submittedPrimitives.has(primitive)) {
          preventedDuplicatePrimitives++;
          continue;
        }
        submittedPrimitives.add(primitive);
        primitive.show = true;
        primitive.update(frameState);
      }
      for (const tile of state.committedRenderSet) {
        layer.processBucketRebuilds?.(tile, frameState);
        layer.applyPendingStyleUpdates?.(tile);
        const layerPrimitives = tile.primitives || {};
        const primitiveKeys = Object.keys(layerPrimitives);
        for (let ki = 0; ki < primitiveKeys.length; ++ki) {
          const primitives = layerPrimitives[primitiveKeys[ki]];
          const bucket = tile.buckets?.[primitiveKeys[ki]];
          for (let pi = 0; pi < primitives.length; ++pi) {
            const primitive = primitives[pi];
            primitiveCandidates++;
            if (submittedPrimitives.has(primitive)) {
              preventedDuplicatePrimitives++;
              continue;
            }
            submittedPrimitives.add(primitive);
            primitive.show =
              bucket?.isPrimitiveVisible?.(primitive) ??
              bucket?.styleRule?.visibility !== false;
            primitive.update(frameState);
          }
        }
      }
    }

    // ----------------------------------------------------------------
    // 阶段 4（仅渲染通道）：
    // 预热那些已构建但 GPU 资源尚未就绪的图元。某些 Cesium 集合在
    // `show=false` 时会提前返回，因此 `warmUpPrimitive` 会临时打开 `show`，
    // 调用一次更新，再把 `frameState.commandList` 截回原长度。
    // 这样既能推进内部资源状态，又不会在当前帧真正绘制出来。
    // 预热预算按帧控制，且 `warmupTiles` 保留 `_tilesToRender` 的由近到远顺序，
    // 因而离相机更近的瓦片会优先预热，其余瓦片在后续帧继续推进，期间仍由保留的父瓦片兜底。
    // ----------------------------------------------------------------
    if (isRenderPass) {
      let warmupBudget = this._warmupTilesPerFrame;
      for (const tile of warmupTiles) {
        if (warmupBudget <= 0) {
          break;
        }
        warmupBudget--;
        tile.vectorTileLayer?.applyPendingStyleUpdates?.(tile);
        const layerPrimitives = tile.primitives || {};
        const primitiveKeys = Object.keys(layerPrimitives);
        for (let ki = 0; ki < primitiveKeys.length; ++ki) {
          const primitives = layerPrimitives[primitiveKeys[ki]];
          for (let pi = 0; pi < primitives.length; ++pi) {
            const primitive = primitives[pi];
            if (submittedPrimitives.has(primitive)) {
              continue;
            }
            if (primitive.show === false) {
              continue;
            }
            warmUpPrimitive(primitive, frameState);
          }
        }
      }
    }

    this._diagnostics?.recordDuration("renderSubmit", startTime);
    this._diagnostics?.recordRenderPass({
      pass: frameState.passes.pick ? "pick" : "render",
      quadtreeTiles: tilesToRender.length,
      readyVectorTiles: idealTileCount,
      primitiveCandidates,
      primitiveSubmissions: submittedPrimitives.size,
      preventedDuplicatePrimitives,
      suppressedLodVectorTiles,
    });
  }
}

function warmUpPrimitive(primitive, frameState) {
  const commandListLength = frameState.commandList.length;
  const show = primitive.show;
  primitive.show = true; // 某些 Cesium 集合在 show=false 时会提前返回，这里临时打开以完成预热。
  primitive.update(frameState);
  primitive.show = show;
  frameState.commandList.length = commandListLength;
}
