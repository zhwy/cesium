import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileCoverageState from "./VectorTileCoverageState.js";
import TileType from "./TileType.js";
import VectorTile from "./VectorTile.js";
import TileVectorTile from "./TileVectorTile.js";
import VectorTileDecoder from "./VectorTileDecoder.js";
import VectorTileCache from "./VectorTileCache.js";
import VectorTilePrimitiveBucket from "./VectorTilePrimitiveBucket.js";
import VectorTileSymbolBucket, {
  createVectorTileIconResolver,
} from "./VectorTileSymbolBucket.js";
import VectorTileTaskScheduler, {
  VectorTileTaskCancelledError,
} from "./VectorTileTaskScheduler.js";
import {
  createLegacyLayerOptionsFromStyleDocument,
  createStyleDocumentFromLegacyOptions,
  normalizeStyleDocument,
} from "./VectorTileStyle.js";
import { computeVectorTileStyleZoom } from "./VectorTileStyleZoom.js";
import {
  getWebMercatorTileBounds,
  isTileBoundarySegment,
} from "./VectorTileGeometryUtil.js";
import {
  evaluateVectorStyleFilter,
  isWorkerSupportedVectorStyleFilter,
} from "./VectorStyleFilter.js";
import { evaluateVectorStyleExpression } from "./VectorStyleExpression.js";

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
  styleZoomTileWidth: 512,
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
      const styleZoom = computeVectorTileStyleZoom(
        vectorTile.level,
        this._option,
      );

      const decodeTask = this._decodeScheduler.schedule(
        () =>
          VectorTileDecoder.instance().decode(arrayBuffer, {
            tile: {
              x: vectorTile.x,
              y: vectorTile.y,
              level: vectorTile.level,
              sourceLevel: vectorTile.level,
              styleZoom,
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
    const styleRules = getStyleRulesForBuild(this._styleDocument);
    if (styleRules.length > 0) {
      styleRules.forEach((styleRule) => {
        const packedLayer = decodedTile.layers[styleRule.sourceLayer];
        if (!packedLayer) {
          return;
        }
        const bucket = this._createPrimitiveBucket(
          packedLayer,
          styleRule,
          styleZoom,
          vectorTile,
        );
        if (bucket.length > 0) {
          vectorTile.primitives[bucket.id] = bucket.primitives;
        }
      });
    } else {
      Object.keys(this._styles).forEach((key) => {
        const packedLayer = decodedTile.layers[key];
        if (!packedLayer) {
          return;
        }
        const primitives = this._createTilePrimitivesForStyle(
          packedLayer,
          this._styles[key],
        );
        if (primitives.length > 0) {
          vectorTile.primitives[key] = primitives;
        }
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

  _createTilePrimitivesForStyle(packedLayer, style) {
    const primitives = [];
    if (this._shouldUsePackedLines(packedLayer.lines, style)) {
      primitives.push(
        ...this._createPackedPolylinePrimitives(packedLayer.lines, style),
      );
    } else {
      const lineInstances = this._createPolylineGeometryInstances(
        packedLayer.lines,
        style,
      );
      if (lineInstances.length > 0) {
        primitives.push(this._createPrimitive(lineInstances, "line", style));
      }
    }

    const polygonInstances = this._createPolygonGeometryInstances(
      packedLayer.polygons,
      style,
    );
    if (polygonInstances.length > 0) {
      primitives.push(
        this._createPrimitive(polygonInstances, "polygon", style),
      );
    }
    return primitives;
  }

  _createPrimitiveBucket(packedLayer, styleRule, zoom, vectorTile) {
    const bucket = new VectorTilePrimitiveBucket(styleRule);
    const tileBounds =
      this._option.clipToTile && vectorTile
        ? getWebMercatorTileBounds(vectorTile)
        : undefined;
    if (styleRule.type === "fill") {
      bucket.addPrimitives(
        this._createFillPrimitivesForStyleRule(
          packedLayer.polygons,
          styleRule,
          zoom,
        ),
      );
      bucket.addPrimitives(
        this._createFillOutlinePrimitivesForStyleRule(
          packedLayer.polygons,
          styleRule,
          zoom,
          tileBounds,
        ),
      );
    } else if (styleRule.type === "line") {
      bucket.addPrimitives(
        this._createLinePrimitivesForStyleRule(
          packedLayer.lines,
          styleRule,
          zoom,
        ),
      );
    } else if (styleRule.type === "symbol") {
      bucket.addPrimitives(
        this._createSymbolPrimitivesForStyleRule(
          packedLayer.points,
          styleRule,
          zoom,
        ),
      );
    }

    if (bucket.length > 0) {
      this._diagnostics?.increment("primitiveBuckets");
    }
    return bucket;
  }

  _createSymbolPrimitivesForStyleRule(points, styleRule, zoom) {
    const bucket = new VectorTileSymbolBucket(styleRule, {
      Cesium,
      scene: this._scene,
      iconResolver: this._iconResolver,
      allowPicking: this._option.allowPicking,
      diagnostics: this._diagnostics,
    }).build(points, zoom);
    return bucket.primitives;
  }

  _shouldUsePackedLines(lines, style) {
    const lineCount = Math.max(0, lines.offsets.length - 1);
    return (
      this._option.renderBackend === "packed" &&
      !this._option.allowPicking &&
      Cesium.defined(style.lineColor) &&
      lineCount >= this._option.packedMinimumInstances
    );
  }

  _createPackedPolylinePrimitives(lines, style) {
    const startTime = this._diagnostics?.startTimer();
    const geometryInstances = [];
    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      const positions = createCartesianLine(lines, i);
      if (positions.length < 2) {
        continue;
      }
      const geometry = Cesium.PolylineGeometry.createGeometry(
        new Cesium.PolylineGeometry({
          positions,
          width: style.lineWidth ?? 2,
          arcType: style.arcType ?? Cesium.ArcType.GEODESIC,
          vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
        }),
      );
      if (geometry) {
        geometryInstances.push(new Cesium.GeometryInstance({ geometry }));
      }
    }
    if (geometryInstances.length === 0) {
      return [];
    }

    // TODO 解决 scene3DOnly 为 false 时报错的问题，GeometryPipeline.js 中的 updateGeometryAfterSplit 会产生NaN
    // westGeometry = updateGeometryAfterSplit(westGeometry, computeBoundingSphere);
    // eastGeometry = updateGeometryAfterSplit(eastGeometry, computeBoundingSphere);
    const combinedGeometries =
      Cesium.GeometryPipeline.combineInstances(geometryInstances);

    const color = Cesium.Color.fromCssColorString(style.lineColor);
    const appearance = new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType("Color", { color }),
      translucent: color.alpha < 1.0,
    });

    const primitives = combinedGeometries.map((geometry) => {
      return new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry }),
        appearance,
        shadows: this._option.shadows,
        allowPicking: false,
        asynchronous: false,
        releaseGeometryInstances: true,
        compressVertices: true,
      });
    });

    this._diagnostics?.increment("packedLineBuckets");
    this._diagnostics?.increment(
      "packedSourceGeometries",
      geometryInstances.length,
    );
    this._diagnostics?.increment(
      "packedCombinedGeometries",
      combinedGeometries.length,
    );
    this._diagnostics?.increment("createdPrimitives", primitives.length);
    this._diagnostics?.recordDuration("packedGeometryBuild", startTime);
    return primitives;
  }

  _createPrimitive(geometryInstances, geometryType, style) {
    this._diagnostics?.increment(
      "createdGeometryInstances",
      geometryInstances.length,
    );
    const primitive = style.groundPrimitive
      ? new Cesium.GroundPrimitive({
          geometryInstances,
          appearance: this._createAppearance(geometryType, style),
          shadows: this._option.shadows,
          allowPicking: this._option.allowPicking,
          asynchronous: true,
          releaseGeometryInstances: true,
        })
      : new Cesium.Primitive({
          geometryInstances,
          appearance: this._createAppearance(geometryType, style),
          shadows: this._option.shadows,
          allowPicking: this._option.allowPicking,
          asynchronous: this._option.asynchronous,
          releaseGeometryInstances: true,
          compressVertices: true,
        });
    if (style.groundPrimitive) {
      this._diagnostics?.increment("createdGroundPrimitives");
    }
    this._diagnostics?.increment("createdPrimitives");
    return primitive;
  }

  _createPolylineGeometryInstances(lines, style) {
    const instances = [];
    const lineColor = style.lineColor
      ? Cesium.Color.fromCssColorString(style.lineColor)
      : undefined;
    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      const start = lines.offsets[i];
      const end = lines.offsets[i + 1];
      if (end - start < 2) {
        continue;
      }

      const cartesianPositions = createCartesianLine(lines, i);
      const polyline = new Cesium.PolylineGeometry({
        positions: cartesianPositions,
        width: style.lineWidth ?? 2,
        arcType: style.arcType ?? Cesium.ArcType.GEODESIC,
      });
      instances.push(
        new Cesium.GeometryInstance({
          id: this._option.allowPicking ? lines.metadata[i] : undefined,
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              lineColor || Cesium.Color.fromRandom(),
            ),
          },
        }),
      );
    }
    return instances;
  }

  _createPackedLinePrimitivesForStyleRule(lines, styleRule, zoom) {
    const filteredLines = this._filterLinesForStyleRule(lines, styleRule, zoom);
    const style = {
      lineColor: getAppearanceColor(
        styleRule.paint?.["line-color"],
        "#ffff00ff",
      ),
      lineWidth: evaluatePaintValue(
        styleRule.paint?.["line-width"],
        undefined,
        zoom,
        2,
      ),
      arcType: styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
    };
    return this._createPackedPolylinePrimitives(filteredLines, style);
  }

  _createLinePrimitivesForStyleRule(lines, styleRule, zoom) {
    if (requiresGroundHeightOffsetFallback(styleRule)) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }
    const useGroundPath = shouldUseGroundPath(styleRule);
    const lineCount = Math.max(0, lines.offsets.length - 1);
    if (
      !useGroundPath &&
      this._option.renderBackend === "packed" &&
      !this._option.allowPicking &&
      lineCount >= this._option.packedMinimumInstances &&
      !isVectorStyleExpression(styleRule.paint?.["line-color"]) &&
      !isVectorStyleExpression(styleRule.paint?.["line-width"])
    ) {
      return this._createPackedLinePrimitivesForStyleRule(
        lines,
        styleRule,
        zoom,
      );
    }

    const lineInstances = useGroundPath
      ? this._createGroundLineGeometryInstancesForStyleRule(
          lines,
          styleRule,
          zoom,
        )
      : this._createLineGeometryInstancesForStyleRule(lines, styleRule, zoom);
    if (lineInstances.length === 0) {
      return [];
    }
    if (useGroundPath) {
      return [this._createGroundPolylinePrimitive(lineInstances)];
    }
    return [this._createPrimitive(lineInstances, "line", {})];
  }

  _createLineGeometryInstancesForStyleRule(lines, styleRule, zoom) {
    const instances = [];
    const height = getStyleRuleHeightOffset(styleRule);
    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      const start = lines.offsets[i];
      const end = lines.offsets[i + 1];
      if (end - start < 2) {
        continue;
      }

      const metadata = lines.metadata[i];
      if (!doesStyleRuleMatchMetadata(metadata, 2, styleRule, zoom)) {
        continue;
      }

      const polyline = new Cesium.PolylineGeometry({
        positions: createCartesianLine(lines, i, height),
        width: evaluatePaintValue(
          styleRule.paint?.["line-width"],
          metadata,
          zoom,
          2,
        ),
        arcType: styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
      });
      instances.push(
        new Cesium.GeometryInstance({
          id: this._option.allowPicking ? metadata : undefined,
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorPaintValue(
                styleRule.paint?.["line-color"],
                metadata,
                zoom,
                "#ffff00ff",
              ),
            ),
          },
        }),
      );
    }
    return instances;
  }

  _createGroundLineGeometryInstancesForStyleRule(lines, styleRule, zoom) {
    const instances = [];
    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      const start = lines.offsets[i];
      const end = lines.offsets[i + 1];
      if (end - start < 2) {
        continue;
      }

      const metadata = lines.metadata[i];
      if (!doesStyleRuleMatchMetadata(metadata, 2, styleRule, zoom)) {
        continue;
      }

      const polyline = new Cesium.GroundPolylineGeometry({
        positions: createCartesianLine(lines, i),
        width: evaluatePaintValue(
          styleRule.paint?.["line-width"],
          metadata,
          zoom,
          2,
        ),
        arcType: styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
      });
      instances.push(
        new Cesium.GeometryInstance({
          id: this._option.allowPicking ? metadata : undefined,
          geometry: polyline,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorPaintValue(
                styleRule.paint?.["line-color"],
                metadata,
                zoom,
                "#ffff00ff",
              ),
            ),
          },
        }),
      );
    }
    return instances;
  }

  _createGroundPolylinePrimitive(geometryInstances) {
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances,
      appearance: new Cesium.PolylineColorAppearance(),
      allowPicking: this._option.allowPicking,
      asynchronous: true,
      releaseGeometryInstances: true,
    });
    this._diagnostics?.increment("createdGroundPolylinePrimitives");
    this._diagnostics?.increment("createdPrimitives");
    return primitive;
  }

  _createPolygonGeometryInstances(polygons, style) {
    const instances = [];
    const fillColor = style.fillColor
      ? Cesium.Color.fromCssColorString(style.fillColor)
      : undefined;
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      if (firstRing >= lastRing) {
        continue;
      }

      const outerRing = createCartesianRing(polygons, firstRing);
      if (outerRing.length < 3) {
        continue;
      }
      const holes = [];
      for (let ringIndex = firstRing + 1; ringIndex < lastRing; ++ringIndex) {
        const hole = createCartesianRing(polygons, ringIndex);
        if (hole.length >= 3) {
          holes.push(new Cesium.PolygonHierarchy(hole));
        }
      }
      const polygon = new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(outerRing, holes),
        height: style.height ?? this._option.polygonHeight,
      });
      instances.push(
        new Cesium.GeometryInstance({
          id: this._option.allowPicking ? polygons.metadata[i] : undefined,
          geometry: polygon,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              fillColor || Cesium.Color.fromRandom(),
            ),
          },
        }),
      );
    }
    return instances;
  }

  _createFillPrimitivesForStyleRule(polygons, styleRule, zoom) {
    if (requiresGroundHeightOffsetFallback(styleRule)) {
      this._diagnostics?.increment("groundHeightOffsetFallbacks");
    }
    const polygonInstances = this._createPolygonGeometryInstancesForStyleRule(
      polygons,
      styleRule,
      zoom,
    );
    if (polygonInstances.length === 0) {
      return [];
    }
    return [
      this._createPrimitive(polygonInstances, "polygon", {
        fillColor: getAppearanceColor(
          styleRule.paint?.["fill-color"],
          "#ff000077",
        ),
        translucent:
          isVectorStyleExpression(styleRule.paint?.["fill-color"]) ||
          Cesium.Color.fromCssColorString(
            getAppearanceColor(styleRule.paint?.["fill-color"], "#ff000077"),
          ).alpha < 1.0,
        groundPrimitive: shouldUseGroundPath(styleRule),
      }),
    ];
  }

  _createPolygonGeometryInstancesForStyleRule(polygons, styleRule, zoom) {
    const instances = [];
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = polygons.metadata[i];
      if (!doesStyleRuleMatchMetadata(metadata, 3, styleRule, zoom)) {
        continue;
      }

      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      if (firstRing >= lastRing) {
        continue;
      }

      const height = shouldUseGroundPath(styleRule)
        ? undefined
        : getStyleRuleHeightOffset(styleRule);
      const outerRing = createCartesianRing(polygons, firstRing, height);
      if (outerRing.length < 3) {
        continue;
      }
      const holes = [];
      for (let ringIndex = firstRing + 1; ringIndex < lastRing; ++ringIndex) {
        const hole = createCartesianRing(polygons, ringIndex, height);
        if (hole.length >= 3) {
          holes.push(new Cesium.PolygonHierarchy(hole));
        }
      }
      const polygonOptions = {
        polygonHierarchy: new Cesium.PolygonHierarchy(outerRing, holes),
      };
      if (!shouldUseGroundPath(styleRule)) {
        polygonOptions.height = getStyleRuleHeightOffset(styleRule);
      }
      const polygon = new Cesium.PolygonGeometry(polygonOptions);
      instances.push(
        new Cesium.GeometryInstance({
          id: this._option.allowPicking ? metadata : undefined,
          geometry: polygon,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              evaluateColorPaintValue(
                styleRule.paint?.["fill-color"],
                metadata,
                zoom,
                "#ff000077",
              ),
            ),
          },
        }),
      );
    }
    return instances;
  }

  _createFillOutlinePrimitivesForStyleRule(
    polygons,
    styleRule,
    zoom,
    tileBounds,
  ) {
    if (!Cesium.defined(styleRule.paint?.["fill-outline-color"])) {
      return [];
    }
    const lineInstances = [];
    const useGroundPath = shouldUseGroundPath(styleRule);
    const height = useGroundPath
      ? undefined
      : getStyleRuleHeightOffset(styleRule);
    for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
      const metadata = polygons.metadata[i];
      if (!doesStyleRuleMatchMetadata(metadata, 3, styleRule, zoom)) {
        continue;
      }

      const firstRing = polygons.polygonOffsets[i];
      const lastRing = polygons.polygonOffsets[i + 1];
      for (let ringIndex = firstRing; ringIndex < lastRing; ++ringIndex) {
        const outlineLines = createOutlineCartesianLines(
          polygons,
          ringIndex,
          height,
          tileBounds,
        );
        for (let lineIndex = 0; lineIndex < outlineLines.length; ++lineIndex) {
          const ring = outlineLines[lineIndex];
          if (ring.length < 2) {
            continue;
          }
          const polylineOptions = {
            positions: ring,
            width: evaluatePaintValue(
              styleRule.paint?.["fill-outline-width"],
              metadata,
              zoom,
              1,
            ),
            arcType: styleRule.paint?.arcType ?? Cesium.ArcType.GEODESIC,
          };
          const polyline = useGroundPath
            ? new Cesium.GroundPolylineGeometry(polylineOptions)
            : new Cesium.PolylineGeometry(polylineOptions);
          lineInstances.push(
            new Cesium.GeometryInstance({
              id: this._option.allowPicking ? metadata : undefined,
              geometry: polyline,
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  evaluateColorPaintValue(
                    styleRule.paint?.["fill-outline-color"],
                    metadata,
                    zoom,
                    "#ffffffff",
                  ),
                ),
              },
            }),
          );
        }
      }
    }
    if (lineInstances.length === 0) {
      return [];
    }
    if (useGroundPath) {
      return [this._createGroundPolylinePrimitive(lineInstances)];
    }
    return [this._createPrimitive(lineInstances, "line", {})];
  }

  _filterLinesForStyleRule(lines, styleRule, zoom) {
    if ((lines.metadata?.length ?? 0) === 0 && lines.positions.length > 0) {
      return lines;
    }

    const positions = [];
    const offsets = [0];
    const metadata = [];
    for (let i = 0; i + 1 < lines.offsets.length; ++i) {
      if (!doesStyleRuleMatchMetadata(lines.metadata[i], 2, styleRule, zoom)) {
        continue;
      }
      const start = lines.offsets[i];
      const end = lines.offsets[i + 1];
      for (let j = start * 2; j < end * 2; ++j) {
        positions.push(lines.positions[j]);
      }
      offsets.push(positions.length / 2);
      metadata.push(lines.metadata[i]);
    }
    return {
      positions: new Float64Array(positions),
      offsets: new Uint32Array(offsets),
      metadata,
    };
  }

  _createAppearance(geometryType, style) {
    if (geometryType === "line") {
      return new Cesium.PolylineColorAppearance();
    }
    if (geometryType === "polygon") {
      const fillColor = Cesium.Color.fromCssColorString(
        style.fillColor || "#ff000077",
      );
      return new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: style.translucent ?? fillColor.alpha < 1.0,
        closed: false,
      });
    }
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

