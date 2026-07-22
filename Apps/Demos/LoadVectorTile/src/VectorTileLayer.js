import defined from "../../../../packages/engine/Source/Core/defined.js";
import DeveloperError from "../../../../packages/engine/Source/Core/DeveloperError.js";
import Event from "../../../../packages/engine/Source/Core/Event.js";
import ImageryState from "../../../../packages/engine/Source/Scene/ImageryState.js";
import ShadowMode from "../../../../packages/engine/Source/Scene/ShadowMode.js";
import VectorTile from "./VectorTile.js";
import TileVectorTile from "./TileVectorTile.js";
import VectorTileDecoder from "./VectorTileDecoder.js";
import VectorTileCache from "./VectorTileCache.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import createVectorTilePrimitiveBucket from "./createVectorTilePrimitiveBucket.js";
import SharedPointCollections from "./SharedPointCollections.js";
import VectorTileSymbolBucket from "./VectorTileSymbolBucket.js";
import VectorTileTaskScheduler from "./VectorTileTaskScheduler.js";
import VectorTileStyleUtils from "./VectorTileStyleUtils.js";
import VectorTileGeometryPlacementUtils from "./VectorTileGeometryPlacementUtils.js";
import VectorTileCoverageState from "./VectorTileCoverageState.js";
import VectorTileStyleExpressionUtils from "./VectorTileStyleExpressionUtils.js";
import VectorTilePropertyProjectionUtils from "./VectorTilePropertyProjectionUtils.js";
import VectorTileFeatureStateUtils from "./VectorTileFeatureStateUtils.js";
import VectorTileBucketFallbackReason from "./VectorTileBucketFallbackReason.js";
import VectorTileTaskCancelledError from "./VectorTileTaskCancelledError.js";
import TileType from "./TileType.js";
import VectorTileStyleUpdateType from "./VectorTileStyleUpdateType.js";
import VectorTileFeatureStateStore from "./VectorTileFeatureStateStore.js";

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
  shadows: ShadowMode.DISABLED,
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
 * @param {string[]} [options.pickProperties] 公开拾取结果保留的属性名；未配置时保留全部属性。
 * @param {boolean} [options.asynchronous=true] 是否异步构建 Cesium 图元。
 * @param {ShadowMode} [options.shadows=ShadowMode.DISABLED] 阴影模式。
 * @param {number} [options.polygonHeight=1.0] 面要素默认高度。
 * @param {number} [options.cacheBytes=64*1024*1024] 图层缓存字节数上限。
 * @param {boolean} [options.clipToTile=true] 是否按瓦片边界裁剪。
 * @param {string} [options.renderBackend="instances"] 线渲染后端类型。
 * @param {number} [options.packedMinimumInstances=200] packed 线渲染的最小实例数。
 * @param {number} [options.tileSize=512] 样式缩放与误差计算使用的瓦片宽度。
 * @param {Scene} [options.scene] Cesium 场景。
 * @param {object} [options.styleDocument] 当前图层样式文档。
 * @param {VectorTileDiagnostics} [options.diagnostics] 诊断采样器。
 * @param {VectorTileTaskScheduler} [options.decodeScheduler] 解码任务调度器。
 * @param {VectorTileTaskScheduler} [options.buildScheduler] 构建任务调度器。
 * @param {object} [options.iconResources] 图标资源注册表。
 * @param {object} [options.iconImages] 图标资源注册表的别名配置。
 */
class VectorTileLayer {
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
    return defined(this._vectorTileProvider);
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
      ? VectorTileStyleUtils.normalizeStyleDocument(options.styleDocument)
      : undefined;
    this._contentRevision = 0;
    this._styleLayerStates = createStyleLayerStates(this._styleDocument);
    this._vectorTileProvider = vectorTileProvider;
    this._diagnostics = options.diagnostics;
    this._decodeScheduler =
      options.decodeScheduler ?? new VectorTileTaskScheduler(2);
    this._buildScheduler =
      options.buildScheduler ?? new VectorTileTaskScheduler(1);
    this._pickRegistry = options.pickRegistry;
    this._featureStateStore = new VectorTileFeatureStateStore({
      diagnostics: this._diagnostics,
    });
    this._featureStateBuckets = new Map();
    this._vectorTileCache = new VectorTileCache({
      maximumBytes: this._option.cacheBytes,
      diagnostics: this._diagnostics,
    });
    this._sharedPointCollections = new SharedPointCollections({
      scene: this._scene,
      diagnostics: this._diagnostics,
      pickRegistry: this._pickRegistry,
    });
    this._iconImages = {
      ...(options.iconResources ?? {}),
      ...(options.iconImages ?? {}),
    };
    this._iconResolver = VectorTileSymbolBucket.createVectorTileIconResolver(
      this._iconImages,
    );
    /**
     * 当前仍处于网络请求中的 `VectorTile` 集合，
     * 每帧由 {@link VectorTileLayer#cancelStaleRequests} 检查是否过期。
     * @type {Set<VectorTile>}
     */
    this._inFlightTiles = new Set();

