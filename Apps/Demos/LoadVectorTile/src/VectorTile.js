import defined from "../../../../packages/engine/Source/Core/defined.js";
import destroyObject from "../../../../packages/engine/Source/Core/destroyObject.js";
import ImageryState from "../../../../packages/engine/Source/Scene/ImageryState.js";
import VectorTileCoverageState from "./VectorTileCoverageState.js";
import SharedPointCollections from "./SharedPointCollections.js";
/**
 * 矢量瓦片栈中与 Cesium `Imagery` 对应的数据对象，
 * 保存单个矢量瓦片的请求、解码、构建、缓存与父子层级状态。
 *
 * @alias VectorTile
 * @private
 */
function VectorTile(
  vectorTileLayer,
  x,
  y,
  level,
  rectangle,
  contentRevision,
  styleDocument,
) {
  this.vectorTileLayer = vectorTileLayer;
  this.cache = vectorTileLayer._vectorTileCache;
  this.x = x;
  this.y = y;
  this.level = level;
  this.contentRevision =
    contentRevision ?? vectorTileLayer.contentRevision ?? 0;
  this.styleDocument = styleDocument;

  const minimumLevel = vectorTileLayer.vectorTileProvider.minimumLevel;
  if (level > minimumLevel) {
    const parentX = (x / 2) | 0;
    const parentY = (y / 2) | 0;
    const parentLevel = level - 1;
    this.parent = vectorTileLayer.getVectorTileFromCache(
      parentX,
      parentY,
      parentLevel,
    );
  }

  this.state = ImageryState.UNLOADED;
  this.coverageState = VectorTileCoverageState.PENDING;
  this.imageUrl = undefined;
  this.features = undefined;
  this.propertyProjections = undefined;
  this.residentFeatureTableEntries = 0;
  this.residentPickPropertyValues = 0;
  this.arrayBuffer = undefined;
  this.arrayBufferBytes = 0;
  this.primitives = undefined;
  this.buckets = undefined;
  this.primitiveStyleRules = undefined;
  this.pointBuckets = undefined;
  this.builtStyleLayerIds = undefined;
  this.terminalReason = undefined;
  this.released = false;
  this.priority = 0;
  this.networkTask = undefined;
  this.decodeTask = undefined;
  this.buildTask = undefined;
  this.bucketRebuilds = undefined;
  this.cacheKey = undefined;
  this.cacheBytes = 0;
  this.cacheStale = false;
  this.cacheable = false;
  this.lastCacheAccess = 0;
  this.lastNeededFrame = 0;
  this.credits = undefined;
  this.referenceCount = 0;

  if (!defined(rectangle) && vectorTileLayer.ready) {
    const tilingScheme = vectorTileLayer.vectorTileProvider.tilingScheme;
    rectangle = tilingScheme.tileXYToRectangle(x, y, level);
  }

  this.rectangle = rectangle;
}
VectorTile.createPlaceholder = function (vectorTileLayer) {
  const result = new VectorTile(vectorTileLayer, 0, 0, 0);
  result.addReference();
  result.state = ImageryState.PLACEHOLDER;
  return result;
};

VectorTile.prototype.addReference = function () {
  if (this.referenceCount === 0) {
    this.cache.tileReferenced?.(this);
  }
  ++this.referenceCount;
};

VectorTile.prototype.releaseReference = function () {
  --this.referenceCount;

  if (this.referenceCount === 0) {
    this.cache.tileReleased(this);
    return 0;
  }

  return this.referenceCount;
};

/**
 * 覆盖是否已经完成（无论是否有可绘制内容）。
 * READY、READY_EMPTY、UNAVAILABLE 均视为覆盖完整。
 */
Object.defineProperty(VectorTile.prototype, "coverageComplete", {
  get: function () {
    return (
      this.coverageState === VectorTileCoverageState.READY ||
      this.coverageState === VectorTileCoverageState.READY_EMPTY ||
      this.coverageState === VectorTileCoverageState.UNAVAILABLE
    );
  },
});

VectorTile.prototype.processStateMachine = function (
  frameState,
  skipLoading,
  priority,
) {
  // 续租标记：仍被四叉树需要的瓦片会在每帧继续推进状态机。
  // 长时间未被续租的在途请求会由 `VectorTileLayer.cancelStaleRequests`
  // 主动取消。
  this.lastNeededFrame = frameState.frameNumber;
  this.priority = Number.isFinite(priority) ? priority : this.priority;
  this.networkTask?.setPriority(this.priority);
  this.decodeTask?.setPriority(this.priority);
  this.buildTask?.setPriority(this.priority);
  if (this.bucketRebuilds) {
    Object.values(this.bucketRebuilds).forEach((rebuild) => {
      rebuild.setPriority?.(this.priority);
    });
  }
  if (this.state === ImageryState.UNLOADED && !skipLoading) {
    this.vectorTileLayer._requestTile(this);
  }

  if (this.state === ImageryState.RECEIVED) {
    this.state = ImageryState.TRANSITIONING;
    this.vectorTileLayer._createTilePrimitives(this);
  }
};

VectorTile.prototype.isDestroyed = function () {
  return this.released;
};

VectorTile.prototype.cancelPendingTasks = function () {
  this.networkTask?.cancel();
  this.decodeTask?.cancel();
  this.buildTask?.cancel();
  if (this.bucketRebuilds) {
    Object.values(this.bucketRebuilds).forEach((rebuild) => {
      rebuild.cancel?.();
    });
  }
};

VectorTile.prototype.destroyResources = function () {
  if (this.released) {
    return;
  }
  this.released = true;
  this.cancelPendingTasks();

  if (defined(this.pointBuckets)) {
    Object.keys(this.pointBuckets).forEach((bucketId) => {
      this.vectorTileLayer.sharedPointCollections.removeTileEntries(
        SharedPointCollections.createSharedPointEntryKey(this, bucketId),
      );
      delete this.pointBuckets[bucketId];
    });
    this.pointBuckets = undefined;
  }

  if (defined(this.parent)) {
    this.parent.releaseReference();
    this.parent = undefined;
  }
  if (defined(this.features)) {
    this.vectorTileLayer._diagnostics?.addGauge(
      "residentFeatureTableEntries",
      -this.residentFeatureTableEntries,
    );
    this.vectorTileLayer._diagnostics?.addGauge(
      "residentPickPropertyValues",
      -this.residentPickPropertyValues,
    );
    this.features = undefined;
    this.propertyProjections = undefined;
    this.residentFeatureTableEntries = 0;
    this.residentPickPropertyValues = 0;
  }

  if (defined(this.arrayBuffer)) {
    this.vectorTileLayer._diagnostics?.addGauge(
      "residentArrayBufferBytes",
      -this.arrayBufferBytes,
    );
    this.arrayBuffer = undefined;
    this.arrayBufferBytes = 0;
  }

  if (defined(this.buckets)) {
    Object.keys(this.buckets).forEach((key) => {
      this.buckets[key].destroy();
      delete this.buckets[key];
    });
    this.buckets = undefined;
    this.primitives = undefined;
  } else if (defined(this.primitives)) {
    Object.keys(this.primitives).forEach((key) => {
      this.primitives[key].forEach((primitive) => {
        if (!primitive.isDestroyed()) {
          primitive.destroy();
        }
      });
      delete this.primitives[key];
    });
    this.primitives = undefined;
  }
  this.primitiveStyleRules = undefined;
  this.builtStyleLayerIds = undefined;
  destroyObject(this);
};

export default VectorTile;