function createCartesianRing(polygons, ringIndex, height = 0.0) {
  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cesium.Cartesian3.fromDegrees(
      polygons.positions[i * 2],
      polygons.positions[i * 2 + 1],
      height,
    );
  }
  return positions;
}

function createOutlineCartesianLines(
  polygons,
  ringIndex,
  height = 0.0,
  tileBounds,
) {
  if (!tileBounds) {
    return [
      closeCartesianRing(createCartesianRing(polygons, ringIndex, height)),
    ];
  }

  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const pointCount = getOpenRingPointCount(polygons, start, end);
  if (pointCount < 2) {
    return [];
  }

  const lines = [];
  let currentLine = [];
  for (let i = 0; i < pointCount; ++i) {
    const currentIndex = start + i;
    const nextIndex = start + ((i + 1) % pointCount);
    const currentPoint = getPackedPolygonPoint(polygons, currentIndex);
    const nextPoint = getPackedPolygonPoint(polygons, nextIndex);
    if (isTileBoundarySegment(currentPoint, nextPoint, tileBounds)) {
      if (currentLine.length >= 2) {
        lines.push(currentLine);
      }
      currentLine = [];
      continue;
    }

    if (currentLine.length === 0) {
      currentLine.push(
        Cesium.Cartesian3.fromDegrees(
          currentPoint.longitude,
          currentPoint.latitude,
          height,
        ),
      );
    }
    currentLine.push(
      Cesium.Cartesian3.fromDegrees(
        nextPoint.longitude,
        nextPoint.latitude,
        height,
      ),
    );
  }

  if (currentLine.length >= 2) {
    lines.push(currentLine);
  }
  return lines;
}

