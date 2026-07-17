import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileQuadtreePrimitive from "./VectorTileQuadtreePrimitive.js";
import VectorTileQuadtreeProvider from "./VectorTileQuadtreeProvider.js";
import VectorTileLayerCollection from "./VectorTileLayerCollection.js";
import VectorTileDiagnostics from "./VectorTileDiagnostics.js";
import VectorTilePbfCache from "./VectorTilePbfCache.js";
import VectorTileTaskScheduler from "./VectorTileTaskScheduler.js";
import {
  TileType,
  WMTSGeoVectorTileProvider,
  WMTSVectorTileProvider,
  XYZVectorTileProvider,
} from "./VectorTileProvider.js";
import VectorTileStyleRule from "./VectorTileStyleRule.js";
import { normalizeStyleDocument } from "./VectorTileStyleUtils.js";
import VectorTilePickRegistry from "./VectorTilePickRegistry.js";
import {
  createVectorTileStyleUpdatePlan,
  VectorTileStyleUpdateType,
} from "./VectorTileStyleUpdateUtils.js";

/**
 * 协调整个矢量瓦片图层系统：管理 provider、运行时图层、四叉树 primitive 与调度器。
 *
 * @param {object} [options={}] 构造参数。
 * @param {*} [options.diagnostics] 诊断配置，传给 `VectorTileDiagnostics`。
 * @param {number} [options.maximumNetworkTasks=8] 网络请求最大并发数。
 * @param {number} [options.maximumDecodeTasks=2] 解码任务最大并发数。
 * @param {number} [options.maximumBuildTasks=1] 构建任务最大并发数。
 * @param {string} [options.tilingScheme="WebMercatorTilingScheme"] Cesium 切片方案类型名。
 * @param {object} [options.scene] 初始 Cesium 场景。
 * @param {object} [options.iconResources] 图标资源注册表。
 * @param {object} [options.iconImages] 图标资源注册表的别名配置。
 * @param {number} [options.maximumScreenSpaceError=2] 四叉树 LOD 切换阈值。
 * @param {number} [options.tileSize=512] 样式缩放与误差计算使用的瓦片宽度。
 * @param {number} [options.pixelRatio=1] 设备像素比。
 * @param {number} [options.tileCacheSize=100] 四叉树 primitive 的瓦片缓存大小。
 * @param {number} [options.pbfCacheBytes=64*1024*1024] 所有 source 共享的 ready PBF payload 预算。
 */
export default class VectorTileLayerManager {
  get quadtreePrimitive() {
    return this._quadtreePrimitive;
  }

  get tilingScheme() {
    return this._tilingScheme;
  }

  get vectorTileLayers() {
    return this._vectorTileLayers;
  }

  get diagnostics() {
    return this._diagnostics;
  }

  get pbfCache() {
    return this._pbfCache;
  }

