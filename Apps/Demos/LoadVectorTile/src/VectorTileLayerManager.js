import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileQuadtreePrimitive from "./VectorTileQuadtreePrimitive.js";
import VectorTileQuadtreeProvider from "./VectorTileQuadtreeProvider.js";
import VectorTileLayerCollection from "./VectorTileLayerCollection.js";
import VectorTileDiagnostics from "./VectorTileDiagnostics.js";
import VectorTileTaskScheduler from "./VectorTileTaskScheduler.js";
import {
  TileType,
  WMTSGeoVectorTileProvider,
  WMTSVectorTileProvider,
  XYZVectorTileProvider,
} from "./VectorTileProvider.js";
import VectorTileStyleRule from "./VectorTileStyleRule.js";
import { normalizeStyleDocument } from "./VectorTileStyleUtils.js";

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

  constructor(options = {}) {
    this._diagnostics = new VectorTileDiagnostics(options.diagnostics);
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
    this._providersBySourceId = new Map();

    this._vectorTileLayers = new VectorTileLayerCollection();
    // The same maximumScreenSpaceError must be used by both the quadtree
    // (refinement threshold) and the provider (geometric-error calibration)
    // so tile.level stays exactly aligned with map-style zoom.
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
      this._vectorTileLayers.layerShownOrHidden.addEventListener((layer) => {
        invalidateTiles();
        this._quadtreePrimitive.clearLayerRenderState(layer);
      });
    this._removeLayerChangedListener =
      this._vectorTileLayers.layerChanged.addEventListener((layer) => {
        invalidateTiles();
        this._quadtreePrimitive.clearLayerRenderState(layer);
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
      networkScheduler: this._networkScheduler,
      decodeScheduler: this._decodeScheduler,
      buildScheduler: this._buildScheduler,
    };
    if (provider.sourceId) {
      this._providersBySourceId.set(provider.sourceId, provider);
    }
    return this._vectorTileLayers.addLayerProvider(provider, index);
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

    runtimeLayer.setStyle({ ...currentStyle, layers: updatedLayers });
    return true;
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
    this._quadtreePrimitive.invalidateAllTiles();
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
      networkScheduler: this._networkScheduler,
      decodeScheduler: this._decodeScheduler,
      buildScheduler: this._buildScheduler,
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
