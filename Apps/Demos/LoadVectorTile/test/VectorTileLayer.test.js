import assert from "node:assert/strict";
import VectorTilePbfCache from "../src/VectorTilePbfCache.js";

const { default: VectorTileLayer } = await import("../src/VectorTileLayer.js");

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

console.log("VectorTileLayer tests passed.");

function createProvider() {
  return {
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

function createDiagnostics() {
  return {
    gauges: {},
    increment() {},
    addGauge(name, amount) {
      this.gauges[name] = Math.max(0, (this.gauges[name] ?? 0) + amount);
    },
    setGauge(name, value) {
      this.gauges[name] = Math.max(0, value || 0);
    },
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
