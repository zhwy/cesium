import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTile from "./VectorTile.js";
import TileVectorTile from "./TileVectorTile.js";
import VectorTileDecoder from "./VectorTileDecoder.js";
import VectorTileCache from "./VectorTileCache.js";
import {
  createVectorTilePrimitiveBucket,
  storeVectorTileBucket,
} from "./VectorTileBucketFactory.js";
import { createVectorTileIconResolver } from "./VectorTileSymbolBucket.js";
import VectorTileTaskScheduler, {
  VectorTileTaskCancelledError,
} from "./VectorTileTaskScheduler.js";
import {
  createLegacyLayerOptionsFromStyleDocument,
  createStyleDocumentFromLegacyOptions,
  normalizeStyleDocument,
} from "./VectorTileStyleUtils.js";
import { filterPackedLayerByStyleRules } from "./VectorTileGeometryPlacement.js";
import { VectorTileCoverageState } from "./VectorTileLodSelection.js";
import { TileType } from "./VectorTileProvider.js";
import { computeCameraVectorTileStyleZoom } from "./VectorTileStyleZoom.js";
import { isWorkerSupportedVectorStyleFilter } from "./VectorTileStyleExpression.js";

const defaultOptions = {
  tilingScheme: "WebMercatorTilingScheme",
  dataTypeField: "type",
  dataIdField: "id",
  minimumTerrainLevel: 0,
  maximumTerrainLevel: 18,
  tileType: TileType.XYZ,
  format: "application/vnd.mapbox-vector-tile",
  url: "",
  allowPicking: false,
  asynchronous: true,
  shadows: Cesium.ShadowMode.DISABLED,
  polygonHeight: 1.0,
  cacheBytes: 64 * 1024 * 1024,
  clipToTile: true,
  renderBackend: "instances",
  packedMinimumInstances: 200,
  tileSize: 512,
};

export default class VectorTileLayer {
  get show() {
    return this._show;
  }

  set show(value) {
    if (this._show === value) {
      return;
    }
    this._show = value;
    this.showChangedEvent.raiseEvent(this, value);
  }

  get vectorTileProvider() {
    return this._vectorTileProvider;
  }

  get readyEvent() {
    return this._readyEvent;
  }

  get errorEvent() {
    return this._errorEvent;
  }

  get ready() {
    return Cesium.defined(this._vectorTileProvider);
  }

  get renderBackend() {
    return this._option.renderBackend;
  }

  constructor(vectorTileProvider, options) {
    this._show = true;
    this._destroyed = false;
    this._option = { ...defaultOptions, ...options };
    this._styleLayer = (this._option.layer || "").replace(/(.*:)/g, "");
    this._styles = options.styles || {};
    this._scene = options.scene;
    this._styleDocument = options.styleDocument
      ? normalizeStyleDocument(options.styleDocument)
      : options.styles
        ? createStyleDocumentFromLegacyOptions(options)
        : undefined;
    this._vectorTileProvider = vectorTileProvider;
    this._diagnostics = options.diagnostics;
    this._decodeScheduler =
      options.decodeScheduler ?? new VectorTileTaskScheduler(2);
    this._buildScheduler =
      options.buildScheduler ?? new VectorTileTaskScheduler(1);
    this._vectorTileCache = new VectorTileCache({
      maximumBytes: this._option.cacheBytes,
      diagnostics: this._diagnostics,
    });
    this._iconImages = {
      ...(options.iconResources ?? {}),
      ...(options.iconImages ?? {}),
    };
    this._iconResolver = createVectorTileIconResolver(this._iconImages);
    /**
     * VectorTiles with an in-flight network request, checked each frame by
     * {@link VectorTileLayer#cancelStaleRequests}.
     * @type {Set<VectorTile>}
     */
    this._inFlightTiles = new Set();

    this._readyEvent = new Cesium.Event();
    this._errorEvent = new Cesium.Event();
    this.showChangedEvent = new Cesium.Event();
    this.changedEvent = new Cesium.Event();
  }

