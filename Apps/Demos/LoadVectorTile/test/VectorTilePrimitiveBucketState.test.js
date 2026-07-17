import assert from "node:assert/strict";

import VectorTilePickRegistry from "../src/VectorTilePickRegistry.js";
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

console.log("VectorTilePrimitiveBucket state tests passed.");