function getOpenRingPointCount(polygons, start, end) {
  const pointCount = end - start;
  if (pointCount <= 1) {
    return pointCount;
  }

  const first = getPackedPolygonPoint(polygons, start);
  const last = getPackedPolygonPoint(polygons, end - 1);
  if (first.longitude === last.longitude && first.latitude === last.latitude) {
    return pointCount - 1;
  }
  return pointCount;
}

function getPackedPolygonPoint(polygons, index) {
  return {
    longitude: polygons.positions[index * 2],
    latitude: polygons.positions[index * 2 + 1],
  };
}

function createCartesianLine(lines, lineIndex, height = 0.0) {
  const start = lines.offsets[lineIndex];
  const end = lines.offsets[lineIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cesium.Cartesian3.fromDegrees(
      lines.positions[i * 2],
      lines.positions[i * 2 + 1],
      height,
    );
  }
  return positions;
}

function closeCartesianRing(ring) {
  if (ring.length === 0) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Cesium.Cartesian3.equals(first, last)) {
    return ring;
  }
  return [...ring, first];
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
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
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

function doesStyleRuleMatchMetadata(metadata, geometryType, styleRule, zoom) {
  return (
    doesGeometryTypeMatchStyleRule(geometryType, styleRule.type) &&
    isZoomInRange(zoom, styleRule) &&
    evaluateVectorStyleFilter(styleRule.filter, metadata, { zoom })
  );
}

