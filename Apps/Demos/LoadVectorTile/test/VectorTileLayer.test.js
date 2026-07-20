import assert from "node:assert/strict";
import VectorTilePbfCache from "../src/VectorTilePbfCache.js";
import VectorTilePrimitiveBucket from "../src/VectorTilePrimitiveBucket.js";
import VectorTileDecoder from "../src/VectorTileDecoder.js";

const { default: VectorTileLayer } = await import("../src/VectorTileLayer.js");
const getStyleRulesForBuild = VectorTileLayer.getStyleRulesForBuild;
const getStyleRulesForDecode = VectorTileLayer.getStyleRulesForDecode;
const Cesium = await import("../../../../Build/CesiumUnminified/index.js");

{
  const layer = new VectorTileLayer(createProvider(), {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });

  const oldTile = layer.getVectorTileFromCache(1, 2, 0);
  assert.equal(oldTile.contentRevision, 0);
  assert.equal(oldTile.cacheKey, "[0,1,2,0]");
  assert.equal(oldTile.styleDocument.layers[0].paint["fill-color"], "#008800");

  layer.setStyle(createStyleDocument("#cc3300"));
  const newTile = layer.getVectorTileFromCache(1, 2, 0);

  assert.notEqual(newTile, oldTile);
  assert.equal(layer.contentRevision, 1);
  assert.equal(newTile.contentRevision, 1);
  assert.equal(newTile.cacheKey, "[1,1,2,0]");
  assert.equal(oldTile.cacheStale, true);
  assert.equal(oldTile.styleDocument.layers[0].paint["fill-color"], "#008800");
  assert.equal(newTile.styleDocument.layers[0].paint["fill-color"], "#cc3300");
  assert.equal(layer.isCurrentContentRevision(oldTile), false);
  assert.equal(layer.isCurrentContentRevision(newTile), true);
  assert.equal(layer.getCacheStatistics().retiredTiles, 1);

  oldTile.releaseReference();
  newTile.releaseReference();
  layer.destroy();
  console.log(
    "✓ VectorTileLayer isolates cache keys and style snapshots by revision",
  );
}

{
  const layer = new VectorTileLayer(createProvider(), {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });
  const tile = layer.getVectorTileFromCache(1, 2, 0);
  const contentRevision = layer.contentRevision;
  const styleEvents = [];
  let contentEvents = 0;
  layer.styleChangedEvent.addEventListener((_layer, layerId, plan) => {
    styleEvents.push({ layerId, plan });
  });
  layer.changedEvent.addEventListener(() => {
    contentEvents++;
  });

  const style = layer.getStyle();
  style.layers[0].paint["fill-color"] = "#cc3300";
  layer.setStyleLayerAppearance(style, "land-fill", {
    type: "IN_PLACE_APPEARANCE",
  });

  assert.equal(layer.contentRevision, contentRevision);
  assert.equal(layer.getVectorTileFromCache(1, 2, 0), tile);
  assert.equal(layer.getStyleLayerRevision("land-fill"), 1);
  assert.equal(
    layer.getStyleLayerRule("land-fill").paint["fill-color"],
    "#cc3300",
  );
  assert.equal(styleEvents.length, 1);
  assert.equal(contentEvents, 0);
  tile.releaseReference();
  tile.releaseReference();
  layer.destroy();
  console.log("✓ appearance revision does not invalidate tile content");
}