  getVectorTileFromCache(x, y, level, rectangle) {
    const cacheKey = getVectorTileCacheKey(x, y, level);
    let vectorTile = this._vectorTileCache.get(cacheKey);

    if (!Cesium.defined(vectorTile)) {
      vectorTile = new VectorTile(this, x, y, level, rectangle);
      this._vectorTileCache.set(cacheKey, vectorTile);
    } else {
      this._vectorTileCache.recordHit(vectorTile);
    }

    vectorTile.addReference();
    return vectorTile;
  }

  _requestTile(vectorTile) {
    const vectorTileProvider = this._vectorTileProvider;
    if (!vectorTileProvider.isTileAvailable(vectorTile.level)) {
      vectorTile.terminalReason = "UNAVAILABLE";
      vectorTile.coverageState = VectorTileCoverageState.UNAVAILABLE;
      vectorTile.state = Cesium.ImageryState.INVALID;
      this._diagnostics?.increment("unavailableTiles");
      return;
    }

    const startTime = this._diagnostics?.startTimer();
    const requestTask = vectorTileProvider.requestTile(vectorTile);
    if (requestTask) {
      vectorTile.networkTask = requestTask;
      vectorTile.state = Cesium.ImageryState.TRANSITIONING;
      this._inFlightTiles.add(vectorTile);
      requestTask.promise
        .then((arrayBuffer) => {
          vectorTile.networkTask = undefined;
          this._inFlightTiles.delete(vectorTile);
          this._diagnostics?.recordDuration("request", startTime);
          if (vectorTile.released) {
            return;
          }
          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            vectorTile.terminalReason = "EMPTY";
            vectorTile.coverageState = VectorTileCoverageState.READY_EMPTY;
            vectorTile.state = Cesium.ImageryState.READY;
            vectorTile.cacheable = true;
            this._diagnostics?.increment("readyEmptyTiles");
            return;
          }

          vectorTile.arrayBuffer = arrayBuffer;
          vectorTile.arrayBufferBytes = arrayBuffer.byteLength;
          this._vectorTileCache.updateSize(vectorTile, arrayBuffer.byteLength);
          this._diagnostics?.increment(
            "downloadedBytes",
            arrayBuffer.byteLength,
          );
          this._diagnostics?.addGauge(
            "residentArrayBufferBytes",
            arrayBuffer.byteLength,
          );
          vectorTile.state = Cesium.ImageryState.RECEIVED;
        })
        .catch((e) => {
          vectorTile.networkTask = undefined;
          this._inFlightTiles.delete(vectorTile);
          this._diagnostics?.recordDuration("request", startTime);
          if (vectorTile.released) {
            return;
          }
          if (e instanceof VectorTileTaskCancelledError) {
            // Reset instead of terminal INVALID so the tile can be
            // re-requested if it scrolls back into view.
            vectorTile.terminalReason = undefined;
            vectorTile.coverageState = VectorTileCoverageState.PENDING;
            vectorTile.state = Cesium.ImageryState.UNLOADED;
            this._diagnostics?.increment("cancelledTiles");
            return;
          }
          vectorTile.terminalReason = "FAILED";
          vectorTile.coverageState = VectorTileCoverageState.FAILED;
          vectorTile.state = Cesium.ImageryState.FAILED;
          this._diagnostics?.increment("failedTiles");
          this._errorEvent.raiseEvent(e, vectorTile);
        });
    }
  }

  /**
   * Cancels in-flight network requests for tiles the quadtree no longer
   * needs. A tile is stale when its renewal stamp (set every frame by
   * VectorTile.processStateMachine while the quadtree still wants it) is
   * older than `staleFrames` frames — mirroring Cesium RequestScheduler's
   * cancel-unless-renewed model. Cancelled tiles reset to UNLOADED and can
   * be re-requested when they come back into view.
   *
   * @param {number} currentFrame  frameState.frameNumber.
   * @param {number} [staleFrames=10]  Frames without renewal before cancelling.
   */
  cancelStaleRequests(currentFrame, staleFrames = 10) {
    for (const vectorTile of this._inFlightTiles) {
      if (currentFrame - vectorTile.lastNeededFrame > staleFrames) {
        vectorTile.networkTask?.cancel();
      }
    }
  }

  _createTilePrimitives(vectorTile) {
    if (vectorTile.arrayBuffer) {
      const decodeStartTime = this._diagnostics?.startTimer();
      const arrayBuffer = vectorTile.arrayBuffer;
      const arrayBufferBytes = vectorTile.arrayBufferBytes;
      vectorTile.arrayBuffer = undefined;
      vectorTile.arrayBufferBytes = 0;
      this._diagnostics?.addGauge(
        "residentArrayBufferBytes",
        -arrayBufferBytes,
      );

      const styleRules = getStyleRulesForDecode(this._styleDocument);
      const hasUnsupportedWorkerFilter = styleRules.some(
        (styleRule) => !isWorkerSupportedVectorStyleFilter(styleRule.filter),
      );
      const workerStyleRules = hasUnsupportedWorkerFilter
        ? undefined
        : styleRules;
      if (hasUnsupportedWorkerFilter) {
        this._diagnostics?.increment("mainThreadStyleFilterFallbacks");
      }

      const styleZoom = vectorTile.level;

      const decodeTask = this._decodeScheduler.schedule(
        () =>
          VectorTileDecoder.instance().decode(arrayBuffer, {
            tile: {
              x: vectorTile.x,
              y: vectorTile.y,
              level: vectorTile.level,
              sourceLevel: vectorTile.level,
              styleZoom: vectorTile.level,
            },
            styledLayerNames: getStyledLayerNames(
              this._styleDocument,
              this._styles,
            ),
            styleRules: workerStyleRules,
            includeProperties:
              this._option.allowPicking ||
              hasUnsupportedWorkerFilter ||
              styleRules.length > 0,
            clipToTile: this._option.clipToTile,
          }),
        vectorTile.priority,
      );
      vectorTile.decodeTask = decodeTask;
      decodeTask.promise
        .then((decodedTile) => {
          vectorTile.decodeTask = undefined;
          this._diagnostics?.recordDuration(
            "workerDecodeRoundTrip",
            decodeStartTime,
          );
          if (vectorTile.released) {
            return;
          }

          if (hasUnsupportedWorkerFilter) {
            decodedTile = applyMainThreadStyleFilters(
              decodedTile,
              styleRules,
              styleZoom,
              this._diagnostics,
            );
          }

          const counts = countDecodedTile(decodedTile);
          this._vectorTileCache.updateSize(
            vectorTile,
            getDecodedTileByteLength(decodedTile),
          );
          this._diagnostics?.increment("decodedFeatures", counts.features);
          this._diagnostics?.increment("decodedPositions", counts.positions);
          this._diagnostics?.increment(
            "clippedFeatures",
            counts.clippedFeatures,
          );
          this._diagnostics?.increment(
            "discardedFeatures",
            counts.discardedFeatures,
          );
          this._diagnostics?.increment(
            "styleFilteredFeatures",
            counts.styleFilteredFeatures,
          );
          this._diagnostics?.increment(
            "outOfBoundsPositions",
            counts.outOfBoundsPositions,
          );

          const buildTask = this._buildScheduler.schedule(
            () => this._buildTilePrimitives(vectorTile, decodedTile, styleZoom),
            vectorTile.priority,
          );
          vectorTile.buildTask = buildTask;
          return buildTask.promise;
        })
        .then((wasBuilt) => {
          vectorTile.buildTask = undefined;
          if (!wasBuilt || vectorTile.released) {
            return;
          }
          const hasPrimitives = Object.keys(vectorTile.primitives).length > 0;
          vectorTile.state = Cesium.ImageryState.READY;
          vectorTile.cacheable = true;
          if (hasPrimitives) {
            vectorTile.coverageState = VectorTileCoverageState.READY;
            this._diagnostics?.increment("readyTiles");
          } else {
            vectorTile.coverageState = VectorTileCoverageState.READY_EMPTY;
            this._diagnostics?.increment("readyEmptyTiles");
          }
        })
        .catch((error) => {
          vectorTile.decodeTask = undefined;
          vectorTile.buildTask = undefined;
          this._diagnostics?.recordDuration(
            "workerDecodeRoundTrip",
            decodeStartTime,
          );
          if (vectorTile.released) {
            return;
          }
          if (error instanceof VectorTileTaskCancelledError) {
            vectorTile.terminalReason = "CANCELLED";
            vectorTile.coverageState = VectorTileCoverageState.CANCELLED;
            vectorTile.state = Cesium.ImageryState.INVALID;
            this._diagnostics?.increment("cancelledTiles");
            return;
          }
          vectorTile.terminalReason = "DECODE_FAILED";
          vectorTile.coverageState = VectorTileCoverageState.FAILED;
          vectorTile.state = Cesium.ImageryState.FAILED;
          this._diagnostics?.increment("failedTiles");
          this._errorEvent.raiseEvent(error, vectorTile);
        });
    }
  }

  _buildTilePrimitives(vectorTile, decodedTile, styleZoom) {
    if (vectorTile.released) {
      return false;
    }
    const buildStartTime = this._diagnostics?.startTimer();
    vectorTile.primitives = {};
    vectorTile.primitiveStyleRules = {};
    const styleRules = getStyleRulesForBuild(this._styleDocument);
    if (styleRules.length > 0) {
      styleRules.forEach((styleRule) => {
        const packedLayer = decodedTile.layers[styleRule.sourceLayer];
        if (!packedLayer) {
          return;
        }
        const bucket = createVectorTilePrimitiveBucket(
          packedLayer,
          styleRule,
          styleZoom,
          {
            scene: this._scene,
            iconResolver: this._iconResolver,
            allowPicking: this._option.allowPicking,
            diagnostics: this._diagnostics,
            ignoreZoomRange: true,
            renderBackend: this._option.renderBackend,
            packedMinimumInstances: this._option.packedMinimumInstances,
            shadows: this._option.shadows,
            asynchronous: this._option.asynchronous,
            clipToTile: this._option.clipToTile,
            vectorTile,
          },
        );
        storeVectorTileBucket(vectorTile, bucket, styleRule);
      });
    }
    this._diagnostics?.recordDuration("primitiveBuild", buildStartTime);
    return true;
  }

  _bindQuadtreeTile(tile, index) {
    const surfacecTile = tile.data;
    const provider = this._vectorTileProvider;
    if (tile.level < provider.minimumLevel) {
      return false;
    }

    const vectorTileLevel = Math.min(tile.level, provider.maximumLevel);
    const levelDifference = tile.level - vectorTileLevel;
    const levelScale = 2 ** levelDifference;
    const vectorTileX = Math.floor(tile.x / levelScale);
    const vectorTileY = Math.floor(tile.y / levelScale);
    if (!Cesium.defined(index)) {
      index = surfacecTile.tileVectorTiles.length;
    }
    const vectorTile = this.getVectorTileFromCache(
      vectorTileX,
      vectorTileY,
      vectorTileLevel,
    );
    surfacecTile.tileVectorTiles.splice(
      index,
      0,
      new TileVectorTile(vectorTile),
    );
    return true;
  }

  getFrameStyleZoom(frameState) {
    return computeCameraVectorTileStyleZoom(frameState, {
      ...this._option,
      scene: this._scene,
    });
  }

  setStyles(styles) {
    this._styles = styles || {};
    this._option.styles = this._styles;
    this._styleDocument = createStyleDocumentFromLegacyOptions(this._option);
    this.clearCache();
  }

  setStyle(styleDocument) {
    const normalizedStyle = normalizeStyleDocument(styleDocument);
    const legacyLayerOptions =
      createLegacyLayerOptionsFromStyleDocument(normalizedStyle);
    const sourceId = this._option.sourceId ?? this._option.styleSourceId;
    const legacyOptions =
      legacyLayerOptions.find((options) => options.sourceId === sourceId) ??
      legacyLayerOptions[0];

    this._styleDocument = normalizedStyle;
    this._styles = legacyOptions?.styles || {};
    this._option.styles = this._styles;
    this.clearCache();
  }

  getStyle() {
    if (!this._styleDocument) {
      return undefined;
    }
    return normalizeStyleDocument(this._styleDocument);
  }

  registerIconImage(name, image) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Cesium.DeveloperError("name must be a non-empty string.");
    }
    this._iconImages[name] = image;
    this._iconResolver = createVectorTileIconResolver(this._iconImages);
    this.clearCache();
  }

  getIconImage(name) {
    return this._iconImages[name];
  }

  setScene(scene) {
    if (this._scene === scene) {
      return;
    }
    this._scene = scene;
    this.clearCache();
  }

  setRenderBackend(renderBackend) {
    if (renderBackend !== "instances" && renderBackend !== "packed") {
      throw new Cesium.DeveloperError(
        'renderBackend must be either "instances" or "packed".',
      );
    }
    if (this._option.renderBackend === renderBackend) {
      return;
    }
    this._option.renderBackend = renderBackend;
    this.clearCache();
  }

  clearCache(raiseChangedEvent = true) {
    this._vectorTileCache.clear();
    if (raiseChangedEvent) {
      this.changedEvent.raiseEvent(this);
    }
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._vectorTileCache.clear();
  }
}

