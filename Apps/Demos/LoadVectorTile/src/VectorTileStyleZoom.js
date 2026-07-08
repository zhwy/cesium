const CESIUM_DEFAULT_QUADTREE_TILE_WIDTH = 65;
const DEFAULT_STYLE_ZOOM_TILE_WIDTH = 512;

/**
 * Computes the zoom value used by style expressions.  Cesium's generic
 * QuadtreePrimitive LOD uses a default 65px geometric-error denominator, while
 * map-style zoom is usually understood in imagery/vector-map tile pixels such
 * as 256 or 512.  Keep data tile level and style zoom separate so `["zoom"]`
 * controls visual styling instead of leaking the internal vector quadtree LOD.
 *
 * @param {number} tileLevel Internal vector quadtree / data tile level.
 * @param {object} [options]
 * @param {number} [options.styleZoom] Explicit style zoom override.
 * @param {number} [options.styleZoomOffset] Explicit offset applied to tileLevel.
 * @param {number} [options.styleZoomTileWidth=512] Map-style tile width used
 *        to derive the default offset. 512 matches the demo's
 *        TileCoordinatesImageryProvider setting.
 * @returns {number}
 */
export function computeVectorTileStyleZoom(tileLevel, options = {}) {
  if (Number.isFinite(options.styleZoom)) {
    return Math.max(0, options.styleZoom);
  }

  const offset = Number.isFinite(options.styleZoomOffset)
    ? options.styleZoomOffset
    : computeStyleZoomOffset(options.styleZoomTileWidth);
  return Math.max(0, tileLevel + offset);
}

export function computeStyleZoomOffset(
  styleZoomTileWidth = DEFAULT_STYLE_ZOOM_TILE_WIDTH,
) {
  if (!Number.isFinite(styleZoomTileWidth) || styleZoomTileWidth <= 0) {
    styleZoomTileWidth = DEFAULT_STYLE_ZOOM_TILE_WIDTH;
  }
  return Math.log2(CESIUM_DEFAULT_QUADTREE_TILE_WIDTH / styleZoomTileWidth);
}
