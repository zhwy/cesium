import assert from "node:assert/strict";

const Cesium = await import("../../../../Build/CesiumUnminified/index.js");
const { default: VectorTileQuadtreePrimitive } =
  await import("../src/VectorTileQuadtreePrimitive.js");
const { default: SharedPointCollections } =
  await import("../src/SharedPointCollections.js");
const createSharedPointEntryKey =
  SharedPointCollections.createSharedPointEntryKey;

{
  const primitive = createPrimitiveForTest();
  const sharedPointCollections = createSharedPointCollectionsSpy();
  const layer = {
    _show: true,
    sharedPointCollections,
    getFrameStyleZoom: () => 3,
  };
  const tile = createTile("tile-zoom", {
    id: "labels",
    type: "symbol",
    minzoom: 2,
    maxzoom: 4,
  });
  const state = primitive._getOrCreateLayerState(layer);
  state.committedRenderSet = new Set([tile]);
  const entryKey = createSharedPointEntryKey(tile, "labels");

  primitive._syncLayerPointCollections(layer, state);
  assert.deepEqual(sharedPointCollections.adds, [entryKey]);
  assert.equal(sharedPointCollections.entries.has(entryKey), true);

  layer.getFrameStyleZoom = () => 5;
  primitive._syncLayerPointCollections(layer, state);
  assert.deepEqual(sharedPointCollections.removes, []);
  assert.deepEqual(sharedPointCollections.adds, [entryKey]);
  assert.deepEqual(sharedPointCollections.updates, []);
  assert.equal(sharedPointCollections.entries.has(entryKey), true);

  tile.pointBuckets.labels.styleRevision = 1;
  tile.pointBuckets.labels.updateProperties = ["show"];
  primitive._syncLayerPointCollections(layer, state);
  assert.deepEqual(sharedPointCollections.updates, [
    { tileKey: entryKey, properties: ["show"] },
  ]);
  console.log("✓ ancestor point buckets keep their build-zoom style");
}

{
  const primitive = createPrimitiveForTest();
  primitive._tilesToRender = [];
  const sharedPointCollections = createSharedPointCollectionsSpy();
  const layer = {
    _show: true,
    sharedPointCollections,
  };
  const renderPrimitive = createWarmablePrimitive(true);
  renderPrimitive.seenShows = [];
  renderPrimitive.update = function () {
    this.updateCalls++;
    this.seenShows.push(this.show);
  };
  const tile = {
    primitives: { hidden: [renderPrimitive] },
    buckets: {
      hidden: {
        styleRule: { visibility: false },
      },
    },
  };
  const state = primitive._getOrCreateLayerState(layer);
  state.committedRenderSet = new Set([tile]);

  primitive.renderTiles({
    passes: { render: false, pick: true },
    commandList: [],
  });
  assert.deepEqual(renderPrimitive.seenShows, [false]);
  console.log("✓ render submission preserves bucket-level visibility");
}

{
  const primitive = createPrimitiveForTest();
  const sharedPointCollections = createSharedPointCollectionsSpy();
  const layer = {
    _show: true,
    sharedPointCollections,
    getFrameStyleZoom: () => 3,
  };
  const parentTile = createTile("tile-parent", {
    id: "circles",
    type: "circle",
  });
  const childTile = createTile("tile-child", {
    id: "circles",
    type: "circle",
  });
  const state = primitive._getOrCreateLayerState(layer);
  const parentKey = createSharedPointEntryKey(parentTile, "labels");

  primitive._commitRenderSet(state, [parentTile]);
  primitive._syncLayerPointCollections(layer, state, 3);
  assert.equal(parentTile.addReferenceCalls, 1);
  assert.equal(parentTile.releaseReferenceCalls, 0);
  assert.equal(sharedPointCollections.entries.has(parentKey), true);

  primitive._commitRenderSet(state, [parentTile, childTile]);
  primitive._syncLayerPointCollections(layer, state, 3);
  assert.equal(parentTile.releaseReferenceCalls, 0);
  assert.equal(childTile.addReferenceCalls, 1);
  assert.equal(sharedPointCollections.entries.has(parentKey), true);

  primitive._commitRenderSet(state, [childTile]);
  primitive._syncLayerPointCollections(layer, state, 3);
  assert.equal(parentTile.releaseReferenceCalls, 1);
  assert.equal(sharedPointCollections.entries.has(parentKey), false);
  console.log("✓ retained committed tiles keep shared point entries alive");
}