function getVectorTileCacheKey(x, y, level) {
  return JSON.stringify([x, y, level]);
}

function getStyleRulesForDecode(styleDocument) {
  if (!styleDocument?.layers) {
    return [];
  }
  return styleDocument.layers
    .filter((layer) => layer.visibility !== false)
    .map((layer) => ({
      id: layer.id,
      type: layer.type,
      sourceLayer: layer.sourceLayer,
      filter: layer.filter,
      layout:
        layer.type === "symbol"
          ? { "symbol-placement": layer.layout?.["symbol-placement"] }
          : undefined,
      visibility: layer.visibility,
    }));
}

function getStyleRulesForBuild(styleDocument) {
  if (!styleDocument?.layers) {
    return [];
  }
  return styleDocument.layers.filter(
    (layer) =>
      layer.visibility !== false &&
      (layer.type === "fill" ||
        layer.type === "line" ||
        layer.type === "symbol"),
  );
}

function getStyledLayerNames(styleDocument, styles) {
  if (styleDocument?.layers?.length > 0) {
    return [
      ...new Set(
        styleDocument.layers
          .filter((layer) => layer.visibility !== false)
          .map((layer) => layer.sourceLayer),
      ),
    ];
  }
  return Object.keys(styles);
}

function applyMainThreadStyleFilters(
  decodedTile,
  styleRules,
  zoom,
  diagnostics,
) {
  const styleRulesBySourceLayer = groupStyleRulesBySourceLayer(styleRules);
  const layers = {};
  Object.keys(decodedTile.layers).forEach((sourceLayer) => {
    const packedLayer = decodedTile.layers[sourceLayer];
    const layerStyleRules = styleRulesBySourceLayer.get(sourceLayer);
    layers[sourceLayer] = layerStyleRules
      ? filterPackedLayerByStyleRules(
          packedLayer,
          layerStyleRules,
          zoom,
          diagnostics,
        )
      : packedLayer;
  });
  return { ...decodedTile, layers };
}

