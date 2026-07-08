const CESIUM_DEFAULT_QUADTREE_TILE_WIDTH = 65;
const DEFAULT_STYLE_ZOOM_TILE_WIDTH = 512;
const WEB_MERCATOR_EQUATORIAL_RADIUS = 6378137.0;
const WEB_MERCATOR_CIRCUMFERENCE =
  2.0 * Math.PI * WEB_MERCATOR_EQUATORIAL_RADIUS;

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

/**
 * Computes one frame-wide style zoom from camera height.  Unlike
 * computeVectorTileStyleZoom(tileLevel), this does not depend on any data tile
 * or fallback tile LOD, so layer visibility is stable across near/far tiles in
 * the same frame.
 *
 * @param {object} frameState Cesium frameState.
 * @param {object} [options]
 * @param {number} [options.styleZoom] Explicit style zoom override.
 * @param {number} [options.styleZoomTileWidth=512] Map-style tile width.
 * @param {object} [options.scene] Cesium scene, used to query terrain height.
 * @returns {number}
 */
export function computeCameraVectorTileStyleZoom(frameState, options = {}) {
  if (Number.isFinite(options.styleZoom)) {
    return Math.max(0, options.styleZoom);
  }

  const camera = frameState?.camera;
  const cartographic = camera?.positionCartographic;
  if (!camera || !cartographic) {
    return 0;
  }

  const height = getCameraHeightAboveGround(cartographic, options);
  const viewportHeight = getViewportHeight(frameState);
  const metersPerPixel = getMetersPerPixel(
    camera.frustum,
    height,
    viewportHeight,
  );
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return 0;
  }

  const latitudeScale = Math.max(0.01, Math.cos(cartographic.latitude ?? 0));
  const tileWidth = getStyleZoomTileWidth(options.styleZoomTileWidth);
  return Math.max(
    0,
    Math.log2(
      (WEB_MERCATOR_CIRCUMFERENCE * latitudeScale) /
        (tileWidth * metersPerPixel),
    ),
  );
}

function getCameraHeightAboveGround(cartographic, options) {
  const ellipsoidHeight = Number(cartographic.height);
  let terrainHeight = 0.0;
  const globe = options.scene?.globe ?? options.globe;
  if (globe?.getHeight) {
    const height = globe.getHeight(cartographic);
    if (Number.isFinite(height)) {
      terrainHeight = height;
    }
  }
  return Math.max(1.0, ellipsoidHeight - terrainHeight);
}

function getViewportHeight(frameState) {
  const context = frameState?.context;
  const height =
    context?.drawingBufferHeight ??
    context?.canvas?.height ??
    context?.canvas?.clientHeight ??
    1;
  return Math.max(1, height);
}

function getMetersPerPixel(frustum, height, viewportHeight) {
  if (Number.isFinite(frustum?.fovy)) {
    return (2.0 * height * Math.tan(frustum.fovy * 0.5)) / viewportHeight;
  }

  if (Number.isFinite(frustum?.top) && Number.isFinite(frustum?.bottom)) {
    return Math.abs(frustum.top - frustum.bottom) / viewportHeight;
  }

  return undefined;
}

function getStyleZoomTileWidth(styleZoomTileWidth) {
  return Number.isFinite(styleZoomTileWidth) && styleZoomTileWidth > 0
    ? styleZoomTileWidth
    : DEFAULT_STYLE_ZOOM_TILE_WIDTH;
}
