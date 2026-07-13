import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import {
  selectByCoverage,
  isAncestorOrSame,
} from "./VectorTileLodSelection.js";
import { createSharedPointEntryKey } from "./SharedPointCollections.js";

/**
 * Returns whether all of a tile's primitives are actually drawable this frame.
 * With `asynchronous: true`, a Cesium Primitive produces no draw commands for
 * several frames after construction while its geometry is processed in a web
 * worker — so ImageryState.READY alone does NOT mean the tile can render.
 * Treating such tiles as coverage would swap the parent out before the
 * children can draw, flashing a hole.
 *
 * @param {object} tile
 * @returns {boolean}
 */
function arePrimitivesReady(tile) {
  const layerPrimitives = tile.primitives;
  if (!layerPrimitives) {
    return true; // READY_EMPTY: nothing to draw, trivially drawable.
  }
  const keys = Object.keys(layerPrimitives);
  for (let ki = 0; ki < keys.length; ++ki) {
    const primitives = layerPrimitives[keys[ki]];
    for (let pi = 0; pi < primitives.length; ++pi) {
      if (!primitives[pi].ready) {
        return false;
      }
    }
  }
  return true;
}

export default class VectorTileQuadtreePrimitive
  extends Cesium.QuadtreePrimitive
{
  constructor(options) {
    super(options);
    this._diagnostics = options.diagnostics;
    /**
     * Maximum number of tiles whose primitives are warmed up (advanced
     * through Cesium's async geometry pipeline) per frame. Caps the burst of
     * batch-table creation / geometry-worker scheduling / vertex-array upload
     * when an entire top-down viewport crosses an LOD threshold at once;
     * tiles over budget keep showing their retained parent until warmed.
     */
    this._warmupTilesPerFrame = options.warmupTilesPerFrame ?? 4;
    /**
     * Per-layer stable render state.  Each entry has:
     *   committedRenderSet – Set of VectorTiles actually drawn; members hold
     *                        a reference so the cache cannot evict them while
     *                        they are still on screen.
     *   committedPointEntries – Map of shared point-entry keys currently
     *                           present in the layer-owned shared collections.
     */
    this._layerRenderStates = new Map();
  }

  /**
   * Clears the committed render set for a layer without removing its entry.
   * Call when a layer is hidden.
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
   * Removes the render state entry for a layer entirely.  Call when a layer
   * is removed or destroyed.
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
   * Replaces a layer's committedRenderSet while maintaining reference counts,
   * so the cache never evicts (and destroys the primitives of) a tile that is
   * still being drawn as an LOD fallback. Newly committed tiles gain a
   * reference; tiles leaving the committed set release theirs.
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

  _syncLayerPointCollections(layer, state, styleZoom) {
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
        if (!isStyleRuleVisibleForZoom(pointBucket.styleRule, styleZoom)) {
          continue;
        }

        const pointKey = createSharedPointEntryKey(tile, bucketId);
        nextPointEntries.set(pointKey, pointBucket);
      }
    }

    for (const [pointKey, pointBucket] of nextPointEntries) {
      if (
        !state.committedPointEntries.has(pointKey) ||
        !sharedPointCollections.hasTileEntries(pointKey)
      ) {
        sharedPointCollections.addTileEntries(
          pointKey,
          pointBucket.descriptors,
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
   * Cancels in-flight requests for tiles no longer needed by the quadtree
   * (renewal stamp expired), freeing scheduler slots for visible tiles
   * during camera movement.
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
    // Phase 1 (render pass only): per layer, collect from _tilesToRender:
    //   - candidates: READY vector tiles (`readyVectorTile` already resolves
    //     to the nearest READY ancestor while the exact tile loads, so
    //     ancestor fallbacks are inherent), and
    //   - regions: the exact tile coordinates each visible quadtree tile
    //     ideally wants, used below for per-region coverage checks.
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
          // The exact tile this region wants; readyVectorTile may be an
          // ancestor fallback, loadingVectorTile is always the exact one.
          const exact =
            tileVectorTile.loadingVectorTile ?? tileVectorTile.readyVectorTile;
          if (!exact) {
            continue;
          }
          // Renew the request stamp here rather than relying on the load
          // queue's 5ms time slice, which can starve visible tiles during
          // load storms and cause spurious cancel/re-request churn.
          exact.lastNeededFrame = frameState.frameNumber;
          const layer = exact.vectorTileLayer;

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

          // READY_EMPTY exact tiles complete coverage even when their
          // readyVectorTile still points at a drawable ancestor fallback.
          const exactCoverage =
            exact.state === Cesium.ImageryState.READY && exact.coverageComplete
              ? exact
              : undefined;
          const vt = exactCoverage ?? tileVectorTile.readyVectorTile;
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
              // Constructed but not yet GPU-ready: warm it up hidden below.
              // Its region stays uncovered, so retention keeps the old tile.
              warmupTiles.add(vt);
            }
          }
        }
      }

      // ----------------------------------------------------------------
      // Phase 2 (render pass only): resolve each layer's render set via
      //   coverage-tree analysis and commit it every frame. Regions that lack
      //   any coverage this frame (plan 5.1 rules 4-5) are backfilled from the
      //   previously committed set, per region, so panning or zooming into
      //   still-loading areas keeps showing last frame's tiles there instead
      //   of flashing holes. Parent/child dedup keeps the merged set
      //   overlap-free (an on-screen old parent suppresses partially-ready new
      //   children until its whole region can be replaced atomically).
      // ----------------------------------------------------------------
      for (const [layer, entry] of layerEntries) {
        const state = this._getOrCreateLayerState(layer);
        const { candidates, regions } = entry;

        const selected = selectByCoverage(candidates);
        suppressedLodVectorTiles += candidates.size - selected.length;

        // Regions with no READY tile covering them this frame.
        const uncovered = regions.filter(
          (region) => !selected.some((s) => isAncestorOrSame(s, region)),
        );

        // Backfill uncovered regions from the previously committed set:
        // keep any old tile that covers, or lies within, an uncovered region.
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
          // Drop retained tiles already covered by a newly selected tile.
          retained = retained.filter(
            (old) => !selected.some((s) => isAncestorOrSame(s, old)),
          );
        }

        // Drop selected tiles lying under a retained old parent to avoid
        // translucent overlap; they take over atomically once the parent's
        // entire region is covered.
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
        const styleZoom = layer.getFrameStyleZoom(frameState);
        this._commitRenderSet(state, [...merged, ...retained], () =>
          this._syncLayerPointCollections(layer, state, styleZoom),
        );
      }

      // Diagnostic gauges (render pass only)
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
    // Phase 3 (render + pick passes): submit primitives from the
    //   committedRenderSet.  Pick uses the same committed set as the
    //   preceding render pass, ensuring consistency.
    // ----------------------------------------------------------------
    const submittedPrimitives = new Set();
    let primitiveCandidates = 0;
    let preventedDuplicatePrimitives = 0;

    for (const [layer, state] of this._layerRenderStates) {
      if (!layer._show || state.committedRenderSet.size === 0) {
        continue;
      }
      const styleZoom = layer.getFrameStyleZoom(frameState);
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
        const layerPrimitives = tile.primitives || {};
        const primitiveKeys = Object.keys(layerPrimitives);
        for (let ki = 0; ki < primitiveKeys.length; ++ki) {
          const styleRule = tile.primitiveStyleRules?.[primitiveKeys[ki]];
          if (!isStyleRuleVisibleForZoom(styleRule, styleZoom)) {
            continue;
          }
          const primitives = layerPrimitives[primitiveKeys[ki]];
          for (let pi = 0; pi < primitives.length; ++pi) {
            const primitive = primitives[pi];
            primitiveCandidates++;
            if (submittedPrimitives.has(primitive)) {
              preventedDuplicatePrimitives++;
              continue;
            }
            submittedPrimitives.add(primitive);
            primitive.show = true;
            primitive.update(frameState);
          }
        }
      }
    }

    // ----------------------------------------------------------------
    // Phase 4 (render pass only): warm up primitives that are constructed but
    //   not yet GPU-ready. Some Cesium collections return early when
    //   show=false, so warmUpPrimitive temporarily enables show, updates the
    //   primitive, then truncates frameState.commandList back to its previous
    //   length. This advances internal resources without drawing this frame.
    //   Budgeted per frame: warmupTiles preserves _tilesToRender's near-to-far
    //   iteration order, so the closest tiles warm first and the rest follow
    //   in subsequent frames while retention keeps their parents on screen.
    // ----------------------------------------------------------------
    if (isRenderPass) {
      let warmupBudget = this._warmupTilesPerFrame;
      for (const tile of warmupTiles) {
        if (warmupBudget <= 0) {
          break;
        }
        warmupBudget--;
        const layerPrimitives = tile.primitives || {};
        const primitiveKeys = Object.keys(layerPrimitives);
        for (let ki = 0; ki < primitiveKeys.length; ++ki) {
          const primitives = layerPrimitives[primitiveKeys[ki]];
          for (let pi = 0; pi < primitives.length; ++pi) {
            const primitive = primitives[pi];
            if (submittedPrimitives.has(primitive)) {
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
  primitive.show = true; // Some Cesium collections return early when show=false, so temporarily enable it to warm up.
  primitive.update(frameState);
  primitive.show = show;
  frameState.commandList.length = commandListLength;
}

function isStyleRuleVisibleForZoom(styleRule, zoom) {
  if (!styleRule || !Number.isFinite(zoom)) {
    return true;
  }
  return (
    (styleRule.minzoom === undefined || zoom >= styleRule.minzoom) &&
    (styleRule.maxzoom === undefined || zoom < styleRule.maxzoom)
  );
}