  constructor(options = {}) {
    this._diagnostics = new VectorTileDiagnostics(options.diagnostics);
    this._pbfCache = new VectorTilePbfCache({
      maximumBytes: options.pbfCacheBytes,
      diagnostics: this._diagnostics,
    });
    this._networkScheduler = new VectorTileTaskScheduler(
      options.maximumNetworkTasks ?? 8,
    );
    this._decodeScheduler = new VectorTileTaskScheduler(
      options.maximumDecodeTasks ?? 2,
    );
    this._buildScheduler = new VectorTileTaskScheduler(
      options.maximumBuildTasks ?? 1,
    );
    this._tilingScheme = new Cesium[
      options.tilingScheme || "WebMercatorTilingScheme"
    ]();
    this._iconImages = {
      ...(options.iconResources ?? {}),
      ...(options.iconImages ?? {}),
    };
    this._scene = options.scene;
    this._pickRegistry = new VectorTilePickRegistry();
    this._providersBySourceId = new Map();

    this._vectorTileLayers = new VectorTileLayerCollection();
    // 四叉树与 provider 必须共用同一个 maximumScreenSpaceError：
    // 前者用于细化阈值，后者用于几何误差校准，这样 `tile.level`
    // 才能与地图样式缩放级别严格对齐。
    const maximumScreenSpaceError = options.maximumScreenSpaceError ?? 2;
    const tileProvider = new VectorTileQuadtreeProvider({
      vectorTileLayers: this._vectorTileLayers,
      tilingScheme: this._tilingScheme,
      diagnostics: this._diagnostics,
      tileSize: options.tileSize ?? 512,
      maximumScreenSpaceError,
      pixelRatio: options.pixelRatio ?? 1,
    });
    this._quadtreePrimitive = new VectorTileQuadtreePrimitive({
      tileProvider,
      diagnostics: this._diagnostics,
      tileCacheSize: options.tileCacheSize ?? 100,
      maximumScreenSpaceError,
    });

    const invalidateTiles = () => this._quadtreePrimitive.invalidateAllTiles();
    this._removeLayerAddedListener =
      this._vectorTileLayers.layerAdded.addEventListener(invalidateTiles);
    this._removeLayerRemovedListener =
      this._vectorTileLayers.layerRemoved.addEventListener((layer) => {
        invalidateTiles();
        this._quadtreePrimitive.removeLayerRenderState(layer);
      });
    this._removeLayerVisibilityListener =
      this._vectorTileLayers.layerShownOrHidden.addEventListener(
        (layer, _index, show) => {
          if (show) {
            invalidateTiles();
          }
        },
      );
    this._removeLayerChangedListener =
      this._vectorTileLayers.layerChanged.addEventListener(() => {
        invalidateTiles();
      });

    this._removePreUpdateListener = undefined;
    this._removePostRenderListener = undefined;
  }

  addToScene(scene) {
    this._scene = scene;
    this._setSceneOnLayers(scene);
    scene.primitives.add(this.quadtreePrimitive);
    if (this._diagnostics.enabled) {
      this._removePreUpdateListener = scene.preUpdate.addEventListener(() => {
        this._diagnostics.beginFrame();
        this._diagnostics.setGauge(
          "activeNetworkTasks",
          this._networkScheduler.activeTasks,
        );
        this._diagnostics.setGauge(
          "queuedNetworkTasks",
          this._networkScheduler.queuedTasks,
        );
        this._diagnostics.setGauge(
          "activeDecodeTasks",
          this._decodeScheduler.activeTasks,
        );
        this._diagnostics.setGauge(
          "queuedDecodeTasks",
          this._decodeScheduler.queuedTasks,
        );
        this._diagnostics.setGauge(
          "activeBuildTasks",
          this._buildScheduler.activeTasks,
        );
        this._diagnostics.setGauge(
          "queuedBuildTasks",
          this._buildScheduler.queuedTasks,
        );
      });
      this._removePostRenderListener = scene.postRender.addEventListener(() => {
        this._diagnostics.endFrame();
      });
    }
  }

  removeFromScene() {
    this._removeLayerAddedListener?.();
    this._removeLayerRemovedListener?.();
    this._removeLayerVisibilityListener?.();
    this._removeLayerChangedListener?.();
    this._removeLayerAddedListener = undefined;
    this._removeLayerRemovedListener = undefined;
    this._removeLayerVisibilityListener = undefined;
    this._removeLayerChangedListener = undefined;

    this._removePreUpdateListener?.();
    this._removePostRenderListener?.();
    this._removePreUpdateListener = undefined;
    this._removePostRenderListener = undefined;

    this._scene?.primitives.remove(this.quadtreePrimitive);
    this._scene = undefined;
  }