{
  const layer = new VectorTileLayer(createProvider(), {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });
  const tile = layer.getVectorTileFromCache(1, 2, 0);
  let applyCalls = 0;
  tile.buckets = {
    "land-fill": {
      appliedStyleRevision: 0,
      applyStyle(_rule, revision, plan) {
        applyCalls++;
        assert.equal(plan, undefined);
        this.appliedStyleRevision = revision;
        return { instanceUpdates: 1, pointUpdates: 0 };
      },
      destroy() {},
    },
  };
  tile.primitives = {};
  const style = layer.getStyle();
  style.layers[0].paint["fill-color"] = "#ff0000";
  layer.setStyleLayerAppearance(style, "land-fill", {
    type: "IN_PLACE_APPEARANCE",
    changedPaths: ["paint.fill-color"],
  });
  assert.equal(applyCalls, 0);
  assert.equal(tile.styleDocument.layers[0].paint["fill-color"], "#ff0000");

  layer.applyPendingStyleUpdates(tile);
  assert.equal(applyCalls, 1);
  layer.applyPendingStyleUpdates(tile);
  assert.equal(applyCalls, 1);
  tile.releaseReference();
  layer.destroy();
  console.log("✓ offscreen buckets apply the latest style lazily once");
}

{
  const style = createStyleDocument("#008800");
  style.layers.push(
    {
      ...style.layers[0],
      id: "land-detail",
      minzoom: 8,
    },
    {
      ...style.layers[0],
      id: "land-hidden",
      visibility: false,
    },
  );
  style.layers[0].maxzoom = 8;

  assert.deepEqual(
    getStyleRulesForDecode(style, 7).map((rule) => rule.id),
    ["land-fill"],
  );
  assert.deepEqual(
    getStyleRulesForBuild(style, 8).map((rule) => rule.id),
    ["land-detail"],
  );
  console.log("✓ decode and build select only visible build-zoom buckets");
}

{
  const pbfCache = new VectorTilePbfCache({ maximumBytes: 16 });
  await pbfCache.getOrLoad("land/0/0/0", () =>
    resolvedTask(Uint8Array.from([1, 2, 3]).buffer),
  ).promise;
  const provider = createProvider();
  provider._pbfCache = pbfCache;
  const layer = new VectorTileLayer(provider, {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });

  layer.setStyle(createStyleDocument("#cc3300"));
  layer.registerIconImage("marker", {});
  layer.setScene({});
  layer.setRenderBackend("packed");
  layer.show = false;
  layer.show = true;

  assert.equal(pbfCache.length, 1);
  layer.destroy();
  assert.equal(pbfCache.length, 1);
  console.log(
    "✓ layer render invalidation never clears manager-owned PBF data",
  );
}

{
  const layer = new VectorTileLayer(createProvider(), {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });
  const tile = layer.getVectorTileFromCache(1, 2, 0);
  tile.state = Cesium.ImageryState.READY;
  tile.cacheable = true;
  const contentRevision = layer.contentRevision;
  let scheduleCalls = 0;
  layer._scheduleStyleLayerBucketRebuild = () => {
    scheduleCalls++;
    return true;
  };
  tile.releaseReference();

  const style = layer.getStyle();
  style.layers[0].paint["fill-color"] = ["get", "color"];
  layer.setStyleLayerBucketRebuild(style, "land-fill", {
    type: "REBUILD_BUCKET",
    reason: "MISSING_PROPERTIES",
  });

  assert.equal(layer.contentRevision, contentRevision);
  assert.equal(scheduleCalls, 0);
  assert.equal(tile.bucketRebuilds["land-fill"].dirty, true);
  assert.equal(tile.bucketRebuilds["land-fill"].revision, 1);

  tile.addReference();
  layer.applyPendingStyleUpdates(tile);
  assert.equal(scheduleCalls, 1);
  tile.releaseReference();
  layer.destroy();
  console.log("✓ offscreen bucket rebuilds stay dirty until tile reuse");
}

