import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorSurfaceTile from "./VectorSurfaceTile.js";

const {
  defined,
  Rectangle,
  BoundingSphere,
  Cartesian3,
  Cartographic,
  SceneMode,
  Visibility,
  TileBoundingRegion,
  Math: CesiumMath,
  OrthographicFrustum,
  Intersect,
  EllipsoidalOccluder,
} = Cesium;

function isUndergroundVisible(tileProvider, frameState) {
  if (frameState.cameraUnderground) {
    return true;
  }

  if (frameState.globeTranslucencyState.translucent) {
    return true;
  }

  if (tileProvider.backFaceCulling) {
    return false;
  }

  const clippingPlanes = tileProvider._clippingPlanes;
  if (defined(clippingPlanes) && clippingPlanes.enabled) {
    return true;
  }

  if (
    !Rectangle.equals(
      tileProvider.cartographicLimitRectangle,
      Rectangle.MAX_VALUE,
    )
  ) {
    return true;
  }

  return false;
}

const boundingSphereScratch = new BoundingSphere();
const rectangleIntersectionScratch = new Rectangle();
const splitCartographicLimitRectangleScratch = new Rectangle();
const rectangleCenterScratch = new Cartographic();

// `cartographicLimitRectangle` 可能跨越日期变更线，但单个瓦片自身不会。
function clipRectangleAntimeridian(tileRectangle, cartographicLimitRectangle) {
  if (cartographicLimitRectangle.west < cartographicLimitRectangle.east) {
    return cartographicLimitRectangle;
  }
  const splitRectangle = Rectangle.clone(
    cartographicLimitRectangle,
    splitCartographicLimitRectangleScratch,
  );
  const tileCenter = Rectangle.center(tileRectangle, rectangleCenterScratch);
  if (tileCenter.longitude > 0.0) {
    splitRectangle.east = CesiumMath.PI;
  } else {
    splitRectangle.west = -CesiumMath.PI;
  }
  return splitRectangle;
}

function updateTileBoundingRegion(tile, tileProvider, frameState, options) {
  let surfaceTile = tile.data;
  if (surfaceTile === undefined) {
    surfaceTile = tile.data = new VectorSurfaceTile();
  }

  const ellipsoid = tile.tilingScheme.ellipsoid;
  if (surfaceTile.tileBoundingRegion === undefined) {
    surfaceTile.tileBoundingRegion = new TileBoundingRegion({
      computeBoundingVolumes: true,
      rectangle: tile.rectangle,
      ellipsoid: ellipsoid,
      minimumHeight: options.minimumHeight,
      maximumHeight: options.maximumHeight,
    });
    surfaceTile.tileBoundingRegion.computeBoundingVolumes(ellipsoid);
    // 矢量瓦片的高度在这里是固定常量，因此当前瓦片的包围区域始终是权威值。
    // 如果不这样处理，`computeTileVisibility` 会对所有瓦片都直接返回
    // `Visibility.PARTIAL`，导致既没有视锥裁剪也没有地平线裁剪，
    // 进而把整颗全球瓦片金字塔都塞进 `_tilesToRender`，并拖垮加载队列。
    surfaceTile.boundingVolumeSourceTile = tile;
    // `GlobeSurfaceTile` 默认会把 `occludeePointInScaledSpace` 初始化成零向量，
    // 地平线裁剪会把它视为“永远不可见”，从而错误剔除所有瓦片。
    // 这里根据瓦片矩形重新计算真实的地平线裁剪点；对于过大的矩形
    // （例如根瓦片）该值会返回 `undefined`，从而正确跳过地平线裁剪。
    let occluder = tileProvider._ellipsoidalOccluder;
    if (!defined(occluder)) {
      occluder = tileProvider._ellipsoidalOccluder = new EllipsoidalOccluder(
        ellipsoid,
      );
    }
    surfaceTile.occludeePointInScaledSpace =
      occluder.computeHorizonCullingPointFromRectangle(
        tile.rectangle,
        ellipsoid,
      );
  }
}

