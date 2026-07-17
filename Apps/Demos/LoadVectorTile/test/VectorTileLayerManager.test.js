import assert from "node:assert/strict";

const { default: VectorTileLayerManager } =
  await import("../src/VectorTileLayerManager.js");

{
  const provider = createProviderStub("land", [
    createFillRule("land-fill", "land"),
  ]);
  const runtimeLayer = createRuntimeLayer(provider);
  const manager = createManager([provider], [runtimeLayer]);

  manager.addLayer("land", {
    id: "land-line",
    type: "line",
    sourceLayer: "countries",
    paint: {
      "line-width": 2,
    },
  });

  assert.equal(runtimeLayer.setStyleCalls.length, 1);
  const updated = runtimeLayer.setStyleCalls[0];
  assert.deepEqual(
    updated.layers.map((layer) => layer.id),
    ["land-fill", "land-line"],
  );
  assert.equal(updated.sources.land.url, "https://example.com/{z}/{x}/{y}.pbf");
  console.log(
    "✓ addLayer appends a style layer to the runtime layer that owns the source",
  );
}

{
  const provider = createProviderStub("land", [
    createFillRule("land-fill", "land"),
  ]);
  const collection = createLayerCollection([]);
  const runtimeLayer = createRuntimeLayer(provider);
  collection.addLayerProvider = (createdProvider, index) => {
    collection.addLayerProviderCalls.push({ createdProvider, index });
    collection._layers.push(runtimeLayer);
    return runtimeLayer;
  };
  collection.addLayerProviderCalls = [];
  const manager = Object.create(VectorTileLayerManager.prototype);
  manager._providersBySourceId = new Map();
  manager._vectorTileLayers = collection;
  manager._diagnostics = {};
  manager._pbfCache = {};
  manager._networkScheduler = {};
  manager._decodeScheduler = {};
  manager._buildScheduler = {};
  manager._scene = {};
  manager._iconImages = {};

  const addedLayer = manager.addLayerProvider(provider, 2);

  assert.equal(addedLayer, runtimeLayer);
  assert.equal(manager.getProvider("land"), provider);
  assert.equal(collection.addLayerProviderCalls.length, 1);
  assert.equal(collection.addLayerProviderCalls[0].createdProvider, provider);
  assert.equal(collection.addLayerProviderCalls[0].index, 2);
  assert.equal(provider._options.sourceId, "land");
  assert.ok(provider._options.styleDocument);
  assert.equal(provider._options.pbfCache, manager._pbfCache);
  assert.equal(provider._pbfCache, manager._pbfCache);
  console.log(
    "✓ addLayerProvider registers provider state and forwards to the collection",
  );
}

{
  const manager = new VectorTileLayerManager({ pbfCacheBytes: 7 });
  assert.equal(manager.pbfCache.maximumBytes, 7);
  assert.throws(
    () => new VectorTileLayerManager({ pbfCacheBytes: -1 }),
    /finite/,
  );
  manager.removeFromScene();
  console.log("✓ manager owns and validates the shared PBF cache budget");
}

{
  const manager = new VectorTileLayerManager({ pbfCacheBytes: 7 });
  const deferred = createDeferredTask();
  const consumer = manager.pbfCache.getOrLoad(
    "pending-before-clear",
    () => deferred.handle,
  );
  manager.clearPbfCache();
  deferred.resolve(Uint8Array.from([1, 2]).buffer);
  assert.deepEqual([...new Uint8Array(await consumer.promise)], [1, 2]);
  assert.equal(manager.pbfCache.length, 0);
  manager.removeFromScene();
  console.log("✓ manager clear prevents old pending PBF refill");
}