  addLayer(sourceId, layerOptions = {}) {
    if (typeof sourceId !== "string" || sourceId.length === 0) {
      throw new Cesium.DeveloperError("sourceId must be a non-empty string.");
    }

    const provider = this.getProvider(sourceId);
    if (!provider) {
      throw new Cesium.DeveloperError(
        `provider for source "${sourceId}" does not exist.`,
      );
    }

    const runtimeLayer = this._getRuntimeLayerForProvider(provider);
    const currentStyle = runtimeLayer?.getStyle();
    const mergedStyleDocument = normalizeStyleDocument({
      version: 1,
      sources: {
        [sourceId]: provider.source,
      },
      layers: [
        ...(currentStyle?.layers ?? []),
        { ...layerOptions, source: sourceId },
      ],
      metadata: currentStyle?.metadata ?? {},
    });
    runtimeLayer?.setStyle(mergedStyleDocument);
    return runtimeLayer;
  }

  addLayerProvider(provider, index) {
    //>>includeStart('debug', pragmas.debug);
    if (!Cesium.defined(provider)) {
      throw new Cesium.DeveloperError("provider is required.");
    }
    if (
      provider.sourceId &&
      this._providersBySourceId.has(provider.sourceId) &&
      this._providersBySourceId.get(provider.sourceId) !== provider
    ) {
      throw new Cesium.DeveloperError(
        `provider for source "${provider.sourceId}" already exists.`,
      );
    }
    //>>includeEnd('debug');

    provider._options = {
      ...provider._options,
      sourceId: provider.sourceId,
      styleSourceId: provider.sourceId,
      styleDocument: provider._options.styleDocument,
      scene: this._scene,
      iconImages: this._iconImages,
      diagnostics: this._diagnostics,
      pbfCache: this._pbfCache,
      networkScheduler: this._networkScheduler,
      decodeScheduler: this._decodeScheduler,
      buildScheduler: this._buildScheduler,
      pickRegistry: this._pickRegistry,
    };
    provider.setPbfCache?.(this._pbfCache);
    if (!provider.setPbfCache) {
      provider._pbfCache = this._pbfCache;
    }
    provider._diagnostics = this._diagnostics;
    if (provider.sourceId) {
      this._providersBySourceId.set(provider.sourceId, provider);
    }
    const runtimeLayer = this._vectorTileLayers.addLayerProvider(
      provider,
      index,
    );
    this._installStyleChangedListener(runtimeLayer);
    return runtimeLayer;
  }

  removeLayer(layerId, destroy = true) {
    const runtimeLayer = this._findLayerByStyleRuleId(layerId);
    if (!runtimeLayer) {
      return false;
    }

    const currentStyle = runtimeLayer.getStyle();
    const remainingLayers = currentStyle.layers.filter(
      (layer) => layer.id !== layerId,
    );
    if (remainingLayers.length === currentStyle.layers.length) {
      return false;
    }

    if (remainingLayers.length === 0) {
      this._deleteProvider(runtimeLayer.vectorTileProvider);
      return this._vectorTileLayers.remove(runtimeLayer, destroy);
    }

    runtimeLayer.setStyle({ ...currentStyle, layers: remainingLayers });
    return true;
  }

  removeAll(destroy = true) {
    this._providersBySourceId.clear();
    this._vectorTileLayers.removeAll(destroy);
  }

  getProvider(sourceId) {
    return this._providersBySourceId.get(sourceId);
  }

  setStyle(styleDocument) {
    const normalizedStyle = normalizeStyleDocument(styleDocument);
    this.removeAll();

    Object.keys(normalizedStyle.sources).forEach((sourceId) => {
      const source = normalizedStyle.sources[sourceId];
      const styleRules = normalizedStyle.layers
        .filter((layer) => layer.source === sourceId)
        .map((layer) => new VectorTileStyleRule(layer));
      if (styleRules.length === 0) {
        return;
      }

      const provider = this._createManagedProvider(
        sourceId,
        source,
        styleRules,
      );
      this.addLayerProvider(provider);
    });

    this._quadtreePrimitive.invalidateAllTiles();
  }