/**
 * 计算零层级几何误差，使四叉树的 LOD 切换点能够与地图样式
 * （Mapbox 风格）的缩放级别精确对齐，而不是碰巧依赖 Cesium
 * 默认地形高度图参数（65 顶点网格乘 0.25 质量因子）凑巧接近。
 *
 * 推导如下：当满足以下条件时，`QuadtreePrimitive` 会渲染层级 `L`：
 *   SSE(L) = error(L) / metersPerDevicePixel <= maximumScreenSpaceError.
 * 而地图样式会在 CSS 像素分辨率达到瓦片像素间距时切换到缩放级别 `L`：
 *   metersPerCssPixel = C / (N * 2^L * tileWidth)
 * 其中 `C` 是切片方案对应椭球的赤道周长，`N` 是零层级 X 方向瓦片数，
 * `tileWidth` 是地图样式中的瓦片宽度（CSS 像素）。
 * 令 `metersPerDevicePixel = metersPerCssPixel / pixelRatio`，把两类切换点对齐后可得：
 *   error(L) = maximumScreenSpaceError * C / (N * 2^L * tileWidth * pixelRatio)
 *
 * @param {TilingScheme} tilingScheme
 * @param {number} tileWidth 地图样式里的瓦片宽度（CSS 像素，Mapbox 常用 512）。
 * @param {number} maximumScreenSpaceError 四叉树的屏幕空间误差阈值。
 * @param {number} pixelRatio 绘制缓冲区所用的设备像素比。
 *        传 1 时保持 Cesium 默认的设备像素 LOD；传 `window.devicePixelRatio`
 *        时可以获得与 CSS 像素口径严格一致的 Mapbox 缩放对齐效果。
 * @returns {number}
 */
function computeMapAlignedLevelZeroGeometricError(
  tilingScheme,
  tileWidth,
  maximumScreenSpaceError,
  pixelRatio,
) {
  const circumference = tilingScheme.ellipsoid.maximumRadius * 2.0 * Math.PI;
  return (
    (maximumScreenSpaceError * circumference) /
    (tileWidth * pixelRatio * tilingScheme.getNumberOfXTilesAtLevel(0))
  );
}

/**
 * 为矢量瓦片四叉树提供可见性、距离和加载入口的 provider。
 *
 * @param {object} [options={}] 构造参数。
 * @param {VectorTileLayerCollection} [options.vectorTileLayers] 当前参与渲染的图层集合。
 * @param {Cesium.TilingScheme} [options.tilingScheme] Cesium 切片方案。
 * @param {number} [options.minimumHeight=0] 瓦片包围体最小高度。
 * @param {number} [options.maximumHeight=0] 瓦片包围体最大高度。
 * @param {number} [options.minimumLevel=0] 最小四叉树层级。
 * @param {number} [options.maximumLevel=20] 最大四叉树层级。
 * @param {number} [options.tileSize=512] 样式缩放和误差对齐使用的瓦片宽度。
 * @param {number} [options.maximumScreenSpaceError=2] 四叉树 LOD 屏幕误差阈值。
 * @param {number} [options.pixelRatio=1] 设备像素比。
 */
export default class VectorTileQuadtreeProvider {
  constructor(options = {}) {
    this._quadtree = undefined;
    this._vectorTileLayers = options.vectorTileLayers;

    this._tilingScheme =
      options.tilingScheme || new Cesium.WebMercatorTilingScheme();
    this._errorEvent = new Cesium.Event();
    this._minimumHeight = options.minimumHeight || 0;
    this._maximumHeight = options.maximumHeight || 0;
    this._minimumLevel = options.minimumLevel || 0;
    this._maximumLevel = options.maximumLevel || 20;
    this._levelZeroMaximumError = computeMapAlignedLevelZeroGeometricError(
      this._tilingScheme,
      options.tileSize ?? 512,
      options.maximumScreenSpaceError ?? 2,
      options.pixelRatio ?? 1,
    );
    this.cartographicLimitRectangle = Cesium.Rectangle.clone(
      Cesium.Rectangle.MAX_VALUE,
    );
  }
}

Object.defineProperties(VectorTileQuadtreeProvider.prototype, {
  quadtree: {
    get: function () {
      return this._quadtree;
    },
    set: function (val) {
      this._quadtree = val;
    },
  },
  ready: {
    get: function () {
      return true;
    },
  },
  tilingScheme: {
    get: function () {
      return this._tilingScheme;
    },
  },
  vectorTileLayers: {
    get: function () {
      return this._vectorTileLayers;
    },
  },
  errorEvent: {
    get: function () {
      return this._errorEvent;
    },
  },
});

VectorTileQuadtreeProvider.prototype.update = function (frameState) {};

VectorTileQuadtreeProvider.prototype.initialize = function (e) {};

VectorTileQuadtreeProvider.prototype.beginUpdate = function (frameState) {};

VectorTileQuadtreeProvider.prototype.endUpdate = function (frameState) {};