function evaluateColorPaintValue(value, metadata, zoom, fallback) {
  return Cesium.Color.fromCssColorString(
    evaluatePaintValue(value, metadata, zoom, fallback),
  );
}

function evaluatePaintValue(value, metadata, zoom, fallback) {
  if (!Cesium.defined(value)) {
    return fallback;
  }
  const result = isVectorStyleExpression(value)
    ? evaluateVectorStyleExpression(value, {
        properties: metadata?.properties ?? {},
        id: metadata?.id,
        zoom,
        level: zoom,
      })
    : value;
  return Cesium.defined(result) ? result : fallback;
}

function getAppearanceColor(value, fallback) {
  if (!Cesium.defined(value) || isVectorStyleExpression(value)) {
    return fallback;
  }
  return value;
}

function isVectorStyleExpression(value) {
  return Array.isArray(value) && typeof value[0] === "string";
}

function getStyleRuleHeightOffset(styleRule) {
  const heightOffset = Number(styleRule.terrain?.heightOffset ?? 0.0);
  return Number.isFinite(heightOffset) ? heightOffset : 0.0;
}

function shouldUseGroundPath(styleRule) {
  return (
    styleRule.terrain?.clampToGround === true &&
    getStyleRuleHeightOffset(styleRule) === 0.0
  );
}