{
  const layer = new VectorTileLayer(createProvider(), {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });
  const tile = layer.getVectorTileFromCache(1, 2, 0);
  tile.state = Cesium.ImageryState.READY;
  tile.buckets = {
    "land-fill": {
      destroy() {
        this.destroyed = true;
      },
    },
  };
  tile.primitives = { "land-fill": [{}] };
  tile.primitiveStyleRules = {
    "land-fill": createStyleDocument("#008800").layers[0],
  };
  tile.pointBuckets = { "land-fill": {} };
  layer.sharedPointCollections.removeTileEntries = (key) => {
    assert.equal(key, `${tile.cacheKey}:land-fill`);
    return true;
  };
  layer._scheduleStyleLayerBucketRebuild = () => true;
  const style = layer.getStyle();
  style.layers[0].paint["fill-color"] = "#cc3300";
  layer.setStyleLayerBucketRebuild(style, "land-fill", {
    type: "REBUILD_BUCKET",
    reason: "RENDER_STATE",
  });

  const replacement = new VectorTilePrimitiveBucket(style.layers[0], {
    diagnostics: createDiagnostics(),
    vectorTile: tile,
    styleRevision: 1,
  });
  const primitive = {
    ready: true,
    isDestroyed() {
      return false;
    },
    destroy() {},
  };
  replacement.addPrimitive(primitive, "fill", [0]);
  const rebuild = tile.bucketRebuilds["land-fill"];
  rebuild.replacementBucket = replacement;

  assert.equal(
    layer._commitStyleLayerBucketReplacement(tile, "land-fill", rebuild),
    true,
  );
  assert.equal(tile.buckets["land-fill"], replacement);
  assert.deepEqual(tile.primitives["land-fill"], [primitive]);
  assert.equal(tile.builtStyleLayerIds.has("land-fill"), true);
  assert.equal(tile.bucketRebuilds["land-fill"], undefined);
  tile.releaseReference();
  layer.destroy();
  console.log("✓ bucket replacement swaps only the target style layer");
}

{
  const diagnostics = createDiagnostics();
  const pbfCache = new VectorTilePbfCache({
    maximumBytes: 1024,
    diagnostics,
  });
  let loadCalls = 0;
  await pbfCache.getOrLoad("land/1/2/0", () => {
    loadCalls++;
    return resolvedTask(Uint8Array.from([9, 9, 9]).buffer);
  }).promise;

  const provider = createProvider({
    sourceId: "land",
    requestTile(tile) {
      return pbfCache.getOrLoad(
        `land/${tile.x}/${tile.y}/${tile.level}`,
        () => {
          loadCalls++;
          return resolvedTask(Uint8Array.from([1, 2, 3]).buffer);
        },
        tile.priority,
      );
    },
  });
  const decoder = VectorTileDecoder.instance();
  const originalDecode = decoder.decode;
  let decodeOptions;
  decoder.decode = async (_arrayBuffer, options) => {
    decodeOptions = options;
    return createDecodedPointTile();
  };

  const layer = new VectorTileLayer(provider, {
    scene: {},
    styleDocument: createCircleStyleDocument(false),
    diagnostics,
    allowPicking: true,
    asynchronous: false,
  });
  const tile = layer.getVectorTileFromCache(1, 2, 0);
  tile.state = Cesium.ImageryState.READY;
  tile.cacheable = true;
  tile.builtStyleLayerIds = new Set();
  tile.buckets = {};
  tile.primitives = {};
  tile.primitiveStyleRules = {};
  tile.pointBuckets = {};

  layer.setStyleLayerBucketRebuild(
    createCircleStyleDocument(true),
    "land-circle",
    {
      type: "REBUILD_BUCKET",
      reason: "MISSING_BUCKET",
    },
  );
  await flushPromises(20);

  assert.equal(loadCalls, 1);
  assert.equal(diagnostics.counters.pbfCacheHits, 1);
  assert.deepEqual(decodeOptions.styledLayerNames, ["land"]);
  assert.deepEqual(
    decodeOptions.styleRules.map((rule) => rule.id),
    ["land-circle"],
  );
  assert.ok(tile.pointBuckets["land-circle"]);
  assert.equal(tile.bucketRebuilds["land-circle"], undefined);

  decoder.decode = originalDecode;
  tile.releaseReference();
  layer.destroy();
  console.log("✓ bucket rebuild reuses ready PBF and decodes one style rule");
}

