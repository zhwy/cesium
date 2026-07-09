import assert from "node:assert/strict";

import { VectorTilePrimitiveBucket } from "../src/VectorTileBucketFactory.js";

const styleRule = {
  id: "parks-fill",
  type: "fill",
  sourceLayer: "parks",
};

const destroyed = [];
const bucket = new VectorTilePrimitiveBucket(styleRule);
bucket.addPrimitive({
  isDestroyed: () => false,
  destroy: () => destroyed.push("a"),
});
bucket.addPrimitives([
  undefined,
  {
    isDestroyed: () => false,
    destroy: () => destroyed.push("b"),
  },
  {
    isDestroyed: () => true,
    destroy: () => destroyed.push("c"),
  },
]);
bucket.addBillboardDescriptor({ id: "billboard-a" });
bucket.addLabelDescriptor({ id: "label-a" });

assert.equal(bucket.id, "parks-fill");
assert.equal(bucket.type, "fill");
assert.equal(bucket.sourceLayer, "parks");
assert.equal(bucket.length, 5);
assert.equal(bucket.pointDescriptors.billboards.length, 1);
assert.equal(bucket.pointDescriptors.labels.length, 1);

bucket.destroy();

assert.deepEqual(destroyed, ["a", "b"]);
assert.equal(bucket.length, 0);
assert.equal(bucket.pointDescriptors.billboards.length, 0);
assert.equal(bucket.pointDescriptors.labels.length, 0);

console.log("VectorTilePrimitiveBucket tests passed.");