{
  const manager = new VectorTileLayerManager({
    pbfCacheBytes: 16,
    diagnostics: true,
  });
  const style = {
    version: 1,
    sources: {
      land: {
        type: "vector",
        url: "https://example.com/{z}/{x}/{y}.pbf",
      },
    },
    layers: [createFillRule("land-fill", "land")],
  };
  const tile = { x: 1, y: 2, level: 3, priority: 0 };
  manager.setStyle(style);
  const originalProvider = manager.getProvider("land");
  const originalResource = originalProvider.getTileResource(tile);
  const originalKey = originalProvider.getPbfCacheKey(tile, originalResource);
  await manager.pbfCache.getOrLoad(originalKey, () =>
    resolvedTask(Uint8Array.from([4, 5, 6]).buffer),
  ).promise;

  const runtimeLayer = manager.vectorTileLayers.get(0);
  const originalRevision = runtimeLayer.contentRevision;
  manager.clearPbfCache();
  assert.equal(manager.pbfCache.length, 0);
  assert.equal(runtimeLayer.contentRevision, originalRevision);

  await manager.pbfCache.getOrLoad(originalKey, () =>
    resolvedTask(Uint8Array.from([4, 5, 6]).buffer),
  ).promise;
  manager.setStyle(style);
  const replacementProvider = manager.getProvider("land");
  const replacementKey = replacementProvider.getPbfCacheKey(
    tile,
    replacementProvider.getTileResource(tile),
  );
  const reused = await replacementProvider.requestTile(tile).promise;
  assert.equal(replacementKey, originalKey);
  assert.deepEqual([...new Uint8Array(reused)], [4, 5, 6]);

  manager.clearCache();
  assert.equal(manager.pbfCache.length, 0);
  assert.equal(
    manager.vectorTileLayers.get(0).contentRevision,
    originalRevision + 1,
  );
  manager.removeAll();
  manager.removeFromScene();
  console.log(
    "✓ raw-only clear preserves render state and setStyle reuses unchanged source PBF",
  );
}

{
  const manager = createManager([], []);

  assert.throws(
    () =>
      manager.addLayer("missing", {
        id: "missing-fill",
        type: "fill",
        sourceLayer: "countries",
      }),
    /does not exist/,
  );
  console.log("✓ addLayer rejects unknown source providers");
}

{
  const provider = createProviderStub("org", [
    createFillRule("org-fill", "org"),
    createLineRule("org-line", "org"),
  ]);
  const runtimeLayer = createRuntimeLayer(provider);
  const manager = createManager([provider], [runtimeLayer]);

  assert.equal(manager.getProvider("org"), provider);
  assert.equal(manager.getProvider("missing"), undefined);
  assert.equal(manager.removeLayer("org-fill"), true);
  assert.equal(runtimeLayer.setStyleCalls.length, 1);
  assert.deepEqual(
    runtimeLayer.setStyleCalls[0].layers.map((layer) => layer.id),
    ["org-line"],
  );
  assert.equal(manager._providersBySourceId.get("org"), provider);
  assert.equal(manager._vectorTileLayers.removeCalls.length, 0);
  console.log(
    "✓ remove one style layer keeps the shared source provider active",
  );
}

{
  const provider = createProviderStub("org", [
    createFillRule("org-fill", "org"),
  ]);
  const runtimeLayer = createRuntimeLayer(provider);
  const manager = createManager([provider], [runtimeLayer]);

  assert.equal(manager.removeLayer("org-fill"), true);
  assert.equal(manager.getProvider("org"), undefined);
  assert.equal(manager._vectorTileLayers.removeCalls.length, 1);
  assert.equal(manager._vectorTileLayers.removeCalls[0].layer, runtimeLayer);
  console.log("✓ remove final style layer tears down the runtime layer");
}

{
  const provider = createProviderStub("org", [
    createFillRule("org-fill", "org"),
  ]);
  const runtimeLayer = createRuntimeLayer(provider);
  const manager = createManager([provider], [runtimeLayer]);

  assert.equal(manager.removeLayer("missing"), false);
  assert.equal(runtimeLayer.setStyleCalls.length, 0);
  assert.equal(manager.getProvider("org"), provider);
  console.log("✓ removeLayer leaves providers unchanged for unknown ids");
}

{
  const fillRule = createFillRule("org-fill", "org");
  fillRule.paint = {
    "fill-color": "#000000",
    "fill-opacity": 0.5,
  };
  fillRule.metadata = {
    state: {
      selected: false,
      category: "country",
    },
  };
  const provider = createProviderStub("org", [fillRule]);
  const runtimeLayer = createRuntimeLayer(provider);
  const manager = createManager([provider], [runtimeLayer]);

  assert.equal(
    manager.setLayerStyle("org-fill", {
      paint: {
        "fill-color": "#ff0000",
      },
      metadata: {
        state: {
          selected: true,
        },
      },
    }),
    true,
  );
  assert.equal(runtimeLayer.setStyleCalls.length, 1);
  assert.deepEqual(runtimeLayer.setStyleCalls[0].layers[0], {
    ...fillRule,
    paint: {
      "fill-color": "#ff0000",
      "fill-opacity": 0.5,
    },
    metadata: {
      state: {
        selected: true,
        category: "country",
      },
    },
  });
  console.log("✓ setLayerStyle recursively merges a partial layer style");
}

