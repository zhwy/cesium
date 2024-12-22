import * as Cesium from "../../../../../Build/CesiumUnminified/index.js";
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

// cartographicLimitRectangle may span the IDL, but tiles never will.
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
  }
}

export default class VectorTileQuadtreeProvider {
  constructor(options = {}) {
    this._quadtree = undefined;
    this._vectorTileLayers = options.vectorTileLayers;

    this._tilingScheme =
      options.tilingScheme || new Cesium.WebMercatorTilingScheme();
    this._errorEvent = new Cesium.Event();
    this._maxTileRefineLevel = 16;
    this._minimumHeight = options.minimumHeight || 0;
    this._maximumHeight = options.maximumHeight || 0;
    this._minimumLevel = options.minimumLevel || 0;
    this._maximumLevel = options.maximumLevel || 20;
    this._levelZeroMaximumError =
      Cesium.QuadtreeTileProvider.computeDefaultLevelZeroMaximumGeometricError(
        this._tilingScheme,
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
      // Tile is completely in fog so return that it is not visible.
      return Visibility.NONE;
    }
  }

  const surfaceTile = tile.data;
  const tileBoundingRegion = surfaceTile.tileBoundingRegion;

  if (surfaceTile.boundingVolumeSourceTile === undefined) {
    // We have no idea where this tile is, so let's just call it partially visible.
    return Visibility.PARTIAL;
  }

  const cullingVolume = frameState.cullingVolume;
  let boundingVolume = tileBoundingRegion.boundingVolume;

  if (!defined(boundingVolume)) {
    boundingVolume = tileBoundingRegion.boundingSphere;
  }

  // Check if the tile is outside the limit area in cartographic space
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
    // Polygon clipping intersections are determined by outer rectangles, therefore we cannot
    // preemptively determine if a tile is completely clipped or not here.
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
  return tile.level <= this._maxTileRefineLevel + 1;
};

VectorTileQuadtreeProvider.prototype.showTileThisFrame = function (
  tile,
  frameState,
) {
  // this._availability && (this._state = this.isAvailable(t.time)),
  // e.data.geometryPrimitive && this._state && this._client && "function" === typeof e.data.geometryPrimitive.update && (e.data.geometryPrimitive instanceof Cesium3DTileset || e.data.geometryPrimitive.update(t, i, a))
  // if (this._availability) {
  //   this._state = this.isAvailable(frameState.time);
  // }
  // if (this._state && this._client && tile.data && tile.data.geometryPrimitive) {
  //   tile.data.geometryPrimitive.update(t, i, a)
  // }
};

VectorTileQuadtreeProvider.prototype.computeDistanceToTile = function (
  tile,
  frameState,
) {
  // The distance should be:
  // 1. the actual distance to the tight-fitting bounding volume, or
  // 2. a distance that is equal to or greater than the actual distance to the tight-fitting bounding volume.
  //
  // When we don't know the min/max heights for a tile, but we do know the min/max of an ancestor tile, we can
  // build a tight-fitting bounding volume horizontally, but not vertically. The min/max heights from the
  // ancestor will likely form a volume that is much bigger than it needs to be. This means that the volume may
  // be deemed to be much closer to the camera than it really is, causing us to select tiles that are too detailed.
  // Loading too-detailed tiles is super expensive, so we don't want to do that. We don't know where the child
  // tile really lies within the parent range of heights, but we _do_ know the child tile can't be any closer than
  // the ancestor height surface (min or max) that is _farthest away_ from the camera. So if we compute distance
  // based on that conservative metric, we may end up loading tiles that are not detailed enough, but that's much
  // better (faster) than loading tiles that are too detailed.

  updateTileBoundingRegion(tile, this, frameState, {
    minimumHeight: this._minimumHeight,
    maximumHeight: this._maximumHeight,
  });

  const surfaceTile = tile.data;
  // const boundingVolumeSourceTile = surfaceTile.boundingVolumeSourceTile;
  // if (boundingVolumeSourceTile === undefined) {
  //   // Can't find any min/max heights anywhere? Ok, let's just say the
  //   // tile is really far away so we'll load and render it rather than
  //   // refining.
  //   return 9999999999.0;
  // }

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