{
  const primitive = createPrimitiveForTest();
  const sharedPointCollections = createSharedPointCollectionsSpy();
  const layer = {
    _show: true,
    sharedPointCollections,
    getFrameStyleZoom: () => 3,
  };
  const oldTile = createTile("[0,0,0,0]", {
    id: "labels",
    type: "symbol",
  });
  const newTile = createTile("[1,0,0,0]", {
    id: "labels",
    type: "symbol",
  });
  const state = primitive._getOrCreateLayerState(layer);
  const oldKey = createSharedPointEntryKey(oldTile, "labels");
  const newKey = createSharedPointEntryKey(newTile, "labels");

  primitive._commitRenderSet(state, [oldTile, newTile]);
  primitive._syncLayerPointCollections(layer, state, 3);
  assert.equal(sharedPointCollections.entries.has(oldKey), true);
  assert.equal(sharedPointCollections.entries.has(newKey), true);

  primitive._commitRenderSet(state, [newTile]);
  primitive._syncLayerPointCollections(layer, state, 3);
  assert.equal(sharedPointCollections.entries.has(oldKey), false);
  assert.equal(sharedPointCollections.entries.has(newKey), true);
  console.log("✓ shared point entries are isolated by revisioned cache keys");
}

{
  const primitive = createPrimitiveForTest();
  const events = [];
  const sharedPointCollections = createSharedPointCollectionsSpy();
  const originalAddTileEntries = sharedPointCollections.addTileEntries;
  const originalRemoveTileEntries = sharedPointCollections.removeTileEntries;
  sharedPointCollections.addTileEntries = function (tileKey, descriptors) {
    events.push(`add:${tileKey}`);
    return originalAddTileEntries.call(this, tileKey, descriptors);
  };
  sharedPointCollections.removeTileEntries = function (tileKey) {
    events.push(`remove:${tileKey}`);
    return originalRemoveTileEntries.call(this, tileKey);
  };
  const layer = {
    _show: true,
    sharedPointCollections,
    getFrameStyleZoom: () => 3,
  };
  const oldTile = createTile("[0,0,0,0]", {
    id: "labels",
    type: "symbol",
  });
  const newTile = createTile("[1,0,0,0]", {
    id: "labels",
    type: "symbol",
  });
  const state = primitive._getOrCreateLayerState(layer);
  const oldKey = createSharedPointEntryKey(oldTile, "labels");
  const newKey = createSharedPointEntryKey(newTile, "labels");

  primitive._commitRenderSet(state, [oldTile]);
  primitive._syncLayerPointCollections(layer, state, 3);
  events.length = 0;
  oldTile.releaseReference = function () {
    events.push("release-old");
  };

  primitive._commitRenderSet(state, [newTile], () =>
    primitive._syncLayerPointCollections(layer, state, 3),
  );

  assert.deepEqual(events, [
    `add:${newKey}`,
    `remove:${oldKey}`,
    "release-old",
  ]);
  assert.equal(sharedPointCollections.entries.has(newKey), true);
  console.log("✓ shared point entries switch before retired tiles release");
}

{
  const primitive = createPrimitiveForTest();
  const diagnostics = createDiagnosticsSpy();
  primitive._diagnostics = diagnostics;
  primitive._warmupTilesPerFrame = 4;
  const oldTile = createTile("[0,0,0,0]", {
    id: "fill",
    type: "fill",
  });
  oldTile.contentRevision = 0;
  oldTile.state = Cesium.ImageryState.READY;
  const warmingPrimitive = createWarmablePrimitive(false);
  const currentTile = createTile("[1,0,0,0]", {
    id: "fill",
    type: "fill",
  });
  currentTile.contentRevision = 1;
  currentTile.state = Cesium.ImageryState.READY;
  currentTile.primitives = {
    fill: [warmingPrimitive],
  };
  currentTile.pointBuckets = {};
  const layer = {
    _show: true,
    contentRevision: 1,
    sharedPointCollections: createSharedPointCollectionsSpy(),
    getFrameStyleZoom: () => 3,
    isCurrentContentRevision(tile) {
      return tile.contentRevision === this.contentRevision;
    },
    getCacheStatistics() {
      return {
        retiredTiles: 1,
        staleTiles: 1,
      };
    },
  };
  oldTile.vectorTileLayer = layer;
  currentTile.vectorTileLayer = layer;
  primitive._tileProvider = {
    vectorTileLayers: {
      length: 1,
      get() {
        return layer;
      },
    },
  };
  const state = primitive._getOrCreateLayerState(layer);
  state.committedRenderSet = new Set([oldTile]);
  primitive._tilesToRender = [
    {
      data: {
        tileVectorTiles: [
          {
            loadingVectorTile: currentTile,
            readyVectorTile: currentTile,
          },
        ],
      },
    },
  ];

  primitive.renderTiles({
    passes: {
      render: true,
      pick: false,
    },
    commandList: [],
  });

  assert.equal(state.committedRenderSet.has(oldTile), true);
  assert.equal(state.committedRenderSet.has(currentTile), false);
  assert.equal(warmingPrimitive.updateCalls, 1);
  assert.equal(diagnostics.gauges.refreshRetainedTiles, 1);
  assert.equal(diagnostics.gauges.retiredResidentTiles, 1);
  console.log(
    "✓ current revision waits for drawable primitives before takeover",
  );
}

