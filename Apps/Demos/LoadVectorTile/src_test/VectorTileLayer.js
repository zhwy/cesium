import * as Cesium from "../../../../Build/CesiumUnminified/index.js";
import VectorTileCoverageState from "./VectorTileCoverageState.js";
import TileType from "./TileType.js";
import VectorTile from "./VectorTile.js";
import TileVectorTile from "./TileVectorTile.js";
import VectorTileDecoder from "./VectorTileDecoder.js";
import VectorTileCache from "./VectorTileCache.js";
import VectorTileTaskScheduler, {
  VectorTileTaskCancelledError,
} from "./VectorTileTaskScheduler.js";

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

      const decodeTask = this._decodeScheduler.schedule(
        () =>
          VectorTileDecoder.instance().decode(arrayBuffer, {
            tile: {
              x: vectorTile.x,
              y: vectorTile.y,
              level: vectorTile.level,
            },
            styledLayerNames: Object.keys(this._styles),
            includeProperties: this._option.allowPicking,
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
            "outOfBoundsPositions",
            counts.outOfBoundsPositions,
          );

          const buildTask = this._buildScheduler.schedule(
            () => this._buildTilePrimitives(vectorTile, decodedTile),
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

  _buildTilePrimitives(vectorTile, decodedTile) {
    if (vectorTile.released) {
      return false;
    }
    const buildStartTime = this._diagnostics?.startTimer();
    vectorTile.primitives = {};
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
    const primitive = new Cesium.Primitive({
      geometryInstances,
      appearance: this._createAppearance(geometryType, style),
      shadows: this._option.shadows,
      allowPicking: this._option.allowPicking,
      asynchronous: this._option.asynchronous,
      releaseGeometryInstances: true,
      compressVertices: true,
    });
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
        translucent: fillColor.alpha < 1.0,
        closed: false,
      });
    }
  }

  setStyles(styles) {
    this._styles = styles || {};
    this._option.styles = this._styles;
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

function createCartesianRing(polygons, ringIndex) {
  const start = polygons.ringOffsets[ringIndex];
  const end = polygons.ringOffsets[ringIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cesium.Cartesian3.fromDegrees(
      polygons.positions[i * 2],
      polygons.positions[i * 2 + 1],
    );
  }
  return positions;
}

function createCartesianLine(lines, lineIndex) {
  const start = lines.offsets[lineIndex];
  const end = lines.offsets[lineIndex + 1];
  const positions = new Array(end - start);
  for (let i = start; i < end; ++i) {
    positions[i - start] = Cesium.Cartesian3.fromDegrees(
      lines.positions[i * 2],
      lines.positions[i * 2 + 1],
    );
  }
  return positions;
}

function countDecodedTile(decodedTile) {
  let features = 0;
  let positions = 0;
  let clippedFeatures = 0;
  let discardedFeatures = 0;
  let outOfBoundsPositions = 0;
  Object.values(decodedTile.layers).forEach((layer) => {
    features += layer.featureCount;
    positions += layer.positionCount;
    clippedFeatures += layer.clippedFeatureCount;
    discardedFeatures += layer.discardedFeatureCount;
    outOfBoundsPositions += layer.outOfBoundsPositionCount;
  });
  return {
    features,
    positions,
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
