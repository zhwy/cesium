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
      addGauge() {},
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

  vectorTile.destroyResources();
  assert.deepEqual(removedTileEntries, ["tile-1:circles", "tile-1:labels"]);
  console.log("✓ destroying a vector tile removes shared point entries first");
}

console.log("VectorTile tests passed.");