{
  const provider = createProviderStub("org", [
    createFillRule("org-fill", "org"),
  ]);
  const runtimeLayer = createRuntimeLayer(provider);
  const manager = createManager([provider], [runtimeLayer]);
  const replacement = {
    id: "org-fill",
    type: "line",
    source: "org",
    sourceLayer: "borders",
    paint: {
      "line-width": 3,
    },
  };

  assert.equal(manager.setLayerStyle("org-fill", replacement, false), true);
  assert.deepEqual(runtimeLayer.setStyleCalls[0].layers[0], replacement);
  assert.equal(manager.setLayerStyle("missing", replacement), false);
  assert.equal(runtimeLayer.setStyleCalls.length, 1);
  console.log("✓ setLayerStyle supports replacement and unknown layer ids");
}

{
  const manager = new VectorTileLayerManager();
  const calls = {
    invalidate: 0,
    clear: 0,
    remove: 0,
  };
  manager._quadtreePrimitive.invalidateAllTiles = () => {
    calls.invalidate++;
  };
  manager._quadtreePrimitive.clearLayerRenderState = () => {
    calls.clear++;
  };
  manager._quadtreePrimitive.removeLayerRenderState = () => {
    calls.remove++;
  };
  const layer = {};

  manager._vectorTileLayers.layerChanged.raiseEvent(layer, 0);
  assert.equal(calls.invalidate, 1);
  assert.equal(calls.clear, 0);

  manager._vectorTileLayers.layerShownOrHidden.raiseEvent(layer, 0, false);
  assert.equal(calls.invalidate, 1);
  assert.equal(calls.clear, 0);

  manager._vectorTileLayers.layerShownOrHidden.raiseEvent(layer, 0, true);
  assert.equal(calls.invalidate, 2);
  assert.equal(calls.clear, 0);

  manager._vectorTileLayers.layerRemoved.raiseEvent(layer, 0);
  assert.equal(calls.invalidate, 3);
  assert.equal(calls.remove, 1);
  manager.removeFromScene();
  console.log(
    "✓ manager preserves committed render state for refresh and hide",
  );
}

console.log("VectorTileLayerManager tests passed.");

function createManager(providers, runtimeLayers) {
  const manager = Object.create(VectorTileLayerManager.prototype);
  manager._providersBySourceId = new Map(
    providers.map((provider) => [provider.sourceId, provider]),
  );
  manager._vectorTileLayers = createLayerCollection(runtimeLayers);
  return manager;
}

function createLayerCollection(layers) {
  return {
    _layers: layers.slice(),
    removeCalls: [],
    get length() {
      return this._layers.length;
    },
    get(index) {
      return this._layers[index];
    },
    remove(layer, destroy = true) {
      this.removeCalls.push({ layer, destroy });
      const index = this._layers.indexOf(layer);
      if (index === -1) {
        return false;
      }
      this._layers.splice(index, 1);
      return true;
    },
  };
}

// The runtime layer owns the style document; the provider is a pure data
// source. The stub mirrors that split: getStyle/setStyle back a single
// mutable document, and the provider carries only source + bootstrap state.
function createRuntimeLayer(provider) {
  return {
    vectorTileProvider: provider,
    setStyleCalls: [],
    _styleDocument: cloneDocument(provider._options.styleDocument),
    getStyle() {
      return this._styleDocument;
    },
    setStyle(styleDocument) {
      this.setStyleCalls.push(styleDocument);
      this._styleDocument = styleDocument;
    },
  };
}

function createProviderStub(sourceId, layers = []) {
  const source = {
    type: "vector",
    url: "https://example.com/{z}/{x}/{y}.pbf",
  };
  return {
    sourceId,
    source,
    _options: {
      styleDocument: {
        version: 1,
        sources: {
          [sourceId]: { ...source },
        },
        layers: layers.map((rule) => ({ ...rule })),
        metadata: {},
      },
    },
  };
}

function cloneDocument(styleDocument) {
  return JSON.parse(JSON.stringify(styleDocument));
}

function createFillRule(id, source) {
  return {
    id,
    type: "fill",
    source,
    sourceLayer: "countries",
  };
}

function createLineRule(id, source) {
  return {
    id,
    type: "line",
    source,
    sourceLayer: "countries",
  };
}

function resolvedTask(value) {
  return {
    promise: Promise.resolve(value),
    cancel() {},
    setPriority() {},
    cancelled: false,
  };
}

function createDeferredTask() {
  let resolve;
  const handle = {
    promise: new Promise((resolvePromise) => {
      resolve = resolvePromise;
    }),
    cancel() {},
    setPriority() {},
    cancelled: false,
  };
  return { handle, resolve };
}