function groupStyleRulesBySourceLayer(styleRules) {
  const result = new Map();
  styleRules.forEach((styleRule) => {
    let rules = result.get(styleRule.sourceLayer);
    if (!rules) {
      rules = [];
      result.set(styleRule.sourceLayer, rules);
    }
    rules.push(styleRule);
  });
  return result;
}

function countDecodedTile(decodedTile) {
  let features = 0;
  let positions = 0;
  let styleFilteredFeatures = 0;
  let clippedFeatures = 0;
  let discardedFeatures = 0;
  let outOfBoundsPositions = 0;
  Object.values(decodedTile.layers).forEach((layer) => {
    features += layer.featureCount;
    positions += layer.positionCount;
    styleFilteredFeatures += layer.styleFilteredFeatureCount ?? 0;
    clippedFeatures += layer.clippedFeatureCount;
    discardedFeatures += layer.discardedFeatureCount;
    outOfBoundsPositions += layer.outOfBoundsPositionCount;
  });
  return {
    features,
    positions,
    styleFilteredFeatures,
    clippedFeatures,
    discardedFeatures,
    outOfBoundsPositions,
  };
}

function getDecodedTileByteLength(decodedTile) {
  let byteLength = 0;
  Object.values(decodedTile.layers).forEach((layer) => {
    byteLength += layer.points.positions.byteLength;
    byteLength += layer.lines.positions.byteLength;
    byteLength += layer.lines.offsets.byteLength;
    byteLength += layer.polygons.positions.byteLength;
    byteLength += layer.polygons.ringOffsets.byteLength;
    byteLength += layer.polygons.polygonOffsets.byteLength;
  });
  return byteLength;
}