  getStyle() {
    const sources = {};
    const layers = [];
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      const styleDocument = this._vectorTileLayers.get(i).getStyle();
      if (!styleDocument) {
        continue;
      }
      Object.assign(sources, styleDocument.sources);
      layers.push(...styleDocument.layers);
    }
    if (Object.keys(sources).length === 0) {
      return undefined;
    }
    return normalizeStyleDocument({
      version: 1,
      sources,
      layers,
      metadata: {},
    });
  }

  getLayerStyle(layerId) {
    const runtimeLayer = this._findLayerByStyleRuleId(layerId);
    if (runtimeLayer) {
      const currentStyle = runtimeLayer.getStyle();
      return currentStyle.layers.find((layer) => layer.id === layerId);
    }

    return undefined;
  }

  /**
   * 同步解析该 manager 管理的紧凑矢量瓦片拾取结果。
   *
   * @param {object} picked `Scene#pick` 返回值。
   * @returns {object|undefined} 仍驻留的 feature 信息。
   */
  resolvePickedFeature(picked) {
    return this._pickRegistry?.resolve(picked);
  }

  setLayerStyle(layerId, newStyle, merged = true) {
    const runtimeLayer = this._findLayerByStyleRuleId(layerId);
    if (!runtimeLayer) {
      return false;
    }

    const currentStyle = runtimeLayer.getStyle();
    const layerIndex = currentStyle.layers.findIndex(
      (layer) => layer.id === layerId,
    );
    const updatedLayer = merged
      ? mergeStyleValue(currentStyle.layers[layerIndex], newStyle)
      : newStyle;
    const updatedLayers = currentStyle.layers.slice();
    updatedLayers[layerIndex] = updatedLayer;
    const updatedStyle = normalizeStyleDocument({
      ...currentStyle,
      layers: updatedLayers,
    });
    const normalizedLayer = updatedStyle.layers[layerIndex];
    let plan = createVectorTileStyleUpdatePlan(
      currentStyle.layers[layerIndex],
      normalizedLayer,
    );

    if (plan.type === VectorTileStyleUpdateType.IN_PLACE_APPEARANCE) {
      plan =
        runtimeLayer.refineStyleLayerUpdatePlan?.(plan, normalizedLayer) ??
        plan;
    }

    if (plan.type === VectorTileStyleUpdateType.NO_OP) {
      this._diagnostics?.increment?.("styleNoopUpdates");
      return true;
    }
    if (plan.type === VectorTileStyleUpdateType.IN_PLACE_APPEARANCE) {
      if (runtimeLayer.setStyleLayerAppearance) {
        runtimeLayer.setStyleLayerAppearance(updatedStyle, layerId, plan);
      } else {
        runtimeLayer.setStyle(updatedStyle);
      }
      return true;
    }

    if (plan.type === VectorTileStyleUpdateType.REBUILD_BUCKET) {
      this._diagnostics?.increment?.("styleBucketRebuilds");
      if (plan.reason === "MISSING_PROPERTIES") {
        this._diagnostics?.increment?.("styleBucketPropertyFallbacks");
      } else if (plan.reason === "RENDER_STATE") {
        this._diagnostics?.increment?.("styleBucketRenderStateFallbacks");
      }
      if (runtimeLayer.setStyleLayerBucketRebuild) {
        runtimeLayer.setStyleLayerBucketRebuild(updatedStyle, layerId, plan);
        this._scene?.requestRender?.();
        return true;
      }
    } else {
      this._diagnostics?.increment?.("styleSourceRebuilds");
    }
    runtimeLayer.setStyle(updatedStyle);
    return true;
  }

  _installStyleChangedListener(runtimeLayer) {
    if (!runtimeLayer?.styleChangedEvent) {
      return;
    }
    runtimeLayer._removeManagerStyleChangedListener?.();
    runtimeLayer._removeManagerStyleChangedListener =
      runtimeLayer.styleChangedEvent.addEventListener(
        (layer, layerId, plan) => {
          this._quadtreePrimitive?.applyStyleLayerUpdate?.(
            layer,
            layerId,
            plan,
          );
          this._scene?.requestRender?.();
        },
      );
  }

  registerIconImage(name, image) {
    this._iconImages[name] = image;
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      this._vectorTileLayers.get(i).registerIconImage(name, image);
    }
  }

  getIconImage(name) {
    return this._iconImages[name];
  }

  clearCache() {
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      this._vectorTileLayers.get(i).clearCache(false);
    }
    this.clearPbfCache();
    this._quadtreePrimitive.invalidateAllTiles();
  }

  clearPbfCache() {
    this._pbfCache.clear();
  }

  _createManagedProvider(sourceId, source, styleRules) {
    return this._createProvider({
      dataTypeField: "type",
      dataIdField: "id",
      minimumLevel: source.minimumLevel ?? 0,
      maximumLevel: source.maximumLevel ?? 20,
      tileType: source.tileType ?? TileType.XYZ,
      format: source.format ?? "application/vnd.mapbox-vector-tile",
      layer: source.layer ?? "",
      allowPicking: source.allowPicking ?? false,
      asynchronous: source.asynchronous ?? true,
      shadows: source.shadows ?? Cesium.ShadowMode.DISABLED,
      polygonHeight: source.polygonHeight ?? 1.0,
      clipToTile: source.clipToTile ?? true,
      renderBackend: source.renderBackend ?? "instances",
      packedMinimumInstances: source.packedMinimumInstances ?? 200,
      cacheBytes: source.cacheBytes ?? 64 * 1024 * 1024,
      ...source,
      sourceId,
      styleSourceId: sourceId,
      styleDocument: {
        version: 1,
        sources: {
          [sourceId]: source,
        },
        layers: styleRules.map((styleRule) => styleRule.toJSON()),
      },
      tilingScheme: this.tilingScheme,
      diagnostics: this._diagnostics,
      pbfCache: this._pbfCache,
      networkScheduler: this._networkScheduler,
      decodeScheduler: this._decodeScheduler,
      buildScheduler: this._buildScheduler,
      pickRegistry: this._pickRegistry,
      scene: this._scene,
      iconImages: this._iconImages,
    });
  }

  _createProvider(options) {
    if (options.tileType === TileType.WMTS) {
      if (options.format === "application/vnd.mapbox-vector-tile") {
        return new WMTSVectorTileProvider({
          ...options,
        });
      } else if (options.format === "application/json;type=geojson") {
        return new WMTSGeoVectorTileProvider({
          ...options,
        });
      }
    } else if (options.tileType === TileType.XYZ) {
      return new XYZVectorTileProvider({
        ...options,
      });
    }
  }

  _setSceneOnLayers(scene) {
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      this._vectorTileLayers.get(i).setScene(scene);
    }
  }

  _findLayerByStyleRuleId(layerId) {
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      const layer = this._vectorTileLayers.get(i);
      const styleDocument = layer.getStyle();
      if (styleDocument?.layers.some((rule) => rule.id === layerId)) {
        return layer;
      }
    }
    return undefined;
  }

  _getRuntimeLayerForProvider(provider) {
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      const layer = this._vectorTileLayers.get(i);
      if (layer.vectorTileProvider === provider) {
        return layer;
      }
    }
    return undefined;
  }

  _deleteProvider(provider) {
    if (!provider?.sourceId) {
      return;
    }
    if (this._providersBySourceId.get(provider.sourceId) === provider) {
      this._providersBySourceId.delete(provider.sourceId);
    }
  }
}

function mergeStyleValue(currentValue, newValue) {
  if (!isPlainObject(currentValue) || !isPlainObject(newValue)) {
    return cloneStyleValue(newValue);
  }

  const result = cloneStyleValue(currentValue);
  Object.keys(newValue).forEach((key) => {
    result[key] = mergeStyleValue(currentValue[key], newValue[key]);
  });
  return result;
}

function cloneStyleValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneStyleValue);
  }
  if (isPlainObject(value)) {
    const result = {};
    Object.keys(value).forEach((key) => {
      result[key] = cloneStyleValue(value[key]);
    });
    return result;
  }
  return value;
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