    this._readyEvent = new Event();
    this._errorEvent = new Event();
    this.showChangedEvent = new Event();
    this.changedEvent = new Event();
    this.styleChangedEvent = new Event();
  }

  getVectorTileFromCache(x, y, level, rectangle) {
    const contentRevision = this._contentRevision;
    const cacheKey = getVectorTileCacheKey(contentRevision, x, y, level);
    let vectorTile = this._vectorTileCache.get(cacheKey);

    if (!defined(vectorTile)) {
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
      vectorTile.state = ImageryState.INVALID;
      this._diagnostics?.increment("unavailableTiles");
      return;
    }

    const startTime = this._diagnostics?.startTimer();
    const requestTask = vectorTileProvider.requestTile(vectorTile);
    if (requestTask) {
      vectorTile.networkTask = requestTask;
      vectorTile.state = ImageryState.TRANSITIONING;
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
            vectorTile.state = ImageryState.READY;
            vectorTile.cacheable = true;
            this._diagnostics?.increment("readyEmptyTiles");
            return;
          }

          vectorTile.arrayBuffer = arrayBuffer;
          vectorTile.arrayBufferBytes = arrayBuffer.byteLength;
          this._vectorTileCache.updateSize(vectorTile, arrayBuffer.byteLength);
          this._diagnostics?.addGauge(
            "residentArrayBufferBytes",
            arrayBuffer.byteLength,
          );
          vectorTile.state = ImageryState.RECEIVED;
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
            vectorTile.state = ImageryState.UNLOADED;
            this._diagnostics?.increment("cancelledTiles");
            return;
          }
          vectorTile.terminalReason = "FAILED";
          vectorTile.coverageState = VectorTileCoverageState.FAILED;
          vectorTile.state = ImageryState.FAILED;
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
      const styleRules = getStyleRulesForDecode(
        styleDocument,
        vectorTile.level,
      );
      const hasUnsupportedWorkerFilter = styleRules.some(
        (styleRule) =>
          !VectorTileStyleExpressionUtils.isWorkerSupportedVectorStyleFilter(
            styleRule.filter,
          ),
      );
      const workerStyleRules = hasUnsupportedWorkerFilter
        ? undefined
        : styleRules;
      if (hasUnsupportedWorkerFilter) {
        this._diagnostics?.increment("mainThreadStyleFilterFallbacks");
      }

      const styleZoom = vectorTile.level;
      const pickProperties = getSourcePickProperties(
        styleDocument,
        this._vectorTileProvider.sourceId,
        this._option.pickProperties,
      );
      const propertyProjections =
        VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
          { layers: styleRules },
          {
            allowPicking: this._option.allowPicking,
            pickProperties,
          },
        );

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
            styledLayerNames: getStyledLayerNames(styleRules),
            styleRules: workerStyleRules,
            propertyProjections,
            clipToTile: this._option.clipToTile,
            promoteId: getSourcePromoteId(
              styleDocument,
              this._vectorTileProvider.sourceId,
            ),
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
          this._diagnostics?.increment(
            "unaddressableFeatureStateFeatures",
            counts.unaddressableFeatures,
          );

          const buildTask = this._buildScheduler.schedule(
            () =>
              this._buildTilePrimitives(
                vectorTile,
                decodedTile,
                styleZoom,
                propertyProjections,
              ),
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
          vectorTile.state = ImageryState.READY;
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
            vectorTile.state = ImageryState.INVALID;
            this._diagnostics?.increment("cancelledTiles");
            return;
          }
          vectorTile.terminalReason = "DECODE_FAILED";
          vectorTile.coverageState = VectorTileCoverageState.FAILED;
          vectorTile.state = ImageryState.FAILED;
          this._diagnostics?.increment("failedTiles");
          this._errorEvent.raiseEvent(error, vectorTile);
        });
    }
  }

  _buildTilePrimitives(
    vectorTile,
    decodedTile,
    styleZoom,
    propertyProjections,
  ) {
    if (vectorTile.released || !this.isCurrentContentRevision(vectorTile)) {
      return false;
    }
    const buildStartTime = this._diagnostics?.startTimer();
    vectorTile.primitives = {};
    vectorTile.primitiveStyleRules = {};
    vectorTile.pointBuckets = {};
    vectorTile.buckets = {};
    adoptDecodedFeatureTables(
      vectorTile,
      decodedTile,
      this._option.allowPicking,
      getSourcePickProperties(
        vectorTile.styleDocument,
        this._vectorTileProvider.sourceId,
        this._option.pickProperties,
      ),
      this._diagnostics,
      propertyProjections,
    );
    const styleRules = getStyleRulesForBuild(
      vectorTile.styleDocument,
      vectorTile.level,
    );
    vectorTile.builtStyleLayerIds = new Set(
      styleRules.map((styleRule) => styleRule.id),
    );
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
            pickProperties: getSourcePickProperties(
              vectorTile.styleDocument,
              this._vectorTileProvider.sourceId,
              this._option.pickProperties,
            ),
            pickRegistry: this._pickRegistry,
            sourceId: this._vectorTileProvider.sourceId,
            diagnostics: this._diagnostics,
            ignoreZoomRange: true,
            renderBackend: this._option.renderBackend,
            packedMinimumInstances: this._option.packedMinimumInstances,
            shadows: this._option.shadows,
            asynchronous: this._option.asynchronous,
            clipToTile: this._option.clipToTile,
            vectorTile,
            featureTable: packedLayer.features,
            propertyProjection: propertyProjections?.[styleRule.sourceLayer],
            styleRevision: this.getStyleLayerRevision(styleRule.id),
            featureStateStore: this._featureStateStore,
            featureStateOwner: this,
          },
        );
        VectorTilePrimitiveBucket.storeVectorTileBucket(
          vectorTile,
          bucket,
          styleRule,
        );
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
    if (!defined(index)) {
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
    return VectorTileStyleUtils.computeCameraVectorTileStyleZoom(frameState, {
      ...this._option,
      scene: this._scene,
    });
  }

  setStyle(styleDocument) {
    const normalizedStyle =
      VectorTileStyleUtils.normalizeStyleDocument(styleDocument);
    this._styleDocument = normalizedStyle;
    this._option.styleDocument = normalizedStyle;
    this._styleLayerStates = createStyleLayerStates(
      normalizedStyle,
      this._styleLayerStates,
    );
    this.clearCache();
  }

  setStyleLayerAppearance(styleDocument, layerId, plan) {
    const normalizedStyle =
      VectorTileStyleUtils.normalizeStyleDocument(styleDocument);
    const styleRule = normalizedStyle.layers.find(
      (layer) => layer.id === layerId,
    );
    if (!styleRule) {
      return false;
    }

    const previousState = this._styleLayerStates.get(layerId);
    const revision = (previousState?.revision ?? 0) + 1;
    this._styleDocument = normalizedStyle;
    this._option.styleDocument = normalizedStyle;
    this._styleLayerStates.set(layerId, {
      revision,
      rule: styleRule,
    });
    for (const vectorTile of this._vectorTileCache.values()) {
      if (this.isCurrentContentRevision(vectorTile)) {
        vectorTile.styleDocument = snapshotStyleDocument(normalizedStyle);
      }
    }
    this._diagnostics?.increment("styleInPlaceUpdates");
    this.styleChangedEvent.raiseEvent(this, layerId, plan);
    return true;
  }

  setStyleLayerBucketRebuild(styleDocument, layerId, plan) {
    const normalizedStyle =
      VectorTileStyleUtils.normalizeStyleDocument(styleDocument);
    const styleRule = normalizedStyle.layers.find(
      (layer) => layer.id === layerId,
    );
    if (!styleRule) {
      return false;
    }

    const previousState = this._styleLayerStates.get(layerId);
    const revision = (previousState?.revision ?? 0) + 1;
    this._styleDocument = normalizedStyle;
    this._option.styleDocument = normalizedStyle;
    this._styleLayerStates.set(layerId, {
      revision,
      rule: styleRule,
    });

    for (const vectorTile of this._vectorTileCache.values()) {
      if (!this.isCurrentContentRevision(vectorTile)) {
        continue;
      }
      vectorTile.styleDocument = snapshotStyleDocument(normalizedStyle);
      this._markStyleLayerBucketDirty(vectorTile, layerId, revision, plan);
      if (vectorTile.referenceCount > 0) {
        this._scheduleStyleLayerBucketRebuild(
          vectorTile,
          layerId,
          revision,
          plan,
        );
      }
    }
    return true;
  }

  refineStyleLayerUpdatePlan(plan, styleRule) {
    for (const vectorTile of this._vectorTileCache.values()) {
      if (!this.isCurrentContentRevision(vectorTile)) {
        continue;
      }
      if (vectorTile.decodeTask || vectorTile.buildTask) {
        const addsDynamicColorDependency = plan.changedPaths?.some(
          (path) =>
            path.startsWith("paint.") &&
            Array.isArray(styleRule.paint?.[path.slice("paint.".length)]),
        );
        if (addsDynamicColorDependency) {
          return {
            ...plan,
            type: VectorTileStyleUpdateType.REBUILD_BUCKET,
            reason: VectorTileBucketFallbackReason.MISSING_PROPERTIES,
          };
        }
        if (
          styleRule.visibility !== false &&
          plan.changedPaths?.includes("visibility")
        ) {
          return {
            ...plan,
            type: VectorTileStyleUpdateType.REBUILD_BUCKET,
            reason: VectorTileBucketFallbackReason.MISSING_BUCKET,
          };
        }
      }
      if (vectorTile.state !== ImageryState.READY) {
        continue;
      }
      const bucket = vectorTile.buckets?.[styleRule.id];
      if (!bucket) {
        if (
          styleRule.visibility !== false &&
          !vectorTile.builtStyleLayerIds?.has(styleRule.id)
        ) {
          return {
            ...plan,
            type: VectorTileStyleUpdateType.REBUILD_BUCKET,
            reason: VectorTileBucketFallbackReason.MISSING_BUCKET,
          };
        }
        continue;
      }
      const reason = bucket.getStyleUpdateFallback(styleRule, plan);
      if (reason) {
        return {
          ...plan,
          type: VectorTileStyleUpdateType.REBUILD_BUCKET,
          reason,
        };
      }
    }
    return plan;
  }

  applyStyleLayerToTile(vectorTile, layerId, plan) {
    if (!this.isCurrentContentRevision(vectorTile)) {
      return undefined;
    }
    const styleState = this.getStyleLayerState(layerId);
    const bucket = vectorTile.buckets?.[layerId];
    if (!styleState || !bucket) {
      return undefined;
    }
    const result = bucket.applyStyle(
      styleState.rule,
      styleState.revision,
      plan,
    );
    this._diagnostics?.increment(
      "styleInPlaceInstanceUpdates",
      result.instanceUpdates,
    );
    this._diagnostics?.increment(
      "styleInPlacePointUpdates",
      result.pointUpdates,
    );
    return result;
  }

  applyPendingStyleUpdates(vectorTile) {
    if (!this.isCurrentContentRevision(vectorTile)) {
      return;
    }
    this._scheduleDirtyBucketRebuilds(vectorTile);
    for (const [layerId, bucket] of Object.entries(vectorTile.buckets ?? {})) {
      const styleState = this.getStyleLayerState(layerId);
      if (styleState && bucket.appliedStyleRevision < styleState.revision) {
        this.applyStyleLayerToTile(vectorTile, layerId);
      }
      const pendingState = bucket.applyPendingFeatureStateUpdates?.();
      this._diagnostics?.increment(
        "featureStateInstanceUpdates",
        pendingState?.instanceUpdates ?? 0,
      );
      this._diagnostics?.increment(
        "featureStateDeferredUpdates",
        pendingState?.deferredUpdates ?? 0,
      );
    }
  }

  processBucketRebuilds(vectorTile, frameState) {
    if (!vectorTile || !this.isCurrentContentRevision(vectorTile)) {
      return;
    }
    this._scheduleDirtyBucketRebuilds(vectorTile);
    const rebuilds = vectorTile.bucketRebuilds;
    if (!rebuilds) {
      return;
    }
    for (const [layerId, rebuild] of Object.entries(rebuilds)) {
      if (rebuild.replacementBucket) {
        this._warmReplacementBucket(rebuild.replacementBucket, frameState);
        if (isBucketDrawable(rebuild.replacementBucket)) {
          this._commitStyleLayerBucketReplacement(vectorTile, layerId, rebuild);
        }
      }
    }
  }

  _markStyleLayerBucketDirty(vectorTile, layerId, revision, plan) {
    if (!vectorTile.bucketRebuilds) {
      vectorTile.bucketRebuilds = {};
    }
    const existing = vectorTile.bucketRebuilds[layerId];
    if (existing?.revision === revision) {
      existing.dirty = true;
      return existing;
    }
    existing?.cancel?.();
    const rebuild = createBucketRebuildState(layerId, revision, plan);
    vectorTile.bucketRebuilds[layerId] = rebuild;
    return rebuild;
  }

  _scheduleDirtyBucketRebuilds(vectorTile) {
    const rebuilds = vectorTile?.bucketRebuilds;
    if (!rebuilds || vectorTile.referenceCount === 0) {
      return;
    }
    for (const [layerId, rebuild] of Object.entries(rebuilds)) {
      if (rebuild.dirty && !rebuild.task && !rebuild.replacementBucket) {
        this._scheduleStyleLayerBucketRebuild(
          vectorTile,
          layerId,
          rebuild.revision,
          rebuild.plan,
        );
      }
    }
  }

  _scheduleStyleLayerBucketRebuild(vectorTile, layerId, revision, plan) {
    if (
      vectorTile.released ||
      !this.isCurrentContentRevision(vectorTile) ||
      vectorTile.state !== ImageryState.READY
    ) {
      return false;
    }

    const styleState = this.getStyleLayerState(layerId);
    const styleRule = styleState?.rule;
    if (
      !styleRule ||
      styleState.revision !== revision ||
      styleRule.visibility === false
    ) {
      this._removeStyleLayerBucket(vectorTile, layerId);
      delete vectorTile.bucketRebuilds?.[layerId];
      vectorTile.builtStyleLayerIds?.add(layerId);
      return false;
    }

    const rebuild = this._markStyleLayerBucketDirty(
      vectorTile,
      layerId,
      revision,
      plan,
    );
    if (rebuild.task || rebuild.replacementBucket) {
      return true;
    }

    const vectorTileProvider = this._vectorTileProvider;
    const startTime = this._diagnostics?.startTimer();
    const pbfTask = vectorTileProvider.requestTile(vectorTile);
    if (!pbfTask) {
      return false;
    }
    rebuild.dirty = false;
    rebuild.task = pbfTask;

    pbfTask.promise
      .then((arrayBuffer) => {
        if (
          !this._isCurrentBucketRebuild(vectorTile, layerId, rebuild) ||
          !arrayBuffer ||
          arrayBuffer.byteLength === 0
        ) {
          return undefined;
        }
        this._diagnostics?.recordDuration("bucketRebuildRequest", startTime);
        const styleRules = [styleRule];
        const hasUnsupportedWorkerFilter =
          !VectorTileStyleExpressionUtils.isWorkerSupportedVectorStyleFilter(
            styleRule.filter,
          );
        const workerStyleRules = hasUnsupportedWorkerFilter
          ? undefined
          : styleRules;
        if (hasUnsupportedWorkerFilter) {
          this._diagnostics?.increment("mainThreadStyleFilterFallbacks");
        }
        const propertyProjections =
          VectorTilePropertyProjectionUtils.createVectorTilePropertyProjections(
            { layers: styleRules },
            {
              allowPicking: this._option.allowPicking,
              pickProperties: getSourcePickProperties(
                this._styleDocument,
                this._vectorTileProvider.sourceId,
                this._option.pickProperties,
              ),
            },
          );
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
              styledLayerNames: [styleRule.sourceLayer],
              styleRules: workerStyleRules,
              propertyProjections,
              clipToTile: this._option.clipToTile,
              promoteId: getSourcePromoteId(
                this._styleDocument,
                this._vectorTileProvider.sourceId,
              ),
            }),
          vectorTile.priority,
        );
        rebuild.task = decodeTask;
        return decodeTask.promise.then((decodedTile) => ({
          decodedTile,
          propertyProjections,
          hasUnsupportedWorkerFilter,
        }));
      })
      .then((decodeResult) => {
        if (
          !decodeResult ||
          !this._isCurrentBucketRebuild(vectorTile, layerId, rebuild)
        ) {
          return undefined;
        }
        let { decodedTile } = decodeResult;
        const { propertyProjections, hasUnsupportedWorkerFilter } =
          decodeResult;
        if (hasUnsupportedWorkerFilter) {
          decodedTile = applyMainThreadStyleFilters(
            decodedTile,
            [styleRule],
            vectorTile.level,
            this._diagnostics,
          );
        }
        const buildTask = this._buildScheduler.schedule(
          () =>
            this._buildReplacementBucket(
              vectorTile,
              decodedTile,
              styleRule,
              propertyProjections,
              revision,
            ),
          vectorTile.priority,
        );
        rebuild.task = buildTask;
        return buildTask.promise;
      })
      .then((bucket) => {
        rebuild.task = undefined;
        if (!this._isCurrentBucketRebuild(vectorTile, layerId, rebuild)) {
          bucket?.destroy?.();
          return;
        }
        rebuild.replacementBucket = bucket;
        if (isBucketDrawable(bucket)) {
          this._commitStyleLayerBucketReplacement(vectorTile, layerId, rebuild);
        } else {
          this._scene?.requestRender?.();
        }
      })
      .catch((error) => {
        rebuild.task = undefined;
        if (!this._isCurrentBucketRebuild(vectorTile, layerId, rebuild)) {
          return;
        }
        if (error instanceof VectorTileTaskCancelledError) {
          this._diagnostics?.increment("styleBucketRebuildCancelled");
          return;
        }
        this._diagnostics?.increment("styleBucketRebuildFailures");
        this._errorEvent.raiseEvent(error, vectorTile);
      });
    return true;
  }

  _isCurrentBucketRebuild(vectorTile, layerId, rebuild) {
    return (
      !vectorTile.released &&
      this.isCurrentContentRevision(vectorTile) &&
      vectorTile.bucketRebuilds?.[layerId] === rebuild &&
      this.getStyleLayerRevision(layerId) === rebuild.revision &&
      !rebuild.cancelled
    );
  }

  _buildReplacementBucket(
    vectorTile,
    decodedTile,
    styleRule,
    propertyProjections,
    styleRevision,
  ) {
    if (vectorTile.released || !this.isCurrentContentRevision(vectorTile)) {
      return undefined;
    }
    const packedLayer = decodedTile.layers[styleRule.sourceLayer];
    if (!packedLayer) {
      return undefined;
    }
    return createVectorTilePrimitiveBucket(
      packedLayer,
      styleRule,
      vectorTile.level,
      {
        scene: this._scene,
        iconResolver: this._iconResolver,
        allowPicking: this._option.allowPicking,
        pickProperties: getSourcePickProperties(
          vectorTile.styleDocument,
          this._vectorTileProvider.sourceId,
          this._option.pickProperties,
        ),
        pickRegistry: this._pickRegistry,
        sourceId: this._vectorTileProvider.sourceId,
        diagnostics: this._diagnostics,
        ignoreZoomRange: true,
        renderBackend: this._option.renderBackend,
        packedMinimumInstances: this._option.packedMinimumInstances,
        shadows: this._option.shadows,
        asynchronous: this._option.asynchronous,
        clipToTile: this._option.clipToTile,
        vectorTile,
        featureTable: packedLayer.features,
        propertyProjection: propertyProjections?.[styleRule.sourceLayer],
        styleRevision,
        residentFeatureTableEntries: packedLayer.features?.length ?? 0,
        residentPickPropertyValues: countPublicPickPropertyValues(
          packedLayer.features,
          this._option.allowPicking,
          getSourcePickProperties(
            vectorTile.styleDocument,
            this._vectorTileProvider.sourceId,
            this._option.pickProperties,
          ),
        ),
        featureStateStore: this._featureStateStore,
        featureStateOwner: this,
      },
    );
  }

  _warmReplacementBucket(bucket, frameState) {
    if (!bucket || !frameState) {
      return;
    }
    for (const primitive of bucket.primitives) {
      if (!primitive || primitive.ready || primitive.isDestroyed?.()) {
        continue;
      }
      const commandListLength = frameState.commandList?.length ?? 0;
      const show = primitive.show;
      primitive.show = true;
      primitive.update?.(frameState);
      primitive.show = show;
      if (frameState.commandList) {
        frameState.commandList.length = commandListLength;
      }
    }
  }

  _commitStyleLayerBucketReplacement(vectorTile, layerId, rebuild) {
    if (!this._isCurrentBucketRebuild(vectorTile, layerId, rebuild)) {
      rebuild.replacementBucket?.destroy?.();
      return false;
    }
    this._removeStyleLayerBucket(vectorTile, layerId);
    const bucket = rebuild.replacementBucket;
    if (bucket?.length > 0) {
      VectorTilePrimitiveBucket.storeVectorTileBucket(
        vectorTile,
        bucket,
        bucket.styleRule,
      );
    } else {
      bucket?.destroy?.();
    }
    if (!vectorTile.builtStyleLayerIds) {
      vectorTile.builtStyleLayerIds = new Set();
    }
    vectorTile.builtStyleLayerIds.add(layerId);
    delete vectorTile.bucketRebuilds?.[layerId];
    this._diagnostics?.increment("styleBucketReplacementCommits");
    this._scene?.requestRender?.();
    return true;
  }

  _removeStyleLayerBucket(vectorTile, layerId) {
    const oldBucket = vectorTile.buckets?.[layerId];
    if (!oldBucket) {
      delete vectorTile.primitives?.[layerId];
      delete vectorTile.primitiveStyleRules?.[layerId];
      delete vectorTile.pointBuckets?.[layerId];
      return;
    }
    this._sharedPointCollections.removeTileEntries(
      SharedPointCollections.createSharedPointEntryKey(vectorTile, layerId),
    );
    delete vectorTile.buckets[layerId];
    delete vectorTile.primitives?.[layerId];
    delete vectorTile.primitiveStyleRules?.[layerId];
    delete vectorTile.pointBuckets?.[layerId];
    oldBucket.destroy();
  }

  getStyleLayerState(layerId) {
    return this._styleLayerStates.get(layerId);
  }

  getStyleLayerRule(layerId) {
    return this.getStyleLayerState(layerId)?.rule;
  }

  getStyleLayerRevision(layerId) {
    return this.getStyleLayerState(layerId)?.revision ?? 0;
  }

  getStyle() {
    if (!this._styleDocument) {
      return undefined;
    }
    return VectorTileStyleUtils.normalizeStyleDocument(this._styleDocument);
  }

  registerIconImage(name, image) {
    if (typeof name !== "string" || name.length === 0) {
      throw new DeveloperError("name must be a non-empty string.");
    }
    this._iconImages[name] = image;
    this._iconResolver = VectorTileSymbolBucket.createVectorTileIconResolver(
      this._iconImages,
    );
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
      throw new DeveloperError(
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

  setFeatureState(target, state) {
    if (!this._featureStateStore.set(target, state)) {
      return false;
    }
    this._applyFeatureStateChange(target);
    return true;
  }

  getFeatureState(target) {
    return this._featureStateStore.get(target);
  }

  removeFeatureState(target, key) {
    if (!this._featureStateStore.remove(target, key)) {
      return false;
    }
    this._applyFeatureStateChange(target);
    return true;
  }

  getFeatureStateForFeature(sourceLayer, id) {
    return this._featureStateStore.peek(sourceLayer, id);
  }

  get featureStateRevision() {
    return this._featureStateStore.revision;
  }

  registerFeatureStateBucket(bucket) {
    const keys = bucket?.getFeatureStateKeys?.() ?? [];
    if (keys.length === 0) {
      return;
    }
    bucket._registeredFeatureStateKeys = keys;
    for (const key of keys) {
      let buckets = this._featureStateBuckets.get(key);
      if (!buckets) {
        buckets = new Set();
        this._featureStateBuckets.set(key, buckets);
      }
      buckets.add(bucket);
    }
    this._diagnostics?.addGauge("residentFeatureStateBindings", keys.length);
  }

  unregisterFeatureStateBucket(bucket) {
    const keys = bucket?._registeredFeatureStateKeys ?? [];
    if (keys.length === 0) {
      return;
    }
    for (const key of keys) {
      const buckets = this._featureStateBuckets.get(key);
      buckets?.delete(bucket);
      if (buckets?.size === 0) {
        this._featureStateBuckets.delete(key);
      }
    }
    bucket._registeredFeatureStateKeys = undefined;
    this._diagnostics?.addGauge("residentFeatureStateBindings", -keys.length);
  }

  _applyFeatureStateChange(target) {
    const buckets = this._featureStateBuckets.get(
      VectorTileFeatureStateUtils.encodeFeatureStateKey(
        target.sourceLayer,
        target.id,
      ),
    );
    let instanceUpdates = 0;
    let deferredUpdates = 0;
    for (const bucket of buckets ?? []) {
      const result = bucket.applyFeatureState?.(target);
      instanceUpdates += result?.instanceUpdates ?? 0;
      deferredUpdates += result?.deferredUpdates ?? 0;
    }
    this._diagnostics?.increment(
      "featureStateInstanceUpdates",
      instanceUpdates,
    );
    this._diagnostics?.increment(
      "featureStateDeferredUpdates",
      deferredUpdates,
    );
    this._scene?.requestRender?.();
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._removeManagerStyleChangedListener?.();
    this._removeManagerStyleChangedListener = undefined;
    this._featureStateStore.clear();
    this._featureStateBuckets.clear();
    this._vectorTileCache.destroy();
    this._sharedPointCollections.destroy();
  }

  static getStyleRulesForDecode(styleDocument, buildZoom) {
    return getStyleRulesForDecode(styleDocument, buildZoom);
  }

  static getStyleRulesForBuild(styleDocument, buildZoom) {
    return getStyleRulesForBuild(styleDocument, buildZoom);
  }

  static getDecodedTileByteLength(decodedTile) {
    return getDecodedTileByteLength(decodedTile);
  }

  static adoptDecodedFeatureTables(
    vectorTile,
    decodedTile,
    retainAll,
    pickProperties,
    diagnostics,
  ) {
    return adoptDecodedFeatureTables(
      vectorTile,
      decodedTile,
      retainAll,
      pickProperties,
      diagnostics,
    );
  }
}

function createStyleLayerStates(styleDocument, previousStates) {
  const result = new Map();
  for (const rule of styleDocument?.layers ?? []) {
    const previous = previousStates?.get(rule.id);
    result.set(rule.id, {
      revision: (previous?.revision ?? -1) + 1,
      rule,
    });
  }
  return result;
}

function getVectorTileCacheKey(contentRevision, x, y, level) {
  return JSON.stringify([contentRevision, x, y, level]);
}

function snapshotStyleDocument(styleDocument) {
  return styleDocument
    ? VectorTileStyleUtils.normalizeStyleDocument(styleDocument)
    : undefined;
}

function getSourcePickProperties(styleDocument, sourceId, fallback) {
  const source = styleDocument?.sources?.[sourceId];
  return source &&
    Object.prototype.hasOwnProperty.call(source, "pickProperties")
    ? source.pickProperties
    : fallback;
}

function getSourcePromoteId(styleDocument, sourceId) {
  return styleDocument?.sources?.[sourceId]?.promoteId;
}

function getStyleRulesForDecode(styleDocument) {
  if (!styleDocument?.layers) {
    return [];
  }
  return styleDocument.layers
    .filter(
      (layer) => isSupportedStyleLayer(layer) && layer.visibility !== false,
    )
    .map((layer) => ({
      id: layer.id,
      type: layer.type,
      sourceLayer: layer.sourceLayer,
      filter: layer.filter,
      layout: layer.layout,
      paint: layer.paint,
      visibility: layer.visibility,
    }));
}

function getStyleRulesForBuild(styleDocument) {
  if (!styleDocument?.layers) {
    return [];
  }
  return styleDocument.layers.filter(
    (layer) => layer.visibility !== false && isSupportedStyleLayer(layer),
  );
}

function getStyledLayerNames(styleRules) {
  return [...new Set(styleRules.map((layer) => layer.sourceLayer))];
}

function isSupportedStyleLayer(layer) {
  return (
    layer.type === "fill" ||
    layer.type === "circle" ||
    layer.type === "line" ||
    layer.type === "symbol"
  );
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
      ? VectorTileGeometryPlacementUtils.filterPackedLayerByStyleRules(
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
  let unaddressableFeatures = 0;
  Object.values(decodedTile.layers).forEach((layer) => {
    features += layer.featureCount;
    positions += layer.positionCount;
    styleFilteredFeatures += layer.styleFilteredFeatureCount ?? 0;
    clippedFeatures += layer.clippedFeatureCount;
    discardedFeatures += layer.discardedFeatureCount;
    outOfBoundsPositions += layer.outOfBoundsPositionCount;
    unaddressableFeatures += layer.unaddressableFeatureCount ?? 0;
  });
  return {
    features,
    positions,
    styleFilteredFeatures,
    clippedFeatures,
    discardedFeatures,
    outOfBoundsPositions,
    unaddressableFeatures,
  };
}

function getDecodedTileByteLength(decodedTile) {
  let byteLength = 0;
  Object.values(decodedTile.layers).forEach((layer) => {
    byteLength += layer.points.positions.byteLength;
    byteLength += layer.points.featureIndices.byteLength;
    byteLength += layer.lines.positions.byteLength;
    byteLength += layer.lines.offsets.byteLength;
    byteLength += layer.lines.featureIndices.byteLength;
    byteLength += layer.polygons.positions.byteLength;
    byteLength += layer.polygons.ringOffsets.byteLength;
    byteLength += layer.polygons.polygonOffsets.byteLength;
    byteLength += layer.polygons.featureIndices.byteLength;
    byteLength += estimateFeatureTableByteLength(layer.features);
  });
  return byteLength;
}

function adoptDecodedFeatureTables(
  vectorTile,
  decodedTile,
  allowPicking,
  pickProperties,
  diagnostics,
  propertyProjections,
) {
  const featureTables = {};
  let featureTableEntries = 0;
  let pickPropertyValues = 0;
  Object.entries(decodedTile.layers).forEach(([sourceLayer, packedLayer]) => {
    const features = packedLayer.features ?? [];
    featureTables[sourceLayer] = features;
    featureTableEntries += features.length;
    if (allowPicking) {
      for (const feature of features) {
        pickPropertyValues += countPublicPropertyValues(
          feature.properties,
          pickProperties,
        );
      }
    }
  });
  vectorTile.features = featureTables;
  vectorTile.propertyProjections = propertyProjections;
  vectorTile.residentFeatureTableEntries = featureTableEntries;
  vectorTile.residentPickPropertyValues = pickPropertyValues;
  diagnostics?.addGauge("residentFeatureTableEntries", featureTableEntries);
  diagnostics?.addGauge("residentPickPropertyValues", pickPropertyValues);
}

function countPublicPropertyValues(properties, pickProperties) {
  if (pickProperties === undefined) {
    return Object.keys(properties ?? {}).length;
  }
  let count = 0;
  for (const propertyName of pickProperties) {
    if (Object.prototype.hasOwnProperty.call(properties ?? {}, propertyName)) {
      count++;
    }
  }
  return count;
}

function estimateFeatureTableByteLength(features = []) {
  let byteLength = 0;
  for (const feature of features) {
    byteLength += 16;
    byteLength += estimateValueByteLength(feature.id);
    byteLength += estimateValueByteLength(feature.properties);
  }
  return byteLength;
}

function estimateValueByteLength(value, visited = new Set()) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "string") {
    return value.length * 2;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return 8;
  }
  if (typeof value !== "object" || visited.has(value)) {
    return 0;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    return value.reduce(
      (sum, item) => sum + estimateValueByteLength(item, visited),
      0,
    );
  }
  return Object.entries(value).reduce(
    (sum, [key, item]) =>
      sum + key.length * 2 + estimateValueByteLength(item, visited),
    0,
  );
}

function createBucketRebuildState(layerId, revision, plan) {
  return {
    layerId,
    revision,
    plan,
    dirty: true,
    task: undefined,
    replacementBucket: undefined,
    cancelled: false,
    cancel() {
      this.cancelled = true;
      this.task?.cancel?.();
      this.replacementBucket?.destroy?.();
      this.replacementBucket = undefined;
    },
    setPriority(priority) {
      this.task?.setPriority?.(priority);
    },
  };
}

function isBucketDrawable(bucket) {
  if (!bucket || bucket.length === 0) {
    return true;
  }
  return bucket.primitives.every(
    (primitive) => primitive.show === false || primitive.ready !== false,
  );
}

function countPublicPickPropertyValues(features, allowPicking, pickProperties) {
  if (!allowPicking) {
    return 0;
  }
  let count = 0;
  for (const feature of features ?? []) {
    count += countPublicPropertyValues(feature.properties, pickProperties);
  }
  return count;
}

export default VectorTileLayer;
