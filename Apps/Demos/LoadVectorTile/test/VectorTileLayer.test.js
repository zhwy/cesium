import assert from "node:assert/strict";

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
