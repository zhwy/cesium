import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";
const { defined, ImageryState } = Cesium;

/**
 * The assocation between a terrain tile and a vector tile.
 *
 * @alias TileVectorTile
 * @private
 */
function TileVectorTile(vectorTile) {
  this.readyVectorTile = undefined;
  this.loadingVectorTile = vectorTile;
}

/**
 * Frees the resources held by this instance.
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
 * Processes the load state machine for this instance.
 *
 * @param {Tile} tile The tile to which this instance belongs.
 * @param {FrameState} frameState The frameState.
 * @param {boolean} skipLoading True to skip loading, e.g. new requests, creating textures. This function will
 *                  still synchronously process imagery that's already mostly ready to go, e.g. use textures
 *                  already loaded on ancestor tiles.
 * @returns {boolean} True if this instance is done loading; otherwise, false.
 */
TileVectorTile.prototype.processStateMachine = function (
  tile,
  frameState,
  skipLoading,
) {
  const loadingVectorTile = this.loadingVectorTile;

  loadingVectorTile.processStateMachine(frameState, skipLoading);

  if (loadingVectorTile.state === ImageryState.READY) {
    if (defined(this.readyVectorTile)) {
      this.readyVectorTile.releaseReference();
    }
    this.readyVectorTile = this.loadingVectorTile;
    this.loadingVectorTile = undefined;
    return true; // done loading
  }

  // Find some ancestor imagery we can use while this imagery is still loading.
  let ancestor = loadingVectorTile.parent;
  let closestAncestorThatNeedsLoading;
  while (defined(ancestor) && ancestor.state !== ImageryState.READY) {
    if (
      ancestor.state !== ImageryState.FAILED &&
      ancestor.state !== ImageryState.INVALID
    ) {
      // ancestor is still loading
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
    // The imagery tile is failed or invalid, so we'd like to use an ancestor instead.
    if (defined(closestAncestorThatNeedsLoading)) {
      // Push the ancestor's load process along a bit.  This is necessary because some ancestor imagery
      // tiles may not be attached directly to a terrain tile.  Such tiles will never load if
      // we don't do it here.
      closestAncestorThatNeedsLoading.processStateMachine(
        frameState,
        skipLoading,
      );
      return false; // not done loading
    }
    // This imagery tile is failed or invalid, and we have the "best available" substitute.
    return true; // done loading
  }

  return false; // not done loading
};
export default TileVectorTile;