VectorTileQuadtreeProvider.prototype.getLevelMaximumGeometricError = function (
  level,
) {
  return this._levelZeroMaximumError / (1 << level);
};

VectorTileQuadtreeProvider.prototype.loadTile = function (frameState, tile) {
  VectorSurfaceTile.processStateMachine(
    tile,
    frameState,
    this._vectorTileLayers,
  );
};

VectorTileQuadtreeProvider.prototype.computeTileVisibility = function (
  tile,
  frameState,
  occluders,
) {
  const distance = this.computeDistanceToTile(tile, frameState);
  tile._distance = distance;

  const undergroundVisible = isUndergroundVisible(this, frameState);

  if (frameState.fog.enabled && !undergroundVisible) {
    if (CesiumMath.fog(distance, frameState.fog.density) >= 1.0) {
      // 瓦片已经完全淹没在雾中，直接视为不可见。
      return Visibility.NONE;
    }
  }

  const surfaceTile = tile.data;
  const tileBoundingRegion = surfaceTile.tileBoundingRegion;

  if (surfaceTile.boundingVolumeSourceTile === undefined) {
    // 当前还无法可靠确定瓦片空间位置，保守起见视为部分可见。
    return Visibility.PARTIAL;
  }

  const cullingVolume = frameState.cullingVolume;
  let boundingVolume = tileBoundingRegion.boundingVolume;

  if (!defined(boundingVolume)) {
    boundingVolume = tileBoundingRegion.boundingSphere;
  }

  // 检查瓦片是否落在经纬度限制区域之外。
  surfaceTile.clippedByBoundaries = false;
  const clippedCartographicLimitRectangle = clipRectangleAntimeridian(
    tile.rectangle,
    this.cartographicLimitRectangle,
  );
  const areaLimitIntersection = Rectangle.simpleIntersection(
    clippedCartographicLimitRectangle,
    tile.rectangle,
    rectangleIntersectionScratch,
  );
  if (!defined(areaLimitIntersection)) {
    return Visibility.NONE;
  }
  if (!Rectangle.equals(areaLimitIntersection, tile.rectangle)) {
    surfaceTile.clippedByBoundaries = true;
  }

  if (frameState.mode !== SceneMode.SCENE3D) {
    boundingVolume = boundingSphereScratch;
    BoundingSphere.fromRectangleWithHeights2D(
      tile.rectangle,
      frameState.mapProjection,
      tileBoundingRegion.minimumHeight,
      tileBoundingRegion.maximumHeight,
      boundingVolume,
    );
    Cartesian3.fromElements(
      boundingVolume.center.z,
      boundingVolume.center.x,
      boundingVolume.center.y,
      boundingVolume.center,
    );

    if (
      frameState.mode === SceneMode.MORPHING &&
      defined(surfaceTile.renderedMesh)
    ) {
      boundingVolume = BoundingSphere.union(
        tileBoundingRegion.boundingSphere,
        boundingVolume,
        boundingVolume,
      );
    }
  }

  if (!defined(boundingVolume)) {
    return Visibility.PARTIAL;
  }

  const clippingPlanes = this._clippingPlanes;
  if (defined(clippingPlanes) && clippingPlanes.enabled) {
    const planeIntersection =
      clippingPlanes.computeIntersectionWithBoundingVolume(boundingVolume);
    tile.isClipped = planeIntersection !== Intersect.INSIDE;
    if (planeIntersection === Intersect.OUTSIDE) {
      return Visibility.NONE;
    }
  }

  const clippingPolygons = this._clippingPolygons;
  if (defined(clippingPolygons) && clippingPolygons.enabled) {
    const polygonIntersection =
      clippingPolygons.computeIntersectionWithBoundingVolume(
        tileBoundingRegion,
      );
    tile.isClipped = polygonIntersection !== Intersect.OUTSIDE;
    // 多边形裁剪的相交关系是按外接矩形估算的，因此这里无法提前断言瓦片是否被完全裁掉。
  }

  let visibility;
  const intersection = cullingVolume.computeVisibility(boundingVolume);

  if (intersection === Intersect.OUTSIDE) {
    visibility = Visibility.NONE;
  } else if (intersection === Intersect.INTERSECTING) {
    visibility = Visibility.PARTIAL;
  } else if (intersection === Intersect.INSIDE) {
    visibility = Visibility.FULL;
  }

  if (visibility === Visibility.NONE) {
    return visibility;
  }

  const ortho3D =
    frameState.mode === SceneMode.SCENE3D &&
    frameState.camera.frustum instanceof OrthographicFrustum;
  if (
    frameState.mode === SceneMode.SCENE3D &&
    !ortho3D &&
    defined(occluders) &&
    !undergroundVisible
  ) {
    const occludeePointInScaledSpace = surfaceTile.occludeePointInScaledSpace;
    if (!defined(occludeePointInScaledSpace)) {
      return visibility;
    }

    if (
      occluders.ellipsoid.isScaledSpacePointVisiblePossiblyUnderEllipsoid(
        occludeePointInScaledSpace,
        tileBoundingRegion.minimumHeight,
      )
    ) {
      return visibility;
    }

    return Visibility.NONE;
  }

  return visibility;
};

