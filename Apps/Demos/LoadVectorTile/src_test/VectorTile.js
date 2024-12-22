import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";
const { defined, destroyObject, ImageryState } = Cesium;

/**
 * Stores details about a tile of vector.
 *
 * @alias VectorTile
 * @private
 */
function VectorTile(vectorTileLayer, x, y, level, rectangle) {
  this.vectorTileLayer = vectorTileLayer;
  this.x = x;
  this.y = y;
  this.level = level;

  if (level !== 0) {
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
  this.imageUrl = undefined;
  this.features = undefined;
  this.arrayBuffer = undefined;
  this.primitives = undefined;
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
    this.vectorTileLayer.removeVectorTileFromCache(this);

    if (defined(this.parent)) {
      this.parent.releaseReference();
    }

    if (defined(this.features)) {
      this.features = undefined;
    }

    if (defined(this.arrayBuffer)) {
      this.arrayBuffer = undefined;
    }

    if (defined(this.primitives)) {
      Object.keys(this.primitives).forEach((key) => {
        this.primitives[key].forEach((p) => p.destroy());
        delete this.primitives[key];
      });
      this.primitives = undefined;
    }

    destroyObject(this);

    return 0;
  }

  return this.referenceCount;
};

VectorTile.prototype.processStateMachine = function (frameState, skipLoading) {
  if (this.state === ImageryState.UNLOADED && !skipLoading) {
    this.state = ImageryState.TRANSITIONING;
    this.vectorTileLayer._requestTile(this);
  }

  if (this.state === ImageryState.RECEIVED) {
    this.state = ImageryState.TRANSITIONING;
    this.vectorTileLayer._createTilePrimitives(this);
  }
};
export default VectorTile;
