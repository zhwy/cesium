import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileQuadtreePrimitive from "./VectorTileQuadtreePrimitive.js";
import VectorTileQuadtreeProvider from "./VectorTileQuadtreeProvider.js";
import VectorTileLayerCollection from "./VectorTileLayerCollection.js";
import createProvider from "./createProvider.js";
import TileType from "./TileType.js";
import VectorTileDiagnostics from "./VectorTileDiagnostics.js";
import VectorTileTaskScheduler from "./VectorTileTaskScheduler.js";
import VectorTileDataProvider from "./VectorTileDataProvider.js";
import VectorTileStyleRule from "./VectorTileStyleRule.js";
import { normalizeStyleDocument } from "./VectorTileStyle.js";

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
    this._dataProviders = new Map();

    this._vectorTileLayers = new VectorTileLayerCollection();
    const tileProvider = new VectorTileQuadtreeProvider({
      vectorTileLayers: this._vectorTileLayers,
      tilingScheme: this._tilingScheme,
      diagnostics: this._diagnostics,
    });
    this._quadtreePrimitive = new VectorTileQuadtreePrimitive({
      tileProvider,
      diagnostics: this._diagnostics,
      tileCacheSize: options.tileCacheSize ?? 100,
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
      this._vectorTileLayers.layerChanged.addEventListener(invalidateTiles);

    this._removePreUpdateListener = undefined;
    this._removePostRenderListener = undefined;
  }

  addToScene(scene) {
    this._scene = scene;
    this._setSceneOnLayers(scene);
    this._initializeGroundPrimitiveHeights();
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

  removeFromScene(scene) {
    this._removePreUpdateListener?.();
    this._removePostRenderListener?.();
    this._removePreUpdateListener = undefined;
    this._removePostRenderListener = undefined;
    scene.primitives.remove(this.quadtreePrimitive);
  }

  addLayer(options) {
    const defaultOptions = {
      dataTypeField: "type",
      dataIdField: "id",
      minimumLevel: 0,
      maximumLevel: 20,
      tileType: TileType.XYZ,
      format: "application/vnd.mapbox-vector-tile",
      url: "",
      layer: "",
      allowPicking: false,
      asynchronous: true,
      shadows: Cesium.ShadowMode.DISABLED,
      polygonHeight: 1.0,
      clipToTile: true,
      renderBackend: "instances",
      packedMinimumInstances: 200,
      cacheBytes: 64 * 1024 * 1024,
      colors: {
        DEFAULT: "#FF0000",
      },
    };

    const provider = createProvider({
      ...defaultOptions,
      ...options,
      tilingScheme: this.tilingScheme,
      diagnostics: this._diagnostics,
      networkScheduler: this._networkScheduler,
      decodeScheduler: this._decodeScheduler,
      buildScheduler: this._buildScheduler,
      scene: this._scene,
      iconImages: this._iconImages,
    });

    return this._vectorTileLayers.addLayerProvider(provider);
  }

  setStyle(styleDocument) {
    const normalizedStyle = normalizeStyleDocument(styleDocument);
    this._dataProviders.clear();
    this._vectorTileLayers.removeAll();

    Object.keys(normalizedStyle.sources).forEach((sourceId) => {
      const source = normalizedStyle.sources[sourceId];
      const styleRules = normalizedStyle.layers
        .filter((layer) => layer.source === sourceId)
        .map((layer) => new VectorTileStyleRule(layer));
      if (styleRules.length === 0) {
        return;
      }

      const provider = this._createDataProvider(sourceId, source, styleRules);
      this._dataProviders.set(sourceId, provider);
      this._addDataProviderLayer(provider);
    });

    this._quadtreePrimitive.invalidateAllTiles();
  }

  getStyle() {
    const sources = {};
    const layers = [];
    this._dataProviders.forEach((dataProvider, sourceId) => {
      sources[sourceId] = dataProvider.source;
      dataProvider.styleRules.forEach((styleRule) => {
        layers.push(styleRule.toJSON());
      });
    });
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

  _createDataProvider(sourceId, source, styleRules) {
    const provider = createProvider({
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
    return new VectorTileDataProvider({
      sourceId,
      source,
      provider,
      styleRules,
    });
  }

  _addDataProviderLayer(dataProvider) {
    const styleDocument = dataProvider.toStyleDocument();
    dataProvider._options = {
      ...dataProvider._options,
      sourceId: dataProvider.sourceId,
      styleSourceId: dataProvider.sourceId,
      styleDocument,
      scene: this._scene,
      iconImages: this._iconImages,
      diagnostics: this._diagnostics,
      networkScheduler: this._networkScheduler,
      decodeScheduler: this._decodeScheduler,
      buildScheduler: this._buildScheduler,
    };
    const layer = this._vectorTileLayers.addLayerProvider(dataProvider);
    return layer;
  }

  _setSceneOnLayers(scene) {
    for (let i = 0; i < this._vectorTileLayers.length; ++i) {
      this._vectorTileLayers.get(i).setScene(scene);
    }
  }

  _initializeGroundPrimitiveHeights() {
    Cesium.GroundPrimitive.initializeTerrainHeights?.();
    Cesium.GroundPolylinePrimitive.initializeTerrainHeights?.();
  }
}
