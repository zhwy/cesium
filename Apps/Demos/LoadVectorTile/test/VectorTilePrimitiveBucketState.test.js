import assert from "node:assert/strict";

import VectorTilePickRegistry from "../src/VectorTilePickRegistry.js";
import { VectorTileFeatureStateStore } from "../src/VectorTileFeatureState.js";
import VectorTilePrimitiveBucket from "../src/VectorTilePrimitiveBucket.js";

const gauges = {};
const diagnostics = {
  addGauge(name, amount) {
    gauges[name] = Math.max(0, (gauges[name] ?? 0) + amount);
  },
};
const registry = new VectorTilePickRegistry();
const vectorTile = {
  x: 4,
  y: 5,
  level: 6,
  buckets: {},
  primitives: {},
  primitiveStyleRules: {},
  pointBuckets: {},
};
const featureTable = [
  { id: 1, sourceFeatureIndex: 8, properties: { name: "A" } },
];
const primitive = {
  destroyed: false,
  isDestroyed() {
    return this.destroyed;
  },
  destroy() {
    this.destroyed = true;
  },
};
const styleRule = { id: "land", type: "fill", sourceLayer: "land" };
const bucket = new VectorTilePrimitiveBucket(styleRule, {
  allowPicking: true,
  diagnostics,
  featureTable,
  pickProperties: ["name"],
  pickRegistry: registry,
  sourceId: "demo",
  vectorTile,
  bucketRevision: 2,
  styleRevision: 3,
});
bucket.addPrimitive(primitive, "fill", [0]);

assert.equal(
  VectorTilePrimitiveBucket.storeVectorTileBucket(
    vectorTile,
    bucket,
    styleRule,
  ),
  true,
);
assert.equal(bucket.buildZoom, 6);
assert.equal(bucket.bucketRevision, 2);
assert.equal(bucket.appliedStyleRevision, 3);
assert.equal(bucket.primitiveRecords[0].role, "fill");
assert.ok(
  bucket.primitiveRecords[0].instanceFeatureIndices instanceof Uint32Array,
);
assert.equal(vectorTile.buckets.land, bucket);
assert.equal(gauges.residentStyleBuckets, 1);
assert.equal(gauges.residentRenderPrimitives, 1);
assert.equal(registry.resolve({ primitive, id: 0 }).properties.name, "A");

bucket.destroy();
bucket.destroy();
assert.equal(primitive.destroyed, true);
assert.equal(gauges.residentStyleBuckets, 0);
assert.equal(gauges.residentRenderPrimitives, 0);
assert.equal(registry.resolve({ primitive, id: 0 }), undefined);

{
  const disabledPrimitive = {
    isDestroyed: () => false,
    destroy() {},
  };
  const disabledBucket = new VectorTilePrimitiveBucket(styleRule, {
    allowPicking: false,
    diagnostics,
    featureTable,
    pickRegistry: registry,
    sourceId: "demo",
    vectorTile,
  });
  disabledBucket.addPrimitive(disabledPrimitive, "fill", [0]);
  VectorTilePrimitiveBucket.storeVectorTileBucket(
    vectorTile,
    disabledBucket,
    styleRule,
  );
  assert.equal(
    registry.resolve({ primitive: disabledPrimitive, id: 0 }),
    undefined,
  );
  disabledBucket.destroy();
}