{
  const primitive = createPrimitiveForTest();
  primitive._warmupTilesPerFrame = 4;
  const rootFallback = createTile("[1,0,0,0]", {
    id: "circles",
    type: "circle",
  });
  rootFallback.contentRevision = 1;
  const emptyExact = createTile("[1,0,0,1]", {
    id: "circles",
    type: "circle",
  });
  emptyExact.x = 0;
  emptyExact.y = 0;
  emptyExact.level = 1;
  emptyExact.contentRevision = 1;
  emptyExact.coverageComplete = true;
  emptyExact.pointBuckets = {};
  const detailedExact = createTile("[1,1,0,1]", {
    id: "circles",
    type: "circle",
  });
  detailedExact.x = 1;
  detailedExact.y = 0;
  detailedExact.level = 1;
  detailedExact.contentRevision = 1;
  detailedExact.coverageComplete = true;
  const layer = createRenderableLayer(1);
  rootFallback.vectorTileLayer = layer;
  emptyExact.vectorTileLayer = layer;
  detailedExact.vectorTileLayer = layer;
  primitive._tileProvider = createTileProvider(layer);
  primitive._tilesToRender = [
    createQuadtreeTile(emptyExact, rootFallback),
    createQuadtreeTile(undefined, detailedExact),
  ];

  primitive.renderTiles({
    passes: {
      render: true,
      pick: false,
    },
    commandList: [],
  });

  const state = primitive._getOrCreateLayerState(layer);
  assert.equal(state.committedRenderSet.has(rootFallback), false);
  assert.equal(state.committedRenderSet.has(emptyExact), true);
  assert.equal(state.committedRenderSet.has(detailedExact), true);
  console.log("✓ ready-empty exact tiles displace broad ancestor fallbacks");
}

console.log("VectorTileQuadtreePrimitive tests passed.");

function createPrimitiveForTest() {
  const primitive = Object.create(VectorTileQuadtreePrimitive.prototype);
  primitive._layerRenderStates = new Map();
  primitive._diagnostics = undefined;
  return primitive;
}

function createTile(cacheKey, styleRule) {
  return {
    cacheKey,
    x: 0,
    y: 0,
    level: 0,
    state: Cesium.ImageryState.READY,
    contentRevision: 0,
    primitives: {},
    pointBuckets: {
      labels: {
        styleRule,
        descriptors: {
          billboards: [{ id: `${cacheKey}-billboard` }],
          labels: [],
        },
      },
    },
    addReferenceCalls: 0,
    releaseReferenceCalls: 0,
    addReference() {
      this.addReferenceCalls++;
    },
    releaseReference() {
      this.releaseReferenceCalls++;
    },
  };
}

function createWarmablePrimitive(ready) {
  return {
    ready,
    show: true,
    updateCalls: 0,
    update() {
      this.updateCalls++;
    },
  };
}

function createDiagnosticsSpy() {
  return {
    gauges: {},
    startTimer() {
      return 0;
    },
    setGauge(name, value) {
      this.gauges[name] = value;
    },
    recordDuration() {},
    recordRenderPass() {},
  };
}

function createRenderableLayer(contentRevision) {
  return {
    _show: true,
    contentRevision,
    sharedPointCollections: createSharedPointCollectionsSpy(),
    getFrameStyleZoom: () => 3,
    isCurrentContentRevision(tile) {
      return tile.contentRevision === this.contentRevision;
    },
    getCacheStatistics() {
      return {};
    },
  };
}

function createTileProvider(layer) {
  return {
    vectorTileLayers: {
      length: 1,
      get() {
        return layer;
      },
    },
  };
}

function createQuadtreeTile(loadingVectorTile, readyVectorTile) {
  return {
    data: {
      tileVectorTiles: [
        {
          loadingVectorTile,
          readyVectorTile,
        },
      ],
    },
  };
}

function createSharedPointCollectionsSpy() {
  return {
    entries: new Map(),
    adds: [],
    removes: [],
    updates: [],
    addTileEntries(tileKey, descriptors) {
      this.entries.set(tileKey, descriptors);
      this.adds.push(tileKey);
      return true;
    },
    removeTileEntries(tileKey) {
      const hadEntries = this.entries.delete(tileKey);
      if (hadEntries) {
        this.removes.push(tileKey);
      }
      return hadEntries;
    },
    updateTileEntries(tileKey, descriptors, properties) {
      this.entries.set(tileKey, descriptors);
      this.updates.push({ tileKey, properties });
      return true;
    },
    hasTileEntries(tileKey) {
      return this.entries.has(tileKey);
    },
    getPrimitives() {
      return [];
    },
  };
}
