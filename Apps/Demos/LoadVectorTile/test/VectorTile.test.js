import assert from "node:assert/strict";

globalThis.Cesium = {
  defined: (value) => value !== undefined && value !== null,
  destroyObject: (value) => value,
  ImageryState: {
    UNLOADED: "unloaded",
    PLACEHOLDER: "placeholder",
  },
};

const { default: VectorTile } = await import("../src/VectorTile.js");

{
  const removedTileEntries = [];
  const gaugeChanges = [];
  let bucketDestroyCount = 0;
  const vectorTileLayer = {
    _vectorTileCache: {
      tileReleased() {},
    },
    vectorTileProvider: {
      minimumLevel: 0,
    },
    sharedPointCollections: {
      removeTileEntries(tileKey) {
        removedTileEntries.push(tileKey);
      },
    },
    _diagnostics: {
      addGauge(name, amount) {
        gaugeChanges.push({ name, amount });
      },
    },
    ready: false,
  };

  const vectorTile = new VectorTile(vectorTileLayer, 1, 2, 0);
  vectorTile.cacheKey = "tile-1";
  vectorTile.pointBuckets = {
    circles: {
      descriptors: {
        billboards: [{ id: 1 }],
        labels: [],
      },
    },
    labels: {
      descriptors: {
        billboards: [],
        labels: [{ text: "A" }],
      },
    },
  };
  vectorTile.features = { demo: [{ properties: { name: "A" } }] };
  vectorTile.residentFeatureTableEntries = 1;
  vectorTile.residentPickPropertyValues = 1;
  vectorTile.buckets = {
    circles: {
      destroy() {
        bucketDestroyCount++;
      },
    },
  };
  vectorTile.primitives = { circles: [] };

  vectorTile.destroyResources();
  assert.deepEqual(removedTileEntries, ["tile-1:circles", "tile-1:labels"]);
  assert.equal(bucketDestroyCount, 1);
  assert.deepEqual(gaugeChanges, [
    { name: "residentFeatureTableEntries", amount: -1 },
    { name: "residentPickPropertyValues", amount: -1 },
  ]);
  console.log("✓ destroying a vector tile removes shared point entries first");
}

{
  const vectorTileLayer = {
    _vectorTileCache: {
      tileReleased() {},
    },
    vectorTileProvider: {
      minimumLevel: 0,
    },
    ready: false,
  };
  const vectorTile = new VectorTile(vectorTileLayer, 1, 2, 0);
  let cancelled = false;
  vectorTile.bucketRebuilds = {
    fill: {
      cancel() {
        cancelled = true;
      },
    },
  };

  vectorTile.cancelPendingTasks();
  assert.equal(cancelled, true);
  console.log("✓ cancelling a vector tile cancels pending bucket rebuilds");
}

console.log("VectorTile tests passed.");