{
  const featureStateStore = new VectorTileFeatureStateStore();
  const featureStateOwner = {
    registered: 0,
    unregistered: 0,
    registerFeatureStateBucket(bucket) {
      this.registered += bucket.getFeatureStateKeys().length;
    },
    unregisterFeatureStateBucket() {
      this.unregistered++;
    },
  };
  const featureTable = [
    { id: 1, properties: {} },
    { id: 2, properties: {} },
  ];
  const colors = [
    { color: new Uint8Array([0, 0, 0, 255]) },
    { color: new Uint8Array([0, 0, 0, 255]) },
  ];
  const primitive = {
    ready: true,
    getGeometryInstanceAttributes(instanceId) {
      return colors[instanceId];
    },
    isDestroyed: () => false,
    destroy() {},
  };
  const bucket = new VectorTilePrimitiveBucket(
    {
      id: "roads",
      type: "line",
      sourceLayer: "roads",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#00ffffff",
          "#000000ff",
        ],
      },
    },
    {
      featureTable,
      featureStateStore,
      featureStateOwner,
    },
  );
  bucket.addPrimitive(primitive, "line", [0, 1]);
  assert.deepEqual(bucket.getFeatureStateKeys().sort(), [
    "roads\u0000number\u00001",
    "roads\u0000number\u00002",
  ]);
  VectorTilePrimitiveBucket.storeVectorTileBucket(
    vectorTile,
    bucket,
    bucket.styleRule,
  );
  assert.equal(featureStateOwner.registered, 2);

  featureStateStore.set({ sourceLayer: "roads", id: 1 }, { hover: true });
  const result = bucket.applyFeatureState({
    sourceLayer: "roads",
    id: 1,
  });
  assert.equal(result.instanceUpdates, 1);
  assert.notDeepEqual([...colors[0].color], [0, 0, 0, 255]);
  assert.deepEqual([...colors[1].color], [0, 0, 0, 255]);
  bucket.destroy();
  assert.equal(featureStateOwner.unregistered, 1);
  console.log("✓ feature-state updates only target geometry instances");
}

{
  const featureStateStore = new VectorTileFeatureStateStore();
  const featureTable = [{ id: "a", properties: {} }];
  const attributes = { color: new Uint8Array([0, 0, 0, 255]) };
  const primitive = {
    ready: false,
    getGeometryInstanceAttributes() {
      return attributes;
    },
    isDestroyed: () => false,
    destroy() {},
  };
  const bucket = new VectorTilePrimitiveBucket(
    {
      id: "land",
      type: "fill",
      sourceLayer: "land",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#00ff00ff",
          "#000000ff",
        ],
      },
    },
    {
      featureTable,
      featureStateStore,
    },
  );
  bucket.addPrimitive(primitive, "fill", [0]);
  featureStateStore.set({ sourceLayer: "land", id: "a" }, { hover: true });
  assert.deepEqual(bucket.applyFeatureState({ sourceLayer: "land", id: "a" }), {
    instanceUpdates: 0,
    deferredUpdates: 1,
  });
  featureStateStore.remove({ sourceLayer: "land", id: "a" }, "hover");
  bucket.applyFeatureState({ sourceLayer: "land", id: "a" });
  primitive.ready = true;
  assert.deepEqual(bucket.applyPendingFeatureStateUpdates(), {
    instanceUpdates: 1,
    deferredUpdates: 0,
  });
  assert.deepEqual([...attributes.color], [0, 0, 0, 255]);
  bucket.destroy();
  console.log("✓ pending feature-state updates apply the final ready state");
}

{
  const featureStateStore = new VectorTileFeatureStateStore();
  const featureTable = [
    { id: "plot-a", properties: { name: "A" } },
    { id: "plot-b", properties: { name: "B" } },
  ];
  const colors = [
    { color: new Uint8Array([0, 0, 0, 255]) },
    { color: new Uint8Array([0, 0, 0, 255]) },
  ];
  const primitive = {
    ready: true,
    getGeometryInstanceAttributes(instanceId) {
      return colors[instanceId];
    },
    isDestroyed: () => false,
    destroy() {},
  };
  const bucket = new VectorTilePrimitiveBucket(
    {
      id: "plots",
      type: "fill",
      sourceLayer: "plots",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#ffff00ff",
          "#000000ff",
        ],
      },
    },
    {
      featureTable,
      featureStateStore,
    },
  );
  bucket.addPrimitive(primitive, "fill", [0, 1]);
  featureStateStore.set(
    { sourceLayer: "plots", id: "plot-b" },
    { hover: true },
  );

  const result = bucket.applyFeatureState({
    sourceLayer: "plots",
    id: "plot-b",
  });

  assert.equal(result.instanceUpdates, 1);
  assert.deepEqual([...colors[0].color], [0, 0, 0, 255]);
  assert.notDeepEqual([...colors[1].color], [0, 0, 0, 255]);
  bucket.destroy();
  console.log("✓ one tile can keep separate state for multiple fill features");
}

console.log("VectorTilePrimitiveBucket state tests passed.");