VectorTileQuadtreeProvider.prototype.canRefine = function (tile) {
  let maximumLayerLevel = -1;
  for (let i = 0; i < this._vectorTileLayers.length; ++i) {
    const layer = this._vectorTileLayers.get(i);
    if (layer.show) {
      maximumLayerLevel = Math.max(
        maximumLayerLevel,
        layer.vectorTileProvider.maximumLevel,
      );
    }
  }

  return tile.level < maximumLayerLevel;
};

VectorTileQuadtreeProvider.prototype.computeTileLoadPriority = function (tile) {
  const distance = Number.isFinite(tile._distance)
    ? tile._distance
    : Number.MAX_SAFE_INTEGER;
  return distance + tile.level * 0.001;
};

VectorTileQuadtreeProvider.prototype.showTileThisFrame = function (
  tile,
  frameState,
) {
  // 预留与外部几何 primitive 集成的更新钩子，当前矢量瓦片实现暂未使用。
};

VectorTileQuadtreeProvider.prototype.computeDistanceToTile = function (
  tile,
  frameState,
) {
  // 距离值应满足以下任一条件：
  // 1. 等于到紧包围体的真实距离；
  // 2. 或者至少不小于这个真实距离。
  //
  // 当我们不知道当前瓦片自身的最小/最大高度，但知道某个祖先瓦片的高度范围时，
  // 可以在水平方向构造紧包围体，却无法在垂直方向做到同样精确。祖先高度范围
  // 往往会形成一个远大于实际需要的体积，使系统误以为当前瓦片离相机更近，
  // 从而选出过细的瓦片层级。加载过细瓦片代价很高，因此这里宁可保守估算得更远一些。
  // 虽然我们不知道子瓦片具体落在父瓦片高度范围中的什么位置，但至少知道它不可能
  // 比离相机更远的那一侧祖先高度面还要更近。基于这个保守距离来计算，最多会让
  // 选出的瓦片细节略显不足，但这比过细加载带来的性能成本要可控得多。

  updateTileBoundingRegion(tile, this, frameState, {
    minimumHeight: this._minimumHeight,
    maximumHeight: this._maximumHeight,
  });

  const surfaceTile = tile.data;
  // 这里保留了“缺失包围体来源时直接返回超远距离”的思路，
  // 但当前实现会在更早阶段通过 PARTIAL 可见性分支做保守处理。

  const tileBoundingRegion = surfaceTile.tileBoundingRegion;
  const min = tileBoundingRegion.minimumHeight;
  const max = tileBoundingRegion.maximumHeight;

  if (surfaceTile.boundingVolumeSourceTile !== tile) {
    const cameraHeight = frameState.camera.positionCartographic.height;
    const distanceToMin = Math.abs(cameraHeight - min);
    const distanceToMax = Math.abs(cameraHeight - max);
    if (distanceToMin > distanceToMax) {
      tileBoundingRegion.minimumHeight = min;
      tileBoundingRegion.maximumHeight = min;
    } else {
      tileBoundingRegion.minimumHeight = max;
      tileBoundingRegion.maximumHeight = max;
    }
  }

  const result = tileBoundingRegion.distanceToCamera(frameState);

  tileBoundingRegion.minimumHeight = min;
  tileBoundingRegion.maximumHeight = max;

  return result;
};

VectorTileQuadtreeProvider.prototype.isDestroyed = function () {
  return false;
};

VectorTileQuadtreeProvider.prototype.destroy = function () {
  return Cesium.destroyObject(this);
};

VectorTileQuadtreeProvider.prototype.updateForPick = function (frameState) {};

VectorTileQuadtreeProvider.prototype.cancelReprojections = function () {};

VectorTileQuadtreeProvider.prototype.isUndergroundVisible =
  isUndergroundVisible;