{
  const layer = new VectorTileLayer(createProvider(), {
    scene: {},
    styleDocument: createStyleDocument("#008800"),
    diagnostics: createDiagnostics(),
  });
  const tile = layer.getVectorTileFromCache(1, 2, 0);
  tile.state = Cesium.ImageryState.READY;
  layer._scheduleStyleLayerBucketRebuild = () => true;
  let replacementDestroyed = false;
  const style = layer.getStyle();
  style.layers[0].paint["fill-color"] = "#cc3300";
  layer.setStyleLayerBucketRebuild(style, "land-fill", {
    type: "REBUILD_BUCKET",
  });
  const staleRebuild = tile.bucketRebuilds["land-fill"];
  staleRebuild.replacementBucket = {
    length: 1,
    destroy() {
      replacementDestroyed = true;
    },
  };
  layer.setStyleLayerAppearance(createStyleDocument("#0000ff"), "land-fill", {
    type: "IN_PLACE_APPEARANCE",
  });

  assert.equal(
    layer._commitStyleLayerBucketReplacement(tile, "land-fill", staleRebuild),
    false,
  );
  assert.equal(replacementDestroyed, true);
  assert.equal(tile.buckets?.["land-fill"], undefined);
  tile.releaseReference();
  layer.destroy();
  console.log("✓ stale bucket replacement results are discarded");
}

console.log("VectorTileLayer tests passed.");

function createProvider(overrides = {}) {
  return {
    sourceId: "land",
    minimumLevel: 0,
    maximumLevel: 18,
    tilingScheme: {
      tileXYToRectangle(x, y, level) {
        return { x, y, level };
      },
    },
    isTileAvailable() {
      return true;
    },
    requestTile() {
      return undefined;
    },
    ...overrides,
  };
}

function createStyleDocument(color) {
  return {
    version: 1,
    sources: {
      land: {
        type: "vector",
      },
    },
    layers: [
      {
        id: "land-fill",
        type: "fill",
        source: "land",
        sourceLayer: "land",
        paint: {
          "fill-color": color,
        },
      },
    ],
  };
}

function createCircleStyleDocument(visible) {
  return {
    version: 1,
    sources: {
      land: {
        type: "vector",
      },
    },
    layers: [
      {
        id: "land-circle",
        type: "circle",
        source: "land",
        sourceLayer: "land",
        visibility: visible,
        paint: {
          "circle-color": "#008800",
          "circle-radius": 4,
        },
      },
    ],
  };
}

function createDecodedPointTile() {
  return {
    layers: {
      land: {
        featureCount: 1,
        positionCount: 1,
        clippedFeatureCount: 0,
        discardedFeatureCount: 0,
        outOfBoundsPositionCount: 0,
        styleFilteredFeatureCount: 0,
        features: [
          {
            id: 7,
            sourceFeatureIndex: 0,
            properties: { name: "A" },
          },
        ],
        points: {
          positions: new Float64Array([0, 0]),
          featureIndices: new Uint32Array([0]),
        },
        lines: {
          positions: new Float64Array(),
          offsets: new Uint32Array([0]),
          featureIndices: new Uint32Array(),
        },
        polygons: {
          positions: new Float64Array(),
          ringOffsets: new Uint32Array([0]),
          polygonOffsets: new Uint32Array([0]),
          featureIndices: new Uint32Array(),
        },
      },
    },
  };
}

function createDiagnostics() {
  return {
    counters: {},
    gauges: {},
    increment(name, amount = 1) {
      this.counters[name] = (this.counters[name] ?? 0) + amount;
    },
    startTimer() {
      return undefined;
    },
    recordDuration() {},
    addGauge(name, amount) {
      this.gauges[name] = Math.max(0, (this.gauges[name] ?? 0) + amount);
    },
    setGauge(name, value) {
      this.gauges[name] = Math.max(0, value || 0);
    },
  };
}

async function flushPromises(count) {
  for (let i = 0; i < count; ++i) {
    await Promise.resolve();
  }
}

function resolvedTask(value) {
  return {
    promise: Promise.resolve(value),
    cancel() {},
    setPriority() {},
    cancelled: false,
  };
}
