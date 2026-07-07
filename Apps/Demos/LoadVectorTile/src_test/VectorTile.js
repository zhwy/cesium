import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileCoverageState from "./VectorTileCoverageState.js";
const { defined, destroyObject, ImageryState } = Cesium;

/**
 * Stores details about a tile of vector.
 *
 * @alias VectorTile
 * @private
 */
function VectorTile(vectorTileLayer, x, y, level, rectangle) {
  this.vectorTileLayer = vectorTileLayer;
  this.cache = vectorTileLayer._vectorTileCache;
  this.x = x;
  this.y = y;
  this.level = level;

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
  this.arrayBuffer = undefined;
  this.arrayBufferBytes = 0;
  this.primitives = undefined;
  this.terminalReason = undefined;
  this.released = false;
  this.priority = 0;
  this.networkTask = undefined;
  this.decodeTask = undefined;
  this.buildTask = undefined;
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
  // Renewal stamp: tiles still wanted by the quadtree are processed every
  // frame. In-flight requests whose stamp goes stale are cancelled by
  // VectorTileLayer.cancelStaleRequests.
  this.lastNeededFrame = frameState.frameNumber;
  this.priority = Number.isFinite(priority) ? priority : this.priority;
  this.networkTask?.setPriority(this.priority);
  this.decodeTask?.setPriority(this.priority);
  this.buildTask?.setPriority(this.priority);
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
};

VectorTile.prototype.destroyResources = function () {
  if (this.released) {
    return;
  }
  this.released = true;
  this.cancelPendingTasks();

  if (defined(this.parent)) {
    this.parent.releaseReference();
    this.parent = undefined;
  }
  this.features = undefined;

  if (defined(this.arrayBuffer)) {
    this.vectorTileLayer._diagnostics?.addGauge(
      "residentArrayBufferBytes",
      -this.arrayBufferBytes,
    );
    this.arrayBuffer = undefined;
    this.arrayBufferBytes = 0;
  }

  if (defined(this.primitives)) {
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
  destroyObject(this);
};
export default VectorTile;
