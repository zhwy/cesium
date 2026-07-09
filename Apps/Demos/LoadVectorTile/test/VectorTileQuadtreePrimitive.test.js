import assert from "node:assert/strict";

const { default: VectorTileQuadtreePrimitive } =
  await import("../src/VectorTileQuadtreePrimitive.js");
const { createSharedPointEntryKey } =
  await import("../src/SharedPointCollections.js");

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

  primitive._syncLayerPointCollections(layer, state, 3);
  assert.deepEqual(sharedPointCollections.adds, [entryKey]);
  assert.equal(sharedPointCollections.entries.has(entryKey), true);

  primitive._syncLayerPointCollections(layer, state, 4);
  assert.deepEqual(sharedPointCollections.removes, [entryKey]);
  assert.equal(sharedPointCollections.entries.has(entryKey), false);

  primitive._syncLayerPointCollections(layer, state, 3);
  assert.deepEqual(sharedPointCollections.adds, [entryKey, entryKey]);
  assert.equal(sharedPointCollections.entries.has(entryKey), true);
  console.log("✓ zoom-range changes add and remove shared point entries");
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

console.log("VectorTileQuadtreePrimitive tests passed.");

function createPrimitiveForTest() {
  const primitive = Object.create(VectorTileQuadtreePrimitive.prototype);
  primitive._layerRenderStates = new Map();
  return primitive;
}

function createTile(cacheKey, styleRule) {
  return {
    cacheKey,
    x: 0,
    y: 0,
    level: 0,
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

function createSharedPointCollectionsSpy() {
  return {
    entries: new Map(),
    adds: [],
    removes: [],
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
    hasTileEntries(tileKey) {
      return this.entries.has(tileKey);
    },
    getPrimitives() {
      return [];
    },
  };
}