function requiresGroundHeightOffsetFallback(styleRule) {
  return (
    styleRule.terrain?.clampToGround === true &&
    getStyleRuleHeightOffset(styleRule) !== 0.0
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
      ? filterPackedLayer(packedLayer, layerStyleRules, zoom, diagnostics)
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

function filterPackedLayer(packedLayer, styleRules, zoom, diagnostics) {
  const points = filterPoints(packedLayer.points, styleRules, zoom);
  const lines = filterLines(packedLayer.lines, styleRules, zoom);
  const polygons = filterPolygons(packedLayer.polygons, styleRules, zoom);
  const positionCount =
    points.positions.length / 2 +
    lines.positions.length / 2 +
    polygons.positions.length / 2;
  const featureCount =
    points.metadata.length + lines.metadata.length + polygons.metadata.length;
  const styleFilteredFeatureCount = Math.max(
    0,
    (packedLayer.featureCount ?? 0) - featureCount,
  );

  if (styleFilteredFeatureCount > 0) {
    diagnostics?.increment("mainThreadStyleFilteredFeatures");
  }

  return {
    ...packedLayer,
    featureCount,
    positionCount,
    styleFilteredFeatureCount:
      (packedLayer.styleFilteredFeatureCount ?? 0) + styleFilteredFeatureCount,
    points,
    lines,
    polygons,
  };
}

function filterPoints(points, styleRules, zoom) {
  const metadata = points.metadata ?? [];
  if (metadata.length === 0 && points.positions.length > 0) {
    return points;
  }

  const positions = [];
  const filteredMetadata = [];
  for (let i = 0; i < points.positions.length / 2; ++i) {
    if (!doesFeatureMatchAnyStyleRule(metadata[i], 1, styleRules, zoom)) {
      continue;
    }
    positions.push(points.positions[i * 2], points.positions[i * 2 + 1]);
    filteredMetadata.push(metadata[i]);
  }
  return {
    positions: new Float64Array(positions),
    metadata: filteredMetadata,
  };
}

function filterLines(lines, styleRules, zoom) {
  const metadata = lines.metadata ?? [];
  if (metadata.length === 0 && lines.positions.length > 0) {
    return lines;
  }

  const positions = [];
  const offsets = [0];
  const filteredMetadata = [];
  for (let i = 0; i + 1 < lines.offsets.length; ++i) {
    if (!doesFeatureMatchAnyStyleRule(metadata[i], 2, styleRules, zoom)) {
      continue;
    }
    const start = lines.offsets[i];
    const end = lines.offsets[i + 1];
    for (let j = start * 2; j < end * 2; ++j) {
      positions.push(lines.positions[j]);
    }
    offsets.push(positions.length / 2);
    filteredMetadata.push(metadata[i]);
  }
  return {
    positions: new Float64Array(positions),
    offsets: new Uint32Array(offsets),
    metadata: filteredMetadata,
  };
}

function filterPolygons(polygons, styleRules, zoom) {
  const metadata = polygons.metadata ?? [];
  if (metadata.length === 0 && polygons.positions.length > 0) {
    return polygons;
  }

  const positions = [];
  const ringOffsets = [0];
  const polygonOffsets = [0];
  const filteredMetadata = [];
  for (let i = 0; i + 1 < polygons.polygonOffsets.length; ++i) {
    if (!doesFeatureMatchAnyStyleRule(metadata[i], 3, styleRules, zoom)) {
      continue;
    }
    const firstRing = polygons.polygonOffsets[i];
    const lastRing = polygons.polygonOffsets[i + 1];
    for (let ringIndex = firstRing; ringIndex < lastRing; ++ringIndex) {
      const start = polygons.ringOffsets[ringIndex];
      const end = polygons.ringOffsets[ringIndex + 1];
      if (end <= start) {
        continue;
      }
      for (let j = start * 2; j < end * 2; ++j) {
        positions.push(polygons.positions[j]);
      }
      ringOffsets.push(positions.length / 2);
    }
    polygonOffsets.push(ringOffsets.length - 1);
    filteredMetadata.push(metadata[i]);
  }
  return {
    positions: new Float64Array(positions),
    ringOffsets: new Uint32Array(ringOffsets),
    polygonOffsets: new Uint32Array(polygonOffsets),
    metadata: filteredMetadata,
  };
}

function doesFeatureMatchAnyStyleRule(
  metadata,
  geometryType,
  styleRules,
  zoom,
) {
  for (let i = 0; i < styleRules.length; ++i) {
    const styleRule = styleRules[i];
    if (!doesGeometryTypeMatchStyleRule(geometryType, styleRule.type)) {
      continue;
    }
    if (!isZoomInRange(zoom, styleRule)) {
      continue;
    }
    if (evaluateVectorStyleFilter(styleRule.filter, metadata, { zoom })) {
      return true;
    }
  }
  return false;
}

function doesGeometryTypeMatchStyleRule(geometryType, styleRuleType) {
  return (
    (geometryType === 1 && styleRuleType === "symbol") ||
    (geometryType === 2 && styleRuleType === "line") ||
    (geometryType === 3 && styleRuleType === "fill")
  );
}

function isZoomInRange(zoom, styleRule) {
  return (
    (styleRule.minzoom === undefined || zoom >= styleRule.minzoom) &&
    (styleRule.maxzoom === undefined || zoom <= styleRule.maxzoom)
  );
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
