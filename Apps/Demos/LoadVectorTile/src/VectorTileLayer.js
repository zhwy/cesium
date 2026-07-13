import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTile from "./VectorTile.js";
import TileVectorTile from "./TileVectorTile.js";
import VectorTileDecoder from "./VectorTileDecoder.js";
import VectorTileCache from "./VectorTileCache.js";
import {
  createVectorTilePrimitiveBucket,
  storeVectorTileBucket,
} from "./VectorTileBucketFactory.js";
import SharedPointCollections from "./SharedPointCollections.js";
import { createVectorTileIconResolver } from "./VectorTileSymbolBucket.js";
import VectorTileTaskScheduler, {
  VectorTileTaskCancelledError,
} from "./VectorTileTaskScheduler.js";
import { normalizeStyleDocument } from "./VectorTileStyleUtils.js";
import { filterPackedLayerByStyleRules } from "./VectorTileGeometryPlacement.js";
import { VectorTileCoverageState } from "./VectorTileLodSelection.js";
import { TileType } from "./VectorTileProvider.js";
import { computeCameraVectorTileStyleZoom } from "./VectorTileStyleZoom.js";
import { isWorkerSupportedVectorStyleFilter } from "./VectorTileStyleExpression.js";

const DEFAULT_OPTIONS = {
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

/**
 * 运行时矢量图层对象，负责单个 provider 的请求、解码、构建、缓存与样式版本切换。
 *
 * @param {object} vectorTileProvider 底层矢量瓦片 provider。
 * @param {object} options 图层构造参数。
 * @param {string} [options.tilingScheme="WebMercatorTilingScheme"] 切片方案名称。
 * @param {string} [options.dataTypeField="type"] 要素类型字段名。
 * @param {string} [options.dataIdField="id"] 要素标识字段名。
 * @param {number} [options.minimumTerrainLevel=0] 地形层级下限。
 * @param {number} [options.maximumTerrainLevel=18] 地形层级上限。
 * @param {string} [options.tileType="XYZ"] 瓦片服务类型。
 * @param {string} [options.format="application/vnd.mapbox-vector-tile"] 数据格式。
 * @param {string} [options.url=""] 服务地址模板。
 * @param {boolean} [options.allowPicking=false] 是否启用拾取。
 * @param {boolean} [options.asynchronous=true] 是否异步构建 Cesium 图元。
 * @param {Cesium.ShadowMode} [options.shadows=Cesium.ShadowMode.DISABLED] 阴影模式。
 * @param {number} [options.polygonHeight=1.0] 面要素默认高度。
 * @param {number} [options.cacheBytes=64*1024*1024] 图层缓存字节数上限。
 * @param {boolean} [options.clipToTile=true] 是否按瓦片边界裁剪。
 * @param {string} [options.renderBackend="instances"] 线渲染后端类型。
 * @param {number} [options.packedMinimumInstances=200] packed 线渲染的最小实例数。
 * @param {number} [options.tileSize=512] 样式缩放与误差计算使用的瓦片宽度。
 * @param {Cesium.Scene} [options.scene] Cesium 场景。
 * @param {object} [options.styleDocument] 当前图层样式文档。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器。
 * @param {VectorTileTaskScheduler} [options.decodeScheduler] 解码任务调度器。
 * @param {VectorTileTaskScheduler} [options.buildScheduler] 构建任务调度器。
 * @param {object} [options.iconResources] 图标资源注册表。
 * @param {object} [options.iconImages] 图标资源注册表的别名配置。
 */
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

  get sharedPointCollections() {
    return this._sharedPointCollections;
  }

  get contentRevision() {
    return this._contentRevision;
  }

  constructor(vectorTileProvider, options) {
    this._show = true;
    this._destroyed = false;
    this._option = { ...DEFAULT_OPTIONS, ...options };
    this._styleLayer = (this._option.layer || "").replace(/(.*:)/g, "");
    this._scene = options.scene;
    this._styleDocument = options.styleDocument
      ? normalizeStyleDocument(options.styleDocument)
      : undefined;
    this._contentRevision = 0;
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
    this._sharedPointCollections = new SharedPointCollections({
      scene: this._scene,
      diagnostics: this._diagnostics,
    });
    this._iconImages = {
      ...(options.iconResources ?? {}),
      ...(options.iconImages ?? {}),
    };
    this._iconResolver = createVectorTileIconResolver(this._iconImages);
    /**
     * 当前仍处于网络请求中的 `VectorTile` 集合，
     * 每帧由 {@link VectorTileLayer#cancelStaleRequests} 检查是否过期。
     * @type {Set<VectorTile>}
     */
    this._inFlightTiles = new Set();

    this._readyEvent = new Cesium.Event();
    this._errorEvent = new Cesium.Event();
    this.showChangedEvent = new Cesium.Event();
    this.changedEvent = new Cesium.Event();
  }

  getVectorTileFromCache(x, y, level, rectangle) {
    const contentRevision = this._contentRevision;
    const cacheKey = getVectorTileCacheKey(contentRevision, x, y, level);
    let vectorTile = this._vectorTileCache.get(cacheKey);

    if (!Cesium.defined(vectorTile)) {
      vectorTile = new VectorTile(
        this,
        x,
        y,
        level,
        rectangle,
        contentRevision,
        snapshotStyleDocument(this._styleDocument),
      );
      this._vectorTileCache.set(cacheKey, vectorTile);
    } else {
      this._vectorTileCache.recordHit(vectorTile);
    }

    vectorTile.addReference();
    return vectorTile;
  }

  isCurrentContentRevision(vectorTile) {
    return vectorTile?.contentRevision === this._contentRevision;
  }

  getCacheStatistics() {
    return this._vectorTileCache.getStatistics(this._contentRevision);
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
          if (
            vectorTile.released ||
            !this.isCurrentContentRevision(vectorTile)
          ) {
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
          if (
            vectorTile.released ||
            !this.isCurrentContentRevision(vectorTile)
          ) {
            return;
          }
          if (e instanceof VectorTileTaskCancelledError) {
            // 重置为未加载，而不是终态 INVALID，这样瓦片重新进入视野时仍可再次请求。
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
   * 取消四叉树已经不再需要的在途网络请求。
   * 当某个瓦片的续租标记长期没有被 `VectorTile.processStateMachine`
   * 刷新，并且早于 `staleFrames` 帧之前时，就视为过期。这个行为与
   * Cesium `RequestScheduler` 的“续租则保留，否则取消”模型保持一致。
   * 被取消的瓦片会回到 `UNLOADED`，在重新进入视野时可以再次发起请求。
   *
   * @param {number} currentFrame 当前 `frameState.frameNumber`。
   * @param {number} [staleFrames=10] 允许连续多少帧未续租后再执行取消。
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

      const styleDocument = vectorTile.styleDocument;
      const styleRules = getStyleRulesForDecode(styleDocument);
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
            styledLayerNames: getStyledLayerNames(styleDocument),
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
          if (
            vectorTile.released ||
            !this.isCurrentContentRevision(vectorTile)
          ) {
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
          if (
            !wasBuilt ||
            vectorTile.released ||
            !this.isCurrentContentRevision(vectorTile)
          ) {
            return;
          }
          const hasPrimitives =
            Object.keys(vectorTile.primitives).length > 0 ||
            Object.keys(vectorTile.pointBuckets).length > 0;
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
          if (
            vectorTile.released ||
            !this.isCurrentContentRevision(vectorTile)
          ) {
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
    if (vectorTile.released || !this.isCurrentContentRevision(vectorTile)) {
      return false;
    }
    const buildStartTime = this._diagnostics?.startTimer();
    vectorTile.primitives = {};
    vectorTile.primitiveStyleRules = {};
    vectorTile.pointBuckets = {};
    const styleRules = getStyleRulesForBuild(vectorTile.styleDocument);
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

  setStyle(styleDocument) {
    const normalizedStyle = normalizeStyleDocument(styleDocument);
    this._styleDocument = normalizedStyle;
    this._option.styleDocument = normalizedStyle;
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
    this._sharedPointCollections.setScene(scene);
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
    this._contentRevision++;
    this._diagnostics?.setGauge(
      "currentContentRevision",
      this._contentRevision,
    );
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
    this._sharedPointCollections.destroy();
  }
}

function getVectorTileCacheKey(contentRevision, x, y, level) {
  return JSON.stringify([contentRevision, x, y, level]);
}

function snapshotStyleDocument(styleDocument) {
  return styleDocument ? normalizeStyleDocument(styleDocument) : undefined;
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
        layer.type === "circle" ||
        layer.type === "line" ||
        layer.type === "symbol"),
  );
}

function getStyledLayerNames(styleDocument) {
  if (styleDocument?.layers?.length > 0) {
    return [
      ...new Set(
        styleDocument.layers
          .filter((layer) => layer.visibility !== false)
          .map((layer) => layer.sourceLayer),
      ),
    ];
  }
  return [];
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
