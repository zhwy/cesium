import assert from "node:assert/strict";

import VectorTilePrimitiveBucket, {
  VectorTileBucketFallbackReason,
} from "../src/VectorTilePrimitiveBucket.js";

{
  const featureTable = [
    { properties: { color: "#ff0000ff" } },
    { properties: { color: "#00ff0080" } },
  ];
  const primitive = createPrimitive({ translucent: true, instanceCount: 2 });
  const bucket = createBucket("line", featureTable, {
    retainAll: false,
    properties: ["color"],
  });
  bucket.addPrimitive(primitive, "line", [0, 1]);
  const result = bucket.applyStyle(
    createStyleRule("line", {
      "line-color": ["get", "color"],
    }),
    1,
    { changedPaths: ["paint.line-color"] },
  );

  assert.equal(result.instanceUpdates, 2);
  assert.deepEqual([...primitive.attributes[0].color], [255, 0, 0, 255]);
  assert.deepEqual([...primitive.attributes[1].color], [0, 255, 0, 128]);
  assert.equal(bucket.appliedStyleRevision, 1);
}

{
  const primitive = createPrimitive({ ready: false, instanceCount: 1 });
  const bucket = createBucket("line", [{}], {
    retainAll: false,
    properties: [],
  });
  bucket.addPrimitive(primitive, "line", [0]);
  const styleRule = createStyleRule("line", {
    "line-color": "#112233ff",
  });
  const first = bucket.applyStyle(styleRule, 1, {
    changedPaths: ["paint.line-color"],
  });
  assert.equal(first.pendingReady, true);
  assert.equal(primitive.attributeReads, 0);
  assert.equal(bucket.appliedStyleRevision, 0);

  primitive.ready = true;
  const second = bucket.applyStyle(styleRule, 1);
  assert.equal(second.pendingReady, false);
  assert.equal(primitive.attributeReads, 1);
  assert.equal(bucket.appliedStyleRevision, 1);
}

{
  const primitive = createPrimitive({
    translucent: false,
    instanceCount: 1,
  });
  const bucket = createBucket("fill", [{}], {
    retainAll: false,
    properties: [],
  });
  bucket.addPrimitive(primitive, "fill", [0]);
  const result = bucket.applyStyle(
    createStyleRule("fill", { "fill-color": "#ff000077" }),
    1,
    { changedPaths: ["paint.fill-color"] },
  );
  assert.equal(
    result.fallbackReason,
    VectorTileBucketFallbackReason.RENDER_STATE,
  );
  assert.equal(primitive.attributeReads, 0);
  assert.equal(bucket.pendingReplacement.reason, "RENDER_STATE");
}

{
  const primitive = createPrimitive({
    translucent: true,
    instanceCount: 1,
  });
  const bucket = createBucket("fill", [{}], {
    retainAll: false,
    properties: [],
  });
  bucket.addPrimitive(primitive, "fill", [0]);
  const result = bucket.applyStyle(
    createStyleRule("fill", { "fill-color": "#ff000077" }),
    1,
    { changedPaths: ["paint.fill-color"] },
  );
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.instanceUpdates, 1);
}

{
  const primitive = createPrimitive({ instanceCount: 1 });
  const bucket = createBucket("line", [{ properties: { kind: "road" } }], {
    retainAll: false,
    properties: ["kind"],
  });
  bucket.addPrimitive(primitive, "line", [0]);
  assert.equal(
    bucket.getStyleUpdateFallback(
      createStyleRule("line", { "line-color": ["get", "color"] }),
      { changedPaths: ["paint.line-color"] },
    ),
    VectorTileBucketFallbackReason.MISSING_PROPERTIES,
  );
}

{
  const primitive = createPrimitive({ instanceCount: 0 });
  const originalPrimitive = primitive;
  const bucket = createBucket("line", [], {
    retainAll: false,
    properties: [],
  });
  bucket.addPrimitive(primitive, "packed-line");
  const result = bucket.applyStyle(
    createStyleRule("line", { "line-color": "#336699ff" }),
    1,
    { changedPaths: ["paint.line-color"] },
  );
  assert.equal(result.instanceUpdates, 1);
  assert.equal(bucket.primitiveRecords[0].primitive, originalPrimitive);
  assert.equal(primitive.appearance.material.uniforms.color.red, 0.2);
}

{
  const fill = createPrimitive({ instanceCount: 1 });
  const outline = createPrimitive({ instanceCount: 1 });
  const bucket = createBucket("fill", [{}], {
    retainAll: false,
    properties: [],
  });
  bucket.addPrimitive(fill, "fill", [0]);
  bucket.addPrimitive(outline, "fill-outline", [0]);
  bucket.applyStyle(
    createStyleRule("fill", {
      "fill-color": "#ff0000ff",
      "fill-outline-color": "#00ff00ff",
    }),
    1,
    { changedPaths: ["paint.fill-outline-color"] },
  );
  assert.equal(fill.attributeReads, 0);
  assert.equal(outline.attributeReads, 1);

  bucket.applyStyle(createStyleRule("fill", { "fill-color": "#ff0000ff" }), 2, {
    changedPaths: ["paint.fill-outline-color"],
  });
  assert.equal(fill.show, true);
  assert.equal(outline.show, false);
}

console.log("VectorTile style hot update tests passed.");

function createBucket(type, featureTable, propertyProjection) {
  return new VectorTilePrimitiveBucket(createStyleRule(type), {
    featureTable,
    propertyProjection,
    vectorTile: {
      x: 0,
      y: 0,
      level: 6,
      primitiveStyleRules: {},
      pointBuckets: {},
    },
  });
}

function createStyleRule(type, paint = {}) {
  return {
    id: `${type}-layer`,
    type,
    sourceLayer: "features",
    paint,
    visibility: true,
  };
}

function createPrimitive(options = {}) {
  const instanceCount = options.instanceCount ?? 0;
  const attributes = Array.from({ length: instanceCount }, () => ({
    color: new Uint8Array(4),
  }));
  return {
    ready: options.ready ?? true,
    show: true,
    appearance: {
      translucent: options.translucent ?? true,
      material: {
        uniforms: { color: undefined },
      },
    },
    attributes,
    attributeReads: 0,
    getGeometryInstanceAttributes(id) {
      this.attributeReads++;
      return this.attributes[id];
    },
    isDestroyed() {
      return false;
    },
    destroy() {},
  };
}
